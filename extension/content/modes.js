// Mode state: Normal / Insert / Visual / Command / Operator-pending, plus the
// transient overlay modes used by Phase 1 (hints, find).
//
// A mode is just a name + display info + an optional `onKey` handler. When a
// mode has an `onKey` handler it receives keys *before* the FSM binding lookup
// (hint typing, the find input, ...). Modes without a handler resolve keys
// through the bindings trie registered for that mode in keyHandler.js.
PaneMux.Modes = (() => {
  const registry = {};
  const listeners = [];
  let current = "normal";
  let handler = null;

  function register(name, info) {
    registry[name] = { name, label: name, color: "var(--mode-normal)", ...info };
  }

  // Accents come from the design system tokens (ui/tokens.css).
  register("normal",   { label: "Normal",  color: "var(--mode-normal)" });
  register("insert",   { label: "Insert",  color: "var(--mode-insert)", passThrough: true });
  register("visual",   { label: "Visual",  color: "var(--mode-visual)" });
  register("command",  { label: "Command", color: "var(--mode-command)" });
  register("operator", { label: "Operator", color: "var(--mode-operator)" });
  register("hints",    { label: "Hints",   color: "var(--mode-normal)" });
  register("find",     { label: "Find",    color: "var(--mode-command)" });
  register("tabs",     { label: "Tabs",    color: "var(--mode-command)" });

  // Enter `name`. `modeHandler` (optional) = { onKey(key, event) -> "handled" | "pass" | undefined, onExit() }
  function enter(name, modeHandler = null) {
    if (!registry[name]) throw new Error(`PaneMux: unknown mode "${name}"`);
    const prev = current;
    const prevHandler = handler;
    current = name;
    handler = modeHandler;
    if (prevHandler && prevHandler !== modeHandler && prevHandler.onExit) prevHandler.onExit(name);
    if (prev !== name) listeners.forEach((fn) => fn(name, prev));
  }

  // Leave the current mode and fall back to whatever the page state implies.
  function exit() {
    enter(PaneMux.Dom && PaneMux.Dom.isEditable(document.activeElement) ? "insert" : "normal");
  }

  return {
    register,
    enter,
    exit,
    get current() { return current; },
    get handler() { return handler; },
    info: (name = current) => registry[name],
    onChange: (fn) => listeners.push(fn),
  };
})();

// Small DOM helpers shared across modules.
PaneMux.Dom = {
  isEditable(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.isContentEditable) return true;
    // ARIA text widgets built from divs (rich editors, custom search boxes)
    const role = el.getAttribute && el.getAttribute("role");
    if ((role === "textbox" || role === "searchbox") && el.getAttribute("aria-readonly") !== "true") return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") {
      const nonText = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "reset", "submit", "range"];
      return !nonText.includes((el.type || "text").toLowerCase());
    }
    return false;
  },
  // Clipboard write with a fallback for pages that block the async API.
  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
      document.documentElement.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  },
  // Deepest active element, looking through open shadow roots.
  activeElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  },
};

// Tiny event bus for user-level actions other modules observe (macro
// recorder now, undo tree / vimgolf later). Events:
//   "hint"  { el, newTab, pick }   element chosen through link hints
//   "visual" { el }                Visual mode entered on el
//   "find"  { query }              committed "/" search
//   "ex"    { text }               submitted ":" command
PaneMux.Bus = (() => {
  const subs = {};
  return {
    on(name, fn) { (subs[name] = subs[name] || []).push(fn); },
    emit(name, data) { (subs[name] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error("PaneMux:", e); } }); },
  };
})();
