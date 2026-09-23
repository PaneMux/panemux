// Settings page: preset cards, search, per-key remapping with reset, live apply.
import { test, expect, open, hud, mode, scrollY, type, waitScroll } from "./fixtures.mjs";

async function settings(context, extensionId) {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/options/options.html`);
  await p.waitForSelector("#keys tr");
  return p;
}
const stored = (sw, keys) => sw.evaluate((k) => chrome.storage.sync.get(k), keys);

test.describe("fresh install", () => {
  test.use({ pmxSettings: {} });

  test("Classic is the default preset and is shown first as a selected card", async ({ context, extensionId }) => {
    const s = await settings(context, extensionId);
    expect(await s.locator(".preset").evaluateAll((els) => els.map((e) => e.dataset.preset))).toEqual(["classic", "power", "custom"]);
    await expect(s.locator(".preset.selected")).toHaveAttribute("data-preset", "classic");
    await expect(s.locator("#features")).toBeHidden();
    await expect(s.locator("#confirmBulkClose")).toBeDisabled(); // previews can't be switched off in Classic
    await s.screenshot({ path: "test-results/settings-classic.png", fullPage: true });
  });

  test("picking Power User turns the extra features on in open tabs", async ({ page, context, extensionId, serviceWorker }) => {
    await open(page);
    await page.keyboard.press("v");
    expect(await mode(page)).toBe("normal"); // Visual is off in Classic
    const s = await settings(context, extensionId);
    await s.click('.preset[data-preset="power"]');
    await expect(s.locator(".preset.selected")).toHaveAttribute("data-preset", "power");
    expect((await stored(serviceWorker, "preset")).preset).toBe("power");
    await page.bringToFront();
    await page.keyboard.press("v");
    await expect.poll(() => mode(page)).toBe("visual");
  });

  test("Custom starts from Classic and lets you pick features", async ({ page, context, extensionId, serviceWorker }) => {
    const s = await settings(context, extensionId);
    await s.click('.preset[data-preset="custom"]');
    await expect(s.locator("#features")).toBeVisible();
    await expect(s.locator("#feature-visual")).not.toBeChecked();
    await s.check("#feature-commandBar");
    await expect.poll(async () => (await stored(serviceWorker, "features")).features.commandBar).toBe(true);
    await open(page);
    await page.keyboard.press(":");
    expect(await mode(page)).toBe("command");
    await page.keyboard.press("Escape");
    await page.keyboard.press("v");
    expect(await mode(page)).toBe("normal");
  });

  test("after ~3 days of use Classic users see a 'Try Power User' suggestion", async ({ context, extensionId, serviceWorker }) => {
    let s = await settings(context, extensionId);
    await expect(s.locator("#power-nudge")).toBeHidden();
    await serviceWorker.evaluate(() => chrome.storage.local.set({ usageDays: ["2026-09-20", "2026-09-21", "2026-09-22"] }));
    s = await settings(context, extensionId);
    await expect(s.locator("#power-nudge")).toBeVisible();
    await s.click("#dismiss-nudge");
    await expect(s.locator("#power-nudge")).toBeHidden();
  });
});

test.describe("keys", () => {
  test("search filters keys and settings", async ({ context, extensionId }) => {
    const s = await settings(context, extensionId);
    await s.fill("#search", "tab");
    const texts = await s.locator("#keys tr:not(.group) .d").allTextContents();
    expect(texts.length).toBeGreaterThan(2);
    for (const t of texts) expect(t.toLowerCase()).toContain("tab");
    await expect(s.locator('label.row:has(#smoothScroll)')).toBeHidden();
    await s.fill("#search", "scroll");
    await expect(s.locator('label.row:has(#smoothScroll)')).toBeVisible();
  });

  test("remap a key: default shown, works in pages, reset brings it back", async ({ page, context, extensionId, serviceWorker }) => {
    const s = await settings(context, extensionId);
    const row = s.locator('#keys tr[data-id="normal:j"]');
    await row.locator("input").fill("e");
    await row.locator("input").press("Enter");
    await expect(row.locator(".def")).toHaveText("default: j");
    await expect(row.locator(".reset")).toBeEnabled();
    expect((await stored(serviceWorker, "keyOverrides")).keyOverrides).toEqual({ "normal:j": "e" });

    await open(page);
    await page.keyboard.press("e");
    expect(await waitScroll(page, (y) => y === 60)).toBe(60);
    await page.keyboard.press("j"); // j is free now: goes to the page
    await page.waitForTimeout(200);
    expect(await scrollY(page)).toBe(60);
    await page.keyboard.press("?");
    expect(await hud(page, (r) => [...r.querySelectorAll('.help-row[data-command="scrollDown"] kbd')].map((k) => k.textContent))).toContain("e");
    await page.keyboard.press("Escape");

    await s.bringToFront();
    await s.locator('#keys tr[data-id="normal:j"] .reset').click();
    await expect(s.locator('#keys tr[data-id="normal:j"] input')).toHaveValue("j");
    expect((await stored(serviceWorker, "keyOverrides")).keyOverrides).toEqual({});
    await page.bringToFront();
    await page.keyboard.press("j");
    expect(await waitScroll(page, (y) => y === 120)).toBe(120);
  });

  test("a key already in use is refused", async ({ context, extensionId, serviceWorker }) => {
    const s = await settings(context, extensionId);
    const row = s.locator('#keys tr[data-id="normal:j"]');
    await row.locator("input").fill("k");
    await row.locator("input").press("Enter");
    await expect(s.locator("#status")).toContainText("k is already used for “Scroll up”");
    expect((await stored(serviceWorker, "keyOverrides")).keyOverrides ?? {}).toEqual({}); // nothing saved
  });

  test("an empty key switches the binding off", async ({ page, context, extensionId }) => {
    const s = await settings(context, extensionId);
    const row = s.locator('#keys tr[data-id="normal:f"]');
    await row.locator("input").fill("");
    await row.locator("input").press("Enter");
    await expect(s.locator("#status")).toContainText("switched off");
    await open(page);
    await page.keyboard.press("f");
    expect(await mode(page)).toBe("normal");
    expect(await page.evaluate(() => window.pageKeys)).toEqual(["f"]);
  });
});

test.describe("other settings", () => {
  test("paused sites are listed and can be resumed", async ({ page, context, extensionId, serviceWorker }) => {
    await serviceWorker.evaluate(() => chrome.storage.sync.set({ pausedSites: ["localhost", "mail.example.com"] }));
    const s = await settings(context, extensionId);
    await expect(s.locator("#sites li")).toHaveCount(2);
    await s.locator('#sites li[data-site="localhost"] button').click();
    await expect.poll(async () => (await stored(serviceWorker, "pausedSites")).pausedSites).toEqual(["mail.example.com"]);
    await open(page);
    await page.keyboard.press("j");
    await expect.poll(() => scrollY(page)).toBe(60);
  });

  test("the global switch turns PaneMux off everywhere", async ({ page, context, extensionId }) => {
    await open(page);
    const s = await settings(context, extensionId);
    await s.uncheck("#enabled");
    await expect.poll(() => page.evaluate(() => !!document.querySelector("panemux-hud"))).toBe(false);
    await s.check("#enabled");
    await expect.poll(() => page.evaluate(() => !!document.querySelector("panemux-hud"))).toBe(true);
  });

  test("Run the tutorial again opens it", async ({ context, extensionId }) => {
    const s = await settings(context, extensionId);
    const [t] = await Promise.all([context.waitForEvent("page"), s.click("#run-tutorial")]);
    await t.waitForURL(/tutorial\/tutorial\.html$/);
  });

  test("the options page itself isn't taken over by PaneMux", async ({ context, extensionId }) => {
    const s = await settings(context, extensionId);
    expect(await s.evaluate(() => !!document.querySelector("panemux-hud"))).toBe(false);
    await s.keyboard.press("j"); // no scrolling key handler on the settings page
    expect(await s.evaluate(() => document.activeElement.tagName)).not.toBe("PANEMUX-HUD");
  });
});
