package process

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Status represents the lifecycle state of the managed spin process.
type Status int32

const (
	StatusStarting Status = iota
	StatusRunning
	StatusStopped
	StatusError
)

func (s Status) String() string {
	switch s {
	case StatusStarting:
		return "starting"
	case StatusRunning:
		return "running"
	case StatusStopped:
		return "stopped"
	case StatusError:
		return "error"
	}
	return "unknown"
}

// LogFunc is called for each line produced by the child process.
type LogFunc func(stream, line string)

// Runner manages the lifecycle of a `spin up` child process.
type Runner struct {
	spinBin  string
	args     []string
	extraEnv []string
	logFn    LogFunc

	cmd        *exec.Cmd
	pgid       int
	mu         sync.Mutex
	done       chan struct{}  // closed when the current child process exits
	status     atomic.Int32
	err        atomic.Value // stores the last error string
	listenAddr atomic.Value // stores the detected "Serving http://..." URL
}

// New creates a Runner that will execute spinBin with the given args,
// appending extraEnv to the current environment.
func New(spinBin string, args []string, extraEnv []string, logFn LogFunc) *Runner {
	r := &Runner{
		spinBin:  spinBin,
		args:     args,
		extraEnv: extraEnv,
		logFn:    logFn,
		done:     make(chan struct{}),
	}
	r.status.Store(int32(StatusStarting))
	return r
}

// Start spawns the spin process inside a new process group.
func (r *Runner) Start() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.done = make(chan struct{})

	cmd := exec.Command(r.spinBin, r.args...)
	cmd.Env = append(os.Environ(), r.extraEnv...)
	setSysProcAttr(cmd)

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	fmt.Fprintf(os.Stderr, "▶  Running: %s %s\n", r.spinBin, strings.Join(r.args, " "))

	if err := cmd.Start(); err != nil {
		r.status.Store(int32(StatusError))
		r.err.Store(err.Error())
		return fmt.Errorf("starting spin: %w", err)
	}

	r.cmd = cmd
	r.pgid = cmd.Process.Pid
	r.status.Store(int32(StatusRunning))

	go r.pipe(stdoutPipe, "stdout", os.Stdout)
	go r.pipe(stderrPipe, "stderr", os.Stderr)
	go r.wait()

	return nil
}

// Stop sends SIGTERM to the entire process group (Unix) or kills the process (Windows).
func (r *Runner) Stop() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pgid > 0 {
		terminateProcessGroup(r.pgid, r.cmd)
	}
}

// Restart stops the running Spin process and starts a fresh one, keeping the
// dashboard HTTP server alive. It waits up to 8 s for the old process to exit
// before force-killing it, then resets state and calls Start().
func (r *Runner) Restart() error {
	r.mu.Lock()
	pgid := r.pgid
	cmd  := r.cmd
	done := r.done
	r.mu.Unlock()

	r.logFn("system", "▶  Restarting Spin app…")

	if pgid > 0 {
		terminateProcessGroup(pgid, cmd)
	}

	// Wait for the old process to exit cleanly, then force-kill if needed.
	select {
	case <-done:
	case <-time.After(8 * time.Second):
		if pgid > 0 {
			killProcessGroup(pgid, cmd)
		}
		select {
		case <-done:
		case <-time.After(2 * time.Second):
		}
	}

	// Reset per-run state so the new process starts fresh.
	// Must store nil (not "") so the pipe() nil-check re-enables address detection.
	r.listenAddr = atomic.Value{}
	r.err.Store("")

	return r.Start()
}

// Status returns the current lifecycle status.
func (r *Runner) Status() Status {
	return Status(r.status.Load())
}

// LastError returns the last error string, if any.
func (r *Runner) LastError() string {
	if v := r.err.Load(); v != nil {
		return v.(string)
	}
	return ""
}

// ListenAddr returns the URL where spin announced it is serving, if detected.
// Returns empty string until spin prints its "Serving http://..." line.
func (r *Runner) ListenAddr() string {
	if v := r.listenAddr.Load(); v != nil {
		return v.(string)
	}
	return ""
}

// pipe reads lines from reader, sends each to the SSE hub via logFn, and
// simultaneously writes to terminal so output is visible even before any
// browser client connects.
// It also watches for spin's "Serving http://..." announcement to capture the
// listen address even when no --listen flag was passed.
func (r *Runner) pipe(reader io.ReadCloser, stream string, terminal io.Writer) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		r.logFn(stream, line)
		_, _ = fmt.Fprintln(terminal, line)

		// Detect spin's listen address announcement, e.g.:
		//   Serving http://127.0.0.1:3000
		if r.listenAddr.Load() == nil {
			if addr := extractServingAddr(line); addr != "" {
				r.listenAddr.Store(addr)
			}
		}
	}
}

// extractServingAddr parses a line like "Serving http://127.0.0.1:3000" and
// returns a browser-navigable URL (replacing 127.0.0.1 with localhost).
func extractServingAddr(line string) string {
	line = strings.TrimSpace(line)
	const prefix = "Serving "
	if !strings.HasPrefix(line, prefix) {
		return ""
	}
	addr := strings.TrimSpace(line[len(prefix):])
	if !strings.HasPrefix(addr, "http://") && !strings.HasPrefix(addr, "https://") {
		return ""
	}
	// Prefer localhost over 127.0.0.1 for browser navigation.
	addr = strings.ReplaceAll(addr, "://127.0.0.1:", "://localhost:")
	return addr
}

func (r *Runner) wait() {
	r.mu.Lock()
	done := r.done
	r.mu.Unlock()

	err := r.cmd.Wait()
	if err != nil {
		r.status.Store(int32(StatusError))
		msg := fmt.Sprintf("spin exited with error: %v", err)
		r.err.Store(msg)
		r.logFn("system", msg)
		fmt.Fprintln(os.Stderr, msg)
	} else {
		r.status.Store(int32(StatusStopped))
		msg := "spin process exited cleanly"
		r.logFn("system", msg)
		fmt.Fprintln(os.Stderr, msg)
	}
	close(done)
}
