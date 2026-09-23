// Settings page (panemux-ux-guidelines.md §7): presets first, then a search
// box over every key and setting, keys editable one by one with the default
// shown and a reset link. Everything saves to chrome.storage.sync right away
// and open tabs pick it up live.
const { DEFAULTS } = PaneMux.Settings;
const { Features, Keymap, Help } = PaneMux;
const $ = (id) => document.getElementById(id);

let values = { ...DEFAULTS };

function flash(msg, bad = false) {
  const s = $("status");
  s.textContent = msg;
  s.classList.toggle("bad", bad);
  s.classList.add("show");
  clearTimeout(flash.t);
  flash.t = setTimeout(() => s.classList.remove("show"), 1500);
}

function save(patch, msg = "Saved") {
  values = { ...values, ...patch };
  return chrome.storage.sync.set(patch).then(() => { flash(msg); render(); });
}

// ---- presets -------------------------------------------------------------

function featuresNow() {
  if (values.preset === "classic" || values.preset === "power") return Features.PRESETS[values.preset];
  return { ...Features.PRESETS.classic, ...values.features };
}

function renderPresets() {
  document.querySelectorAll(".preset").forEach((b) => {
    const on = b.dataset.preset === values.preset;
    b.classList.toggle("selected", on);
    b.setAttribute("aria-pressed", on);
  });
  const box = $("features");
  box.hidden = values.preset !== "custom";
  if (box.hidden) return;
  box.textContent = "";
  const now = featuresNow();
  for (const f of Features.LIST) {
    const label = document.createElement("label");
    label.dataset.search = `${f.label} ${f.desc}`.toLowerCase();
    const text = document.createElement("span");
    text.innerHTML = `${f.label}<small></small>`;
    text.querySelector("small").textContent = f.desc;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = `feature-${f.id}`;
    cb.checked = !!now[f.id];
    cb.addEventListener("change", () => save({ features: { ...featuresNow(), [f.id]: cb.checked } }));
    label.append(text, cb);
    box.appendChild(label);
  }
}

document.querySelectorAll(".preset").forEach((b) => b.addEventListener("click", () => {
  const preset = b.dataset.preset;
  // Custom starts from whatever is on right now.
  const patch = preset === "custom" && values.preset !== "custom" ? { preset, features: { ...featuresNow() } } : { preset };
  save(patch, `${b.querySelector(".name").textContent} preset on`);
}));

// ---- keys ------------------------------------------------------------------

const commandFeature = (command) => Features.forCommand(command);

// u's meaning depends on the preset (undo in Power User, Vimium's half page
// up in Classic), so describe it by what it does right now.
const commandOf = (b) => (b.keys === "u" ? (featuresNow().undo && values.uKey !== "scroll" ? "undo" : "scrollHalfUp") : b.command);
const ORDER = Object.keys(Help.TEXT);

function keyRows() {
  // One row per default binding with a plain-English description, in help order.
  return Keymap.defaults
    .filter((b) => b.mode === "normal" && Help.TEXT[commandOf(b)])
    .sort((a, b) => ORDER.indexOf(commandOf(a)) - ORDER.indexOf(commandOf(b)) || a.keys.length - b.keys.length)
    .map((b) => {
      const id = Keymap.idOf(b);
      b = { ...b, command: commandOf(b) };
      const [group, text] = Help.TEXT[b.command];
      const current = id in values.keyOverrides ? values.keyOverrides[id] : b.keys;
      return { id, b, group, text, current, feature: commandFeature(b.command) };
    });
}

function renderKeys() {
  const q = $("search").value.trim().toLowerCase();
  const tbody = $("keys");
  tbody.textContent = "";
  const now = featuresNow();
  const rows = keyRows().filter((r) => !q || r.text.toLowerCase().includes(q) || r.current.toLowerCase().includes(q) || r.b.keys.toLowerCase() === q || r.group.toLowerCase().includes(q));
  for (const g of Help.GROUPS) {
    const inGroup = rows.filter((r) => r.group === g);
    if (!inGroup.length) continue;
    const head = tbody.insertRow();
    head.className = "group";
    const hc = head.insertCell();
    hc.colSpan = 4;
    hc.textContent = g;
    for (const r of inGroup) {
      const on = r.feature === "core" || !!now[r.feature];
      const tr = tbody.insertRow();
      tr.dataset.id = r.id;
      tr.className = on ? "" : "disabled";
      const k = tr.insertCell();
      k.className = "k";
      const input = document.createElement("input");
      input.value = r.current;
      input.setAttribute("aria-label", `Key for: ${r.text}`);
      input.spellcheck = false;
      input.classList.toggle("changed", r.current !== r.b.keys);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
      input.addEventListener("change", () => setKey(r, input.value.trim(), input));
      k.appendChild(input);
      const d = tr.insertCell();
      d.className = "d";
      d.textContent = r.text;
      if (!on) {
        const off = document.createElement("small");
        off.className = "off";
        off.textContent = "Off in this preset";
        d.appendChild(off);
      }
      const def = tr.insertCell();
      def.className = "def";
      def.textContent = r.current !== r.b.keys ? `default: ${r.b.keys}` : "";
      const reset = tr.insertCell();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "reset";
      btn.textContent = "Reset to default";
      btn.disabled = r.current === r.b.keys;
      btn.addEventListener("click", () => {
        const next = { ...values.keyOverrides };
        delete next[r.id];
        save({ keyOverrides: next }, `${r.b.keys} restored`);
      });
      reset.appendChild(btn);
    }
  }
}

function setKey(r, keys, input) {
  const next = { ...values.keyOverrides };
  if (keys && PaneMux.Keys.parseKeys(keys).length === 0) { input.classList.add("bad"); flash("That isn't a key", true); return; }
  const clash = Keymap.conflict(r.id, keys, next);
  if (clash) {
    input.classList.add("bad");
    flash(`${keys} is already used for “${(Help.TEXT[clash.command] || [, clash.command])[1]}”`, true);
    return;
  }
  if (keys === r.b.keys) delete next[r.id];
  else next[r.id] = keys;
  save({ keyOverrides: next }, keys ? `${r.text}: ${keys}` : `${r.text}: switched off`);
}

// ---- plain settings -------------------------------------------------------

const FIELDS = ["indicator", "modeHints", "scanlines", "smoothScroll", "scrollStep", "hintChars", "openNewTabInBackground", "uKey", "confirmBulkClose", "ambiguousTimeout"];

function readField(el, key) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number") {
    const n = parseInt(el.value, 10);
    return Number.isFinite(n) ? n : DEFAULTS[key];
  }
  return el.value;
}

function valid(key, value) {
  if (key === "hintChars") return value.length >= 2 && new Set(value).size === value.length;
  return true;
}

for (const key of FIELDS) {
  const el = $(key);
  el.addEventListener("change", () => {
    const value = readField(el, key);
    if (!valid(key, value)) { flash(`That doesn't work for ${key}`, true); render(); return; }
    save({ [key]: value });
  });
}

function renderFields() {
  for (const key of FIELDS) {
    const el = $(key);
    if (el.type === "checkbox") el.checked = !!values[key];
    else el.value = values[key];
  }
  const classic = values.preset === "classic";
  $("confirmBulkClose").disabled = classic;
  if (classic) $("confirmBulkClose").checked = true;
  $("confirm-note").textContent = classic ? "Always on in Classic" : "Shows the tabs first; Esc cancels";
  $("uKey").disabled = !featuresNow().undo;
  $("enabled").checked = values.enabled !== false;
}

$("enabled").addEventListener("change", () => save({ enabled: $("enabled").checked }, $("enabled").checked ? "PaneMux is on" : "PaneMux is off everywhere"));

// ---- paused sites ------------------------------------------------------------

function renderSites() {
  const ul = $("sites");
  ul.textContent = "";
  if (!values.pausedSites.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No paused sites.";
    ul.appendChild(li);
    return;
  }
  for (const site of values.pausedSites) {
    const li = document.createElement("li");
    li.dataset.site = site;
    li.append(site);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost";
    btn.textContent = "Resume";
    btn.addEventListener("click", () => save({ pausedSites: values.pausedSites.filter((s) => s !== site) }, `Resumed on ${site}`));
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

// ---- search (keys + setting rows) --------------------------------------------

function applySearch() {
  const q = $("search").value.trim().toLowerCase();
  document.querySelectorAll(".settings .row").forEach((row) => {
    const hay = `${row.dataset.search} ${row.textContent}`.toLowerCase();
    row.hidden = !!q && !hay.includes(q);
  });
  document.querySelectorAll("#features label").forEach((l) => { l.hidden = !!q && !l.dataset.search.includes(q); });
  renderKeys();
}
$("search").addEventListener("input", applySearch);

// ---- "try Power User" nudge after ~3 days of use --------------------------------

async function renderNudge() {
  const { usageDays = [], powerNudgeDismissed = false } = await chrome.storage.local.get(["usageDays", "powerNudgeDismissed"]);
  $("power-nudge").hidden = !(values.preset === "classic" && usageDays.length >= 3 && !powerNudgeDismissed);
}
$("try-power").addEventListener("click", () => save({ preset: "power" }, "Power User preset on"));
$("dismiss-nudge").addEventListener("click", async () => {
  await chrome.storage.local.set({ powerNudgeDismissed: true });
  renderNudge();
});

$("run-tutorial").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("tutorial/tutorial.html") }));

// ---- boot --------------------------------------------------------------------

function render() {
  renderPresets();
  renderFields();
  renderSites();
  applySearch();
  renderNudge();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  for (const [k, { newValue }] of Object.entries(changes)) values[k] = newValue === undefined ? DEFAULTS[k] : newValue;
  render();
});

chrome.storage.sync.get(DEFAULTS, (stored) => {
  values = { ...DEFAULTS, ...stored };
  render();
});
