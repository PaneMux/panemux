// Renders the PaneMux icons: a dark rounded tile with a "P" and a small mode
// dot. The "off" set greys the dot for the paused/disabled state. Also writes
// the store listing icons (store/amo/icon-*.png) from the same drawing.
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "extension", "icons");
const store = path.join(root, "store", "amo");
const browser = await chromium.launch();
const page = await browser.newPage();

// [variant, size, file]
const jobs = [];
for (const variant of ["", "-off"]) {
  for (const size of [16, 32, 48, 96, 128]) jobs.push([variant, size, path.join(out, `icon${variant}${size}.png`)]);
}
for (const size of [64, 128, 512]) jobs.push(["", size, path.join(store, `icon-${size}.png`)]);

for (const [variant, size, file] of jobs) {
  const dot = variant ? "#52525B" : "#34D399";
  const text = variant ? "#8A8A94" : "#E4E4E7";
  {
    await page.setViewportSize({ width: size, height: size });
    const r = Math.round(size * 0.22);
    const d = Math.max(3, Math.round(size * 0.2));
    await page.setContent(`<html><body style="margin:0;background:transparent">
      <div style="position:relative;width:${size}px;height:${size}px;border-radius:${r}px;background:#16161C;
        box-shadow:inset 0 0 0 ${Math.max(1, size / 32)}px #2A2A33;display:flex;align-items:center;justify-content:center;
        font:600 ${Math.round(size * 0.62)}px/1 'Segoe UI', system-ui, sans-serif;color:${text};letter-spacing:-0.02em">P
        <span style="position:absolute;right:${Math.round(size * 0.14)}px;bottom:${Math.round(size * 0.14)}px;width:${d}px;height:${d}px;border-radius:50%;background:${dot}"></span>
      </div></body></html>`);
    await page.screenshot({ path: file, omitBackground: true });
  }
}
await browser.close();
console.log(`icons written to ${path.relative(root, out)} and ${path.relative(root, store)}`);
