package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/spinframework/dash/internal/config"
	"github.com/spinframework/dash/internal/process"
)

// HurlTestFile represents a discovered .hurl test file.
type HurlTestFile struct {
	Name    string `json:"name"`
	Path    string `json:"path"` // relative to project root
	Dir     string `json:"dir"`
	Content string `json:"content,omitempty"`
}

// HurlRunResult is returned after executing a hurl test.
type HurlRunResult struct {
	Success     bool   `json:"success"`
	Output      string `json:"output"`
	DurationMs  int64  `json:"durationMs"`
	StartTimeMs int64  `json:"startTimeMs"`
	EndTimeMs   int64  `json:"endTimeMs"`
	File        string `json:"file"`
	ExitCode    int    `json:"exitCode"`
}

// skipDirs contains directories we skip when scanning for .hurl files.
var skipDirs = map[string]bool{
	".git": true, "node_modules": true, "target": true, ".spin": true,
	"__pycache__": true, "dist": true, "build": true, ".venv": true,
	"venv": true, ".next": true,
}

// hurlTestsHandler serves GET /api/hurl-tests — discovers all .hurl files in the project.
func hurlTestsHandler(dir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			jsonErr(w, http.StatusMethodNotAllowed, "GET required")
			return
		}

		var files []HurlTestFile
		_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if info.IsDir() {
				if skipDirs[info.Name()] {
					return filepath.SkipDir
				}
				return nil
			}
			if strings.HasSuffix(info.Name(), ".hurl") {
				relPath, _ := filepath.Rel(dir, path)
				files = append(files, HurlTestFile{
					Name: info.Name(),
					Path: relPath,
					Dir:  filepath.Dir(relPath),
				})
			}
			return nil
		})

		if files == nil {
			files = []HurlTestFile{}
		}

		// Check if hurl is available.
		hurlInstalled := isHurlInstalled()

		jsonOK(w, map[string]interface{}{
			"files":         files,
			"hurlInstalled": hurlInstalled,
			"defaultDir":    "tests",
		})
	}
}

// hurlFileHandler serves GET/POST /api/hurl-file — reads or writes a .hurl file.
// Writing (POST) requires allowMutations; reading (GET) is always permitted.
func hurlFileHandler(dir string, allowMutations bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			relPath := r.URL.Query().Get("path")
			if relPath == "" {
				jsonErr(w, http.StatusBadRequest, "path query parameter is required")
				return
			}
			if !isSafePath(relPath) {
				jsonErr(w, http.StatusBadRequest, "invalid path")
				return
			}

			absPath := filepath.Join(dir, relPath)
			content, err := os.ReadFile(absPath)
			if err != nil {
				jsonErr(w, http.StatusNotFound, "file not found: "+relPath)
				return
			}

			jsonOK(w, HurlTestFile{
				Name:    filepath.Base(relPath),
				Path:    relPath,
				Dir:     filepath.Dir(relPath),
				Content: string(content),
			})

		case http.MethodPost:
			if !allowMutations {
				jsonErr(w, http.StatusForbidden, "edits are disabled; restart the dashboard with --allow-edits to enable them")
				return
			}
			var req struct {
				Path    string `json:"path"`
				Content string `json:"content"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
				return
			}
			if req.Path == "" || req.Content == "" {
				jsonErr(w, http.StatusBadRequest, "path and content are required")
				return
			}
			if !isSafePath(req.Path) {
				jsonErr(w, http.StatusBadRequest, "invalid path")
				return
			}
			if !strings.HasSuffix(req.Path, ".hurl") {
				req.Path += ".hurl"
			}

			absPath := filepath.Join(dir, req.Path)

			// Create parent directory if it doesn't exist.
			if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
				jsonErr(w, http.StatusInternalServerError, "creating directory: "+err.Error())
				return
			}

			if err := os.WriteFile(absPath, []byte(req.Content), 0o644); err != nil {
				jsonErr(w, http.StatusInternalServerError, "writing file: "+err.Error())
				return
			}

			jsonOK(w, map[string]string{
				"message": fmt.Sprintf("Saved %s", req.Path),
				"path":    req.Path,
			})

		default:
			jsonErr(w, http.StatusMethodNotAllowed, "GET or POST required")
		}
	}
}

// hurlRunHandler serves POST /api/hurl-run — executes a hurl test file.
func hurlRunHandler(dir string, runner *process.Runner, cfg *config.AppConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErr(w, http.StatusMethodNotAllowed, "POST required")
			return
		}

		if !isHurlInstalled() {
			jsonErr(w, http.StatusPreconditionFailed,
				"hurl is not installed. Install it from https://hurl.dev — e.g. `brew install hurl`")
			return
		}

		var req struct {
			Path      string            `json:"path"`
			Variables map[string]string `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		if req.Path == "" {
			jsonErr(w, http.StatusBadRequest, "path is required")
			return
		}
		if !isSafePath(req.Path) {
			jsonErr(w, http.StatusBadRequest, "invalid path")
			return
		}

		absPath := filepath.Join(dir, req.Path)
		if _, err := os.Stat(absPath); os.IsNotExist(err) {
			jsonErr(w, http.StatusNotFound, "file not found: "+req.Path)
			return
		}

		// Build the hurl command.
		args := []string{"--test", "--very-verbose", "--no-color", "--error-format", "long"}

		// Inject the Spin app's base URL as a variable so tests can use {{base_url}}.
		addr := runner.ListenAddr()
		if addr == "" {
			addr = cfg.ListenAddr
		}
		if addr != "" {
			args = append(args, "--variable", "base_url="+addr)
		}

		for k, v := range req.Variables {
			args = append(args, "--variable", k+"="+v)
		}
		args = append(args, absPath)

		cmd := exec.Command("hurl", args...)
		cmd.Dir = dir

		startTime := time.Now()
		output, err := cmd.CombinedOutput()
		endTime := time.Now()

		exitCode := 0
		success := true
		if err != nil {
			success = false
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else {
				exitCode = -1
			}
		}

		jsonOK(w, HurlRunResult{
			Success:     success,
			Output:      string(output),
			DurationMs:  endTime.Sub(startTime).Milliseconds(),
			StartTimeMs: startTime.UnixMilli(),
			EndTimeMs:   endTime.UnixMilli(),
			File:        req.Path,
			ExitCode:    exitCode,
		})
	}
}

// hurlDeleteHandler serves POST /api/hurl-delete — deletes a .hurl file.
func hurlDeleteHandler(dir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErr(w, http.StatusMethodNotAllowed, "POST required")
			return
		}

		var req struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		if req.Path == "" {
			jsonErr(w, http.StatusBadRequest, "path is required")
			return
		}
		if !isSafePath(req.Path) || !strings.HasSuffix(req.Path, ".hurl") {
			jsonErr(w, http.StatusBadRequest, "invalid path — must be a .hurl file")
			return
		}

		absPath := filepath.Join(dir, req.Path)
		if err := os.Remove(absPath); err != nil {
			if os.IsNotExist(err) {
				jsonErr(w, http.StatusNotFound, "file not found")
			} else {
				jsonErr(w, http.StatusInternalServerError, "deleting file: "+err.Error())
			}
			return
		}

		jsonOK(w, map[string]string{"message": fmt.Sprintf("Deleted %s", req.Path)})
	}
}

func isHurlInstalled() bool {
	_, err := exec.LookPath("hurl")
	return err == nil
}

// isSafePath prevents directory traversal attacks.
func isSafePath(p string) bool {
	if p == "" {
		return false
	}
	cleaned := filepath.Clean(p)
	return !strings.HasPrefix(cleaned, "..") && !filepath.IsAbs(cleaned)
}
