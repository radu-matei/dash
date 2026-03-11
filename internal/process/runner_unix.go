//go:build !windows

package process

import (
	"os/exec"
	"syscall"
)

func setSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// terminateProcessGroup sends SIGTERM to the entire process group.
func terminateProcessGroup(pgid int, _ *exec.Cmd) {
	_ = syscall.Kill(-pgid, syscall.SIGTERM)
}

// killProcessGroup sends SIGKILL to the entire process group.
func killProcessGroup(pgid int, _ *exec.Cmd) {
	_ = syscall.Kill(-pgid, syscall.SIGKILL)
}
