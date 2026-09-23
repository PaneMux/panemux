// Undo-tree side panel (U): the whole branching history as a small graph,
// newest at the top. Click a node to jump to that state. The header's
// chevron collapses it to a slim strip. Open/collapsed state persists.
PaneMux.UndoPanel = (() => {
  const ROW = 22, COL = 14, PAD = 10, R = 4.5;
  const KIND_COLOR = { root: "#39ff14", close: "#ff3b5c", hide: "#ff2eb0", edit: "#ff9500" };
  const bg = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
  const svgNS = "http://www.w3.org/2000/svg";
  let panel = null, body = null;
  let state = { open: false, collapsed: false };

  const saveState = () => { try { chrome.storage.local.set({ undoPanel: state }); } catch (e) {} };

  function build() {
    PaneMux.HUD.attach();
    panel = PaneMux.HUD.el("div", "undopanel panel");
    const head = PaneMux.HUD.el("div", "undopanel-head", panel);
    const title = PaneMux.HUD.el("span", "title", head);
    title.textContent = "undo tree";
    const btn = PaneMux.HUD.el("button", "collapse", head);
    btn.type = "button";
    btn.title = "Collapse / expand";
    btn.addEventListener("click", () => { state.collapsed = !state.collapsed; saveState(); layout(); });
    head.addEventListener("dblclick", () => { state.collapsed = !state.collapsed; saveState(); layout(); });
    body = PaneMux.HUD.el("div", "undopanel-body", panel);
    layout();
  }

  function layout() {
    if (!panel) return;
    panel.classList.toggle("collapsed", state.collapsed);
    panel.querySelector(".collapse").textContent = state.collapsed ? "‹" : "›";
  }

  // Column per branch: the first child continues its parent's column.
  function place(nodes) {
    const byId = new Map(nodes.map((n) => [n.id, { ...n, kids: [] }]));
    for (const n of byId.values()) if (n.parent !== null && byId.has(n.parent)) byId.get(n.parent).kids.push(n);
    let next = 1;
    const walk = (n, col) => {
      n.col = col;
      n.kids.sort((a, b) => a.id - b.id).forEach((k, i) => walk(k, i === 0 ? col : next++));
    };
    const root = byId.get(0);
    if (root) walk(root, 0);
    return { byId, cols: next };
  }

  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
  };

  async function render() {
    if (!panel) return;
    const v = await bg({ type: "undo.view" });
    if (!v || !panel) return;
    const { byId, cols } = place(v.nodes);
    const rows = [...byId.values()].sort((a, b) => b.id - a.id); // newest first
    const rowOf = new Map(rows.map((n, i) => [n.id, i]));
    const x = (col) => PAD + col * COL;
    const y = (id) => rowOf.get(id) * ROW + ROW / 2;
    const width = PAD * 2 + Math.max(1, cols) * COL;

    body.textContent = "";
    const wrap = document.createElement("div");
    wrap.className = "graph";
    wrap.style.height = `${rows.length * ROW}px`;
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", rows.length * ROW);
    for (const n of rows) {
      if (n.parent === null || !byId.has(n.parent)) continue;
      const p = byId.get(n.parent);
      const path = document.createElementNS(svgNS, "path");
      // Straight up within a branch, elbow when branching off.
      path.setAttribute("d", `M${x(n.col)},${y(n.id)} L${x(n.col)},${y(p.id) - (n.col === p.col ? 0 : ROW / 2)} L${x(p.col)},${y(p.id)}`);
      path.setAttribute("class", "edge");
      svg.appendChild(path);
    }
    for (const n of rows) {
      const c = document.createElementNS(svgNS, "circle");
      c.setAttribute("cx", x(n.col));
      c.setAttribute("cy", y(n.id));
      c.setAttribute("r", n.id === v.cur ? R + 1.5 : R);
      c.setAttribute("fill", KIND_COLOR[n.kind] || "#aaa");
      c.setAttribute("class", n.id === v.cur ? "node cur" : "node");
      svg.appendChild(c);
    }
    wrap.appendChild(svg);

    const list = document.createElement("ol");
    list.className = "rows";
    list.style.left = `${width}px`;
    for (const n of rows) {
      const li = document.createElement("li");
      li.dataset.id = n.id;
      li.className = n.id === v.cur ? "cur" : "";
      li.title = `Go to state #${n.id}`;
      const id = document.createElement("span");
      id.className = "id";
      id.textContent = `#${n.id}`;
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = n.label;
      const t = document.createElement("span");
      t.className = "ago";
      t.textContent = n.id ? ago(n.time) : "";
      li.append(id, label, t);
      li.addEventListener("click", async () => {
        const r = await bg({ type: "undo.goto", id: n.id });
        if (r && r.message) PaneMux.HUD.toast(r.message, { error: !!r.error });
      });
      list.appendChild(li);
    }
    wrap.appendChild(list);
    body.appendChild(wrap);
    panel.dataset.cur = v.cur;
    panel.dataset.count = rows.length;
  }

  function show() {
    if (!panel) build();
    state.open = true;
    saveState();
    render();
  }

  function hide() {
    if (panel) { panel.remove(); panel = null; }
    state.open = false;
    saveState();
  }

  const toggle = () => (panel ? hide() : show());

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "undo.changed" && panel) render();
  });

  try {
    chrome.storage.local.get("undoPanel", (r) => {
      if (r && r.undoPanel) state = { ...state, ...r.undoPanel };
      if (state.open && !PaneMux.registryOnly) show();
    });
  } catch (e) {}

  PaneMux.Keys.defineCommand("undoPanel", () => toggle(), { desc: "Toggle the undo-tree panel" });
  PaneMux.Keys.map("normal", "U", "undoPanel");
  PaneMux.Keys.map("visual", "U", "undoPanel");

  return { show, hide, toggle, render, get open() { return !!panel; } };
})();
