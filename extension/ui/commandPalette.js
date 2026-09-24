// ":" command bar. Glitches in at the top-centre, fuzzy-matches the command
// name against the background registry, runs the command there.
PaneMux.CommandPalette = (() => {
  const MAX_SUGGESTIONS = 8;
  let commandsPromise = null;
  let ui = null; // { panel, input, list, items, selected, commands }
  const history = [];
  let historyIndex = -1;

  try { chrome.storage.local.get("cmdHistory", (r) => { if (r && Array.isArray(r.cmdHistory)) history.push(...r.cmdHistory); }); } catch (e) {}

  function loadCommands() {
    if (!commandsPromise) {
      commandsPromise = chrome.runtime.sendMessage({ type: "cmd.list" })
        .then((r) => (r && r.commands) || [])
        .catch(() => { commandsPromise = null; return []; });
    }
    return commandsPromise;
  }

  // Command-name part of the input: ":g/x/close" -> "g", ":tabdo close" -> "tabdo".
  function splitInput(text) {
    const t = text.replace(/^:+/, "");
    const g = t.match(/^(g!?|global!?|vglobal|v)(?=\/)/);
    if (g) return { token: g[1], rest: t.slice(g[1].length), sep: "" };
    const m = t.match(/^(\S*)(\s*)([\s\S]*)$/);
    return { token: m[1], rest: m[3], sep: m[2] };
  }

  const names = (c) => [c.name, ...(c.aliases || [])];
  const isExact = (token, cmds) => cmds.some((c) => names(c).includes(token));

  async function open(initial = "") {
    if (ui) { ui.input.focus(); return; }
    PaneMux.HUD.attach();
    const panel = PaneMux.HUD.el("div", "palette panel");
    const row = PaneMux.HUD.el("div", "palette-row", panel);
    const prompt = PaneMux.HUD.el("span", "prompt", row);
    prompt.textContent = ":";
    const input = PaneMux.HUD.el("input", "", row);
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Command");
    input.placeholder = "command  (Tab completes, ↑↓ select, Ctrl-k/j history)";
    input.value = initial;
    const list = PaneMux.HUD.el("ul", "suggestions", panel);
    ui = { panel, input, list, items: [], selected: 0, commands: [] };
    historyIndex = -1;
    input.addEventListener("input", () => { ui.selected = 0; render(); });
    PaneMux.Modes.enter("command", { onKey, onExit: () => teardown() });
    input.focus();
    ui.commands = await loadCommands();
    if (ui) render();
  }

  function render() {
    const { token } = splitInput(ui.input.value);
    const cmds = ui.commands;
    ui.items = token
      ? PaneMux.Fuzzy.filter(token, cmds, names)
      : cmds.map((item) => ({ item, key: item.name, indices: [] })).sort((a, b) => a.key.localeCompare(b.key));
    ui.items = ui.items.slice(0, MAX_SUGGESTIONS);
    ui.selected = Math.min(ui.selected, Math.max(0, ui.items.length - 1));
    ui.list.textContent = "";
    ui.items.forEach((s, i) => {
      const li = document.createElement("li");
      li.className = i === ui.selected ? "selected" : "";
      li.dataset.name = s.item.name;
      const name = document.createElement("span");
      name.className = "name";
      const hit = new Set(s.indices);
      [...s.key].forEach((ch, ci) => {
        if (hit.has(ci)) { const b = document.createElement("b"); b.textContent = ch; name.appendChild(b); }
        else name.append(ch);
      });
      if (s.key !== s.item.name) { const a = document.createElement("span"); a.className = "alias"; a.textContent = ` → ${s.item.name}`; name.appendChild(a); }
      const usage = document.createElement("span");
      usage.className = "usage";
      usage.textContent = s.item.usage;
      const desc = document.createElement("div");
      desc.className = "desc";
      desc.textContent = s.item.desc;
      li.append(name, usage, desc);
      ui.list.appendChild(li);
    });
    ui.panel.classList.toggle("nomatch", !!token && !ui.items.length);
  }

  function move(delta) {
    if (!ui.items.length) return;
    ui.selected = (ui.selected + delta + ui.items.length) % ui.items.length;
    render();
  }

  // Tab: complete the command name to the selected suggestion.
  function complete() {
    const s = ui.items[ui.selected];
    if (!s) return;
    const { rest, sep } = splitInput(ui.input.value);
    const name = s.item.name;
    const glue = name.startsWith("g") && (name === "g" || name === "g!") ? (rest.startsWith("/") ? "" : "/") : sep || " ";
    ui.input.value = name + glue + rest;
    ui.input.setSelectionRange(ui.input.value.length, ui.input.value.length);
    render();
  }

  function recall(delta) {
    if (!history.length) return;
    historyIndex = Math.max(-1, Math.min(history.length - 1, historyIndex + delta));
    ui.input.value = historyIndex === -1 ? "" : history[history.length - 1 - historyIndex];
    render();
  }

  function onKey(key) {
    switch (key) {
      case "<esc>": close(); return "handled";
      case "<cr>": submit(); return "handled";
      case "<tab>": complete(); return "handled";
      case "<down>": case "<c-n>": move(1); return "handled";
      case "<s-tab>": case "<up>": case "<c-p>": move(-1); return "handled";
      case "<c-k>": recall(1); return "handled";   // older history entry
      case "<c-j>": recall(-1); return "handled";  // newer
      case "<bs>":
        if (!ui.input.value) { close(); return "handled"; }
        return "input";
      default: return "input";
    }
  }

  function teardown() {
    if (!ui) return;
    const u = ui;
    ui = null;
    u.input.blur();
    u.panel.remove();
  }

  function close() {
    teardown();
    if (PaneMux.Modes.current === "command") PaneMux.Modes.exit();
  }

  async function submit() {
    let text = ui.input.value.trim().replace(/^:+/, "");
    const cmds = ui.commands;
    const { token, rest, sep } = splitInput(text);
    // Fuzzy: an inexact name runs the highlighted suggestion.
    if (token && !isExact(token, cmds) && ui.items[ui.selected]) {
      const name = ui.items[ui.selected].item.name;
      text = name + (name === "g" || name === "g!" ? "" : sep || " ") + rest;
    }
    close();
    if (!text) return;
    history.push(text);
    if (history.length > 50) history.shift();
    try { chrome.storage.local.set({ cmdHistory: history }); } catch (e) {}
    PaneMux.Bus.emit("ex", { text });
    return run(text);
  }

  async function run(text) {
    let res;
    try {
      const screenArea = { left: screen.availLeft || 0, top: screen.availTop || 0, width: screen.availWidth, height: screen.availHeight };
      res = await chrome.runtime.sendMessage({ type: "cmd.run", text, screen: screenArea });
    } catch (e) {
      return; // our own tab was closed by the command
    }
    if (!res) return;
    if (res.ok && res.confirm) return confirmClose(res.confirm);
    if (!res.ok) PaneMux.HUD.toast(res.error || "Command failed", { error: true, duration: 3000 });
    else if (res.action === "undoPanel") PaneMux.UndoPanel.toggle();
    else if (res.action === "minimap") PaneMux.Minimap.toggle();
    else if (res.output) PaneMux.Output.show(res.output);
    else if (res.message) PaneMux.HUD.toast(res.message);
    return res;
  }

  // Shared by the command bar and the tab overview.
  async function confirmClose(c) {
    const ok = await PaneMux.Preview.ask(c);
    const res = await chrome.runtime.sendMessage({ type: ok ? "close.confirm" : "close.cancel", id: c.id }).catch(() => null);
    if (!ok) PaneMux.HUD.toast("Nothing was closed");
    else if (res && !res.ok) PaneMux.HUD.toast(res.error, { error: true });
    return res;
  }

  return { open, close, run, confirmClose, splitInput, get active() { return !!ui; } };
})();

// Read-only output panel (":reg" etc.). Any key closes it.
PaneMux.Output = (() => {
  let panel = null;

  function show({ title, columns = [], rows = [] }) {
    hide();
    PaneMux.HUD.attach();
    panel = PaneMux.HUD.el("div", "output panel");
    const h = PaneMux.HUD.el("div", "output-title", panel);
    h.textContent = title || "";
    const table = PaneMux.HUD.el("table", "", panel);
    if (columns.length) {
      const tr = table.createTHead().insertRow();
      for (const c of columns) { const th = document.createElement("th"); th.textContent = c; tr.appendChild(th); }
    }
    const body = table.createTBody();
    for (const r of rows) {
      const tr = body.insertRow();
      for (const cell of r) tr.insertCell().textContent = cell;
    }
    const foot = PaneMux.HUD.el("div", "output-foot", panel);
    foot.textContent = "Press any key to continue";
    PaneMux.Modes.enter("normal", {
      onKey: () => { hide(); PaneMux.Modes.enter("normal"); return "handled"; },
      onExit: () => hide(),
    });
  }

  function hide() {
    if (panel) { panel.remove(); panel = null; }
  }

  return { show, hide, get visible() { return !!panel; } };
})();
