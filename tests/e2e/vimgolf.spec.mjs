// Phase 5: Vimgolf — strokes vs. an estimated mouse-only par, scorecard HUD,
// local leaderboard (optionally synced).
import { test, expect, open, ready, hud, toast, type, waitScroll, BASE } from "./fixtures.mjs";

async function ex(page, text) {
  await page.keyboard.press(":");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

const card = (page) => hud(page, (r) => {
  const p = r.querySelector(".golf");
  if (!p) return null;
  const v = (k) => p.querySelector(`[data-k="${k}"]`).textContent;
  return { strokes: +v("strokes"), par: +v("par"), score: v("score"), verdict: v("verdict"), last: v("last") };
});
const session = (sw) => sw.evaluate(async () => (await chrome.storage.local.get("golfSession")).golfSession || null);

async function startRound(page) {
  await ex(page, "golf");
  await expect.poll(() => toast(page)).toContain("Vimgolf round started");
  await expect.poll(() => card(page)).toMatchObject({ strokes: 0, par: 0, score: "E" });
}

test("a round: j j 3j scores 4 strokes against par 5; the card says 1 under", async ({ page, serviceWorker }) => {
  await open(page);
  await startRound(page);
  await page.screenshot({ path: "test-results/golf-start.png" });
  await type(page, ["j", "j", "3", "j"]);
  await expect.poll(() => card(page)).toMatchObject({ strokes: 4, par: 5, score: "−1", verdict: "under par", last: "last: j · par 3" });
  expect((await session(serviceWorker)).commands).toBe(3);
  await page.keyboard.press("Shift+G");
  await expect.poll(() => card(page)).toMatchObject({ strokes: 5, par: 8, last: "last: G · par 3" });
  await page.screenshot({ path: "test-results/golf-card.png" });
});

test("link hints: f plus the label letters, par 2", async ({ page }) => {
  await open(page);
  await startRound(page);
  await page.keyboard.press("f");
  const labels = await hud(page, (r) => [...r.querySelectorAll(".hint")].map((h) => h.dataset.label));
  const btn = await page.evaluate(() => { const r = document.getElementById("btn").getBoundingClientRect(); return [r.left, r.top]; });
  const label = await hud(page, (r, [x, y]) => [...r.querySelectorAll(".hint")].find((h) => Math.abs(parseFloat(h.style.left) - x) < 2 && Math.abs(parseFloat(h.style.top) - y) < 2).dataset.label, btn);
  expect(labels.length).toBeGreaterThan(1);
  await type(page, label.split(""));
  await expect(page.locator("#btn")).toHaveText("clicked 1");
  await expect.poll(() => card(page)).toMatchObject({ strokes: 1 + label.length, par: 2 });
});

test(": commands score by the tabs they touch, typing included", async ({ page, context, serviceWorker }) => {
  await open(page);
  for (const q of ["a", "b"]) { const p = await context.newPage(); await open(p, `page2.html?${q}`); }
  await page.bringToFront();
  await startRound(page);
  await ex(page, "tabdo pin *page2*"); // 17 chars + : + Enter
  await expect.poll(() => serviceWorker.evaluate(async () => (await chrome.tabs.query({ pinned: true })).length)).toBe(2);
  const text = "tabdo pin *page2*";
  await expect.poll(() => card(page)).toMatchObject({ strokes: text.length + 2, par: 2 * 2 + 1 + text.length, last: "last: :tabdo · par 22" });
});

test("a macro replay scores every step's par for two keys", async ({ page }) => {
  await open(page);
  await startRound(page);
  await type(page, ["q", "a", "j", "j", "q"]);
  await expect.poll(() => card(page)).toMatchObject({ strokes: 5, par: 2 });
  await type(page, ["5", "@", "a"]);
  await waitScroll(page, (y) => y === 60 * 12);
  await expect.poll(() => card(page)).toMatchObject({ strokes: 8, par: 12 });
});

test("the round follows you to the next page", async ({ page }) => {
  await open(page);
  await startRound(page);
  await type(page, ["j", "j"]);
  await expect.poll(async () => (await card(page))?.strokes).toBe(2);
  await page.goto(`${BASE}/page2.html`);
  await ready(page);
  await expect.poll(() => card(page)).toMatchObject({ strokes: 2, par: 2 });
});

test(":golf again ends the round, ranks it, and :golf board lists it", async ({ page, serviceWorker }) => {
  await open(page);
  await startRound(page);
  await type(page, ["5", "j", "Shift+G"]);
  await expect.poll(async () => (await card(page))?.strokes).toBe(3);
  await ex(page, "golf");
  await expect.poll(() => hud(page, (r) => r.querySelector(".output-title")?.textContent)).toMatch(/^Round over: \d+ under par · #1 on your board$/);
  await page.screenshot({ path: "test-results/golf-over.png" });
  expect(await hud(page, (r) => !!r.querySelector(".golf"))).toBe(false);
  expect(await session(serviceWorker)).toBeNull();
  const board = (await serviceWorker.evaluate(() => chrome.storage.local.get("golfBoard"))).golfBoard;
  expect(board).toHaveLength(1);
  expect(board[0]).toMatchObject({ strokes: 3, par: 8 }); // "golf" typing itself isn't scored
  await page.keyboard.press("Escape");
  await ex(page, "golf board");
  await expect.poll(() => hud(page, (r) => [...r.querySelectorAll(".output td")].map((c) => c.textContent))).toEqual(["1", expect.any(String), "3", "8", "−5", "2.7×"]);
  // and synced only when asked
  expect((await serviceWorker.evaluate(() => chrome.storage.sync.get("golfBoard"))).golfBoard).toBeUndefined();
});

test.describe("sync", () => {
  test.use({ pmxSettings: { preset: "power", golfSync: true } });
  test("with golfSync on, finished rounds reach storage.sync", async ({ page, serviceWorker }) => {
    await open(page);
    await startRound(page);
    await page.keyboard.press("j");
    await expect.poll(async () => (await card(page))?.strokes).toBe(1);
    await ex(page, "golf");
    await expect.poll(() => serviceWorker.evaluate(async () => ((await chrome.storage.sync.get("golfBoard")).golfBoard || []).length)).toBe(1);
  });
});

test.describe("switched off", () => {
  test.use({ pmxSettings: { preset: "custom", features: { commandBar: true } } });
  test(":golf explains where to turn it on", async ({ page }) => {
    await open(page);
    await ex(page, "golf");
    await expect.poll(() => toast(page)).toContain("Vimgolf is off");
  });
});
