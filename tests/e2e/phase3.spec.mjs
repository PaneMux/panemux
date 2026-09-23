// Phase 3 end-to-end: macros (q/@) and tab registers ("ay / "ap in the T overview).
import { test, expect, open, ready, hud, mode, scrollY, toast, type, waitScroll, activeTabUrl, BASE } from "./fixtures.mjs";

const hintFor = (page, selector) => page.evaluate((sel) => {
  const t = document.querySelector(sel).getBoundingClientRect();
  const h = [...document.querySelector("panemux-hud").shadowRoot.querySelectorAll(".hint:not(.hide)")]
    .find((h) => Math.abs(parseFloat(h.style.left) - Math.max(0, t.left)) < 2 && Math.abs(parseFloat(h.style.top) - Math.max(0, t.top)) < 2);
  return h && h.dataset.label;
}, selector);

const macros = (sw) => sw.evaluate(async () => (await chrome.storage.local.get("macros")).macros || {});
const recBadge = (page) => hud(page, (r) => { const b = r.querySelector(".rec"); return b && !b.hidden ? b.textContent : null; });

async function recordMacro(page, sw, reg, fn) {
  await type(page, ["q", reg]);
  await expect.poll(() => recBadge(page)).toBe(`REC @${reg.toLowerCase()}`);
  await fn();
  await page.keyboard.press("q");
  await expect.poll(async () => !!(await macros(sw))[reg.toLowerCase()]).toBe(true);
}

async function ex(page, text) {
  await page.keyboard.press(":");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

test.describe("macros", () => {
  test("qa…q records, REC badge, @a / 3@a / @@ replay", async ({ page, serviceWorker }) => {
    await open(page);
    await recordMacro(page, serviceWorker, "a", async () => {
      await type(page, ["j", "2", "j"]);
      await waitScroll(page, (y) => y === 180);
    });
    expect(await recBadge(page)).toBe(null);
    const m = (await macros(serviceWorker)).a;
    expect(m.keys.join("")).toBe("j2j");
    expect(m.steps).toEqual([
      { t: "cmd", command: "scrollDown", count: null, mode: "normal" },
      { t: "cmd", command: "scrollDown", count: 2, mode: "normal" },
    ]);
    await expect.poll(() => toast(page)).toContain("Recorded @a (2 steps)");

    await type(page, ["@", "a"]);
    expect(await waitScroll(page, (y) => y === 360)).toBe(360);
    await type(page, ["2", "@", "a"]);
    expect(await waitScroll(page, (y) => y === 720)).toBe(720);
    await type(page, ["@", "@"]);
    expect(await waitScroll(page, (y) => y === 900)).toBe(900);
  });

  test("macros survive a reload (chrome.storage.local)", async ({ page, serviceWorker }) => {
    await open(page);
    await recordMacro(page, serviceWorker, "b", () => type(page, ["5", "j"]));
    await page.reload();
    await ready(page);
    await page.evaluate(() => scrollTo(0, 0));
    await type(page, ["@", "b"]);
    expect(await waitScroll(page, (y) => y === 300)).toBe(300);
  });

  test("hint steps replay by element, not label (labels shift between loads)", async ({ page, serviceWorker }) => {
    await open(page, "macro.html");
    await recordMacro(page, serviceWorker, "c", async () => {
      await page.keyboard.press("f");
      await type(page, (await hintFor(page, "#counter")).split(""));
      await expect(page.locator("#counter")).toHaveText("count 1");
    });
    const step = (await macros(serviceWorker)).c.steps[0];
    expect(step.t).toBe("hint");
    expect(step.desc.css).toBe("#counter");

    await open(page, "macro.html?extra=12"); // 12 decoys: every label changes
    await type(page, ["3", "@", "c"]);
    await expect(page.locator("#counter")).toHaveText("count 3");
  });

  test("insert-mode typing is replayed as text", async ({ page, serviceWorker }) => {
    await open(page, "macro.html");
    await recordMacro(page, serviceWorker, "d", async () => {
      await page.keyboard.press("f");
      await type(page, (await hintFor(page, "#field")).split(""));
      expect(await mode(page)).toBe("insert");
      await page.keyboard.type("hi there");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Escape");
    });
    const steps = (await macros(serviceWorker)).d.steps.map((s) => s.t + (s.text ? `:${s.text}` : s.key ? `:${s.key}` : ""));
    expect(steps).toEqual(["hint", "text:hi there", "key:<bs>", "cmd"]);
    await page.fill("#field", "");
    await page.evaluate(() => document.activeElement.blur());
    await expect.poll(() => mode(page)).toBe("normal");
    await type(page, ["@", "d"]);
    await expect(page.locator("#field")).toHaveValue("hi ther");
    await expect.poll(() => mode(page)).toBe("normal");
  });

  test("replay continues across a navigation", async ({ page, serviceWorker }) => {
    await open(page, "macro.html");
    await recordMacro(page, serviceWorker, "e", async () => {
      await page.keyboard.press("f");
      await Promise.all([page.waitForURL(/page2\.html$/), type(page, (await hintFor(page, "#to-page2")).split(""))]);
      await ready(page);
      await expect.poll(() => recBadge(page)).toBe("REC @e"); // still recording on the new page
      await type(page, ["4", "j"]);
      await waitScroll(page, (y) => y === 240);
    });
    await open(page, "macro.html");
    await Promise.all([page.waitForURL(/page2\.html$/), type(page, ["@", "e"])]);
    await ready(page);
    expect(await waitScroll(page, (y) => y === 240)).toBe(240);
  });

  test("replay follows tab switches (J) into the next tab", async ({ page, context, serviceWorker }) => {
    await open(page, "long.html?one");
    const two = await context.newPage();
    await open(two, "long.html?two");
    await page.bringToFront();
    await recordMacro(page, serviceWorker, "f", async () => {
      await page.keyboard.press("Shift+J");
      await expect.poll(() => activeTabUrl(serviceWorker)).toMatch(/\?two$/);
      await two.bringToFront();
      await type(two, ["3", "j"]);
      await waitScroll(two, (y) => y === 180);
      await type(two, ["Shift+K"]);
      await expect.poll(() => activeTabUrl(serviceWorker)).toMatch(/\?one$/);
      await page.bringToFront();
    });
    await two.evaluate(() => scrollTo(0, 0));
    await type(page, ["@", "f"]);
    expect(await waitScroll(two, (y) => y === 180)).toBe(180);
    await expect.poll(() => activeTabUrl(serviceWorker)).toMatch(/\?one$/);
    expect(await scrollY(page)).toBe(0);
  });

  test("find and ex commands inside a macro", async ({ page, context, serviceWorker }) => {
    await open(page);
    const p2 = await context.newPage(); await open(p2, "page2.html");
    await page.bringToFront();
    await recordMacro(page, serviceWorker, "g", async () => {
      await page.keyboard.press("/");
      await page.keyboard.type("gamma");
      await page.keyboard.press("Enter");
      await ex(page, "g/page two/pin");
    });
    expect((await macros(serviceWorker)).g.steps).toEqual([{ t: "find", query: "gamma" }, { t: "ex", text: "g/page two/pin" }]);
    await serviceWorker.evaluate(async () => { for (const t of await chrome.tabs.query({})) await chrome.tabs.update(t.id, { pinned: false }); });
    await page.evaluate(() => { getSelection().removeAllRanges(); scrollTo(0, 0); });
    await type(page, ["@", "g"]);
    await expect.poll(() => page.evaluate(() => getSelection().toString())).toBe("gamma");
    await expect.poll(() => serviceWorker.evaluate(async () => (await chrome.tabs.query({ pinned: true })).length)).toBe(1);
  });

  test("Visual-mode macro: v on an element, walk, hide", async ({ page, serviceWorker }) => {
    await open(page, "visual.html");
    await page.click("#p1");
    await recordMacro(page, serviceWorker, "h", () => type(page, ["v", "j", "d", "Escape"]));
    expect((await macros(serviceWorker)).h.steps[0].t).toBe("visual");
    await page.reload(); await ready(page);
    await type(page, ["@", "h"]);
    await expect(page.locator("#p2")).toBeHidden();
    await expect(page.locator("#p1")).toBeVisible();
  });

  test(":macros lists recorded macros; errors for empty register", async ({ page, serviceWorker }) => {
    await open(page);
    await recordMacro(page, serviceWorker, "z", () => type(page, ["g", "g", "j"]));
    await ex(page, "macros");
    await expect.poll(() => hud(page, (r) => r.querySelector(".output")?.textContent || "")).toContain("@z");
    expect(await hud(page, (r) => r.querySelector(".output tbody td:last-child").textContent)).toBe("ggj");
    await page.keyboard.press("Escape");
    await type(page, ["@", "y"]);
    await expect.poll(() => toast(page)).toContain('Register "y" has no macro');
  });
});

test.describe("tab registers", () => {
  const tabsList = (page) => hud(page, (r) => [...r.querySelectorAll(".tabov-list li")].map((li) => ({ cls: li.className, title: li.querySelector(".title").textContent })));

  test("T overview: list, move, select, \"ay yank, close, \"ap reopen", async ({ page, context, serviceWorker }) => {
    await open(page);
    for (const q of ["x", "y", "z"]) { const p = await context.newPage(); await open(p, `page2.html?${q}`); }
    await page.bringToFront();
    await page.keyboard.press("Shift+T");
    expect(await mode(page)).toBe("tabs");
    await expect.poll(async () => (await tabsList(page)).length).toBe(4);
    expect((await tabsList(page))[0].cls).toContain("cursor");
    await type(page, ["j", "Space", "Space"]); // select tabs 2 and 3
    const rows = await tabsList(page);
    expect(rows.map((r) => r.cls.includes("selected"))).toEqual([false, true, true, false]);
    await page.waitForTimeout(200);
    await page.screenshot({ path: "test-results/taboverview.png" });
    await type(page, ['"', "a", "y"]);
    await expect.poll(() => toast(page)).toContain('Yanked 2 tabs into "a');
    expect(await mode(page)).toBe("normal");

    // Synced: small index + chunk in storage.sync
    const sync = await serviceWorker.evaluate(() => chrome.storage.sync.get(null));
    expect(sync["treg:index"].a).toMatchObject({ n: 2, chunks: 1, localOnly: false });
    expect(sync["treg:a:0"].map((t) => t.u)).toEqual([`${BASE}/page2.html?x`, `${BASE}/page2.html?y`]);

    // Close them from the overview with x, then put them back with "ap
    await page.keyboard.press("Shift+T");
    await type(page, ["j", "Space", "Space", "x"]);
    await expect.poll(async () => (await tabsList(page)).length).toBe(2);
    await page.keyboard.press("Escape");
    const urls = () => serviceWorker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url || t.pendingUrl).sort());
    expect(await urls()).toEqual([`${BASE}/long.html`, `${BASE}/page2.html?z`]);
    await type(page, ['"', "a", "p"]);
    await expect.poll(urls).toEqual([`${BASE}/long.html`, `${BASE}/page2.html?x`, `${BASE}/page2.html?y`, `${BASE}/page2.html?z`]);
    await expect.poll(() => toast(page)).toContain('Opened 2 tabs from "a');
  });

  test("overview: Enter switches tab; y without selection yanks cursor tab; :reg shows it", async ({ page, context, serviceWorker }) => {
    await open(page);
    const p = await context.newPage(); await open(p, "page2.html");
    await page.bringToFront();
    await page.keyboard.press("Shift+T");
    await expect.poll(async () => (await tabsList(page)).length).toBe(2);
    await type(page, ["j", '"', "b", "y"]);
    await expect.poll(() => toast(page)).toContain('Yanked 1 tab into "b');
    await ex(page, "reg");
    await expect.poll(() => hud(page, (r) => r.querySelector(".output")?.textContent || "")).toContain("tabs×1");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+T");
    await type(page, ["G", "Enter"]);
    await expect.poll(() => activeTabUrl(serviceWorker)).toBe(`${BASE}/page2.html`);
  });

  test("\"ayy yanks the URL into text register a (and \"\")", async ({ page }) => {
    await open(page);
    await type(page, ['"', "a", "y", "y"]);
    await expect.poll(() => toast(page)).toContain('into "a');
    await ex(page, "reg");
    await expect.poll(() => hud(page, (r) => [...r.querySelectorAll(".output tbody tr")].map((tr) => tr.cells[0].textContent).join(" "))).toBe('"" "a');
  });

  test("empty tab register reports an error", async ({ page }) => {
    await open(page);
    await type(page, ['"', "q", "p"]);
    await expect.poll(() => toast(page)).toContain('Tab register "q" is empty');
  });
});
