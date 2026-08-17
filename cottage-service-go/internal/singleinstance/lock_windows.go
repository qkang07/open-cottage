//go:build windows

package singleinstance

import (
	"fmt"

	"golang.org/x/sys/windows"
)

const mutexName = "Local\\OpenCottageService"

// Acquire takes the process-wide instance lock.
// Call the returned release function when the process exits.
func Acquire() (release func(), err error) {
	name, err := windows.UTF16PtrFromString(mutexName)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateMutex(nil, false, name)
	if err == windows.ERROR_ALREADY_EXISTS {
		if handle != 0 {
			_ = windows.CloseHandle(handle)
		}
		return nil, ErrAlreadyRunning
	}
	if err != nil {
		return nil, fmt.Errorf("create instance mutex: %w", err)
	}
	if handle == 0 {
		return nil, fmt.Errorf("create instance mutex: empty handle")
	}

	return func() {
		_ = windows.CloseHandle(handle)
		ClearUIEndpoint()
	}, nil
}
