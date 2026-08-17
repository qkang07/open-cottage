//go:build windows

package winutil

import "syscall"

var (
	kernel32     = syscall.NewLazyDLL("kernel32.dll")
	procFreeCon  = kernel32.NewProc("FreeConsole")
)

// HideConsole detaches from the console window (double-click console builds).
// Safe no-op when already running as a Windows GUI subsystem binary.
func HideConsole() {
	_, _, _ = procFreeCon.Call()
}
