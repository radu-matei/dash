package otel

import (
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

// maxSpans is the in-memory cap for spans within a session.
// Large enough that within a typical local dev session spans never roll off.
const maxSpans = 10_000

// Span is a simplified representation of an OTel span for the dashboard UI.
type Span struct {
	TraceID   string            `json:"traceId"`
	SpanID    string            `json:"spanId"`
	ParentID  string            `json:"parentId,omitempty"`
	Name      string            `json:"name"`
	Component string            `json:"component,omitempty"`
	StartTime time.Time         `json:"startTime"`
	Duration  int64             `json:"durationMs"` // milliseconds
	Status    string            `json:"status"`
	Attrs     map[string]string `json:"attrs,omitempty"`
}

// Receiver is a lightweight OTLP/HTTP trace receiver that accepts both
// application/x-protobuf (Spin default) and application/json payloads.
type Receiver struct {
	mu    sync.RWMutex
	spans []Span
}

// NewReceiver creates a new OTel trace receiver.
func NewReceiver() *Receiver {
	return &Receiver{}
}

// Spans returns a copy of all stored spans (most recent last).
func (r *Receiver) Spans() []Span {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Span, len(r.spans))
	copy(out, r.spans)
	return out
}

// HandleOTLP is the HTTP handler for POST /v1/traces.
// It accepts application/x-protobuf (Spin default) and application/json.
func (r *Receiver) HandleOTLP(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(io.LimitReader(req.Body, 4<<20))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	defer func() { _ = req.Body.Close() }()

	ct := req.Header.Get("Content-Type")

	var spans []Span
	if strings.Contains(ct, "application/x-protobuf") {
		spans, err = parseOTLPProto(body)
	} else {
		spans, err = parseOTLPJSON(body)
	}

	// Never return an error to the client — we must not block the Spin app.
	if err == nil && len(spans) > 0 {
		r.mu.Lock()
		r.spans = append(r.spans, spans...)
		if len(r.spans) > maxSpans {
			r.spans = r.spans[len(r.spans)-maxSpans:]
		}
		r.mu.Unlock()
	}

	w.WriteHeader(http.StatusOK)
}

// parseOTLPProto decodes an OTLP ExportTraceServiceRequest protobuf payload.
//
// ExportTraceServiceRequest has a single field:
//
//	repeated ResourceSpans resource_spans = 1;
//
// We decode the outer wrapper manually using protowire to avoid importing the
// collector/trace/v1 package which drags in grpc-gateway dependencies.
func parseOTLPProto(data []byte) ([]Span, error) {
	var spans []Span
	b := data
	for len(b) > 0 {
		num, typ, n := protowire.ConsumeTag(b)
		if n < 0 {
			break
		}
		b = b[n:]

		// Field 1 = resource_spans (bytes / embedded message)
		if num == 1 && typ == protowire.BytesType {
			val, n := protowire.ConsumeBytes(b)
			if n < 0 {
				break
			}
			b = b[n:]

			var rs tracepb.ResourceSpans
			if err := proto.Unmarshal(val, &rs); err != nil {
				continue
			}
			spans = append(spans, resourceSpansToSpans(&rs)...)
		} else {
			// Unknown field — skip its value so we stay in sync.
			n := protowire.ConsumeFieldValue(num, typ, b)
			if n < 0 {
				break
			}
			b = b[n:]
		}
	}
	return spans, nil
}

func resourceSpansToSpans(rs *tracepb.ResourceSpans) []Span {
	component := ""
	if rs.Resource != nil {
		component = attrString(rs.Resource.Attributes, "service.name")
	}

	var spans []Span
	for _, ss := range rs.ScopeSpans {
		for _, s := range ss.Spans {
			durationMs := int64(0)
			if s.EndTimeUnixNano > s.StartTimeUnixNano {
				durationMs = int64(s.EndTimeUnixNano-s.StartTimeUnixNano) / 1_000_000
			}

			attrs := make(map[string]string, len(s.Attributes))
			for _, kv := range s.Attributes {
				if v := attrStringKV(kv); v != "" {
					attrs[kv.Key] = v
				}
			}

			status := "OK"
			if s.Status != nil && s.Status.Code == tracepb.Status_STATUS_CODE_ERROR {
				status = "ERROR"
			}
			// Spin doesn't always set Status.Code for HTTP errors; infer from the
			// http.response.status_code attribute (>= 400 → error).
			if status == "OK" {
				status = inferHTTPStatus(attrs)
			}

			// Trim all-zero parent IDs (root spans).
			parentID := hex.EncodeToString(s.ParentSpanId)
			if isZeroHex(parentID) {
				parentID = ""
			}

			// Prefer span-level component_id (set by Spin per-span) over the
			// resource-level service.name, which is the same for every span in
			// the batch and often reflects only one component or the app name.
			spanComponent := component
			if c := attrs["component_id"]; c != "" {
				spanComponent = c
			} else if c := attrs["component"]; c != "" {
				spanComponent = c
			}

			spans = append(spans, Span{
				TraceID:   hex.EncodeToString(s.TraceId),
				SpanID:    hex.EncodeToString(s.SpanId),
				ParentID:  parentID,
				Name:      s.Name,
				Component: spanComponent,
				StartTime: time.Unix(0, int64(s.StartTimeUnixNano)),
				Duration:  durationMs,
				Status:    status,
				Attrs:     attrs,
			})
		}
	}
	return spans
}

// inferHTTPStatus returns "ERROR" when the attrs map contains an
// http.response.status_code >= 400, signalling an HTTP-level error even when
// the OTel span Status.Code was not explicitly set to ERROR (common with Spin).
func inferHTTPStatus(attrs map[string]string) string {
	if code, err := strconv.Atoi(attrs["http.response.status_code"]); err == nil && code >= 400 {
		return "ERROR"
	}
	return "OK"
}

func isZeroHex(s string) bool {
	for _, c := range s {
		if c != '0' {
			return false
		}
	}
	return true
}

func attrString(attrs []*commonpb.KeyValue, key string) string {
	for _, kv := range attrs {
		if kv.Key == key {
			return attrStringKV(kv)
		}
	}
	return ""
}

func attrStringKV(kv *commonpb.KeyValue) string {
	if kv == nil || kv.Value == nil {
		return ""
	}
	switch v := kv.Value.Value.(type) {
	case *commonpb.AnyValue_StringValue:
		return v.StringValue
	case *commonpb.AnyValue_IntValue:
		return strconv.FormatInt(v.IntValue, 10)
	case *commonpb.AnyValue_DoubleValue:
		return strconv.FormatFloat(v.DoubleValue, 'f', -1, 64)
	case *commonpb.AnyValue_BoolValue:
		if v.BoolValue {
			return "true"
		}
		return "false"
	case *commonpb.AnyValue_BytesValue:
		return hex.EncodeToString(v.BytesValue)
	}
	return ""
}

// parseOTLPJSON parses the OTLP JSON trace export format.
func parseOTLPJSON(data []byte) ([]Span, error) {
	var root struct {
		ResourceSpans []struct {
			Resource struct {
				Attributes []jsonKV `json:"attributes"`
			} `json:"resource"`
			ScopeSpans []struct {
				Spans []struct {
					TraceID      string   `json:"traceId"`
					SpanID       string   `json:"spanId"`
					ParentSpanID string   `json:"parentSpanId"`
					Name         string   `json:"name"`
					StartTime    string   `json:"startTimeUnixNano"`
					EndTime      string   `json:"endTimeUnixNano"`
					Attributes   []jsonKV `json:"attributes"`
					Status       struct {
						Code int `json:"code"`
					} `json:"status"`
				} `json:"spans"`
			} `json:"scopeSpans"`
		} `json:"resourceSpans"`
	}

	if err := json.Unmarshal(data, &root); err != nil {
		return nil, err
	}

	var spans []Span
	for _, rs := range root.ResourceSpans {
		component := jsonKVString(rs.Resource.Attributes, "service.name")
		for _, ss := range rs.ScopeSpans {
			for _, s := range ss.Spans {
				startNs := parseNano(s.StartTime)
				endNs := parseNano(s.EndTime)
				durationMs := int64(0)
				if endNs > startNs {
					durationMs = (endNs - startNs) / 1_000_000
				}
				attrs := make(map[string]string, len(s.Attributes))
				for _, kv := range s.Attributes {
					if v, ok := kv.stringVal(); ok {
						attrs[kv.Key] = v
					}
				}
			status := "OK"
			if s.Status.Code == 2 {
				status = "ERROR"
			}
			if status == "OK" {
				status = inferHTTPStatus(attrs)
			}
				// Prefer span-level component_id over resource service.name.
				spanComponent := component
				if c := attrs["component_id"]; c != "" {
					spanComponent = c
				} else if c := attrs["component"]; c != "" {
					spanComponent = c
				}
				spans = append(spans, Span{
					TraceID:   s.TraceID,
					SpanID:    s.SpanID,
					ParentID:  s.ParentSpanID,
					Name:      s.Name,
					Component: spanComponent,
					StartTime: time.Unix(0, startNs),
					Duration:  durationMs,
					Status:    status,
					Attrs:     attrs,
				})
			}
		}
	}
	return spans, nil
}

type jsonKV struct {
	Key   string `json:"key"`
	Value struct {
		StringValue string `json:"stringValue"`
		IntValue    string `json:"intValue"`
	} `json:"value"`
}

func (kv jsonKV) stringVal() (string, bool) {
	if kv.Value.StringValue != "" {
		return kv.Value.StringValue, true
	}
	if kv.Value.IntValue != "" {
		return kv.Value.IntValue, true
	}
	return "", false
}

func jsonKVString(attrs []jsonKV, key string) string {
	for _, a := range attrs {
		if a.Key == key {
			v, _ := a.stringVal()
			return v
		}
	}
	return ""
}

func parseNano(s string) int64 {
	var n int64
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int64(c-'0')
		}
	}
	return n
}
