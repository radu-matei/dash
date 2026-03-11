package server

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"

	"github.com/spinframework/dash/internal/config"
	"github.com/spinframework/dash/internal/db"
	"github.com/spinframework/dash/internal/otel"
	"github.com/spinframework/dash/internal/process"
)

//go:embed ui/dist
var embeddedUI embed.FS

// Options configures the dashboard HTTP server.
type Options struct {
	Port        int
	AppDir      string
	Hub         *Hub
	Runner      *process.Runner
	OTel        *otel.Receiver
	OTelMetrics *otel.MetricsReceiver
	Cfg         *config.AppConfig
	SQLite      *db.SQLiteDB // may be nil if .spin/sqlite_db.db not found
	KV          *db.KVDB     // may be nil if .spin/sqlite_key_value.db not found
}

// New builds and returns a configured http.ServeMux ready to Serve.
func New(opts Options) (*http.ServeMux, error) {
	mux := http.NewServeMux()

	// --- API routes ---
	mux.Handle("/api/logs", opts.Hub)
	mux.HandleFunc("/api/logs/history", logHistoryHandler(opts.AppDir))
	mux.HandleFunc("/api/status", statusHandler(opts.Runner))
	mux.HandleFunc("/api/app", appHandler(opts.Cfg, opts.Runner))
	mux.HandleFunc("/api/vars", varsHandler(opts.Cfg))
	mux.HandleFunc("/api/traces", tracesHandler(opts.OTel))
	mux.HandleFunc("/api/otel-metrics", otelMetricsHandler(opts.OTelMetrics))

	if opts.SQLite != nil {
		mux.HandleFunc("/api/sqlite/tables", sqliteTablesHandler(opts.SQLite))
		mux.HandleFunc("/api/sqlite/query", sqliteQueryHandler(opts.SQLite))
		mux.HandleFunc("/api/sqlite/exec", sqliteExecHandler(opts.SQLite))
	} else {
		unavailable := func(w http.ResponseWriter, r *http.Request) {
			jsonErr(w, ".spin/sqlite_db.db not found — start spin at least once to create it", http.StatusNotFound)
		}
		mux.HandleFunc("/api/sqlite/tables", unavailable)
		mux.HandleFunc("/api/sqlite/query", unavailable)
		mux.HandleFunc("/api/sqlite/exec", unavailable)
	}

	if opts.KV != nil {
		mux.HandleFunc("/api/kv", func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				kvListHandler(opts.KV)(w, r)
			case http.MethodPost:
				kvUpsertHandler(opts.KV)(w, r)
			default:
				jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		})
		mux.HandleFunc("/api/kv/", kvDeleteHandler(opts.KV))
	} else {
		unavailable := func(w http.ResponseWriter, r *http.Request) {
			jsonErr(w, ".spin/sqlite_key_value.db not found — start spin at least once to create it", http.StatusNotFound)
		}
		mux.HandleFunc("/api/kv", unavailable)
		mux.HandleFunc("/api/kv/", unavailable)
	}

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
