// Safety nets for destructive actions (panemux-ux-guidelines.md §5).
//
// Closing 2+ tabs at once never happens straight away: the caller gets a
// preview ({ confirm }) and the tabs close only when the user confirms it.
// Previews are always on in Classic; Power User / Custom can switch them off
// with `confirmBulkClose`. Every close PaneMux performs is handed to the undo
// service so the page that asked can show an "Undo" toast.
import { expectCloses } from "./undoService.js";

const pending = new Map(); // id -> { tabIds, notifyTabId, time }
const TTL = 5 * 60 * 1000;
let seq = 0;

export async function needsConfirm(count) {
  if (count < 2) return false;
  const { preset = "classic", confirmBulkClose = true } = await chrome.storage.sync.get({ preset: "classic", confirmBulkClose: true });
  return preset === "classic" || confirmBulkClose !== false;
}

const plural = (n) => `${n} tab${n === 1 ? "" : "s"}`;

async function doClose(tabIds, notifyTabId) {
  expectCloses(tabIds, notifyTabId);
  await chrome.tabs.remove(tabIds);
}

// describe: how the tabs were picked, e.g. "matching 'twitter.com'"
export async function closeTabs(tabs, { describe = "", notifyTabId } = {}) {
  const tabIds = tabs.map((t) => t.id);
  if (await needsConfirm(tabs.length)) {
    const id = ++seq;
    pending.set(id, { tabIds, notifyTabId, time: Date.now() });
    const items = tabs.map((t) => t.title || t.url);
    return {
      confirm: {
        id,
        message: `This will close ${plural(tabs.length)}${describe ? ` ${describe}` : ""}`,
        items: items.slice(0, 8),
        more: Math.max(0, items.length - 8),
      },
    };
  }
  await doClose(tabIds, notifyTabId);
  return { message: `Closed ${plural(tabs.length)}` };
}

export async function confirm(id) {
  const p = pending.get(id);
  pending.delete(id);
  if (!p || Date.now() - p.time > TTL) throw new Error("That preview expired — run the command again");
  const alive = (await Promise.all(p.tabIds.map((t) => chrome.tabs.get(t).catch(() => null)))).filter(Boolean).map((t) => t.id);
  if (!alive.length) return { message: "Those tabs are already closed" };
  await doClose(alive, p.notifyTabId);
  return { message: `Closed ${plural(alive.length)}` };
}

export function cancel(id) {
  pending.delete(id);
  return { message: "Nothing was closed" };
}
