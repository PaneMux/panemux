// Entry point: routes every keystroke through the current mode, tracks focus
// for automatic Insert mode, turns PaneMux off on paused sites, and applies
// settings to the HUD.
(() => {
  if (window.__paneMuxLoaded) return;
  window.__paneMuxLoaded = true;

  const { Keys, Modes, HUD, Dom } = PaneMux;
  const suppressedKeyups = new Set();
  let active = true;        // false when switched off or paused for this site
  let insertByFocus = false; // Insert mode came from focusing a field (not from "i")

  function consume(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    suppressedKeyups.add(e.code);
    if (PaneMux.Nudges) PaneMux.Nudges.touchDay();
    PaneMux.Bus.emit("stroke"); // Vimgolf counts every key PaneMux takes
  }

  const ownFocus = () => HUD.owns(Dom.activeElement());

  function onKeydown(e) {
    if (!active || !e.isTrusted || e.isComposing) return;
    const key = Keys.normalize(e);
    const handler = Modes.handler;
    if (!key) {
      // Bare modifiers (Ctrl of Ctrl+A) while typing in our own input: hide from the page too.
      if (handler && handler.onKey && ownFocus()) e.stopImmediatePropagation();
      return;
    }

    if (PaneMux.Macro) PaneMux.Macro.onKey(key);

    // Overlay modes (hints, find, command bar, help) get first say.
    if (handler && handler.onKey) {
      const r = handler.onKey(key, e);
      if (r === "handled" || r === "ignored") {
        consume(e);
        if (r === "handled") PaneMux.Trail.push(key);
        else if (PaneMux.Nudges) PaneMux.Nudges.invalidKey(key);
      } else if (r === "input") {
        e.stopImmediatePropagation(); // typing into our own input: keep it from page shortcuts
        PaneMux.Bus.emit("stroke");
      }
      return;
    }

    syncInsertWithFocus();

    if (Keys.feed(key, e)) {
      consume(e);
      if (Modes.current !== "insert") PaneMux.Trail.push(key);
    } else {
      if (PaneMux.Macro) PaneMux.Macro.onPassKey(key);
      if (PaneMux.Nudges && Modes.current !== "insert" && !Dom.isEditable(Dom.activeElement())) PaneMux.Nudges.invalidKey(key);
    }
  }

  function onKeyup(e) {
    if (suppressedKeyups.delete(e.code)) e.stopImmediatePropagation();
  }

  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("keyup", onKeyup, true);

  // ---- automatic Insert mode (auto-passthrough) --------------------------
  // Focusing anything editable — <input>, <textarea>, contenteditable, a
  // role=textbox widget, even inside a web component's shadow root — hands
  // the keyboard to the page until Esc or the field loses focus.

  function enterInsertFromFocus() {
    insertByFocus = true;
    Modes.enter("insert");
  }

  // Catch focus changes we never got an event for (autofocus before we loaded,
  // a focused field removed from the DOM, focus() from a script mid-keystroke).
  function syncInsertWithFocus() {
    const el = Dom.activeElement();
    const editable = Dom.isEditable(el) && !HUD.owns(el);
    if (Modes.current === "normal" && editable) enterInsertFromFocus();
    else if (Modes.current === "insert" && insertByFocus && !editable) { insertByFocus = false; Modes.enter("normal"); }
  }

  document.addEventListener("focusin", (e) => {
    if (!active) return;
    const t = e.composedPath()[0] || e.target;
    if (HUD.owns(t) || HUD.owns(e.target)) return;
    if (Dom.isEditable(t) && Modes.current === "normal") enterInsertFromFocus();
  }, true);

  document.addEventListener("focusout", (e) => {
    if (!active) return;
    const t = e.composedPath()[0] || e.target;
    if (HUD.owns(e.target) || !Dom.isEditable(t)) return;
    setTimeout(() => {
      if (Modes.current === "insert" && !Dom.isEditable(Dom.activeElement())) { insertByFocus = false; Modes.enter("normal"); }
    }, 0);
  }, true);

  Modes.onChange((mode) => { if (mode !== "insert") insertByFocus = false; });

  // Insert mode: only <esc> is ours; everything else goes to the page.
  Keys.defineCommand("exitInsert", () => {
    const el = Dom.activeElement();
    if (el && Dom.isEditable(el)) el.blur();
    Modes.enter("normal");
  }, { desc: "Leave Insert mode" });
  Keys.map("insert", "<esc>", "exitInsert");

  // Any mode switch abandons a half-typed command (except the FSM's own
  // switch into Operator-pending).
  Modes.onChange((mode, prev) => {
    if (mode !== "operator" && prev !== "operator" && Keys.state !== Keys.STATES.IDLE) Keys.reset();
  });

  // ---- on / off / paused for this site ------------------------------------
  const siteKey = () => location.hostname || location.protocol;

  function setActive(on) {
    if (on === active) return;
    active = on;
    Keys.reset();
    if (!on) {
      if (Modes.handler && Modes.handler.onExit) Modes.enter("normal");
      HUD.setEnabled(false);
      PaneMux.ModeIndicator.stop();
    } else {
      HUD.setEnabled(true);
      PaneMux.ModeIndicator.start();
      syncInsertWithFocus();
    }
  }

  // ---- settings -> HUD ---------------------------------------------------
  function applySettings() {
    const S = PaneMux.Settings;
    const paused = (S.get("pausedSites") || []).includes(siteKey());
    setActive(S.get("enabled") !== false && !paused);
    HUD.setScanlines(!!S.get("scanlines"));
    if (active) PaneMux.ModeIndicator.relayout();
  }

  active = false; // start "off" until settings say otherwise (avoids a flash on paused sites)
  HUD.setEnabled(false);
  PaneMux.Settings.ready.then(() => {
    applySettings();
    if (active) syncInsertWithFocus();
  });
  PaneMux.Settings.onChange(applySettings);

  PaneMux.isActive = () => active;
})();
