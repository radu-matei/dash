package otel

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	metricspb "go.opentelemetry.io/proto/otlp/metrics/v1"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

// MetricPoint is a single timestamped data point.
type MetricPoint struct {
	Timestamp time.Time         `json:"timestamp"`
	Value     float64           `json:"value"`
	Attrs     map[string]string `json:"attrs,omitempty"`
}

// HistogramBuckets holds the latest explicit-boundary histogram snapshot.
type HistogramBuckets struct {
	Boundaries []float64 `json:"boundaries"`
	Counts     []uint64  `json:"counts"`
	Sum        float64   `json:"sum"`
	Count      uint64    `json:"count"`
}

// MetricSeries accumulates data points for one named metric.
type MetricSeries struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Unit        string            `json:"unit"`
	Kind        string            `json:"kind"` // "counter" | "gauge" | "histogram"
	Points      []MetricPoint     `json:"points"`
	Buckets     *HistogramBuckets `json:"buckets,omitempty"`
}

// MetricsReceiver stores OTel metrics exported by the Spin app.
// If forwardTo is non-empty, raw payloads are also forwarded there
// asynchronously so a central backend can see metrics from all running apps.
type MetricsReceiver struct {
	mu        sync.RWMutex
	series    map[string]*MetricSeries
	maxPts    int
	forwardTo string
	client    *http.Client
}

// NewMetricsReceiver creates a ready MetricsReceiver.
// forwardTo is an optional base URL (e.g. "http://localhost:4317") to forward
// raw OTLP payloads to; empty string disables forwarding.
func NewMetricsReceiver(maxPts int, forwardTo string) *MetricsReceiver {
	r := &MetricsReceiver{
		series:    make(map[string]*MetricSeries),
		maxPts:    maxPts,
		forwardTo: strings.TrimRight(forwardTo, "/"),
	}
	if forwardTo != "" {
		r.client = &http.Client{Timeout: 5 * time.Second}
	}
	return r
}

// HandleOTLP is the HTTP handler for POST /v1/metrics.
func (r *MetricsReceiver) HandleOTLP(w http.ResponseWriter, req *http.Request) {
	body, err := io.ReadAll(req.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	// Forward raw payload to upstream collector before parsing.
	if r.forwardTo != "" {
		go r.forward(r.forwardTo+"/v1/metrics", req.Header.Get("Content-Type"), body)
	}
	// Always attempt protobuf decoding — the Spin OTel SDK always sends
	// application/x-protobuf, but we don't gate on the content-type so that
	// minor header variations (e.g. extra params) don't silently drop metrics.
	r.parseProto(body)
	w.WriteHeader(http.StatusOK)
}

// forward fires a best-effort POST of body to url.  Errors are silenced —
// a slow or unavailable upstream must never stall the local Spin app.
func (r *MetricsReceiver) forward(url, contentType string, body []byte) {
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

// Series returns a snapshot of all received metric series.
func (r *MetricsReceiver) Series() map[string]*MetricSeries {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[string]*MetricSeries, len(r.series))
	for k, v := range r.series {
		cp := *v
		pts := make([]MetricPoint, len(v.Points))
		copy(pts, v.Points)
		cp.Points = pts
		if v.Buckets != nil {
			b := *v.Buckets
			b.Boundaries = append([]float64(nil), v.Buckets.Boundaries...)
			b.Counts = append([]uint64(nil), v.Buckets.Counts...)
			cp.Buckets = &b
		}
		out[k] = &cp
	}
	return out
}

// ── proto parsing ─────────────────────────────────────────────────────────────

// parseProto decodes ExportMetricsServiceRequest (field 1 = repeated ResourceMetrics).
func (r *MetricsReceiver) parseProto(data []byte) {
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
			var rm metricspb.ResourceMetrics
			if err := proto.Unmarshal(val, &rm); err == nil {
				r.processRM(&rm)
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

func (r *MetricsReceiver) processRM(rm *metricspb.ResourceMetrics) {
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			r.ingest(m)
		}
	}
}

func (r *MetricsReceiver) ingest(m *metricspb.Metric) {
	r.mu.Lock()
	defer r.mu.Unlock()

	s, ok := r.series[m.Name]
	if !ok {
		s = &MetricSeries{Name: m.Name, Description: m.Description, Unit: m.Unit}
		r.series[m.Name] = s
	}

	switch d := m.Data.(type) {
	case *metricspb.Metric_Sum:
		if d.Sum.IsMonotonic {
			s.Kind = "counter"
		} else {
			s.Kind = "gauge"
		}
		for _, dp := range d.Sum.DataPoints {
			s.Points = append(s.Points, numberPoint(dp))
		}

	case *metricspb.Metric_Gauge:
		s.Kind = "gauge"
		for _, dp := range d.Gauge.DataPoints {
			s.Points = append(s.Points, numberPoint(dp))
		}

	case *metricspb.Metric_Histogram:
		s.Kind = "histogram"
		var aggCounts []uint64
		var bounds []float64
		var totalSum float64
		var totalCount uint64
		for _, dp := range d.Histogram.DataPoints {
			avg := 0.0
			if dp.Sum != nil && dp.Count > 0 {
				avg = *dp.Sum / float64(dp.Count)
			}
			s.Points = append(s.Points, MetricPoint{
				Timestamp: nanoToTime(dp.TimeUnixNano),
				Value:     avg,
				Attrs:     attrsMap(dp.Attributes),
			})
			if len(dp.ExplicitBounds) > 0 {
				if bounds == nil {
					bounds = dp.ExplicitBounds
					aggCounts = make([]uint64, len(dp.BucketCounts))
				}
				for i, c := range dp.BucketCounts {
					if i < len(aggCounts) {
						aggCounts[i] += c
					}
				}
				if dp.Sum != nil {
					totalSum += *dp.Sum
				}
				totalCount += dp.Count
			}
		}
		if bounds != nil {
			s.Buckets = &HistogramBuckets{
				Boundaries: bounds,
				Counts:     aggCounts,
				Sum:        totalSum,
				Count:      totalCount,
			}
		}

	case *metricspb.Metric_ExponentialHistogram:
		s.Kind = "histogram"
		for _, dp := range d.ExponentialHistogram.DataPoints {
			avg := 0.0
			if dp.Sum != nil && dp.Count > 0 {
				avg = *dp.Sum / float64(dp.Count)
			}
			s.Points = append(s.Points, MetricPoint{
				Timestamp: nanoToTime(dp.TimeUnixNano),
				Value:     avg,
				Attrs:     attrsMap(dp.Attributes),
			})
		}
	}

	if len(s.Points) > r.maxPts {
		s.Points = s.Points[len(s.Points)-r.maxPts:]
	}
}

func numberPoint(dp *metricspb.NumberDataPoint) MetricPoint {
	pt := MetricPoint{
		Timestamp: nanoToTime(dp.TimeUnixNano),
		Attrs:     attrsMap(dp.Attributes),
	}
	switch v := dp.Value.(type) {
	case *metricspb.NumberDataPoint_AsDouble:
		pt.Value = v.AsDouble
	case *metricspb.NumberDataPoint_AsInt:
		pt.Value = float64(v.AsInt)
	}
	return pt
}

func nanoToTime(ns uint64) time.Time {
	if ns == 0 {
		return time.Now().UTC()
	}
	return time.Unix(0, int64(ns)).UTC()
}

func attrsMap(kvs []*commonpb.KeyValue) map[string]string {
	if len(kvs) == 0 {
		return nil
	}
	m := make(map[string]string, len(kvs))
	for _, kv := range kvs {
		m[kv.Key] = attrStringKV(kv)
	}
	return m
}
