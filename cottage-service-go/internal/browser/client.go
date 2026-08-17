package browser

import (
	"compress/flate"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/andybalholm/brotli"
)

type ID string

const (
	ChromeWin  ID = "chrome-win"
	ChromeMac  ID = "chrome-mac"
	EdgeWin    ID = "edge-win"
	FirefoxWin ID = "firefox-win"
)

type Profile struct {
	ID              ID
	UserAgent       string
	SecChUa         string
	SecChUaMobile   string
	SecChUaPlatform string
	Accept          string
	AcceptLanguage  string
	HasClientHints  bool
}

var profiles = []Profile{
	{
		ID: ChromeWin,
		UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		SecChUa: `"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"`,
		SecChUaMobile: "?0", SecChUaPlatform: `"Windows"`,
		Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
		AcceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8", HasClientHints: true,
	},
	{
		ID: ChromeMac,
		UserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		SecChUa: `"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"`,
		SecChUaMobile: "?0", SecChUaPlatform: `"macOS"`,
		Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
		AcceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8", HasClientHints: true,
	},
	{
		ID: EdgeWin,
		UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
		SecChUa: `"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"`,
		SecChUaMobile: "?0", SecChUaPlatform: `"Windows"`,
		Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
		AcceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8", HasClientHints: true,
	},
	{
		ID: FirefoxWin,
		UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
		Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
		AcceptLanguage: "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7", HasClientHints: false,
	},
}

func ListProfiles() []ID {
	out := make([]ID, len(profiles))
	for i, p := range profiles {
		out[i] = p.ID
	}
	return out
}

func ParseID(raw string) (ID, bool) {
	for _, p := range profiles {
		if string(p.ID) == raw {
			return p.ID, true
		}
	}
	return "", false
}

func pickProfile(id *ID) Profile {
	if id != nil {
		for _, p := range profiles {
			if p.ID == *id {
				return p
			}
		}
	}
	return profiles[rand.Intn(len(profiles))]
}

var (
	cookieMu  sync.Mutex
	cookieJar = map[string]string{}
)

func ClearCookies(host string) string {
	cookieMu.Lock()
	defer cookieMu.Unlock()
	if host == "" {
		cookieJar = map[string]string{}
		return "all"
	}
	delete(cookieJar, host)
	return host
}

func mergeCookies(host string, setCookies []string) {
	if len(setCookies) == 0 {
		return
	}
	cookieMu.Lock()
	defer cookieMu.Unlock()
	m := map[string]string{}
	if existing := cookieJar[host]; existing != "" {
		for _, part := range strings.Split(existing, "; ") {
			if i := strings.IndexByte(part, '='); i > 0 {
				m[part[:i]] = part[i+1:]
			}
		}
	}
	for _, raw := range setCookies {
		first := strings.TrimSpace(strings.Split(raw, ";")[0])
		if i := strings.IndexByte(first, '='); i > 0 {
			m[first[:i]] = first[i+1:]
		}
	}
	parts := make([]string, 0, len(m))
	for k, v := range m {
		parts = append(parts, k+"="+v)
	}
	cookieJar[host] = strings.Join(parts, "; ")
}

func cookieHeaderFor(host string) string {
	cookieMu.Lock()
	defer cookieMu.Unlock()
	return cookieJar[host]
}

type FetchOptions struct {
	Method       string
	Body         string
	ContentType  string
	Profile      *ID
	Referer      string
	Headers      map[string]string
	Timeout      time.Duration
	MaxRedirects int
}

type FetchResult struct {
	FinalURL  string
	Status    int
	Headers   http.Header
	Body      string
	Profile   ID
	Redirects []string
}

func siteRelation(fromURL, toURL string) string {
	a, err1 := url.Parse(fromURL)
	b, err2 := url.Parse(toURL)
	if err1 != nil || err2 != nil {
		return "cross-site"
	}
	if a.Scheme+"://"+a.Host == b.Scheme+"://"+b.Host {
		return "same-origin"
	}
	reg := func(h string) string {
		parts := strings.Split(h, ".")
		if len(parts) >= 2 {
			return strings.Join(parts[len(parts)-2:], ".")
		}
		return h
	}
	if a.Hostname() == b.Hostname() || reg(a.Hostname()) == reg(b.Hostname()) {
		return "same-site"
	}
	return "cross-site"
}

func buildHeaders(p Profile, referer, contentType string, isPost bool, fetchSite string) http.Header {
	h := http.Header{}
	h.Set("Accept", p.Accept)
	h.Set("Accept-Language", p.AcceptLanguage)
	h.Set("Accept-Encoding", "gzip, deflate, br")
	h.Set("User-Agent", p.UserAgent)
	h.Set("Cache-Control", "max-age=0")
	h.Set("Upgrade-Insecure-Requests", "1")
	if p.HasClientHints {
		h.Set("Sec-Ch-Ua", p.SecChUa)
		h.Set("Sec-Ch-Ua-Mobile", p.SecChUaMobile)
		h.Set("Sec-Ch-Ua-Platform", p.SecChUaPlatform)
	}
	h.Set("Sec-Fetch-Dest", "document")
	h.Set("Sec-Fetch-Mode", "navigate")
	h.Set("Sec-Fetch-Site", fetchSite)
	if referer == "" {
		h.Set("Sec-Fetch-User", "?1")
	} else {
		h.Set("Referer", referer)
	}
	if isPost {
		ct := contentType
		if ct == "" {
			ct = "application/x-www-form-urlencoded; charset=UTF-8"
		}
		h.Set("Content-Type", ct)
	}
	return h
}

func decodeBody(resp *http.Response) ([]byte, error) {
	var r io.Reader = resp.Body
	switch strings.ToLower(resp.Header.Get("Content-Encoding")) {
	case "gzip":
		gr, err := gzip.NewReader(resp.Body)
		if err != nil {
			return nil, err
		}
		defer gr.Close()
		r = gr
	case "deflate":
		r = flate.NewReader(resp.Body)
	case "br":
		r = brotli.NewReader(resp.Body)
	}
	return io.ReadAll(r)
}

func FetchAsBrowser(rawURL string, opts FetchOptions) (*FetchResult, error) {
	profile := pickProfile(opts.Profile)
	maxRedirects := opts.MaxRedirects
	if maxRedirects <= 0 {
		maxRedirects = 5
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	isPost := strings.EqualFold(opts.Method, "POST")
	currentURL := rawURL
	referer := opts.Referer
	lastSite := "none"
	redirects := []string{}

	client := &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	for hop := 0; hop <= maxRedirects; hop++ {
		time.Sleep(time.Duration(80+rand.Intn(240)) * time.Millisecond)
		u, err := url.Parse(currentURL)
		if err != nil {
			return nil, err
		}
		fetchSite := "none"
		if referer != "" {
			fetchSite = lastSite
		}
		headers := buildHeaders(profile, referer, opts.ContentType, isPost && hop == 0, fetchSite)
		if c := cookieHeaderFor(u.Host); c != "" {
			headers.Set("Cookie", c)
		}
		for k, v := range opts.Headers {
			headers.Set(k, v)
		}

		method := http.MethodGet
		var bodyReader io.Reader
		if isPost && hop == 0 {
			method = http.MethodPost
			bodyReader = strings.NewReader(opts.Body)
		}

		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		req, err := http.NewRequestWithContext(ctx, method, currentURL, bodyReader)
		if err != nil {
			cancel()
			return nil, err
		}
		req.Header = headers

		resp, err := client.Do(req)
		if err != nil {
			cancel()
			return nil, fmt.Errorf("浏览器模拟请求失败 (%s): %w", currentURL, err)
		}

		setCookies := resp.Header.Values("Set-Cookie")
		mergeCookies(u.Host, setCookies)

		status := resp.StatusCode
		if status >= 300 && status < 400 {
			loc := resp.Header.Get("Location")
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			cancel()
			if loc == "" {
				return &FetchResult{FinalURL: currentURL, Status: status, Headers: resp.Header, Body: "", Profile: profile.ID, Redirects: redirects}, nil
			}
			next, err := url.Parse(loc)
			if err != nil {
				return nil, err
			}
			nextURL := u.ResolveReference(next).String()
			redirects = append(redirects, nextURL)
			lastSite = siteRelation(currentURL, nextURL)
			referer = currentURL
			currentURL = nextURL
			isPost = false // 302/303 style: subsequent as GET for simplicity on 302/303; 307 would keep method but OK for search
			continue
		}

		raw, err := decodeBody(resp)
		resp.Body.Close()
		cancel()
		if err != nil {
			return nil, err
		}
		return &FetchResult{
			FinalURL:  currentURL,
			Status:    status,
			Headers:   resp.Header,
			Body:      string(raw),
			Profile:   profile.ID,
			Redirects: redirects,
		}, nil
	}
	return nil, fmt.Errorf("too many redirects for %s", rawURL)
}
