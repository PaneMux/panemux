// Dev helper: Phase 3 on a real site — record "f<first content link> 3j" + replay from a fresh load.
// usage: node tools/try-phase3.mjs <url> <link-selector>
import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const [url, selector] = process.argv.slice(2);
const ext = path.resolve("extension");
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "pmx-dev-")), {
  channel: "chromium", headless: !process.env.HEADED, viewport: { width: 1280, height: 850 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
const page = ctx.pages()[0];
const ready = () => page.waitForFunction(() => document.querySelector("panemux-hud")?.shadowRoot?.querySelector(".orb"), null, { timeout: 20000 });
const load = async () => { await page.goto(url, { waitUntil: "domcontentloaded" }); await ready(); await page.waitForTimeout(800); await page.mouse.click(5, 300); };
const press = async (...ks) => { for (const k of ks) await page.keyboard.press(k); };
const labelFor = () => page.evaluate((sel) => {
  const t = document.querySelector(sel).getBoundingClientRect();
  const h = [...document.querySelector("panemux-hud").shadowRoot.querySelectorAll(".hint")]
    .find((h) => Math.abs(parseFloat(h.style.left) - Math.max(0, t.left)) < 2 && Math.abs(parseFloat(h.style.top) - Math.max(0, t.top)) < 2);
  return h && h.dataset.label;
}, selector);

await load();
const target = await page.evaluate((s) => document.querySelector(s).href, selector);
await press("q", "a", "f");
await page.waitForTimeout(300);
const label = await labelFor();
await Promise.all([page.waitForURL(target.split("#")[0] + "**"), press(...label.split(""))]);
await ready(); await page.waitForTimeout(500);
await press("3", "j"); await page.waitForTimeout(400);
await press("q"); await page.waitForTimeout(400);
const macro = (await sw.evaluate(() => chrome.storage.local.get("macros"))).macros.a;

await load();
await Promise.all([page.waitForURL(target.split("#")[0] + "**"), press("@", "a")]);
await ready();
await page.waitForFunction(() => scrollY >= 170, null, { timeout: 5000 }).catch(() => {});
console.log(JSON.stringify({ target, steps: macro.steps.map((s) => s.t + (s.command ? ":" + s.command : "")), desc: macro.steps[0].desc, landed: page.url(), scrollY: await page.evaluate(() => scrollY) }, null, 1));
await ctx.close();
