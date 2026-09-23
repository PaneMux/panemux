// Playwright fixtures: a persistent Chromium context with the unpacked
// PaneMux extension loaded, plus helpers to peek into the HUD.
import { test as base, chromium, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const extensionPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "extension");
export const BASE = "http://localhost:4517";

export const test = base.extend({
  // null = no viewport emulation (Playwright otherwise resizes every new
  // window to the viewport, which fights window-tiling tests).
  pmxViewport: [{ width: 1200, height: 800 }, { option: true }],
  context: async ({ pmxViewport }, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pmx-profile-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium", // new headless mode supports extensions
      headless: !process.env.HEADED,
      viewport: pmxViewport,
      // Headless screen defaults to 800x600, smaller than the viewport; give it
      // room so window tiling (:vsp/:sp) sees a realistic work area.
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--screen-info={1600x1000}"],
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    // A fresh install opens the tutorial; most specs don't want it.
    const tutorial = context.pages().find((p) => p.url().includes("/tutorial/")) ||
      (await context.waitForEvent("page", { predicate: (p) => p.url().includes("/tutorial/"), timeout: 5000 }).catch(() => null));
    context.pmxTutorialUrl = tutorial ? tutorial.url() : null; // for tutorial.spec
    if (tutorial) await tutorial.close();
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },
  // Most specs exercise every feature, so they run on the Power User preset;
  // specs about defaults override this with test.use({ pmxSettings: {} }).
  pmxSettings: [{ preset: "power" }, { option: true }],
  serviceWorker: async ({ context, pmxSettings }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    await sw.evaluate((s) => chrome.storage.sync.set(s), pmxSettings);
    await use(sw);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(serviceWorker.url().split("/")[2]);
  },
  page: async ({ context, serviceWorker }, use) => {
    const page = context.pages().find((p) => !p.url().startsWith("chrome-extension://")) || (await context.newPage());
    await use(page);
  },
});

// Load a test page and wait until the content script's HUD is mounted.
export async function open(page, file = "long.html") {
  await page.goto(`${BASE}/${file}`);
  await ready(page);
}

export async function ready(page) {
  await page.waitForFunction(() => {
    const h = document.querySelector("panemux-hud");
    return h && h.isConnected && h.shadowRoot && h.shadowRoot.adoptedStyleSheets.length === 2 && h.shadowRoot.querySelector(".strip, .pill");
  });
  // Give focus to the document body so keys go to the page, not the URL bar.
  await page.evaluate(() => window.focus());
}

export const hud = (page, fn, arg) =>
  page.evaluate(([src, a]) => new Function("root", "arg", `return (${src})(root, arg)`)(document.querySelector("panemux-hud").shadowRoot, a), [fn.toString(), arg]);

export const indicator = (page) => hud(page, (root) => root.querySelector(".strip, .pill"));
export const mode = (page) => hud(page, (root) => root.querySelector(".strip, .pill").dataset.mode);
export const scrollY = (page) => page.evaluate(() => Math.round(scrollY));
export const scrollX = (page) => page.evaluate(() => Math.round(scrollX));
export const toast = (page) => hud(page, (root) => root.querySelector(".toast.show")?.textContent || "");

// Wait for smooth scrolling to settle at a value satisfying `pred`.
export async function waitScroll(page, pred, axis = "y") {
  const read = () => (axis === "y" ? scrollY(page) : scrollX(page));
  await expect.poll(async () => { const v = await read(); return pred(v) ? true : v; }, { timeout: 3000 }).toBe(true);
  // and stable
  let last = -1, cur = axis === "y" ? await scrollY(page) : await scrollX(page);
  while (cur !== last) { await page.waitForTimeout(80); last = cur; cur = axis === "y" ? await scrollY(page) : await scrollX(page); }
  return cur;
}

export async function type(page, keys) {
  for (const k of keys) await page.keyboard.press(k);
}

// Active tab URL according to chrome.tabs (Playwright has no "active tab" notion).
export const activeTabUrl = (sw) => sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url);

export { expect };
