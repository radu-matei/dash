package otel

import (
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

// MetricSeries accumulates data points for one named metric.
type MetricSeries struct {
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Unit        string        `json:"unit"`
	Kind        string        `json:"kind"` // "counter" | "gauge" | "histogram"
	Points      []MetricPoint `json:"points"`
}

// MetricsReceiver stores OTel metrics exported by the Spin app.
type MetricsReceiver struct {
	mu     sync.RWMutex
	series map[string]*MetricSeries
	maxPts int
}

// NewMetricsReceiver creates a ready MetricsReceiver.
func NewMetricsReceiver(maxPts int) *MetricsReceiver {
	return &MetricsReceiver{series: make(map[string]*MetricSeries), maxPts: maxPts}
}

// HandleOTLP is the HTTP handler for POST /v1/metrics.
func (r *MetricsReceiver) HandleOTLP(w http.ResponseWriter, req *http.Request) {
	body, err := io.ReadAll(req.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ct := req.Header.Get("Content-Type")
	if strings.Contains(ct, "application/x-protobuf") {
		r.parseProto(body)
	}
	w.WriteHeader(http.StatusOK)
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
		s.Kind = "counter"
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
		for _, dp := range d.Histogram.DataPoints {
			avg := 0.0
			sum := dp.Sum
			if sum != nil && dp.Count > 0 {
				avg = *sum / float64(dp.Count)
			}
			pt := MetricPoint{
				Timestamp: nanoToTime(dp.TimeUnixNano),
				Value:     avg,
				Attrs:     attrsMap(dp.Attributes),
			}
			s.Points = append(s.Points, pt)
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
