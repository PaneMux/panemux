// Visual mode: select DOM elements, not text.
//   h / ←  parent          l / →  first child
//   j / ↓  next sibling    k / ↑  previous sibling      (all take counts)
//   d  hide element (soft)  u  undo (restores it; see undo.js)
//   y  copy as Markdown     >  open in reading pane
//   f  re-pick with hints   Esc / v  exit
PaneMux.VisualMode = (() => {
  const Sel = PaneMux.DomSelector;
  let sel = null;          // selected element
  let box = null, label = null, raf = 0;

  function select(el, { scroll = true } = {}) {
    if (!el) return false;
    sel = el;
    PaneMux.Scroll.setActivated(el);
    if (scroll) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) el.scrollIntoView({ block: r.height > innerHeight ? "start" : "nearest", behavior: "instant" });
    }
    draw();
    return true;
  }

  function draw() {
    if (!sel || !box) return;
    if (!sel.isConnected) { select(document.body, { scroll: false }); return; }
    const r = sel.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
    const desc = Sel.describe(sel);
    const size = `${Math.round(r.width)}×${Math.round(r.height)}`;
    if (label.dataset.desc !== desc + size) {
      label.dataset.desc = desc + size;
      label.textContent = desc + " ";
      const dim = document.createElement("span");
      dim.className = "dim";
      dim.textContent = size;
      label.appendChild(dim);
    }
    const top = r.top - 2 - 19;
    Object.assign(label.style, { left: `${Math.max(0, r.left - 2)}px`, top: `${top < 0 ? Math.max(0, r.top) : top}px` });
  }

  function loop() {
    draw();
    raf = requestAnimationFrame(loop);
  }

  function flash() {
    if (!box) return;
    box.classList.remove("flash");
    void box.offsetWidth;
    box.classList.add("flash");
  }

  function onMouseDown(e) {
    if (!PaneMux.HUD.owns(e.target) && PaneMux.Modes.current === "visual") exit();
  }

  function enter(el) {
    if (PaneMux.Modes.current === "visual" && sel) { select(el || sel); return; }
    PaneMux.HUD.attach();
    box = PaneMux.HUD.el("div", "vsel");
    label = PaneMux.HUD.el("div", "vsel-label");
    sel = null;
    select(el || Sel.initial());
    PaneMux.Bus.emit("visual", { el: sel });
    loop();
    addEventListener("mousedown", onMouseDown, true);
    PaneMux.Modes.enter("visual", { onExit: (next) => cleanup(next) });
  }

  // Leaving Visual for the reading pane / hint picker keeps the overlay.
  let keepOverlay = false;

  function cleanup() {
    if (keepOverlay) return;
    cancelAnimationFrame(raf);
    removeEventListener("mousedown", onMouseDown, true);
    if (box) box.remove();
    if (label) label.remove();
    box = label = null;
    sel = null;
  }

  function exit() {
    if (PaneMux.Modes.current === "visual") PaneMux.Modes.enter("normal");
    else cleanup();
  }

  // Temporarily hand the keyboard to another handler without losing the selection.
  function suspend(mode, handler) {
    keepOverlay = true;
    PaneMux.Modes.enter(mode, handler);
    keepOverlay = false;
  }
  function resume() {
    PaneMux.Modes.enter("visual", { onExit: (next) => cleanup(next) });
    draw();
  }

  function step(fn, count, what) {
    let el = sel, moved = false;
    for (let i = 0; i < count; i++) {
      const n = fn(el);
      if (!n) break;
      el = n; moved = true;
    }
    if (moved) select(el);
    else { flash(); PaneMux.HUD.toast(`No ${what}`, { error: true, duration: 900 }); }
  }

  // ---- actions ------------------------------------------------------------

  // Soft-hide; recorded in the undo tree, so u / C-r / g- / the panel bring it back.
  function hide() {
    const el = sel;
    if (!el || el === document.body) { PaneMux.HUD.toast("Won't hide <body>", { error: true }); return; }
    const nextSel = Sel.next(el) || Sel.prev(el) || Sel.parent(el) || document.body;
    const prev = { value: el.style.getPropertyValue("display"), priority: el.style.getPropertyPriority("display") };
    PaneMux.Undo.setHidden(el, true);
    PaneMux.Undo.recordHide(el, prev);
    select(nextSel);
    PaneMux.HUD.toast(`Hid ${Sel.describe(el)} — u to restore`);
  }

  async function yank() {
    const md = PaneMux.Markdown.fromElement(sel);
    if (!md) { PaneMux.HUD.toast("Nothing to copy", { error: true }); return; }
    await PaneMux.Dom.copyText(md);
    chrome.runtime.sendMessage({ type: "reg.set", name: '"', value: md });
    flash();
    const lines = md.split("\n").length;
    PaneMux.HUD.toast(`Yanked ${lines} line${lines === 1 ? "" : "s"} of Markdown`);
  }

  function pick() {
    const prev = sel;
    keepOverlay = true; // hints take over the keyboard; keep the selection box up
    PaneMux.LinkHints.activate(false, {
      all: true,
      onSelect: (el) => { resume(); select(el); flash(); },
      onCancel: () => { resume(); select(prev, { scroll: false }); },
    });
    keepOverlay = false;
  }

  // ---- reading pane (">") -------------------------------------------------

  function sanitize(root) {
    root.querySelectorAll("script, style, link, iframe, object, embed, noscript, template, form, input, select, textarea, button, [hidden], panemux-hud").forEach((n) => n.remove());
    for (const n of [root, ...root.querySelectorAll("*")]) {
      for (const a of [...n.attributes]) {
        if (/^on/i.test(a.name) || a.name === "style" || a.name === "class" || a.name === "id" || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
      }
      if (n.tagName === "A") { n.target = "_blank"; n.rel = "noopener noreferrer"; }
    }
    return root;
  }

  function read() {
    const el = sel;
    // Copy hrefs/srcs as absolute URLs before cloning drops context.
    const clone = el.cloneNode(true);
    const src = [el, ...el.querySelectorAll("*")], dst = [clone, ...clone.querySelectorAll("*")];
    src.forEach((s, i) => {
      if (s.nodeType !== 1) return;
      if (typeof s.checkVisibility === "function" && s !== el && !s.checkVisibility({ checkVisibilityCSS: true })) dst[i].setAttribute("hidden", "");
      if (s.href && dst[i].hasAttribute("href")) dst[i].setAttribute("href", s.href);
      if (s.currentSrc || s.src) dst[i].setAttribute("src", s.currentSrc || s.src);
      dst[i].removeAttribute("srcset");
    });
    sanitize(clone);

    const backdrop = PaneMux.HUD.el("div", "reader-backdrop");
    const panel = PaneMux.HUD.el("div", "reader panel");
    const bar = PaneMux.HUD.el("div", "reader-bar", panel);
    bar.textContent = `> ${Sel.describe(el)}`;
    const hint = document.createElement("span");
    hint.className = "dim";
    hint.textContent = "j/k scroll · Esc close";
    bar.appendChild(hint);
    const body = PaneMux.HUD.el("div", "reader-body", panel);
    body.appendChild(clone);
    backdrop.addEventListener("mousedown", () => close());

    const close = () => { backdrop.remove(); panel.remove(); resume(); };
    const half = () => body.clientHeight / 2;
    suspend("visual", {
      onKey(key) {
        switch (key) {
          case "<esc>": case "q": case ">": close(); break;
          case "j": case "<down>": body.scrollBy(0, 60); break;
          case "k": case "<up>": body.scrollBy(0, -60); break;
          case "d": case "<space>": body.scrollBy(0, half()); break;
          case "u": body.scrollBy(0, -half()); break;
          case "g": body.scrollTop = 0; break;
          case "G": body.scrollTop = body.scrollHeight; break;
        }
        return "handled";
      },
      onExit: () => { backdrop.remove(); panel.remove(); },
    });
  }

  // ---- commands + bindings -----------------------------------------------
  const { defineCommand: def, map } = PaneMux.Keys;
  def("visualEnter",   () => enter(), { desc: "Visual mode on the focused element" });
  def("visualExit",    () => exit(), { desc: "Leave Visual mode" });
  def("visualParent",  ({ count }) => step(Sel.parent, count, "parent"), { desc: "Select parent" });
  def("visualChild",   ({ count }) => step(Sel.firstChild, count, "child"), { desc: "Select first child" });
  def("visualNext",    ({ count }) => step(Sel.next, count, "next sibling"), { desc: "Select next sibling" });
  def("visualPrev",    ({ count }) => step(Sel.prev, count, "previous sibling"), { desc: "Select previous sibling" });
  def("visualHide",    () => hide(), { desc: "Hide element" });
  def("visualYank",    () => yank(), { desc: "Copy element as Markdown" });
  def("visualRead",    () => read(), { desc: "Open element in reading pane" });
  def("visualPick",    () => pick(), { desc: "Pick element with hints" });

  map("normal", "v", "visualEnter");
  const V = "visual";
  map(V, "<esc>", "visualExit");
  map(V, "v", "visualExit");
  map(V, "h", "visualParent");  map(V, "<left>", "visualParent");
  map(V, "l", "visualChild");   map(V, "<right>", "visualChild");
  map(V, "j", "visualNext");    map(V, "<down>", "visualNext");
  map(V, "k", "visualPrev");    map(V, "<up>", "visualPrev");
  map(V, "d", "visualHide");
  map(V, "y", "visualYank");
  map(V, ">", "visualRead");
  map(V, "f", "visualPick");

  return { enter, exit, select, get selection() { return sel; } };
})();
