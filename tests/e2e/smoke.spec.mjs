import { test, expect, open, mode, hud } from "./fixtures.mjs";

test("extension loads, status strip shows Normal", async ({ page }) => {
  await open(page);
  expect(await mode(page)).toBe("normal");
  expect(await hud(page, (r) => r.querySelector(".strip .label").textContent)).toBe("Normal");
  await page.screenshot({ path: "test-results/smoke.png" });
});
