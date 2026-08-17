package headless

import (
	"fmt"
	"math/rand"
	"runtime"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/input"
	"github.com/go-rod/rod/lib/proto"
)

func humanSleep(minMs, maxMs int) {
	if maxMs < minMs {
		maxMs = minMs
	}
	d := minMs
	if maxMs > minMs {
		d += rand.Intn(maxMs - minMs + 1)
	}
	time.Sleep(time.Duration(d) * time.Millisecond)
}

func humanMouseMove(page *rod.Page) {
	if page == nil || page.Mouse == nil {
		return
	}
	x, y := 120.0+rand.Float64()*400, 140.0+rand.Float64()*220
	steps := 6 + rand.Intn(8)
	for i := 1; i <= steps; i++ {
		t := float64(i) / float64(steps)
		// Ease-in-out with slight noise so the path is not a straight line.
		eased := t * t * (3 - 2*t)
		nx := x*eased + (30+rand.Float64()*40)*(1-eased) + (rand.Float64()*6 - 3)
		ny := y*eased + (40+rand.Float64()*50)*(1-eased) + (rand.Float64()*6 - 3)
		_ = page.Mouse.MoveTo(proto.NewPoint(nx, ny))
		humanSleep(8, 28)
	}
}

func humanScroll(page *rod.Page) {
	if page == nil {
		return
	}
	times := 1 + rand.Intn(3)
	for i := 0; i < times; i++ {
		dy := 160 + rand.Intn(320)
		_, _ = page.Eval(fmt.Sprintf(`() => window.scrollBy({ top: %d, left: 0, behavior: "smooth" })`, dy))
		humanSleep(280, 700)
	}
	if rand.Float64() < 0.45 {
		_, _ = page.Eval(`() => window.scrollBy({ top: -80 - Math.floor(Math.random()*120), left: 0, behavior: "smooth" })`)
		humanSleep(180, 420)
	}
}

func humanIdleRead() {
	humanSleep(450, 1200)
}

// humanType types text with per-character delay and occasional longer pauses.
func humanType(page *rod.Page, text string) error {
	runes := []rune(text)
	for i, r := range runes {
		if err := page.InsertText(string(r)); err != nil {
			return err
		}
		humanSleep(35, 110)
		// Occasional "thinking" pause mid-query.
		if i > 0 && i%7 == 0 && rand.Float64() < 0.35 {
			humanSleep(180, 420)
		}
	}
	return nil
}

func humanClick(page *rod.Page, selector string) error {
	el, err := page.Timeout(5 * time.Second).Element(selector)
	if err != nil {
		return err
	}
	shape, _ := el.Shape()
	if shape != nil && len(shape.Quads) > 0 {
		q := shape.Quads[0]
		// Quad is [x1,y1,x2,y2,x3,y3,x4,y4]
		cx := (q[0] + q[2] + q[4] + q[6]) / 4
		cy := (q[1] + q[3] + q[5] + q[7]) / 4
		cx += rand.Float64()*6 - 3
		cy += rand.Float64()*4 - 2
		_ = page.Mouse.MoveTo(proto.NewPoint(cx, cy))
		humanSleep(40, 120)
	} else {
		humanMouseMove(page)
	}
	return el.Click(proto.InputMouseButtonLeft, 1)
}

func humanClearInput(page *rod.Page) {
	// Prefer DOM clear — more reliable than synthetic Ctrl+A across OSes.
	_, _ = page.Eval(`() => {
    const el = document.activeElement;
    if (!el) return;
    if ("value" in el) {
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }`)
	humanSleep(40, 100)
}

func humanPressEnter(page *rod.Page) error {
	humanSleep(80, 220)
	return page.Keyboard.Press(input.Enter)
}

type fingerprint struct {
	UA              string
	Platform        string
	PlatformVersion string
	Architecture    string
	Vendor          string
	Renderer        string
	NavigatorPlat   string
	Brands          []*proto.EmulationUserAgentBrandVersion
}

func fingerprintForOS() fingerprint {
	brands := []*proto.EmulationUserAgentBrandVersion{
		{Brand: "Google Chrome", Version: "131"},
		{Brand: "Chromium", Version: "131"},
		{Brand: "Not_A Brand", Version: "24"},
	}
	switch runtime.GOOS {
	case "windows":
		return fingerprint{
			UA:              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
			Platform:        "Windows",
			PlatformVersion: "15.0.0",
			Architecture:    "x86",
			Vendor:          "Google Inc. (NVIDIA)",
			Renderer:        "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)",
			NavigatorPlat:   "Win32",
			Brands:          brands,
		}
	case "darwin":
		return fingerprint{
			UA:              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
			Platform:        "macOS",
			PlatformVersion: "14.5.0",
			Architecture:    "arm",
			Vendor:          "Google Inc. (Apple)",
			Renderer:        "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)",
			NavigatorPlat:   "MacIntel",
			Brands:          brands,
		}
	default:
		return fingerprint{
			UA:              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
			Platform:        "Linux",
			PlatformVersion: "6.5.0",
			Architecture:    "x86",
			Vendor:          "Google Inc. (Intel)",
			Renderer:        "ANGLE (Intel, Mesa Intel(R) UHD Graphics, OpenGL 4.6)",
			NavigatorPlat:   "Linux x86_64",
			Brands:          brands,
		}
	}
}

func (fp fingerprint) overrideJS() string {
	return fmt.Sprintf(`(() => {
  Object.defineProperty(navigator, "platform", { get: () => %q });
  Object.defineProperty(navigator, "userAgent", { get: () => %q });
  Object.defineProperty(navigator, "appVersion", { get: () => %q });
  const patchWebgl = (proto) => {
    if (!proto || !proto.getParameter) return;
    const getParameter = proto.getParameter;
    proto.getParameter = function (parameter) {
      if (parameter === 37445) return %q;
      if (parameter === 37446) return %q;
      return getParameter.call(this, parameter);
    };
  };
  patchWebgl(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== "undefined") {
    patchWebgl(WebGL2RenderingContext.prototype);
  }
})();`, fp.NavigatorPlat, fp.UA, "5.0 ("+fp.NavigatorPlat+")", fp.Vendor, fp.Renderer)
}
