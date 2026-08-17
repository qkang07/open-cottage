package search

import (
	"fmt"
	"log"
	"math/rand"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/open-cottage/cottage-service-go/internal/browser"
	"github.com/open-cottage/cottage-service-go/internal/headless"
)

type Engine string

const (
	Baidu      Engine = "baidu"
	Bing       Engine = "bing"
	DuckDuckGo Engine = "duckduckgo"
	Google     Engine = "google"
)

var FallbackOrder = []Engine{Baidu, Bing, DuckDuckGo, Google}

type Result struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

type Response struct {
	Query  string   `json:"query"`
	Engine Engine   `json:"engine"`
	Results []Result `json:"results"`
	Note   string   `json:"note,omitempty"`
	Mode   string   `json:"mode,omitempty"`
}

type Service struct {
	HL *headless.Manager
}

func IsSupported(raw string) bool {
	switch Engine(raw) {
	case Baidu, Bing, DuckDuckGo, Google:
		return true
	default:
		return false
	}
}

func cleanText(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

var junkTitle = regexp.MustCompile(`(?i)^(首页|主页|登录|注册|更多|设置|帮助|隐私|条款|home|sign\s*in|log\s*in|privacy|terms|settings|help|menu|nav)$`)

func isJunkURL(raw string, engine Engine) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return true
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return true
	}
	host := strings.ToLower(u.Hostname())
	path := strings.ToLower(u.Path)
	if regexp.MustCompile(`(?i)/(login|signin|signup|captcha|challenge|account)\b`).MatchString(path) {
		return true
	}
	switch engine {
	case Bing:
		return regexp.MustCompile(`(?i)(^|\.)bing\.com$`).MatchString(host)
	case DuckDuckGo:
		return regexp.MustCompile(`(?i)(^|\.)duckduckgo\.com$`).MatchString(host)
	case Google:
		return regexp.MustCompile(`(?i)google\.(com|[a-z]{2,3})$`).MatchString(host)
	case Baidu:
		if regexp.MustCompile(`(?i)nourl\.ubs\.baidu\.com$`).MatchString(host) {
			return true
		}
		if strings.HasPrefix(path, "/link") {
			return false
		}
		if regexp.MustCompile(`(?i)^(baike|zhidao|wenku|tieba|map|image|pan)\.baidu\.com$`).MatchString(host) {
			return false
		}
		if regexp.MustCompile(`(?i)^(www\.)?baidu\.com$`).MatchString(host) {
			return path == "/" || strings.HasPrefix(path, "/s") || strings.HasPrefix(path, "/index")
		}
	}
	return false
}

func looksLikeAntiBot(html string, status int) bool {
	if status >= 400 {
		return true
	}
	if len(html) < 400 {
		return true
	}
	sample := strings.ToLower(html)
	if len(sample) > 5000 {
		sample = sample[:5000]
	}
	re := regexp.MustCompile(`captcha|verify you are human|访问验证|安全验证|人机验证|challenge-platform|recaptcha|nc_iconfont|抱歉，系统检测到|unusual traffic|automated requests|enable javascript|please enable cookies|access denied|请求似乎来自自动化`)
	if re.MatchString(sample) {
		return true
	}
	if len(html) < 1500 && regexp.MustCompile(`to continue|verify|blocked|拒绝访问|403|forbidden`).MatchString(sample) {
		return true
	}
	return false
}

func maybeAntiBotNote(html string, status int) string {
	if looksLikeAntiBot(html, status) {
		return "页面疑似触发人机校验/反爬，已抓到页面但未解析到有效结果"
	}
	return ""
}

func resolveHref(href, base string) string {
	href = strings.TrimSpace(href)
	if href == "" || strings.HasPrefix(href, "javascript:") || strings.HasPrefix(href, "#") {
		return ""
	}
	u, err := url.Parse(href)
	if err != nil {
		return ""
	}
	b, err := url.Parse(base)
	if err != nil {
		return ""
	}
	return b.ResolveReference(u).String()
}

func decodeDdgRedirect(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	base, _ := url.Parse("https://html.duckduckgo.com/html/")
	u = base.ResolveReference(u)
	if strings.HasPrefix(u.Path, "/l/") || u.Query().Get("uddg") != "" {
		if uddg := u.Query().Get("uddg"); uddg != "" {
			if d, err := url.QueryUnescape(uddg); err == nil {
				return d
			}
			return uddg
		}
		if rut := u.Query().Get("rut"); rut != "" {
			return rut
		}
	}
	return u.String()
}

func pushResult(results *[]Result, seen map[string]struct{}, limit int, title, rawURL, snippet string, engine Engine) {
	if len(*results) >= limit {
		return
	}
	title = cleanText(title)
	rawURL = strings.TrimSpace(rawURL)
	snippet = cleanText(snippet)
	if rawURL == "" || title == "" || len(title) < 2 || junkTitle.MatchString(title) {
		return
	}
	if isJunkURL(rawURL, engine) {
		return
	}
	if _, ok := seen[rawURL]; ok {
		return
	}
	seen[rawURL] = struct{}{}
	*results = append(*results, Result{Title: title, URL: rawURL, Snippet: snippet})
}

func (s *Service) loadHTML(pageURL, referer, waitSelector string, profile *browser.ID, timeout time.Duration, method, body string) (html, mode string, status int, err error) {
	if s.HL != nil && s.HL.Enabled() && method != "POST" {
		h, _, e := s.HL.Search(pageURL, referer, waitSelector, timeout)
		if e == nil && h != "" {
			return h, "headless", 0, nil
		}
		if e != nil {
			log.Printf("[search] 浏览器抓取失败，降级 HTTP: %v", e)
		}
	}
	opts := browser.FetchOptions{Method: method, Body: body, Profile: profile, Referer: referer, Timeout: timeout}
	if timeout == 0 {
		opts.Timeout = 15 * time.Second
	}
	res, e := browser.FetchAsBrowser(pageURL, opts)
	if e != nil {
		return "", "http", 0, e
	}
	return res.Body, "http", res.Status, nil
}

func (s *Service) loadHTMLHuman(home, query, inputSel, resultURL, referer, waitSelector string, profile *browser.ID, timeout time.Duration) (html, mode string, status int, err error) {
	if s.HL != nil && s.HL.Enabled() {
		h, _, e := s.HL.HumanSearch(headless.HumanSearchOptions{
			HomeURL:       home,
			Query:         query,
			InputSelector: inputSel,
			ResultURL:     resultURL,
			Referer:       referer,
			WaitSelector:  waitSelector,
			Timeout:       timeout,
		})
		if e == nil && h != "" {
			return h, "headless", 0, nil
		}
		if e != nil {
			log.Printf("[search] 拟人搜索失败，降级 HTTP: %v", e)
		}
	}
	return s.loadHTML(resultURL, referer, waitSelector, profile, timeout, "GET", "")
}

func parseDDGHtml(html string, limit int) []Result {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}
	var results []Result
	seen := map[string]struct{}{}
	doc.Find(".result, .web-result, .results_links").Each(func(_ int, block *goquery.Selection) {
		link := block.Find("a.result__a, a.result-link").First()
		href, _ := link.Attr("href")
		u := resolveHref(href, "https://html.duckduckgo.com/html/")
		if u != "" {
			u = decodeDdgRedirect(u)
		}
		pushResult(&results, seen, limit, link.Text(), u, block.Find("a.result__snippet, .result__snippet").First().Text(), DuckDuckGo)
	})
	return results
}

func parseDDGLite(html string, limit int) []Result {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}
	var results []Result
	seen := map[string]struct{}{}
	doc.Find("a.result-link, a[href*='uddg=']").Each(func(_ int, link *goquery.Selection) {
		href, _ := link.Attr("href")
		u := resolveHref(href, "https://lite.duckduckgo.com/lite/")
		if u != "" {
			u = decodeDdgRedirect(u)
		}
		snippet := ""
		row := link.Closest("tr")
		if row.Length() > 0 {
			snippet = row.Find(".result-snippet, td.result-snippet").First().Text()
		}
		pushResult(&results, seen, limit, link.Text(), u, snippet, DuckDuckGo)
	})
	return results
}

func parseBing(html string, limit int) []Result {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}
	var results []Result
	seen := map[string]struct{}{}
	doc.Find("li.b_algo").Each(func(_ int, block *goquery.Selection) {
		link := block.Find("h2 a").First()
		href, _ := link.Attr("href")
		u := resolveHref(href, "https://www.bing.com/")
		pushResult(&results, seen, limit, link.Text(), u, block.Find(".b_caption p, .b_algoSlug, p").First().Text(), Bing)
	})
	return results
}

func parseBaidu(html string, limit int) []Result {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}
	var results []Result
	seen := map[string]struct{}{}
	doc.Find(".c-container").Each(func(_ int, block *goquery.Selection) {
		mu, _ := block.Attr("mu")
		link := block.Find("h3 a, .t a").First()
		href := strings.TrimSpace(mu)
		if href == "" {
			if v, ok := link.Attr("data-href"); ok {
				href = v
			} else if v, ok := link.Attr("href"); ok {
				href = v
			}
		}
		u := resolveHref(href, "https://www.baidu.com/")
		pushResult(&results, seen, limit, link.Text(), u,
			block.Find(`.c-abstract, .content-right_8Zs40, .c-span-last, [class*="abstract"], [class*="text"], .c-color-text`).First().Text(),
			Baidu)
	})
	return results
}

func parseGoogle(html string, limit int) []Result {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}
	var results []Result
	seen := map[string]struct{}{}
	doc.Find("div.g, div[data-sokoban-container]").Each(func(_ int, block *goquery.Selection) {
		link := block.Find(`a[href^="http"]`).FilterFunction(func(_ int, s *goquery.Selection) bool {
			h, _ := s.Attr("href")
			return !strings.Contains(h, "google.com/search")
		}).First()
		href, _ := link.Attr("href")
		u := resolveHref(href, "https://www.google.com/")
		pushResult(&results, seen, limit, link.Text(), u, block.Find(".VwiC3b, .IsZvec, .st, .aCOpRe").First().Text(), Google)
	})
	return results
}

func resultsLookRelevant(query string, results []Result) bool {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" || len(results) == 0 {
		return false
	}
	hay := make([]string, len(results))
	for i, r := range results {
		hay[i] = strings.ToLower(r.Title + " " + r.URL + " " + r.Snippet)
	}
	latin := regexp.MustCompile(`[a-z0-9][a-z0-9.+_-]{2,}`).FindAllString(q, -1)
	if len(latin) > 0 {
		for _, token := range latin {
			t := strings.ToLower(token)
			for _, h := range hay {
				if strings.Contains(h, t) {
					return true
				}
			}
		}
		return false
	}
	compact := strings.ReplaceAll(q, " ", "")
	if len([]rune(compact)) < 2 {
		for _, h := range hay {
			if strings.Contains(h, compact) {
				return true
			}
		}
		return false
	}
	runes := []rune(compact)
	for i := 0; i < len(runes)-1; i++ {
		bigram := string(runes[i : i+2])
		for _, h := range hay {
			if strings.Contains(h, bigram) {
				return true
			}
		}
	}
	return false
}

func (s *Service) searchOne(engine Engine, query string, limit int, profile *browser.ID) (Response, error) {
	time.Sleep(time.Duration(80+rand.Intn(250)) * time.Millisecond)
	switch engine {
	case DuckDuckGo:
		return s.searchDDG(query, limit, profile)
	case Bing:
		return s.searchBing(query, limit, profile)
	case Baidu:
		return s.searchBaidu(query, limit, profile)
	case Google:
		return s.searchGoogle(query, limit, profile)
	default:
		return Response{}, fmt.Errorf("unsupported engine")
	}
}

func (s *Service) searchDDG(query string, limit int, profile *browser.ID) (Response, error) {
	if s.HL != nil && s.HL.Enabled() {
		lite := "https://lite.duckduckgo.com/lite/?q=" + url.QueryEscape(query) + "&kl=wt-wt"
		html, mode, status, err := s.loadHTMLHuman(
			"https://lite.duckduckgo.com/lite/",
			query,
			"input[name='q'], input[type='text']",
			lite,
			"https://duckduckgo.com/",
			"a.result-link, .result-link, a[href*='uddg=']",
			profile,
			28*time.Second,
		)
		if err == nil {
			results := parseDDGLite(html, limit)
			if len(results) == 0 {
				results = parseDDGHtml(html, limit)
			}
			note := ""
			if len(results) == 0 {
				note = maybeAntiBotNote(html, status)
				if note == "" {
					note = "未解析到结果（DDG 可能触发了频率限制）"
				}
			}
			return Response{Query: query, Engine: DuckDuckGo, Results: results, Mode: mode, Note: note}, nil
		}
	}
	body := url.Values{"q": {query}, "kl": {"wt-wt"}}.Encode()
	res, err := browser.FetchAsBrowser("https://html.duckduckgo.com/html/", browser.FetchOptions{
		Method: "POST", Body: body, Profile: profile, Referer: "https://duckduckgo.com/", Timeout: 12 * time.Second,
	})
	if err == nil && res.Status < 400 && !looksLikeAntiBot(res.Body, res.Status) {
		if results := parseDDGHtml(res.Body, limit); len(results) > 0 {
			return Response{Query: query, Engine: DuckDuckGo, Results: results, Mode: "http"}, nil
		}
	}
	lite := "https://lite.duckduckgo.com/lite/?q=" + url.QueryEscape(query) + "&kl=wt-wt"
	liteRes, err := browser.FetchAsBrowser(lite, browser.FetchOptions{Profile: profile, Referer: "https://lite.duckduckgo.com/", Timeout: 12 * time.Second})
	if err != nil {
		return Response{}, err
	}
	if liteRes.Status >= 400 {
		return Response{}, fmt.Errorf("DuckDuckGo HTTP %d", liteRes.Status)
	}
	results := parseDDGLite(liteRes.Body, limit)
	note := ""
	if len(results) == 0 {
		note = maybeAntiBotNote(liteRes.Body, liteRes.Status)
		if note == "" {
			note = "未解析到结果（DDG 可能触发了频率限制）"
		}
	}
	return Response{Query: query, Engine: DuckDuckGo, Results: results, Mode: "http", Note: note}, nil
}

func (s *Service) searchBing(query string, limit int, profile *browser.ID) (Response, error) {
	candidates := []struct{ url, referer, home string }{
		{fmt.Sprintf("https://cn.bing.com/search?q=%s&setlang=zh-CN&ensearch=0&count=%d", url.QueryEscape(query), max(limit, 10)), "https://cn.bing.com/", "https://cn.bing.com/"},
		{fmt.Sprintf("https://www.bing.com/search?q=%s&setlang=zh-CN&ensearch=0&count=%d", url.QueryEscape(query), max(limit, 10)), "https://www.bing.com/", "https://www.bing.com/"},
	}
	lastHTML, lastMode := "", "http"
	lastStatus := 0
	for _, c := range candidates {
		if s.HL == nil || !s.HL.Enabled() {
			_, _ = browser.FetchAsBrowser(c.home, browser.FetchOptions{Profile: profile, Timeout: 8 * time.Second})
			time.Sleep(time.Duration(150+rand.Intn(350)) * time.Millisecond)
		}
		var html, mode string
		var status int
		var err error
		if s.HL != nil && s.HL.Enabled() {
			html, mode, status, err = s.loadHTMLHuman(
				c.home, query, "#sb_form_q, input[name='q']", c.url, c.referer, "li.b_algo", profile, 30*time.Second,
			)
		} else {
			html, mode, status, err = s.loadHTML(c.url, c.referer, "li.b_algo", profile, 25*time.Second, "GET", "")
		}
		if err != nil {
			continue
		}
		lastHTML, lastMode, lastStatus = html, mode, status
		if status >= 400 || looksLikeAntiBot(html, status) {
			continue
		}
		if results := parseBing(html, limit); len(results) > 0 {
			return Response{Query: query, Engine: Bing, Results: results, Mode: mode}, nil
		}
	}
	if lastStatus >= 400 {
		return Response{}, fmt.Errorf("Bing HTTP %d", lastStatus)
	}
	note := maybeAntiBotNote(lastHTML, lastStatus)
	if note == "" {
		note = "未解析到 Bing 有机结果"
	}
	return Response{Query: query, Engine: Bing, Results: nil, Mode: lastMode, Note: note}, nil
}

func (s *Service) searchBaidu(query string, limit int, profile *browser.ID) (Response, error) {
	if s.HL == nil || !s.HL.Enabled() {
		_, _ = browser.FetchAsBrowser("https://www.baidu.com/", browser.FetchOptions{Profile: profile, Timeout: 8 * time.Second})
		time.Sleep(time.Duration(150+rand.Intn(350)) * time.Millisecond)
	}
	pageURL := fmt.Sprintf("https://www.baidu.com/s?wd=%s&rn=%d", url.QueryEscape(query), max(limit, 10))
	var html, mode string
	var status int
	var err error
	if s.HL != nil && s.HL.Enabled() {
		html, mode, status, err = s.loadHTMLHuman(
			"https://www.baidu.com/", query, "#kw, input[name='wd']", pageURL, "https://www.baidu.com/",
			".c-container, #content_left", profile, 30*time.Second,
		)
	} else {
		html, mode, status, err = s.loadHTML(pageURL, "https://www.baidu.com/", ".c-container, #content_left", profile, 25*time.Second, "GET", "")
	}
	if err != nil {
		return Response{}, err
	}
	if status >= 400 {
		return Response{}, fmt.Errorf("Baidu HTTP %d", status)
	}
	if looksLikeAntiBot(html, status) {
		return Response{Query: query, Engine: Baidu, Results: nil, Mode: mode, Note: maybeAntiBotNote(html, status)}, nil
	}
	results := parseBaidu(html, limit)
	note := ""
	if len(results) == 0 {
		note = "未解析到百度有机结果"
	}
	return Response{Query: query, Engine: Baidu, Results: results, Mode: mode, Note: note}, nil
}

func (s *Service) searchGoogle(query string, limit int, profile *browser.ID) (Response, error) {
	pageURL := fmt.Sprintf("https://www.google.com/search?q=%s&hl=zh-CN&num=%d", url.QueryEscape(query), max(limit, 10))
	var html, mode string
	var status int
	var err error
	if s.HL != nil && s.HL.Enabled() {
		html, mode, status, err = s.loadHTMLHuman(
			"https://www.google.com/", query, "textarea[name='q'], input[name='q']", pageURL, "https://www.google.com/",
			"div.g, div#search", profile, 30*time.Second,
		)
	} else {
		html, mode, status, err = s.loadHTML(pageURL, "https://www.google.com/", "div.g, div#search", profile, 25*time.Second, "GET", "")
	}
	if err != nil {
		return Response{}, err
	}
	if status >= 400 {
		return Response{}, fmt.Errorf("Google HTTP %d", status)
	}
	if looksLikeAntiBot(html, status) {
		note := maybeAntiBotNote(html, status)
		if note == "" {
			note = "未解析到结果（Google 反爬较强）"
		}
		return Response{Query: query, Engine: Google, Results: nil, Mode: mode, Note: note}, nil
	}
	results := parseGoogle(html, limit)
	note := ""
	if len(results) == 0 {
		note = "未解析到 Google 有机结果（未使用全站外链兜底，避免无关链接）"
	}
	return Response{Query: query, Engine: Google, Results: results, Mode: mode, Note: note}, nil
}

func (s *Service) Run(query string, engine Engine, limit int, profile *browser.ID) (Response, error) {
	res, err := s.searchOne(engine, query, limit, profile)
	if err != nil {
		return res, err
	}
	if len(res.Results) > 0 && !resultsLookRelevant(query, res.Results) {
		res.Results = nil
		if res.Note == "" {
			res.Note = "解析到的条目与查询关键词关联过弱（可能命中反爬页或错误页），已丢弃并准备换引擎"
		}
	}
	return res, nil
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
