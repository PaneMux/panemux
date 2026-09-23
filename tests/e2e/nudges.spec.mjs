// Mode-switch hints (first 5 times per mode) and the "stuck" nudge.
import { test, expect, open, hud, mode, type } from "./fixtures.mjs";

const hint = (page) => hud(page, (r) => { const h = r.querySelector(".modehint"); return h && !h.hidden ? h.textContent : null; });

test("entering Insert shows a short hint next to the strip, then it fades", async ({ page }) => {
  await open(page);
  await page.click("#text-input");
  expect(await mode(page)).toBe("insert");
  await expect.poll(() => hint(page)).toBe("Insert mode — typing goes to the page. Esc to exit");
  await page.screenshot({ path: "test-results/nudge-insert.png" });
  await expect.poll(() => hint(page), { timeout: 5000 }).toBeNull();
});

test("each mode's hint stops after 5 showings, remembered across pages", async ({ page, serviceWorker }) => {
  await serviceWorker.evaluate(() => chrome.storage.local.set({ modeHintCounts: { insert: 4 } }));
  await open(page);
  await page.keyboard.press("i");
  await expect.poll(() => hint(page)).toContain("Insert mode");  // 5th time
  await page.keyboard.press("Escape");
  await open(page);                                              // new page load
  await page.keyboard.press("i");
  await page.waitForTimeout(300);
  expect(await hint(page)).toBeNull();                           // retired for good
  expect((await serviceWorker.evaluate(() => chrome.storage.local.get("modeHintCounts"))).modeHintCounts.insert).toBe(5);
  // Other modes still have theirs.
  await page.keyboard.press("Escape");
  await page.keyboard.press("f");
  await expect.poll(() => hint(page)).toBe("Type the letters on a link to click it. Esc to cancel");
});

test("hints can be turned off", async ({ page, serviceWorker }) => {
  await serviceWorker.evaluate(() => chrome.storage.sync.set({ modeHints: false }));
  await open(page);
  await page.keyboard.press("i");
  await page.waitForTimeout(300);
  expect(await hint(page)).toBeNull();
});

test("stuck in Visual mode: stray keys trigger one gentle 'Esc' nudge", async ({ page, serviceWorker }) => {
  await serviceWorker.evaluate(() => chrome.storage.sync.set({ modeHints: false }));
  await open(page, "visual.html");
  await page.click("#p1");
  await page.keyboard.press("v");
  await type(page, ["z", "x", "w", "e", "r", "t"]);
  await expect.poll(() => hint(page)).toBe("Press Esc to return to Normal mode");
});

test("typing words at the page in Normal mode suggests how to type instead", async ({ page, serviceWorker }) => {
  await serviceWorker.evaluate(() => chrome.storage.sync.set({ modeHints: false }));
  await open(page);
  await type(page, ["w", "e", "o", "w", "e", "o"]); // none of these are bound
  await expect.poll(() => hint(page)).toContain("Click a text box (or press gi) to type");
});

test("a few stray keys don't nag", async ({ page, serviceWorker }) => {
  await serviceWorker.evaluate(() => chrome.storage.sync.set({ modeHints: false }));
  await open(page);
  await type(page, ["w", "e", "o"]);
  await page.waitForTimeout(300);
  expect(await hint(page)).toBeNull();
});
