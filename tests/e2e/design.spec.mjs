// Design-system checks: status strip / pill fallback, click-through HUD,
// motion rules, opt-in scanlines, keystroke trail.
import { test, expect, open, hud, mode, type, BASE } from "./fixtures.mjs";

const layout = (page) => hud(page, (r) => {
  const el = r.querySelector(".strip, .pill");
  const b = el.getBoundingClientRect();
  return { cls: el.classList.contains("pill") ? "pill" : "strip", top: b.top, bottom: b.bottom, height: b.height, width: b.width, right: b.right };
});

test.describe("mode indicator", () => {
  test("default: 24px strip on the bottom edge, with reserved space", async ({ page }) => {
    await open(page);
    const l = await layout(page);
    const vh = await page.evaluate(() => innerHeight);
    expect(l).toMatchObject({ cls: "strip", height: 24, bottom: vh });
    expect(await page.evaluate(() => [document.documentElement.hasAttribute("data-panemux-strip"), getComputedStyle(document.documentElement).paddingBottom])).toEqual([true, "24px"]);
    // Scrolled to the end, the last content clears the strip.
    await page.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight));
    const lastBottom = await page.evaluate(() => document.querySelector("#s4").getBoundingClientRect().bottom);
    expect(lastBottom).toBeLessThanOrEqual(vh - 24 + 1);
    await page.screenshot({ path: "test-results/design-strip.png" });
  });

  test("falls back to the corner pill when the site owns the bottom edge", async ({ page }) => {
    await open(page, "fixedbar.html");
    await expect.poll(async () => (await layout(page)).cls).toBe("pill");
    const l = await layout(page);
    const vw = await page.evaluate(() => innerWidth);
    expect(l.height).toBe(24);
    expect(l.right).toBeCloseTo(vw - 16, 0);
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-panemux-strip"))).toBe(false);
    // The cookie bar is still clickable under/near the pill.
    await page.click("#ok");
    await page.screenshot({ path: "test-results/design-pill.png" });
  });

  test("app shells that don't scroll get the pill too", async ({ page }) => {
    await open(page, "app.html");
    await expect.poll(async () => (await layout(page)).cls).toBe("pill");
  });

  test("pill sits at 55% opacity at rest and brightens on mode change", async ({ page }) => {
    await open(page, "fixedbar.html");
    await expect.poll(async () => (await layout(page)).cls).toBe("pill");
    await expect.poll(() => hud(page, (r) => getComputedStyle(r.querySelector(".pill")).opacity)).toBe("0.55");
    await page.keyboard.press("i");
    await expect.poll(() => hud(page, (r) => getComputedStyle(r.querySelector(".pill")).opacity)).toBe("1");
    await expect.poll(() => hud(page, (r) => getComputedStyle(r.querySelector(".pill")).opacity)).toBe("0.55");
  });

  test("the pill can be forced from settings", async ({ page, serviceWorker }) => {
    await serviceWorker.evaluate(() => chrome.storage.sync.set({ indicator: "pill" }));
    await open(page);
    await expect.poll(async () => (await layout(page)).cls).toBe("pill");
  });
});

test.describe("never intercepts the page", () => {
  test("host is zero-size with pointer-events none; clicks pass through the strip and hints", async ({ page }) => {
    await open(page);
    const host = await page.evaluate(() => {
      const h = document.querySelector("panemux-hud");
      const r = h.getBoundingClientRect();
      return { w: r.width, h: r.height, pe: getComputedStyle(h).pointerEvents };
    });
    expect(host).toEqual({ w: 0, h: 0, pe: "none" });
    const hitStrip = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight - 5).tagName);
    expect(hitStrip).not.toBe("PANEMUX-HUD");
    await page.keyboard.press("f");
    const hitHint = await page.evaluate(() => {
      const h = document.querySelector("panemux-hud").shadowRoot.querySelector(".hint").getBoundingClientRect();
      return document.elementFromPoint(h.left + 3, h.top + 3).tagName;
    });
    expect(hitHint).not.toBe("PANEMUX-HUD");
    await page.keyboard.press("Escape");
  });

  test("only interactive panels take pointer events (palette yes, outside it no)", async ({ page }) => {
    await open(page);
    await page.keyboard.press(":");
    const r = await page.evaluate(() => {
      const p = document.querySelector("panemux-hud").shadowRoot.querySelector(".palette").getBoundingClientRect();
      return {
        onPalette: document.elementFromPoint(p.left + 20, p.top + 20).tagName,
        outside: document.elementFromPoint(10, innerHeight / 2).tagName,
      };
    });
    expect(r.onPalette).toBe("PANEMUX-HUD");
    expect(r.outside).not.toBe("PANEMUX-HUD");
    await page.keyboard.press("Escape");
  });
});

test.describe("motion", () => {
  test("no skew or glitch animations anywhere in the HUD stylesheet", async ({ page }) => {
    await open(page);
    const css = await hud(page, (r) => [...r.adoptedStyleSheets].map((s) => [...s.cssRules].map((x) => x.cssText).join("\n")).join("\n"));
    expect(css).not.toMatch(/skew|glitch/i);
  });

  test("prefers-reduced-motion switches animations off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await page.keyboard.press(":");
    expect(await hud(page, (r) => getComputedStyle(r.querySelector(".palette")).animationName)).toBe("none");
    await page.keyboard.press("Escape");
  });
});

test.describe("extras", () => {
  test("scanlines are off by default and opt-in from settings", async ({ page, serviceWorker }) => {
    await open(page);
    expect(await hud(page, (r) => !!r.querySelector(".scanlines"))).toBe(false);
    await serviceWorker.evaluate(() => chrome.storage.sync.set({ scanlines: true }));
    await expect.poll(() => hud(page, (r) => !!r.querySelector(".scanlines"))).toBe(true);
    expect(await hud(page, (r) => getComputedStyle(r.querySelector(".scanlines")).pointerEvents)).toBe("none");
  });

  test("keystroke trail shows handled keys as fading chips (Power User)", async ({ page }) => {
    await open(page);
    await type(page, ["j", "g", "g"]);
    await expect.poll(() => hud(page, (r) => [...r.querySelectorAll(".trail .chip")].map((c) => c.textContent).join(""))).toBe("jgg");
    await expect.poll(() => hud(page, (r) => r.querySelectorAll(".trail .chip").length), { timeout: 3000 }).toBe(0);
  });

  test("typing into a text field never shows in the trail", async ({ page }) => {
    await open(page);
    await page.click("#text-input");
    await page.keyboard.type("secret");
    expect(await mode(page)).toBe("insert");
    expect(await hud(page, (r) => r.querySelectorAll(".trail .chip").length)).toBe(0);
  });
});

test.describe("Classic preset visuals", () => {
  test.use({ pmxSettings: {} });
  test("no keystroke trail in Classic", async ({ page }) => {
    await open(page);
    await type(page, ["j", "k"]);
    await page.waitForTimeout(200);
    expect(await hud(page, (r) => r.querySelectorAll(".trail .chip").length)).toBe(0);
  });
});
