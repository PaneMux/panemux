// Dev helper: Phase 2 on a real site — Visual select + Markdown yank + reader + palette.
// usage: node tools/try-phase2.mjs <url> <name>
import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const [url, name = "site"] = process.argv.slice(2);
const ext = path.resolve("extension");
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "pmx-dev-")), {
  channel: "chromium", headless: !process.env.HEADED, viewport: { width: 1280, height: 850 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(url).origin });
// A fresh profile opens the tutorial in front; close it so keys reach our page.
await new Promise((r) => setTimeout(r, 1500));
for (const t of ctx.pages()) if (t.url().includes("/tutorial/")) await t.close();
const page = ctx.pages()[0] || (await ctx.newPage());
await page.bringToFront();
const errors = [];
page.on("console", (m) => { if (/Vimium\+\+/.test(m.text())) errors.push(m.text()); });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector("panemux-hud")?.shadowRoot?.querySelector(".strip, .pill"));
await page.waitForTimeout(1200);
const q = (fn) => page.evaluate(`(${fn})(document.querySelector("panemux-hud").shadowRoot)`);
await page.mouse.click(640, 500);
if ((await q((r) => r.querySelector(".strip, .pill").dataset.mode)) !== "normal") await page.keyboard.press("Escape");
const out = {};
await page.keyboard.press("v");
out.start = await q((r) => r.querySelector(".vsel-label")?.textContent);
await page.keyboard.press("h"); await page.keyboard.press("h");
out.afterHH = await q((r) => r.querySelector(".vsel-label")?.textContent);
await page.screenshot({ path: `test-results/p2-${name}-visual.png` });
await page.keyboard.press("y"); await page.waitForTimeout(300);
const md = await page.evaluate(() => navigator.clipboard.readText());
out.mdChars = md.length;
out.mdHead = md.slice(0, 300);
await page.keyboard.press("Shift+>"); await page.waitForTimeout(300);
await page.screenshot({ path: `test-results/p2-${name}-reader.png` });
await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
await page.keyboard.press(":"); await page.keyboard.type("rg"); await page.waitForTimeout(200);
out.paletteTop = await q((r) => r.querySelector(".suggestions li")?.dataset.name);
await page.keyboard.press("Enter"); await page.waitForTimeout(400);
out.regShown = await q((r) => !!r.querySelector(".output"));
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
await ctx.close();
