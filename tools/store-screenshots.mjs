// Takes the store listing screenshots (1280x800) with the extension loaded.
//   node tools/store-screenshots.mjs   ->  store/amo/screenshots/*.png
// Needs the test page server (node tests/server.mjs) on port 4517.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ext = path.join(root, "extension");
const out = path.join(root, "store", "amo", "screenshots");
const BASE = "http://localhost:4517";
fs.mkdirSync(out, { recursive: true });

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "pmx-shots-")), {
  channel: "chromium", headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
const id = sw.url().split("/")[2];
await new Promise((r) => setTimeout(r, 1000));
for (const p of ctx.pages()) if (p.url().includes("/tutorial/")) await p.close();
await sw.evaluate(() => chrome.storage.sync.set({ preset: "power", modeHints: false }));
await sw.evaluate(() => chrome.storage.local.set({ modeHintCounts: { insert: 9, visual: 9, command: 9, hints: 9, find: 9, tabs: 9, outline: 9 } }));

const page = ctx.pages()[0] || (await ctx.newPage());
const ready = (p) => p.waitForFunction(() => document.querySelector("panemux-hud")?.shadowRoot?.querySelector(".strip, .pill"));
const shot = async (p, name, wait = 400) => { await p.waitForTimeout(wait); await p.screenshot({ path: path.join(out, `${name}.png`) }); console.log("  ", name); };
const keys = async (p, ks) => { for (const k of ks) await p.keyboard.press(k); };
const demo = async () => { await page.goto(`${BASE}/demo.html`); await ready(page); await page.bringToFront(); await page.evaluate(() => window.focus()); };

// 1. link hints
await demo();
await page.keyboard.press("f");
await shot(page, "1-link-hints");
await page.keyboard.press("Escape");

// 2. command bar, with a few tabs to act on
for (const q of ["news", "docs", "video"]) { const p = await ctx.newPage(); await p.goto(`${BASE}/page2.html?${q}`); }
await demo();
await page.keyboard.press(":");
await shot(page, "2-command-bar");
await page.keyboard.press("Escape");

// 3. Visual mode on a paragraph
await page.evaluate(() => scrollTo(0, 420));
await page.click("h3 + p");
await page.keyboard.press("v");
await shot(page, "3-visual-mode");
await page.keyboard.press("Escape");

// 4. the outline, pinned while reading
await demo();
await keys(page, ["g", "Shift+O", "j", "j", "j"]);
await shot(page, "4-outline");
await keys(page, ["Escape"]);

// 5. text objects (yap) during a Vimgolf round
await demo();
await page.keyboard.press(":");
await page.keyboard.type("golf");
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
await keys(page, ["j", "j", "d", "Shift+G", "g", "g"]);
await page.waitForTimeout(800); // let the scorecard catch up
await page.evaluate(() => {
  const p = document.querySelectorAll("article > p")[1];
  const r = document.createRange(); r.selectNodeContents(p); r.collapse(true);
  getSelection().removeAllRanges(); getSelection().addRange(r);
});
await keys(page, ["y", "a", "p"]);
await shot(page, "5-text-objects-and-vimgolf", 120); // while the copied paragraph is still outlined
await page.keyboard.press(":"); await page.keyboard.type("golf"); await page.keyboard.press("Enter");
await page.waitForTimeout(300);
await page.keyboard.press("Escape");

// 6. help
await demo();
await page.keyboard.press("?");
await shot(page, "6-help");
await page.keyboard.press("Escape");

// 7. tutorial
const t = await ctx.newPage();
await t.goto(`chrome-extension://${id}/tutorial/tutorial.html`);
await t.waitForTimeout(800);
await t.evaluate(() => window.focus());
await keys(t, ["j"]);
await t.waitForTimeout(300);
await t.evaluate(() => scrollTo(0, 0));
await shot(t, "7-tutorial");

// 8. settings
const s = await ctx.newPage();
await s.goto(`chrome-extension://${id}/options/options.html`);
await shot(s, "8-settings");

await ctx.close();
console.log(`screenshots in ${path.relative(root, out)}`);
