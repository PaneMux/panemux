// Link hints (f / F): label every visible clickable element, type the label
// to activate it.
PaneMux.LinkHints = (() => {
  const CLICKABLE_SELECTOR = [
    "a[href]", "area[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
    "[onclick]", "[contenteditable='']", "[contenteditable='true']",
    "[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]", "[role=tab]", "[role=menuitem]",
    "[role=option]", "[role=switch]", "[role=treeitem]", "[tabindex]:not([tabindex='-1'])",
    "label[for]", "details",
  ].join(",");
  // Extra targets when picking an element for Visual mode (not just clickables).
  const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, img, pre, blockquote, td, th, figure, table, dt, dd";

  let session = null; // { hints: [{ el, label, node }], typed, newTab, container }

  // Vimium's label algorithm: shortest prefix-free labels over hintChars.
  function labels(n, chars) {
    if (n <= 0) return [];
    const out = [""];
    let offset = 0;
    while (out.length - offset < n || out.length === 1) {
      const base = out[offset++];
      for (const ch of chars) out.push(ch + base);
    }
    return out.slice(offset, offset + n).sort().map((s) => s.split("").reverse().join(""));
  }

  // Visible, unobscured rect for `el`, or null.
  function visibleRect(el) {
    if (el.disabled) return null;
    for (const r of el.getClientRects()) {
      const left = Math.max(r.left, 0), top = Math.max(r.top, 0);
      const right = Math.min(r.right, innerWidth), bottom = Math.min(r.bottom, innerHeight);
      if (right - left < 3 || bottom - top < 3) continue;
      // Occlusion check: sample the centre and the top-left corner.
      for (const [x, y] of [[(left + right) / 2, (top + bottom) / 2], [left + 2, top + 2]]) {
        let hit = document.elementFromPoint(x, y);
        if (hit && hit.shadowRoot) hit = hit.shadowRoot.elementFromPoint(x, y) || hit;
        if (hit && (hit === el || el.contains(hit) || hit.contains(el) || (el.control && el.control === hit))) {
          return { left, top, right, bottom };
        }
      }
    }
    return null;
  }

  function isVisibleStyle(el) {
    if (typeof el.checkVisibility === "function") return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  }

  function collect(all = false) {
    const seen = new Set();
    const found = [];
    const candidates = Array.from(document.querySelectorAll(all ? `${CLICKABLE_SELECTOR},${BLOCK_SELECTOR}` : CLICKABLE_SELECTOR));
    // Elements whose computed cursor is "pointer" catch JS-only click targets.
    for (const el of document.querySelectorAll("div, span, li, img, svg, i")) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth || !r.width) continue;
      if (!el.matches(CLICKABLE_SELECTOR) && getComputedStyle(el).cursor === "pointer" &&
          !(el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer")) {
        candidates.push(el);
      }
    }
    for (const el of candidates) {
      if (seen.has(el) || PaneMux.HUD.owns(el)) continue;
      seen.add(el);
      // Skip a <details> whose <summary> will be hinted anyway.
      if (el.tagName === "DETAILS" && el.querySelector("summary")) continue;
      if (!isVisibleStyle(el)) continue;
      const rect = visibleRect(el);
      if (rect) found.push({ el, rect });
    }
    // Drop elements nested in another hinted element at the same spot
    // (e.g. <a><span role=button></span></a>) so each target has one hint.
    return found.filter(({ el, rect }) => !found.some((o) => o.el !== el && o.el.contains(el) &&
      Math.abs(o.rect.left - rect.left) < 4 && Math.abs(o.rect.top - rect.top) < 4));
  }

  // opts: { onSelect(el), onCancel(), all } — callers (Visual mode) can take
  // the chosen element instead of clicking it.
  function activate(newTab, opts = {}) {
    if (session) exit();
    const targets = collect(opts.all);
    if (!targets.length) { PaneMux.HUD.toast("No links to hint", { error: true }); return; }

    PaneMux.HUD.attach();
    const container = PaneMux.HUD.el("div", "hints" + (newTab ? " newtab" : ""));
    const chars = (PaneMux.Settings.get("hintChars") || "sadfjklewcmpgh").toLowerCase();
    const names = labels(targets.length, chars);
    const hints = targets.map(({ el, rect }, i) => {
      const node = document.createElement("div");
      node.className = "hint";
      node.style.left = `${Math.max(0, rect.left)}px`;
      node.style.top = `${Math.max(0, rect.top)}px`;
      node.dataset.label = names[i];
      container.appendChild(node);
      return { el, label: names[i], node };
    });
    session = { hints, typed: "", newTab, container, opts };
    render();
    PaneMux.Modes.enter("hints", { onKey, onExit: () => cleanup() });
  }

  function render() {
    for (const h of session.hints) {
      const match = h.label.startsWith(session.typed);
      h.node.classList.toggle("hide", !match);
      if (match) {
        h.node.innerHTML = "";
        const typed = document.createElement("span");
        typed.className = "typed";
        typed.textContent = session.typed;
        h.node.append(typed, h.label.slice(session.typed.length));
      }
    }
  }

  function onKey(key) {
    if (key === "<esc>") {
      const { onCancel } = session.opts;
      exit();
      if (onCancel) onCancel();
      return "handled";
    }
    if (key === "<bs>") {
      session.typed = session.typed.slice(0, -1);
      render();
      return "handled";
    }
    const k = key.length === 1 ? key.toLowerCase() : null;
    if (!k || !session.hints.some((h) => h.label.startsWith(session.typed + k))) {
      return "handled"; // swallow stray keys while hints are up
    }
    session.typed += k;
    const matches = session.hints.filter((h) => h.label.startsWith(session.typed));
    if (matches.length === 1 && matches[0].label === session.typed) {
      const { el } = matches[0];
      const { newTab, opts } = session;
      exit();
      PaneMux.Bus.emit("hint", { el, newTab, pick: !!opts.onSelect });
      if (opts.onSelect) opts.onSelect(el);
      else follow(el, newTab);
    } else {
      render();
    }
    return "handled";
  }

  function simulateClick(el, modifiers = {}) {
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, ...modifiers };
    el.dispatchEvent(new PointerEvent("pointerover", opts));
    el.dispatchEvent(new MouseEvent("mouseover", opts));
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    // el.click() produces a trusted-enough activation for links/buttons.
    if (modifiers.ctrlKey || modifiers.metaKey) el.dispatchEvent(new MouseEvent("click", opts));
    else el.click();
  }

  function follow(el, newTab) {
    PaneMux.Scroll.setActivated(el);
    const link = el.closest && el.closest("a[href], area[href]");
    if (newTab && link && link.href && !/^javascript:/i.test(link.href)) {
      chrome.runtime.sendMessage({ type: "tabs.open", url: link.href, background: PaneMux.Settings.get("openNewTabInBackground") });
      return;
    }
    if (PaneMux.Dom.isEditable(el)) {
      el.focus();
      if (el.select && el.tagName === "INPUT") try { el.select(); } catch (e) {}
      PaneMux.Modes.enter("insert");
      return;
    }
    if (el.tagName === "DETAILS") { el.open = !el.open; return; }
    simulateClick(el);
  }

  function cleanup() {
    if (!session) return;
    session.container.remove();
    session = null;
  }

  function exit() {
    const had = !!session;
    cleanup();
    if (had && PaneMux.Modes.current === "hints") PaneMux.Modes.exit();
  }

  return { activate, exit, labels, collect, follow, get active() { return !!session; } };
})();
