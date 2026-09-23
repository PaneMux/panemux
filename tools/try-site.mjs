// Dev helper: load the extension, visit a real site, exercise keys, screenshot.
// usage: node tools/try-site.mjs <url> <name>
import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const [url, name = "site"] = process.argv.slice(2);
const ext = path.resolve("extension");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pmx-dev-"));
const ctx = await chromium.launchPersistentContext(dir, {
  channel: "chromium", headless: !process.env.HEADED, viewport: { width: 1280, height: 850 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
// A fresh profile opens the tutorial in front; close it so keys reach our page.
await new Promise((r) => setTimeout(r, 1500));
for (const t of ctx.pages()) if (t.url().includes("/tutorial/")) await t.close();
const page = ctx.pages()[0] || (await ctx.newPage());
await page.bringToFront();
const errors = [];
page.on("console", (m) => { if (/Vimium\+\+|pmx/i.test(m.text()) || m.type() === "error") errors.push(`${m.type()}: ${m.text()}`); });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector("panemux-hud")?.shadowRoot?.querySelector(".strip, .pill"), null, { timeout: 15000 });
await page.waitForTimeout(1500);
const q = (fn) => page.evaluate(`(${fn})(document.querySelector("panemux-hud").shadowRoot)`);
const out = {};
out.mode = await q((r) => r.querySelector(".strip, .pill").dataset.mode);
out.font = await page.evaluate(async () => { try { await document.fonts.load('700 12px "PaneMux JetBrains Mono"'); } catch (e) { return "err " + e; } return document.fonts.check('700 12px "PaneMux JetBrains Mono"'); });
await page.mouse.click(5, 400); // focus page without hitting links
if (out.mode === "insert") await page.keyboard.press("Escape");
const y0 = await page.evaluate(() => scrollY);
await page.keyboard.press("j"); await page.keyboard.press("j"); await page.waitForTimeout(500);
out.jScrolled = (await page.evaluate(() => scrollY)) - y0;
await page.keyboard.press("f"); await page.waitForTimeout(300);
out.hints = await q((r) => r.querySelectorAll(".hint").length);
await page.screenshot({ path: `test-results/site-${name}-hints.png` });
await page.keyboard.press("Escape");
await page.keyboard.press("/"); await page.keyboard.type(process.env.Q || "the"); await page.waitForTimeout(400);
out.find = await q((r) => r.querySelector(".findbar .count").textContent);
await page.screenshot({ path: `test-results/site-${name}-find.png` });
await page.keyboard.press("Enter");
await page.keyboard.press("n"); await page.waitForTimeout(200);
out.toastAfterN = await q((r) => r.querySelector(".toast").textContent);
out.errors = errors.slice(0, 10);
console.log(JSON.stringify(out, null, 1));
await ctx.close();
