// Phase 4 end-to-end: undo tree (u / C-r / g- / g+ / panel) and split navigation (W prefix).
import { test, expect, open, ready, hud, mode, toast, type, waitScroll, activeTabUrl, BASE } from "./fixtures.mjs";

async function ex(page, text) {
  await page.keyboard.press(":");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

const tree = (sw) => sw.evaluate(async () => (await chrome.storage.session.get("undoTree")).undoTree);
const urls = (sw) => sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url || t.pendingUrl).sort());

// Commit a text-field edit the way a user does: type, then leave the field.
async function edit(page, sel, value) {
  await page.click(sel);
  await page.fill(sel, value);
  await page.keyboard.press("Tab");
  await page.evaluate(() => document.activeElement.blur());
  await expect.poll(() => mode(page)).toBe("normal");
}

test.describe("undo tree", () => {
  test("closed tab: u reopens, C-r closes again; batched :tabdo close is one node", async ({ page, context, serviceWorker }) => {
    await open(page);
    const p = await context.newPage(); await open(p, "page2.html?a");
    await p.close();
    await expect.poll(async () => (await tree(serviceWorker))?.cur).toBe(1);
    await page.bringToFront();
    await page.keyboard.press("u");
    await expect.poll(() => urls(serviceWorker)).toEqual([`${BASE}/long.html`, `${BASE}/page2.html?a`]);
    await page.bringToFront();
    await page.keyboard.press("Control+r");
    await expect.poll(() => urls(serviceWorker)).toEqual([`${BASE}/long.html`]);
    expect(page.url()).toBe(`${BASE}/long.html`); // C-r didn't reload the page

    for (const q of ["x", "y"]) { const t = await context.newPage(); await open(t, `page2.html?${q}`); }
    await page.bringToFront();
    await ex(page, "tabdo close *page2*");
    await expect.poll(() => urls(serviceWorker)).toEqual([`${BASE}/long.html`]);
    await expect.poll(async () => { const t = await tree(serviceWorker); return t.nodes[t.cur].label; }).toBe("close 2 tabs");
    await page.keyboard.press("u");
    await expect.poll(() => urls(serviceWorker)).toEqual([`${BASE}/long.html`, `${BASE}/page2.html?x`, `${BASE}/page2.html?y`]);
  });

  test("hidden element: Visual d, then u (Normal) restores, C-r hides again", async ({ page }) => {
    await open(page, "form.html");
    await page.click("#p1");
    await type(page, ["v", "d", "Escape"]);
    await expect(page.locator("#p1")).toBeHidden();
    await page.keyboard.press("u");
    await expect(page.locator("#p1")).toBeVisible();
    await expect.poll(() => toast(page)).toContain("undo: hide p#p1");
    await page.keyboard.press("Control+r");
    await expect(page.locator("#p1")).toBeHidden();
  });

  test("form edits: text, textarea, select, checkbox undo/redo; passwords never recorded", async ({ page, serviceWorker }) => {
    await open(page, "form.html");
    await edit(page, "#name", "bob");
    await edit(page, "#bio", "hi there");
    await page.selectOption("#color", "blue");
    await page.check("#agree");
    await edit(page, "#pw", "hunter2");
    await page.evaluate(() => document.activeElement.blur());
    await expect.poll(() => mode(page)).toBe("normal");
    await expect.poll(async () => (await tree(serviceWorker))?.seq).toBe(4);
    const t = await tree(serviceWorker);
    expect(JSON.stringify(t)).not.toContain("hunter2");
    expect(Object.values(t.nodes).map((n) => n.label)).toEqual(["original", "edit input#name", "edit textarea#bio", "edit select#color", "edit input#agree"]);

    const inputsBefore = await page.evaluate(() => window.inputEvents);
    await type(page, ["4", "u"]);
    await expect(page.locator("#name")).toHaveValue("alice");
    await expect(page.locator("#bio")).toHaveValue("hello");
    await expect(page.locator("#color")).toHaveValue("red");
    await expect(page.locator("#agree")).not.toBeChecked();
    expect(await page.evaluate(() => window.inputEvents)).toBeGreaterThan(inputsBefore); // frameworks get input events
    await expect.poll(() => toast(page)).toContain("now at #0");
    await page.keyboard.press("u");
    await expect.poll(() => toast(page)).toContain("Already at oldest change");
    await type(page, ["2", "Control+r"]);
    await expect(page.locator("#name")).toHaveValue("bob");
    await expect(page.locator("#bio")).toHaveValue("hi there");
    await expect(page.locator("#color")).toHaveValue("red");
    // Undo after the page reloads still finds the field (by descriptor).
    await page.reload(); await ready(page);
    await page.fill("#name", "bob"); await page.evaluate(() => document.activeElement.blur());
    await expect.poll(() => mode(page)).toBe("normal");
    await page.keyboard.press("u");
    await expect(page.locator("#bio")).toHaveValue("hello");
  });

  test("branches: undo then edit keeps both; g-/g+ walk time across branches", async ({ page, serviceWorker }) => {
    await open(page, "form.html");
    await edit(page, "#name", "v2");       // #1
    await page.keyboard.press("u");        // back to alice
    await expect(page.locator("#name")).toHaveValue("alice");
    await edit(page, "#name", "v3");       // #2, a second branch off #0
    const t = await tree(serviceWorker);
    expect(t.nodes[0].children).toEqual([1, 2]);

    await type(page, ["g", "-"]);          // state #1 (other branch): v2
    await expect(page.locator("#name")).toHaveValue("v2");
    await type(page, ["g", "-"]);          // original
    await expect(page.locator("#name")).toHaveValue("alice");
    await type(page, ["g", "+"]);          // #1
    await expect(page.locator("#name")).toHaveValue("v2");
    await type(page, ["g", "+"]);          // #2
    await expect(page.locator("#name")).toHaveValue("v3");
    await page.keyboard.press("u");
    await page.keyboard.press("Control+r"); // redo follows the branch we came from (#2)
    await expect(page.locator("#name")).toHaveValue("v3");
  });

  test("U panel: graph of all nodes, click to jump, collapse, persists across pages", async ({ page, serviceWorker }) => {
    await open(page, "form.html");
    await edit(page, "#name", "v2");
    await page.keyboard.press("u");
    await edit(page, "#name", "v3");
    await page.keyboard.press("Shift+U");
    const panel = () => hud(page, (r) => {
      const p = r.querySelector(".undopanel");
      return p && { count: +p.dataset.count, cur: +p.dataset.cur, rows: [...p.querySelectorAll(".rows li")].map((li) => li.textContent), circles: p.querySelectorAll("circle").length, collapsed: p.classList.contains("collapsed"), width: p.getBoundingClientRect().width };
    });
    await expect.poll(async () => (await panel())?.count).toBe(3);
    const pn = await panel();
    expect(pn.circles).toBe(3);
    expect(pn.cur).toBe(2);
    expect(pn.rows[0]).toContain("#2");
    await page.waitForTimeout(200);
    await page.screenshot({ path: "test-results/undopanel.png" });

    // Click node #1 (other branch)
    await page.evaluate(() => document.querySelector("panemux-hud").shadowRoot.querySelector('.undopanel .rows li[data-id="1"]').click());
    await expect(page.locator("#name")).toHaveValue("v2");
    await expect.poll(async () => (await panel()).cur).toBe(1);

    await page.evaluate(() => document.querySelector("panemux-hud").shadowRoot.querySelector(".undopanel .collapse").click());
    await expect.poll(async () => (await panel()).width).toBeLessThan(40);
    await page.goto(`${BASE}/long.html`); await ready(page);
    await expect.poll(async () => (await panel())?.collapsed).toBe(true);
    await ex(page, "undotree"); // toggles off
    await expect.poll(() => panel()).toBeFalsy();
  });

  test("u option: 'scroll' makes u half page up again", async ({ page, context, extensionId }) => {
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId}/options/options.html`);
    await opts.selectOption("#uKey", "scroll");
    await expect(opts.locator("#status")).toHaveText("✓ saved");
    await opts.close();
    await open(page);
    const half = await page.evaluate(() => innerHeight / 2);
    await type(page, ["d", "d"]);
    await waitScroll(page, (y) => Math.abs(y - 2 * half) <= 1);
    await page.keyboard.press("u");
    expect(await waitScroll(page, (y) => Math.abs(y - half) <= 1)).toBeCloseTo(half, -1);
  });
});

test.describe("splits", () => {
  test.use({ pmxViewport: null });

  const wins = (sw) => sw.evaluate(async () => (await chrome.windows.getAll({ populate: true })).map((w) => ({ id: w.id, left: w.left, top: w.top, width: w.width, height: w.height, focused: w.focused, url: w.tabs[0].url || w.tabs[0].pendingUrl })));
  // Headless Chromium marks every window focused and never moves "last focused",
  // so spy on the focus requests PaneMux makes and resolve them to the window's URL.
  const spyFocus = (sw) => sw.evaluate(() => {
    if (globalThis.__focusSpy) return;
    globalThis.__focusSpy = [];
    const orig = chrome.windows.update.bind(chrome.windows);
    chrome.windows.update = (id, info) => { if (info && info.focused) globalThis.__focusSpy.push(id); return orig(id, info); };
  });
  const focusedUrl = (sw) => sw.evaluate(async () => {
    const id = globalThis.__focusSpy[globalThis.__focusSpy.length - 1];
    const w = id && (await chrome.windows.get(id, { populate: true }).catch(() => null));
    return w ? w.tabs.find((t) => t.active).url : null;
  });

  test("W h/l move focus between :vsp windows, Ww cycles, Wc closes and partner re-fills", async ({ page, context, serviceWorker }) => {
    await open(page, "long.html?left");
    await spyFocus(serviceWorker);
    await serviceWorker.evaluate(async () => {
      const [w] = await chrome.windows.getAll();
      await chrome.windows.update(w.id, { state: "normal", left: 0, top: 0, width: 1400, height: 900 });
    });
    const [right] = await Promise.all([context.waitForEvent("page"), ex(page, `vsp ${BASE}/long.html?right`)]);
    await ready(right);
    await expect.poll(async () => (await wins(serviceWorker)).length).toBe(2);

    await right.bringToFront();
    await type(right, ["Shift+W", "h"]);
    await expect.poll(() => focusedUrl(serviceWorker)).toMatch(/\?left$/);
    await page.bringToFront();
    await type(page, ["Shift+W", "h"]); // nothing further left
    await expect.poll(() => toast(page)).toContain("No split in that direction");
    await type(page, ["Shift+W", "l"]);
    await expect.poll(() => focusedUrl(serviceWorker)).toMatch(/\?right$/);
    await right.bringToFront();
    await type(right, ["Shift+W", "w"]);
    await expect.poll(() => focusedUrl(serviceWorker)).toMatch(/\?left$/);

    await right.bringToFront();
    await type(right, ["Shift+W", "c"]);
    await expect.poll(async () => (await wins(serviceWorker)).length).toBe(1);
    await expect.poll(async () => { const [w] = await wins(serviceWorker); return [w.left, w.width, w.url]; }).toEqual([0, 1400, `${BASE}/long.html?left`]);
    // Closing the split window isn't an undoable "closed tab".
    const t = await tree(serviceWorker);
    expect(t ? t.seq : 0).toBe(0);
  });

  test(":sp stacks; W j/k move focus vertically; :close closes the split", async ({ page, context, serviceWorker }) => {
    await open(page, "long.html?top");
    await spyFocus(serviceWorker);
    await serviceWorker.evaluate(async () => {
      const [w] = await chrome.windows.getAll();
      await chrome.windows.update(w.id, { state: "normal", left: 0, top: 0, width: 1200, height: 1000 });
    });
    const [bottom] = await Promise.all([context.waitForEvent("page"), ex(page, `sp ${BASE}/long.html?bottom`)]);
    await ready(bottom);
    await bottom.bringToFront();
    await type(bottom, ["Shift+W", "k"]);
    await expect.poll(() => focusedUrl(serviceWorker)).toMatch(/\?top$/);
    await page.bringToFront();
    await type(page, ["Shift+W", "j"]);
    await expect.poll(() => focusedUrl(serviceWorker)).toMatch(/\?bottom$/);
    await page.bringToFront();
    await page.keyboard.press(":");
    await page.keyboard.type("close");
    await page.keyboard.press("Enter").catch(() => {}); // this window closes mid-press
    await expect.poll(async () => (await wins(serviceWorker)).map((w) => [w.url, w.height])).toEqual([[`${BASE}/long.html?bottom`, 1000]]);
  });
});
