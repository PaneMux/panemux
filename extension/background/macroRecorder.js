// Macro recording + replay, owned by the service worker so a macro can span
// tab switches and page loads.
//
// A macro is a list of *steps*, not raw keys (raw keys are kept for display):
//   { t: "cmd",  command, count, char, mode }  an FSM-dispatched command
//   { t: "hint", desc, newTab, pick }          element chosen via hints (stable descriptor, not the label)
//   { t: "find", query }                       committed "/" search
//   { t: "ex",   text }                        ":" command
//   { t: "text", text }                        text typed in Insert mode
//   { t: "key",  key }                         special key in Insert mode (<cr>, <bs>)
//
// Everything lives in chrome.storage.local, so macros survive reloads and
// service-worker restarts:
//   macroRecording  { reg, steps, keys }   while recording (content scripts watch it for the REC badge)
//   macros          { a: { steps, keys, time }, ... }
//   macroLast       last played register, for @@

const REC = "macroRecording";
const MACROS = "macros";
const LAST = "macroLast";
const MAX_DEPTH = 10;

// Recording messages arrive from content scripts asynchronously; apply them
// strictly in order.
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));

const get = async (k, dflt) => (await chrome.storage.local.get(k))[k] ?? dflt;

export function startRecording(reg) {
  return serial(async () => {
    if (!/^[a-zA-Z]$/.test(reg)) throw new Error(`Invalid register "${reg}" (a-z, A-Z appends)`);
    const name = reg.toLowerCase();
    const append = reg !== name;
    const existing = append ? (await get(MACROS, {}))[name] : null;
    const rec = { reg: name, append, steps: existing ? existing.steps.slice() : [], keys: existing ? existing.keys.slice() : [] };
    await chrome.storage.local.set({ [REC]: rec });
    return rec;
  });
}

export function recordStep(step) {
  return serial(async () => {
    const rec = await get(REC, null);
    if (!rec) return;
    const last = rec.steps[rec.steps.length - 1];
    // Coalesce typing into one text step.
    if (step.t === "text" && last && last.t === "text") last.text += step.text;
    else rec.steps.push(step);
    await chrome.storage.local.set({ [REC]: rec });
  });
}

export function recordKey(key) {
  return serial(async () => {
    const rec = await get(REC, null);
    if (!rec) return;
    rec.keys.push(key);
    await chrome.storage.local.set({ [REC]: rec });
  });
}

export function stopRecording() {
  return serial(async () => {
    const rec = await get(REC, null);
    if (!rec) return null;
    if (rec.keys[rec.keys.length - 1] === "q") rec.keys.pop(); // the stop key itself
    const macros = await get(MACROS, {});
    macros[rec.reg] = { steps: rec.steps, keys: rec.keys, time: Date.now() };
    await chrome.storage.local.set({ [MACROS]: macros });
    await chrome.storage.local.remove(REC);
    return { reg: rec.reg, steps: rec.steps.length };
  });
}

export async function listMacros() {
  return get(MACROS, {});
}

// ---- replay -----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function waitComplete(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(l); resolve(); } };
    const l = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    chrome.tabs.onUpdated.addListener(l);
    chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") finish(); }).catch(finish);
    setTimeout(finish, timeout);
  });
}

// Loaded and with our content script answering.
async function waitReady(tabId) {
  await waitComplete(tabId);
  for (let i = 0; i < 50; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: "pmx.ping" });
      if (r && r.ok) return;
    } catch (e) {}
    await sleep(100);
  }
  const t = await chrome.tabs.get(tabId).catch(() => null);
  throw new Error(`Macro stopped: PaneMux can't run on ${t && t.url ? new URL(t.url).protocol + "//" : "this"} page`);
}

// Give a step's side effects (navigation, tab switch) a moment to start, then
// wait for whatever is now the active tab to settle.
async function settle() {
  await sleep(80);
  const tab = await activeTab();
  if (tab && tab.status === "loading") await waitComplete(tab.id);
}

async function runStep(step) {
  const tab = await activeTab();
  if (!tab) throw new Error("Macro stopped: no active tab");
  await waitReady(tab.id);
  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: "macro.exec", step });
  } catch (e) {
    res = null; // page navigated away mid-step: that's the step working
  }
  if (res && res.ok === false) throw new Error(`Macro stopped: ${res.error}`);
  await settle();
}

async function playSteps(reg, count, depth) {
  if (depth > MAX_DEPTH) throw new Error("Macro stopped: recursion too deep");
  const macros = await get(MACROS, {});
  const m = macros[reg];
  if (!m) throw new Error(`Register "${reg}" has no macro`);
  for (let i = 0; i < count; i++) {
    for (const step of m.steps) {
      if (step.t === "cmd" && step.command === "macroPlay") {
        await playSteps(step.char === "@" ? (await get(LAST, null)) || reg : step.char, step.count || 1, depth + 1);
      } else {
        await runStep(step);
      }
    }
  }
}

let playing = false;

export async function playMacro(reg, count = 1) {
  if (playing) throw new Error("A macro is already playing");
  const name = reg === "@" ? await get(LAST, null) : reg.toLowerCase();
  if (!name) throw new Error("No previously used macro");
  await chrome.storage.local.set({ [LAST]: name });
  playing = true;
  try {
    await playSteps(name, count, 0);
    return { reg: name };
  } finally {
    playing = false;
  }
}

export { activeTab };
