//go:build !windows

package headless

import "os/exec"

func setupBrowserCmd(cmd *exec.Cmd) {}

func killBrowserCmd(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
}

func killBrowsersUsingProfile(userData string) {
	_ = userData
}
