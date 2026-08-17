package notify

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/open-cottage/cottage-service-go/internal/config"
)

func markerPath() string {
	return filepath.Join(config.Dir(), "welcomed")
}

func IsFirstRun() bool {
	_, err := os.Stat(markerPath())
	return os.IsNotExist(err)
}

func MarkWelcomed() {
	_ = os.MkdirAll(config.Dir(), 0o755)
	_ = os.WriteFile(markerPath(), []byte(time.Now().Format(time.RFC3339)), 0o644)
}

// ShowTrayTip shows a one-shot OS notification pointing users to the tray icon.
func ShowTrayTip(title, message string) {
	switch runtime.GOOS {
	case "windows":
		showWindows(title, message)
	case "darwin":
		script := fmt.Sprintf(`display notification %q with title %q`, message, title)
		_ = exec.Command("osascript", "-e", script).Start()
	default:
		_ = exec.Command("notify-send", title, message).Start()
	}
}

func showWindows(title, message string) {
	// Prefer PowerShell balloon via NotifyIcon (works without extra deps).
	ps := fmt.Sprintf(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Application
$n.Visible = $true
$n.BalloonTipTitle = %s
$n.BalloonTipText = %s
$n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$n.ShowBalloonTip(8000)
Start-Sleep -Seconds 8
$n.Dispose()
`, psQuote(title), psQuote(message))
	cmd := exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps)
	_ = cmd.Start()
}

func psQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}
