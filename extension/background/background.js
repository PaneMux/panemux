// PaneMux service worker: tab operations, global marks, ex-commands,
// registers, macros, undo tree, splits.
import { listCommands, execute } from "./commandRegistry.js";
import { setRegister, setTabRegister, getTabRegister } from "./registers.js";
import * as Undo from "./undoService.js";
import { setupToolbar, stateFor, togglePause } from "./toolbar.js";
import { focusDirection, cycle as cycleSplit, closeSplit } from "./splits.js";
import { startRecording, stopRecording, recordStep, recordKey, playMacro, activeTab } from "./macroRecorder.js";

const handlers = {
  "cmd.list"() {
    return { ok: true, commands: listCommands() };
  },

  async "cmd.run"({ text, screen }, sender) {
    try {
      return { ok: true, ...(await execute(text, { tab: sender.tab, screen })) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async "reg.set"({ name, value, regType }) {
    await setRegister(name, value, regType);
    return { ok: true };
  },

  // ---- toolbar state (for the options page and tests) ----
  async "site.state"(msg, sender) {
    const tab = msg.tabId ? await chrome.tabs.get(msg.tabId) : sender.tab;
    return { ok: true, state: await stateFor(tab) };
  },
  async "site.toggle"(msg, sender) {
    await togglePause(msg.tabId ? await chrome.tabs.get(msg.tabId) : sender.tab);
    return { ok: true };
  },

  // ---- undo tree ----
  async "undo.push"({ kind, label, data }, sender) {
    const id = await Undo.push(kind, label, { ...data, tabId: sender.tab.id, url: sender.tab.url });
    return { ok: true, id };
  },
  "undo.undo": ({ count }) => Undo.undo(count || 1),
  "undo.redo": ({ count }) => Undo.redo(count || 1),
  "undo.step": ({ delta }) => Undo.step(delta),
  "undo.goto": ({ id }) => Undo.gotoNode(id),
  async "undo.view"() {
    return { ok: true, ...(await Undo.view()) };
  },

  // ---- splits (W prefix; Chrome reserves Ctrl+W) ----
  "split.focus": ({ dir }, sender) => focusDirection(dir, sender.tab.windowId),
  "split.cycle": (msg, sender) => cycleSplit(sender.tab.windowId),
  "split.close": (msg, sender) => closeSplit(sender.tab.windowId),

  // ---- macros ----
  async "macro.start"({ reg }) {
    const rec = await startRecording(reg);
    return { ok: true, reg: rec.reg, append: rec.append };
  },
  async "macro.stop"() {
    return { ok: true, ...(await stopRecording()) };
  },
  async "macro.record"({ step }) {
    await recordStep(step);
  },
  async "macro.key"({ key }) {
    await recordKey(key);
  },
  async "macro.play"({ reg, count }) {
    try {
      return { ok: true, ...(await playMacro(reg, count)) };
    } catch (e) {
      // The tab that asked may be long gone (navigated/switched): report on the active one.
      const tab = await activeTab();
      if (tab) chrome.tabs.sendMessage(tab.id, { type: "hud.toast", message: e.message, error: true }).catch(() => {});
      return { ok: false, error: e.message };
    }
  },

  // ---- tab overview + tab registers ----
  async "tabs.list"(msg, sender) {
    const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
    return { ok: true, tabs: tabs.map(({ id, index, title, url, active, pinned, audible, favIconUrl }) => ({ id, index, title, url, active, pinned, audible, favIconUrl })) };
  },
  async "tabs.activate"({ tabId }) {
    await chrome.tabs.update(tabId, { active: true });
  },
  async "tabs.close"({ tabIds }) {
    await chrome.tabs.remove(tabIds);
  },
  async "treg.yank"({ name, tabIds }) {
    const tabs = (await Promise.all(tabIds.map((id) => chrome.tabs.get(id).catch(() => null)))).filter(Boolean);
    const entry = await setTabRegister(name, tabs);
    return { ok: true, n: tabs.length, localOnly: entry.localOnly };
  },
  async "treg.put"({ name }, sender) {
    const tabs = await getTabRegister(name);
    if (!tabs || !tabs.length) return { ok: false, error: `Tab register "${name}" is empty` };
    const base = sender.tab ? sender.tab.index + 1 : undefined;
    for (const [i, t] of tabs.entries()) {
      await chrome.tabs.create({ url: t.url, active: false, windowId: sender.tab && sender.tab.windowId, index: base === undefined ? undefined : base + i });
    }
    return { ok: true, n: tabs.length };
  },

  async "tabs.create"(msg, sender) {
    const tab = sender.tab;
    await chrome.tabs.create({ windowId: tab && tab.windowId, index: tab ? tab.index + 1 : undefined });
  },

  async "tabs.open"({ url, background }, sender) {
    const tab = sender.tab;
    await chrome.tabs.create({
      url,
      active: !background,
      windowId: tab && tab.windowId,
      index: tab ? tab.index + 1 : undefined,
      openerTabId: tab && tab.id,
    });
  },

  // Relative tab switch (J/K, gt/gT), wrapping around.
  async "tabs.move"({ delta }, sender) {
    const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
    const n = tabs.length;
    const cur = tabs.findIndex((t) => t.id === sender.tab.id);
    const next = tabs[(((cur + delta) % n) + n) % n];
    if (next) await chrome.tabs.update(next.id, { active: true });
  },

  // Absolute tab switch ({count}gt), clamped to the last tab.
  async "tabs.goto"({ index }, sender) {
    const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
    const t = tabs[Math.max(0, Math.min(index, tabs.length - 1))];
    if (t) await chrome.tabs.update(t.id, { active: true });
  },

  async "marks.setGlobal"({ mark, url, x, y }, sender) {
    const { globalMarks = {} } = await chrome.storage.local.get("globalMarks");
    globalMarks[mark] = { url, x, y, tabId: sender.tab.id };
    await chrome.storage.local.set({ globalMarks });
    return { ok: true };
  },

  async "marks.jumpGlobal"({ mark }) {
    const { globalMarks = {} } = await chrome.storage.local.get("globalMarks");
    const m = globalMarks[mark];
    if (!m) return { ok: false };
    const sameUrl = (t) => t.url && t.url.split("#")[0] === m.url.split("#")[0];

    // Prefer the tab the mark was set in, then any tab on that URL, else open it.
    let tab = await chrome.tabs.get(m.tabId).catch(() => null);
    if (!tab || !sameUrl(tab)) tab = (await chrome.tabs.query({})).find(sameUrl);
    if (tab) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    } else {
      tab = await chrome.tabs.create({ url: m.url });
      await waitForLoad(tab.id);
    }
    await sendWithRetry(tab.id, { type: "marks.scrollTo", mark, x: m.x, y: m.y });
    return { ok: true };
  },
};

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// The content script may not be injected yet right after a load.
async function sendWithRetry(tabId, msg, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const handler = msg && handlers[msg.type];
  if (!handler) return false;
  Promise.resolve(handler(msg, sender))
    .then((res) => reply(res || { ok: true }))
    .catch((e) => {
      console.error("PaneMux:", msg.type, e);
      reply({ ok: false, error: String(e) });
    });
  return true; // async reply
});

setupToolbar();

Undo.watchTabs();
