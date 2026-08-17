//go:build windows

package headless

import (
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

func setupBrowserCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
}

func killBrowserCmd(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	pid := cmd.Process.Pid
	// Kill the whole process tree — Edge spawns children then may exit the parent.
	_ = exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid)).Run()
	_ = cmd.Process.Kill()
}

func killBrowsersUsingProfile(userData string) {
	userData = strings.TrimSpace(userData)
	if userData == "" {
		return
	}
	// Escape for PowerShell single-quoted string.
	q := strings.ReplaceAll(userData, "'", "''")
	script := `Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(msedge|chrome|chromium)\.exe$' -and $_.CommandLine -and $_.CommandLine -like '*` + q + `*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
	_ = exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", script).Run()
}
