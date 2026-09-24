// Minimap: a collapsible outline of the page's headings (gO, or :outline).
//
//   j / k        move through the outline; the page follows along
//   Enter        stay there (closes the outline unless it's pinned)
//   Esc          go back to where you were, and close
//   h / l        fold / unfold a heading's subsections (h on a leaf: go to its parent)
//   o / Space    fold or unfold
//   gg / G       first / last heading
//   p            pin: keep the outline open as you read, keys go back to the page
//   gO           focus the pinned outline again; gO once more closes it
//
// Pinned, it tracks the section you're reading and can be folded down to a
// slim tab with its header button. Click any heading to jump to it.
PaneMux.Minimap = (() => {
  const SELECTOR = "h1, h2, h3, h4, h5, h6, [role=heading]";
  const MAX_TEXT = 80;

  let panel = null, list = null, title = null;
  let items = [];        // { el, level, text, parent, kids, folded, li }
  let cursor = 0;        // index into items while the outline has the keyboard
  let focused = false;   // outline has the keyboard
  let pinned = false;
  let collapsed = false;
  let origin = null;     // scroll position to go back to on Esc
  let observer = null, spyRaf = 0, rebuildTimer = null;
  let pendingG = false;

  // ---- the outline ------------------------------------------------------------

  function levelOf(el) {
    const m = /^H([1-6])$/.exec(el.tagName);
    if (m) return +m[1];
    return Math.min(6, Math.max(1, parseInt(el.getAttribute("aria-level"), 10) || 2));
  }

  function visible(el) {
    if (PaneMux.HUD.owns(el)) return false;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function collect() {
    const folded = new Set(items.filter((i) => i.folded).map((i) => i.el));
    const out = [];
    const stack = [];
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (!visible(el)) continue;
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const level = levelOf(el);
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const item = { el, level, text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text, parent: stack[stack.length - 1] || null, kids: [], folded: folded.has(el), li: null };
      if (item.parent) item.parent.kids.push(item);
      stack.push(item);
      out.push(item);
    }
    return out;
  }

  const depth = (item) => { let d = 0; for (let p = item.parent; p; p = p.parent) d++; return d; };
  const hiddenByFold = (item) => { for (let p = item.parent; p; p = p.parent) if (p.folded) return true; return false; };
  const shown = () => items.filter((i) => !hiddenByFold(i));

  function render() {
    list.textContent = "";
    title.textContent = items.length ? `Outline · ${items.length}` : "Outline";
    if (!items.length) {
      const empty = PaneMux.HUD.el("li", "minimap-empty", list);
      empty.textContent = "No headings on this page";
      return;
    }
    items.forEach((item, i) => {
      item.li = null;
      if (hiddenByFold(item)) return;
      const li = PaneMux.HUD.el("li", "minimap-item", list);
      li.dataset.index = String(i);
      li.dataset.level = String(item.level);
      li.style.paddingLeft = `${10 + depth(item) * 12}px`;
      const twisty = PaneMux.HUD.el("span", "twisty", li);
      twisty.textContent = item.kids.length ? (item.folded ? "▸" : "▾") : "";
      twisty.addEventListener("click", (e) => { e.stopPropagation(); toggleFold(item); });
      const t = PaneMux.HUD.el("span", "text", li);
      t.textContent = item.text;
      li.title = item.text;
      li.addEventListener("click", () => { cursor = i; jump(item); if (!pinned) close(); else paint(); });
      item.li = li;
    });
    paint();
  }

  // Which heading the reader is in: the last one above the reading line.
  function currentIndex() {
    const line = innerHeight * 0.3;
    let cur = 0;
    items.forEach((item, i) => { if (item.el.getBoundingClientRect().top <= line) cur = i; });
    return cur;
  }

  function paint() {
    const cur = currentIndex();
    items.forEach((item, i) => {
      if (!item.li) return;
      item.li.classList.toggle("current", i === cur);
      item.li.classList.toggle("cursor", focused && i === cursor);
    });
    const at = items[focused ? cursor : cur];
    if (at && at.li) at.li.scrollIntoView({ block: "nearest" });
    const tab = panel.querySelector(".minimap-tab");
    if (tab) tab.textContent = items[cur] ? items[cur].text : "Outline";
  }

  // ---- moving -------------------------------------------------------------------

  // Scroll so the heading sits near the top, through PaneMux's own animator
  // (so Esc can stop it and snap back exactly). Headings inside an inner
  // scroller, on pages whose document doesn't scroll, fall back to the browser.
  const pageScroller = () => document.scrollingElement || document.documentElement;
  function scrollToHeading(el) {
    const se = pageScroller();
    if (se.scrollHeight - se.clientHeight < 2) { el.scrollIntoView({ block: "start" }); return; }
    const top = el.getBoundingClientRect().top + se.scrollTop - 12;
    PaneMux.Scroll.restore({ el: se, left: se.scrollLeft, top });
  }

  function jump(item, { flash = true } = {}) {
    scrollToHeading(item.el);
    if (flash) {
      const box = PaneMux.HUD.el("div", "tobj-flash");
      const r = item.el.getBoundingClientRect();
      Object.assign(box.style, { left: `${r.left - 4}px`, top: `${Math.max(0, r.top) - 2}px`, width: `${r.width + 8}px`, height: `${r.height + 4}px` });
      setTimeout(() => box.remove(), 500);
    }
  }

  function moveCursor(delta) {
    const vis = shown();
    if (!vis.length) return;
    let at = vis.indexOf(items[cursor]);
    at = Math.max(0, Math.min(vis.length - 1, (at === -1 ? 0 : at) + delta));
    cursor = items.indexOf(vis[at]);
    jump(items[cursor], { flash: false });
    paint();
  }

  function toggleFold(item, want) {
    if (!item.kids.length) return;
    item.folded = want === undefined ? !item.folded : want;
    if (hiddenByFold(items[cursor])) cursor = items.indexOf(item);
    render();
  }

  // ---- keyboard ---------------------------------------------------------------------

  function onKey(key) {
    const item = items[cursor];
    if (pendingG) {
      pendingG = false;
      if (key === "g") { cursor = items.indexOf(shown()[0]); if (items[cursor]) jump(items[cursor], { flash: false }); paint(); return "handled"; }
      if (key === "O") { close(); return "handled"; }
    }
    switch (key) {
      case "j": case "<down>": case "<c-n>": moveCursor(1); return "handled";
      case "k": case "<up>": case "<c-p>": moveCursor(-1); return "handled";
      case "G": { const vis = shown(); cursor = items.indexOf(vis[vis.length - 1]); if (items[cursor]) jump(items[cursor], { flash: false }); paint(); return "handled"; }
      case "g": pendingG = true; return "handled";
      case "l": case "<right>": if (item) toggleFold(item, false); return "handled";
      case "h": case "<left>":
        if (item && item.kids.length && !item.folded) toggleFold(item, true);
        else if (item && item.parent) { cursor = items.indexOf(item.parent); jump(item.parent, { flash: false }); paint(); }
        return "handled";
      case "o": case "<space>": if (item) toggleFold(item); return "handled";
      case "<cr>":
        if (item) jump(item);
        if (pinned) release(); else close();
        return "handled";
      case "p": pinned = !pinned; panel.classList.toggle("pinned", pinned); if (pinned) release(); return "handled";
      case "<esc>": case "q":
        if (origin) restore(origin);
        if (pinned) release(); else close();
        return "handled";
      default:
        return "ignored";
    }
  }

  function restore(pos) {
    PaneMux.Scroll.restore(pos);
  }

  // Give the keyboard back to the page, keep the (pinned) outline up.
  function release() {
    focused = false;
    origin = null;
    panel.classList.remove("focused");
    if (PaneMux.Modes.current === "outline") PaneMux.Modes.enter("normal");
    paint();
  }

  function focus() {
    focused = true;
    const se = pageScroller();
    origin = { el: se, left: se.scrollLeft, top: se.scrollTop };
    cursor = currentIndex();
    panel.classList.add("focused");
    PaneMux.Modes.enter("outline", { onKey, onExit: (next) => { if (focused) { focused = false; panel && panel.classList.remove("focused"); if (!pinned) teardown(); else paint(); } } });
    paint();
  }

  // ---- open / close ---------------------------------------------------------------

  function build() {
    PaneMux.HUD.attach();
    panel = PaneMux.HUD.el("div", "minimap panel");
    panel.setAttribute("role", "navigation");
    panel.setAttribute("aria-label", "Page outline");
    const head = PaneMux.HUD.el("div", "minimap-head", panel);
    title = PaneMux.HUD.el("span", "title", head);
    const btn = PaneMux.HUD.el("button", "collapse", head);
    btn.type = "button";
    btn.title = "Fold the outline away";
    btn.textContent = "‹";
    btn.addEventListener("click", () => setCollapsed(!collapsed));
    const tab = PaneMux.HUD.el("button", "minimap-tab", panel);
    tab.type = "button";
    tab.title = "Show the outline";
    tab.addEventListener("click", () => setCollapsed(false));
    list = PaneMux.HUD.el("ul", "minimap-list", panel);
    const foot = PaneMux.HUD.el("div", "minimap-foot", panel);
    foot.textContent = "j/k move · Enter go · h/l fold · p pin · Esc back";
    items = collect();
    render();
    addEventListener("scroll", onScroll, { capture: true, passive: true });
    observer = new MutationObserver((muts) => {
      if (muts.every((m) => PaneMux.HUD.owns(m.target))) return;
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => { items = collect(); cursor = Math.min(cursor, Math.max(0, items.length - 1)); render(); }, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function setCollapsed(on) {
    collapsed = on;
    panel.classList.toggle("collapsed", on);
    paint();
  }

  const onScroll = () => {
    if (spyRaf) return;
    spyRaf = requestAnimationFrame(() => { spyRaf = 0; if (panel) paint(); });
  };

  function teardown() {
    if (!panel) return;
    removeEventListener("scroll", onScroll, { capture: true });
    if (observer) observer.disconnect();
    clearTimeout(rebuildTimer);
    cancelAnimationFrame(spyRaf);
    spyRaf = 0;
    panel.remove();
    panel = list = title = observer = null;
    focused = pinned = collapsed = false;
    origin = null;
    items = [];
  }

  function close() {
    const wasFocused = focused;
    focused = false;
    teardown();
    if (wasFocused && PaneMux.Modes.current === "outline") PaneMux.Modes.enter("normal");
  }

  // gO: open and focus; on a pinned outline, focus it; when focused, close.
  function toggle() {
    if (!panel) { build(); focus(); return; }
    if (focused) { close(); return; }
    if (collapsed) setCollapsed(false);
    focus();
  }

  PaneMux.Modes.register("outline", { label: "Outline", color: "var(--mode-command)" });
  PaneMux.Keys.defineCommand("minimapToggle", () => toggle(), { desc: "Outline of the page's headings" });
  PaneMux.Keys.map("normal", "gO", "minimapToggle");

  return { toggle, close, get open() { return !!panel; }, get pinned() { return pinned; }, get items() { return items; } };
})();
