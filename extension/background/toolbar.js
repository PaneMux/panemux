// Toolbar button: always shows whether PaneMux is on, off, or paused for the
// current site, and changes it in one click (panemux-ux-guidelines.md,
// "Always-Visible Escape Hatches").
//
//   click              pause / resume on this site (turns PaneMux back on if it was off)
//   right-click menu   pause on this site, off everywhere, settings, tutorial
//   Alt+Shift+P        same as click
//
// State lives in chrome.storage.sync as `enabled` and `pausedSites`; content
// scripts watch those keys and switch themselves off live.

const MENU = { pause: "pmx-pause-site", off: "pmx-off-everywhere", options: "pmx-options", tutorial: "pmx-tutorial" };

const ICONS = (variant) => ({
  16: `icons/icon${variant}16.png`,
  32: `icons/icon${variant}32.png`,
  48: `icons/icon${variant}48.png`,
});

export function siteOf(url) {
  try {
    const u = new URL(url);
    return u.hostname || u.protocol;
  } catch (e) {
    return null;
  }
}

async function getState() {
  const { enabled = true, pausedSites = [] } = await chrome.storage.sync.get({ enabled: true, pausedSites: [] });
  return { enabled, pausedSites };
}

// "on" | "off" | "paused" | "unsupported" for a tab
export async function stateFor(tab) {
  if (!tab || !tab.url || !/^(https?|file):/.test(tab.url)) return "unsupported";
  const { enabled, pausedSites } = await getState();
  if (!enabled) return "off";
  return pausedSites.includes(siteOf(tab.url)) ? "paused" : "on";
}

async function render(tab) {
  if (!tab || tab.id === undefined) return;
  const state = await stateFor(tab);
  const site = siteOf(tab.url || "");
  const badge = { on: "", off: "OFF", paused: "II", unsupported: "" }[state];
  const title = {
    on: `PaneMux is on — click to pause on ${site}`,
    off: "PaneMux is off everywhere — click to turn it back on",
    paused: `PaneMux is paused on ${site} — click to resume`,
    unsupported: "PaneMux can't run on this page",
  }[state];
  await Promise.all([
    chrome.action.setIcon({ tabId: tab.id, path: ICONS(state === "on" ? "" : "-off") }).catch(() => {}),
    chrome.action.setBadgeText({ tabId: tab.id, text: badge }).catch(() => {}),
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: state === "paused" ? "#FBBF24" : "#52525B" }).catch(() => {}),
    chrome.action.setTitle({ tabId: tab.id, title }).catch(() => {}),
  ]);
  if (chrome.contextMenus) {
    chrome.contextMenus.update(MENU.pause, { checked: state === "paused", enabled: state !== "unsupported", title: site ? `Pause on ${site}` : "Pause on this site" }, () => void chrome.runtime.lastError);
    chrome.contextMenus.update(MENU.off, { checked: state === "off" }, () => void chrome.runtime.lastError);
  }
}

async function renderAll() {
  for (const tab of await chrome.tabs.query({})) render(tab);
}

async function renderActive() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  render(tab);
}

export async function togglePause(tab) {
  const site = siteOf(tab && tab.url);
  if (!site || !/^(https?|file):/.test(tab.url)) return;
  const { enabled, pausedSites } = await getState();
  if (!enabled) {
    // Off everywhere: one click turns it back on here (and resumes the site).
    await chrome.storage.sync.set({ enabled: true, pausedSites: pausedSites.filter((s) => s !== site) });
    return;
  }
  const next = pausedSites.includes(site) ? pausedSites.filter((s) => s !== site) : [...pausedSites, site];
  await chrome.storage.sync.set({ pausedSites: next });
}

async function setOffEverywhere(off) {
  await chrome.storage.sync.set({ enabled: !off });
}

export function openTutorial() {
  return chrome.tabs.create({ url: chrome.runtime.getURL("tutorial/tutorial.html") });
}

export function setupToolbar() {
  chrome.action.onClicked.addListener((tab) => togglePause(tab));

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: MENU.pause, title: "Pause on this site", type: "checkbox", contexts: ["action"] });
      chrome.contextMenus.create({ id: MENU.off, title: "Turn off everywhere", type: "checkbox", contexts: ["action"] });
      chrome.contextMenus.create({ id: MENU.tutorial, title: "Run the tutorial", contexts: ["action"] });
      chrome.contextMenus.create({ id: MENU.options, title: "Settings", contexts: ["action"] });
      renderAll();
    });
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === MENU.pause) await togglePause(tab);
    else if (info.menuItemId === MENU.off) await setOffEverywhere(info.checked);
    else if (info.menuItemId === MENU.options) chrome.runtime.openOptionsPage();
    else if (info.menuItemId === MENU.tutorial) openTutorial();
  });

  chrome.commands.onCommand.addListener(async (command, tab) => {
    if (command !== "toggle-site") return;
    if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    togglePause(tab);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && ("enabled" in changes || "pausedSites" in changes)) renderAll();
  });
  chrome.tabs.onActivated.addListener(renderActive);
  chrome.tabs.onUpdated.addListener((id, info, tab) => { if (info.url || info.status === "complete") render(tab); });
  renderAll();
}
