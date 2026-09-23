// Tab overview (T): list this window's tabs, pick some, yank them into a tab
// register or reopen one.
//
//   j/k ↓/↑  move      gg/G  first/last     <space>  toggle select
//   <cr>     go to tab x     close tab(s)   "{a-z}y  yank selected (or cursor) tabs
//   "{a-z}p  reopen register as new tabs      Esc / T  close overview
// Outside the overview, "{a-z}p also works in Normal mode, and "{a-z}yy
// yanks the page URL into text register {a-z}.
PaneMux.Registers = (() => {
  // Register named with "x, consumed by the next command. Cleared after any
  // other command so a stray "a doesn't leak into a later yank.
  let pending = null;
  PaneMux.Keys.onDispatch((ctx) => {
    if (ctx.binding.command === "selectRegister") return;
    const had = pending;
    setTimeout(() => { if (pending === had) pending = null; }, 0);
  });
  PaneMux.Keys.defineCommand("selectRegister", ({ char }) => {
    if (!/^[a-z"]$/.test(char || "")) { PaneMux.HUD.toast(`Invalid register "${char}"`, { error: true }); return; }
    pending = char;
  }, { desc: '"{a-z}: use register for the next yank/put' });
  return {
    take(dflt = '"') { const r = pending || dflt; pending = null; return r; },
    get pending() { return pending; },
  };
})();

PaneMux.TabOverview = (() => {
  const bg = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
  let ui = null; // { panel, list, foot, tabs, cursor, selected:Set }

  async function open() {
    if (ui) return;
    const res = await bg({ type: "tabs.list" });
    if (!res || !res.tabs) return;
    PaneMux.HUD.attach();
    const panel = PaneMux.HUD.el("div", "tabov panel");
    const head = PaneMux.HUD.el("div", "tabov-head", panel);
    head.textContent = `tabs · ${res.tabs.length}`;
    const list = PaneMux.HUD.el("ol", "tabov-list", panel);
    const foot = PaneMux.HUD.el("div", "tabov-foot", panel);
    const cursor = Math.max(0, res.tabs.findIndex((t) => t.active));
    ui = { panel, list, foot, tabs: res.tabs, cursor, selected: new Set() };
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li");
      if (!li) return;
      e.preventDefault();
      ui.cursor = +li.dataset.i;
      activate();
    });
    render();
    PaneMux.Modes.enter("tabs", { onExit: () => teardown() });
  }

  function render() {
    const { list, tabs, cursor, selected } = ui;
    list.textContent = "";
    tabs.forEach((t, i) => {
      const li = document.createElement("li");
      li.dataset.i = i;
      li.dataset.id = t.id;
      li.className = [i === cursor ? "cursor" : "", selected.has(t.id) ? "selected" : ""].join(" ").trim();
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = selected.has(t.id) ? "●" : t.active ? "%" : " ";
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(i + 1).padStart(2, " ");
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = (t.pinned ? "📌 " : "") + (t.title || t.url);
      const host = document.createElement("span");
      host.className = "host";
      try { host.textContent = new URL(t.url).host || t.url; } catch (e) { host.textContent = t.url; }
      li.append(mark, num, title, host);
      list.appendChild(li);
    });
    const cur = list.children[cursor];
    if (cur) cur.scrollIntoView({ block: "nearest" });
    const reg = PaneMux.Registers.pending;
    ui.foot.textContent = `${selected.size ? `${selected.size} selected · ` : ""}${reg ? `"${reg} · ` : ""}j/k move · space select · "ay yank · "ap put · x close · ⏎ go · Esc`;
  }

  function teardown() {
    if (!ui) return;
    ui.panel.remove();
    ui = null;
  }

  function close() {
    teardown();
    if (PaneMux.Modes.current === "tabs") PaneMux.Modes.exit();
  }

  const targets = () => (ui.selected.size ? ui.tabs.filter((t) => ui.selected.has(t.id)) : [ui.tabs[ui.cursor]]).filter(Boolean);

  function move(delta) {
    ui.cursor = Math.max(0, Math.min(ui.tabs.length - 1, ui.cursor + delta));
    render();
  }

  function toggle(count) {
    for (let i = 0; i < count && ui.cursor < ui.tabs.length; i++) {
      const id = ui.tabs[ui.cursor].id;
      if (ui.selected.has(id)) ui.selected.delete(id); else ui.selected.add(id);
      if (ui.cursor < ui.tabs.length - 1) ui.cursor++;
    }
    render();
  }

  async function activate() {
    const t = ui.tabs[ui.cursor];
    close();
    if (t) await bg({ type: "tabs.activate", tabId: t.id });
  }

  async function closeTabs() {
    const ts = targets();
    const self = ts.find((t) => t.active);
    let res = await bg({ type: "tabs.close", tabIds: ts.map((t) => t.id) });
    if (res && res.confirm) {
      close(); // the preview takes the keyboard
      await PaneMux.CommandPalette.confirmClose(res.confirm);
      return;
    }
    if (self) return; // this page is gone
    const list = await bg({ type: "tabs.list" });
    if (!ui || !list) return;
    ui.tabs = list.tabs;
    ui.selected.clear();
    ui.cursor = Math.min(ui.cursor, ui.tabs.length - 1);
    render();
  }

  async function yank() {
    const name = PaneMux.Registers.take();
    const ts = targets();
    const r = await bg({ type: "treg.yank", name, tabIds: ts.map((t) => t.id) });
    close();
    if (r && r.ok) PaneMux.HUD.toast(`Yanked ${r.n} tab${r.n === 1 ? "" : "s"} into "${name}${r.localOnly ? " (too big to sync — this device only)" : ""}`);
    else PaneMux.HUD.toast((r && r.error) || "Yank failed", { error: true });
  }

  async function put() {
    const name = PaneMux.Registers.take();
    if (ui) close();
    const r = await bg({ type: "treg.put", name });
    if (r && r.ok) PaneMux.HUD.toast(`Opened ${r.n} tab${r.n === 1 ? "" : "s"} from "${name}`);
    else PaneMux.HUD.toast((r && r.error) || "Put failed", { error: true });
  }

  const { defineCommand: def, map } = PaneMux.Keys;
  const need = (fn) => (ctx) => ui && fn(ctx);
  def("tabOverview", () => open(), { desc: "Tab overview" });
  def("tabsClose",   () => close(), { desc: "Close tab overview" });
  def("tabsDown",    need(({ count }) => move(count)), { desc: "Next tab in list" });
  def("tabsUp",      need(({ count }) => move(-count)), { desc: "Previous tab in list" });
  def("tabsFirst",   need(() => move(-Infinity)), { desc: "First tab in list" });
  def("tabsLast",    need(() => move(Infinity)), { desc: "Last tab in list" });
  def("tabsToggle",  need(({ count }) => toggle(count)), { desc: "Toggle selection" });
  def("tabsGo",      need(() => activate()), { desc: "Go to tab" });
  def("tabsRemove",  need(() => closeTabs()), { desc: "Close selected tab(s)" });
  def("tabsYank",    need(() => yank()), { desc: "Yank tabs into register" });
  def("putTabs",     () => put(), { desc: '"{a-z}p: reopen tab register' });

  map("normal", "T", "tabOverview");
  map("normal", '"', "selectRegister", { arg: "char" });
  map("normal", "p", "putTabs");
  const M = "tabs";
  map(M, "<esc>", "tabsClose");
  map(M, "T", "tabsClose");
  map(M, "j", "tabsDown");  map(M, "<down>", "tabsDown");
  map(M, "k", "tabsUp");    map(M, "<up>", "tabsUp");
  map(M, "gg", "tabsFirst");
  map(M, "G", "tabsLast");
  map(M, "<space>", "tabsToggle");
  map(M, "v", "tabsToggle");
  map(M, "<cr>", "tabsGo");
  map(M, "x", "tabsRemove");
  map(M, '"', "selectRegister", { arg: "char" });
  map(M, "y", "tabsYank");
  map(M, "p", "putTabs");

  return { open, close, get active() { return !!ui; } };
})();
