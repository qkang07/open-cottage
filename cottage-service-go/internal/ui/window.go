package ui

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/open-cottage/cottage-service-go/internal/appctl"
	"github.com/open-cottage/cottage-service-go/internal/applog"
	"github.com/open-cottage/cottage-service-go/internal/config"
	"github.com/open-cottage/cottage-service-go/internal/notify"
	"github.com/open-cottage/cottage-service-go/internal/singleinstance"
	"github.com/open-cottage/cottage-service-go/internal/tlsutil"
	"github.com/open-cottage/cottage-service-go/internal/tray"
)

func pageHTML(configPath string) string {
	return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Cottage Service · 控制台</title>
<style>
  :root {
    --bg: #101210;
    --surface: #171917;
    --sunken: #0b0d0b;
    --ink: #e8eae7;
    --ink-soft: #b9beb9;
    --muted: #8e948e;
    --border: #3a403a;
    --border-strong: #4c544c;
    --primary: #607b66;
    --accent: #8fad96;
    --accent-hover: #73917a;
    --accent-bg: #1a211c;
    --accent-border: rgba(143,173,150,.36);
    --gold: #d0b67e;
    --warning: #d4965c;
    --ok: #7fad8a;
    --bad: #d48484;
    --radius: 7px;
    --shadow: 0 8px 28px rgba(0,0,0,.28);
    --font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Helvetica Neue", sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    font: 14px/1.6 var(--font);
    color: var(--ink);
    background: var(--bg);
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 560px; margin: 0 auto; padding: 28px 18px 48px; }

  .brand {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 22px;
  }
  .brand svg { width: 36px; height: 36px; flex: 0 0 auto; }
  .brand h1 {
    font-size: 18px; font-weight: 600; margin: 0;
    letter-spacing: .01em; color: var(--ink);
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .brand .tag {
    display: inline-block; font-size: 11px; font-weight: 600;
    letter-spacing: .04em; padding: 2px 8px; border-radius: 999px;
    color: var(--gold); background: rgba(208,182,126,.12);
    border: 1px solid rgba(208,182,126,.35);
  }
  .brand .sub { margin: 2px 0 0; color: var(--muted); font-size: 13px; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    margin-bottom: 12px;
    box-shadow: var(--shadow);
  }
  .section-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 15px; font-weight: 600; margin: 0 0 14px; color: var(--ink);
  }
  .section-title::before {
    content: ""; width: 3px; height: 14px; border-radius: 2px;
    background: var(--accent); flex: 0 0 auto;
  }

  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .status-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--muted);
    box-shadow: 0 0 0 3px rgba(142,148,142,.18);
  }
  .status-dot.on {
    background: var(--ok);
    box-shadow: 0 0 0 3px rgba(127,173,138,.28);
  }
  .status-label { font-weight: 600; color: var(--ink); }
  .muted { color: var(--muted); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { color: var(--accent-hover); text-decoration: underline; }

  label.field {
    display: block; color: var(--muted);
    font-size: 13px; font-weight: 400; margin-bottom: 6px;
  }
  input[type=text], input[type=number], select {
    width: 100%; height: 32px; padding: 0 10px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--sunken); color: var(--ink);
    font: 14px/1.4 var(--font);
    outline: none; transition: border-color .15s, box-shadow .15s;
  }
  input:focus, select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(143,173,150,.18);
  }
  input::placeholder { color: #757c75; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 480px) { .grid { grid-template-columns: 1fr; } }

  .check {
    display: flex; gap: 8px; align-items: center;
    margin: 10px 0; color: var(--ink-soft); font-size: 13px; cursor: pointer;
  }
  .check input {
    width: 14px; height: 14px; accent-color: var(--primary); cursor: pointer;
  }

  .actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 14px; }
  .actions.two { grid-template-columns: 1fr 1fr; }
  button {
    height: 32px; border: 1px solid var(--border); border-radius: var(--radius);
    padding: 0 12px; cursor: pointer;
    background: var(--surface); color: var(--ink);
    font: 600 13px/1 var(--font);
    transition: background .15s, border-color .15s, color .15s;
  }
  button:hover:not(:disabled) {
    background: var(--accent-bg);
    border-color: var(--border-strong);
  }
  button.primary {
    background: var(--primary); border-color: var(--primary); color: #fff;
  }
  button.primary:hover:not(:disabled) {
    background: #4c6452; border-color: #4c6452;
  }
  button.danger {
    background: transparent; border-color: rgba(212,132,132,.45); color: var(--bad);
  }
  button.danger:hover:not(:disabled) {
    background: rgba(212,132,132,.12); border-color: var(--bad);
  }
  button:disabled { opacity: .4; cursor: not-allowed; }
  button.health {
    height: 40px; width: 100%;
    background: var(--gold); border-color: var(--gold); color: #1a1710;
    font-size: 14px; font-weight: 700; letter-spacing: .02em;
  }
  button.health:hover:not(:disabled) {
    background: #ddc48c; border-color: #ddc48c; color: #1a1710;
  }

  .msg { margin-top: 12px; min-height: 1.4em; color: var(--muted); white-space: pre-wrap; font-size: 13px; }
  .msg.err { color: var(--bad); }
  .path {
    font: 12px/1.5 var(--mono); color: var(--muted);
    word-break: break-all; margin-top: 10px;
    padding-top: 10px; border-top: 1px solid var(--border);
  }

  .tip {
    display: none; margin-top: 12px; padding: 12px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--accent-border);
    background: var(--accent-bg);
    font-size: 13px;
  }
  .tip.show { display: block; }
  .tip strong { color: var(--accent); font-weight: 600; }
  .tip .lead { margin-top: 4px; color: var(--ink-soft); }
  .tip ol { margin: 8px 0 0; padding-left: 1.25em; color: var(--muted); }
  .tip li { margin: 4px 0; }
  .tip code {
    font: 12px/1.4 var(--mono); color: var(--ink);
    background: var(--sunken); padding: 1px 6px; border-radius: 4px;
    border: 1px solid var(--border);
  }
  .tip.attention {
    border-color: rgba(208,182,126,.55);
    background: rgba(208,182,126,.12);
    animation: tipPulse 1.1s ease 3;
  }
  .tip.attention strong { color: var(--gold); }
  @keyframes tipPulse {
    0%, 100% { box-shadow: 0 0 0 0 transparent; }
    50% { box-shadow: 0 0 0 4px rgba(208,182,126,.28); }
  }

  .section-title.row-between {
    justify-content: space-between; margin-bottom: 10px;
  }
  .section-title.row-between::before { display: none; }
  .section-title .left {
    display: flex; align-items: center; gap: 8px;
  }
  .section-title .left::before {
    content: ""; width: 3px; height: 14px; border-radius: 2px;
    background: var(--accent); flex: 0 0 auto;
  }
  .log-tools { display: flex; gap: 6px; flex-wrap: wrap; }
  .log-tools button { height: 28px; font-size: 12px; padding: 0 10px; }
  .log-view {
    margin: 0; height: 220px; overflow: auto;
    padding: 10px 12px; border-radius: var(--radius);
    border: 1px solid var(--border); background: var(--sunken);
    font: 12px/1.45 var(--mono); color: var(--ink-soft);
    white-space: pre-wrap; word-break: break-word;
  }
  .log-view:empty::before {
    content: "暂无日志"; color: var(--muted);
  }
  .log-meta {
    margin-top: 8px; font: 12px/1.4 var(--mono); color: var(--muted);
    word-break: break-all;
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="brand">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" aria-hidden="true">
      <path d="M 16 108 L 16 56 Q 16 44 26 36 L 52 18 Q 60 13 68 18 L 94 36 Q 104 44 104 56 L 104 108"
        fill="none" stroke="#8fad96" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M 60 46 C 60 62 68 70 84 70 C 68 70 60 78 60 94 C 60 78 52 70 36 70 C 52 70 60 62 60 46 Z"
        fill="#d0b67e"/>
    </svg>
    <div>
      <h1>Cottage Service <span class="tag">控制台</span></h1>
      <div class="sub">启停服务与修改配置 · 不是健康检查页</div>
    </div>
  </header>

  <div class="tip show" id="tlsTip" style="margin-bottom:12px">
    <strong id="tlsTipTitle">信任 HTTPS 证书</strong>
    <div class="lead" id="tlsTipLead">TLS 为 auto 时使用持久化本机 CA。可从系统托盘菜单选择「尝试信任本机 CA」，写入当前用户信任库后重新打开服务页面。</div>
    <div style="margin-top:14px">
      <button id="btnHealth" class="health" type="button">打开 HTTPS 状态页</button>
    </div>
    <div class="lead" style="margin-top:8px">地址：<code id="tlsTipUrl">https://127.0.0.1:8787/</code></div>
  </div>

  <div class="card">
    <div class="section-title">运行状态</div>
    <div class="row">
      <div id="dot" class="status-dot"></div>
      <span class="status-label" id="state">连接中…</span>
      <span class="muted" id="url"></span>
    </div>
    <div class="msg err" id="error"></div>
  </div>

  <div class="card">
    <div class="section-title">服务配置</div>
    <div class="grid">
      <div>
        <label class="field">监听地址</label>
        <input id="host" type="text"/>
      </div>
      <div>
        <label class="field">端口</label>
        <input id="port" type="number" min="1" max="65535"/>
      </div>
      <div>
        <label class="field">TLS</label>
        <select id="tlsMode">
          <option value="auto">auto（持久化本机 CA）</option>
          <option value="off">off（HTTP）</option>
        </select>
      </div>
      <div>
        <label class="field">无头浏览器</label>
        <select id="headlessMode">
          <option value="auto">auto</option>
          <option value="on">on</option>
          <option value="off">off</option>
        </select>
      </div>
    </div>
    <div style="margin-top:12px">
      <label class="field">浏览器路径（可选）</label>
      <input id="browserPath" type="text" placeholder="Chrome / Edge 可执行文件"/>
    </div>
    <label class="check"><input id="proxyAllowPrivate" type="checkbox"/> 允许代理访问内网 / localhost</label>
    <label class="check"><input id="autoStart" type="checkbox"/> 打开控制台时自动启动服务</label>

    <div class="actions">
      <button class="primary" id="btnStart">启动</button>
      <button class="danger" id="btnStop">停止</button>
      <button id="btnSave">保存配置</button>
    </div>
    <div style="margin-top:14px">
      <button id="btnRefresh" style="width:100%">刷新状态</button>
    </div>
    <div class="msg" id="msg"></div>
    <div class="path" id="cfgPath">配置文件: ` + configPath + `</div>
  </div>

  <div class="card">
    <div class="section-title row-between">
      <div class="left">运行日志</div>
      <div class="log-tools">
        <button id="btnLogPause" type="button">暂停</button>
        <button id="btnLogClear" type="button">清空显示</button>
        <button id="btnLogCopy" type="button">复制</button>
      </div>
    </div>
    <pre class="log-view" id="logView"></pre>
    <div class="log-meta" id="logPath"></div>
  </div>
</div>
<script>
async function api(path, opts) {
  let r;
  try {
    r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  } catch (e) {
    throw new Error('无法连接控制台服务（请确认程序仍在运行，且不要用管理员权限启动）');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText || ('HTTP ' + r.status));
  return j;
}
function fill(cfg) {
  host.value = cfg.host || '';
  port.value = cfg.port || 8787;
  tlsMode.value = cfg.tlsMode === 'off' ? 'off' : 'auto';
  headlessMode.value = ['auto','on','off'].includes(cfg.headlessMode) ? cfg.headlessMode : 'auto';
  browserPath.value = cfg.browserPath || '';
  proxyAllowPrivate.checked = !!cfg.proxyAllowPrivate;
  autoStart.checked = !!cfg.autoStart;
}
function formCfg() {
  return {
    host: host.value.trim(),
    port: Number(port.value),
    tlsMode: tlsMode.value,
    headlessMode: headlessMode.value,
    browserPath: browserPath.value.trim(),
    proxyAllowPrivate: proxyAllowPrivate.checked,
    autoStart: autoStart.checked,
  };
}
const TLS_TIP_DEFAULT =
  'TLS 为 auto 时使用持久化本机 CA。可从系统托盘菜单选择「尝试信任本机 CA」，写入当前用户信任库后重新打开服务页面。';
const TLS_TIP_AFTER_RESTART =
  '配置已生效并重启服务。若本机 CA 已写入用户信任库，证书会继续有效；否则请从系统托盘菜单尝试信任本机 CA。';
function clearTlsAttention() {
  tlsTip.classList.remove('attention');
  tlsTipTitle.textContent = '信任 HTTPS 证书';
  tlsTipLead.textContent = TLS_TIP_DEFAULT;
}
function remindHttpsAfterRestart() {
  tlsTip.classList.add('show', 'attention');
  tlsTipTitle.textContent = 'HTTPS 配置已更新';
  tlsTipLead.textContent = TLS_TIP_AFTER_RESTART;
  tlsTip.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function paint(st) {
  dot.classList.toggle('on', !!st.running);
  state.textContent = st.running ? '运行中' : '已停止';
  url.innerHTML = st.baseUrl ? '<a href="'+st.baseUrl+'/" target="_blank" rel="noreferrer">'+st.baseUrl+'</a>' : '';
  error.textContent = st.error || '';
  btnStart.disabled = !!st.running;
  btnStop.disabled = !st.running;
  if (st.configPath) cfgPath.textContent = '配置文件: ' + st.configPath;
  const tlsOn = (st.config && st.config.tlsMode !== 'off') || (st.baseUrl || '').startsWith('https:');
  tlsTip.classList.toggle('show', tlsOn);
  if (!tlsOn) clearTlsAttention();
  const health = st.baseUrl ? (st.baseUrl + '/')
    : ('https://' + (host.value.trim() || '127.0.0.1') + ':' + (port.value || 8787) + '/');
  tlsTipUrl.textContent = health;
}
tlsMode.onchange = () => {
  const on = tlsMode.value !== 'off';
  tlsTip.classList.toggle('show', on);
  if (!on) clearTlsAttention();
};
async function refresh() {
  const st = await api('/api/status');
  paint(st);
  if (st.config) fill(st.config);
}
btnStart.onclick = async () => {
  msg.textContent = '正在启动…';
  try {
    await api('/api/config', { method: 'POST', body: JSON.stringify(formCfg()) });
    const st = await api('/api/start', { method: 'POST', body: '{}' });
    paint(st); msg.textContent = '服务已启动';
  } catch (e) { msg.textContent = '启动失败: ' + e.message; }
};
btnStop.onclick = async () => {
  msg.textContent = '正在停止…';
  try {
    const st = await api('/api/stop', { method: 'POST', body: '{}' });
    paint(st); msg.textContent = '服务已停止';
  } catch (e) { msg.textContent = '停止失败: ' + e.message; }
};
btnSave.onclick = async () => {
  msg.textContent = '正在保存…';
  try {
    const st = await api('/api/config', { method: 'POST', body: JSON.stringify(Object.assign(formCfg(), { restart: true })) });
    paint(st);
    const tlsOn = tlsMode.value !== 'off' || (st.baseUrl || '').startsWith('https:');
    if (st.restarted && tlsOn) {
      remindHttpsAfterRestart();
      msg.textContent = '配置已保存并重启。请重新做一次 HTTPS 健康检查（点上方「打开健康检查」）。';
    } else if (st.restarted) {
      clearTlsAttention();
      msg.textContent = '配置已保存并重启';
    } else {
      msg.textContent = '配置已保存' + (st.running ? '（无需重启）' : '');
    }
  } catch (e) { msg.textContent = '保存失败: ' + e.message; }
};
btnHealth.onclick = async () => {
  try {
    const st = await api('/api/status');
    if (st.running && st.baseUrl) {
      clearTlsAttention();
      window.open(st.baseUrl + '/', '_blank');
    } else msg.textContent = '服务未运行';
  } catch (e) { msg.textContent = e.message; }
};
btnRefresh.onclick = () => refresh().catch(e => { msg.textContent = e.message; });
refresh().catch(e => { state.textContent = '控制台离线'; msg.textContent = e.message; });
setInterval(() => refresh().catch(() => {}), 3000);

let logSeq = 0;
let logPaused = false;
let logFollow = true;
const logView = document.getElementById('logView');
const logPath = document.getElementById('logPath');
logView.addEventListener('scroll', () => {
  const gap = logView.scrollHeight - logView.scrollTop - logView.clientHeight;
  logFollow = gap < 40;
});
btnLogPause.onclick = () => {
  logPaused = !logPaused;
  btnLogPause.textContent = logPaused ? '继续' : '暂停';
};
btnLogClear.onclick = () => { logView.textContent = ''; };
btnLogCopy.onclick = async () => {
  try {
    await navigator.clipboard.writeText(logView.textContent || '');
    msg.textContent = '日志已复制';
  } catch (e) { msg.textContent = '复制失败: ' + e.message; }
};
async function pullLogs(reset) {
  if (logPaused && !reset) return;
  const q = reset ? '' : ('?after=' + logSeq);
  const st = await api('/api/logs' + q);
  if (st.path) logPath.textContent = '日志文件: ' + st.path;
  const lines = st.lines || [];
  if (st.full || reset) {
    logView.textContent = lines.length ? (lines.join('\n') + '\n') : '';
  } else if (lines.length) {
    logView.textContent += lines.join('\n') + '\n';
  }
  if (typeof st.seq === 'number') logSeq = st.seq;
  if (logFollow) logView.scrollTop = logView.scrollHeight;
}
pullLogs(true).catch(() => {});
setInterval(() => pullLogs(false).catch(() => {}), 1000);
</script>
</body>
</html>`
}

type Admin struct {
	ctrl    *appctl.Controller
	uiPort  int
	ln      net.Listener
	srv     *http.Server
	mu      sync.Mutex
	baseURL string
}

func NewAdmin(ctrl *appctl.Controller, uiPort int) *Admin {
	if uiPort <= 0 {
		uiPort = 18787
	}
	return &Admin{ctrl: ctrl, uiPort: uiPort}
}

func (a *Admin) BaseURL() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.baseURL
}

func (a *Admin) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(pageHTML(config.FilePath())))
	})
	mux.HandleFunc("/api/status", a.handleStatus)
	mux.HandleFunc("/api/start", a.handleStart)
	mux.HandleFunc("/api/stop", a.handleStop)
	mux.HandleFunc("/api/config", a.handleConfig)
	mux.HandleFunc("/api/logs", a.handleLogs)

	var ln net.Listener
	var err error
	for i := 0; i <= 20; i++ {
		addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(a.uiPort+i))
		ln, err = net.Listen("tcp", addr)
		if err == nil {
			break
		}
	}
	if err != nil {
		return err
	}
	a.ln = ln
	a.mu.Lock()
	a.baseURL = "http://" + ln.Addr().String()
	a.mu.Unlock()
	a.srv = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	if err := singleinstance.WriteUIEndpoint(a.BaseURL()); err != nil {
		log.Printf("[ui] write ui endpoint: %v", err)
	}
	go func() {
		if err := a.srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("[ui] admin server: %v", err)
		}
	}()
	log.Printf("[ui] control panel %s", a.BaseURL())
	return nil
}

func (a *Admin) WaitReady(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 500 * time.Millisecond}
	for time.Now().Before(deadline) {
		resp, err := client.Get(a.BaseURL() + "/api/status")
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == 200 {
				return true
			}
		}
		time.Sleep(80 * time.Millisecond)
	}
	return false
}

func (a *Admin) OpenBrowser() {
	tray.OpenURL(a.BaseURL())
}

func (a *Admin) Shutdown() {
	singleinstance.ClearUIEndpoint()
	if a.srv == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = a.srv.Shutdown(ctx)
}

func (a *Admin) writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (a *Admin) statusPayload() map[string]any {
	st := a.ctrl.Status()
	cfg := a.ctrl.Config()
	base := ""
	if st.Running {
		base = st.BaseURL
		if base == "" {
			base = a.ctrl.BaseURL()
		}
	}
	return map[string]any{
		"running":    st.Running,
		"baseUrl":    base,
		"tlsMsg":     st.TLSMsg,
		"error":      st.Error,
		"config":     cfg,
		"configPath": config.FilePath(),
	}
}

func (a *Admin) handleStatus(w http.ResponseWriter, r *http.Request) {
	a.writeJSON(w, http.StatusOK, a.statusPayload())
}

func (a *Admin) handleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		a.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	if err := a.ctrl.Start(); err != nil {
		a.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	a.writeJSON(w, http.StatusOK, a.statusPayload())
}

func (a *Admin) handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		a.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	_ = a.ctrl.Stop()
	a.writeJSON(w, http.StatusOK, a.statusPayload())
}

func (a *Admin) handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		a.writeJSON(w, http.StatusOK, a.statusPayload())
		return
	}
	if r.Method != http.MethodPost {
		a.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	var body struct {
		config.Config
		Restart bool `json:"restart"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		a.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	cfg := body.Config
	if cfg.Host == "" {
		cfg.Host = "127.0.0.1"
	}
	if cfg.Port <= 0 {
		cfg.Port = 8787
	}
	restarted, err := a.ctrl.ApplyAndMaybeRestart(cfg, body.Restart)
	if err != nil {
		a.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	payload := a.statusPayload()
	payload["restarted"] = restarted
	a.writeJSON(w, http.StatusOK, payload)
}

func (a *Admin) handleLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		a.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	var after uint64
	if raw := r.URL.Query().Get("after"); raw != "" {
		n, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			a.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid after"})
			return
		}
		after = n
	}
	lines, seq, path, full := applog.Snapshot(after)
	if lines == nil {
		lines = []string{}
	}
	a.writeJSON(w, http.StatusOK, map[string]any{
		"lines": lines,
		"seq":   seq,
		"path":  path,
		"full":  full,
	})
}

// Run starts the control panel (background) and uses the system tray as the primary UI.
func Run(ctrl *appctl.Controller) error {
	cfg := ctrl.Config()
	admin := NewAdmin(ctrl, 18787)
	if err := admin.Start(); err != nil {
		return fmt.Errorf("start UI: %w", err)
	}

	if cfg.AutoStart {
		go func() {
			time.Sleep(200 * time.Millisecond)
			if err := ctrl.Start(); err != nil {
				log.Printf("[ui] autostart failed: %v", err)
			}
		}()
	}

	_ = admin.WaitReady(3 * time.Second)
	admin.OpenBrowser()
	log.Printf("[ui] control panel ready at %s", admin.BaseURL())

	ctrl.OnChange(func(st appctl.Status) {
		tray.SetRunning(st.Running)
	})

	hostPort := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	tray.RunWithUI(
		func() string {
			st := ctrl.Status()
			if st.Running && st.BaseURL != "" {
				return st.BaseURL
			}
			return ctrl.BaseURL()
		},
		hostPort,
		admin.BaseURL(),
		ctrl.IsRunning(),
		func() {
			_ = ctrl.Stop()
			admin.Shutdown()
		},
		func() { admin.OpenBrowser() },
		func() {
			if ctrl.IsRunning() {
				_ = ctrl.Stop()
			} else {
				_ = ctrl.Start()
			}
		},
		func() {
			cfg := ctrl.Config()
			if !cfg.UseTLS() {
				notify.ShowTrayTip("Cottage Service", "TLS 当前已关闭，本机 CA 信任操作不适用。")
				return
			}
			if cfg.TLSCertFile != "" && cfg.TLSKeyFile != "" {
				notify.ShowTrayTip("Cottage Service", "当前使用自定义证书，本机 CA 信任操作不适用。")
				return
			}
			path, err := tlsutil.TrustLocalCA(config.Dir(), cfg.TLSCommonName)
			if err != nil {
				log.Printf("[tls] trust local CA failed: %v", err)
				notify.ShowTrayTip("Cottage Service", "写入用户信任库失败，请查看运行日志。")
				return
			}
			log.Printf("[tls] local CA added to user trust store: %s", path)
			notify.ShowTrayTip("Cottage Service", "本机 CA 已写入当前用户信任库，请重新打开服务页面。")
		},
		func() {
			tray.SetRunning(ctrl.IsRunning())
			if notify.IsFirstRun() {
				notify.ShowTrayTip(
					"Cottage Service",
					"已在右下角托盘运行。绿点=运行中，灰点=已停止。点击图标打开菜单。",
				)
				notify.MarkWelcomed()
			}
		},
	)
	return nil
}
