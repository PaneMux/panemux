// Terminal HUD container: one shadow-root host laid over the page. Every
// visual piece (orb, hints, find bar, toasts) mounts inside it.
PaneMux.HUD = (() => {
  const host = document.createElement("panemux-hud");
  const root = host.attachShadow({ mode: "open" });
  const layer = document.createElement("div");
  layer.style.visibility = "hidden"; // until the stylesheet lands
  root.appendChild(layer);

  fetch(chrome.runtime.getURL("ui/hud.css"))
    .then((r) => r.text())
    .then((css) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
    })
    .catch((e) => console.warn("PaneMux: HUD stylesheet failed", e))
    .finally(() => {
      layer.style.visibility = "";
      requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add("ready")));
    });

  function attach() {
    if (!host.isConnected) (document.documentElement || document).appendChild(host);
  }

  function el(tag, className, parent = layer) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    parent.appendChild(e);
    return e;
  }

  function setModeColor(color) {
    host.style.setProperty("--pmx-mode", color);
  }

  function applyTheme(theme) {
    host.classList.toggle("classic", theme === "classic");
  }

  // ---- toast ------------------------------------------------------------
  const toastEl = el("div", "toast panel");
  let toastTimer = null;
  function toast(message, { error = false, duration = 1800 } = {}) {
    attach();
    toastEl.textContent = message;
    toastEl.classList.toggle("error", error);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), duration);
  }

  return {
    host,
    root,
    layer,
    attach,
    el,
    toast,
    setModeColor,
    applyTheme,
    // True if an event/element belongs to our own UI.
    owns(target) { return target === host || (target && host.contains(target)) || (target && target.getRootNode && target.getRootNode() === root); },
  };
})();
