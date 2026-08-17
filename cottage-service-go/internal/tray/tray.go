package tray

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	_ "embed"

	"github.com/getlantern/systray"
)

// Icons are generated once from assets/logo-light.svg (not at runtime):
//
//	python scripts/gen_tray_icons.py
//	go generate ./internal/tray
//
//go:generate python ../../scripts/gen_tray_icons.py

//go:embed icon-running.ico
var iconRunningICO []byte

//go:embed icon-stopped.ico
var iconStoppedICO []byte

//go:embed icon-running.png
var iconRunningPNG []byte

//go:embed icon-stopped.png
var iconStoppedPNG []byte

var (
	statusMu   sync.Mutex
	statusItem *systray.MenuItem
	toggleItem *systray.MenuItem
	hostPort   string
	ready      bool
)

func iconFor(running bool) []byte {
	if runtime.GOOS == "windows" {
		if running {
			return iconRunningICO
		}
		return iconStoppedICO
	}
	if running {
		return iconRunningPNG
	}
	return iconStoppedPNG
}

// SetRunning updates tray icon badge + tooltip + menu labels.
// Safe to call before/after tray is ready.
func SetRunning(running bool) {
	statusMu.Lock()
	defer statusMu.Unlock()
	if !ready {
		return
	}
	applyRunningLocked(running)
}

func applyRunningLocked(running bool) {
	systray.SetIcon(iconFor(running))
	state := "已停止"
	if running {
		state = "运行中"
	}
	tip := fmt.Sprintf("Cottage Service — %s · %s", hostPort, state)
	systray.SetTooltip(tip)
	if statusItem != nil {
		statusItem.SetTitle(fmt.Sprintf("%s · %s", state, hostPort))
	}
	if toggleItem != nil {
		if running {
			toggleItem.SetTitle("停止服务")
		} else {
			toggleItem.SetTitle("启动服务")
		}
	}
}

func OpenURL(u string) {
	openURL(u)
}

func openURL(u string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", u)
	case "darwin":
		cmd = exec.Command("open", u)
	default:
		cmd = exec.Command("xdg-open", u)
	}
	_ = cmd.Start()
}

func copyText(text string) bool {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("clip")
	case "darwin":
		cmd = exec.Command("pbcopy")
	default:
		cmd = exec.Command("xclip", "-selection", "clipboard")
	}
	cmd.Stdin = strings.NewReader(text)
	return cmd.Run() == nil
}

func Enabled() bool {
	switch runtime.GOOS {
	case "windows", "darwin", "linux":
		return true
	default:
		return false
	}
}

// Run is the simple tray used by --cli mode (service already running).
func Run(baseURL string, hp string, onQuit func()) {
	RunWithUI(func() string { return baseURL }, hp, "", true, onQuit, nil, nil, nil, nil)
}

// RunWithUI blocks with an extended tray menu.
// initialRunning sets the first icon badge; call SetRunning later on status changes.
func RunWithUI(
	baseURLFn func() string,
	hp, uiURL string,
	initialRunning bool,
	onQuit, onOpenUI, onToggle, onTrustCA, onReady func(),
) {
	systray.Run(func() {
		statusMu.Lock()
		hostPort = hp
		ready = true
		systray.SetIcon(iconFor(initialRunning))
		// macOS: leave title empty so the menu bar shows icon only (no "Cottage" text).
		if runtime.GOOS == "darwin" {
			systray.SetTitle("")
		}

		statusItem = systray.AddMenuItem("…", "")
		statusItem.Disable()

		var mPanel *systray.MenuItem
		if uiURL != "" {
			mPanel = systray.AddMenuItem("打开控制台（配置）", "")
		}
		mOpen := systray.AddMenuItem("打开健康检查", "")
		mCopy := systray.AddMenuItem("复制服务地址", "")
		var mTrustCA *systray.MenuItem
		if onTrustCA != nil {
			mTrustCA = systray.AddMenuItem("尝试信任本机 CA", "写入当前用户的证书信任库")
		}
		if onToggle != nil {
			toggleItem = systray.AddMenuItem("启动服务", "")
		}
		systray.AddSeparator()
		mQuit := systray.AddMenuItem("退出 Cottage Service", "")

		applyRunningLocked(initialRunning)
		statusMu.Unlock()

		if onReady != nil {
			go func() {
				time.Sleep(400 * time.Millisecond)
				onReady()
			}()
		}

		go func() {
			for {
				if mPanel != nil && toggleItem != nil {
					select {
					case <-mPanel.ClickedCh:
						if onOpenUI != nil {
							onOpenUI()
						} else {
							openURL(uiURL)
						}
					case <-mOpen.ClickedCh:
						if u := baseURLFn(); u != "" {
							openURL(u + "/health")
						}
					case <-mCopy.ClickedCh:
						if u := baseURLFn(); u != "" {
							_ = copyText(u)
						}
					case <-mTrustCA.ClickedCh:
						go onTrustCA()
					case <-toggleItem.ClickedCh:
						onToggle()
					case <-mQuit.ClickedCh:
						statusMu.Lock()
						ready = false
						statusMu.Unlock()
						systray.Quit()
						if onQuit != nil {
							onQuit()
						}
						return
					}
					continue
				}
				if mPanel != nil {
					select {
					case <-mPanel.ClickedCh:
						if onOpenUI != nil {
							onOpenUI()
						} else {
							openURL(uiURL)
						}
					case <-mOpen.ClickedCh:
						if u := baseURLFn(); u != "" {
							openURL(u + "/health")
						}
					case <-mCopy.ClickedCh:
						if u := baseURLFn(); u != "" {
							_ = copyText(u)
						}
					case <-mTrustCA.ClickedCh:
						go onTrustCA()
					case <-mQuit.ClickedCh:
						statusMu.Lock()
						ready = false
						statusMu.Unlock()
						systray.Quit()
						if onQuit != nil {
							onQuit()
						}
						return
					}
					continue
				}
				select {
				case <-mOpen.ClickedCh:
					if u := baseURLFn(); u != "" {
						openURL(u + "/health")
					}
				case <-mCopy.ClickedCh:
					if u := baseURLFn(); u != "" {
						_ = copyText(u)
					}
				case <-mQuit.ClickedCh:
					statusMu.Lock()
					ready = false
					statusMu.Unlock()
					systray.Quit()
					if onQuit != nil {
						onQuit()
					}
					return
				}
			}
		}()
	}, func() {})
}
