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
	// AllowMutations controls whether spin.toml mutation endpoints are active.
	// Must be explicitly opted into via --allow-edits on the CLI.
	AllowMutations bool
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
	mux.HandleFunc("/api/app", appHandler(opts.Cfg, cfgMu, opts.Runner, opts.AllowMutations))
	mux.HandleFunc("/api/vars", varsHandler(opts.Cfg, cfgMu))
	mux.HandleFunc("/api/traces", tracesHandler(opts.OTel))
	mux.HandleFunc("/api/otel-metrics", otelMetricsHandler(opts.OTelMetrics))
	mux.HandleFunc("/api/templates", templatesHandler())

	// --- Mutation routes (require --allow-edits) ---
	mutationGuard := func(h http.HandlerFunc) http.HandlerFunc {
		if opts.AllowMutations {
			return h
		}
		return func(w http.ResponseWriter, r *http.Request) {
			jsonErr(w, http.StatusForbidden, "edits are disabled; restart the dashboard with --allow-edits to enable them")
		}
	}
	mux.HandleFunc("/api/spin-toml", mutationGuard(spinTomlHandler(&opts, cfgMu)))
	mux.HandleFunc("/api/add-component", mutationGuard(addComponentHandler(&opts, cfgMu)))
	mux.HandleFunc("/api/add-variable", mutationGuard(addVariableHandler(&opts, cfgMu)))
	mux.HandleFunc("/api/add-binding", mutationGuard(addBindingHandler(&opts, cfgMu)))
	mux.HandleFunc("/api/add-component-variable", mutationGuard(addComponentVariableHandler(&opts, cfgMu)))
	mux.HandleFunc("/api/remove-binding", mutationGuard(removeBindingHandler(&opts, cfgMu)))
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
