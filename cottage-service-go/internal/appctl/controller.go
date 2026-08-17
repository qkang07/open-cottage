package appctl

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/open-cottage/cottage-service-go/internal/config"
	"github.com/open-cottage/cottage-service-go/internal/server"
)

type Status struct {
	Running bool
	BaseURL string
	TLSMsg  string
	Error   string
}

type Controller struct {
	mu      sync.Mutex
	cfg     config.Config
	srv     *server.Server
	running bool
	lastErr string
	cancel  context.CancelFunc

	listeners []func(Status)
}

func NewController(cfg config.Config) *Controller {
	return &Controller{cfg: cfg}
}

func (c *Controller) Config() config.Config {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cfg
}

func (c *Controller) SetConfig(cfg config.Config) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cfg = cfg
}

func (c *Controller) OnChange(fn func(Status)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.listeners = append(c.listeners, fn)
}

func (c *Controller) notifyLocked() {
	st := c.statusLocked()
	for _, fn := range c.listeners {
		go fn(st)
	}
}

func (c *Controller) statusLocked() Status {
	base := ""
	tlsMsg := ""
	if c.srv != nil {
		base = c.srv.BaseURL
		tlsMsg = c.srv.TLSMsg
	}
	return Status{Running: c.running, BaseURL: base, TLSMsg: tlsMsg, Error: c.lastErr}
}

func (c *Controller) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.statusLocked()
}

func (c *Controller) IsRunning() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.running
}

func (c *Controller) Start() error {
	c.mu.Lock()
	if c.running {
		c.mu.Unlock()
		return nil
	}
	cfg := c.cfg
	c.lastErr = ""
	c.mu.Unlock()

	srv := server.New(cfg)
	srv.Quiet = true

	errCh := make(chan error, 1)
	go func() {
		errCh <- srv.ListenAndServe()
	}()

	// Wait briefly for bind failure without holding the mutex (so /api/status stays responsive).
	select {
	case err := <-errCh:
		if err != nil && !isClosedErr(err) {
			c.mu.Lock()
			c.lastErr = err.Error()
			c.srv = nil
			c.running = false
			c.notifyLocked()
			c.mu.Unlock()
			return err
		}
	case <-time.After(500 * time.Millisecond):
	}

	ctx, cancel := context.WithCancel(context.Background())
	c.mu.Lock()
	c.cancel = cancel
	c.srv = srv
	c.running = true
	c.lastErr = ""
	c.notifyLocked()
	c.mu.Unlock()
	log.Printf("[app] started %s", srv.BaseURL)

	go func() {
		select {
		case <-ctx.Done():
			return
		case err := <-errCh:
			c.mu.Lock()
			if c.srv == srv {
				c.running = false
				if err != nil && !isClosedErr(err) {
					c.lastErr = err.Error()
					log.Printf("[app] server stopped: %v", err)
				}
				c.notifyLocked()
			}
			c.mu.Unlock()
		}
	}()
	return nil
}

func (c *Controller) Stop() error {
	c.mu.Lock()
	srv := c.srv
	cancel := c.cancel
	c.running = false
	c.srv = nil
	c.cancel = nil
	c.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if srv == nil {
		c.mu.Lock()
		c.notifyLocked()
		c.mu.Unlock()
		return nil
	}
	ctx, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelShutdown()
	err := srv.Shutdown(ctx)
	c.mu.Lock()
	c.notifyLocked()
	c.mu.Unlock()
	log.Printf("[app] stopped")
	return err
}

func (c *Controller) Restart() error {
	_ = c.Stop()
	time.Sleep(150 * time.Millisecond)
	return c.Start()
}

// ApplyAndMaybeRestart saves cfg and restarts the API server when listen/TLS/headless
// settings changed while running. The bool is true when a restart actually ran.
func (c *Controller) ApplyAndMaybeRestart(cfg config.Config, restartIfRunning bool) (restarted bool, err error) {
	c.mu.Lock()
	old := c.cfg
	c.cfg = cfg
	running := c.running
	c.mu.Unlock()

	if err := cfg.Save(); err != nil {
		return false, err
	}

	needRestart := running && restartIfRunning &&
		(old.Host != cfg.Host || old.Port != cfg.Port || old.TLSMode != cfg.TLSMode ||
			old.TLSCertFile != cfg.TLSCertFile || old.TLSKeyFile != cfg.TLSKeyFile ||
			old.ProxyAllowPrivate != cfg.ProxyAllowPrivate || old.HeadlessMode != cfg.HeadlessMode ||
			old.BrowserPath != cfg.BrowserPath)

	if needRestart {
		return true, c.Restart()
	}
	c.mu.Lock()
	c.notifyLocked()
	c.mu.Unlock()
	return false, nil
}

func (c *Controller) BaseURL() string {
	st := c.Status()
	if st.BaseURL != "" {
		return st.BaseURL
	}
	cfg := c.Config()
	scheme := "http"
	if cfg.UseTLS() {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s:%d", scheme, cfg.Host, cfg.Port)
}

func isClosedErr(err error) bool {
	if err == nil {
		return true
	}
	if err == http.ErrServerClosed {
		return true
	}
	return strings.Contains(err.Error(), "Server closed")
}
