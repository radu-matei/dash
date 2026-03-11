package server

import (
	"encoding/json"
	"net/http"

	"github.com/spinframework/dash/internal/config"
	"github.com/spinframework/dash/internal/otel"
	"github.com/spinframework/dash/internal/process"
)

func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// statusHandler returns the current child-process state.
func statusHandler(runner *process.Runner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jsonOK(w, map[string]string{
			"status": runner.Status().String(),
			"error":  runner.LastError(),
		})
	}
}

// appHandler returns the full application structure (components, triggers, vars, status).
func appHandler(cfg *config.AppConfig, runner *process.Runner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Prefer the address spin announced at runtime ("Serving http://...") over
		// the static address derived from the --listen flag, since spin may not
		// have been started with an explicit --listen.
		listenAddr := runner.ListenAddr()
		if listenAddr == "" {
			listenAddr = cfg.ListenAddr
		}
		jsonOK(w, map[string]interface{}{
			"name":        cfg.Name,
			"description": cfg.Description,
			"status":      runner.Status().String(),
			"error":       runner.LastError(),
			"components":  cfg.Components,
			"triggers":    cfg.Triggers,
			"varCount":    len(cfg.Variables),
			"listenAddr":  listenAddr,
		})
	}
}

// varsHandler returns the merged spin.toml + .env variable list.
func varsHandler(cfg *config.AppConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jsonOK(w, cfg.Variables)
	}
}

// tracesHandler returns the collected OTel span summaries.
func tracesHandler(recv *otel.Receiver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jsonOK(w, recv.Spans())
	}
}

// otelMetricsHandler returns all received OTel metric series.
func otelMetricsHandler(recv *otel.MetricsReceiver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jsonOK(w, recv.Series())
	}
}
