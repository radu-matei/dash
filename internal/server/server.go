package server

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"

	"github.com/spinframework/dash/internal/config"
	"github.com/spinframework/dash/internal/otel"
	"github.com/spinframework/dash/internal/process"
)

//go:embed ui/dist
var embeddedUI embed.FS

// Options configures the dashboard HTTP server.
type Options struct {
	Port        int
	Hub         *Hub
	Runner      *process.Runner
	OTel        *otel.Receiver
	OTelMetrics *otel.MetricsReceiver
	Cfg         *config.AppConfig
}

// New builds and returns a configured http.ServeMux ready to Serve.
func New(opts Options) (*http.ServeMux, error) {
	mux := http.NewServeMux()

	// --- API routes ---
	mux.Handle("/api/logs", opts.Hub)
	mux.HandleFunc("/api/status", statusHandler(opts.Runner))
	mux.HandleFunc("/api/app", appHandler(opts.Cfg, opts.Runner))
	mux.HandleFunc("/api/vars", varsHandler(opts.Cfg))
	mux.HandleFunc("/api/traces", tracesHandler(opts.OTel))
	mux.HandleFunc("/api/otel-metrics", otelMetricsHandler(opts.OTelMetrics))

	// --- SPA static file handler ---
	distFS, err := fs.Sub(embeddedUI, "ui/dist")
	if err != nil {
		return nil, fmt.Errorf("creating sub-FS for ui/dist: %w", err)
	}
	fileServer := http.FileServer(http.FS(distFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Let the file server handle assets that exist; fall back to index.html
		// for all other paths so React Router can manage client-side routing.
		_, statErr := fs.Stat(distFS, r.URL.Path[1:])
		if r.URL.Path != "/" && statErr != nil {
			// Serve the SPA shell for unknown paths.
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})

	return mux, nil
}

// Addr returns the listen address string for the given port.
func Addr(port int) string {
	return fmt.Sprintf(":%d", port)
}
