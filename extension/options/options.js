// Options page: reads/writes chrome.storage.sync; content scripts pick up
// changes live via storage.onChanged.
const { DEFAULTS } = PaneMux.Settings;

const KEYS = [
  [["f"], "Link hints — open in current tab"],
  [["F"], "Link hints — open in new tab"],
  [["j", "k", "h", "l"], "Scroll down / up / left / right"],
  [["gg", "G"], "Scroll to top / bottom"],
  [["d", "<c-d>", "<c-u>"], "Half page down / down / up"],
  [["t"], "New tab"],
  [["J", "gt"], "Next tab ({count}gt = tab N)"],
  [["K", "gT"], "Previous tab"],
  [["/"], "Find on page (Enter to confirm, Esc to cancel)"],
  [["n", "N"], "Next / previous match"],
  [["H", "L"], "Back / forward in history"],
  [["m{a-z}", "m{A-Z}"], "Set local / global mark"],
  [["`{mark}", "``"], "Jump to mark / back to previous position"],
  [["yy"], "Copy page URL"],
  [["i"], "Insert mode (pass keys to page)"],
  [["Esc"], "Leave Insert / Visual / Command mode, clear search highlight"],
  [["{count}"], "Prefix most commands with a number, e.g. 5j"],
  [[":"], "Command bar — :tabdo, :bufdo, :g/pat/act, :sp, :vsp, :reg, :macros (fuzzy-matched)"],
  [["v"], "Visual mode on the focused / last clicked element"],
  [["h", "l"], "Visual: select parent / first child"],
  [["j", "k"], "Visual: select next / previous sibling"],
  [["d", "u"], "Visual: hide element / undo"],
  [["y"], "Visual: copy element as Markdown"],
  [[">"], "Visual: open element in reading pane"],
  [["f"], "Visual: pick a new element with hints"],
  [["q{a-z}", "q"], "Record macro into register (q{A-Z} appends) / stop"],
  [["@{a-z}", "@@"], "Play macro ({count}@a repeats) / play last macro"],
  [["T"], "Tab overview: j/k move, space select, x close, Enter go"],
  [['"{a-z}y', '"{a-z}p'], "Overview: yank tabs into register / reopen a tab register (p works in Normal too)"],
  [['"{a-z}yy'], "Yank page URL into text register"],
  [["u", "<c-r>"], "Undo / redo: closed tabs, hidden elements, form edits (u = half page up if set below)"],
  [["g-", "g+"], "Step back / forward in time through every undo branch"],
  [["U"], "Toggle undo-tree side panel (click a node to jump there)"],
  [["Wh", "Wj", "Wk", "Wl"], "Focus split window left / down / up / right (Ctrl+W is reserved by Chrome)"],
  [["Ww", "Wc"], "Next split window / close this split"],
];

function renderKeys() {
  const table = document.getElementById("keys");
  for (const [keys, desc] of KEYS) {
    const tr = table.insertRow();
    const k = tr.insertCell();
    for (const key of keys) { const kbd = document.createElement("kbd"); kbd.textContent = key; k.appendChild(kbd); }
    tr.insertCell().textContent = desc;
  }
}

function flash(msg) {
  const s = document.getElementById("status");
  s.textContent = msg;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => (s.textContent = ""), 1500);
}

function readField(el, key) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number") {
    const n = parseInt(el.value, 10);
    return Number.isFinite(n) ? n : DEFAULTS[key];
  }
  return el.value;
}

function valid(key, value) {
  if (key === "hintChars") return new Set(value).size >= 2 && value.length === new Set(value).size;
  return true;
}

chrome.storage.sync.get(DEFAULTS, (values) => {
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = values[key];
    else el.value = values[key];
    el.addEventListener("change", () => {
      const value = readField(el, key);
      if (!valid(key, value)) { flash(`✗ invalid ${key}`); return; }
      chrome.storage.sync.set({ [key]: value }, () => flash("✓ saved"));
    });
  }
});

renderKeys();
