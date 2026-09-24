// Vimgolf, page side: counts strokes, estimates par, shows the scorecard.
//
// Strokes: every key PaneMux handles (typing into its own boxes too; typing
// into the page doesn't count, the mouse user types that as well).
// Par: roughly how many mouse actions the same command takes (a click is 1,
// aiming at a small target and clicking is 2, a wheel flick is 1, every typed
// character is 1). Replaying a macro scores the par of every step it runs, for
// the two keys "@a" cost, which is the point of macros.
//
// The round itself lives in the service worker (background/vimgolf.js):
// ":golf" starts and ends it, ":golf board" shows the leaderboard.
PaneMux.Vimgolf = (() => {
  // par per command, times the count unless noted
  const PAR = {
    scrollDown: 1, scrollUp: 1, scrollLeft: 1, scrollRight: 1,
    scrollHalfDown: 2, scrollHalfUp: 2,
    scrollToTop: [3], scrollToBottom: [3],          // [n]: flat, ignores the count
    linkHints: [2], linkHintsNewTab: [3], focusInput: [2],
    newTab: [1], nextTab: 2, prevTab: 2, gotoTab: [2],
    historyBack: 2, historyForward: 2,
    find: [3], findNext: 1, findPrev: 1,             // + the query, when it's typed
    setMark: [0], jumpMark: [6],                     // mice can't mark: scroll back and look
    yankUrl: [4],                                    // click the address bar, select, copy
    visualEnter: [2], visualParent: 1, visualChild: 1, visualNext: 1, visualPrev: 1,
    visualHide: [6], visualYank: [8], visualRead: [6], visualPick: [1], visualChange: [6],
    tabOverview: [2], putTabs: [6], selectRegister: [0],
    undo: [3], redo: [3], undoBack: [3], undoFwd: [3], undoPanel: [2],
    splitFocus_h: [2], splitFocus_j: [2], splitFocus_k: [2], splitFocus_l: [2], splitCycle: [2], splitClose: [2],
    showHelp: [1], enterInsert: [1],
  };
  // text objects: drag-select and copy; hiding or editing needs dev tools
  const TOBJ = { y: 6, d: 8, c: 6 };

  function parFor(command, count = 1) {
    if (/^tobj_/.test(command)) return TOBJ[command[5]] || 6;
    if (/^tobjSelect_/.test(command)) return 2;
    const p = PAR[command];
    if (p === undefined) return 1;
    return Array.isArray(p) ? p[0] : p * Math.max(1, count);
  }

  let session = null; // mirror of storage.local golfSession
  let strokes = 0;    // not yet sent
  let par = 0;
  let command = null; // the latest one, for the card's "last:" line
  let lastPar = 0;
  let commands = 0;
  let timer = null;
  let panel = null;

  const on = () => !!session && PaneMux.Features.enabled("vimgolf");

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!strokes && !par && !commands) return;
    const msg = { type: "golf.add", strokes, par, command, lastPar, commands };
    strokes = 0; par = 0; command = null; commands = 0;
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
  const later = () => { if (!timer) timer = setTimeout(flush, 250); };

  function stroke() {
    if (!on()) return;
    strokes++;
    later();
  }

  function scored(cmdName, p, { counts = true } = {}) {
    if (!on()) return;
    par += p;
    if (counts) { command = cmdName; lastPar = p; commands++; }
    later();
  }

  const replaying = () => PaneMux.Macro && PaneMux.Macro.replaying;

  // ---- scorecard (top-right, click-through) -------------------------------------

  const fmt = (d) => (d < 0 ? `−${-d}` : d > 0 ? `+${d}` : "E");

  function render() {
    if (!on()) { if (panel) { panel.remove(); panel = null; } return; }
    PaneMux.HUD.attach();
    if (!panel) {
      panel = PaneMux.HUD.el("div", "golf panel");
      panel.setAttribute("role", "status");
      panel.innerHTML = `<div class="golf-head"><span class="golf-title">Vimgolf</span><span class="golf-live">round in play</span></div>
        <div class="golf-nums">
          <div><b data-k="strokes"></b><span>strokes</span></div>
          <div><b data-k="par"></b><span>par</span></div>
          <div class="golf-score"><b data-k="score"></b><span data-k="verdict"></span></div>
        </div>
        <div class="golf-last" data-k="last"></div>`;
    }
    const s = session;
    const d = s.strokes - s.par;
    const set = (k, v) => { panel.querySelector(`[data-k="${k}"]`).textContent = v; };
    set("strokes", String(s.strokes));
    set("par", String(s.par));
    set("score", fmt(d));
    set("verdict", d < 0 ? "under par" : d > 0 ? "over par" : "even");
    panel.classList.toggle("under", d < 0);
    panel.classList.toggle("over", d > 0);
    set("last", s.last ? `last: ${label(s.last.command)} · par ${s.last.par}` : "par = mouse clicks for the same work");
  }

  // "tobj_yap" -> "yap", commands -> their default keys where we know them
  function label(cmd) {
    if (/^tobj_/.test(cmd)) return cmd.slice(5);
    if (/^tobjSelect_/.test(cmd)) return cmd.slice(11);
    if (cmd.startsWith(":")) return cmd;
    const b = PaneMux.Keymap && PaneMux.Keymap.defaults.find((x) => x.command === cmd);
    return b ? b.keys : cmd;
  }

  // ---- wiring ----------------------------------------------------------------------

  if (!PaneMux.registryOnly) {
    PaneMux.Bus.on("stroke", stroke);
    PaneMux.Keys.onDispatch((ctx) => {
      if (replaying()) return; // counted through "replayStep"
      const name = ctx.binding.command;
      if (name === "commandBar") return; // the ":" command is scored when it runs
      if (name === "macroRecord" || name === "macroPlay") { scored(name, 0); return; }
      scored(name, parFor(name, ctx.count));
    });
    PaneMux.Bus.on("find", ({ query }) => { if (!replaying()) scored("find", (query || "").length, { counts: false }); });
    PaneMux.Bus.on("replayStep", (step) => {
      switch (step.t) {
        case "cmd": scored(step.command, parFor(step.command, step.count || 1)); break;
        case "hint": scored(step.newTab ? "linkHintsNewTab" : "linkHints", step.newTab ? 3 : 2); break;
        case "visual": scored("visualEnter", 2); break;
        case "find": scored("find", 3 + (step.query || "").length); break;
        case "text": scored("typing", step.text.length); break;
        case "key": scored("typing", 1); break;
        default: break; // "ex": the service worker scores it when it runs
      }
    });

    const load = (s) => { session = s || null; render(); };
    chrome.storage.local.get("golfSession").then((r) => load(r.golfSession)).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && "golfSession" in changes) load(changes.golfSession.newValue);
    });
    PaneMux.Settings.onChange(render);
    addEventListener("pagehide", flush);
  }

  return { parFor, get session() { return session; }, flush };
})();
