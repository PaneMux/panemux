// Undo, content side. The tree itself lives in the service worker
// (background/undoTree.js + undoService.js); this file records page-level
// actions into it and applies undo/redo operations it sends back.
//
//   u  undo       C-r  redo       g- / g+  step through time across branches
//   U  toggle the undo-tree side panel
//
// Recorded here: Visual-mode hides and form-field edits. Closed tabs are
// recorded by the service worker directly.
PaneMux.Undo = (() => {
  const bg = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
  const els = new Map(); // node id -> WeakRef(element), exact target while the page lives

  function remember(id, el) {
    if (id != null && el) els.set(id, new WeakRef(el));
  }

  function target(node) {
    const ref = els.get(node.id);
    const el = ref && ref.deref();
    if (el && el.isConnected) return el;
    const found = PaneMux.DomSelector.resolve(node.data.desc);
    if (found) remember(node.id, found);
    return found;
  }

  // ---- hides (Visual "d") ---------------------------------------------------
  async function recordHide(el, prev) {
    const r = await bg({
      type: "undo.push", kind: "hide", label: `hide ${PaneMux.DomSelector.describe(el)}`,
      data: { desc: PaneMux.DomSelector.descriptor(el), value: prev.value, priority: prev.priority },
    });
    if (r) remember(r.id, el);
  }

  function setHidden(el, hidden, data) {
    if (hidden) {
      el.style.setProperty("display", "none", "important");
      el.dataset.pmxHidden = "1";
    } else {
      if (data.value) el.style.setProperty("display", data.value, data.priority);
      else el.style.removeProperty("display");
      delete el.dataset.pmxHidden;
      if (!el.getAttribute("style")) el.removeAttribute("style");
    }
  }

  // ---- form edits ------------------------------------------------------------
  const committed = new WeakMap(); // field -> value at last commit
  let applying = false;
  const SKIP_TYPES = new Set(["password", "hidden", "file", "submit", "button", "image", "reset", "radio"]);

  function trackable(el) {
    if (!el || PaneMux.HUD.owns(el)) return false;
    const auto = (el.getAttribute && el.getAttribute("autocomplete")) || "";
    if (/^(cc-|one-time-code|current-password|new-password)/.test(auto)) return false; // never keep secrets
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    return el.tagName === "INPUT" && !SKIP_TYPES.has((el.type || "text").toLowerCase());
  }
  const isCheck = (el) => el.tagName === "INPUT" && el.type === "checkbox";
  const snapshot = (el) => (isCheck(el) ? el.checked : el.value);

  document.addEventListener("focusin", (e) => {
    const el = e.composedPath()[0];
    if (trackable(el) && !committed.has(el)) committed.set(el, snapshot(el));
  }, true);

  document.addEventListener("change", (e) => {
    if (applying) return;
    const el = e.composedPath()[0];
    if (!trackable(el)) return;
    const after = snapshot(el);
    const before = isCheck(el) ? !after : committed.has(el) ? committed.get(el) : el.defaultValue;
    committed.set(el, after);
    if (before === after) return;
    bg({
      type: "undo.push", kind: "edit", label: `edit ${PaneMux.DomSelector.describe(el)}`,
      data: { desc: PaneMux.DomSelector.descriptor(el), before, after, prop: isCheck(el) ? "checked" : "value" },
    }).then((r) => r && remember(r.id, el));
  }, true);

  // Set through the prototype setter so React/Vue-controlled inputs notice.
  function setField(el, prop, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, prop) || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, prop);
    applying = true;
    try {
      desc.set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } finally {
      applying = false;
    }
    committed.set(el, value);
  }

  // ---- apply (from the service worker) --------------------------------------
  function apply({ node, dir }) {
    const el = target(node);
    if (!el) throw new Error(`element for "${node.kind}" not found on this page`);
    if (node.kind === "hide") {
      setHidden(el, dir === "redo", node.data);
      if (PaneMux.Modes.current === "visual") PaneMux.VisualMode.select(dir === "undo" ? el : (PaneMux.DomSelector.next(el) || PaneMux.DomSelector.parent(el) || document.body));
    } else if (node.kind === "edit") {
      setField(el, node.data.prop, dir === "undo" ? node.data.before : node.data.after);
      el.scrollIntoView({ block: "nearest" });
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg && msg.type === "undo.apply") {
      try { apply(msg); reply({ ok: true }); } catch (e) { reply({ ok: false, error: e.message }); }
    }
  });

  // ---- commands --------------------------------------------------------------
  const report = (r) => { if (r && r.message) PaneMux.HUD.toast(r.message, { error: !!r.error, duration: 2200 }); };
  const { defineCommand: def, map } = PaneMux.Keys;
  def("undo",     async ({ count }) => report(await bg({ type: "undo.undo", count })), { desc: "Undo (closed tab, hidden element, form edit)" });
  def("redo",     async ({ count }) => report(await bg({ type: "undo.redo", count })), { desc: "Redo" });
  def("undoBack", async ({ count }) => report(await bg({ type: "undo.step", delta: -count })), { desc: "g-: previous state in time (any branch)" });
  def("undoFwd",  async ({ count }) => report(await bg({ type: "undo.step", delta: count })), { desc: "g+: next state in time (any branch)" });

  for (const mode of ["normal", "visual"]) {
    map(mode, "<c-r>", "redo");
    map(mode, "g-", "undoBack");
    map(mode, "g+", "undoFwd");
  }
  map("visual", "u", "undo");
  // Half-page scrolling keeps Vim's Ctrl keys whatever "u" does.
  map("normal", "<c-d>", "scrollHalfDown", { motion: true });
  map("normal", "<c-u>", "scrollHalfUp", { motion: true });

  // Phase 1 (Vimium) had u = half page up; Phase 4 (Vim) makes it undo.
  // Options -> "u key" picks; default is undo.
  function applyUKey() {
    map("normal", "u", PaneMux.Settings.get("uKey") === "scroll" ? "scrollHalfUp" : "undo", { motion: PaneMux.Settings.get("uKey") === "scroll" });
  }
  applyUKey();
  PaneMux.Settings.ready.then(applyUKey);
  PaneMux.Settings.onChange(applyUKey);

  return { recordHide, setHidden };
})();
