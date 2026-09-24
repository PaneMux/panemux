// "?" help overlay: every key that works right now (respects the active
// preset and any remapped keys), grouped Move / Click / Tabs / Edit /
// Advanced, one plain-English line each, with a search box.
PaneMux.Help = (() => {
  const GROUPS = ["Move", "Click", "Tabs", "Edit", "Advanced"];

  // command -> [group, beginner-friendly description]
  const TEXT = {
    scrollDown: ["Move", "Scroll down"],
    scrollUp: ["Move", "Scroll up"],
    scrollLeft: ["Move", "Scroll left"],
    scrollRight: ["Move", "Scroll right"],
    scrollHalfDown: ["Move", "Scroll down half a screen"],
    scrollHalfUp: ["Move", "Scroll up half a screen"],
    scrollToTop: ["Move", "Jump to the top of the page"],
    scrollToBottom: ["Move", "Jump to the bottom of the page"],
    historyBack: ["Move", "Go back a page"],
    historyForward: ["Move", "Go forward a page"],
    find: ["Move", "Search this page"],
    findNext: ["Move", "Next search match"],
    findPrev: ["Move", "Previous search match"],
    setMark: ["Move", "Remember this spot (then press a letter)"],
    jumpMark: ["Move", "Go back to a remembered spot (then press its letter)"],
    linkHints: ["Click", "Click a link or button by typing its letters"],
    linkHintsNewTab: ["Click", "Open a link in a new tab by typing its letters"],
    focusInput: ["Click", "Jump into the first text box"],
    enterInsert: ["Click", "Let every key go to the page until Esc"],
    newTab: ["Tabs", "Open a new tab"],
    nextTab: ["Tabs", "Go to the next tab"],
    prevTab: ["Tabs", "Go to the previous tab"],
    gotoTab: ["Tabs", "Next tab (type a number first to pick one)"],
    yankUrl: ["Edit", "Copy this page's address"],
    visualEnter: ["Edit", "Select part of the page to hide, copy or read"],
    undo: ["Edit", "Undo (reopen a tab, bring back something hidden)"],
    redo: ["Edit", "Redo"],
    showHelp: ["Edit", "Show this help"],
    tobj_yap: ["Edit", "Copy the paragraph you're reading as Markdown (yip: just its text)"],
    tobj_yas: ["Edit", "Copy the whole section"],
    tobj_dap: ["Edit", "Hide the paragraph (dip empties it instead)"],
    tobj_cit: ["Edit", "Edit this element's text right on the page"],
    commandBar: ["Advanced", "Type a command, like closing every matching tab"],
    macroRecord: ["Advanced", "Record your keys into a letter (press again to stop)"],
    macroPlay: ["Advanced", "Replay recorded keys (then press the letter)"],
    tabOverview: ["Advanced", "List tabs to save or close several at once"],
    putTabs: ["Advanced", "Reopen a saved group of tabs"],
    selectRegister: ["Advanced", "Choose a slot (letter) for the next copy or paste"],
    undoBack: ["Advanced", "Step back through every past change"],
    undoFwd: ["Advanced", "Step forward through every past change"],
    undoPanel: ["Advanced", "Show the history of changes as a tree"],
    splitFocus_h: ["Advanced", "Move to the window on the left"],
    splitFocus_j: ["Advanced", "Move to the window below"],
    splitFocus_k: ["Advanced", "Move to the window above"],
    splitFocus_l: ["Advanced", "Move to the window on the right"],
    splitCycle: ["Advanced", "Move to the next window"],
    splitClose: ["Advanced", "Close this window of a split"],
  };

  // Same key-name prettifier as the keystroke trail, plus char-arg hints.
  function keyLabel(b) {
    const keys = PaneMux.Keys.parseKeys(b.keys).map((k) => PaneMux.Trail.pretty(k)).join(" ");
    return b.arg === "char" ? `${keys} …` : keys;
  }

  // Normal-mode bindings the FSM would actually honour, grouped by command.
  function entries() {
    const byCommand = new Map();
    for (const b of PaneMux.Keys.bindings("normal")) {
      if (!TEXT[b.command] || !PaneMux.Features.commandEnabled(b.command)) continue;
      if (!byCommand.has(b.command)) byCommand.set(b.command, []);
      byCommand.get(b.command).push(keyLabel(b));
    }
    const out = [];
    for (const [command, keys] of byCommand) {
      keys.sort((a, b) => a.length - b.length); // "d" before "Ctrl-d"
      const [group, text] = TEXT[command];
      out.push({ command, group, text, keys });
    }
    return out;
  }

  let ui = null;

  function render() {
    const q = ui.input.value.trim().toLowerCase();
    ui.body.textContent = "";
    const list = entries().filter((e) => !q || e.text.toLowerCase().includes(q) || e.keys.some((k) => k.toLowerCase() === q || k.toLowerCase().includes(q)));
    if (!list.length) {
      const empty = PaneMux.HUD.el("div", "help-empty", ui.body);
      empty.textContent = `Nothing matches "${ui.input.value}".`;
      return;
    }
    for (const g of GROUPS) {
      const rows = list.filter((e) => e.group === g);
      if (!rows.length) continue;
      const box = PaneMux.HUD.el("section", "help-group", ui.body);
      box.dataset.group = g;
      PaneMux.HUD.el("h3", "", box).textContent = g;
      for (const e of rows) {
        const row = PaneMux.HUD.el("div", "help-row", box);
        row.dataset.command = e.command;
        const k = PaneMux.HUD.el("span", "keys", row);
        for (const key of e.keys) PaneMux.HUD.el("kbd", "", k).textContent = key;
        PaneMux.HUD.el("span", "text", row).textContent = e.text;
      }
    }
  }

  function open() {
    if (ui) return;
    PaneMux.HUD.attach();
    const panel = PaneMux.HUD.el("div", "help panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "PaneMux keys");
    const head = PaneMux.HUD.el("div", "help-head", panel);
    PaneMux.HUD.el("span", "title", head).textContent = "Keys";
    const input = PaneMux.HUD.el("input", "", head);
    input.type = "search";
    input.placeholder = "Search, e.g. \"tab\" or \"f\"";
    input.spellcheck = false;
    const body = PaneMux.HUD.el("div", "help-body", panel);
    const foot = PaneMux.HUD.el("div", "help-foot", panel);
    const preset = PaneMux.Settings.get("preset");
    foot.textContent = `Esc to close · ${preset === "classic" ? "More features (macros, undo, splits…) can be turned on in Settings" : "Change keys or presets in Settings"}`;
    ui = { panel, input, body };
    input.addEventListener("input", render);
    render();
    PaneMux.Modes.enter("normal", { onKey, onExit: () => teardown() });
    input.focus();
  }

  function onKey(key) {
    if (key === "<esc>" || (key === "?" && !ui.input.value)) { close(); return "handled"; }
    return "input";
  }

  function teardown() {
    if (!ui) return;
    ui.panel.remove();
    ui = null;
  }

  function close() {
    teardown();
    PaneMux.Modes.enter("normal");
  }

  PaneMux.Keys.defineCommand("showHelp", () => open(), { desc: "Show all keys" });
  PaneMux.Keys.map("normal", "?", "showHelp");

  return { open, close, entries, TEXT, GROUPS, get isOpen() { return !!ui; } };
})();
