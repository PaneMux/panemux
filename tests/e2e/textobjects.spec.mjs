// Phase 5: text objects ("dap", "yip", "cit", …) in Normal and Visual mode.
import { test, expect, open, hud, mode, toast, type, waitScroll } from "./fixtures.mjs";

const clip = (page) => page.evaluate(() => navigator.clipboard.readText()).then((t) => t.replace(/\r\n/g, "\n"));

// Put the "cursor" somewhere: a find would do this; so does selecting text.
const cursorAt = (page, sel) => page.evaluate((s) => {
  const r = document.createRange();
  r.selectNodeContents(document.querySelector(s));
  r.collapse(true);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
}, sel);

const selRect = (page) => hud(page, (r) => {
  const b = r.querySelector(".vsel");
  return b && { left: parseFloat(b.style.left) + 2, top: parseFloat(b.style.top) + 2, width: parseFloat(b.style.width) - 4, height: parseFloat(b.style.height) - 4 };
});
async function expectSelected(page, selector) {
  await expect.poll(async () => {
    const a = await selRect(page);
    const b = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }, selector);
    return !!a && ["left", "top", "width", "height"].every((k) => Math.abs(a[k] - b[k]) < 1.5);
  }, { message: `selection on ${selector}` }).toBe(true);
}

test.describe("yank", () => {
  test("yap copies the paragraph under the cursor as Markdown, yip its plain text", async ({ page }) => {
    await open(page, "textobjects.html");
    await cursorAt(page, "#kw");
    await type(page, ["y", "a", "p"]);
    await expect.poll(() => toast(page)).toContain("Copied paragraph as Markdown");
    expect(await clip(page)).toBe("PaneMux treats the page like a document. The **needle** is in this paragraph.");
    await type(page, ["y", "i", "p"]);
    await expect.poll(() => toast(page)).toContain("13 words of paragraph text");
    expect(await clip(page)).toBe("PaneMux treats the page like a document. The needle is in this paragraph.");
    expect(await page.evaluate(() => window.pageKeys)).toEqual([]); // nothing leaked to the page
  });

  test("after a find, yap copies the paragraph with the match", async ({ page }) => {
    await open(page, "textobjects.html");
    await page.keyboard.press("/");
    await page.keyboard.type("happens");
    await page.keyboard.press("Enter");
    await type(page, ["y", "a", "p"]);
    await expect.poll(() => clip(page)).toBe("Press a key and something happens.");
  });

  test("yat copies the element, 2yat its parent; yas the section; yal the list; yar the row", async ({ page }) => {
    await open(page, "textobjects.html");
    await cursorAt(page, "#em-two");
    await type(page, ["y", "a", "t"]);
    await expect.poll(() => clip(page)).toBe("*steps*");
    await type(page, ["2", "y", "a", "t"]);
    await expect.poll(() => clip(page)).toBe("Two *steps*"); // the <li>
    await type(page, ["y", "a", "l"]);
    await expect.poll(() => clip(page)).toBe("- One step\n- Two *steps*");
    await cursorAt(page, "#cell-1");
    await type(page, ["y", "i", "r"]);
    await expect.poll(() => clip(page)).toBe("yap\tcopy");
    await type(page, ["y", "a", "s"]);
    await expect.poll(() => clip(page)).toContain("Press a key and something happens.\n\n- One step");
  });

  test("yah copies a heading and what follows it, up to the next heading at its level", async ({ page }) => {
    await open(page, "textobjects.html");
    await cursorAt(page, "#p-usage");
    await type(page, ["y", "a", "h"]);
    await expect.poll(() => clip(page)).toMatch(/^## Usage\n\nPress a key and something happens\.\n\n- One step/);
    expect(await clip(page)).not.toContain("The end");
    await type(page, ["y", "i", "h"]);
    await expect.poll(() => clip(page)).toMatch(/^Press a key/);
    // an h1's section runs over its h2s
    await cursorAt(page, "#p-second");
    await type(page, ["y", "a", "h"]);
    await expect.poll(() => clip(page)).toMatch(/^# Introduction[\s\S]*## Usage[\s\S]*## The end/);
  });

  test("div soup still has paragraphs: the nearest block with text", async ({ page }) => {
    await open(page, "textobjects.html");
    await cursorAt(page, "#soup-inner");
    await type(page, ["y", "i", "p"]);
    await expect.poll(() => clip(page)).toBe("Div soup text with no paragraph tags.");
  });

  test('"a yap puts it in register a', async ({ page }) => {
    await open(page, "textobjects.html");
    await cursorAt(page, "#p-usage");
    await type(page, ['"', "a", "y", "a", "p"]);
    await expect.poll(() => toast(page)).toContain('into "a');
  });

  test("with nothing selected, the cursor is whatever is mid-screen", async ({ page }) => {
    await open(page, "textobjects.html");
    await page.evaluate(() => { document.getElementById("p-intro").style.marginTop = "300px"; getSelection().removeAllRanges(); });
    await type(page, ["y", "a", "p"]);
    await expect.poll(() => clip(page)).toContain("PaneMux treats the page");
  });
});

test.describe("delete", () => {
  test("dap hides the paragraph; u brings it back; the toast has Undo", async ({ page }) => {
    await open(page, "textobjects.html");
    await cursorAt(page, "#kw");
    await type(page, ["d", "a", "p"]);
    await expect(page.locator("#p-intro")).toBeHidden();
    await expect.poll(() => toast(page)).toContain("Hid paragraph");
    expect(await hud(page, (r) => r.querySelector(".toast.show button")?.textContent)).toBe("Undo");
    await page.keyboard.press("u");
    await expect(page.locator("#p-intro")).toBeVisible();
    expect(await page.evaluate(() => document.getElementById("p-intro").getAttribute("style"))).toBeNull();
  });

  test("d still scrolls half a page, instantly — and dap leaves the scroll where it was", async ({ page }) => {
    await open(page, "textobjects.html");
    const half = await page.evaluate(() => innerHeight / 2);
    await page.keyboard.press("d");
    expect(await waitScroll(page, (y) => Math.abs(y - half) <= 1)).toBeCloseTo(half, -1); // no waiting for a/i
    await page.evaluate(() => scrollTo(0, 0));
    await cursorAt(page, "#p-second");
    await type(page, ["d", "a", "p"]);
    await expect(page.locator("#p-second")).toBeHidden();
    expect(await waitScroll(page, (y) => y === 0)).toBe(0);
  });

  test("dah hides a heading's whole section as one undo step", async ({ page }) => {
    await open(page, "textobjects.html");
    await cursorAt(page, "#p-usage");
    await type(page, ["d", "a", "h"]);
    for (const id of ["#h-usage", "#sec-usage"]) await expect(page.locator(id)).toBeHidden();
    await expect(page.locator("#h-end")).toBeVisible();
    await page.keyboard.press("u");
    for (const id of ["#h-usage", "#sec-usage"]) await expect(page.locator(id)).toBeVisible();
  });

  test("dip empties the paragraph but keeps its box; u restores the text", async ({ page }) => {
    await open(page, "textobjects.html");
    await cursorAt(page, "#p-usage");
    await type(page, ["d", "i", "p"]);
    await expect(page.locator("#p-usage")).toHaveText("");
    await expect(page.locator("#p-usage")).toBeAttached();
    await expect.poll(() => toast(page)).toContain("Cleared paragraph");
    await page.keyboard.press("u");
    await expect(page.locator("#p-usage")).toHaveText("Press a key and something happens.");
  });
});

test.describe("change", () => {
  test("cit edits the element in place; Esc finishes; u undoes the edit", async ({ page }) => {
    await open(page, "textobjects.html");
    await cursorAt(page, "#p-usage");
    await type(page, ["c", "i", "t"]);
    expect(await mode(page)).toBe("insert");
    await page.keyboard.type("Rewritten by hand");
    await page.keyboard.press("Escape");
    expect(await mode(page)).toBe("normal");
    await expect(page.locator("#p-usage")).toHaveText("Rewritten by hand");
    expect(await page.evaluate(() => document.getElementById("p-usage").hasAttribute("contenteditable"))).toBe(false);
    await expect.poll(() => toast(page)).toContain("Edited element");
    await page.keyboard.press("u");
    await expect(page.locator("#p-usage")).toHaveText("Press a key and something happens.");
  });

  test("Esc without typing changes nothing and records nothing", async ({ page, serviceWorker }) => {
    await open(page, "textobjects.html");
    await cursorAt(page, "#p-usage");
    await type(page, ["c", "i", "p"]);
    await page.keyboard.press("Escape");
    await expect(page.locator("#p-usage")).toHaveText("Press a key and something happens.");
    const nodes = await serviceWorker.evaluate(async () => Object.keys((await chrome.storage.session.get("undoTree")).undoTree?.nodes || {}).length);
    expect(nodes).toBeLessThanOrEqual(1); // just the root
  });
});

test.describe("visual mode", () => {
  test("ap / as / at select outward; asking again grows the selection; it goes in", async ({ page }) => {
    await open(page, "textobjects.html");
    await page.click("#em-two");
    await page.keyboard.press("v");
    await expectSelected(page, "#em-two");
    await type(page, ["a", "p"]);
    await expectSelected(page, "#li-two");
    await type(page, ["a", "l"]);
    await expectSelected(page, "#steps");
    await type(page, ["a", "s"]);
    await expectSelected(page, "#sec-usage");
    await type(page, ["a", "s"]); // again: the next section out
    await expectSelected(page, "#art");
    await type(page, ["i", "t"]); // inner: first child
    await expectSelected(page, "#h-intro");
    await page.keyboard.press("Escape");
  });

  test("v then c edits the selection in place", async ({ page }) => {
    await open(page, "textobjects.html");
    await page.click("#li-one");
    await type(page, ["v", "c"]);
    expect(await mode(page)).toBe("insert");
    await page.keyboard.type("First");
    await page.keyboard.press("Escape");
    await expect(page.locator("#li-one")).toHaveText("First");
  });
});

test.describe("macros and presets", () => {
  test("text objects replay from a macro", async ({ page }) => {
    await open(page, "textobjects.html");
    await cursorAt(page, "#li-one");
    await type(page, ["q", "a", "d", "a", "p", "q"]);
    await expect(page.locator("#li-one")).toBeHidden();
    await cursorAt(page, "#li-two");
    await type(page, ["@", "a"]);
    await expect(page.locator("#li-two")).toBeHidden();
    expect(await waitScroll(page, (y) => y === 0)).toBe(0); // the eager d scroll was taken back
  });

  test.describe("Classic", () => {
    test.use({ pmxSettings: {} });
    test("text objects are off; d is plain half-page down", async ({ page }) => {
      await open(page, "textobjects.html");
      await cursorAt(page, "#p-intro");
      const half = await page.evaluate(() => innerHeight / 2);
      await type(page, ["d", "a", "p"]);
      await expect(page.locator("#p-intro")).toBeVisible();
      expect(await waitScroll(page, (y) => Math.abs(y - half) <= 1)).toBeCloseTo(half, -1);
      expect(await page.evaluate(() => window.pageKeys)).toEqual(["a", "p"]);
    });
  });
});
