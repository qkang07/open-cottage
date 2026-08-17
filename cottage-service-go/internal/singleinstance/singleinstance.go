package singleinstance

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/open-cottage/cottage-service-go/internal/config"
)

// ErrAlreadyRunning means another cottage-service process holds the instance lock.
var ErrAlreadyRunning = errors.New("cottage-service already running")

const uiEndpointFile = "ui-endpoint"
const adminPortBase = 18787
const adminPortSpan = 20

func lockPath() string {
	return filepath.Join(config.Dir(), "instance.lock")
}

func uiEndpointPath() string {
	return filepath.Join(config.Dir(), uiEndpointFile)
}

// WriteUIEndpoint records the control-panel URL for a later secondary launch.
func WriteUIEndpoint(url string) error {
	url = strings.TrimSpace(url)
	if url == "" {
		return nil
	}
	if err := os.MkdirAll(config.Dir(), 0o755); err != nil {
		return err
	}
	return os.WriteFile(uiEndpointPath(), []byte(url+"\n"), 0o644)
}

// ClearUIEndpoint removes the recorded control-panel URL.
func ClearUIEndpoint() {
	_ = os.Remove(uiEndpointPath())
}

// ExistingUI returns the live control-panel URL of the running instance, if any.
func ExistingUI() string {
	if b, err := os.ReadFile(uiEndpointPath()); err == nil {
		u := strings.TrimSpace(string(b))
		if u != "" && pingAdmin(u) {
			return u
		}
	}
	client := &http.Client{Timeout: 300 * time.Millisecond}
	for i := 0; i <= adminPortSpan; i++ {
		u := "http://127.0.0.1:" + strconv.Itoa(adminPortBase+i)
		if pingAdminURL(client, u) {
			return u
		}
	}
	return ""
}

func pingAdmin(base string) bool {
	client := &http.Client{Timeout: 400 * time.Millisecond}
	return pingAdminURL(client, strings.TrimRight(base, "/"))
}

func pingAdminURL(client *http.Client, base string) bool {
	resp, err := client.Get(base + "/api/status")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
