(() => {
  try {
    delete Object.getPrototypeOf(navigator).webdriver;
  } catch (_) {}
  Object.defineProperty(navigator, "webdriver", {
    get: () => undefined,
    configurable: true,
  });

  Object.defineProperty(navigator, "plugins", {
    get: () => {
      const plugins = [
        {
          name: "Chrome PDF Plugin",
          filename: "internal-pdf-viewer",
          description: "Portable Document Format",
          length: 1,
        },
        {
          name: "Chrome PDF Viewer",
          filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
          description: "",
          length: 1,
        },
        {
          name: "Native Client",
          filename: "internal-nacl-plugin",
          description: "",
          length: 1,
        },
      ];
      plugins.item = (i) => plugins[i] ?? null;
      plugins.namedItem = (name) => plugins.find((p) => p.name === name) ?? null;
      plugins.refresh = () => {};
      return plugins;
    },
  });

  Object.defineProperty(navigator, "languages", {
    get: () => ["zh-CN", "zh", "en-US", "en"],
  });
  Object.defineProperty(navigator, "language", { get: () => "zh-CN" });
  Object.defineProperty(navigator, "platform", { get: () => "Win32" });
  Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
  Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
  Object.defineProperty(navigator, "maxTouchPoints", { get: () => 0 });

  // Platform / WebGL vendor are patched again by Go fingerprint override to match OS.

  if (!window.chrome) {
    window.chrome = {
      app: {
        isInstalled: false,
        InstallState: {
          DISABLED: "disabled",
          INSTALLED: "installed",
          NOT_INSTALLED: "not_installed",
        },
        RunningState: {
          CANNOT_RUN: "cannot_run",
          READY_TO_RUN: "ready_to_run",
          RUNNING: "running",
        },
      },
      runtime: {
        OnInstalledReason: {},
        OnRestartRequiredReason: {},
        PlatformArch: {},
        PlatformNaclArch: {},
        PlatformOs: {},
        RequestUpdateCheckStatus: {},
        connect: () => {},
        sendMessage: () => {},
      },
      csi: () => {},
      loadTimes: () => ({}),
    };
  }

  const originalQuery = window.navigator.permissions?.query?.bind(
    window.navigator.permissions,
  );
  if (originalQuery) {
    window.navigator.permissions.query = (parameters) =>
      parameters.name === "notifications"
        ? Promise.resolve({
            state: Notification.permission,
            onchange: null,
          })
        : originalQuery(parameters);
  }

  const patchWebgl = (proto) => {
    if (!proto?.getParameter) return;
    const getParameter = proto.getParameter;
    proto.getParameter = function (parameter) {
      // Defaults; OS-specific vendor/renderer applied by Go override after this script.
      if (parameter === 37445) return "Google Inc. (NVIDIA)";
      if (parameter === 37446)
        return "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)";
      return getParameter.call(this, parameter);
    };
  };
  patchWebgl(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== "undefined") {
    patchWebgl(WebGL2RenderingContext.prototype);
  }

  for (const key of Object.keys(window)) {
    if (/^cdc_|__puppeteer|__webdriver|__driver|__selenium|callPhantom|__nightmare/i.test(key)) {
      try {
        delete window[key];
      } catch (_) {}
    }
  }

  Object.defineProperty(navigator, "connection", {
    get: () => ({
      effectiveType: "4g",
      rtt: 50,
      downlink: 10,
      saveData: false,
      type: "wifi",
    }),
  });

  try {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype,
      "contentWindow",
    );
    if (descriptor?.get) {
      const original = descriptor.get;
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
        get() {
          const win = original.call(this);
          if (win && !win.chrome) {
            try {
              win.chrome = window.chrome;
            } catch (_) {}
          }
          return win;
        },
      });
    }
  } catch (_) {}
})();
