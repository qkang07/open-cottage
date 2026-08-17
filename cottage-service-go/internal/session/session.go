package session

import (
	"encoding/base64"
	"fmt"
	"io"
	"math/rand"
	"sync"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/proto"
	"github.com/open-cottage/cottage-service-go/internal/headless"
)

const (
	maxSessions = 3
	idleTimeout = 5 * time.Minute
)

type entry struct {
	page       *rod.Page
	lastActive time.Time
	url        string
}

type Manager struct {
	hl   *headless.Manager
	mu   sync.Mutex
	sess map[string]*entry
}

func New(hl *headless.Manager) *Manager {
	m := &Manager{hl: hl, sess: map[string]*entry{}}
	go m.sweep()
	return m
}

func (m *Manager) sweep() {
	t := time.NewTicker(60 * time.Second)
	for range t.C {
		m.mu.Lock()
		now := time.Now()
		for id, e := range m.sess {
			if now.Sub(e.lastActive) > idleTimeout {
				_ = e.page.Close()
				delete(m.sess, id)
			}
		}
		m.mu.Unlock()
	}
}

func (m *Manager) newID() string {
	return fmt.Sprintf("bs_%s_%d", stringsBase36(time.Now().UnixMilli()), rand.Intn(1e6))
}

func stringsBase36(n int64) string {
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{digits[n%36]}, b...)
		n /= 36
	}
	return string(b)
}

func (m *Manager) touch(e *entry) { e.lastActive = time.Now() }

func (m *Manager) evictIfNeeded() {
	for len(m.sess) >= maxSessions {
		var oldestID string
		var oldest time.Time
		first := true
		for id, e := range m.sess {
			if first || e.lastActive.Before(oldest) {
				oldest = e.lastActive
				oldestID = id
				first = false
			}
		}
		if oldestID == "" {
			break
		}
		_ = m.sess[oldestID].page.Close()
		delete(m.sess, oldestID)
	}
}

func (m *Manager) Open(url string, waitForRender bool, vw, vh int, referer string) (map[string]any, error) {
	b, err := m.hl.Browser()
	if err != nil {
		return nil, err
	}
	if vw <= 0 {
		vw = 1280
	}
	if vh <= 0 {
		vh = 800
	}
	page, err := b.Page(proto.TargetCreateTarget{URL: "about:blank"})
	if err != nil {
		return nil, err
	}
	_ = page.SetViewport(&proto.EmulationSetDeviceMetricsOverride{Width: vw, Height: vh, DeviceScaleFactor: 1, Mobile: false})
	if referer != "" {
		_, _ = page.SetExtraHeaders([]string{"Referer", referer})
	}
	page = page.Timeout(30 * time.Second)
	if err := page.Navigate(url); err != nil {
		_ = page.Close()
		return nil, err
	}
	_ = page.WaitLoad()
	if waitForRender {
		_ = page.WaitIdle(time.Second)
	}
	info, _ := page.Info()
	final, title := url, ""
	if info != nil {
		final, title = info.URL, info.Title
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.evictIfNeeded()
	id := m.newID()
	m.sess[id] = &entry{page: page, lastActive: time.Now(), url: final}
	return map[string]any{"sessionId": id, "url": final, "title": title}, nil
}

func (m *Manager) get(id string) (*entry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.sess[id]
	if !ok {
		return nil, fmt.Errorf("session not found: %s", id)
	}
	m.touch(e)
	return e, nil
}

func (m *Manager) List() []map[string]string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]map[string]string, 0, len(m.sess))
	for id, e := range m.sess {
		out = append(out, map[string]string{"sessionId": id, "url": e.url})
	}
	return out
}

func (m *Manager) snapshot(e *entry, note string) map[string]any {
	info, _ := e.page.Info()
	url, title := e.url, ""
	if info != nil {
		url, title = info.URL, info.Title
		e.url = url
	}
	out := map[string]any{"ok": true, "url": url, "title": title}
	if note != "" {
		out["note"] = note
	}
	return out
}

func (m *Manager) Navigate(id, url string, waitForRender bool) (map[string]any, error) {
	e, err := m.get(id)
	if err != nil {
		return nil, err
	}
	e.page = e.page.Timeout(30 * time.Second)
	if err := e.page.Navigate(url); err != nil {
		return nil, err
	}
	_ = e.page.WaitLoad()
	if waitForRender {
		_ = e.page.WaitIdle(time.Second)
	}
	return m.snapshot(e, ""), nil
}

func (m *Manager) resolveElement(page *rod.Page, selector, text string) (*rod.Element, error) {
	if selector != "" {
		el, err := page.Element(selector)
		if err == nil {
			return el, nil
		}
	}
	if text != "" {
		el, err := page.ElementR("a, button, input, select, textarea, [role='button'], [onclick], label, span, div", text)
		if err == nil {
			return el, nil
		}
	}
	return nil, fmt.Errorf("element not found: selector=%q, text=%q", selector, text)
}

func (m *Manager) Click(id, selector, text string) (map[string]any, error) {
	e, err := m.get(id)
	if err != nil {
		return nil, err
	}
	el, err := m.resolveElement(e.page, selector, text)
	if err != nil {
		return nil, err
	}
	if err := el.Click(proto.InputMouseButtonLeft, 1); err != nil {
		return nil, err
	}
	_ = e.page.Timeout(5 * time.Second).WaitIdle(500 * time.Millisecond)
	label := selector
	if label == "" {
		label = text
	}
	return m.snapshot(e, "clicked "+label), nil
}

func (m *Manager) Type(id, selector, value, text string) (map[string]any, error) {
	e, err := m.get(id)
	if err != nil {
		return nil, err
	}
	el, err := m.resolveElement(e.page, selector, text)
	if err != nil {
		return nil, err
	}
	_ = el.Click(proto.InputMouseButtonLeft, 3)
	if err := el.Input(value); err != nil {
		return nil, err
	}
	label := selector
	if label == "" {
		label = text
	}
	return m.snapshot(e, "typed into "+label), nil
}

func (m *Manager) Select(id, selector, value string) (map[string]any, error) {
	e, err := m.get(id)
	if err != nil {
		return nil, err
	}
	el, err := e.page.Element(selector)
	if err != nil {
		return nil, fmt.Errorf("select element not found: selector=%q", selector)
	}
	err = el.Select([]string{value}, true, rod.SelectorTypeText)
	if err != nil {
		_, _ = e.page.Eval(`(sel, val) => {
			const select = document.querySelector(sel);
			if (!select) return;
			const opt = Array.from(select.options).find(o => o.value === val || o.text === val);
			if (opt) { select.value = opt.value; select.dispatchEvent(new Event("change", { bubbles: true })); }
		}`, selector, value)
	}
	return m.snapshot(e, "selected "+value), nil
}

func (m *Manager) Screenshot(id string, fullPage bool, format string, quality int) (map[string]any, error) {
	e, err := m.get(id)
	if err != nil {
		return nil, err
	}
	if format == "" {
		format = "png"
	}
	req := &proto.PageCaptureScreenshot{}
	switch format {
	case "jpeg":
		req.Format = proto.PageCaptureScreenshotFormatJpeg
		if quality <= 0 {
			quality = 80
		}
		req.Quality = &quality
	case "webp":
		req.Format = proto.PageCaptureScreenshotFormatWebp
	default:
		req.Format = proto.PageCaptureScreenshotFormatPng
		format = "png"
	}
	bin, err := e.page.Screenshot(fullPage, req)
	if err != nil {
		return nil, err
	}
	b64 := base64.StdEncoding.EncodeToString(bin)
	info, _ := e.page.Info()
	url, title := e.url, ""
	if info != nil {
		url, title = info.URL, info.Title
	}
	return map[string]any{
		"image": b64, "format": format, "url": url, "title": title,
		"size": int(float64(len(b64)) * 3 / 4),
	}, nil
}

func (m *Manager) PDF(id string, landscape bool) (map[string]any, error) {
	e, err := m.get(id)
	if err != nil {
		return nil, err
	}
	pw, ph := 8.27, 11.69
	stream, err := e.page.PDF(&proto.PagePrintToPDF{
		Landscape:         landscape,
		PrintBackground:   true,
		PreferCSSPageSize: true,
		PaperWidth:        &pw,
		PaperHeight:       &ph,
	})
	if err != nil {
		return nil, err
	}
	defer stream.Close()
	bin, err := io.ReadAll(stream)
	if err != nil {
		return nil, err
	}
	b64 := base64.StdEncoding.EncodeToString(bin)
	info, _ := e.page.Info()
	url, title := e.url, ""
	if info != nil {
		url, title = info.URL, info.Title
	}
	return map[string]any{
		"pdf": b64, "format": "pdf", "url": url, "title": title, "size": len(bin),
	}, nil
}

func (m *Manager) Extract(id string) (map[string]any, error) {
	e, err := m.get(id)
	if err != nil {
		return nil, err
	}
	res, err := e.page.Eval(`() => {
		const title = document.title || "";
		const clone = document.cloneNode(true);
		clone.querySelectorAll("script,style,noscript,svg,iframe,nav,header,footer,aside").forEach(el => el.remove());
		const main = clone.querySelector("article,main,[role=main]") || clone.body;
		const content = (main?.innerText || "").replace(/\s+/g, " ").trim();
		const headings = [];
		document.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach(el => {
			const t = el.innerText?.trim();
			if (t) headings.push({ level: Number(el.tagName[1]), text: t });
		});
		const links = [];
		const seen = new Set();
		document.querySelectorAll("a[href]").forEach(el => {
			const href = el.getAttribute("href") || "";
			if (!href || href.startsWith("#") || seen.has(href) || links.length >= 50) return;
			seen.add(href);
			links.push({ text: (el.innerText||"").trim().slice(0,100), href });
		});
		return { url: location.href, title, content, textContent: content, headings, links, wordCount: content.length };
	}`)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	for k, v := range res.Value.Map() {
		out[k] = v.Val()
	}
	return out, nil
}

func (m *Manager) Close(id string) (map[string]any, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.sess[id]
	if !ok {
		return nil, fmt.Errorf("session not found: %s", id)
	}
	_ = e.page.Close()
	delete(m.sess, id)
	return map[string]any{"ok": true}, nil
}
