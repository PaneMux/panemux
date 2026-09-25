// Text objects: Vim's "a"/"inner" objects, aimed at the DOM instead of text.
//
//   {operator}{a|i}{object}      in Normal mode    dap  yip  cit  2yat
//   {a|i}{object}                in Visual mode    selects it (again: grows)
//
// Operators
//   d   a: hide the element(s) (soft, like Visual d)   i: clear their contents
//   y   a: copy as Markdown                            i: copy the plain text
//   c   edit in place: select the contents and type over them; Esc to finish
//
// Objects (walk up the DOM from the "cursor" to the nearest boundary)
//   p  paragraph   p li dd dt pre blockquote h1-h6 td th figcaption summary
//   s  section     section article main aside nav header footer details form dialog
//   t  tag         the element itself; a count walks up ("2yat" = its parent)
//   l  list        ul ol dl menu
//   r  row         tr, role=row
//   T  table       table, role=table/grid
//   h  heading     a heading plus everything up to the next heading of the
//                  same or higher level ("ih" leaves the heading out)
//
// The cursor is where the reader is: the find match or text selection, else
// the focused / last clicked element, else whatever is in the middle of the
// screen. Every change goes through the undo tree (u, Ctrl-r, the toast).
PaneMux.TextObjects = (() => {
  const Sel = PaneMux.DomSelector;
  const bg = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

  const BLOCK = "p, li, dd, dt, pre, blockquote, h1, h2, h3, h4, h5, h6, td, th, figcaption, summary, caption, legend";
  const SECTION = "section, article, main, aside, nav, header, footer, details, form, dialog, [role=region], [role=article], [role=main]";
  const HEADING = /^H([1-6])$/;

  const parentOf = (el) => el.parentElement || (el.getRootNode() && el.getRootNode().host) || null;

  // nth (count) enclosing element matching `selector`, starting at `el`.
  function closest(el, selector, count = 1) {
    let found = null;
    for (let n = el; n && n !== document.documentElement; n = parentOf(n)) {
      if (n.nodeType === 1 && n.matches(selector) && Sel.isSelectable(n)) {
        found = n;
        if (--count === 0) return n;
      }
    }
    return count > 0 ? null : found;
  }

  // Paragraph fallback for div soup: the nearest block that holds text itself.
  function textBlock(el) {
    for (let n = el; n && n !== document.body; n = parentOf(n)) {
      if (n.nodeType !== 1 || !Sel.isSelectable(n)) continue;
      const display = getComputedStyle(n).display;
      const ownText = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (ownText && !/^inline/.test(display)) return n;
    }
    return null;
  }

  // The heading this element sits under: itself, or the nearest heading among
  // the earlier siblings of it or one of its ancestors.
  function headingOf(el) {
    for (let n = el; n && n !== document.body; n = parentOf(n)) {
      if (n.nodeType !== 1) continue;
      if (HEADING.test(n.tagName)) return n;
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) {
        if (HEADING.test(s.tagName)) return s;
      }
    }
    return null;
  }

  function headingRange(h) {
    const level = +HEADING.exec(h.tagName)[1];
    const els = [h];
    for (let s = h.nextElementSibling; s; s = s.nextElementSibling) {
      const m = HEADING.exec(s.tagName);
      if (m && +m[1] <= level) break;
      if (Sel.isSelectable(s)) els.push(s);
    }
    return els;
  }

  // name, find(el, count) -> element | [elements] | null
  const OBJECTS = {
    p: { name: "paragraph", find: (el, n) => closest(el, BLOCK, n) || (n === 1 ? textBlock(el) : null) },
    s: { name: "section", find: (el, n) => closest(el, SECTION, n) },
    t: { name: "element", find: (el, n) => { let e = el; for (let i = 1; i < n && e; i++) e = Sel.parent(e); return e; } },
    l: { name: "list", find: (el, n) => closest(el, "ul, ol, dl, menu", n) },
    r: { name: "row", find: (el, n) => closest(el, "tr, [role=row]", n) },
    T: { name: "table", find: (el, n) => closest(el, "table, [role=table], [role=grid], [role=treegrid]", n) },
    h: { name: "heading section", find: (el) => { const h = headingOf(el); return h ? headingRange(h) : null; } },
  };

  // ---- the cursor -------------------------------------------------------------

  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && (r.width > 0 || r.height > 0);
  };
  const elementOf = (node) => (node && node.nodeType === 3 ? node.parentElement : node);

  function cursor() {
    const s = getSelection();
    if (s && s.rangeCount && s.anchorNode && !(s.isCollapsed && s.anchorNode === document.body)) {
      const el = elementOf(s.anchorNode);
      if (el && el.isConnected && !PaneMux.HUD.owns(el) && el !== document.body && inView(el)) return el;
    }
    const a = PaneMux.Dom.activeElement();
    if (a && a !== document.body && a !== document.documentElement && !PaneMux.HUD.owns(a) && inView(a)) return a;
    const act = PaneMux.Scroll.activated;
    if (act && act.nodeType === 1 && act.isConnected && act !== document.body && act !== document.documentElement && inView(act)) return act;
    return readingSpot() || document.body;
  }

  // The text nearest the reading line (40% down the screen), searching down
  // then up the middle of the viewport, so page gaps and margins don't count.
  function readingSpot() {
    const ys = [];
    for (let f = 0.4; f <= 0.9; f += 0.05) ys.push(f);
    for (let f = 0.35; f >= 0.05; f -= 0.05) ys.push(f);
    for (const f of ys) {
      for (const x of [innerWidth / 2, innerWidth / 3]) {
        const el = document.elementFromPoint(x, innerHeight * f);
        if (el && el !== document.body && el !== document.documentElement && !PaneMux.HUD.owns(el) && textBlock(el)) return el;
      }
    }
    return null;
  }

  // -> { els, inner, name } or null
  function resolve(objKey, inner, from, count = 1) {
    const obj = OBJECTS[objKey];
    const found = from && obj.find(from, count);
    if (!found) return null;
    let els = [].concat(found);
    if (inner && objKey === "h") els = els.slice(1);
    if (!els.length) return null;
    return { els, inner, name: obj.name, key: objKey };
  }

  // ---- feedback --------------------------------------------------------------

  function flash(els) {
    PaneMux.HUD.attach();
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const box = PaneMux.HUD.el("div", "tobj-flash");
      Object.assign(box.style, { left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
      setTimeout(() => box.remove(), 500);
    }
  }

  const words = (text) => (text.match(/\S+/g) || []).length;
  const plain = (el) => (el.innerText || el.textContent || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  function undoToast(message, id) {
    if (!id) { PaneMux.HUD.toast(message); return; }
    // same toast Visual-mode hides get: an Undo button plus the key
    PaneMux.Undo.toast(message, id);
  }

  // ---- operators ---------------------------------------------------------------

  async function yank(t) {
    const reg = PaneMux.Registers ? PaneMux.Registers.take() : '"';
    const text = t.inner ? t.els.map(plain).join("\n\n") : t.els.map((el) => PaneMux.Markdown.fromElement(el)).filter(Boolean).join("\n\n");
    if (!text) { PaneMux.HUD.toast(`That ${t.name} has no text`, { error: true }); return; }
    flash(t.els);
    await PaneMux.Dom.copyText(text);
    bg({ type: "reg.set", name: reg, value: text });
    const what = t.inner ? `${words(text)} word${words(text) === 1 ? "" : "s"} of ${t.name} text` : `${t.name} as Markdown`;
    PaneMux.HUD.toast(`Copied ${what}${reg === '"' ? "" : ` into "${reg}`}`);
  }

  async function remove(t) {
    if (t.els.includes(document.body)) { PaneMux.HUD.toast("Won't touch <body>", { error: true }); return; }
    const label = `${t.name} ${Sel.describe(t.els[0])}`;
    if (!t.inner) {
      // da*: soft-hide, one undo step for the whole object
      const items = t.els.map((el) => {
        const item = { desc: Sel.descriptor(el), value: el.style.getPropertyValue("display"), priority: el.style.getPropertyPriority("display") };
        PaneMux.Undo.setHidden(el, true);
        return item;
      });
      const id = await PaneMux.Undo.record("hides", `hide ${label}`, { items }, t.els);
      undoToast(`Hid ${label}`, id);
      return;
    }
    // di*: empty it out (the box stays)
    const snaps = t.els.map((el) => ({ before: PaneMux.Undo.copyChildren(el), after: [] }));
    t.els.forEach((el) => el.replaceChildren());
    const id = await PaneMux.Undo.record("html", `clear ${label}`, { items: t.els.map((el) => ({ desc: Sel.descriptor(el) })) }, t.els, snaps);
    undoToast(`Cleared ${label}`, id);
  }

  const isField = (el) => el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset|image|file|hidden|range|color)$/i.test(el.type));

  // c: make the element editable, select its contents, hand over to Insert
  // mode. Typing replaces the contents, Esc (or clicking away) finishes.
  function change(t) {
    if (t.els.length > 1) { PaneMux.HUD.toast(`Can't edit a whole ${t.name} at once — try cip or cit`, { error: true }); return; }
    const el = t.els[0];
    if (el === document.body) { PaneMux.HUD.toast("Won't edit <body>", { error: true }); return; }
    // form fields: select their text, the form-edit undo already covers them
    const field = isField(el) ? el : el.querySelector && [...el.querySelectorAll("input, textarea")].find(isField);
    if (field && (field === el || t.key === "t")) {
      field.focus();
      field.select && field.select();
      return;
    }
    const before = PaneMux.Undo.copyChildren(el);
    const beforeMarkup = el.innerHTML; // only to tell whether anything changed
    const hadAttr = el.getAttribute("contenteditable");
    el.setAttribute("contenteditable", "true");
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
    flash([el]);

    const finish = async () => {
      el.removeEventListener("focusout", finish);
      if (hadAttr === null) el.removeAttribute("contenteditable");
      else el.setAttribute("contenteditable", hadAttr);
      getSelection().removeAllRanges();
      if (el.innerHTML === beforeMarkup) return;
      const label = `${t.name} ${Sel.describe(el)}`;
      const snaps = [{ before, after: PaneMux.Undo.copyChildren(el) }];
      const id = await PaneMux.Undo.record("html", `edit ${label}`, { items: [{ desc: Sel.descriptor(el) }] }, [el], snaps);
      undoToast(`Edited ${label}`, id);
    };
    el.addEventListener("focusout", finish);
  }

  const OPS = { d: remove, y: yank, c: change };

  function operate(op, kind, objKey, count) {
    const t = resolve(objKey, kind === "i", cursor(), count);
    if (!t) { PaneMux.HUD.toast(`No ${OBJECTS[objKey].name} here`, { error: true, duration: 1200 }); return; }
    return OPS[op](t);
  }

  // Visual: select the object around the selection; asking again for the same
  // object grows it outward. "i" of an element means its first child.
  function visualSelect(kind, objKey, count) {
    const cur = PaneMux.VisualMode.selection;
    if (!cur) return;
    if (objKey === "t" && kind === "i") {
      const child = Sel.firstChild(cur);
      if (child) PaneMux.VisualMode.select(child);
      else PaneMux.HUD.toast("No child", { error: true, duration: 900 });
      return;
    }
    const pick = (t) => {
      if (!t) return null;
      if (t.els.length === 1) return t.els[0];
      // a heading range: its wrapper if it has one of its own, else the heading
      const p = t.els[0].parentElement;
      return p && p !== document.body && [...p.children].every((c) => t.els.includes(c) || !Sel.isSelectable(c)) ? p : t.els[0];
    };
    let el = pick(resolve(objKey, kind === "i", cur, count));
    if (el === cur) el = pick(resolve(objKey, kind === "i", Sel.parent(cur), count)); // already selected: grow
    if (!el || el === cur) { PaneMux.HUD.toast(`No ${OBJECTS[objKey].name} around this`, { error: true, duration: 1200 }); return; }
    PaneMux.VisualMode.select(el);
  }

  // Visual c: edit the selection in place.
  function visualChange() {
    const el = PaneMux.VisualMode.selection;
    if (!el) return;
    PaneMux.VisualMode.exit();
    change({ els: [el], inner: true, name: "element", key: "t" });
  }

  // ---- commands + bindings -------------------------------------------------------
  // One command per key sequence ("tobj_yap"), so macros replay them by name.
  const { defineCommand: def, map } = PaneMux.Keys;
  const VERB = { d: "Hide", y: "Copy", c: "Edit" };
  for (const op of Object.keys(OPS)) {
    for (const kind of ["a", "i"]) {
      for (const [objKey, obj] of Object.entries(OBJECTS)) {
        const name = `tobj_${op}${kind}${objKey}`;
        def(name, ({ count }) => operate(op, kind, objKey, count), { desc: `${VERB[op]} ${kind === "a" ? "a" : "inner"} ${obj.name}` });
        map("normal", `${op}${kind}${objKey}`, name);
      }
    }
  }
  for (const kind of ["a", "i"]) {
    for (const [objKey, obj] of Object.entries(OBJECTS)) {
      const name = `tobjSelect_${kind}${objKey}`;
      def(name, ({ count }) => visualSelect(kind, objKey, count), { desc: `Select ${kind === "a" ? "a" : "inner"} ${obj.name}` });
      map("visual", `${kind}${objKey}`, name);
    }
  }
  def("visualChange", () => visualChange(), { desc: "Edit the selection in place" });
  map("visual", "c", "visualChange");

  return { OBJECTS, resolve, cursor, operate };
})();
