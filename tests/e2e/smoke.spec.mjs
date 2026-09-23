import { test, expect, open, mode, hud } from "./fixtures.mjs";

test("extension loads, orb shows Normal", async ({ page }) => {
  await open(page);
  expect(await mode(page)).toBe("normal");
  const label = await hud(page, (r) => r.querySelector(".orb").textContent);
  expect(label).toBe("NOR");
  await page.screenshot({ path: "test-results/smoke.png" });
});
