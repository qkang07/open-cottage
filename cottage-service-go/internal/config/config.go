package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

type Config struct {
	Host              string `json:"host"`
	Port              int    `json:"port"`
	TLSMode           string `json:"tlsMode"` // auto | off
	TLSCertFile       string `json:"tlsCertFile,omitempty"`
	TLSKeyFile        string `json:"tlsKeyFile,omitempty"`
	TLSCommonName     string `json:"tlsCommonName,omitempty"`
	ProxyAllowPrivate bool   `json:"proxyAllowPrivate"`
	HeadlessMode      string `json:"headlessMode"` // auto | on | force | visible | headed | off
	BrowserPath       string `json:"browserPath,omitempty"`
	AutoStart         bool   `json:"autoStart"`
}

func Defaults() Config {
	return Config{
		Host:          "127.0.0.1",
		Port:          8787,
		TLSMode:       "auto",
		TLSCommonName: "localhost",
		HeadlessMode:  "visible",
		AutoStart:     true,
	}
}

func env(primary, legacy string) string {
	if v := strings.TrimSpace(os.Getenv(primary)); v != "" {
		return v
	}
	if legacy != "" {
		if v := strings.TrimSpace(os.Getenv(legacy)); v != "" {
			return v
		}
	}
	return ""
}

func isTruthy(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func isFalsy(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "0", "false", "off", "no", "disabled":
		return true
	default:
		return false
	}
}

func Dir() string {
	switch runtime.GOOS {
	case "windows":
		if b := os.Getenv("APPDATA"); b != "" {
			return filepath.Join(b, "cottage-service")
		}
	case "darwin":
		if h, err := os.UserHomeDir(); err == nil {
			return filepath.Join(h, "Library", "Application Support", "cottage-service")
		}
	}
	if h, err := os.UserHomeDir(); err == nil {
		return filepath.Join(h, ".config", "cottage-service")
	}
	return "cottage-service"
}

func FilePath() string {
	return filepath.Join(Dir(), "config.json")
}

func LoadFile() (Config, error) {
	cfg := Defaults()
	data, err := os.ReadFile(FilePath())
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return cfg, err
	}
	// Ignore unknown fields (e.g. legacy trayEnabled).
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Defaults(), err
	}
	normalize(&cfg)
	return cfg, nil
}

func (c Config) Save() error {
	normalize(&c)
	if err := os.MkdirAll(Dir(), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(FilePath(), data, 0o644)
}

func normalize(c *Config) {
	if c.Host == "" {
		c.Host = "127.0.0.1"
	}
	if c.Port <= 0 {
		c.Port = 8787
	}
	c.TLSMode = strings.ToLower(strings.TrimSpace(c.TLSMode))
	if c.TLSMode == "" {
		c.TLSMode = "auto"
	}
	if c.TLSCommonName == "" {
		c.TLSCommonName = "localhost"
	}
	c.HeadlessMode = strings.ToLower(strings.TrimSpace(c.HeadlessMode))
	if c.HeadlessMode == "" {
		c.HeadlessMode = "auto"
	}
}

func applyEnv(c *Config) {
	if p := env("COTTAGE_SERVICE_PORT", "LOCAL_AGENT_PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 {
			c.Port = n
		}
	}
	if h := env("COTTAGE_SERVICE_HOST", "LOCAL_AGENT_HOST"); h != "" {
		c.Host = h
	}
	if m := env("COTTAGE_SERVICE_TLS_MODE", "LOCAL_AGENT_TLS_MODE"); m != "" {
		c.TLSMode = strings.ToLower(m)
	}
	if v := env("COTTAGE_SERVICE_TLS_CERT_FILE", "LOCAL_AGENT_TLS_CERT_FILE"); v != "" {
		c.TLSCertFile = v
	}
	if v := env("COTTAGE_SERVICE_TLS_KEY_FILE", "LOCAL_AGENT_TLS_KEY_FILE"); v != "" {
		c.TLSKeyFile = v
	}
	if v := env("COTTAGE_SERVICE_TLS_COMMON_NAME", "LOCAL_AGENT_TLS_COMMON_NAME"); v != "" {
		c.TLSCommonName = v
	}
	if raw := env("COTTAGE_SERVICE_PROXY_ALLOW_PRIVATE", "LOCAL_AGENT_PROXY_ALLOW_PRIVATE"); raw != "" {
		c.ProxyAllowPrivate = isTruthy(raw)
	}
	if raw := env("HEADLESS_BROWSER", ""); raw != "" {
		c.HeadlessMode = strings.ToLower(raw)
	}
	if v := env("COTTAGE_BROWSER_PATH", "PUPPETEER_EXECUTABLE_PATH"); v != "" {
		c.BrowserPath = v
	}
	if raw := env("COTTAGE_SERVICE_AUTOSTART", ""); raw != "" {
		c.AutoStart = isTruthy(raw)
	}
}

// Load: defaults <- config.json <- environment (env wins).
func Load() Config {
	cfg, _ := LoadFile()
	applyEnv(&cfg)
	normalize(&cfg)
	return cfg
}

func (c Config) Addr() string {
	return c.Host + ":" + strconv.Itoa(c.Port)
}

func (c Config) UseTLS() bool {
	return c.TLSMode != "off" && c.TLSMode != "false"
}

// UIEnabled: GUI is default; disable with COTTAGE_SERVICE_UI=off or --cli.
func UIEnabled(args []string) bool {
	for _, a := range args {
		if a == "--cli" || a == "-cli" {
			return false
		}
	}
	raw := env("COTTAGE_SERVICE_UI", "")
	if raw != "" && isFalsy(raw) {
		return false
	}
	return true
}
