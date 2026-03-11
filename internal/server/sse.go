package server

import (
	"encoding/json"
	"net/http"
	"sync"
)

const maxHistory = 5_000

// LogLine is the payload broadcast to SSE clients.
type LogLine struct {
	Stream string `json:"stream"` // "stdout" | "stderr" | "system"
	Line   string `json:"line"`
}

// Hub manages SSE client connections and broadcasts log lines.
// It keeps a ring buffer of recent lines so that clients connecting
// after startup receive everything produced so far.
type Hub struct {
	mu      sync.Mutex
	clients map[chan LogLine]struct{}
	history []LogLine
}

// NewHub creates a new SSE Hub.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[chan LogLine]struct{}),
	}
}

// Publish stores the line in the history buffer and broadcasts it to
// all currently-connected SSE clients.
func (h *Hub) Publish(stream, line string) {
	msg := LogLine{Stream: stream, Line: line}
	h.mu.Lock()
	defer h.mu.Unlock()

	// Append to ring buffer, trim when over limit.
	h.history = append(h.history, msg)
	if len(h.history) > maxHistory {
		h.history = h.history[len(h.history)-maxHistory:]
	}

	for ch := range h.clients {
		select {
		case ch <- msg:
		default:
			// Slow client — skip rather than block.
		}
	}
}

// subscribe registers a new client channel and returns the current
// history snapshot plus the live channel.
func (h *Hub) subscribe() ([]LogLine, chan LogLine) {
	ch := make(chan LogLine, 256)
	h.mu.Lock()
	snapshot := make([]LogLine, len(h.history))
	copy(snapshot, h.history)
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return snapshot, ch
}

// unsubscribe removes a client channel from the hub.
func (h *Hub) unsubscribe(ch chan LogLine) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
}

func writeSSE(w http.ResponseWriter, flusher http.Flusher, msg LogLine) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	_, _ = w.Write([]byte("data: "))
	_, _ = w.Write(data)
	_, _ = w.Write([]byte("\n\n"))
	flusher.Flush()
}

// ServeHTTP implements the /api/logs SSE endpoint.
// It first replays the history buffer, then streams live lines.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	snapshot, ch := h.subscribe()
	defer h.unsubscribe(ch)

	// Replay history so late-connecting clients see all prior output.
	for _, msg := range snapshot {
		writeSSE(w, flusher, msg)
	}

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			writeSSE(w, flusher, msg)
		}
	}
}
