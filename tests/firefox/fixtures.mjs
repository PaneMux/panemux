// Playwright fixtures for Firefox: a fresh Firefox profile per test with the
// Firefox build of PaneMux installed as a temporary add-on.
//
//   page        a normal web page tab
//   background  evaluate(fn, arg) in the add-on's background page (the
//               Firefox stand-in for Chrome's serviceWorker.evaluate)
//   extPage     extPage("options/") -> evaluate in an open add-on page
import { test as base, expect } from "@playwright/test";
import { launchFirefox, EXT_ORIGIN } from "./launch.mjs";

export { expect, EXT_ORIGIN };
import { BASE, ready } from "../e2e/fixtures.mjs";
export { BASE, open, ready, hud, mode, scrollY, scrollX, toast, waitScroll, type } from "../e2e/fixtures.mjs";

export const test = base.extend({
  pmxSettings: [{ preset: "power" }, { option: true }],
  pmxPrefs: [{}, { option: true }],
  ff: async ({ pmxSettings, pmxPrefs }, use) => {
    const ff = await launchFirefox({
      prefs: {
        ...pmxPrefs,
        // let tests read the clipboard without a paste prompt
        "dom.events.asyncClipboard.readText": true,
        "dom.events.testing.asyncClipboard": true,
      },
    });
    // A fresh install opens the tutorial; most tests don't want it.
    await ff.extPage("tutorial/", 5000).catch(() => null);
    await ff.background(() => browser.tabs.query({}).then((ts) => browser.tabs.remove(ts.filter((t) => t.url.startsWith("moz-extension:")).map((t) => t.id))));
    await ff.background((s) => browser.storage.sync.set(s), pmxSettings);
    await use(ff);
    await ff.context.close();
    ff.context.pmxCleanup();
  },
  context: async ({ ff }, use) => use(ff.context),
  background: async ({ ff }, use) => use(ff.background),
  extPage: async ({ ff }, use) => use(ff.extPage),
  page: async ({ context }, use) => use(context.pages()[0] || (await context.newPage())),
  // Playwright's Firefox opens every newPage() in its own window; commands
  // like J/K and :tabdo work on one window, so open real tabs next to `page`.
  newTab: async ({ context, background }, use) => {
    await use(async (file) => {
      const [tab] = await Promise.all([
        context.waitForEvent("page"),
        background((url) => browser.tabs.query({ url: "http://localhost/*" })
          .then((ts) => browser.tabs.create({ url, windowId: ts[0].windowId })), `${BASE}/${file}`),
      ]);
      await tab.waitForLoadState();
      await ready(tab);
      return tab;
    });
  },
});

export const activeTabUrl = (background) => background(() => browser.tabs.query({ active: true, lastFocusedWindow: true }).then((t) => t[0] && t[0].url));
