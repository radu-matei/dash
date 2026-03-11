package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/BurntSushi/toml"
	"github.com/spinframework/dash/internal/config"
	"github.com/spinframework/dash/internal/otel"
	"github.com/spinframework/dash/internal/process"
)

func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
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
func appHandler(cfg *config.AppConfig, cfgMu *sync.RWMutex, runner *process.Runner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		listenAddr := runner.ListenAddr()
		if listenAddr == "" {
			listenAddr = cfg.ListenAddr
		}

		cfgMu.RLock()
		defer cfgMu.RUnlock()

		// Collect only variables truly declared in [variables] (Declared=true).
		// Synthesised entries (keys found in component bindings but absent from
		// [variables]) are intentionally excluded — they are component-level
		// bindings, not app-level declarations available to wire to other components.
		varKeys := make([]string, 0, len(cfg.Variables))
		for _, v := range cfg.Variables {
			if v.Declared {
				varKeys = append(varKeys, v.Key)
			}
		}

		jsonOK(w, map[string]interface{}{
			"name":         cfg.Name,
			"description":  cfg.Description,
			"status":       runner.Status().String(),
			"error":        runner.LastError(),
			"components":   cfg.Components,
			"triggers":     cfg.Triggers,
			"varCount":     len(varKeys), // only declared [variables] entries
			"variableKeys": varKeys,
			"listenAddr":   listenAddr,
		})
	}
}

// varsHandler returns the merged spin.toml + .env variable list.
func varsHandler(cfg *config.AppConfig, cfgMu *sync.RWMutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cfgMu.RLock()
		defer cfgMu.RUnlock()
		// Only return variables truly declared in [variables].
		// Synthesised entries (keys found only inside component bindings) are
		// component-level implementation details and do not belong here.
		declared := make([]config.VarEntry, 0, len(cfg.Variables))
		for _, v := range cfg.Variables {
			if v.Declared {
				declared = append(declared, v)
			}
		}
		jsonOK(w, declared)
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

// ── Mutation handlers ─────────────────────────────────────────────────────────

// isHTTPTemplate reports whether the template produces an HTTP-triggered component.
// All http-* templates do; redis-*, mqtt-* etc. do not.
func isHTTPTemplate(template string) bool {
	return strings.HasPrefix(template, "http-") ||
		template == "static-fileserver" ||
		template == "redirect" ||
		template == "nextjs-frontend" ||
		template == "spin-reactjs"
}

// addComponentHandler runs `spin add -t <template> <name> --accept-defaults`
// in the Spin app directory, then reloads the in-memory config.
//
// For HTTP templates the caller MUST supply a unique `route`. The handler
// passes it via `--value http-path=<route>` so the generated spin.toml does
// not default to `/...` and collide with existing components.
//
// A new component's Wasm binary doesn't exist yet, so Spin won't be restarted
// automatically. The response instructs the user to run `spin build` first.
func addComponentHandler(opts *Options, cfgMu *sync.RWMutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErr(w, http.StatusMethodNotAllowed, "POST required")
			return
		}

		var req struct {
			Template string `json:"template"`
			Name     string `json:"name"`
			Route    string `json:"route"` // required for HTTP templates, e.g. "/api/..."
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		if req.Template == "" || req.Name == "" {
			jsonErr(w, http.StatusBadRequest, "template and name are required")
			return
		}
		if !validIdentifier(req.Name) {
			jsonErr(w, http.StatusBadRequest, "name must be lowercase letters, digits, and hyphens only (no spaces)")
			return
		}

		// Validate the HTTP route.
		needsRoute := isHTTPTemplate(req.Template)
		if needsRoute {
			if req.Route == "" {
				jsonErr(w, http.StatusBadRequest, "route is required for HTTP templates (e.g. /api/...)")
				return
			}
			if !strings.HasPrefix(req.Route, "/") {
				jsonErr(w, http.StatusBadRequest, "route must start with /")
				return
			}
		}

		// Guard: component name must be unique.
		cfgMu.RLock()
		for _, c := range opts.Cfg.Components {
			if c.ID == req.Name {
				cfgMu.RUnlock()
				jsonErr(w, http.StatusConflict,
					fmt.Sprintf("component %q already exists in spin.toml", req.Name))
				return
			}
		}
		// Guard: HTTP route must not conflict with an existing trigger route.
		if needsRoute {
			for _, t := range opts.Cfg.Triggers {
				if t.Type == "http" && t.Route == req.Route {
					cfgMu.RUnlock()
					jsonErr(w, http.StatusConflict,
						fmt.Sprintf("HTTP route %q is already used by component %q — choose a different route", req.Route, t.Component))
					return
				}
			}
		}
		cfgMu.RUnlock()

		// Build the `spin add` command, injecting the route via --value so
		// the generated [[trigger.http]] uses the caller-supplied path instead
		// of the template default (/...).
		args := []string{"add", "-t", req.Template, req.Name, "--accept-defaults", "--no-vcs"}
		if needsRoute {
			args = append(args, "--value", "http-path="+req.Route)
		}

		cmd := exec.Command(opts.SpinBin, args...)
		cmd.Dir = opts.Dir
		cmd.Env = append(os.Environ(), "NO_COLOR=1")

		out, err := cmd.CombinedOutput()
		if err != nil {
			jsonErr(w, http.StatusInternalServerError,
				fmt.Sprintf("spin add failed: %v\n%s", err, strings.TrimSpace(string(out))))
			return
		}

		// Reload cfg so /api/app reflects the new component immediately.
		cfgMu.Lock()
		_ = opts.Cfg.Reload(opts.EnvOverrides, opts.CliOverrides)
		cfgMu.Unlock()

		// Run `spin build` in the background, streaming output to the log hub,
		// then restart `spin up` so the new component is live.
		go func() {
			opts.Hub.Publish("system", fmt.Sprintf("▶  Building after spin add %q…", req.Name))

			buildCmd := exec.Command(opts.SpinBin, "build")
			buildCmd.Dir = opts.Dir
			buildCmd.Env = append(os.Environ(), "NO_COLOR=1")

			stdoutPipe, _ := buildCmd.StdoutPipe()
			stderrPipe, _ := buildCmd.StderrPipe()

			if startErr := buildCmd.Start(); startErr != nil {
				opts.Hub.Publish("system", "▶  spin build failed to start: "+startErr.Error())
				return
			}

			streamToHub := func(pipe interface{ Read([]byte) (int, error) }, stream string) {
				buf := make([]byte, 4096)
				var pending string
				for {
					n, readErr := pipe.Read(buf)
					if n > 0 {
						pending += string(buf[:n])
						for {
							idx := strings.IndexByte(pending, '\n')
							if idx < 0 {
								break
							}
							opts.Hub.Publish(stream, strings.TrimRight(pending[:idx], "\r"))
							pending = pending[idx+1:]
						}
					}
					if readErr != nil {
						if pending != "" {
							opts.Hub.Publish(stream, strings.TrimRight(pending, "\r"))
						}
						return
					}
				}
			}

			go streamToHub(stdoutPipe, "stdout")
			go streamToHub(stderrPipe, "stderr")

			if waitErr := buildCmd.Wait(); waitErr != nil {
				opts.Hub.Publish("system", fmt.Sprintf("▶  spin build failed: %v — fix errors and click Restart.", waitErr))
				return
			}

			opts.Hub.Publish("system", "▶  spin build succeeded — restarting Spin…")
			if restartErr := opts.Runner.Restart(); restartErr != nil {
				opts.Hub.Publish("system", "▶  restart failed: "+restartErr.Error())
			}
		}()

		jsonOK(w, map[string]string{
			"message": fmt.Sprintf(
				"Component %q added. Building in background — watch the Logs tab for progress.",
				req.Name,
			),
		})
	}
}

// addVariableHandler adds a new entry to [variables] in spin.toml and
// optionally wires it into the [component.<id>.variables] section of each
// component listed in componentIds. It then restarts Spin.
//
// PatchAddVariable returns an error when the variable already exists (duplicate
// TOML keys are invalid), so this handler is safe to call repeatedly.
func addVariableHandler(opts *Options, cfgMu *sync.RWMutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErr(w, http.StatusMethodNotAllowed, "POST required")
			return
		}

		var req struct {
			Name         string   `json:"name"`
			DefaultValue string   `json:"defaultValue"`
			Required     bool     `json:"required"`
			Secret       bool     `json:"secret"`
			ComponentIDs []string `json:"componentIds"` // wire to these components
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		if req.Name == "" {
			jsonErr(w, http.StatusBadRequest, "name is required")
			return
		}
		if !validVarName(req.Name) {
			jsonErr(w, http.StatusBadRequest, "name must be lowercase letters, digits, and underscores (start with letter/underscore)")
			return
		}

		// PatchAddVariable guards against duplicate keys.
		if err := config.PatchAddVariable(opts.Dir, req.Name, req.Required, req.DefaultValue, req.Secret); err != nil {
			jsonErr(w, http.StatusConflict, err.Error())
			return
		}

		// Wire the variable into each requested component using mustache syntax.
		// e.g.  token = "{{ api_token }}"
		varValue := fmt.Sprintf("{{ %s }}", req.Name)
		for _, compID := range req.ComponentIDs {
			if err := config.PatchAddComponentVariable(opts.Dir, compID, req.Name, varValue); err != nil {
				// Non-fatal: report but continue with the other components.
				fmt.Fprintf(os.Stderr, "warning: wiring variable %q to component %q: %v\n", req.Name, compID, err)
			}
		}

		cfgMu.Lock()
		_ = opts.Cfg.Reload(opts.EnvOverrides, opts.CliOverrides)
		cfgMu.Unlock()

		go func() { _ = opts.Runner.Restart() }()

		wiredMsg := ""
		if len(req.ComponentIDs) > 0 {
			wiredMsg = fmt.Sprintf(" Wired to: %s.", strings.Join(req.ComponentIDs, ", "))
		}
		jsonOK(w, map[string]string{
			"message": fmt.Sprintf("Variable %q added to spin.toml.%s Spin is restarting.", req.Name, wiredMsg),
		})
	}
}

// addBindingHandler adds a KV store or SQLite database binding to a component
// in spin.toml and restarts the Spin process.
func addBindingHandler(opts *Options, cfgMu *sync.RWMutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErr(w, http.StatusMethodNotAllowed, "POST required")
			return
		}

		var req struct {
			ComponentID string `json:"componentId"`
			Type        string `json:"type"`      // "kv" | "sqlite"
			StoreName   string `json:"storeName"` // store / db name
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		if req.ComponentID == "" || req.StoreName == "" {
			jsonErr(w, http.StatusBadRequest, "componentId and storeName are required")
			return
		}

		var added bool
		var patchErr error
		switch req.Type {
		case "kv":
			added, patchErr = config.PatchAddKVBinding(opts.Dir, req.ComponentID, req.StoreName)
		case "sqlite":
			added, patchErr = config.PatchAddSQLiteBinding(opts.Dir, req.ComponentID, req.StoreName)
		default:
			jsonErr(w, http.StatusBadRequest, `type must be "kv" or "sqlite"`)
			return
		}
		if patchErr != nil {
			jsonErr(w, http.StatusInternalServerError, patchErr.Error())
			return
		}
		if !added {
			jsonErr(w, http.StatusConflict,
				fmt.Sprintf("component %q already has %s binding %q", req.ComponentID, strings.ToUpper(req.Type), req.StoreName))
			return
		}

		cfgMu.Lock()
		_ = opts.Cfg.Reload(opts.EnvOverrides, opts.CliOverrides)
		cfgMu.Unlock()

		go func() { _ = opts.Runner.Restart() }()

		jsonOK(w, map[string]string{
			"message": fmt.Sprintf(
				"%s binding %q added to component %q. Spin is restarting.",
				strings.ToUpper(req.Type), req.StoreName, req.ComponentID,
			),
		})
	}
}

// restartHandler stops and restarts the Spin child process on demand.
func restartHandler(runner *process.Runner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErr(w, http.StatusMethodNotAllowed, "POST required")
			return
		}
		go func() { _ = runner.Restart() }()
		jsonOK(w, map[string]string{"message": "Spin is restarting."})
	}
}

// spinTomlHandler handles GET (read raw file) and POST (write + validate + restart).
func spinTomlHandler(opts *Options, cfgMu *sync.RWMutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tomlPath := filepath.Join(opts.Dir, "spin.toml")

		switch r.Method {
		case http.MethodGet:
			content, err := os.ReadFile(tomlPath)
			if err != nil {
				jsonErr(w, http.StatusInternalServerError, "reading spin.toml: "+err.Error())
				return
			}
			jsonOK(w, map[string]string{"content": string(content)})

		case http.MethodPost:
			var req struct {
				Content string `json:"content"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
				return
			}

			// Validate: must be parseable TOML before touching disk.
			var tmp interface{}
			if _, err := toml.NewDecoder(bytes.NewBufferString(req.Content)).Decode(&tmp); err != nil {
				jsonErr(w, http.StatusUnprocessableEntity, "TOML syntax error: "+err.Error())
				return
			}

			if err := os.WriteFile(tomlPath, []byte(req.Content), 0o644); err != nil {
				jsonErr(w, http.StatusInternalServerError, "writing spin.toml: "+err.Error())
				return
			}

			cfgMu.Lock()
			_ = opts.Cfg.Reload(opts.EnvOverrides, opts.CliOverrides)
			cfgMu.Unlock()

			go func() { _ = opts.Runner.Restart() }()

			jsonOK(w, map[string]string{"message": "spin.toml saved. Spin is restarting."})

		default:
			jsonErr(w, http.StatusMethodNotAllowed, "GET or POST required")
		}
	}
}

// removeBindingHandler removes a KV or SQLite binding from a component in
// spin.toml, then restarts Spin.
func removeBindingHandler(opts *Options, cfgMu *sync.RWMutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErr(w, http.StatusMethodNotAllowed, "POST required")
			return
		}

		var req struct {
			ComponentID string `json:"componentId"`
			Type        string `json:"type"`      // "kv" or "sqlite"
			StoreName   string `json:"storeName"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		if req.ComponentID == "" || req.StoreName == "" {
			jsonErr(w, http.StatusBadRequest, "componentId and storeName are required")
			return
		}
		if req.Type != "kv" && req.Type != "sqlite" {
			jsonErr(w, http.StatusBadRequest, `type must be "kv" or "sqlite"`)
			return
		}

		var (
			removed bool
			err     error
		)
		if req.Type == "kv" {
			removed, err = config.PatchRemoveKVBinding(opts.Dir, req.ComponentID, req.StoreName)
		} else {
			removed, err = config.PatchRemoveSQLiteBinding(opts.Dir, req.ComponentID, req.StoreName)
		}
		if err != nil {
			jsonErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !removed {
			jsonErr(w, http.StatusNotFound,
				fmt.Sprintf("%q binding %q not found on component %q", req.Type, req.StoreName, req.ComponentID))
			return
		}

		cfgMu.Lock()
		_ = opts.Cfg.Reload(opts.EnvOverrides, opts.CliOverrides)
		cfgMu.Unlock()

		go func() { _ = opts.Runner.Restart() }()

		jsonOK(w, map[string]string{
			"message": fmt.Sprintf("Binding %q removed from %q. Spin is restarting.", req.StoreName, req.ComponentID),
		})
	}
}

// addComponentVariableHandler wires an existing [variables] entry to a
// component by writing `varName = "{{ varName }}"` into
// [component.<id>.variables] in spin.toml, then restarting Spin.
func addComponentVariableHandler(opts *Options, cfgMu *sync.RWMutex) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErr(w, http.StatusMethodNotAllowed, "POST required")
			return
		}

		var req struct {
			ComponentID string `json:"componentId"`
			VarName     string `json:"varName"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		if req.ComponentID == "" || req.VarName == "" {
			jsonErr(w, http.StatusBadRequest, "componentId and varName are required")
			return
		}

		// Validate that the variable is declared in [variables] (not just a
		// synthesised entry from a component binding in another component).
		cfgMu.RLock()
		varExists := false
		for _, v := range opts.Cfg.Variables {
			if v.Key == req.VarName && v.Declared {
				varExists = true
				break
			}
		}
		// Also ensure the component exists.
		compExists := false
		for _, c := range opts.Cfg.Components {
			if c.ID == req.ComponentID {
				compExists = true
				// Guard: already wired?
				if _, alreadyWired := c.Variables[req.VarName]; alreadyWired {
					cfgMu.RUnlock()
					jsonErr(w, http.StatusConflict,
						fmt.Sprintf("variable %q is already wired to component %q", req.VarName, req.ComponentID))
					return
				}
				break
			}
		}
		cfgMu.RUnlock()

		if !varExists {
			jsonErr(w, http.StatusBadRequest,
				fmt.Sprintf("variable %q is not declared in [variables] — add it first", req.VarName))
			return
		}
		if !compExists {
			jsonErr(w, http.StatusBadRequest,
				fmt.Sprintf("component %q not found in spin.toml", req.ComponentID))
			return
		}

		varValue := fmt.Sprintf("{{ %s }}", req.VarName)
		if err := config.PatchAddComponentVariable(opts.Dir, req.ComponentID, req.VarName, varValue); err != nil {
			jsonErr(w, http.StatusInternalServerError, err.Error())
			return
		}

		cfgMu.Lock()
		_ = opts.Cfg.Reload(opts.EnvOverrides, opts.CliOverrides)
		cfgMu.Unlock()

		go func() { _ = opts.Runner.Restart() }()

		jsonOK(w, map[string]string{
			"message": fmt.Sprintf("Variable %q wired to component %q. Spin is restarting.", req.VarName, req.ComponentID),
		})
	}
}

// ── Validation helpers ────────────────────────────────────────────────────────

var (
	reIdentifier = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)
	reVarName    = regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)
)

func validIdentifier(s string) bool { return reIdentifier.MatchString(s) }
func validVarName(s string) bool    { return reVarName.MatchString(s) }
