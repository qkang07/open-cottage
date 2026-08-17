//go:build !windows

package singleinstance

import (
	"fmt"
	"os"

	"github.com/open-cottage/cottage-service-go/internal/config"
	"golang.org/x/sys/unix"
)

// Acquire takes the process-wide instance lock via non-blocking flock.
// Call the returned release function when the process exits.
func Acquire() (release func(), err error) {
	if err := os.MkdirAll(config.Dir(), 0o755); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(lockPath(), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open instance lock: %w", err)
	}
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		_ = f.Close()
		if err == unix.EWOULDBLOCK || err == unix.EAGAIN {
			return nil, ErrAlreadyRunning
		}
		return nil, fmt.Errorf("acquire instance lock: %w", err)
	}
	return func() {
		_ = unix.Flock(int(f.Fd()), unix.LOCK_UN)
		_ = f.Close()
		ClearUIEndpoint()
	}, nil
}
