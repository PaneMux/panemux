// HUD container: one shadow-root host for every visual piece (status strip,
// hints, find bar, toasts, panels). The host itself is a zero-size fixed box
// with pointer-events: none, so it can never swallow a click or scroll meant
// for the page; only interactive children opt back in (see hud.css).
PaneMux.HUD = (() => {
  const host = document.createElement("panemux-hud");
  host.setAttribute("data-panemux-theme", "");
  const root = host.attachShadow({ mode: "open" });
  const layer = document.createElement("div");
  layer.style.visibility = "hidden"; // until the stylesheets land
  root.appendChild(layer);

  const load = (path) => fetch(chrome.runtime.getURL(path)).then((r) => r.text()).then((css) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return sheet;
  });
  Promise.all([load("ui/tokens.css"), load("ui/hud.css")])
    .then((sheets) => { root.adoptedStyleSheets = sheets; })
    .catch((e) => console.warn("PaneMux: HUD stylesheet failed", e))
    .finally(() => { layer.style.visibility = ""; });

  let enabled = true;

  function attach() {
    if (enabled && !host.isConnected) (document.documentElement || document).appendChild(host);
  }

  function setEnabled(on) {
    enabled = on;
    if (on) attach();
    else host.remove();
  }

  function el(tag, className, parent = layer) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    parent.appendChild(e);
    return e;
  }

  // mode accent, e.g. "var(--mode-insert)"
  function setModeColor(color) {
    host.style.setProperty("--mode", color);
  }

  // ---- toast ----------------------------------------------------------------
  // toast("Tab closed", { action: { label: "Undo", run }, hint: "or press u" })
  const toastEl = el("div", "toast panel");
  toastEl.setAttribute("role", "status");
  let toastTimer = null;

  function toast(message, { error = false, duration, action = null, hint = "" } = {}) {
    attach();
    toastEl.textContent = "";
    const msg = el("span", "msg", toastEl);
    msg.textContent = message;
    if (action) {
      const btn = el("button", "action", toastEl);
      btn.type = "button";
      btn.textContent = action.label;
      btn.addEventListener("click", () => { hideToast(); action.run(); });
    }
    if (hint) el("span", "hint", toastEl).textContent = hint;
    toastEl.classList.toggle("error", error);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, duration || (action ? 6000 : 1800));
  }

  function hideToast() {
    toastEl.classList.remove("show");
  }

  // ---- opt-in scanlines (Settings; off by default) ---------------------------
  let scanlines = null;
  function setScanlines(on) {
    if (on && !scanlines) scanlines = el("div", "scanlines");
    if (!on && scanlines) { scanlines.remove(); scanlines = null; }
  }

  return {
    host,
    root,
    layer,
    attach,
    setEnabled,
    el,
    toast,
    hideToast,
    setModeColor,
    setScanlines,
    get enabled() { return enabled; },
    // True if an event/element belongs to our own UI.
    owns(target) { return target === host || (target && host.contains(target)) || (target && target.getRootNode && target.getRootNode() === root); },
  };
})();
