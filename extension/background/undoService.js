// Undo service: feeds the UndoTree and applies its operations.
//
// Node kinds:
//   close  { tabs: [{ url, title, index, windowId, pinned, newId? }] }   tabs closed (batched ~400ms)
//   hide   { tabId, url, desc }                                         Visual "d"
//   edit   { tabId, url, desc, before, after, prop }                    form field change
//   hides  { tabId, url, items: [{ desc, value, priority }] }           text object "da…"
//   html   { tabId, url, items: [{ desc, before, after }] }             text object "di…", "c…"
//
// Tree lives in chrome.storage.session: memory only (never written to disk),
// survives service-worker restarts, gone when the browser quits. Form values
// never leave the worker except to the tab that owns the field.
import { UndoTree } from "./undoTree.js";

const KEY = "undoTree";
const TAB_CACHE = "undoTabCache";
const CLOSE_BATCH_MS = 400;

let tree = null;
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));

async function load() {
  if (!tree) tree = new UndoTree((await chrome.storage.session.get(KEY))[KEY]);
  return tree;
}
const save = () => chrome.storage.session.set({ [KEY]: tree.toJSON() });

// Tell every tab's panel to refresh (payload-free).
async function broadcast() {
  for (const t of await chrome.tabs.query({})) chrome.tabs.sendMessage(t.id, { type: "undo.changed" }).catch(() => {});
}

export function push(kind, label, data) {
  return serial(async () => {
    await load();
    const n = tree.push({ kind, label, data });
    await save();
    broadcast();
    return n.id;
  });
}

// ---- closed-tab tracking ------------------------------------------------------
// onRemoved doesn't say what the tab was, so keep a cache of tab info.
const cache = new Map();
const suppress = new Set(); // tab ids we close ourselves (redo of a close)
const expected = new Map(); // tab id -> tab to notify with an undo toast (closes PaneMux did)

export function expectCloses(tabIds, notifyTabId) {
  for (const id of tabIds) expected.set(id, notifyTabId);
}
let pendingClose = [];
let closeTimer = null;

const remember = (t) => t && t.id !== undefined && cache.set(t.id, { url: t.url || t.pendingUrl, title: t.title, index: t.index, windowId: t.windowId, pinned: t.pinned });
let persistTimer = null;
const persistCache = () => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => chrome.storage.session.set({ [TAB_CACHE]: [...cache] }), 200);
};

async function initCache() {
  const saved = (await chrome.storage.session.get(TAB_CACHE))[TAB_CACHE];
  if (saved) for (const [id, v] of saved) cache.set(id, v);
  for (const t of await chrome.tabs.query({})) remember(t);
  persistCache();
}

async function flushCloses() {
  const batch = pendingClose;
  pendingClose = [];
  // Browser and extension pages (including our own settings/tutorial) stay out of history.
  const tabs = batch.filter((t) => t.url && !/^(chrome|chrome-extension|moz-extension|edge|about|devtools|view-source):/.test(t.url));
  if (!tabs.length) return;
  const label = tabs.length === 1 ? `close ${tabs[0].title || tabs[0].url}` : `close ${tabs.length} tabs`;
  const id = await push("close", label, { tabs: tabs.map(({ notify, ...t }) => t) });
  // Closes PaneMux did itself get a toast with an Undo button on the page that asked.
  const notify = batch.map((t) => t.notify).find((n) => n !== undefined);
  if (notify !== undefined) {
    const message = tabs.length === 1 ? `Closed "${tabs[0].title || tabs[0].url}"` : `Closed ${tabs.length} tabs`;
    toast(notify, { type: "undo.toast", id, message });
  }
}

// Prefer the tab that asked; if it was one of the closed ones, the active tab.
async function toast(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active) chrome.tabs.sendMessage(active.id, msg).catch(() => {});
  }
}

export function watchTabs() {
  initCache();
  chrome.tabs.onCreated.addListener((t) => { remember(t); persistCache(); });
  chrome.tabs.onUpdated.addListener((id, info, t) => { remember(t); persistCache(); });
  chrome.tabs.onMoved.addListener((id) => chrome.tabs.get(id).then((t) => { remember(t); persistCache(); }).catch(() => {}));
  chrome.tabs.onAttached.addListener((id) => chrome.tabs.get(id).then((t) => { remember(t); persistCache(); }).catch(() => {}));
  chrome.tabs.onRemoved.addListener((id, info) => {
    const t = cache.get(id);
    cache.delete(id);
    persistCache();
    const notify = expected.get(id);
    expected.delete(id);
    if (suppress.delete(id) || info.isWindowClosing || !t) return;
    pendingClose.push({ ...t, notify });
    clearTimeout(closeTimer);
    closeTimer = setTimeout(flushCloses, CLOSE_BATCH_MS);
  });
}

// ---- applying ops ---------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tabFor(data) {
  let tab = await chrome.tabs.get(data.tabId).catch(() => null);
  const sameUrl = (t) => t && t.url && t.url.split("#")[0] === data.url.split("#")[0];
  if (!sameUrl(tab)) tab = (await chrome.tabs.query({})).find(sameUrl) || null;
  return tab;
}

async function sendReady(tabId, msg) {
  for (let i = 0; i < 30; i++) {
    try { return await chrome.tabs.sendMessage(tabId, msg); } catch (e) { await sleep(100); }
  }
  throw new Error("page not responding");
}

async function apply({ node, dir }) {
  const d = node.data;
  if (node.kind === "close") {
    if (dir === "undo") {
      for (const [i, t] of d.tabs.entries()) {
        const win = await chrome.windows.get(t.windowId).catch(() => null);
        const created = await chrome.tabs.create({ url: t.url, index: win ? t.index : undefined, windowId: win ? t.windowId : undefined, pinned: !!t.pinned, active: i === 0 });
        t.newId = created.id;
      }
    } else {
      const ids = d.tabs.map((t) => t.newId).filter((id) => id !== undefined);
      ids.forEach((id) => suppress.add(id));
      await chrome.tabs.remove(ids).catch(() => {});
    }
    return;
  }
  // DOM actions: go to the tab that owns them, then let its content script act.
  const tab = await tabFor(d);
  if (!tab) throw new Error(`the tab for "${node.label}" is gone`);
  if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  if (tab.status === "loading") await sleep(300);
  const res = await sendReady(tab.id, { type: "undo.apply", node: { id: node.id, kind: node.kind, data: d }, dir });
  if (res && res.ok === false) throw new Error(res.error);
  d.tabId = tab.id; // follow the page if it moved tabs
}

async function run(fn, emptyMsg) {
  return serial(async () => {
    await load();
    const ops = fn(tree);
    const errors = [];
    for (const op of ops) {
      try { await apply(op); } catch (e) { errors.push(e.message); }
    }
    await save();
    broadcast();
    if (!ops.length) return { ok: true, message: emptyMsg };
    const last = ops[ops.length - 1];
    const verb = last.dir === "undo" ? "undo" : "redo";
    const msg = `${verb}: ${last.node.label}${ops.length > 1 ? ` (+${ops.length - 1} more)` : ""} · now at #${tree.cur}`;
    return { ok: true, message: errors.length ? `${msg} — couldn't apply: ${errors[0]}` : msg, error: errors.length > 0 };
  });
}

export const undo = (count) => run((t) => t.undo(count), "Already at oldest change");
export const redo = (count) => run((t) => t.redo(count), "Already at newest change");
export const step = (delta) => run((t) => t.step(delta), delta < 0 ? "Already at oldest change" : "Already at newest change");
export const gotoNode = (id) => run((t) => t.goto(id), "Already there");
export const view = () => serial(async () => (await load()).view());

// Toast "Undo" button: undo that one action, only if nothing happened since.
export async function revert(id) {
  await load();
  if (tree.cur !== id) {
    return { ok: true, error: true, message: "Other changes happened since — press U to see the undo tree" };
  }
  return undo(1);
}
