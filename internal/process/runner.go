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
	"syscall"
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

	cmd    *exec.Cmd
	pgid   int
	mu     sync.Mutex
	status atomic.Int32
	err    atomic.Value // stores the last error string
}

// New creates a Runner that will execute spinBin with the given args,
// appending extraEnv to the current environment.
func New(spinBin string, args []string, extraEnv []string, logFn LogFunc) *Runner {
	r := &Runner{
		spinBin:  spinBin,
		args:     args,
		extraEnv: extraEnv,
		logFn:    logFn,
	}
	r.status.Store(int32(StatusStarting))
	return r
}

// Start spawns the spin process inside a new process group.
func (r *Runner) Start() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	cmd := exec.Command(r.spinBin, r.args...)
	cmd.Env = append(os.Environ(), r.extraEnv...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

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

// Stop sends SIGTERM to the entire process group.
func (r *Runner) Stop() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pgid > 0 {
		_ = syscall.Kill(-r.pgid, syscall.SIGTERM)
	}
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

// pipe reads lines from reader, sends each to the SSE hub via logFn, and
// simultaneously writes to terminal so output is visible even before any
// browser client connects.
func (r *Runner) pipe(reader io.ReadCloser, stream string, terminal io.Writer) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		r.logFn(stream, line)
		fmt.Fprintln(terminal, line)
	}
}

func (r *Runner) wait() {
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
}
