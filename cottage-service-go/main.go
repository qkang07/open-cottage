package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/open-cottage/cottage-service-go/internal/appctl"
	"github.com/open-cottage/cottage-service-go/internal/applog"
	"github.com/open-cottage/cottage-service-go/internal/config"
	"github.com/open-cottage/cottage-service-go/internal/singleinstance"
	"github.com/open-cottage/cottage-service-go/internal/tray"
	"github.com/open-cottage/cottage-service-go/internal/ui"
	"github.com/open-cottage/cottage-service-go/internal/winutil"
)

func main() {
	uiMode := config.UIEnabled(os.Args[1:])
	applog.Setup(uiMode)
	if uiMode {
		// Default is tray/UI — detach so a black console window does not linger.
		winutil.HideConsole()
	}

	release, err := singleinstance.Acquire()
	if err != nil {
		if errors.Is(err, singleinstance.ErrAlreadyRunning) {
			if uiMode {
				if u := singleinstance.ExistingUI(); u != "" {
					tray.OpenURL(u)
				} else {
					log.Printf("[app] already running (could not open existing control panel)")
				}
				return
			}
			log.Fatal("cottage-service is already running")
		}
		log.Fatal(err)
	}
	defer release()

	cfg := config.Load()
	ctrl := appctl.NewController(cfg)

	if uiMode {
		if err := ui.Run(ctrl); err != nil {
			log.Fatal(err)
		}
		return
	}

	runCLI(ctrl, cfg)
}

func runCLI(ctrl *appctl.Controller, cfg config.Config) {
	if err := ctrl.Start(); err != nil {
		log.Fatal(err)
	}

	doQuit := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = ctrl.Stop()
		_ = ctx
		os.Exit(0)
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	if tray.Enabled() {
		go func() {
			<-sigCh
			doQuit()
		}()
		hostPort := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
		tray.Run(ctrl.BaseURL(), hostPort, doQuit)
		return
	}

	<-sigCh
	doQuit()
}
