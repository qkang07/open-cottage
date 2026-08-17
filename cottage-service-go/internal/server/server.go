package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/open-cottage/cottage-service-go/internal/browser"
	"github.com/open-cottage/cottage-service-go/internal/config"
	"github.com/open-cottage/cottage-service-go/internal/headless"
	"github.com/open-cottage/cottage-service-go/internal/proxy"
	"github.com/open-cottage/cottage-service-go/internal/search"
	"github.com/open-cottage/cottage-service-go/internal/session"
	"github.com/open-cottage/cottage-service-go/internal/tlsutil"
)

var capabilities = []string{"search", "fetch", "proxy", "screenshot", "extract", "browser", "pdf"}

type Server struct {
	Cfg      config.Config
	HL       *headless.Manager
	Search   *search.Service
	Proxy    *proxy.Handler
	Sessions *session.Manager
	httpSrv  *http.Server
	BaseURL  string
	TLSMsg   string
	Quiet    bool
}

func New(cfg config.Config) *Server {
	hl := headless.New(cfg.HeadlessMode, cfg.BrowserPath)
	s := &Server{
		Cfg:      cfg,
		HL:       hl,
		Search:   &search.Service{HL: hl},
		Proxy:    proxy.New(cfg.ProxyAllowPrivate),
		Sessions: session.New(hl),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/profiles", s.handleProfiles)
	mux.HandleFunc("/search", s.handleSearch)
	mux.HandleFunc("/fetch", s.handleFetch)
	mux.HandleFunc("/cookies", s.handleCookies)
	mux.HandleFunc("/proxy", s.Proxy.ServeHTTP)
	mux.HandleFunc("/screenshot", s.handleScreenshot)
	mux.HandleFunc("/pdf", s.handlePDF)
	mux.HandleFunc("/extract", s.handleExtract)
	mux.HandleFunc("/browser/", s.handleBrowser)
	mux.HandleFunc("/", s.handleRoot)
	s.httpSrv = &http.Server{
		Addr:              cfg.Addr(),
		Handler:           withOptions(mux),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	return s
}

func withOptions(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions && !strings.HasPrefix(r.URL.Path, "/proxy") {
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "content-type")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) ListenAndServe() error {
	s.HL.EnsureReady()
	s.HL.WarmUp()

	scheme := "http"
	s.TLSMsg = "tls disabled"
	if s.Cfg.UseTLS() {
		scheme = "https"
		tlsCfg, msg, err := tlsutil.LoadOrGenerate(s.Cfg.TLSCertFile, s.Cfg.TLSKeyFile, s.Cfg.TLSCommonName, config.Dir())
		if err != nil {
			return err
		}
		s.TLSMsg = msg
		s.httpSrv.TLSConfig = tlsCfg
	}
	s.BaseURL = fmt.Sprintf("%s://%s:%d", scheme, s.Cfg.Host, s.Cfg.Port)
	if !s.Quiet {
		s.printBanner()
	} else {
		log.Printf("[server] listening %s (%s)", s.BaseURL, s.TLSMsg)
	}

	if s.Cfg.UseTLS() {
		return s.httpSrv.ListenAndServeTLS("", "")
	}
	return s.httpSrv.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.HL.Close()
	return s.httpSrv.Shutdown(ctx)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "ts": time.Now().UTC().Format(time.RFC3339),
		"capabilities": capabilities, "proxyAllowPrivate": s.Cfg.ProxyAllowPrivate,
	})
}

func (s *Server) handleProfiles(w http.ResponseWriter, r *http.Request) {
	mode := "http"
	if s.HL.Enabled() {
		mode = "headless-preferred"
	}
	engines := make([]string, len(search.FallbackOrder))
	for i, e := range search.FallbackOrder {
		engines[i] = string(e)
	}
	profiles := make([]string, 0)
	for _, id := range browser.ListProfiles() {
		profiles = append(profiles, string(id))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"profiles": profiles, "engines": engines, "capabilities": capabilities,
		"headless": s.HL.Enabled(), "searchMode": mode, "proxyAllowPrivate": s.Cfg.ProxyAllowPrivate,
	})
}

func parseLimit(raw string) int {
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 5
	}
	if n > 10 {
		return 10
	}
	return n
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	var query, engineRaw, profileRaw string
	limit := 5
	if r.Method == http.MethodGet {
		q := r.URL.Query()
		query = q.Get("q")
		if query == "" {
			query = q.Get("query")
		}
		engineRaw = q.Get("engine")
		profileRaw = q.Get("profile")
		limit = parseLimit(q.Get("limit"))
	} else {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if v, ok := body["query"].(string); ok {
			query = v
		}
		if v, ok := body["engine"].(string); ok {
			engineRaw = v
		}
		if v, ok := body["profile"].(string); ok {
			profileRaw = v
		}
		if v, ok := body["limit"].(float64); ok {
			limit = parseLimit(strconv.Itoa(int(v)))
		}
	}
	query = strings.TrimSpace(query)
	if query == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing query. Use q=<keyword> or JSON body { query }."})
		return
	}
	engine := search.Baidu
	if search.IsSupported(engineRaw) {
		engine = search.Engine(engineRaw)
	}
	var profile *browser.ID
	if id, ok := browser.ParseID(profileRaw); ok {
		profile = &id
	}

	order := []search.Engine{engine}
	for _, e := range search.FallbackOrder {
		if e != engine {
			order = append(order, e)
		}
	}
	var last search.Response
	var lastErr error
	for i, e := range order {
		res, err := s.Search.Run(query, e, limit, profile)
		if err != nil {
			lastErr = err
			continue
		}
		last = res
		if len(res.Results) > 0 {
			if i > 0 {
				res.Note = fmt.Sprintf("主引擎 %s 未返回结果，已自动切换到 %s。", engine, e)
				if last.Note != "" {
					res.Note = fmt.Sprintf("主引擎 %s 未返回结果（%s），已自动切换到 %s。", engine, last.Note, e)
				}
			}
			writeJSON(w, http.StatusOK, res)
			return
		}
	}
	if last.Query != "" {
		writeJSON(w, http.StatusOK, last)
		return
	}
	detail := "Search failed"
	if lastErr != nil {
		detail = lastErr.Error()
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Search failed", "detail": detail})
}

func stripHTML(html string) string {
	re := regexp.MustCompile(`(?is)<script[^>]*>.*?</script>|<style[^>]*>.*?</style>|<[^>]+>`)
	t := re.ReplaceAllString(html, " ")
	return strings.Join(strings.Fields(t), " ")
}

func truncate(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	return string(runes[:max]) + fmt.Sprintf("\n\n[内容已截断，原文共 %d 字符]", len(runes))
}

func (s *Server) handleFetch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	target, profileRaw, referer := "", "", ""
	maxLen := 80000
	if r.Method == http.MethodGet {
		q := r.URL.Query()
		target = q.Get("url")
		profileRaw = q.Get("profile")
		referer = q.Get("referer")
		if v := q.Get("maxLength"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				maxLen = n
			}
		}
	} else {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if v, ok := body["url"].(string); ok {
			target = v
		}
		if v, ok := body["profile"].(string); ok {
			profileRaw = v
		}
		if v, ok := body["referer"].(string); ok {
			referer = v
		}
		if v, ok := body["maxLength"].(float64); ok && v > 0 {
			maxLen = int(v)
		}
	}
	if maxLen > 200000 {
		maxLen = 200000
	}
	if !regexp.MustCompile(`(?i)^https?://`).MatchString(target) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing or invalid url"})
		return
	}
	var profile *browser.ID
	if id, ok := browser.ParseID(profileRaw); ok {
		profile = &id
	}

	if s.HL.Enabled() {
		if res, err := s.HL.Fetch(target, true, 0, 30*time.Second, referer, ""); err == nil {
			prof := "headless"
			if profile != nil {
				prof = string(*profile)
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"url": res.FinalURL, "status": 200, "profile": prof, "redirects": []string{},
				"contentType": "text/html", "content": truncate(res.TextContent, maxLen), "mode": "headless",
			})
			return
		}
	}
	res, err := browser.FetchAsBrowser(target, browser.FetchOptions{Profile: profile, Referer: referer})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Fetch failed", "detail": err.Error()})
		return
	}
	ct := res.Headers.Get("Content-Type")
	content := res.Body
	if strings.Contains(strings.ToLower(ct), "html") || strings.Contains(strings.ToLower(content[:min(200, len(content))]), "<html") {
		content = stripHTML(content)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"url": res.FinalURL, "status": res.Status, "profile": res.Profile, "redirects": res.Redirects,
		"contentType": ct, "content": truncate(content, maxLen), "mode": "http",
	})
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (s *Server) handleCookies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	cleared := browser.ClearCookies(r.URL.Query().Get("host"))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "cleared": cleared})
}

func (s *Server) handleScreenshot(w http.ResponseWriter, r *http.Request) {
	if !s.HL.Enabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "未启用", "detail": "截图功能需要本机安装 Chrome/Edge。请设置 COTTAGE_BROWSER_PATH 或安装 Chrome/Edge。",
		})
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	opts := headless.ScreenshotOptions{FullPage: true, WaitForRender: true, Width: 1280, Height: 800, Format: "png"}
	target := ""
	if r.Method == http.MethodGet {
		q := r.URL.Query()
		target = q.Get("url")
		if q.Get("fullPage") == "false" || q.Get("fullPage") == "0" {
			opts.FullPage = false
		}
		opts.Format = q.Get("format")
		if opts.Format == "" {
			opts.Format = "png"
		}
		if v := q.Get("quality"); v != "" {
			opts.Quality, _ = strconv.Atoi(v)
		}
		if v := q.Get("viewportWidth"); v != "" {
			opts.Width, _ = strconv.Atoi(v)
		}
		if v := q.Get("viewportHeight"); v != "" {
			opts.Height, _ = strconv.Atoi(v)
		}
		if v := q.Get("extraWaitMs"); v != "" {
			opts.ExtraWaitMs, _ = strconv.Atoi(v)
		}
		opts.Referer = q.Get("referer")
	} else {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if v, ok := body["url"].(string); ok {
			target = v
		}
		if v, ok := body["fullPage"].(bool); ok {
			opts.FullPage = v
		}
		if v, ok := body["format"].(string); ok {
			opts.Format = v
		}
		if v, ok := body["quality"].(float64); ok {
			opts.Quality = int(v)
		}
		if v, ok := body["viewportWidth"].(float64); ok {
			opts.Width = int(v)
		}
		if v, ok := body["viewportHeight"].(float64); ok {
			opts.Height = int(v)
		}
		if v, ok := body["waitForRender"].(bool); ok {
			opts.WaitForRender = v
		}
		if v, ok := body["extraWaitMs"].(float64); ok {
			opts.ExtraWaitMs = int(v)
		}
		if v, ok := body["referer"].(string); ok {
			opts.Referer = v
		}
	}
	if !regexp.MustCompile(`(?i)^https?://`).MatchString(target) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing or invalid url"})
		return
	}
	res, err := s.HL.Screenshot(target, opts)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Screenshot failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handlePDF(w http.ResponseWriter, r *http.Request) {
	if !s.HL.Enabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error":  "未启用",
			"detail": "PDF 打印需要本机安装 Chrome/Edge。请设置 COTTAGE_BROWSER_PATH 或安装 Chrome/Edge。",
		})
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	var body map[string]any
	_ = json.NewDecoder(io.LimitReader(r.Body, 16<<20)).Decode(&body)
	opts := headless.PrintPDFOptions{
		WaitForRender:     true,
		PrintBackground:   true,
		PreferCSSPageSize: true,
	}
	if v, ok := body["url"].(string); ok {
		opts.URL = v
	}
	if v, ok := body["html"].(string); ok {
		opts.HTML = v
	}
	if v, ok := body["landscape"].(bool); ok {
		opts.Landscape = v
	}
	if v, ok := body["printBackground"].(bool); ok {
		opts.PrintBackground = v
	}
	if v, ok := body["preferCSSPageSize"].(bool); ok {
		opts.PreferCSSPageSize = v
	}
	if v, ok := body["waitForRender"].(bool); ok {
		opts.WaitForRender = v
	}
	if v, ok := body["extraWaitMs"].(float64); ok {
		opts.ExtraWaitMs = int(v)
	}
	if v, ok := body["paperWidth"].(float64); ok {
		opts.PaperWidthIn = v
	}
	if v, ok := body["paperHeight"].(float64); ok {
		opts.PaperHeightIn = v
	}
	if strings.TrimSpace(opts.URL) == "" && strings.TrimSpace(opts.HTML) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing url or html"})
		return
	}
	if opts.URL != "" && !regexp.MustCompile(`(?i)^https?://`).MatchString(opts.URL) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid url"})
		return
	}
	res, err := s.HL.PrintPDF(opts)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "PDF print failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleExtract(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	target, referer := "", ""
	waitForRender := true
	maxLen := 100000
	if r.Method == http.MethodGet {
		q := r.URL.Query()
		target = q.Get("url")
		referer = q.Get("referer")
		if q.Get("waitForRender") == "false" || q.Get("waitForRender") == "0" {
			waitForRender = false
		}
		if v := q.Get("maxLength"); v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				maxLen = n
			}
		}
	} else {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if v, ok := body["url"].(string); ok {
			target = v
		}
		if v, ok := body["referer"].(string); ok {
			referer = v
		}
		if v, ok := body["waitForRender"].(bool); ok {
			waitForRender = v
		}
		if v, ok := body["maxLength"].(float64); ok {
			maxLen = int(v)
		}
	}
	if maxLen > 500000 {
		maxLen = 500000
	}
	if !regexp.MustCompile(`(?i)^https?://`).MatchString(target) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing or invalid url"})
		return
	}
	if s.HL.Enabled() {
		res, err := s.HL.Extract(target, waitForRender, 30*time.Second, referer)
		if err == nil {
			res.Content = truncate(res.Content, maxLen)
			res.TextContent = truncate(res.TextContent, maxLen)
			writeJSON(w, http.StatusOK, res)
			return
		}
		log.Printf("[extract] headless failed: %v", err)
	}
	fr, err := browser.FetchAsBrowser(target, browser.FetchOptions{Referer: referer})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Extract failed", "detail": err.Error()})
		return
	}
	text := stripHTML(fr.Body)
	writeJSON(w, http.StatusOK, map[string]any{
		"url": fr.FinalURL, "title": "", "description": "", "author": "", "publishDate": "", "language": "",
		"og": map[string]string{}, "content": truncate(text, maxLen), "textContent": truncate(text, maxLen),
		"headings": []any{}, "links": []any{}, "images": []any{}, "wordCount": utf8.RuneCountInString(text),
		"mode": "http", "note": "无头浏览器不可用，仅提取静态 HTML，结构化数据不完整。",
	})
}

func (s *Server) handleBrowser(w http.ResponseWriter, r *http.Request) {
	if !s.HL.Enabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "未启用", "detail": "交互浏览器需要本机安装 Chrome/Edge。",
		})
		return
	}
	action := strings.TrimPrefix(r.URL.Path, "/browser/")
	action = strings.Trim(action, "/")
	var body map[string]any
	if r.Method == http.MethodPost {
		_ = json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(&body)
	}
	if body == nil {
		body = map[string]any{}
	}
	str := func(k string) string {
		if v, ok := body[k].(string); ok {
			return v
		}
		return ""
	}
	boolDefault := func(k string, def bool) bool {
		if v, ok := body[k].(bool); ok {
			return v
		}
		return def
	}
	num := func(k string) int {
		if v, ok := body[k].(float64); ok {
			return int(v)
		}
		return 0
	}

	var (
		out any
		err error
	)
	switch action {
	case "open":
		u := str("url")
		if !regexp.MustCompile(`(?i)^https?://`).MatchString(u) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing or invalid url"})
			return
		}
		out, err = s.Sessions.Open(u, boolDefault("waitForRender", true), num("viewportWidth"), num("viewportHeight"), str("referer"))
	case "sessions":
		writeJSON(w, http.StatusOK, map[string]any{"sessions": s.Sessions.List()})
		return
	case "navigate", "click", "type", "select", "screenshot", "extract", "pdf", "close":
		sid := str("sessionId")
		if sid == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing sessionId"})
			return
		}
		switch action {
		case "navigate":
			u := str("url")
			if !regexp.MustCompile(`(?i)^https?://`).MatchString(u) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing or invalid url"})
				return
			}
			out, err = s.Sessions.Navigate(sid, u, true)
		case "click":
			out, err = s.Sessions.Click(sid, str("selector"), str("text"))
		case "type":
			out, err = s.Sessions.Type(sid, str("selector"), str("value"), str("text"))
		case "select":
			out, err = s.Sessions.Select(sid, str("selector"), str("value"))
		case "screenshot":
			out, err = s.Sessions.Screenshot(sid, boolDefault("fullPage", false), str("format"), num("quality"))
		case "extract":
			out, err = s.Sessions.Extract(sid)
		case "pdf":
			out, err = s.Sessions.PDF(sid, boolDefault("landscape", false))
		case "close":
			out, err = s.Sessions.Close(sid)
		}
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Unknown browser action: " + action})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Browser action failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) printBanner() {
	fmt.Printf("\ncottage-service-go\n  监听地址  %s\n  TLS 模式  %s (%s)\n  无头浏览器 %v\n\n",
		s.BaseURL, s.Cfg.TLSMode, s.TLSMsg, s.HL.Enabled())
}
