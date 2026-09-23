// Phase 2 end-to-end: ":" command bar and element Visual mode.
import { test, expect, open, hud, mode, toast, type, BASE } from "./fixtures.mjs";

const palette = (page) => hud(page, (r) => {
  const p = r.querySelector(".palette");
  return p && { value: p.querySelector("input").value, items: [...p.querySelectorAll(".suggestions li")].map((li) => li.dataset.name), selected: p.querySelector("li.selected")?.dataset.name };
});

async function ex(page, text) {
  await page.keyboard.press(":");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

const selRect = (page) => hud(page, (r) => {
  const b = r.querySelector(".vsel");
  return b && { left: parseFloat(b.style.left) + 2, top: parseFloat(b.style.top) + 2, width: parseFloat(b.style.width) - 4, height: parseFloat(b.style.height) - 4 };
});
const elRect = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}, sel);

async function expectSelected(page, selector) {
  await expect.poll(async () => {
    const [a, b] = [await selRect(page), await elRect(page, selector)];
    return !!a && Math.abs(a.left - b.left) < 1.5 && Math.abs(a.top - b.top) < 1.5 && Math.abs(a.width - b.width) < 1.5 && Math.abs(a.height - b.height) < 1.5;
  }, { message: `selection on ${selector}` }).toBe(true);
}

const hintLabelAt = (page, selector) => page.evaluate((sel) => {
  const t = document.querySelector(sel).getBoundingClientRect();
  const h = [...document.querySelector("panemux-hud").shadowRoot.querySelectorAll(".hint")]
    .find((h) => Math.abs(parseFloat(h.style.left) - Math.max(0, t.left)) < 2 && Math.abs(parseFloat(h.style.top) - Math.max(0, t.top)) < 2);
  return h && h.dataset.label;
}, selector);

test.describe("command bar", () => {
  test(": opens palette with glitch-in, cyan CMD orb, Esc closes", async ({ page }) => {
    await open(page);
    await page.keyboard.press(":");
    expect(await mode(page)).toBe("command");
    const s = await hud(page, (r) => ({
      anim: getComputedStyle(r.querySelector(".palette")).animationName,
      label: r.querySelector(".orb").textContent,
    }));
    expect(s.anim).toBe("pmx-glitch-in");
    expect(s.label).toBe("CMD");
    await expect.poll(() => hud(page, (r) => getComputedStyle(r.querySelector(".orb")).borderTopColor)).toBe("rgb(0, 229, 255)");
    await expect.poll(async () => (await palette(page)).items.length).toBe(8);
    await page.waitForTimeout(250);
    await page.screenshot({ path: "test-results/palette.png" });
    await page.keyboard.press("Escape");
    expect(await palette(page)).toBeFalsy();
    expect(await mode(page)).toBe("normal");
  });

  test("fuzzy suggestions, arrow selection, Tab completion", async ({ page }) => {
    await open(page);
    await page.keyboard.press(":");
    await page.keyboard.type("vs");
    await expect.poll(async () => (await palette(page)).items[0]).toBe("vsp");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("tbd");
    await expect.poll(async () => (await palette(page)).selected).toBe("tabdo");
    await page.keyboard.press("Tab");
    expect((await palette(page)).value).toBe("tabdo ");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("b");
    const first = (await palette(page)).items;
    expect(first.length).toBeGreaterThan(1);
    await page.keyboard.press("ArrowDown");
    expect((await palette(page)).selected).toBe(first[1]);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.pageKeys.length)).toBe(0); // typing hidden from the page
  });

  test("unknown command shows an error", async ({ page }) => {
    await open(page);
    await ex(page, "qqq");
    await expect.poll(() => toast(page)).toContain("Not an editor command: qqq");
  });

  test(":reg lists registers after a yank", async ({ page }) => {
    await open(page);
    await type(page, ["y", "y"]);
    await expect.poll(() => toast(page)).toContain("Yanked");
    await ex(page, "reg");
    await expect.poll(() => hud(page, (r) => r.querySelector(".output")?.textContent || "")).toContain(`${BASE}/long.html`);
    const rows = await hud(page, (r) => [...r.querySelectorAll(".output tbody tr")].map((tr) => tr.cells[0].textContent));
    expect(rows).toEqual(['""', '"0']);
    await page.keyboard.press("x"); // any key closes
    expect(await hud(page, (r) => !!r.querySelector(".output"))).toBe(false);
    expect(await page.evaluate(() => window.pageKeys)).toEqual([]);
  });

  test(":bufdo reload reloads every tab", async ({ page, context }) => {
    await open(page);
    const other = await context.newPage();
    await open(other, "page2.html");
    for (const p of [page, other]) await p.evaluate(() => (window.marker = 1));
    await page.bringToFront();
    await ex(page, "bufdo reload");
    for (const p of [page, other]) {
      await expect.poll(() => p.evaluate(() => window.marker).catch(() => "reloading")).toBe(undefined);
    }
  });

  test(":tabdo close <glob> closes matching tabs only (fuzzy name too)", async ({ page, context, serviceWorker }) => {
    await open(page);
    for (const q of ["a", "b"]) { const p = await context.newPage(); await open(p, `page2.html?${q}`); }
    const other = await context.newPage(); await open(other, "long.html?keep");
    await page.bringToFront();
    const count = () => serviceWorker.evaluate(async () => (await chrome.tabs.query({})).length);
    expect(await count()).toBe(4);
    await ex(page, "tbdo close *page2.html*"); // "tbdo" fuzzy-resolves to tabdo
    await expect.poll(count).toBe(2);
    await expect.poll(() => toast(page)).toContain("closed 2 tabs");
  });

  test(":g/pattern/action and :g!/pattern/action", async ({ page, context, serviceWorker }) => {
    await open(page);
    const p2 = await context.newPage(); await open(p2, "page2.html");
    const p3 = await context.newPage(); await open(p3, "visual.html");
    await page.bringToFront();
    const pinned = () => serviceWorker.evaluate(async () => (await chrome.tabs.query({ pinned: true })).map((t) => new URL(t.url).pathname).sort());
    await ex(page, "g/page two|visual/pin");
    await expect.poll(pinned).toEqual(["/page2.html", "/visual.html"]);
    await ex(page, "g!/long/unpin");
    await expect.poll(pinned).toEqual([]);
    await ex(page, "g/(/close");
    await expect.poll(() => toast(page)).toContain("Bad pattern");
  });

});

test.describe("splits", () => {
  test.use({ pmxViewport: null });

  test(":vsp tiles two windows side by side, :sp stacks them", async ({ page, serviceWorker }) => {
    await open(page);
    await serviceWorker.evaluate(async () => {
      const [w] = await chrome.windows.getAll();
      await chrome.windows.update(w.id, { state: "normal", left: 0, top: 0, width: 1400, height: 900 });
    });
    const wins = () => serviceWorker.evaluate(async () => (await chrome.windows.getAll({ populate: true }))
      .map((w) => ({ id: w.id, left: w.left, top: w.top, width: w.width, height: w.height, url: w.tabs[0].url || w.tabs[0].pendingUrl })));
    const W = (await wins())[0];
    const half = Math.floor(W.width / 2);
    await ex(page, "vsp");
    await expect.poll(async () => (await wins()).length).toBe(2);
    await expect.poll(async () => { const [a, b] = await wins(); return [a.width, b.width, b.left - a.left, b.top - a.top, b.height]; }).toEqual([half, W.width - half, half, 0, W.height]);
    await expect.poll(async () => (await wins())[1].url).toBe(`${BASE}/long.html`); // same page by default
    await page.bringToFront();
    const vh = Math.floor(W.height / 2);
    await ex(page, `sp ${BASE}/page2.html`);
    await expect.poll(async () => (await wins()).length).toBe(3);
    await expect.poll(async () => { const all = await wins(); const a = all[0], c = all[2]; return [a.height, c.top - a.top, c.width, c.url]; })
      .toEqual([vh, vh, half, `${BASE}/page2.html`]);
  });
});

test.describe("visual mode", () => {
  test("v selects the clicked element; magenta VIS orb; Esc exits", async ({ page }) => {
    await open(page, "visual.html");
    await page.click("#p2");
    await page.keyboard.press("v");
    expect(await mode(page)).toBe("visual");
    await expectSelected(page, "#p2");
    const s = await hud(page, (r) => ({ label: r.querySelector(".vsel-label").textContent, orb: r.querySelector(".orb").textContent }));
    expect(s.label).toContain("p#p2");
    expect(s.orb).toBe("VIS");
    await expect.poll(() => hud(page, (r) => getComputedStyle(r.querySelector(".orb")).borderTopColor)).toBe("rgb(255, 46, 176)");
    await page.keyboard.press("h");
    await page.waitForTimeout(250);
    await page.screenshot({ path: "test-results/visual.png" });
    await page.keyboard.press("Escape");
    expect(await mode(page)).toBe("normal");
    expect(await hud(page, (r) => !!r.querySelector(".vsel"))).toBe(false);
  });

  test("h/l/j/k walk parent/child/siblings, counts, arrows", async ({ page }) => {
    await open(page, "visual.html");
    await page.click("#p2");
    await page.keyboard.press("v");
    await page.keyboard.press("h");
    await expectSelected(page, "#sec1");
    await page.keyboard.press("l");
    await expectSelected(page, "#p1");
    await page.keyboard.press("j");
    await expectSelected(page, "#p2");
    await page.keyboard.press("k");
    await expectSelected(page, "#p1");
    await type(page, ["2", "j"]);
    await expectSelected(page, "#list");
    await page.keyboard.press("ArrowLeft");
    await expectSelected(page, "#sec1");
    await page.keyboard.press("ArrowDown");
    await expectSelected(page, "#sec2");
    await type(page, ["h", "k", "k"]); // article: prev sibling none -> stays, error toast
    await expectSelected(page, "#art");
    await expect.poll(() => toast(page)).toContain("No previous sibling");
    await page.keyboard.press("Escape");
  });

  test("d hides (soft), u restores", async ({ page }) => {
    await open(page, "visual.html");
    await page.click("#p2");
    await page.keyboard.press("v");
    await page.keyboard.press("d");
    await expect(page.locator("#p2")).toBeHidden();
    await expectSelected(page, "#list"); // selection moves to the next sibling
    await expect.poll(() => toast(page)).toContain("Hid p#p2");
    await page.keyboard.press("u");
    await expect(page.locator("#p2")).toBeVisible();
    await expectSelected(page, "#p2");
    expect(await page.evaluate(() => document.getElementById("p2").getAttribute("style"))).toBeNull();
    await page.keyboard.press("Escape");
  });

  test("y copies the element as clean Markdown, into the \" register", async ({ page }) => {
    await open(page, "visual.html");
    await page.click("#p2");
    await type(page, ["v", "h", "y"]);
    await expect.poll(() => toast(page)).toContain("of Markdown");
    const md = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"); // Windows clipboard uses CRLF
    expect(md).toBe([
      "First **bold** para with [a link](http://localhost:4517/page2.html) and `code()`.",
      "",
      "Second para.",
      "",
      "- One",
      "- Two",
      "  - Nested",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "> Quote",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n"));
    await page.keyboard.press("Escape");
    await ex(page, "reg");
    await expect.poll(() => hud(page, (r) => r.querySelector(".output")?.textContent || "")).toContain("First **bold** para");
  });

  test("> opens the reading pane; Esc returns to Visual", async ({ page }) => {
    await open(page, "visual.html");
    await page.click("#p2");
    await type(page, ["v", "h", "Shift+>"]);
    await expect.poll(() => hud(page, (r) => r.querySelector(".reader-body")?.textContent || "")).toContain("Second para.");
    const r = await hud(page, (r) => ({
      script: !!r.querySelector(".reader-body script"),
      hidden: r.querySelector(".reader-body").textContent.includes("hidden text"),
      href: r.querySelector(".reader-body a").getAttribute("href"),
    }));
    expect(r).toEqual({ script: false, hidden: false, href: `${BASE}/page2.html` });
    await page.waitForTimeout(250);
    await page.screenshot({ path: "test-results/reader.png" });
    await page.keyboard.press("j"); // scrolls the pane, doesn't move the selection
    await expectSelected(page, "#sec1");
    await page.keyboard.press("Escape");
    expect(await hud(page, (r) => !!r.querySelector(".reader"))).toBe(false);
    expect(await mode(page)).toBe("visual");
    await expectSelected(page, "#sec1");
    await page.keyboard.press("Escape");
  });

  test("f in Visual re-picks the selection with hints", async ({ page }) => {
    await open(page, "visual.html");
    await page.click("#p2");
    await page.keyboard.press("v");
    await page.keyboard.press("f");
    expect(await mode(page)).toBe("hints");
    const label = await hintLabelAt(page, "#p3");
    expect(label).toBeTruthy();
    await type(page, label.split(""));
    expect(await mode(page)).toBe("visual");
    await expectSelected(page, "#p3");
    await page.keyboard.press("f");
    await page.keyboard.press("Escape"); // cancel hints -> back to Visual, same selection
    expect(await mode(page)).toBe("visual");
    await expectSelected(page, "#p3");
    await page.keyboard.press("Escape");
  });

  test("v with nothing focused picks the element at the viewport centre", async ({ page }) => {
    await open(page, "visual.html");
    await page.keyboard.press("v");
    expect(await mode(page)).toBe("visual");
    expect(await hud(page, (r) => r.querySelector(".vsel-label").textContent.length)).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
  });
});
