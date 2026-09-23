// Macros, content side: recording hooks + executing replayed steps.
// The service worker (background/macroRecorder.js) owns the recording and
// drives replay, so a macro keeps going across tab switches and reloads.
//
//   q{a-z}   start recording (q{A-Z} appends)     q   stop
//   {n}@{a-z}  replay n times                     @@  replay last
PaneMux.Macro = (() => {
  const bg = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
  let recording = null; // { reg } mirrored from storage.local.macroRecording
  let replaying = 0;    // >0 while executing a replayed step (don't re-record it)

  // Commands whose effect is recorded as a richer step instead ("hint",
  // "find", "ex"), or that are macro control themselves.
  const SKIP = new Set(["macroRecord", "linkHints", "linkHintsNewTab", "find", "commandBar", "visualPick", "visualEnter"]);

  // ---- REC indicator (right side of the status strip) -------------------------
  function setRecording(rec) {
    recording = rec ? { reg: rec.reg } : null;
    PaneMux.ModeIndicator.setStatus("rec", recording ? `REC @${recording.reg}` : "", "rec");
  }
  try {
    chrome.storage.local.get("macroRecording", (r) => setRecording(r && r.macroRecording));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && "macroRecording" in changes) setRecording(changes.macroRecording.newValue);
    });
  } catch (e) {}

  const live = () => recording && !replaying;
  const record = (step) => { if (live()) bg({ type: "macro.record", step }); };

  // ---- recording hooks ------------------------------------------------------
  PaneMux.Keys.onDispatch((ctx) => {
    if (!live() || SKIP.has(ctx.binding.command)) return;
    record({ t: "cmd", command: ctx.binding.command, count: ctx.hasCount ? ctx.count : null, char: ctx.char, mode: ctx.mode });
  });
  PaneMux.Bus.on("hint", ({ el, newTab, pick }) => record({ t: "hint", desc: PaneMux.DomSelector.descriptor(el), newTab, pick }));
  PaneMux.Bus.on("visual", ({ el }) => record({ t: "visual", desc: PaneMux.DomSelector.descriptor(el) }));
  PaneMux.Bus.on("find", ({ query }) => record({ t: "find", query }));
  PaneMux.Bus.on("ex", ({ text }) => record({ t: "ex", text }));

  // Every key while recording (display only: ":macros" shows these).
  function onKey(key) {
    if (live()) bg({ type: "macro.key", key });
  }

  // Keys Insert mode passed to the page = typing to replay.
  function onPassKey(key) {
    if (!live() || PaneMux.Modes.current !== "insert") return;
    if (key.length === 1) record({ t: "text", text: key });
    else if (key === "<space>") record({ t: "text", text: " " });
    else if (key === "<cr>" || key === "<bs>" || key === "<del>") record({ t: "key", key });
  }

  // ---- commands --------------------------------------------------------------
  // State flips synchronously: the very next key must (not) be recorded. The
  // worker handles messages in order, so start/steps/stop can't reorder.
  async function toggleRecord({ char }) {
    if (recording) {
      setRecording(null);
      const r = await bg({ type: "macro.stop" });
      if (r && r.reg) PaneMux.HUD.toast(`Recorded @${r.reg} (${r.steps} step${r.steps === 1 ? "" : "s"})`);
      return;
    }
    if (!/^[a-zA-Z]$/.test(char || "")) { PaneMux.HUD.toast(`Invalid register "${char}" (a-z, A-Z appends)`, { error: true }); return; }
    setRecording({ reg: char.toLowerCase() });
    const r = await bg({ type: "macro.start", reg: char });
    if (!r || !r.ok) { setRecording(null); PaneMux.HUD.toast((r && r.error) || "Couldn't start recording", { error: true }); }
  }

  async function play({ char, count }) {
    const r = await bg({ type: "macro.play", reg: char, count });
    if (r && !r.ok) PaneMux.HUD.toast(r.error, { error: true });
  }

  const { defineCommand: def, map } = PaneMux.Keys;
  def("macroRecord", toggleRecord, { desc: "q{a-z}: record macro / q: stop" });
  def("macroPlay", play, { desc: "@{a-z}: play macro, @@ last" });
  for (const mode of ["normal", "visual", "tabs"]) {
    map(mode, "q", "macroRecord", { arg: "char", argUnless: () => !!recording });
    map(mode, "@", "macroPlay", { arg: "char" });
  }

  // ---- replay: execute one step ------------------------------------------
  async function exec(step) {
    replaying++;
    try {
      switch (step.t) {
        case "cmd": {
          const cmd = PaneMux.Keys.commands[step.command];
          if (!cmd) throw new Error(`unknown command ${step.command}`);
          await cmd.fn({ count: step.count || 1, hasCount: step.count != null, char: step.char, keys: "", binding: { command: step.command }, mode: PaneMux.Modes.current, replay: true });
          break;
        }
        case "hint": {
          const el = PaneMux.DomSelector.resolve(step.desc);
          if (!el) throw new Error(`element not found: ${step.desc.text || step.desc.css}`);
          if (step.pick) {
            if (PaneMux.Modes.current === "visual") PaneMux.VisualMode.select(el);
            else PaneMux.VisualMode.enter(el);
          } else {
            PaneMux.LinkHints.follow(el, step.newTab);
          }
          break;
        }
        case "visual": {
          const el = PaneMux.DomSelector.resolve(step.desc);
          if (!el) throw new Error(`element not found: ${step.desc.text || step.desc.css}`);
          PaneMux.VisualMode.enter(el);
          break;
        }
        case "find":
          PaneMux.Find.searchFor(step.query);
          break;
        case "ex":
          await PaneMux.CommandPalette.run(step.text);
          break;
        case "text": {
          const el = PaneMux.Dom.activeElement();
          if (!PaneMux.Dom.isEditable(el)) throw new Error("no text field focused for typed text");
          if (!document.execCommand("insertText", false, step.text)) {
            // Fallback for fields execCommand refuses.
            if ("value" in el) { el.value += step.text; el.dispatchEvent(new InputEvent("input", { bubbles: true, data: step.text, inputType: "insertText" })); }
          }
          break;
        }
        case "key": {
          const el = PaneMux.Dom.activeElement();
          if (step.key === "<bs>") document.execCommand("delete");
          else if (step.key === "<del>") document.execCommand("forwardDelete");
          else if (step.key === "<cr>") {
            if (el && el.tagName === "INPUT" && el.form) el.form.requestSubmit();
            else document.execCommand("insertParagraph") || document.execCommand("insertText", false, "\n");
          }
          break;
        }
        default:
          throw new Error(`bad step ${step.t}`);
      }
    } finally {
      replaying--;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg) return;
    if (msg.type === "pmx.ping") { reply({ ok: true }); return; }
    if (msg.type === "hud.toast") { PaneMux.HUD.toast(msg.message, { error: !!msg.error, duration: 3000 }); return; }
    if (msg.type === "macro.exec") {
      exec(msg.step).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: e.message }));
      return true;
    }
  });

  return { onKey, onPassKey, get recording() { return recording; }, get replaying() { return replaying > 0; } };
})();
