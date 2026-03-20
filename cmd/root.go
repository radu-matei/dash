package cmd

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/pkg/browser"
	"github.com/spf13/cobra"
	"github.com/spinframework/dash/internal/config"
	"github.com/spinframework/dash/internal/kvexplorer"
	"github.com/spinframework/dash/internal/otel"
	"github.com/spinframework/dash/internal/process"
	"github.com/spinframework/dash/internal/server"
)

var (
	port           int
	noOpen         bool
	otelPort       int
	otelForwardTo  string
	allowEdits bool
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
	rootCmd.Flags().StringVar(&otelForwardTo, "otel-forward-to", "", "forward all received OTLP data to this base URL (e.g. http://localhost:4317) for cross-app trace stitching in a shared backend")
	rootCmd.Flags().BoolVar(&allowEdits, "allow-edits", false, "allow the dashboard to modify spin.toml (add/remove components, variables, bindings)")
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

	// Apply SPIN_VARIABLE_* environment variable overrides.
	// Priority: spin.toml < .env < SPIN_VARIABLE_* < --variable (highest)
	envOverrides := collectSpinVarEnv()
	config.ApplyOverrides(cfg, envOverrides, "SPIN_VARIABLE")

	// Apply --variable flag overrides and capture --listen address from the
	// extra args that will be forwarded to 'spin up'.
	cliOverrides, listenAddr := parseSpinArgs(args)
	config.ApplyOverrides(cfg, cliOverrides, "--variable")
	cfg.ListenAddr = listenAddr

	fmt.Printf("▶  Spin Dashboard — app: %s\n", cfg.Name)

	// SSE hub for log streaming.
	hub := server.NewHub()

	// OTel receivers — optionally forward raw payloads to a shared upstream
	// collector so multiple dashboard instances can stitch cross-app traces.
	otelReceiver := otel.NewReceiver(otelForwardTo)
	metricsReceiver := otel.NewMetricsReceiver(500, otelForwardTo)

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

	// Always use a temporary manifest so the KV explorer component can be
	// injected (or removed) on any restart without changing the runner args.
	// The BeforeStart hook regenerates the manifest before each start,
	// picking up newly added (or removed) KV bindings.
	manifestPath := kvexplorer.ManifestPath(cwd)
	spinArgs := append([]string{"up", "--from", manifestPath}, args...)

	kvStores := kvexplorer.CollectKVStores(cfg)
	if len(kvStores) > 0 {
		if _, err := kvexplorer.InjectManifest(cwd, kvStores); err != nil {
			fmt.Fprintf(os.Stderr, "warning: KV explorer injection failed: %v\n", err)
		} else {
			fmt.Printf("▶  KV Explorer: enabled (stores: %s)\n", strings.Join(kvStores, ", "))
		}
	} else {
		// No KV stores yet — write a plain copy so --from has a valid target.
		kvexplorer.CopyManifest(cwd)
	}

	// Build the child process runner.
	runner := process.New(spinBin, spinArgs, extraEnv, hub.Publish)

	// On every (re)start, regenerate the temp manifest so it picks up any
	// config changes (e.g. newly added KV bindings).
	runner.BeforeStart = func() error {
		stores := kvexplorer.CollectKVStores(cfg)
		if len(stores) > 0 {
			_, err := kvexplorer.InjectManifest(cwd, stores)
			return err
		}
		// No stores — just copy spin.toml as-is.
		return kvexplorer.CopyManifest(cwd)
	}

	// Set up the HTTP mux.
	if allowEdits {
		fmt.Println("▶  Edits:      enabled (--allow-edits)")
	}

	mux, err := server.New(server.Options{
		Port:           port,
		Hub:            hub,
		Runner:         runner,
		OTel:           otelReceiver,
		OTelMetrics:    metricsReceiver,
		Cfg:            cfg,
		Dir:            cwd,
		SpinBin:        spinBin,
		EnvOverrides:   envOverrides,
		CliOverrides:   cliOverrides,
		AllowMutations: allowEdits,
		CommitSHA:      CommitSHA,
	})
	if err != nil {
		return fmt.Errorf("setting up server: %w", err)
	}

	// Pre-bind both listeners before starting spin so that the OTel SDK inside
	// spin never gets "connection refused" due to a startup race.  Using
	// net.Listen + srv.Serve guarantees the ports are accepting connections
	// before runner.Start() is called.
	otelLn, err := net.Listen("tcp", fmt.Sprintf(":%d", otelPort))
	if err != nil {
		return fmt.Errorf("cannot bind OTLP port %d (is another dashboard instance running?): %w", otelPort, err)
	}
	dashLn, err := net.Listen("tcp", server.Addr(port))
	if err != nil {
		_ = otelLn.Close()
		return fmt.Errorf("cannot bind dashboard port %d: %w", port, err)
	}

	// Start OTLP HTTP receiver on its own mux.
	// Accept /v1/logs and /v1/metrics with a no-op 200 to silence SDK errors;
	// only /v1/traces is parsed and surfaced in the UI.
	otelMux := http.NewServeMux()
	otelMux.HandleFunc("/v1/traces", otelReceiver.HandleOTLP)
	otelMux.HandleFunc("/v1/metrics", metricsReceiver.HandleOTLP)
	otelMux.HandleFunc("/v1/logs", func(w http.ResponseWriter, r *http.Request) {
		if otelForwardTo != "" {
			body, _ := io.ReadAll(r.Body)
			go forwardOTLP(strings.TrimRight(otelForwardTo, "/")+"/v1/logs", r.Header.Get("Content-Type"), body)
		}
		w.WriteHeader(http.StatusOK)
	})

	otelSrv := &http.Server{Handler: otelMux}
	go func() {
		if err := otelSrv.Serve(otelLn); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "otel receiver error: %v\n", err)
		}
	}()

	// Start main dashboard HTTP server.
	dashSrv := &http.Server{Handler: mux}
	go func() {
		if err := dashSrv.Serve(dashLn); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "dashboard server error: %v\n", err)
		}
	}()

	dashURL := fmt.Sprintf("http://localhost:%d", port)
	fmt.Printf("▶  Dashboard:  %s\n", dashURL)
	fmt.Printf("▶  OTLP:       %s\n", otelEndpoint)
	if otelForwardTo != "" {
		fmt.Printf("▶  Forwarding: %s\n", otelForwardTo)
	}
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

	// Clean up the temporary KV explorer manifest.
	kvexplorer.Cleanup(cwd)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = dashSrv.Shutdown(ctx)
	_ = otelSrv.Shutdown(ctx)

	return nil
}

// collectSpinVarEnv reads all SPIN_VARIABLE_<NAME>=value environment variables
// and returns them as a lowercase-keyed map.
func collectSpinVarEnv() map[string]string {
	out := make(map[string]string)
	for _, env := range os.Environ() {
		const prefix = "SPIN_VARIABLE_"
		if !strings.HasPrefix(env, prefix) {
			continue
		}
		rest := strings.TrimPrefix(env, prefix)
		idx := strings.IndexByte(rest, '=')
		if idx < 0 {
			continue
		}
		// SPIN_VARIABLE_VERTEX_AI_PROJECT → vertex_ai_project
		key := strings.ToLower(rest[:idx])
		out[key] = rest[idx+1:]
	}
	return out
}

// parseSpinArgs scans the extra args forwarded to 'spin up' and extracts:
//   - --variable key=value  (also -v key=value)
//   - --listen address
func parseSpinArgs(args []string) (varOverrides map[string]string, listenAddr string) {
	varOverrides = make(map[string]string)
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--variable" || arg == "-v":
			if i+1 < len(args) {
				i++
				if k, v, ok := strings.Cut(args[i], "="); ok {
					varOverrides[k] = v
				}
			}
		case strings.HasPrefix(arg, "--variable="):
			rest := strings.TrimPrefix(arg, "--variable=")
			if k, v, ok := strings.Cut(rest, "="); ok {
				varOverrides[k] = v
			}
		case arg == "--listen":
			if i+1 < len(args) {
				i++
				listenAddr = normalizeListenAddr(args[i])
			}
		case strings.HasPrefix(arg, "--listen="):
			listenAddr = normalizeListenAddr(strings.TrimPrefix(arg, "--listen="))
		}
	}
	return
}

// forwardOTLP fires a best-effort POST of body to url.  Used for /v1/logs
// which has no dedicated receiver struct but still needs forwarding.
func forwardOTLP(url, contentType string, body []byte) {
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}

// normalizeListenAddr converts a spin --listen value like "0.0.0.0:3002" or
// ":3002" into a browser-navigable URL like "http://localhost:3002".
func normalizeListenAddr(addr string) string {
	addr = strings.ReplaceAll(addr, "0.0.0.0", "localhost")
	if strings.HasPrefix(addr, ":") {
		addr = "localhost" + addr
	}
	if !strings.HasPrefix(addr, "http://") && !strings.HasPrefix(addr, "https://") {
		addr = "http://" + addr
	}
	return addr
}
