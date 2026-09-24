// Phase 5: the minimap — a foldable outline of the page's headings (gO).
import { test, expect, open, hud, mode, type, waitScroll, scrollY } from "./fixtures.mjs";

const outline = (page) => hud(page, (r) => {
  const p = r.querySelector(".minimap");
  if (!p) return null;
  const rows = [...p.querySelectorAll(".minimap-item")];
  return {
    title: p.querySelector(".title").textContent,
    rows: rows.map((li) => li.querySelector(".text").textContent),
    cursor: p.querySelector(".minimap-item.cursor .text")?.textContent || null,
    current: p.querySelector(".minimap-item.current .text")?.textContent || null,
    focused: p.classList.contains("focused"),
    pinned: p.classList.contains("pinned"),
    collapsed: p.classList.contains("collapsed"),
  };
});
const topOf = (page, id) => page.evaluate((i) => Math.round(document.getElementById(i).getBoundingClientRect().top + scrollY), id);
const GAP = 12; // headings land a little below the top edge

test("gO opens the outline of visible headings, nested, with the keyboard", async ({ page }) => {
  await open(page, "outline.html");
  await type(page, ["g", "Shift+O"]);
  expect(await mode(page)).toBe("outline");
  const o = await outline(page);
  expect(o.rows).toEqual(["Field guide", "Birds", "Owls", "Herons", "Fish", "Trout", "Insects", "Appendix"]);
  expect(o).toMatchObject({ title: "Outline · 8", focused: true, cursor: "Field guide", current: "Field guide" });
  expect(await hud(page, (r) => r.querySelector('.minimap-item[data-level="3"]').style.paddingLeft)).toBe("34px");
  await page.screenshot({ path: "test-results/minimap.png" });
  expect(await page.evaluate(() => window.pageKeys.filter((k) => k !== "Shift"))).toEqual([]);
});

test("j / k move and the page follows; Enter stays and closes", async ({ page }) => {
  await open(page, "outline.html");
  await type(page, ["g", "Shift+O", "j", "j"]);
  expect((await outline(page)).cursor).toBe("Owls");
  const owls = await topOf(page, "owls");
  await waitScroll(page, (y) => Math.abs(y - (owls - GAP)) <= 2);
  await page.keyboard.press("k");
  expect((await outline(page)).cursor).toBe("Birds");
  await page.keyboard.press("Enter");
  expect(await outline(page)).toBeNull();
  expect(await mode(page)).toBe("normal");
  const birds = await topOf(page, "birds");
  expect(await waitScroll(page, (y) => Math.abs(y - (birds - GAP)) <= 2)).toBeCloseTo(birds - GAP, -1);
});

test("Esc goes back to where you were", async ({ page }) => {
  await open(page, "outline.html");
  await page.evaluate(() => scrollTo(0, 150));
  await type(page, ["g", "Shift+O", "Shift+G"]);
  expect((await outline(page)).cursor).toBe("Appendix");
  await expect.poll(() => scrollY(page)).toBeGreaterThan(1000);
  await page.keyboard.press("Escape");
  expect(await waitScroll(page, (y) => y === 150)).toBe(150);
  expect(await outline(page)).toBeNull();
});

test("h folds a heading's subsections, l unfolds; h on a leaf goes to its parent", async ({ page }) => {
  await open(page, "outline.html");
  await type(page, ["g", "Shift+O", "j", "j"]); // Owls
  await page.keyboard.press("h");
  expect((await outline(page)).cursor).toBe("Birds");
  await page.keyboard.press("h");
  let o = await outline(page);
  expect(o.rows).toEqual(["Field guide", "Birds", "Fish", "Trout", "Insects", "Appendix"]);
  expect(await hud(page, (r) => r.querySelectorAll(".minimap-item")[1].querySelector(".twisty").textContent)).toBe("▸");
  await page.keyboard.press("j");
  expect((await outline(page)).cursor).toBe("Fish"); // folded rows are skipped
  await page.keyboard.press("k");
  await page.keyboard.press("l");
  o = await outline(page);
  expect(o.rows).toContain("Owls");
  await page.keyboard.press("Escape");
});

test("p pins it: keys go back to the page and it tracks the section you're in", async ({ page }) => {
  await open(page, "outline.html");
  await type(page, ["g", "Shift+O", "p"]);
  expect(await mode(page)).toBe("normal");
  expect(await outline(page)).toMatchObject({ pinned: true, focused: false });
  const fish = await topOf(page, "fish");
  await page.evaluate((y) => scrollTo(0, y), fish);
  await expect.poll(async () => (await outline(page)).current).toBe("Fish");
  await page.keyboard.press("j"); // scrolls the page, not the outline
  await waitScroll(page, (y) => y === fish + 60);
  // clicking a heading in the outline jumps there
  await hud(page, (r) => [...r.querySelectorAll(".minimap-item")].find((li) => li.textContent.includes("Insects")).click());
  const bugs = await topOf(page, "bugs");
  await waitScroll(page, (y) => Math.abs(y - (bugs - GAP)) <= 2);
  expect(await outline(page)).toMatchObject({ pinned: true });
  // gO focuses it again, gO once more closes it
  await type(page, ["g", "Shift+O"]);
  expect(await mode(page)).toBe("outline");
  await type(page, ["g", "Shift+O"]);
  expect(await outline(page)).toBeNull();
});

test("the header button folds a pinned outline down to a slim tab", async ({ page }) => {
  await open(page, "outline.html");
  await type(page, ["g", "Shift+O", "p"]);
  await hud(page, (r) => r.querySelector(".minimap .collapse").click());
  expect((await outline(page)).collapsed).toBe(true);
  await expect.poll(() => hud(page, (r) => Math.round(r.querySelector(".minimap").getBoundingClientRect().width))).toBe(36);
  expect(await hud(page, (r) => r.querySelector(".minimap-tab").textContent)).toBe("Field guide");
  await page.screenshot({ path: "test-results/minimap-collapsed.png" });
  await hud(page, (r) => r.querySelector(".minimap-tab").click());
  expect((await outline(page)).collapsed).toBe(false);
});

test("the outline keeps up with headings added later", async ({ page }) => {
  await open(page, "outline.html");
  await type(page, ["g", "Shift+O", "p"]);
  await page.evaluate(() => { const h = document.createElement("h2"); h.textContent = "Mammals"; document.body.appendChild(h); });
  await expect.poll(async () => (await outline(page)).rows.at(-1)).toBe("Mammals");
});

test(":outline opens it too", async ({ page }) => {
  await open(page, "outline.html");
  await page.keyboard.press(":");
  await page.keyboard.type("outline");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await outline(page))?.focused).toBe(true);
});

test("a page without headings says so", async ({ page }) => {
  await open(page, "app.html");
  await type(page, ["g", "Shift+O"]);
  expect(await hud(page, (r) => r.querySelector(".minimap-empty")?.textContent)).toBe("No headings on this page");
  await page.keyboard.press("Escape");
});

test.describe("Classic", () => {
  test.use({ pmxSettings: {} });
  test("gO is off", async ({ page }) => {
    await open(page, "outline.html");
    await type(page, ["g", "Shift+O"]);
    expect(await outline(page)).toBeNull();
  });
});
