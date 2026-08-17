package applog

import (
	"bufio"
	"bytes"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/open-cottage/cottage-service-go/internal/config"
)

const (
	defaultCap   = 2000
	seedMaxBytes = 256 * 1024
)

// Ring is an in-memory ring of recent log lines for the control panel.
type Ring struct {
	mu    sync.Mutex
	lines []string
	cap   int
	seq   uint64 // seq of the next line to be written (also = firstSeq + len)
	path  string
	partial string
}

var global = &Ring{cap: defaultCap}

// FilePath returns the UI-mode log file path (may be empty in CLI mode).
func FilePath() string {
	global.mu.Lock()
	defer global.mu.Unlock()
	return global.path
}

// Setup routes logs: UI mode → file + memory ring; CLI → stderr + memory ring.
func Setup(uiMode bool) {
	log.SetFlags(log.LstdFlags)
	writers := []io.Writer{global}

	if uiMode {
		_ = os.MkdirAll(config.Dir(), 0o755)
		path := filepath.Join(config.Dir(), "service.log")
		f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if err == nil {
			global.mu.Lock()
			global.path = path
			global.mu.Unlock()
			seedFromFile(path)
			writers = append(writers, f)
		}
	} else {
		writers = append(writers, os.Stderr)
	}

	log.SetOutput(io.MultiWriter(writers...))
	if p := FilePath(); p != "" {
		log.Printf("[log] writing to %s", p)
	}
}

func seedFromFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return
	}
	start := int64(0)
	if info.Size() > seedMaxBytes {
		start = info.Size() - seedMaxBytes
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return
	}

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var lines []string
	first := true
	for sc.Scan() {
		line := sc.Text()
		// If we sought mid-file, drop the first partial line.
		if first && start > 0 {
			first = false
			continue
		}
		first = false
		lines = append(lines, line)
	}
	if len(lines) == 0 {
		return
	}
	if len(lines) > defaultCap {
		lines = lines[len(lines)-defaultCap:]
	}
	global.mu.Lock()
	global.lines = append([]string(nil), lines...)
	global.seq = uint64(len(lines))
	global.mu.Unlock()
}

func (r *Ring) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.partial += string(p)
	for {
		i := strings.IndexByte(r.partial, '\n')
		if i < 0 {
			break
		}
		line := strings.TrimRight(r.partial[:i], "\r")
		r.partial = r.partial[i+1:]
		r.appendLocked(line)
	}
	// Cap unfinished line so a runaway write cannot grow forever.
	if len(r.partial) > 16*1024 {
		r.appendLocked(r.partial)
		r.partial = ""
	}
	return len(p), nil
}

func (r *Ring) appendLocked(line string) {
	if r.cap <= 0 {
		r.cap = defaultCap
	}
	r.lines = append(r.lines, line)
	if len(r.lines) > r.cap {
		drop := len(r.lines) - r.cap
		r.lines = append([]string(nil), r.lines[drop:]...)
	}
	r.seq++
}

// Snapshot returns log lines with seq > after.
// full is true when the entire current buffer is returned (initial load or ring rotated).
func Snapshot(after uint64) (lines []string, next uint64, path string, full bool) {
	global.mu.Lock()
	defer global.mu.Unlock()

	path = global.path
	next = global.seq
	n := len(global.lines)
	if n == 0 {
		return nil, next, path, after == 0
	}
	firstSeq := global.seq - uint64(n) + 1 // seq of lines[0]
	if after == 0 || after < firstSeq-1 {
		return append([]string(nil), global.lines...), next, path, true
	}
	iStart := int(after - firstSeq + 1)
	if iStart < 0 {
		iStart = 0
	}
	if iStart >= n {
		return nil, next, path, false
	}
	return append([]string(nil), global.lines[iStart:]...), next, path, false
}

// Clear empties the in-memory ring (file on disk is kept).
func Clear() {
	global.mu.Lock()
	defer global.mu.Unlock()
	global.lines = nil
	global.partial = ""
	// Keep seq monotonic so clients do not re-fetch cleared history as "new".
}

// TailString is a debug helper joining recent lines.
func TailString(max int) string {
	lines, _, _, _ := Snapshot(0)
	if max > 0 && len(lines) > max {
		lines = lines[len(lines)-max:]
	}
	var b bytes.Buffer
	for _, line := range lines {
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return b.String()
}
