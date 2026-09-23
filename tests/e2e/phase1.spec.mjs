// Phase 1 end-to-end: every Tier 0 binding, driven through real key presses
// against the unpacked extension.
import { test, expect, open, ready, hud, mode, scrollY, scrollX, toast, waitScroll, type, activeTabUrl, BASE } from "./fixtures.mjs";

const hintFor = (page, selector) =>
  page.evaluate((sel) => {
    const target = document.querySelector(sel).getBoundingClientRect();
    const root = document.querySelector("panemux-hud").shadowRoot;
    const hints = [...root.querySelectorAll(".hint:not(.hide)")];
    const best = hints.find((h) => Math.abs(parseFloat(h.style.left) - Math.max(0, target.left)) < 2 && Math.abs(parseFloat(h.style.top) - Math.max(0, target.top)) < 2);
    return best ? best.dataset.label : null;
  }, selector);

test.describe("HUD", () => {
  test("status strip shows Normal with an emerald dot; fonts load", async ({ page }) => {
    await open(page);
    await expect.poll(() => hud(page, (root) => {
      const strip = root.querySelector(".strip");
      return { label: strip.querySelector(".label").textContent, dot: getComputedStyle(strip.querySelector(".dot")).backgroundColor, font: getComputedStyle(strip).fontFamily };
    })).toEqual({ label: "Normal", dot: "rgb(52, 211, 153)", font: expect.stringContaining("PaneMux Inter") });
    expect(await page.evaluate(async () => {
      await Promise.all(['500 11px "PaneMux Inter"', '700 12px "PaneMux JetBrains Mono"'].map((f) => document.fonts.load(f)));
      return document.fonts.check('500 11px "PaneMux Inter"') && document.fonts.check('700 12px "PaneMux JetBrains Mono"');
    })).toBe(true);
  });

  test("indicator emphasises and recolors on mode switch", async ({ page }) => {
    await open(page);
    await page.keyboard.press("i");
    expect(await mode(page)).toBe("insert");
    const s = await hud(page, (root) => ({ changed: root.querySelector(".strip").classList.contains("changed"), label: root.querySelector(".strip .label").textContent }));
    expect(s).toEqual({ changed: true, label: "Insert" });
    await expect.poll(() => hud(page, (root) => getComputedStyle(root.querySelector(".strip .dot")).backgroundColor)).toBe("rgb(251, 191, 36)");
    await expect.poll(() => hud(page, (root) => root.querySelector(".strip").classList.contains("changed"))).toBe(false);
    await page.keyboard.press("Escape");
    expect(await mode(page)).toBe("normal");
  });

  test("pending keys are shown next to the orb", async ({ page }) => {
    await open(page);
    await type(page, ["2", "g"]);
    expect(await hud(page, (r) => r.querySelector(".pending").textContent)).toBe("2g");
    await page.keyboard.press("Escape");
    expect(await hud(page, (r) => r.querySelector(".pending").textContent)).toBe("");
  });
});

test.describe("scrolling", () => {
  test("j / k / count", async ({ page }) => {
    await open(page);
    await page.keyboard.press("j");
    expect(await waitScroll(page, (y) => y === 60)).toBe(60);
    await type(page, ["3", "j"]);
    expect(await waitScroll(page, (y) => y === 240)).toBe(240);
    await page.keyboard.press("k");
    expect(await waitScroll(page, (y) => y === 180)).toBe(180);
  });

  test("h / l", async ({ page }) => {
    await open(page);
    await type(page, ["5", "l"]);
    expect(await waitScroll(page, (x) => x === 300, "x")).toBe(300);
    await page.keyboard.press("h");
    expect(await waitScroll(page, (x) => x === 240, "x")).toBe(240);
  });

  test("d / Ctrl-u half page", async ({ page }) => {
    await open(page);
    const half = await page.evaluate(() => innerHeight / 2);
    await page.keyboard.press("d");
    expect(await waitScroll(page, (y) => Math.abs(y - half) <= 1)).toBeCloseTo(half, -1);
    await page.keyboard.press("d");
    await page.keyboard.press("Control+u");
    expect(await waitScroll(page, (y) => Math.abs(y - half) <= 1)).toBeCloseTo(half, -1);
  });

  test("G / gg", async ({ page }) => {
    await open(page);
    const max = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
    await page.keyboard.press("Shift+G");
    expect(await waitScroll(page, (y) => y >= max - 1)).toBeGreaterThanOrEqual(max - 1);
    await type(page, ["g", "g"]);
    expect(await waitScroll(page, (y) => y === 0)).toBe(0);
  });

  test("scrolls an inner container when the document can't scroll", async ({ page }) => {
    await open(page, "app.html");
    await type(page, ["2", "j"]);
    await expect.poll(() => page.evaluate(() => document.getElementById("main").scrollTop)).toBe(120);
  });

  test("keys the extension handles don't reach the page; unbound keys do", async ({ page }) => {
    await open(page);
    await type(page, ["j", "z", "x"]);
    expect(await page.evaluate(() => window.pageKeys)).toEqual(["z", "x"]);
  });
});

test.describe("link hints", () => {
  test("f shows hints over visible clickables, Esc cancels", async ({ page }) => {
    await open(page);
    await page.keyboard.press("f");
    expect(await mode(page)).toBe("hints");
    const n = await hud(page, (r) => r.querySelectorAll(".hint").length);
    expect(n).toBeGreaterThanOrEqual(5); // 2 links, button, input, JS span
    await page.screenshot({ path: "test-results/hints.png" });
    await page.keyboard.press("Escape");
    expect(await hud(page, (r) => r.querySelectorAll(".hint").length)).toBe(0);
    expect(await mode(page)).toBe("normal");
  });

  test("f + label follows a link in the current tab", async ({ page }) => {
    await open(page);
    await page.keyboard.press("f");
    const label = await hintFor(page, "#link-page2");
    expect(label).toBeTruthy();
    await Promise.all([page.waitForURL(/page2\.html$/), type(page, label.split(""))]);
  });

  test("f clicks buttons and JS-only click targets", async ({ page }) => {
    await open(page);
    await page.keyboard.press("f");
    await type(page, (await hintFor(page, "#btn")).split(""));
    await expect(page.locator("#btn")).toHaveText("clicked 1");
    await page.keyboard.press("f");
    await type(page, (await hintFor(page, "#js-click")).split(""));
    await expect(page.locator("#js-click")).toHaveAttribute("data-clicked", "yes");
  });

  test("f on an input focuses it and enters Insert mode", async ({ page }) => {
    await open(page);
    await page.keyboard.press("f");
    await type(page, (await hintFor(page, "#text-input")).split(""));
    expect(await mode(page)).toBe("insert");
    await page.keyboard.type("jk5");
    await expect(page.locator("#text-input")).toHaveValue("jk5");
    expect(await scrollY(page)).toBe(0); // j/k went to the input, not the scroller
    await page.keyboard.press("Escape");
    expect(await mode(page)).toBe("normal");
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });

  test("typing filters hints; backspace un-filters", async ({ page }) => {
    await open(page);
    await page.keyboard.press("f");
    const all = await hud(page, (r) => [...r.querySelectorAll(".hint")].map((h) => h.dataset.label));
    const multi = all.find((l) => l.length > 1) || all[0];
    if (multi.length > 1) {
      await page.keyboard.press(multi[0]);
      const visible = await hud(page, (r) => r.querySelectorAll(".hint:not(.hide)").length);
      expect(visible).toBeLessThan(all.length);
      await page.keyboard.press("Backspace");
      expect(await hud(page, (r) => r.querySelectorAll(".hint:not(.hide)").length)).toBe(all.length);
    }
    await page.keyboard.press("Escape");
  });

  test("F opens the link in a new tab", async ({ page, context }) => {
    await open(page);
    await page.keyboard.press("Shift+F");
    const label = await hintFor(page, "#link-blank");
    const [newPage] = await Promise.all([context.waitForEvent("page"), type(page, label.split(""))]);
    await newPage.waitForURL(/page2\.html\?new$/);
    expect(page.url()).toMatch(/long\.html$/); // original tab stays
  });
});

test.describe("tabs", () => {
  test("t opens a new tab", async ({ page, context }) => {
    await open(page);
    const before = context.pages().length;
    const [p] = await Promise.all([context.waitForEvent("page"), page.keyboard.press("t")]);
    expect(context.pages().length).toBe(before + 1);
    expect(p).toBeTruthy();
  });

  test("J / K / gt / gT / {count}gt switch tabs", async ({ page, context, serviceWorker }) => {
    await open(page, "long.html?1");
    const p2 = await context.newPage(); await open(p2, "long.html?2");
    const p3 = await context.newPage(); await open(p3, "long.html?3");
    await p3.bringToFront();
    const active = () => activeTabUrl(serviceWorker);
    const on = async (n) => {
      await expect.poll(active).toMatch(new RegExp(`\\?${n}$`));
      const p = context.pages().find((x) => x.url().endsWith(`?${n}`));
      await p.bringToFront();
      return p;
    };
    let cur = await on(3);
    await cur.keyboard.press("Shift+J");       // wraps 3 -> 1
    cur = await on(1);
    await cur.keyboard.press("Shift+K");       // wraps 1 -> 3
    cur = await on(3);
    await type(cur, ["g", "Shift+T"]);         // 3 -> 2
    cur = await on(2);
    await type(cur, ["g", "t"]);               // 2 -> 3
    cur = await on(3);
    await type(cur, ["1", "g", "t"]);          // tab #1
    cur = await on(1);
    await type(cur, ["2", "Shift+J"]);         // 1 -> 3
    await on(3);
  });
});

test.describe("find", () => {
  test("/ opens find bar, highlights matches, Enter selects, n/N cycle", async ({ page }) => {
    await open(page);
    await page.keyboard.press("/");
    expect(await mode(page)).toBe("find");
    await page.keyboard.type("needle");
    // "needle" x4 (alpha, split across <b>, beta, gamma) + "NEEDLE" (case-insensitive query)
    await expect.poll(() => hud(page, (r) => r.querySelector(".findbar .count").textContent)).toBe("[1/5]");
    expect(await page.evaluate(() => window.pageKeys.length)).toBe(0); // typing hidden from page
    await page.screenshot({ path: "test-results/find.png" });
    await page.keyboard.press("Enter");
    expect(await mode(page)).toBe("normal");
    expect(await page.evaluate(() => getSelection().toString())).toBe("Needle");

    await page.keyboard.press("n");
    expect(await page.evaluate(() => getSelection().toString())).toBe("needle"); // across <b>nee</b>dle
    await page.keyboard.press("n");
    expect(await page.evaluate(() => getSelection().toString().toLowerCase())).toBe("needle");
    const y2 = await scrollY(page);
    expect(y2).toBeGreaterThan(400); // section two scrolled into view
    expect(await toast(page)).toContain("[3/5]");
    await page.keyboard.press("Shift+N");
    expect(await toast(page)).toContain("[2/5]");
    await page.keyboard.press("Shift+N");
    await page.keyboard.press("Shift+N"); // wraps to last
    expect(await toast(page)).toContain("[5/5]");
  });

  test("smartcase: uppercase in query is case-sensitive", async ({ page }) => {
    await open(page);
    await page.keyboard.press("/");
    await page.keyboard.type("NEEDLE");
    await expect.poll(() => hud(page, (r) => r.querySelector(".findbar .count").textContent)).toBe("[1/1]");
    await page.keyboard.press("Enter");
  });

  test("Esc cancels find, restores scroll, clears highlights", async ({ page }) => {
    await open(page);
    await page.keyboard.press("/");
    await page.keyboard.type("gamma");
    await expect.poll(() => scrollY(page)).toBeGreaterThan(1000);
    await page.keyboard.press("Escape");
    expect(await waitScroll(page, (y) => y === 0)).toBe(0);
    expect(await mode(page)).toBe("normal");
    expect(await hud(page, (r) => !!r.querySelector(".findbar"))).toBe(false);
  });

  test("no match shows error", async ({ page }) => {
    await open(page);
    await page.keyboard.press("/");
    await page.keyboard.type("zzzqqq");
    await expect.poll(() => hud(page, (r) => r.querySelector(".findbar .count").textContent)).toBe("[no match]");
    await page.keyboard.press("Enter");
    expect(await toast(page)).toContain("Pattern not found: zzzqqq");
  });
});

test.describe("history", () => {
  test("H goes back, L goes forward", async ({ page }) => {
    await open(page);
    await page.goto(`${BASE}/page2.html`);
    await ready(page);
    await Promise.all([page.waitForURL(/long\.html$/), page.keyboard.press("Shift+H")]);
    await ready(page);
    await Promise.all([page.waitForURL(/page2\.html$/), page.keyboard.press("Shift+L")]);
  });
});

test.describe("marks", () => {
  test("m{a} / `{a} local mark, `` back, persists across reload", async ({ page }) => {
    await open(page);
    await type(page, ["1", "0", "j"]);
    await waitScroll(page, (y) => y === 600);
    await type(page, ["m", "a"]);
    await expect.poll(() => toast(page)).toContain("Mark 'a' set");
    await type(page, ["g", "g"]);
    await waitScroll(page, (y) => y === 0);
    await type(page, ["`", "a"]);
    expect(await waitScroll(page, (y) => y === 600)).toBe(600);
    await type(page, ["`", "`"]);
    expect(await waitScroll(page, (y) => y === 0)).toBe(0);

    await page.reload();
    await ready(page);
    await page.evaluate(() => scrollTo(0, 0));
    await type(page, ["'", "a"]);
    expect(await waitScroll(page, (y) => y === 600)).toBe(600);
  });

  test("unset mark reports error", async ({ page }) => {
    await open(page);
    await type(page, ["`", "q"]);
    await expect.poll(() => toast(page)).toContain("Mark 'q' not set");
  });

  test("m{A} global mark jumps across tabs", async ({ page, context, serviceWorker }) => {
    await open(page, "long.html?global");
    await type(page, ["5", "j"]);
    await waitScroll(page, (y) => y === 300);
    await type(page, ["m", "Shift+A"]);
    await expect.poll(() => toast(page)).toContain("Global mark 'A' set");
    await page.evaluate(() => scrollTo(0, 0));

    const other = await context.newPage();
    await open(other, "page2.html");
    await other.bringToFront();
    await type(other, ["`", "Shift+A"]);
    await expect.poll(() => activeTabUrl(serviceWorker)).toMatch(/\?global$/);
    expect(await waitScroll(page, (y) => y === 300)).toBe(300);
  });
});

test.describe("misc", () => {
  test("yy copies the URL", async ({ page }) => {
    await open(page);
    await type(page, ["y", "y"]);
    await expect.poll(() => toast(page)).toContain("Yanked");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${BASE}/long.html`);
  });

  test("focusing an input by mouse enters Insert, blur returns to Normal", async ({ page }) => {
    await open(page);
    await page.click("#text-input");
    expect(await mode(page)).toBe("insert");
    await page.keyboard.type("hello");
    await expect(page.locator("#text-input")).toHaveValue("hello");
    await page.click("h1");
    await expect.poll(() => mode(page)).toBe("normal");
  });
});
