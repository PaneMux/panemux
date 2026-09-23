// Undo service: feeds the UndoTree and applies its operations.
//
// Node kinds:
//   close  { tabs: [{ url, title, index, windowId, pinned, newId? }] }   tabs closed (batched ~400ms)
//   hide   { tabId, url, desc }                                         Visual "d"
//   edit   { tabId, url, desc, before, after, prop }                    form field change
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

function flushCloses() {
  const tabs = pendingClose.filter((t) => t.url && !/^(chrome|edge|about|devtools):/.test(t.url));
  pendingClose = [];
  if (!tabs.length) return;
  const label = tabs.length === 1 ? `close ${tabs[0].title || tabs[0].url}` : `close ${tabs.length} tabs`;
  push("close", label, { tabs });
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
    if (suppress.delete(id) || info.isWindowClosing || !t) return;
    pendingClose.push(t);
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
  if (node.kind === "hide" || node.kind === "edit") d.tabId = tab.id; // follow the page if it moved tabs
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
