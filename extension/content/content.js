// Entry point: routes every keystroke through the current mode, tracks focus
// for automatic Insert mode, and applies settings to the HUD.
(() => {
  if (window.__paneMuxLoaded) return;
  window.__paneMuxLoaded = true;

  const { Keys, Modes, HUD, Dom } = PaneMux;
  const suppressedKeyups = new Set();

  function consume(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    suppressedKeyups.add(e.code);
  }

  function onKeydown(e) {
    if (!e.isTrusted || e.isComposing) return;
    const key = Keys.normalize(e);
    const handler = Modes.handler;
    if (!key) {
      // Bare modifiers (Ctrl of Ctrl+A) while typing in our own input: hide from the page too.
      if (handler && handler.onKey && HUD.owns(Dom.activeElement())) e.stopImmediatePropagation();
      return;
    }

    if (PaneMux.Macro) PaneMux.Macro.onKey(key);

    // Overlay modes (hints, find, command bar) get first say.
    if (handler && handler.onKey) {
      const r = handler.onKey(key, e);
      if (r === "handled") consume(e);
      else if (r === "input") e.stopImmediatePropagation(); // typing into our own input: keep it from page shortcuts
      return;
    }

    // Focus landed in an editable without a focus event we saw (autofocus, etc.).
    if (Modes.current === "normal" && Dom.isEditable(Dom.activeElement()) && !HUD.owns(Dom.activeElement())) {
      Modes.enter("insert");
    }

    if (Keys.feed(key, e)) consume(e);
    else if (PaneMux.Macro) PaneMux.Macro.onPassKey(key);
  }

  function onKeyup(e) {
    if (suppressedKeyups.delete(e.code)) e.stopImmediatePropagation();
  }

  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("keyup", onKeyup, true);

  // ---- automatic Insert mode -------------------------------------------
  document.addEventListener("focusin", (e) => {
    const t = e.composedPath()[0] || e.target;
    if (HUD.owns(t) || HUD.owns(e.target)) return;
    if (Dom.isEditable(t) && Modes.current === "normal") Modes.enter("insert");
  }, true);

  document.addEventListener("focusout", (e) => {
    const t = e.composedPath()[0] || e.target;
    if (HUD.owns(e.target) || !Dom.isEditable(t)) return;
    setTimeout(() => {
      if (Modes.current === "insert" && !Dom.isEditable(Dom.activeElement())) Modes.enter("normal");
    }, 0);
  }, true);

  // Insert mode: only <esc> is ours; everything else goes to the page.
  Keys.defineCommand("exitInsert", () => {
    const active = Dom.activeElement();
    if (active && Dom.isEditable(active)) active.blur();
    Modes.enter("normal");
  }, { desc: "Leave Insert mode" });
  Keys.map("insert", "<esc>", "exitInsert");

  // Any mode switch abandons a half-typed command (except the FSM's own
  // switch into Operator-pending).
  Modes.onChange((mode, prev) => {
    if (mode !== "operator" && prev !== "operator" && Keys.state !== Keys.STATES.IDLE) Keys.reset();
  });

  // ---- settings -> HUD ---------------------------------------------------
  function applySettings() {
    HUD.applyTheme(PaneMux.Settings.get("theme"));
    PaneMux.ModeIndicator.setVisible(PaneMux.Settings.get("showModeOrb"));
  }
  PaneMux.Settings.ready.then(applySettings);
  PaneMux.Settings.onChange(applySettings);

  HUD.attach();
  if (Dom.isEditable(Dom.activeElement())) Modes.enter("insert");
})();
