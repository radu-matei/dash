package server

import (
	"encoding/json"
	"net/http"
	"sync"
)

// LogLine is the payload broadcast to SSE clients.
type LogLine struct {
	Stream string `json:"stream"` // "stdout" | "stderr" | "system"
	Line   string `json:"line"`
}

// Hub manages SSE client connections and broadcasts log lines.
type Hub struct {
	mu      sync.Mutex
	clients map[chan LogLine]struct{}
}

// NewHub creates a new SSE Hub.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[chan LogLine]struct{}),
	}
}

// Publish sends a log line to all connected SSE clients.
func (h *Hub) Publish(stream, line string) {
	msg := LogLine{Stream: stream, Line: line}
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- msg:
		default:
			// Slow client — skip rather than block.
		}
	}
}

// subscribe registers a new client and returns its receive channel.
func (h *Hub) subscribe() chan LogLine {
	ch := make(chan LogLine, 64)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

// unsubscribe removes a client channel from the hub.
func (h *Hub) unsubscribe(ch chan LogLine) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
}

// ServeHTTP implements the /api/logs SSE endpoint.
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

	ch := h.subscribe()
	defer h.unsubscribe(ch)

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			data, err := json.Marshal(msg)
			if err != nil {
				continue
			}
			_, _ = w.Write([]byte("data: "))
			_, _ = w.Write(data)
			_, _ = w.Write([]byte("\n\n"))
			flusher.Flush()
		}
	}
}
