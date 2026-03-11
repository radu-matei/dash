package server

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"sync"

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

	// Dir is the working directory of the Spin application (where spin.toml lives).
	Dir string
	// SpinBin is the path to the spin binary used to run sub-commands like `spin add`.
	SpinBin string
	// EnvOverrides are the SPIN_VARIABLE_* values collected at startup.
	// They are re-applied after each spin.toml reload so the in-memory config
	// stays consistent.
	EnvOverrides map[string]string
	// CliOverrides are the --variable flag values from the original CLI invocation.
	CliOverrides map[string]string
}

// New builds and returns a configured http.ServeMux ready to Serve.
func New(opts Options) (*http.ServeMux, error) {
	mux := http.NewServeMux()

	// cfgMu guards concurrent reads of opts.Cfg (from API handlers) against
	// writes triggered by mutation handlers (add-variable, add-binding, etc.).
	cfgMu := &sync.RWMutex{}

	// --- Read-only API routes ---
	mux.Handle("/api/logs", opts.Hub)
	mux.HandleFunc("/api/status", statusHandler(opts.Runner))
	mux.HandleFunc("/api/app", appHandler(opts.Cfg, cfgMu, opts.Runner))
	mux.HandleFunc("/api/vars", varsHandler(opts.Cfg, cfgMu))
	mux.HandleFunc("/api/traces", tracesHandler(opts.OTel))
	mux.HandleFunc("/api/otel-metrics", otelMetricsHandler(opts.OTelMetrics))
	mux.HandleFunc("/api/templates", templatesHandler())

	// --- Mutation routes ---
	mux.HandleFunc("/api/spin-toml", spinTomlHandler(&opts, cfgMu))
	mux.HandleFunc("/api/add-component", addComponentHandler(&opts, cfgMu))
	mux.HandleFunc("/api/add-variable", addVariableHandler(&opts, cfgMu))
	mux.HandleFunc("/api/add-binding", addBindingHandler(&opts, cfgMu))
	mux.HandleFunc("/api/add-component-variable", addComponentVariableHandler(&opts, cfgMu))
	mux.HandleFunc("/api/remove-binding", removeBindingHandler(&opts, cfgMu))
	mux.HandleFunc("/api/restart", restartHandler(opts.Runner))

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
