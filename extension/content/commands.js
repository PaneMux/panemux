// Phase 1 command set (Vimium parity) and its default Normal-mode bindings.
(() => {
  const { defineCommand: def, map } = PaneMux.Keys;
  const bg = (msg) => chrome.runtime.sendMessage(msg);
  const step = () => PaneMux.Settings.get("scrollStep") || 60;

  // ---- scrolling ------------------------------------------------------
  def("scrollDown",     ({ count, event }) => PaneMux.Scroll.by(0, step() * count, event), { desc: "Scroll down" });
  def("scrollUp",       ({ count, event }) => PaneMux.Scroll.by(0, -step() * count, event), { desc: "Scroll up" });
  def("scrollLeft",     ({ count, event }) => PaneMux.Scroll.by(-step() * count, 0, event), { desc: "Scroll left" });
  def("scrollRight",    ({ count, event }) => PaneMux.Scroll.by(step() * count, 0, event), { desc: "Scroll right" });
  def("scrollHalfDown", ({ count, event }) => PaneMux.Scroll.by(0, (PaneMux.Scroll.viewportHeight() / 2) * count, event), { desc: "Scroll half a page down" });
  def("scrollHalfUp",   ({ count, event }) => PaneMux.Scroll.by(0, -(PaneMux.Scroll.viewportHeight() / 2) * count, event), { desc: "Scroll half a page up" });
  def("scrollToTop",    ({ event }) => PaneMux.Scroll.to({ y: 0 }, event), { desc: "Scroll to top" });
  def("scrollToBottom", ({ event }) => PaneMux.Scroll.to({ y: Infinity }, event), { desc: "Scroll to bottom" });

  // ---- link hints -------------------------------------------------------
  def("linkHints",       () => PaneMux.LinkHints.activate(false), { desc: "Open a link in the current tab" });
  def("linkHintsNewTab", () => PaneMux.LinkHints.activate(true),  { desc: "Open a link in a new tab" });

  // ---- tabs -------------------------------------------------------------
  def("newTab",  () => bg({ type: "tabs.create" }), { desc: "Open a new tab" });
  def("nextTab", ({ count }) => bg({ type: "tabs.move", delta: count }), { desc: "Go to the next tab" });
  def("prevTab", ({ count }) => bg({ type: "tabs.move", delta: -count }), { desc: "Go to the previous tab" });
  // Vim: {count}gt jumps to tab {count}; plain gt is next tab.
  def("gotoTab", ({ count, hasCount }) => bg(hasCount ? { type: "tabs.goto", index: count - 1 } : { type: "tabs.move", delta: 1 }), { desc: "Next tab / {count}gt goes to tab N" });

  // ---- find -------------------------------------------------------------
  def("find",     () => PaneMux.Find.open(), { desc: "Find on page" });
  def("commandBar", () => PaneMux.CommandPalette.open(), { desc: "Open the : command bar" });
  def("findNext", ({ count }) => PaneMux.Find.next(false, count), { desc: "Next match" });
  def("findPrev", ({ count }) => PaneMux.Find.next(true, count), { desc: "Previous match" });

  // ---- history ----------------------------------------------------------
  def("historyBack",    ({ count }) => history.go(-count), { desc: "Go back in history" });
  def("historyForward", ({ count }) => history.go(count), { desc: "Go forward in history" });

  // ---- marks ------------------------------------------------------------
  def("setMark",  ({ char }) => PaneMux.Marks.set(char), { desc: "Set mark (a-z local, A-Z global)" });
  def("jumpMark", ({ char }) => PaneMux.Marks.jump(char), { desc: "Jump to mark" });

  // ---- misc -------------------------------------------------------------
  def("yankUrl", async () => {
    const url = location.href;
    const reg = PaneMux.Registers ? PaneMux.Registers.take() : '"'; // "ayy -> register a (take before any await)
    await PaneMux.Dom.copyText(url);
    bg({ type: "reg.set", name: reg, value: url });
    PaneMux.HUD.toast(`Yanked ${url}${reg === '"' ? "" : ` into "${reg}`}`);
  }, { desc: "Copy the page URL" });

  // ---- splits: W prefix (Chrome reserves Ctrl+W, so Vim's <C-w> can't be caught) ----
  const splitMsg = async (msg) => { const r = await bg(msg); if (r && r.ok === false) PaneMux.HUD.toast(r.error, { error: true }); };
  for (const dir of ["h", "j", "k", "l"]) def(`splitFocus_${dir}`, () => splitMsg({ type: "split.focus", dir }), { desc: `Focus split ${dir}` });
  def("splitCycle", () => splitMsg({ type: "split.cycle" }), { desc: "Focus next split window" });
  def("splitClose", () => splitMsg({ type: "split.close" }), { desc: "Close this split" });

  // gi: focus the first visible text field ({count}gi picks the nth).
  def("focusInput", ({ count }) => {
    const fields = [...document.querySelectorAll("input, textarea, [contenteditable=''], [contenteditable='true'], [role=textbox]")]
      .filter((el) => PaneMux.Dom.isEditable(el) && !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
    const el = fields[Math.min(count, fields.length) - 1];
    if (!el) { PaneMux.HUD.toast("No text box on this page", { error: true }); return; }
    el.focus();
    el.scrollIntoView({ block: "nearest" });
  }, { desc: "Focus the first text input" });

  def("enterInsert", () => PaneMux.Modes.enter("insert"), { desc: "Insert mode (pass keys to the page)" });

  def("escape", () => {
    if (PaneMux.Find.hasHighlights) PaneMux.Find.clear();
    const active = PaneMux.Dom.activeElement();
    if (active && active !== document.body && !PaneMux.HUD.owns(active)) active.blur();
  }, { desc: "Clear search highlights / blur" });

  // ---- default key map (Normal mode) -----------------------------------
  const N = "normal";
  const motion = { motion: true };
  map(N, "j", "scrollDown", motion);
  map(N, "<down>", "scrollDown", motion);
  map(N, "k", "scrollUp", motion);
  map(N, "<up>", "scrollUp", motion);
  map(N, "h", "scrollLeft", motion);
  map(N, "l", "scrollRight", motion);
  map(N, "d", "scrollHalfDown", motion);
  map(N, "u", "scrollHalfUp", motion);
  map(N, "gg", "scrollToTop", motion);
  map(N, "G", "scrollToBottom", motion);

  map(N, "f", "linkHints");
  map(N, "F", "linkHintsNewTab");

  map(N, "t", "newTab");
  map(N, "J", "nextTab");
  map(N, "K", "prevTab");
  map(N, "gt", "gotoTab");
  map(N, "gT", "prevTab");

  map(N, "/", "find");
  map(N, ":", "commandBar");
  map(N, "n", "findNext");
  map(N, "N", "findPrev");

  map(N, "H", "historyBack");
  map(N, "L", "historyForward");

  map(N, "m", "setMark", { arg: "char" });
  map(N, "`", "jumpMark", { arg: "char" });
  map(N, "'", "jumpMark", { arg: "char" });

  map(N, "yy", "yankUrl");
  for (const dir of ["h", "j", "k", "l"]) map(N, `W${dir}`, `splitFocus_${dir}`);
  map(N, "Ww", "splitCycle");
  map(N, "Wc", "splitClose");
  map(N, "i", "enterInsert");
  map(N, "gi", "focusInput");
  map(N, "<esc>", "escape", { passKey: true }); // pages still get Esc (close their own modals)
})();
