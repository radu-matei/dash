package server

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// watchComponentLogs polls .spin/logs/ inside dir every 300 ms and tails
// per-component log files (<component>_stdout.txt / <component>_stderr.txt).
//
// New lines are published to hub as component log events. Only lines that
// appear after the watcher first discovers a file are emitted — no historical
// replay so the UI stays clean across restarts.
//
// This function runs indefinitely and is intended to be called in a goroutine.
func watchComponentLogs(dir string, hub *Hub) {
	logsDir := filepath.Join(dir, ".spin", "logs")

	type fileState struct{ offset int64 }
	states := map[string]*fileState{}

	tick := time.NewTicker(300 * time.Millisecond)
	defer tick.Stop()

	for range tick.C {
		entries, err := os.ReadDir(logsDir)
		if err != nil {
			// Directory may not exist yet (spin hasn't started); wait quietly.
			continue
		}

		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()

			var comp, sub string
			switch {
			case strings.HasSuffix(name, "_stdout.txt"):
				comp, sub = strings.TrimSuffix(name, "_stdout.txt"), "stdout"
			case strings.HasSuffix(name, "_stderr.txt"):
				comp, sub = strings.TrimSuffix(name, "_stderr.txt"), "stderr"
			default:
				continue
			}

			path := filepath.Join(logsDir, name)
			info, err := os.Stat(path)
			if err != nil {
				continue
			}
			size := info.Size()

			st, known := states[path]
			if !known {
				// First sighting: record current end so we don't replay history.
				states[path] = &fileState{offset: size}
				continue
			}

			// File was truncated or recreated (spin process restarted).
			if size < st.offset {
				hub.Publish("system", "─── "+comp+": log file reset (process restarted) ───")
				st.offset = 0
			}

			if size == st.offset {
				continue // nothing new
			}

			f, err := os.Open(path)
			if err != nil {
				continue
			}
			_, _ = f.Seek(st.offset, io.SeekStart)
			data, _ := io.ReadAll(f)
			_ = f.Close()

			// Advance offset only through complete lines (ending with \n) so
			// we never split a UTF-8 sequence or a partial log line.
			lastNL := strings.LastIndex(string(data), "\n")
			if lastNL < 0 {
				continue // partial line — wait for the terminating newline
			}

			for _, line := range strings.Split(string(data[:lastNL]), "\n") {
				line = strings.TrimRight(line, "\r")
				if line == "" {
					continue // skip blank lines from consecutive newlines
				}
				hub.PublishComponent(comp, sub, line)
			}
			st.offset += int64(lastNL + 1)
		}
	}
}
