package otel

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	logspb "go.opentelemetry.io/proto/otlp/logs/v1"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

// PublishFunc is the callback signature for publishing a log line to the SSE hub.
type PublishFunc func(component, subStream, line string)

// LogsReceiver receives OTLP/HTTP log exports and publishes each record to the
// SSE hub via the publish callback.  It follows the same patterns as Receiver
// (traces) and MetricsReceiver (metrics).
type LogsReceiver struct {
	publish   PublishFunc
	forwardTo string
	client    *http.Client
}

// NewLogsReceiver creates a new OTLP logs receiver.
// publish is called for every decoded log record; forwardTo is an optional
// upstream collector URL (empty disables forwarding).
func NewLogsReceiver(publish PublishFunc, forwardTo string) *LogsReceiver {
	r := &LogsReceiver{
		publish:   publish,
		forwardTo: strings.TrimRight(forwardTo, "/"),
	}
	if forwardTo != "" {
		r.client = &http.Client{Timeout: 5 * time.Second}
	}
	return r
}

// HandleOTLP is the HTTP handler for POST /v1/logs.
func (r *LogsReceiver) HandleOTLP(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	defer func() { _ = req.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(req.Body, 4<<20))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}

	ct := req.Header.Get("Content-Type")

	if r.forwardTo != "" {
		go r.forward(r.forwardTo+"/v1/logs", ct, body)
	}

	// Always attempt protobuf — Spin sends application/x-protobuf.
	r.parseProto(body)

	w.WriteHeader(http.StatusOK)
}

// forward fires a best-effort POST. Errors are silenced.
func (r *LogsReceiver) forward(url, contentType string, body []byte) {
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}

// parseProto decodes ExportLogsServiceRequest (field 1 = repeated ResourceLogs).
// The outer wrapper is decoded manually with protowire to avoid collector deps,
// while ResourceLogs is unmarshalled via proto — same pattern as traces/metrics.
func (r *LogsReceiver) parseProto(data []byte) {
	b := data
	for len(b) > 0 {
		num, typ, n := protowire.ConsumeTag(b)
		if n < 0 {
			break
		}
		b = b[n:]
		if num == 1 && typ == protowire.BytesType {
			val, n := protowire.ConsumeBytes(b)
			if n < 0 {
				break
			}
			b = b[n:]
			var rl logspb.ResourceLogs
			if err := proto.Unmarshal(val, &rl); err == nil {
				r.processRL(&rl)
			}
		} else {
			n := protowire.ConsumeFieldValue(num, typ, b)
			if n < 0 {
				break
			}
			b = b[n:]
		}
	}
}

func (r *LogsReceiver) processRL(rl *logspb.ResourceLogs) {
	// Fallback component from resource attributes.
	component := ""
	if rl.Resource != nil {
		component = attrString(rl.Resource.Attributes, "service.name")
	}

	for _, sl := range rl.ScopeLogs {
		for _, lr := range sl.LogRecords {
			comp := component
			if c := attrString(lr.Attributes, "component_id"); c != "" {
				comp = c
			} else if c := attrString(lr.Attributes, "component"); c != "" {
				comp = c
			}

			// Map severity to stdout/stderr: WARN (13) and above → stderr.
			sub := "stdout"
			if lr.SeverityNumber >= logspb.SeverityNumber_SEVERITY_NUMBER_WARN {
				sub = "stderr"
			}

			line := anyValueToString(lr.Body)
			if line == "" {
				continue
			}

			r.publish(comp, sub, line)
		}
	}
}

// anyValueToString converts an OTLP AnyValue to its string representation.
func anyValueToString(v *commonpb.AnyValue) string {
	if v == nil {
		return ""
	}
	switch val := v.Value.(type) {
	case *commonpb.AnyValue_StringValue:
		return val.StringValue
	case *commonpb.AnyValue_IntValue:
		return strconv.FormatInt(val.IntValue, 10)
	case *commonpb.AnyValue_DoubleValue:
		return strconv.FormatFloat(val.DoubleValue, 'f', -1, 64)
	case *commonpb.AnyValue_BoolValue:
		if val.BoolValue {
			return "true"
		}
		return "false"
	case *commonpb.AnyValue_BytesValue:
		return hex.EncodeToString(val.BytesValue)
	case *commonpb.AnyValue_ArrayValue:
		if val.ArrayValue == nil {
			return ""
		}
		parts := make([]string, 0, len(val.ArrayValue.Values))
		for _, elem := range val.ArrayValue.Values {
			parts = append(parts, anyValueToString(elem))
		}
		return "[" + strings.Join(parts, ", ") + "]"
	case *commonpb.AnyValue_KvlistValue:
		if val.KvlistValue == nil {
			return ""
		}
		parts := make([]string, 0, len(val.KvlistValue.Values))
		for _, kv := range val.KvlistValue.Values {
			parts = append(parts, fmt.Sprintf("%s=%s", kv.Key, anyValueToString(kv.Value)))
		}
		return "{" + strings.Join(parts, ", ") + "}"
	}
	return ""
}
