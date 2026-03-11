//go:build windows

package process

import "os/exec"

func setSysProcAttr(_ *exec.Cmd) {
	// Windows does not support Unix process groups; no-op.
}

// terminateProcessGroup kills the process on Windows (no process group support).
func terminateProcessGroup(_ int, cmd *exec.Cmd) {
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

// killProcessGroup kills the process on Windows.
func killProcessGroup(_ int, cmd *exec.Cmd) {
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}
