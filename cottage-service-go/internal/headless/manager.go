package headless

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
	"github.com/ysmood/gson"

	"github.com/open-cottage/cottage-service-go/internal/config"

	_ "embed"
)

//go:embed stealth.js
var stealthJS string

//go:embed extract.js
var extractJS string

const (
	defaultAcceptLanguage = "zh-CN,zh;q=0.9,en;q=0.8"
)

type Manager struct {
	mode        string
	browserPath string

	mu            sync.Mutex
	available     *bool
	browser       *rod.Browser
	cmd           *exec.Cmd
	userData      string
	cooldownUntil time.Time
	cooldownErr   error
}

func New(mode, browserPath string) *Manager {
	return &Manager{mode: mode, browserPath: browserPath}
}

func (m *Manager) Enabled() bool {
	if m.mode == "off" || m.mode == "false" {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.available != nil && *m.available
}

func browserCandidates(explicit string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(p string) {
		p = strings.TrimSpace(p)
		if p == "" || seen[p] {
			return
		}
		if _, err := os.Stat(p); err != nil {
			return
		}
		seen[p] = true
		out = append(out, p)
	}
	add(explicit)

	switch runtime.GOOS {
	case "windows":
		local := os.Getenv("LOCALAPPDATA")
		add(`C:\Program Files\Google\Chrome\Application\chrome.exe`)
		add(`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`)
		add(filepath.Join(local, `Google\Chrome\Application\chrome.exe`))
		add(`C:\Program Files\Microsoft\Edge\Application\msedge.exe`)
		add(`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`)
	case "darwin":
		add("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
		add("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")
		add("/Applications/Chromium.app/Contents/MacOS/Chromium")
	default:
		add("/usr/bin/google-chrome")
		add("/usr/bin/google-chrome-stable")
		add("/usr/bin/chromium")
		add("/usr/bin/chromium-browser")
		add("/usr/bin/microsoft-edge")
	}
	return out
}

func detectBrowser(explicit string) string {
	cands := browserCandidates(explicit)
	if len(cands) == 0 {
		return ""
	}
	return cands[0]
}

func (m *Manager) EnsureReady() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.mode == "off" || m.mode == "false" {
		f := false
		m.available = &f
		return false
	}
	path := detectBrowser(m.browserPath)
	if path == "" && m.mode != "on" && m.mode != "force" {
		if m.available == nil || *m.available {
			log.Println("[browser] no Chrome/Edge found; screenshot/extract disabled (set COTTAGE_BROWSER_PATH)")
		}
		f := false
		m.available = &f
		return false
	}
	t := true
	m.available = &t
	return true
}

func (m *Manager) Visible() bool {
	switch m.mode {
	case "visible", "headed", "gui", "window":
		return true
	default:
		return false
	}
}

func (m *Manager) WarmUp() {
	if m.Visible() {
		// Avoid popping an empty browser window on service start.
		log.Printf("[browser] mode=visible — will open a window on first search/fetch")
		return
	}
	go func() {
		if !m.EnsureReady() {
			return
		}
		if _, err := m.getBrowser(); err != nil {
			log.Printf("[browser] warm-up failed (non-fatal, will retry on first use): %v", err)
		}
	}()
}

func (m *Manager) profileRoot() string {
	if runtime.GOOS == "windows" {
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			return filepath.Join(local, "cottage-service", "chrome-profiles")
		}
	}
	return filepath.Join(config.Dir(), "chrome-profiles")
}

func (m *Manager) allocProfile(visible bool) string {
	kind := "headless"
	if visible {
		kind = "visible"
	}
	root := m.profileRoot()
	_ = os.MkdirAll(root, 0o755)
	if entries, err := os.ReadDir(root); err == nil {
		cutoff := time.Now().Add(-2 * time.Hour)
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			if info, err := e.Info(); err == nil && info.ModTime().Before(cutoff) {
				_ = os.RemoveAll(filepath.Join(root, e.Name()))
			}
		}
	}
	dir := filepath.Join(root, fmt.Sprintf("%s-%d", kind, time.Now().UnixNano()))
	_ = os.MkdirAll(dir, 0o755)
	abs, err := filepath.Abs(dir)
	if err != nil {
		return dir
	}
	return abs
}

type logWriter struct{}

func (logWriter) Write(p []byte) (int, error) {
	s := strings.TrimSpace(string(p))
	if s != "" {
		for _, line := range strings.Split(s, "\n") {
			line = strings.TrimSpace(line)
			if line != "" {
				log.Printf("[browser:chrome] %s", line)
			}
		}
	}
	return len(p), nil
}

func chromeArgs(userData string, visible bool) []string {
	args := []string{
		"--remote-debugging-port=0",
		"--remote-allow-origins=*",
		"--user-data-dir=" + userData,
		"--disable-blink-features=AutomationControlled",
		"--disable-features=IsolateOrigins,site-per-process,TranslateUI",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-default-apps",
		"--disable-popup-blocking",
		"--disable-sync",
		"--metrics-recording-only",
		"--lang=zh-CN",
		"--window-size=1366,768",
	}
	if visible {
		args = append(args, "about:blank")
	} else {
		args = append(args,
			"--headless=new",
			"--disable-gpu",
			"--hide-scrollbars",
			"--mute-audio",
			"--no-sandbox",
			"--disable-dev-shm-usage",
		)
	}
	return args
}

func readDevToolsURL(userData string) string {
	b, err := os.ReadFile(filepath.Join(userData, "DevToolsActivePort"))
	if err != nil {
		return ""
	}
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) < 2 {
		return ""
	}
	port := strings.TrimSpace(lines[0])
	path := strings.TrimSpace(lines[1])
	if port == "" || path == "" {
		return ""
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return "ws://127.0.0.1:" + port + path
}

func pollDevToolsFile(userData string, timeout time.Duration) (string, error) {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		u := readDevToolsURL(userData)
		if u != "" {
			if resolved, err := launcher.ResolveURL(u); err == nil {
				return resolved, nil
			} else {
				lastErr = err
			}
		} else {
			lastErr = fmt.Errorf("DevToolsActivePort not ready")
		}
		time.Sleep(150 * time.Millisecond)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("timeout")
	}
	return "", fmt.Errorf("wait DevTools in %s: %w", userData, lastErr)
}

func (m *Manager) launchOnce(bin string, visible bool) (controlURL string, cmd *exec.Cmd, userData string, err error) {
	userData = m.allocProfile(visible)
	killBrowsersUsingProfile(userData)

	if bin == "" {
		l := launcher.New().Leakless(false).UserDataDir(userData).Logger(logWriter{}).
			Set("remote-allow-origins", "*")
		if visible {
			l = l.Headless(false).Delete("no-startup-window")
		} else {
			l = l.HeadlessNew(true)
		}
		u, e := l.Launch()
		return u, nil, userData, e
	}

	args := chromeArgs(userData, visible)
	cmd = exec.Command(bin, args...)
	cmd.Stdout = logWriter{}
	cmd.Stderr = logWriter{}
	setupBrowserCmd(cmd)

	log.Printf("[browser] starting %s (visible=%v, profile=%s)", bin, visible, userData)
	if err := cmd.Start(); err != nil {
		return "", nil, userData, err
	}
	go func() { _ = cmd.Wait() }()

	u, err := pollDevToolsFile(userData, 12*time.Second)
	if err != nil {
		killBrowserCmd(cmd)
		killBrowsersUsingProfile(userData)
		return "", nil, userData, err
	}
	return u, cmd, userData, nil
}

func (m *Manager) tryLaunch(bins []string, visible bool) (controlURL, usedBin string, cmd *exec.Cmd, userData string, err error) {
	var lastErr error
	for _, bin := range bins {
		u, c, ud, e := m.launchOnce(bin, visible)
		if e != nil {
			lastErr = e
			log.Printf("[browser] launch failed with %s (%v)", displayBin(bin), e)
			_ = os.RemoveAll(ud)
			continue
		}
		return u, bin, c, ud, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no browser binary")
	}
	return "", "", nil, "", lastErr
}

func (m *Manager) getBrowser() (*rod.Browser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.browser != nil {
		return m.browser, nil
	}
	if time.Now().Before(m.cooldownUntil) {
		err := m.cooldownErr
		if err == nil {
			err = fmt.Errorf("browser unavailable (cooling down)")
		}
		return nil, err
	}

	start := time.Now()
	bins := browserCandidates(m.browserPath)
	if len(bins) == 0 {
		bins = []string{""}
	}

	visible := m.Visible()
	u, usedBin, cmd, userData, err := m.tryLaunch(bins, visible)
	if err != nil && visible {
		log.Printf("[browser] visible launch failed, falling back to headless: %v", err)
		u, usedBin, cmd, userData, err = m.tryLaunch(bins, false)
		visible = false
	}
	if err != nil {
		m.cooldownUntil = time.Now().Add(60 * time.Second)
		m.cooldownErr = err
		return nil, fmt.Errorf("%w (tried: %s)", err, strings.Join(mapBins(bins), ", "))
	}

	b := rod.New().ControlURL(u).MustConnect()
	m.browser = b
	m.cmd = cmd
	m.userData = userData
	m.cooldownErr = nil
	mode := "headless"
	if visible {
		mode = "visible"
	}
	log.Printf("[browser] started %s (%dms, path: %s)", mode, time.Since(start).Milliseconds(), displayBin(usedBin))
	return b, nil
}

func displayBin(bin string) string {
	if bin == "" {
		return "(rod-download)"
	}
	return bin
}

func mapBins(bins []string) []string {
	out := make([]string, len(bins))
	for i, b := range bins {
		out[i] = displayBin(b)
	}
	return out
}

func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.browser != nil {
		_ = m.browser.Close()
		m.browser = nil
		log.Println("[headless] browser closed")
	}
	if m.cmd != nil {
		killBrowserCmd(m.cmd)
		m.cmd = nil
	}
	if m.userData != "" {
		killBrowsersUsingProfile(m.userData)
		m.userData = ""
	}
}

func (m *Manager) newStealthPage() (*rod.Page, error) {
	b, err := m.getBrowser()
	if err != nil {
		return nil, err
	}
	page, err := b.Page(proto.TargetCreateTarget{URL: "about:blank"})
	if err != nil {
		return nil, err
	}
	fp := fingerprintForOS()
	_, _ = page.EvalOnNewDocument(stealthJS + "\n" + fp.overrideJS())
	_ = proto.NetworkSetUserAgentOverride{
		UserAgent:      fp.UA,
		AcceptLanguage: defaultAcceptLanguage,
		Platform:       fp.Platform,
		UserAgentMetadata: &proto.EmulationUserAgentMetadata{
			Brands:          fp.Brands,
			FullVersion:     "131.0.6778.86",
			Platform:        fp.Platform,
			PlatformVersion: fp.PlatformVersion,
			Architecture:    fp.Architecture,
			Model:           "",
			Mobile:          false,
		},
	}.Call(page)
	_ = proto.EmulationSetTimezoneOverride{TimezoneID: "Asia/Shanghai"}.Call(page)
	_ = proto.EmulationSetLocaleOverride{Locale: "zh-CN"}.Call(page)
	// Slight viewport jitter so sessions don't all look identical.
	w := 1280 + rand.Intn(160)
	h := 720 + rand.Intn(160)
	_ = page.SetViewport(&proto.EmulationSetDeviceMetricsOverride{
		Width: w, Height: h, DeviceScaleFactor: 1, Mobile: false,
	})
	return page, nil
}

type FetchResult struct {
	FinalURL    string
	HTML        string
	TextContent string
}

func (m *Manager) Fetch(url string, waitForRender bool, extraWaitMs int, timeout time.Duration, referer, userAgent string) (*FetchResult, error) {
	if !m.EnsureReady() {
		return nil, fmt.Errorf("headless disabled")
	}
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	page, err := m.newStealthPage()
	if err != nil {
		return nil, err
	}
	defer page.Close()

	page = page.Timeout(timeout)
	if userAgent != "" {
		_ = page.SetUserAgent(&proto.NetworkSetUserAgentOverride{UserAgent: userAgent})
	}
	if referer != "" {
		_, _ = page.SetExtraHeaders([]string{"Referer", referer, "Accept-Language", defaultAcceptLanguage})
	}
	if err := page.Navigate(url); err != nil {
		return nil, err
	}
	_ = page.WaitLoad()
	if waitForRender {
		_ = page.WaitIdle(time.Second)
	}
	if extraWaitMs > 0 {
		time.Sleep(time.Duration(extraWaitMs) * time.Millisecond)
	}
	html, err := page.HTML()
	if err != nil {
		return nil, err
	}
	text, _ := page.Eval(`() => {
      const clone = document.cloneNode(true);
      clone.querySelectorAll("script, style, noscript, svg, iframe").forEach((el) => el.remove());
      return (clone.body?.innerText ?? clone.documentElement?.innerText ?? "").replace(/\s+/g, " ").trim();
    }`)
	textContent := ""
	if text != nil {
		textContent = text.Value.Str()
	}
	info, _ := page.Info()
	final := url
	if info != nil {
		final = info.URL
	}
	return &FetchResult{FinalURL: final, HTML: html, TextContent: textContent}, nil
}

func (m *Manager) Search(url, referer, waitSelector string, timeout time.Duration) (html, finalURL string, err error) {
	if !m.EnsureReady() {
		return "", "", fmt.Errorf("headless disabled")
	}
	if timeout <= 0 {
		timeout = 25 * time.Second
	}
	humanSleep(220, 650)
	page, err := m.newStealthPage()
	if err != nil {
		return "", "", err
	}
	defer page.Close()
	page = page.Timeout(timeout)
	if referer != "" {
		_, _ = page.SetExtraHeaders([]string{"Referer", referer, "Accept-Language", defaultAcceptLanguage})
	}
	humanMouseMove(page)
	humanSleep(60, 180)

	if err := page.Navigate(url); err != nil {
		return "", "", err
	}
	_ = page.WaitLoad()
	if waitSelector != "" {
		_, _ = page.Timeout(12 * time.Second).Element(waitSelector)
	} else {
		_ = page.WaitIdle(800 * time.Millisecond)
	}
	humanIdleRead()
	humanScroll(page)
	humanMouseMove(page)
	humanSleep(200, 500)

	html, err = page.HTML()
	if err != nil {
		return "", "", err
	}
	info, _ := page.Info()
	finalURL = url
	if info != nil {
		finalURL = info.URL
	}
	return html, finalURL, nil
}

// HumanSearchOptions drives a more human search flow: open homepage, type query, submit.
type HumanSearchOptions struct {
	HomeURL       string
	Query         string
	InputSelector string
	WaitSelector  string
	Timeout       time.Duration
	// ResultURL is used when interactive typing fails (fallback to direct navigation).
	ResultURL string
	Referer   string
}

// HumanSearch opens the engine homepage, types the query like a person, then waits for results.
func (m *Manager) HumanSearch(opts HumanSearchOptions) (html, finalURL string, err error) {
	if !m.EnsureReady() {
		return "", "", fmt.Errorf("headless disabled")
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 30 * time.Second
	}
	if opts.HomeURL == "" || opts.Query == "" || opts.InputSelector == "" {
		return m.Search(opts.ResultURL, opts.Referer, opts.WaitSelector, opts.Timeout)
	}

	humanSleep(250, 700)
	page, err := m.newStealthPage()
	if err != nil {
		return "", "", err
	}
	defer page.Close()
	page = page.Timeout(opts.Timeout)

	if opts.Referer != "" {
		_, _ = page.SetExtraHeaders([]string{"Referer", opts.Referer, "Accept-Language", defaultAcceptLanguage})
	}
	humanMouseMove(page)
	if err := page.Navigate(opts.HomeURL); err != nil {
		return m.Search(opts.ResultURL, opts.Referer, opts.WaitSelector, opts.Timeout)
	}
	_ = page.WaitLoad()
	humanIdleRead()
	humanMouseMove(page)

	if err := humanClick(page, opts.InputSelector); err != nil {
		log.Printf("[browser] interactive input miss (%v), fallback direct URL", err)
		return m.searchOnPage(page, opts.ResultURL, opts.WaitSelector)
	}
	humanSleep(120, 320)
	humanClearInput(page)
	humanSleep(60, 160)
	if err := humanType(page, opts.Query); err != nil {
		log.Printf("[browser] type failed (%v), fallback direct URL", err)
		return m.searchOnPage(page, opts.ResultURL, opts.WaitSelector)
	}
	if err := humanPressEnter(page); err != nil {
		return "", "", err
	}
	_ = page.WaitLoad()
	if opts.WaitSelector != "" {
		_, _ = page.Timeout(14 * time.Second).Element(opts.WaitSelector)
	} else {
		_ = page.WaitIdle(time.Second)
	}
	humanIdleRead()
	humanScroll(page)
	humanMouseMove(page)
	humanSleep(250, 600)

	html, err = page.HTML()
	if err != nil {
		return "", "", err
	}
	info, _ := page.Info()
	finalURL = opts.HomeURL
	if info != nil {
		finalURL = info.URL
	}
	return html, finalURL, nil
}

func (m *Manager) searchOnPage(page *rod.Page, url, waitSelector string) (html, finalURL string, err error) {
	if url == "" {
		return "", "", fmt.Errorf("no result url")
	}
	humanMouseMove(page)
	if err := page.Navigate(url); err != nil {
		return "", "", err
	}
	_ = page.WaitLoad()
	if waitSelector != "" {
		_, _ = page.Timeout(12 * time.Second).Element(waitSelector)
	}
	humanIdleRead()
	humanScroll(page)
	html, err = page.HTML()
	if err != nil {
		return "", "", err
	}
	info, _ := page.Info()
	finalURL = url
	if info != nil {
		finalURL = info.URL
	}
	return html, finalURL, nil
}

type ScreenshotOptions struct {
	FullPage      bool
	Clip          *proto.PageViewport
	Width         int
	Height        int
	Format        string // png|jpeg|webp
	Quality       int
	WaitForRender bool
	ExtraWaitMs   int
	Referer       string
	Timeout       time.Duration
}

type ScreenshotResult struct {
	URL      string `json:"url"`
	Title    string `json:"title"`
	Format   string `json:"format"`
	Viewport struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"viewport"`
	Image string `json:"image"`
	Size  int    `json:"size"`
}

func (m *Manager) Screenshot(url string, opts ScreenshotOptions) (*ScreenshotResult, error) {
	if !m.EnsureReady() {
		return nil, fmt.Errorf("headless disabled")
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 30 * time.Second
	}
	if opts.Width <= 0 {
		opts.Width = 1280
	}
	if opts.Height <= 0 {
		opts.Height = 800
	}
	format := opts.Format
	if format == "" {
		format = "png"
	}
	page, err := m.newStealthPage()
	if err != nil {
		return nil, err
	}
	defer page.Close()
	page = page.Timeout(opts.Timeout)
	_ = page.SetViewport(&proto.EmulationSetDeviceMetricsOverride{
		Width: opts.Width, Height: opts.Height, DeviceScaleFactor: 1, Mobile: false,
	})
	if opts.Referer != "" {
		_, _ = page.SetExtraHeaders([]string{"Referer", opts.Referer})
	}
	if err := page.Navigate(url); err != nil {
		return nil, err
	}
	_ = page.WaitLoad()
	if opts.WaitForRender {
		_ = page.WaitIdle(time.Second)
	}
	if opts.ExtraWaitMs > 0 {
		time.Sleep(time.Duration(opts.ExtraWaitMs) * time.Millisecond)
	}
	req := &proto.PageCaptureScreenshot{}
	switch format {
	case "jpeg":
		req.Format = proto.PageCaptureScreenshotFormatJpeg
		q := opts.Quality
		if q <= 0 {
			q = 80
		}
		req.Quality = &q
	case "webp":
		req.Format = proto.PageCaptureScreenshotFormatWebp
	default:
		req.Format = proto.PageCaptureScreenshotFormatPng
		format = "png"
	}
	if opts.Clip != nil {
		req.Clip = opts.Clip
	} else if opts.FullPage {
		t := true
		req.CaptureBeyondViewport = t
		req.FromSurface = t
	}
	bin, err := page.Screenshot(opts.FullPage && opts.Clip == nil, req)
	if err != nil {
		return nil, err
	}
	b64 := base64.StdEncoding.EncodeToString(bin)
	info, _ := page.Info()
	title := ""
	final := url
	if info != nil {
		title = info.Title
		final = info.URL
	}
	out := &ScreenshotResult{URL: final, Title: title, Format: format, Image: b64, Size: int(float64(len(b64)) * 3 / 4)}
	out.Viewport.Width = opts.Width
	out.Viewport.Height = opts.Height
	return out, nil
}

// PrintPDFOptions HTML/URL → PDF（CDP Page.printToPDF）
type PrintPDFOptions struct {
	URL           string
	HTML          string
	Landscape     bool
	PrintBackground bool
	PreferCSSPageSize bool
	PaperWidthIn  float64 // inches；0 则 A4 宽 8.27
	PaperHeightIn float64 // inches；0 则 A4 高 11.69
	WaitForRender bool
	ExtraWaitMs   int
	Timeout       time.Duration
}

// PrintPDFResult 打印结果（PDF base64）
type PrintPDFResult struct {
	URL    string `json:"url"`
	Title  string `json:"title"`
	PDF    string `json:"pdf"`
	Size   int    `json:"size"`
	Format string `json:"format"`
}

func (m *Manager) PrintPDF(opts PrintPDFOptions) (*PrintPDFResult, error) {
	if !m.EnsureReady() {
		return nil, fmt.Errorf("headless disabled")
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 60 * time.Second
	}
	target := strings.TrimSpace(opts.URL)
	var tmpHTML string
	if target == "" {
		html := opts.HTML
		if strings.TrimSpace(html) == "" {
			return nil, fmt.Errorf("url or html required")
		}
		f, err := os.CreateTemp("", "cottage-print-*.html")
		if err != nil {
			return nil, err
		}
		tmpHTML = f.Name()
		defer os.Remove(tmpHTML)
		if _, err := f.WriteString(html); err != nil {
			f.Close()
			return nil, err
		}
		if err := f.Close(); err != nil {
			return nil, err
		}
		target = pathToFileURL(tmpHTML)
	}
	page, err := m.newStealthPage()
	if err != nil {
		return nil, err
	}
	defer page.Close()
	page = page.Timeout(opts.Timeout)
	if err := page.Navigate(target); err != nil {
		return nil, err
	}
	_ = page.WaitLoad()
	if opts.WaitForRender {
		_ = page.WaitIdle(time.Second)
	}
	if opts.ExtraWaitMs > 0 {
		time.Sleep(time.Duration(opts.ExtraWaitMs) * time.Millisecond)
	}

	pw := opts.PaperWidthIn
	ph := opts.PaperHeightIn
	if pw <= 0 {
		pw = 8.27 // A4
	}
	if ph <= 0 {
		ph = 11.69
	}
	req := &proto.PagePrintToPDF{
		Landscape:         opts.Landscape,
		PrintBackground:   opts.PrintBackground,
		PreferCSSPageSize: opts.PreferCSSPageSize,
		PaperWidth:        &pw,
		PaperHeight:       &ph,
	}

	stream, err := page.PDF(req)
	if err != nil {
		return nil, err
	}
	defer stream.Close()
	bin, err := io.ReadAll(stream)
	if err != nil {
		return nil, err
	}
	b64 := base64.StdEncoding.EncodeToString(bin)
	info, _ := page.Info()
	title := ""
	final := target
	if info != nil {
		title = info.Title
		final = info.URL
	}
	return &PrintPDFResult{
		URL:    final,
		Title:  title,
		PDF:    b64,
		Size:   len(bin),
		Format: "pdf",
	}, nil
}

func pathToFileURL(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		abs = p
	}
	abs = filepath.ToSlash(abs)
	if runtime.GOOS == "windows" {
		// file:///C:/path/to/file
		if !strings.HasPrefix(abs, "/") {
			abs = "/" + abs
		}
		return "file://" + abs
	}
	return "file://" + abs
}

type ExtractResult struct {
	FinalURL    string            `json:"finalUrl"`
	URL         string            `json:"url"`
	Title       string            `json:"title"`
	Description string            `json:"description"`
	Author      string            `json:"author"`
	PublishDate string            `json:"publishDate"`
	Language    string            `json:"language"`
	OG          map[string]string `json:"og"`
	Content     string            `json:"content"`
	TextContent string            `json:"textContent"`
	Headings    []map[string]any  `json:"headings"`
	Links       []map[string]any  `json:"links"`
	Images      []map[string]any  `json:"images"`
	WordCount   int               `json:"wordCount"`
	Mode        string            `json:"mode"`
}

func (m *Manager) Extract(url string, waitForRender bool, timeout time.Duration, referer string) (*ExtractResult, error) {
	if !m.EnsureReady() {
		return nil, fmt.Errorf("headless disabled")
	}
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	page, err := m.newStealthPage()
	if err != nil {
		return nil, err
	}
	defer page.Close()
	page = page.Timeout(timeout)
	_ = page.SetViewport(&proto.EmulationSetDeviceMetricsOverride{
		Width: 1280, Height: 800, DeviceScaleFactor: 1, Mobile: false,
	})
	if referer != "" {
		_, _ = page.SetExtraHeaders([]string{"Referer", referer})
	}
	if err := page.Navigate(url); err != nil {
		return nil, err
	}
	_ = page.WaitLoad()
	if waitForRender {
		_ = page.WaitIdle(time.Second)
	}
	res, err := page.Eval(extractJS)
	if err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(res.Value)
	var out ExtractResult
	if err := json.Unmarshal(raw, &out); err != nil {
		gm := res.Value.Map()
		b, _ := json.Marshal(gsonToAny(gm))
		_ = json.Unmarshal(b, &out)
	}
	out.URL = out.FinalURL
	if out.URL == "" {
		out.URL = url
		out.FinalURL = url
	}
	out.Mode = "headless"
	return &out, nil
}

func gsonToAny(m map[string]gson.JSON) any {
	out := map[string]any{}
	for k, v := range m {
		out[k] = v.Val()
	}
	return out
}

// Browser returns the underlying browser for sessions.
func (m *Manager) Browser() (*rod.Browser, error) {
	if !m.EnsureReady() {
		return nil, fmt.Errorf("headless disabled")
	}
	return m.getBrowser()
}
