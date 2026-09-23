// Find-on-page (/, n, N). Matches are painted with the CSS Custom Highlight
// API, so the page DOM is never mutated. Smartcase: case-insensitive unless
// the query contains an uppercase letter.
PaneMux.Find = (() => {
  const HL_ALL = "pmx-find";
  const HL_CUR = "pmx-find-current";
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "TEMPLATE", "IFRAME", "OBJECT", "SVG", "HEAD"]);
  const BLOCKY = /^(block|flex|grid|list-item|table|table-cell|table-row|flow-root)/;

  let bar = null;           // { panel, input, count }
  let matches = [];          // Range[]
  let index = -1;
  let query = "";            // query the current `matches` were built from
  let lastQuery = "";        // last committed query (n/N use it)
  let saved = null;          // scroll position before "/" (restored on Esc)

  try { chrome.storage.local.get("findLastQuery", (r) => { if (r && r.findLastQuery) lastQuery = r.findLastQuery; }); } catch (e) {}

  // Visible text grouped into runs by block-level ancestor, so matches can
  // span inline markup ("foo<b>bar</b>") but not paragraphs.
  function textRuns() {
    const runs = [];
    let run = null;
    const blockOf = new Map();
    const blockAncestor = (el) => {
      for (let e = el; e; e = e.parentElement) {
        if (blockOf.has(e)) return blockOf.get(e);
        if (BLOCKY.test(getComputedStyle(e).display)) { blockOf.set(el, e); return e; }
      }
      return document.body;
    };
    const visible = new Map();
    const isVisible = (el) => {
      if (!visible.has(el)) visible.set(el, typeof el.checkVisibility === "function" ? el.checkVisibility({ checkVisibilityCSS: true }) : !!el.offsetParent);
      return visible.get(el);
    };
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || !n.nodeValue) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(p.tagName.toUpperCase()) || p.closest("panemux-hud, script, style, noscript, textarea, svg")) return NodeFilter.FILTER_REJECT;
        return isVisible(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const block = blockAncestor(n.parentElement);
      if (!run || run.block !== block) runs.push((run = { block, nodes: [], text: "" }));
      run.nodes.push({ node: n, start: run.text.length });
      run.text += n.nodeValue;
    }
    return runs;
  }

  function locate(run, offset, isEnd) {
    const { nodes } = run;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const s = nodes[i].start;
      if (offset > s || (offset === s && !isEnd) || i === 0) return { node: nodes[i].node, offset: offset - s };
    }
  }

  function search(q) {
    const found = [];
    if (!q) return found;
    const caseSensitive = /[A-Z]/.test(q);
    const needle = caseSensitive ? q : q.toLowerCase();
    for (const run of textRuns()) {
      const hay = caseSensitive ? run.text : run.text.toLowerCase();
      for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
        const a = locate(run, i, false), b = locate(run, i + needle.length, true);
        const range = document.createRange();
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
        found.push(range);
      }
    }
    return found;
  }

  const supported = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function";

  function paint() {
    if (!supported) return;
    CSS.highlights.set(HL_ALL, new Highlight(...matches));
    if (index >= 0 && matches[index]) CSS.highlights.set(HL_CUR, new Highlight(matches[index]));
    else CSS.highlights.delete(HL_CUR);
  }

  function clear() {
    matches = []; index = -1; query = "";
    if (supported) { CSS.highlights.delete(HL_ALL); CSS.highlights.delete(HL_CUR); }
  }

  function reveal(range) {
    const r = range.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
      const el = range.startContainer.parentElement;
      el && el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    }
  }

  // First match at or below the top of the viewport (Vim searches forward from the cursor).
  function firstVisibleIndex() {
    const i = matches.findIndex((m) => m.getBoundingClientRect().bottom >= 0);
    return i === -1 ? 0 : i;
  }

  function run(q) {
    clear();
    query = q;
    matches = search(q);
    index = matches.length ? firstVisibleIndex() : -1;
    paint();
    if (index >= 0) reveal(matches[index]);
    updateCount();
  }

  function updateCount() {
    if (!bar) return;
    bar.count.classList.toggle("none", !!query && !matches.length);
    bar.count.textContent = !query ? "" : matches.length ? `[${index + 1}/${matches.length}]` : "[no match]";
  }

  // ---- "/" bar ----------------------------------------------------------

  function open() {
    if (bar) { bar.input.focus(); return; }
    PaneMux.HUD.attach();
    saved = PaneMux.Scroll.position();
    const panel = PaneMux.HUD.el("div", "findbar panel");
    const prompt = PaneMux.HUD.el("span", "prompt", panel);
    prompt.textContent = "/";
    const input = PaneMux.HUD.el("input", "", panel);
    input.type = "text";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Find in page");
    const count = PaneMux.HUD.el("span", "count", panel);
    bar = { panel, input, count };
    input.addEventListener("input", () => run(input.value));
    PaneMux.Modes.enter("find", { onKey, onExit: () => closeBar() });
    input.focus();
  }

  function onKey(key) {
    if (key === "<cr>") { commit(); return "handled"; }
    if (key === "<esc>") { cancel(); return "handled"; }
    if (key === "<bs>" && bar && !bar.input.value) { cancel(); return "handled"; }
    return "input"; // let the keystroke reach our <input>, but hide it from the page
  }

  function closeBar() {
    if (!bar) return;
    const b = bar;
    bar = null;
    b.input.blur();
    b.panel.remove();
  }

  function commit() {
    const q = bar ? bar.input.value : "";
    closeBar();
    PaneMux.Modes.exit();
    if (!q) { clear(); return; }
    lastQuery = q;
    try { chrome.storage.local.set({ findLastQuery: q }); } catch (e) {}
    PaneMux.Bus.emit("find", { query: q });
    if (!matches.length) { PaneMux.HUD.toast(`Pattern not found: ${q}`, { error: true }); return; }
    selectCurrent();
    PaneMux.HUD.toast(`/${q}  [${index + 1}/${matches.length}]`);
  }

  function cancel() {
    closeBar();
    clear();
    PaneMux.Modes.exit();
    if (saved) PaneMux.Scroll.to(saved);
  }

  // Put the page selection on the current match, and focus it if it's in a link.
  function selectCurrent() {
    const range = matches[index];
    if (!range) return;
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range.cloneRange());
    const link = range.startContainer.parentElement && range.startContainer.parentElement.closest("a[href]");
    if (link) link.focus({ preventScroll: true });
  }

  // n / N
  function next(backward, count = 1) {
    const q = lastQuery;
    if (!q) { PaneMux.HUD.toast("No previous search", { error: true }); return; }
    // Rebuild if the query changed or the page mutated under the ranges.
    if (q !== query || !matches.length || matches.some((m) => !m.startContainer.isConnected)) {
      run(q);
      if (!matches.length) { PaneMux.HUD.toast(`Pattern not found: ${q}`, { error: true }); return; }
      // run() already landed on the first match ahead: n counts it as step one.
      if (!backward) count -= 1;
    }
    const n = matches.length;
    index = (((index + (backward ? -count : count)) % n) + n) % n;
    paint();
    reveal(matches[index]);
    selectCurrent();
    PaneMux.HUD.toast(`${backward ? "?" : "/"}${q}  [${index + 1}/${n}]`);
  }

  // Run a committed search without the bar (macro replay).
  function searchFor(q) {
    lastQuery = q;
    run(q);
    if (!matches.length) { PaneMux.HUD.toast(`Pattern not found: ${q}`, { error: true }); return false; }
    selectCurrent();
    return true;
  }

  return {
    open,
    next,
    searchFor,
    clear,
    search,
    get active() { return !!bar; },
    get matches() { return matches; },
    get index() { return index; },
    get hasHighlights() { return matches.length > 0; },
  };
})();
