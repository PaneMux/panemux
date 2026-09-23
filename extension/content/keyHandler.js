// PaneMux key-handling engine: one finite-state machine for every mode.
//
// Grammar (same shape as Vim's):
//
//     [count] [operator [count]] (motion | text-object | action) [char-arg]
//
// States:
//   IDLE       nothing pending
//   COUNT      accumulating digits ("12")
//   SEQUENCE   walked part-way down the bindings trie ("g" of "gg")
//   CHAR_ARG   binding needs one literal char next ("m" + "a")
//   OPERATOR   operator typed, waiting for its motion / text object ("d" of "dap")
//
// Bindings live in one trie per mode. A trie node can be both a complete
// binding and a prefix of a longer one (e.g. later phases add "dap" while "d"
// already scrolls); the FSM then waits `ambiguousTimeout` ms before firing the
// shorter one, like Vim's 'timeoutlen'.
//
// Extension points for later phases:
//   Keys.defineCommand(name, fn, opts)   action/motion implementation
//   Keys.map(modes, keys, command, opts) bind key sequence -> command
//   Keys.defineOperator(name, fn)        operator; map it with { operator: true }
//   Keys.map(..., { motion: true })      usable as operator target
//   Keys.map(..., { arg: "char" })       takes a literal next char (marks, registers)
//   Keys.map(..., { argUnless: fn })     ...unless fn() is true, then fires at once
//   Keys.map(..., { passKey: true })     run the command but still deliver the key to the page
//   Keys.onPending(fn)                   HUD display of pending keys
//   Keys.onDispatch(fn)                  observe every dispatched command (macros, vimgolf)
//   Keys.setFilter(fn)                   hide bindings (feature presets); hidden keys reach the page
PaneMux.Keys = (() => {
  const S = { IDLE: "IDLE", COUNT: "COUNT", SEQUENCE: "SEQUENCE", CHAR_ARG: "CHAR_ARG", OPERATOR: "OPERATOR" };

  const tries = {};        // mode -> trie root
  const commands = {};     // name -> { fn, desc }
  const operators = {};    // name -> { fn, desc }
  const pendingListeners = [];
  const dispatchListeners = [];

  let state = S.IDLE;
  let count = "";          // count typed before the command / operator
  let keys = [];           // keys typed in the current sequence
  let node = null;         // current trie node while in SEQUENCE
  let charBinding = null;  // binding waiting for a char arg
  let op = null;           // { binding, count } while in OPERATOR state
  let opCount = "";        // count typed after an operator ("d3j")
  let ambiguityTimer = null;
  let opPrevMode = null;
  let filter = () => true; // binding -> usable? (feature presets)

  const newNode = () => ({ children: Object.create(null), binding: null });

  // ---- key parsing -------------------------------------------------------

  const NAMED = {
    Escape: "esc", Enter: "cr", Backspace: "bs", Tab: "tab", Delete: "del", " ": "space",
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
    PageUp: "pageup", PageDown: "pagedown", Home: "home", End: "end", Insert: "insert",
  };
  const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "OS", "AltGraph", "Fn", "NumLock", "ScrollLock"]);

  // KeyboardEvent -> canonical key token ("j", "J", "<c-w>", "<esc>") or null.
  function normalize(event) {
    let k = event.key;
    if (!k || MODIFIER_KEYS.has(k) || k === "Unidentified" || k === "Dead" || k === "Process") return null;
    let named = NAMED[k] || (/^F\d{1,2}$/.test(k) ? k.toLowerCase() : null);
    if (!named && k.length !== 1) return null;
    const mods = [];
    if (event.ctrlKey) mods.push("c");
    if (event.altKey) mods.push("a");
    if (event.metaKey) mods.push("m");
    // Printable chars already encode shift in their case ("J"), named keys don't.
    if (named && event.shiftKey && k !== " ") mods.push("s");
    if (mods.length === 1 && mods[0] === "c" && k === "[") return "<esc>";
    const base = named || k;
    if (!mods.length) return named ? `<${named}>` : k;
    return `<${mods.join("-")}-${base}>`;
  }

  // "gg" -> ["g","g"], "<c-w>h" -> ["<c-w>","h"]. Modifiers are lowercased;
  // a single-char key keeps its case ("<c-W>" is ctrl+shift+w).
  function parseKeys(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      const end = str[i] === "<" ? str.indexOf(">", i) : -1;
      if (end > i + 1) {
        const parts = str.slice(i + 1, end).split("-");
        let base = parts.pop() || "-";
        if (base.length > 1) base = base.toLowerCase();
        const mods = parts.map((m) => m.toLowerCase());
        out.push(`<${[...mods, base].join("-")}>`);
        i = end;
      } else {
        out.push(str[i]);
      }
    }
    return out;
  }

  // ---- registration ------------------------------------------------------

  function defineCommand(name, fn, opts = {}) { commands[name] = { fn, ...opts }; }
  function defineOperator(name, fn, opts = {}) { operators[name] = { fn, ...opts }; }

  // opts: { arg: "char", motion: bool, operator: bool, desc }
  function map(modes, keyStr, command, opts = {}) {
    for (const mode of [].concat(modes)) {
      let n = (tries[mode] = tries[mode] || newNode());
      for (const k of parseKeys(keyStr)) n = n.children[k] = n.children[k] || newNode();
      n.binding = { command, keys: keyStr, mode, ...opts };
    }
  }

  function unmap(modes, keyStr) {
    for (const mode of [].concat(modes)) {
      let n = tries[mode];
      for (const k of parseKeys(keyStr)) n = n && n.children[k];
      if (n) n.binding = null;
    }
  }

  function bindings(mode) {
    const out = [];
    (function walk(n) {
      if (!n) return;
      if (n.binding) out.push(n.binding);
      for (const k in n.children) walk(n.children[k]);
    })(tries[mode]);
    return out;
  }

  // ---- FSM ----------------------------------------------------------------

  function pendingString() {
    return count + (op ? op.binding.keys : "") + opCount + keys.join("");
  }

  function emitPending() {
    const p = pendingString();
    pendingListeners.forEach((fn) => fn(p, state));
  }

  function clearTimer() {
    if (ambiguityTimer) { clearTimeout(ambiguityTimer); ambiguityTimer = null; }
  }

  function reset() {
    clearTimer();
    const wasOperator = !!op;
    state = S.IDLE; count = ""; keys = []; node = null; charBinding = null; op = null; opCount = "";
    if (wasOperator && PaneMux.Modes.current === "operator") PaneMux.Modes.enter(opPrevMode || "normal");
    opPrevMode = null;
    emitPending();
  }

  function lookupRoot(mode) {
    return tries[mode] || null;
  }

  // A node is usable if it or anything below it has a binding the filter allows.
  const usableBinding = (n) => (n && n.binding && filter(n.binding) ? n.binding : null);
  const usable = (n) => !!n && (!!usableBinding(n) || Object.values(n.children).some(usable));

  // After an operator, keys resolve through the "operator" trie (text
  // objects) first, then the motions of the mode the operator was typed in.
  function operatorRootChild(k) {
    const own = lookupRoot("operator");
    const fallback = lookupRoot(opPrevMode || "normal");
    return (own && own.children[k]) || (fallback && fallback.children[k]) || null;
  }

  function run(binding, char, event) {
    const n1 = count ? parseInt(count, 10) : null;
    const ctx = { count: n1 || 1, hasCount: n1 !== null, char, keys: binding.keys, binding, event, mode: PaneMux.Modes.current };

    if (op) {
      // Operator + motion/text object: counts multiply ("2d3j" = 6).
      const n2 = opCount ? parseInt(opCount, 10) : null;
      const total = (n1 || 1) * (n2 || 1);
      const opInfo = operators[op.binding.command];
      const doubled = binding === op.binding; // "dd", "yy", ...
      const opCtx = { ...ctx, count: total, hasCount: n1 !== null || n2 !== null, operator: op.binding.command, motion: doubled ? "line" : binding.command, motionBinding: binding };
      reset();
      if (!opInfo) return;
      if (!doubled && !binding.motion) return; // not a valid operator target
      invoke(opInfo.fn, opCtx);
      return;
    }

    reset();
    const cmd = commands[binding.command];
    if (!cmd) { console.warn(`PaneMux: no command "${binding.command}"`); return; }
    invoke(cmd.fn, ctx);
  }

  function invoke(fn, ctx) {
    dispatchListeners.forEach((l) => { try { l(ctx); } catch (e) {} });
    try {
      const r = fn(ctx);
      if (r && typeof r.catch === "function") r.catch((e) => console.error("PaneMux:", e));
    } catch (e) {
      console.error("PaneMux:", e);
    }
  }

  function accept(binding, event) {
    // argUnless(): skip the char arg right now (e.g. "q" stops a recording).
    if (binding.arg === "char" && !(binding.argUnless && binding.argUnless())) {
      state = S.CHAR_ARG; charBinding = binding; node = null;
      emitPending();
      return;
    }
    if (binding.operator && !op) {
      op = { binding, count };
      state = S.OPERATOR; keys = []; node = null;
      opPrevMode = PaneMux.Modes.current;
      PaneMux.Modes.enter("operator");
      emitPending();
      return;
    }
    run(binding, undefined, event);
  }

  // Feed one normalized key. Returns true if consumed (caller should
  // preventDefault), false to let the page have it.
  function feed(k, event) {
    clearTimer();

    if (state === S.CHAR_ARG) {
      if (k.length === 1) { const b = charBinding; keys.push(k); run(b, k, event); }
      else reset();
      return true;
    }

    if (k === "<esc>" && state !== S.IDLE) { reset(); return true; }

    // Counts: digits at the root of a sequence. A leading "0" is a key, not a count.
    const modeInfo = PaneMux.Modes.info();
    if (!(modeInfo && modeInfo.passThrough) && keys.length === 0 && /^[0-9]$/.test(k) && (k !== "0" || (op ? opCount : count))) {
      if (op) opCount += k; else count += k;
      if (state === S.IDLE) state = S.COUNT;
      emitPending();
      return true;
    }

    let next = op
      ? (node ? node.children[k] : operatorRootChild(k))
      : (node || lookupRoot(PaneMux.Modes.current) || newNode()).children[k];
    if (!usable(next)) next = null;

    if (!next) {
      const hadPending = state !== S.IDLE;
      const wasMidSequence = keys.length > 0;
      reset();
      // A failed sequence ("gx") retries the last key from the root, so "gj"
      // still scrolls when "gj" isn't bound.
      if (wasMidSequence) return feed(k, event) || true;
      return hadPending;
    }

    keys.push(k);
    const binding = usableBinding(next);
    const hasChildren = Object.values(next.children).some(usable);

    if (binding && !hasChildren) {
      accept(binding, event);
      return !binding.passKey; // passKey: run the command but let the page see the key too
    }

    node = next;
    if (state !== S.OPERATOR) state = S.SEQUENCE;
    emitPending();

    if (binding) {
      const timeout = (PaneMux.Settings && PaneMux.Settings.get("ambiguousTimeout")) || 1000;
      ambiguityTimer = setTimeout(() => { ambiguityTimer = null; accept(binding); }, timeout);
    }
    return true;
  }

  return {
    STATES: S,
    normalize,
    parseKeys,
    map,
    unmap,
    bindings,
    defineCommand,
    defineOperator,
    feed,
    reset,
    setFilter: (fn) => { filter = fn; },
    get state() { return state; },
    get pending() { return pendingString(); },
    commands,
    onPending: (fn) => pendingListeners.push(fn),
    onDispatch: (fn) => dispatchListeners.push(fn),
  };
})();
