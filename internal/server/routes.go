package server

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/spinframework/dash/internal/config"
	"github.com/spinframework/dash/internal/db"
	"github.com/spinframework/dash/internal/otel"
	"github.com/spinframework/dash/internal/process"
)

func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, v interface{}) error {
	return json.NewDecoder(r.Body).Decode(v)
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
		jsonOK(w, map[string]interface{}{
			"name":        cfg.Name,
			"description": cfg.Description,
			"status":      runner.Status().String(),
			"error":       runner.LastError(),
			"components":  cfg.Components,
			"triggers":    cfg.Triggers,
			"varCount":    len(cfg.Variables),
		})
	}
}

// varsHandler returns the merged spin.toml + .env variable list.
func varsHandler(cfg *config.AppConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jsonOK(w, cfg.Variables)
	}
}

// logHistoryHandler reads all files from .spin/logs/ and returns their lines
// in chronological order so the frontend can pre-populate the log view.
func logHistoryHandler(appDir string) http.HandlerFunc {
	type logEntry struct {
		Stream string `json:"stream"`
		Line   string `json:"line"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		logsDir := filepath.Join(appDir, ".spin", "logs")
		entries, err := os.ReadDir(logsDir)
		if err != nil {
			// No logs directory yet — return empty list, not an error.
			jsonOK(w, []logEntry{})
			return
		}

		// Collect file paths sorted by name (Spin names them with timestamps).
		var paths []string
		for _, e := range entries {
			if !e.IsDir() {
				paths = append(paths, filepath.Join(logsDir, e.Name()))
			}
		}
		sort.Strings(paths)

		// Read lines from each file.  Limit total output to avoid OOM on
		// long-running apps.
		const maxLines = 10_000
		var lines []logEntry

		for _, path := range paths {
			f, err := os.Open(path)
			if err != nil {
				continue
			}
			scanner := bufio.NewScanner(f)
			for scanner.Scan() {
				line := scanner.Text()
				stream := "stdout"
				// Spin prefixes stderr lines with "[stderr]" in some versions,
				// but generally all lines in .spin/logs are mixed. We keep them
				// as-is and label them "history" so the frontend can distinguish.
				if strings.Contains(line, "ERROR") || strings.Contains(line, "WARN") {
					stream = "stderr"
				}
				lines = append(lines, logEntry{Stream: stream, Line: line})
				if len(lines) >= maxLines {
					break
				}
			}
			f.Close()
			if len(lines) >= maxLines {
				break
			}
		}

		jsonOK(w, lines)
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

// sqliteTablesHandler lists the tables in .spin/sqlite_db.db.
func sqliteTablesHandler(sdb *db.SQLiteDB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tables, err := sdb.Tables()
		if err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, tables)
	}
}

// sqliteQueryHandler executes a read-only SQL statement.
func sqliteQueryHandler(sdb *db.SQLiteDB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			SQL string `json:"sql"`
		}
		if err := decodeJSON(r, &body); err != nil || body.SQL == "" {
			jsonErr(w, "body must be {\"sql\":\"...\"}", http.StatusBadRequest)
			return
		}
		result, err := sdb.Query(body.SQL)
		if err != nil {
			jsonErr(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonOK(w, result)
	}
}

// sqliteExecHandler executes a write SQL statement.
func sqliteExecHandler(sdb *db.SQLiteDB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			SQL string `json:"sql"`
		}
		if err := decodeJSON(r, &body); err != nil || body.SQL == "" {
			jsonErr(w, "body must be {\"sql\":\"...\"}", http.StatusBadRequest)
			return
		}
		result, err := sdb.Exec(body.SQL)
		if err != nil {
			jsonErr(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonOK(w, result)
	}
}

// kvListHandler lists all KV entries.
func kvListHandler(kvdb *db.KVDB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		store := r.URL.Query().Get("store")
		entries, err := kvdb.List(store)
		if err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, entries)
	}
}

// kvUpsertHandler inserts or replaces a KV entry.
func kvUpsertHandler(kvdb *db.KVDB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var entry db.KVEntry
		if err := decodeJSON(r, &entry); err != nil || entry.Store == "" || entry.Key == "" {
			jsonErr(w, "body must be {\"store\":\"...\",\"key\":\"...\",\"value\":\"...\"}", http.StatusBadRequest)
			return
		}
		if err := kvdb.Upsert(entry.Store, entry.Key, entry.Value); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// kvDeleteHandler deletes a KV entry. Path: /api/kv/{store}/{key}
func kvDeleteHandler(kvdb *db.KVDB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			jsonErr(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// Path: /api/kv/{store}/{key}
		parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/api/kv/"), "/", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			jsonErr(w, "path must be /api/kv/{store}/{key}", http.StatusBadRequest)
			return
		}
		if err := kvdb.Delete(parts[0], parts[1]); err != nil {
			jsonErr(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
