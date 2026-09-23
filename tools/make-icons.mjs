// Renders the PaneMux icon (glowing green orb with "PMX") to PNGs.
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "extension", "icons");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  const glow = Math.max(1, size / 16);
  await page.setContent(`<html><body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px;border-radius:50%;box-sizing:border-box;
      border:${Math.max(1, size / 20)}px solid #39ff14;
      background:radial-gradient(circle at 35% 30%, #1d4d14 0%, #0a0a0f 72%);
      box-shadow:inset 0 0 ${glow * 3}px rgba(57,255,20,.6);
      display:flex;align-items:center;justify-content:center;
      font:700 ${size <= 16 ? 10 : size * 0.3}px/1 Consolas, monospace;color:#39ff14;
      text-shadow:0 0 ${glow * 2}px #39ff14;letter-spacing:-0.04em">${size <= 16 ? "P" : "PMX"}</div></body></html>`);
  await page.screenshot({ path: path.join(out, `icon${size}.png`), omitBackground: true });
}
await browser.close();
console.log("icons written to", out);
