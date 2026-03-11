package cmd

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/pkg/browser"
	"github.com/spf13/cobra"
	"github.com/spinframework/dash/internal/config"
	"github.com/spinframework/dash/internal/db"
	"github.com/spinframework/dash/internal/otel"
	"github.com/spinframework/dash/internal/process"
	"github.com/spinframework/dash/internal/server"
)

var (
	port    int
	noOpen  bool
	otelPort int
)

var rootCmd = &cobra.Command{
	Use:   "dashboard [-- spin-flags...]",
	Short: "Local developer dashboard for Spin applications",
	Long: `spin dashboard wraps 'spin up' and opens a local web UI for inspecting,
manipulating, and observing your Spin application.

Run inside a directory containing a spin.toml file. Pass additional flags
to 'spin up' after the '--' separator.`,
	RunE: run,
}

// Execute is the package-level entry point called from main.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	rootCmd.Flags().IntVar(&port, "port", 3001, "port for the dashboard HTTP server")
	rootCmd.Flags().IntVar(&otelPort, "otel-port", 4318, "port for the built-in OTLP receiver")
	rootCmd.Flags().BoolVar(&noOpen, "no-open", false, "do not open the browser automatically")
}

func run(cmd *cobra.Command, args []string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("getting working directory: %w", err)
	}

	// Verify spin.toml exists.
	if _, err := os.Stat(filepath.Join(cwd, "spin.toml")); os.IsNotExist(err) {
		return fmt.Errorf("no spin.toml found in %s — run 'spin dashboard' from your Spin app directory", cwd)
	}

	// Parse spin.toml + .env.
	cfg, err := config.Load(cwd)
	if err != nil {
		return fmt.Errorf("loading spin.toml: %w", err)
	}

	fmt.Printf("▶  Spin Dashboard — app: %s\n", cfg.Name)

	// SSE hub for log streaming.
	hub := server.NewHub()

	// OTel receivers.
	otelReceiver := otel.NewReceiver()
	metricsReceiver := otel.NewMetricsReceiver(500)

	// Open .spin/ databases (best-effort; the .spin dir may not exist yet).
	spinDir := filepath.Join(cwd, ".spin")
	var sqliteDB *db.SQLiteDB
	var kvDB *db.KVDB

	sqlitePath := filepath.Join(spinDir, "sqlite_db.db")
	if _, err := os.Stat(sqlitePath); err == nil {
		if sdb, err := db.OpenSQLite(sqlitePath); err == nil {
			sqliteDB = sdb
			defer sdb.Close()
		} else {
			fmt.Fprintf(os.Stderr, "warning: could not open sqlite_db.db: %v\n", err)
		}
	}

	kvPath := filepath.Join(spinDir, "sqlite_key_value.db")
	if _, err := os.Stat(kvPath); err == nil {
		if kdb, err := db.OpenKV(kvPath); err == nil {
			kvDB = kdb
			defer kdb.Close()
		} else {
			fmt.Fprintf(os.Stderr, "warning: could not open sqlite_key_value.db: %v\n", err)
		}
	}

	// Locate the spin binary.
	spinBin := os.Getenv("SPIN_BIN_PATH")
	if spinBin == "" {
		spinBin = "spin"
	}

	// Build the environment injection for OTel.
	// Use http/protobuf (the OTLP default) — Spin does not support http/json.
	otelEndpoint := fmt.Sprintf("http://localhost:%d", otelPort)
	extraEnv := []string{
		"OTEL_EXPORTER_OTLP_ENDPOINT=" + otelEndpoint,
		"OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf",
	}

	// Build the child process runner.
	runner := process.New(spinBin, append([]string{"up"}, args...), extraEnv, hub.Publish)

	// Set up the HTTP mux.
	mux, err := server.New(server.Options{
		Port:        port,
		AppDir:      cwd,
		Hub:         hub,
		Runner:      runner,
		OTel:        otelReceiver,
		OTelMetrics: metricsReceiver,
		Cfg:         cfg,
		SQLite:      sqliteDB,
		KV:          kvDB,
	})
	if err != nil {
		return fmt.Errorf("setting up server: %w", err)
	}

	// Start OTLP HTTP receiver on its own mux.
	// Accept /v1/logs and /v1/metrics with a no-op 200 to silence SDK errors;
	// only /v1/traces is parsed and surfaced in the UI.
	otelMux := http.NewServeMux()
	otelMux.HandleFunc("/v1/traces", otelReceiver.HandleOTLP)
	otelMux.HandleFunc("/v1/metrics", metricsReceiver.HandleOTLP)
	otelMux.HandleFunc("/v1/logs", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	otelSrv := &http.Server{
		Addr:    fmt.Sprintf(":%d", otelPort),
		Handler: otelMux,
	}
	go func() {
		if err := otelSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "otel receiver error: %v\n", err)
		}
	}()

	// Start main dashboard HTTP server.
	dashSrv := &http.Server{
		Addr:    server.Addr(port),
		Handler: mux,
	}
	go func() {
		if err := dashSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "dashboard server error: %v\n", err)
		}
	}()

	dashURL := fmt.Sprintf("http://localhost:%d", port)
	fmt.Printf("▶  Dashboard:  %s\n", dashURL)
	fmt.Printf("▶  OTLP:       %s\n", otelEndpoint)
	fmt.Println("▶  Press Ctrl+C to stop")

	// Start spin up.
	if err := runner.Start(); err != nil {
		hub.Publish("system", fmt.Sprintf("failed to start spin: %v", err))
		fmt.Fprintf(os.Stderr, "warning: spin up failed to start: %v\n", err)
	}

	// Open browser after a short delay to let the server bind.
	if !noOpen {
		go func() {
			time.Sleep(500 * time.Millisecond)
			_ = browser.OpenURL(dashURL)
		}()
	}

	// Wait for shutdown signal.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	fmt.Println("\n▶  Shutting down…")
	runner.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = dashSrv.Shutdown(ctx)
	_ = otelSrv.Shutdown(ctx)

	return nil
}
