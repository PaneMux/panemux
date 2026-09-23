// Safety nets: previews before closing 2+ tabs, and Undo toasts with a button.
import { test, expect, open, hud, mode, toast, type, BASE } from "./fixtures.mjs";

async function ex(page, text) {
  await page.keyboard.press(":");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}
const preview = (page) => hud(page, (r) => {
  const p = r.querySelector(".preview");
  return p && { title: p.querySelector(".title").textContent, items: [...p.querySelectorAll("li")].map((li) => li.textContent) };
});
const urls = (sw) => sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url || t.pendingUrl).sort());
const toastButton = (page) => hud(page, (r) => r.querySelector(".toast.show .action")?.textContent || null);
const clickToastButton = (page) => page.evaluate(() => document.querySelector("panemux-hud").shadowRoot.querySelector(".toast.show .action").click());

async function openTabs(context, ...qs) {
  for (const q of qs) { const p = await context.newPage(); await open(p, `page2.html?${q}`); }
}

test("closing 2+ tabs shows a preview first; Esc cancels and nothing closes", async ({ page, context, serviceWorker }) => {
  await open(page);
  await openTabs(context, "a", "b", "c");
  await page.bringToFront();
  await ex(page, "tabdo close *page2*");
  await expect.poll(() => preview(page)).toEqual({ title: "This will close 3 tabs matching '*page2*'", items: ["Page two", "Page two", "Page two"] });
  await page.screenshot({ path: "test-results/safety-preview.png" });
  expect((await urls(serviceWorker)).length).toBe(4);
  await page.keyboard.press("Escape");
  expect(await preview(page)).toBeNull();
  await expect.poll(() => toast(page)).toContain("Nothing was closed");
  expect((await urls(serviceWorker)).length).toBe(4);
  expect(await mode(page)).toBe("normal");
});

test("Enter confirms; the Undo button in the toast brings them back", async ({ page, context, serviceWorker }) => {
  await open(page);
  await openTabs(context, "a", "b");
  await page.bringToFront();
  await ex(page, "g/page two/close");
  await expect.poll(() => preview(page)).toMatchObject({ title: "This will close 2 tabs matching /page two/" });
  await page.keyboard.press("Enter");
  await expect.poll(() => urls(serviceWorker)).toEqual([`${BASE}/long.html`]);
  await expect.poll(() => toast(page)).toContain("Closed 2 tabs");
  expect(await toastButton(page)).toBe("Undo");
  expect(await toast(page)).toContain("or press u");
  await clickToastButton(page);
  await expect.poll(() => urls(serviceWorker)).toEqual([`${BASE}/long.html`, `${BASE}/page2.html?a`, `${BASE}/page2.html?b`]);
});

test("a single-tab close skips the preview but still offers Undo", async ({ page, context, serviceWorker }) => {
  await open(page);
  await openTabs(context, "solo");
  await page.bringToFront();
  await ex(page, "tabdo close *solo*");
  await expect.poll(() => toast(page)).toContain('Closed "Page two"');
  expect(await preview(page)).toBeNull();
  await clickToastButton(page);
  await expect.poll(() => urls(serviceWorker)).toContain(`${BASE}/page2.html?solo`);
});

test("hiding an element shows an Undo toast; the button restores it", async ({ page }) => {
  await open(page, "visual.html");
  await page.click("#p2");
  await type(page, ["v", "d", "Escape"]);
  await expect(page.locator("#p2")).toBeHidden();
  await expect.poll(() => toast(page)).toContain("Hid p#p2");
  await clickToastButton(page);
  await expect(page.locator("#p2")).toBeVisible();
});

test("the toast's Undo refuses if other changes happened since", async ({ page, context, extensionId }) => {
  await open(page, "visual.html");
  await page.click("#p1");
  await type(page, ["v", "d"]);                      // node #1: hide p1
  await expect.poll(() => toast(page)).toContain("Hid p#p1");
  await type(page, ["d"]);                           // node #2: hide p2
  await expect.poll(() => toast(page)).toContain("Hid p#p2");
  // What the first toast's button sends, pressed after the second change:
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/options/options.html`);
  const res = await ext.evaluate(() => chrome.runtime.sendMessage({ type: "undo.revert", id: 1 }));
  expect(res.message).toContain("Other changes happened since");
  await expect(page.locator("#p1")).toBeHidden();    // nothing was undone behind the user's back
});

test("tab overview x on several tabs previews too", async ({ page, context, serviceWorker }) => {
  await open(page);
  await openTabs(context, "x", "y");
  await page.bringToFront();
  await page.keyboard.press("Shift+T");
  await type(page, ["j", "Space", "Space", "x"]);
  await expect.poll(() => preview(page)).toMatchObject({ title: "This will close 2 tabs from the tab list" });
  await page.keyboard.press("Escape");
  expect((await urls(serviceWorker)).length).toBe(3);
});

test.describe("Power User can switch previews off", () => {
  test.use({ pmxSettings: { preset: "power", confirmBulkClose: false } });
  test("no preview, straight to the Undo toast", async ({ page, context, serviceWorker }) => {
    await open(page);
    await openTabs(context, "a", "b");
    await page.bringToFront();
    await ex(page, "tabdo close *page2*");
    await expect.poll(() => urls(serviceWorker)).toEqual([`${BASE}/long.html`]);
    expect(await preview(page)).toBeNull();
    await expect.poll(() => toast(page)).toContain("Closed 2 tabs");
  });
});

test.describe("Classic always previews", () => {
  test.use({ pmxSettings: { preset: "classic", confirmBulkClose: false } });
  test("confirmBulkClose=false is ignored in Classic", async ({ page, context, serviceWorker, extensionId }) => {
    await open(page);
    await openTabs(context, "a", "b");
    const ids = await serviceWorker.evaluate(async () => (await chrome.tabs.query({ url: "*://localhost/page2.html*" })).map((t) => t.id));
    const ext = await context.newPage();
    await ext.goto(`chrome-extension://${extensionId}/options/options.html`);
    const res = await ext.evaluate((tabIds) => chrome.runtime.sendMessage({ type: "tabs.close", tabIds }), ids);
    expect(res.confirm.message).toBe("This will close 2 tabs from the tab list");
    expect((await urls(serviceWorker)).length).toBe(4); // long, 2x page2, options
  });
});
