// Toolbar button: on / off / paused-for-this-site, and what pausing does to a page.
import { test, expect, open, scrollY, BASE } from "./fixtures.mjs";

// Extension pages can message the worker like the toolbar click would.
async function extPage(context, extensionId) {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/options/options.html`);
  return p;
}
const tabIdOf = (sw, url) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u).id, url);
const badge = (sw, tabId) => sw.evaluate(async (id) => ({ text: await chrome.action.getBadgeText({ tabId: id }), title: await chrome.action.getTitle({ tabId: id }) }), tabId);
const hudMounted = (page) => page.evaluate(() => !!document.querySelector("panemux-hud"));

test("clicking the toolbar button pauses PaneMux on this site, and again resumes it", async ({ page, context, serviceWorker, extensionId }) => {
  await open(page);
  const id = await tabIdOf(serviceWorker, `${BASE}/long.html`);
  expect(await badge(serviceWorker, id)).toEqual({ text: "", title: "PaneMux is on — click to pause on localhost" });

  const ext = await extPage(context, extensionId);
  await ext.evaluate((tabId) => chrome.runtime.sendMessage({ type: "site.toggle", tabId }), id);
  await expect.poll(() => badge(serviceWorker, id)).toEqual({ text: "II", title: "PaneMux is paused on localhost — click to resume" });

  await page.bringToFront();
  await expect.poll(() => hudMounted(page)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-panemux-strip"))).toBe(false);
  await page.keyboard.press("j");
  await page.waitForTimeout(300);
  expect(await scrollY(page)).toBe(0);                       // j went to the page, not to us
  expect(await page.evaluate(() => window.pageKeys)).toContain("j");

  await ext.evaluate((tabId) => chrome.runtime.sendMessage({ type: "site.toggle", tabId }), id);
  await expect.poll(() => hudMounted(page)).toBe(true);
  await page.bringToFront();
  await page.keyboard.press("j");
  await expect.poll(() => scrollY(page)).toBe(60);
});

test("pausing is per site: other sites keep working", async ({ page, context, serviceWorker }) => {
  await open(page);
  await serviceWorker.evaluate(() => chrome.storage.sync.set({ pausedSites: ["example.invalid"] }));
  await page.keyboard.press("j");
  await expect.poll(() => scrollY(page)).toBe(60);
  await serviceWorker.evaluate(() => chrome.storage.sync.set({ pausedSites: ["localhost"] }));
  await expect.poll(() => hudMounted(page)).toBe(false);
});

test("off everywhere greys out every tab; a click turns it back on", async ({ page, context, serviceWorker, extensionId }) => {
  await open(page);
  const id = await tabIdOf(serviceWorker, `${BASE}/long.html`);
  await serviceWorker.evaluate(() => chrome.storage.sync.set({ enabled: false }));
  await expect.poll(() => badge(serviceWorker, id)).toMatchObject({ text: "OFF" });
  await expect.poll(() => hudMounted(page)).toBe(false);
  const ext = await extPage(context, extensionId);
  await ext.evaluate((tabId) => chrome.runtime.sendMessage({ type: "site.toggle", tabId }), id);
  await expect.poll(() => badge(serviceWorker, id)).toMatchObject({ text: "" });
  await expect.poll(() => hudMounted(page)).toBe(true);
});

test("the toolbar shortcut is registered", async ({ serviceWorker }) => {
  const cmds = await serviceWorker.evaluate(() => chrome.commands.getAll());
  expect(cmds.find((c) => c.name === "toggle-site")).toMatchObject({ description: "Pause or resume PaneMux on this site" });
});
