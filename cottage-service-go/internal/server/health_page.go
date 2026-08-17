package server

import (
	"net/http"
)

// handleRoot serves a browser-facing status page for confirming HTTPS access.
// Programmatic health checks stay on GET /health (JSON).
func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(healthPageHTML()))
}

func healthPageHTML() string {
	return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Cottage Service · 健康检查</title>
<style>
  :root {
    --bg: #101210; --surface: #171917;
    --ink: #e8eae7; --muted: #8e948e;
    --border: #3a403a; --primary: #607b66;
    --accent-bg: #1a211c; --accent-border: rgba(143,173,150,.36);
    --ok: #7fad8a; --radius: 7px;
    --font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Helvetica Neue", sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; font: 14px/1.6 var(--font); color: var(--ink);
    background: var(--bg); -webkit-font-smoothing: antialiased;
    display: flex; align-items: center; justify-content: center; padding: 24px 16px;
  }
  .card {
    width: 100%; max-width: 360px; background: var(--surface);
    border: 1px solid var(--border); border-radius: var(--radius); padding: 28px 24px;
    box-shadow: 0 8px 28px rgba(0,0,0,.28); text-align: center;
  }
  .badge {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 10px 14px; border-radius: var(--radius);
    background: var(--accent-bg); border: 1px solid var(--accent-border);
    color: var(--ok); font-weight: 600; font-size: 15px; margin-bottom: 12px;
  }
  .badge i {
    width: 8px; height: 8px; border-radius: 50%; background: var(--ok);
    box-shadow: 0 0 0 3px rgba(127,173,138,.28);
  }
  .lead { color: var(--muted); margin: 0 0 20px; font-size: 13px; }
  button {
    width: 100%; height: 36px; border: 0; border-radius: var(--radius);
    background: var(--primary); color: #fff; font: 600 13px/1 var(--font);
    cursor: pointer;
  }
  button:hover { background: #4c6452; }
  .hint { display: none; margin-top: 12px; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
  <div class="card">
    <div class="badge"><i></i> 证书已信任 · 服务正常</div>
    <p class="lead">可以关闭本页，回到 Open Cottage 连接服务。</p>
    <button type="button" id="btnClose">关闭</button>
    <div class="hint" id="hint">若未自动关闭，请手动关闭此标签页。</div>
  </div>
<script>
document.getElementById('btnClose').onclick = () => {
  window.close();
  setTimeout(() => { document.getElementById('hint').style.display = 'block'; }, 200);
};
</script>
</body>
</html>`
}
