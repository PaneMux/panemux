// Element traversal for Visual mode (and Phase 5 text objects).
// Only "selectable" elements count: rendered, non-zero size, not ours.
PaneMux.DomSelector = (() => {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "HEAD", "BR", "WBR", "SOURCE", "TRACK", "PARAM"]);

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  }

  function isSelectable(el) {
    if (!el || el.nodeType !== 1 || SKIP.has(el.tagName) || PaneMux.HUD.owns(el)) return false;
    if (el === document.documentElement) return false;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  }

  const sameBox = (a, b) => Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;

  // Parent, skipping wrappers that occupy exactly the same box, so every
  // step visibly grows the selection.
  function parent(el) {
    const box = rectOf(el);
    let p = el.parentElement || (el.getRootNode() && el.getRootNode().host) || null;
    while (p && p !== document.body && (!isSelectable(p) || sameBox(rectOf(p), box))) {
      p = p.parentElement || (p.getRootNode() && p.getRootNode().host) || null;
    }
    return p && p !== document.documentElement && isSelectable(p) ? p : null;
  }

  // First selectable descendant in document order, looking through
  // display:contents / zero-size wrappers and same-box children.
  function firstChild(el) {
    const box = rectOf(el);
    const walk = (node) => {
      for (const c of node.children) {
        if (isSelectable(c) && !sameBox(rectOf(c), box)) return c;
        const deeper = walk(c);
        if (deeper) return deeper;
      }
      return null;
    };
    return walk(el);
  }

  function sibling(el, forward) {
    for (let s = forward ? el.nextElementSibling : el.previousElementSibling; s; s = forward ? s.nextElementSibling : s.previousElementSibling) {
      if (isSelectable(s)) return s;
    }
    return null;
  }

  // Element Visual mode starts on: focused element, else the last clicked /
  // hinted one if it's on screen, else whatever sits at the viewport centre.
  function initial() {
    const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
    const active = PaneMux.Dom.activeElement();
    if (active && active !== document.body && isSelectable(active) && !PaneMux.HUD.owns(active)) return active;
    const last = PaneMux.Scroll.activated;
    if (last && last.isConnected && last !== document.body && isSelectable(last) && inView(last)) return last;
    let hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    if (PaneMux.HUD.owns(hit)) hit = null;
    // Climb from inline bits (a <b> in a paragraph) to their block.
    while (hit && hit !== document.body && /^inline/.test(getComputedStyle(hit).display) && hit.parentElement) hit = hit.parentElement;
    return hit && isSelectable(hit) ? hit : document.body;
  }

  // "section#intro.card.wide"
  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    if (cls.length) s += "." + cls.join(".");
    return s;
  }

  // ---- stable element descriptors (macro replay) ------------------------
  // Hint labels change between page loads, so macros record *which element*
  // was chosen: a CSS path plus href/text fallbacks.

  const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&"));

  function cssPath(el) {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
      if (e.id && document.querySelectorAll(`#${cssEscape(e.id)}`).length === 1) { parts.unshift(`#${cssEscape(e.id)}`); break; }
      const tag = e.tagName.toLowerCase();
      const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
    }
    return parts.join(" > ");
  }

  const textOf = (el) => (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").replace(/\s+/g, " ").trim().slice(0, 80);

  function descriptor(el) {
    return { css: cssPath(el), tag: el.tagName, href: el.getAttribute && el.getAttribute("href"), text: textOf(el) };
  }

  // Best current element for a descriptor: exact CSS path (if the tag still
  // matches), then same href, then same tag + text.
  function resolve(d) {
    if (!d) return null;
    try {
      const el = document.querySelector(d.css);
      if (el && el.tagName === d.tag && (!d.href || el.getAttribute("href") === d.href)) return el;
    } catch (e) {}
    const same = [...document.getElementsByTagName(d.tag)];
    if (d.href) {
      const byHref = same.filter((e) => e.getAttribute("href") === d.href);
      if (byHref.length) return byHref.find((e) => textOf(e) === d.text) || byHref[0];
    }
    return (d.text && same.find((e) => textOf(e) === d.text)) || null;
  }

  return { cssPath, descriptor, resolve, isSelectable, parent, firstChild, sibling, next: (el) => sibling(el, true), prev: (el) => sibling(el, false), initial, describe, rectOf };
})();
