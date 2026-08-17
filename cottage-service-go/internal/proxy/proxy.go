package proxy

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var stripRequestHeaders = map[string]struct{}{
	"host": {}, "connection": {}, "keep-alive": {}, "transfer-encoding": {},
	"te": {}, "trailer": {}, "upgrade": {}, "proxy-authorization": {},
	"proxy-connection": {}, "origin": {}, "referer": {},
	"sec-fetch-site": {}, "sec-fetch-mode": {}, "sec-fetch-dest": {}, "sec-fetch-user": {},
	"sec-ch-ua": {}, "sec-ch-ua-mobile": {}, "sec-ch-ua-platform": {},
	"x-stainless-os": {}, "x-stainless-arch": {}, "x-stainless-runtime": {},
	"x-stainless-package-version": {}, "x-stainless-lang": {},
	"x-stainless-retry-count": {}, "x-stainless-timeout": {},
}

var stripResponseHeaders = map[string]struct{}{
	"content-length": {}, "transfer-encoding": {}, "content-encoding": {}, "connection": {},
}

var llmCORS = map[string]string{
	"Access-Control-Allow-Origin":  "*",
	"Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type,Authorization,x-api-key,anthropic-version,x-goog-api-key,X-Requested-With,Accept",
	"Access-Control-Expose-Headers": "*",
	"Access-Control-Max-Age":       "86400",
}

type Handler struct {
	AllowPrivate bool
	Client       *http.Client
}

func New(allowPrivate bool) *Handler {
	return &Handler{
		AllowPrivate: allowPrivate,
		Client: &http.Client{
			Timeout: 0, // SSE may be long-lived
			Transport: &http.Transport{
				Proxy: http.ProxyFromEnvironment,
				DialContext: (&net.Dialer{
					Timeout:   30 * time.Second,
					KeepAlive: 30 * time.Second,
				}).DialContext,
				ForceAttemptHTTP2:     true,
				MaxIdleConns:          100,
				IdleConnTimeout:       90 * time.Second,
				TLSHandshakeTimeout:   10 * time.Second,
				ExpectContinueTimeout: 1 * time.Second,
				ResponseHeaderTimeout: 120 * time.Second,
			},
		},
	}
}

func isPrivateHost(hostname string) bool {
	h := strings.ToLower(hostname)
	if h == "localhost" || strings.HasSuffix(h, ".localhost") || h == "127.0.0.1" || h == "::1" || h == "0.0.0.0" {
		return true
	}
	if strings.HasSuffix(h, ".local") {
		return true
	}
	ip := net.ParseIP(h)
	if ip != nil {
		return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
	}
	if strings.HasPrefix(h, "10.") || strings.HasPrefix(h, "192.168.") {
		return true
	}
	if len(h) > 4 && strings.HasPrefix(h, "172.") {
		parts := strings.Split(h, ".")
		if len(parts) >= 2 {
			var n int
			fmt.Sscanf(parts[1], "%d", &n)
			if n >= 16 && n <= 31 {
				return true
			}
		}
	}
	return false
}

func ParseTarget(raw string, allowPrivate bool) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf(`Missing or invalid "url"`)
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("Invalid url")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("Only http/https targets are allowed")
	}
	if !allowPrivate && isPrivateHost(u.Hostname()) {
		return nil, &PrivateNetworkError{Host: u.Hostname()}
	}
	return u, nil
}

// PrivateNetworkError is returned when /proxy rejects localhost / RFC1918 targets.
type PrivateNetworkError struct {
	Host string
}

func (e *PrivateNetworkError) Error() string {
	host := e.Host
	if host == "" {
		host = "private"
	}
	return fmt.Sprintf(
		`Private network / localhost target %q is blocked (enable proxyAllowPrivate in Cottage Service, or set COTTAGE_SERVICE_PROXY_ALLOW_PRIVATE=1)`,
		host,
	)
}

const ErrCodePrivateNetworkBlocked = "private_network_blocked"

func writePrivateNetworkBlocked(w http.ResponseWriter, err error) {
	msg := err.Error()
	host := ""
	if pe, ok := err.(*PrivateNetworkError); ok {
		host = pe.Host
	}
	writeJSONError(w, http.StatusForbidden, map[string]any{
		"error":   msg,
		"code":    ErrCodePrivateNetworkBlocked,
		"blocked": true,
		"host":    host,
		"hint":    "Enable「允许代理访问内网 / localhost」in the Cottage Service console, or set COTTAGE_SERVICE_PROXY_ALLOW_PRIVATE=1",
	})
}

func sanitizeForwardHeaders(raw map[string]string) http.Header {
	out := http.Header{}
	for k, v := range raw {
		lower := strings.ToLower(k)
		if _, ok := stripRequestHeaders[lower]; ok {
			continue
		}
		if strings.HasPrefix(lower, "x-stainless-") {
			continue
		}
		if v != "" {
			out.Set(k, v)
		}
	}
	return out
}

func writeLLMCors(w http.ResponseWriter) {
	for k, v := range llmCORS {
		w.Header().Set(k, v)
	}
}

func writeJSONError(w http.ResponseWriter, status int, payload any) {
	writeLLMCors(w)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

type requestBody struct {
	URL          any               `json:"url"`
	Method       any               `json:"method"`
	Headers      map[string]string `json:"headers"`
	Body         any               `json:"body"`
	BodyEncoding any               `json:"bodyEncoding"`
	Stream       any               `json:"stream"`
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		writeLLMCors(w)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}

	var payload requestBody
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeJSONError(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON body"})
		return
	}

	urlStr, _ := payload.URL.(string)
	target, err := ParseTarget(urlStr, h.AllowPrivate)
	if err != nil {
		if _, ok := err.(*PrivateNetworkError); ok {
			writePrivateNetworkBlocked(w, err)
			return
		}
		writeJSONError(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	method := "GET"
	if m, ok := payload.Method.(string); ok && strings.TrimSpace(m) != "" {
		method = strings.ToUpper(strings.TrimSpace(m))
	}

	bodyEncoding := ""
	if enc, ok := payload.BodyEncoding.(string); ok {
		bodyEncoding = strings.ToLower(strings.TrimSpace(enc))
	}

	var bodyReader io.Reader
	var bodyStr string
	if payload.Body != nil && method != "GET" && method != "HEAD" {
		switch v := payload.Body.(type) {
		case string:
			bodyStr = v
		default:
			b, _ := json.Marshal(v)
			bodyStr = string(b)
		}
		if bodyEncoding == "base64" {
			decoded, decErr := base64.StdEncoding.DecodeString(bodyStr)
			if decErr != nil {
				// Also accept URL-safe / raw without padding from browsers
				decoded, decErr = base64.RawStdEncoding.DecodeString(bodyStr)
			}
			if decErr != nil {
				writeJSONError(w, http.StatusBadRequest, map[string]string{
					"error": "Invalid base64 body (bodyEncoding=base64)",
				})
				return
			}
			bodyReader = bytes.NewReader(decoded)
		} else {
			bodyReader = strings.NewReader(bodyStr)
		}
	}

	streamHint := false
	if b, ok := payload.Stream.(bool); ok && b {
		streamHint = true
	}
	if !streamHint && bodyEncoding != "base64" && bodyStr != "" {
		var probe struct {
			Stream bool `json:"stream"`
		}
		if json.Unmarshal([]byte(bodyStr), &probe) == nil && probe.Stream {
			streamHint = true
		}
	}

	req, err := http.NewRequestWithContext(r.Context(), method, target.String(), bodyReader)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	req.Header = sanitizeForwardHeaders(payload.Headers)

	upstream, err := h.Client.Do(req)
	if err != nil {
		log.Printf("Proxy error for %s: %v", target, err)
		writeJSONError(w, http.StatusBadGateway, map[string]string{
			"error":   "Upstream request failed",
			"message": err.Error(),
		})
		return
	}
	defer upstream.Body.Close()

	ct := upstream.Header.Get("Content-Type")
	isStreaming := upstream.StatusCode >= 200 && upstream.StatusCode < 300 &&
		(streamHint || strings.Contains(ct, "text/event-stream"))

	for k, vals := range upstream.Header {
		if _, strip := stripResponseHeaders[strings.ToLower(k)]; strip {
			continue
		}
		for _, v := range vals {
			w.Header().Add(k, v)
		}
	}
	writeLLMCors(w)
	if isStreaming {
		if !strings.Contains(w.Header().Get("Content-Type"), "event-stream") {
			w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		}
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
	}

	log.Printf("PROXY %s %s%s -> %d%s", method, target.Host, target.Path, upstream.StatusCode, map[bool]string{true: " (stream)", false: ""}[isStreaming])

	w.WriteHeader(upstream.StatusCode)
	if flusher, ok := w.(http.Flusher); ok {
		buf := make([]byte, 32*1024)
		for {
			n, readErr := upstream.Body.Read(buf)
			if n > 0 {
				_, _ = w.Write(buf[:n])
				flusher.Flush()
			}
			if readErr != nil {
				break
			}
		}
		return
	}
	_, _ = io.Copy(w, upstream.Body)
}
