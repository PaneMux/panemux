// Named registers, Vim style. Phase 2 holds text only:
//   "  unnamed (last yank)     0  last yank     a-z  named
// Phase 3 adds tab-group registers alongside ({ type: "tabs" }).
// Persisted in chrome.storage.local so they survive service-worker restarts.

const KEY = "registers";

async function load() {
  const { [KEY]: regs = {} } = await chrome.storage.local.get(KEY);
  return regs;
}

export async function setRegister(name, value, type = "text") {
  const regs = await load();
  const entry = { type, value, time: Date.now() };
  regs[name] = entry;
  // Like Vim: every yank lands in the unnamed register, unnamed yanks also in "0.
  if (name === '"') regs["0"] = entry;
  else regs['"'] = entry;
  await chrome.storage.local.set({ [KEY]: regs });
  return entry;
}

export async function getRegister(name) {
  return (await load())[name] || null;
}

// Sorted like Vim's :reg — ", 0-9, a-z, then anything else.
export async function allRegisters() {
  const regs = await load();
  const rank = (n) => (n === '"' ? 0 : /\d/.test(n) ? 1 : /[a-z]/.test(n) ? 2 : 3);
  return Object.entries(regs)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([name, r]) => ({ name, ...r }));
}

// ---- tab registers ------------------------------------------------------------
// "{a-z}y in the tab overview saves tabs; "{a-z}p reopens them.
//
// chrome.storage.sync caps at ~100KB total and 8KB per item, so:
//   storage.local  "tabRegs"          full copy { a: { tabs:[{u,t}], time } }  (this device)
//   storage.sync   "treg:index"       tiny index { a: { n, chunks, time, localOnly } }
//   storage.sync   "treg:a:0", ":1"…  the tabs, split into < 8KB chunks
// A register too big for its sync budget stays local-only (index still syncs,
// so other devices can list it and say why they can't open it).

export const SYNC_INDEX = "treg:index";
const LOCAL_TABS = "tabRegs";
const ITEM_LIMIT = 8192;            // chrome.storage.sync.QUOTA_BYTES_PER_ITEM
const CHUNK_BUDGET = ITEM_LIMIT - 512;
const MAX_CHUNKS_PER_REG = 4;       // ~30KB per register, leaves room for 26 small ones
const TITLE_MAX = 60;

// What Chrome counts against quota: key length + JSON length.
const itemBytes = (key, value) => new TextEncoder().encode(key + JSON.stringify(value)).length;
const chunkKey = (name, i) => `treg:${name}:${i}`;

export function chunkTabs(name, items) {
  const chunks = [];
  let cur = [];
  for (const it of items) {
    if (cur.length && itemBytes(chunkKey(name, chunks.length), [...cur, it]) > CHUNK_BUDGET) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(it);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export async function setTabRegister(name, tabs) {
  const items = tabs.map((t) => ({ u: t.url, t: (t.title || "").slice(0, TITLE_MAX) }));
  const time = Date.now();

  const { [LOCAL_TABS]: local = {} } = await chrome.storage.local.get(LOCAL_TABS);
  local[name] = { tabs: items, time };
  await chrome.storage.local.set({ [LOCAL_TABS]: local });

  const { [SYNC_INDEX]: index = {} } = await chrome.storage.sync.get(SYNC_INDEX);
  const oldChunks = (index[name] && index[name].chunks) || 0;
  const chunks = chunkTabs(name, items);
  const fits = chunks.length <= MAX_CHUNKS_PER_REG;
  const entry = { n: items.length, chunks: fits ? chunks.length : 0, time, localOnly: !fits };
  const writes = { [SYNC_INDEX]: { ...index, [name]: entry } };
  if (fits) chunks.forEach((c, i) => (writes[chunkKey(name, i)] = c));
  try {
    await chrome.storage.sync.set(writes);
  } catch (e) {
    // Out of sync quota: keep it local-only.
    entry.localOnly = true;
    entry.chunks = 0;
    await chrome.storage.sync.set({ [SYNC_INDEX]: { ...index, [name]: entry } });
  }
  const stale = [];
  for (let i = entry.chunks; i < oldChunks; i++) stale.push(chunkKey(name, i));
  if (stale.length) await chrome.storage.sync.remove(stale);
  return entry;
}

// -> [{ url, title }] or null. Prefers this device's full copy.
export async function getTabRegister(name) {
  const { [LOCAL_TABS]: local = {} } = await chrome.storage.local.get(LOCAL_TABS);
  const { [SYNC_INDEX]: index = {} } = await chrome.storage.sync.get(SYNC_INDEX);
  const entry = index[name];
  const mine = local[name];
  let items = null;
  if (mine && (!entry || mine.time >= entry.time)) items = mine.tabs;
  else if (entry && !entry.localOnly && entry.chunks) {
    const keys = Array.from({ length: entry.chunks }, (_, i) => chunkKey(name, i));
    const got = await chrome.storage.sync.get(keys);
    items = keys.flatMap((k) => got[k] || []);
  } else if (entry && entry.localOnly) {
    throw new Error(`Tab register "${name}" is too big to sync and lives on another device`);
  }
  return items && items.map((i) => ({ url: i.u, title: i.t }));
}

export async function listTabRegisters() {
  const { [SYNC_INDEX]: index = {} } = await chrome.storage.sync.get(SYNC_INDEX);
  const { [LOCAL_TABS]: local = {} } = await chrome.storage.local.get(LOCAL_TABS);
  const names = new Set([...Object.keys(index), ...Object.keys(local)]);
  return [...names].sort().map((name) => {
    const tabs = local[name] ? local[name].tabs : null;
    return {
      name,
      n: index[name] ? index[name].n : tabs.length,
      localOnly: index[name] ? index[name].localOnly : true,
      preview: tabs ? tabs.map((t) => t.t || t.u).slice(0, 4).join(" | ") : "(synced from another device)",
    };
  });
}
