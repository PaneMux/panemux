// Mode indicator. Default is a 24px status strip on the bottom edge, like an
// editor's status bar: mode dot + name on the left, status slots (macro
// recording, register in use, pending keys) on the right. The page gets 24px
// of extra bottom padding so the end of the document can always scroll clear
// of it.
//
// Falls back to a small corner pill when the strip would fight the page:
// the site has its own fixed/sticky UI along the bottom edge (cookie bars,
// chat widgets, bottom nav), or it's an app shell whose document doesn't
// scroll (padding can't make room there). Settings can force the pill.
PaneMux.ModeIndicator = (() => {
  const box = PaneMux.HUD.el("div", "strip");
  box.setAttribute("aria-live", "polite");
  const left = PaneMux.HUD.el("div", "left", box);
  const dot = PaneMux.HUD.el("span", "dot", left);
  const label = PaneMux.HUD.el("span", "label", left);
  const pending = PaneMux.HUD.el("span", "pending", left);
  const right = PaneMux.HUD.el("div", "right", box);
  const slots = new Map(); // name -> span

  let layout = "strip";
  let pulseTimer = null;

  function render(mode) {
    const info = PaneMux.Modes.info(mode);
    label.textContent = info.label;
    box.dataset.mode = mode;
    box.title = `PaneMux — ${info.label} mode`;
    PaneMux.HUD.setModeColor(info.color);
  }

  // Brief emphasis on mode change, then settle (pill: 55% -> 100% + 1.05 scale).
  function pulse() {
    box.classList.add("changed");
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => box.classList.remove("changed"), 400);
  }

  // Right-hand status slots, e.g. setStatus("rec", "REC @a", "rec").
  function setStatus(name, text, cls = "") {
    let s = slots.get(name);
    if (!text) { if (s) { s.remove(); slots.delete(name); } return; }
    if (!s) { s = PaneMux.HUD.el("span", "status", layout === "pill" ? left : right); slots.set(name, s); }
    s.className = `status ${cls}`.trim();
    s.textContent = text;
  }

  // ---- layout: strip vs pill -------------------------------------------------

  // Does the page itself own the bottom edge?
  function bottomConflict() {
    const y = innerHeight - 12;
    for (let i = 0; i < 9; i++) {
      const x = ((i + 0.5) / 9) * innerWidth;
      for (let el = document.elementFromPoint(x, y); el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        if (PaneMux.HUD.owns(el)) break;
        const pos = getComputedStyle(el).position;
        if (pos === "fixed" || pos === "sticky") {
          const r = el.getBoundingClientRect();
          if (r.bottom >= innerHeight - 2 && r.height > 0) return true;
        }
      }
    }
    return false;
  }

  // App shells (html/body overflow hidden, inner scroller) can't be padded.
  function documentScrolls() {
    const se = document.scrollingElement || document.documentElement;
    const htmlOv = getComputedStyle(document.documentElement).overflowY;
    const bodyOv = document.body ? getComputedStyle(document.body).overflowY : "visible";
    if (htmlOv === "hidden" || bodyOv === "hidden" || htmlOv === "clip" || bodyOv === "clip") return false;
    // Full-height layouts that exactly fill the viewport behave like shells too.
    const body = document.body;
    const pad = document.documentElement.hasAttribute("data-panemux-strip") ? 24 : 0;
    const fills = body && Math.abs(body.getBoundingClientRect().height - innerHeight) < 2 && se.scrollHeight - pad <= innerHeight + 1;
    return !fills;
  }

  function choose() {
    const pref = PaneMux.Settings.get("indicator") || "auto";
    if (pref === "pill") return "pill";
    return documentScrolls() && !bottomConflict() ? "strip" : "pill";
  }

  // Idempotent: safe to call on every recheck.
  function applyLayout(next) {
    layout = next;
    box.classList.toggle("strip", next === "strip");
    box.classList.toggle("pill", next === "pill");
    PaneMux.HUD.host.classList.toggle("pill-mode", next === "pill");
    PaneMux.HUD.host.style.setProperty("--hud-bottom", next === "pill" ? "52px" : "calc(var(--strip-height) + 10px)");
    for (const s of slots.values()) if (s.parentNode !== (next === "pill" ? left : right)) (next === "pill" ? left : right).appendChild(s);
    reserve(next === "strip" && PaneMux.HUD.enabled);
  }

  function reserve(on) {
    const html = document.documentElement;
    if (!html || html.hasAttribute("data-panemux-strip") === on) return;
    if (on) html.setAttribute("data-panemux-strip", "");
    else html.removeAttribute("data-panemux-strip");
  }

  // Measured with our own padding in place — toggling it would make the page jump.
  function relayout() {
    if (!PaneMux.HUD.enabled) { reserve(false); return; }
    applyLayout(choose());
  }

  let timer = null;
  function start() {
    relayout();
    clearInterval(timer);
    // Sites add cookie bars and chat bubbles late; recheck now and then.
    timer = setInterval(() => { if (document.visibilityState === "visible") relayout(); }, 3000);
  }
  addEventListener("resize", () => relayout());

  PaneMux.Modes.onChange((mode) => { render(mode); pulse(); });
  PaneMux.Keys.onPending((p) => { pending.textContent = p; });

  render(PaneMux.Modes.current);
  return {
    element: box,
    render,
    pulse,
    setStatus,
    start,
    relayout,
    stop: () => { clearInterval(timer); reserve(false); },
    get layout() { return layout; },
  };
})();
