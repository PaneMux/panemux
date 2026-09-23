// Auto-passthrough: focusing anything editable hands the keyboard to the page
// and the indicator says "Insert" — the #1 "it's broken" complaint if missing.
import { test, expect, open, hud, mode, scrollY, BASE } from "./fixtures.mjs";

const label = (page) => hud(page, (r) => r.querySelector(".strip, .pill").querySelector(".label").textContent);

test.describe("Classic preset (new install defaults)", () => {
  test.use({ pmxSettings: {} });

  for (const [what, focus, check] of [
    ["contenteditable", (p) => p.click("#ce"), (p) => expect(p.locator("#ce")).toContainText("jkfG")],
    ["role=textbox", (p) => p.click("#rt"), (p) => expect(p.locator("#rt")).toContainText("jkfG")],
    ["an input inside a shadow root", (p) => p.click("search-box"), (p) => expect.poll(() => p.evaluate(() => document.querySelector("search-box").shadowRoot.querySelector("input").value)).toBe("jkfG")],
  ]) {
    test(`typing into ${what} just works`, async ({ page }) => {
      await open(page, "editors.html");
      await focus(page);
      await expect.poll(() => mode(page)).toBe("insert");
      expect(await label(page)).toBe("Insert");
      await page.keyboard.type("jkfG");
      await check(page);
      expect(await scrollY(page)).toBe(0);
      expect(await hud(page, (r) => r.querySelectorAll(".hint").length)).toBe(0); // f didn't open hints
      await page.keyboard.press("Escape");
      expect(await mode(page)).toBe("normal");
    });
  }

  test("a field focused before PaneMux loaded (autofocus) is honoured", async ({ page }) => {
    await page.goto(`${BASE}/editors.html`);
    await page.evaluate(() => document.getElementById("doomed").focus());
    await page.waitForFunction(() => document.querySelector("panemux-hud")?.isConnected);
    await page.keyboard.type("jj");
    await expect(page.locator("#doomed")).toHaveValue("jj");
    await expect.poll(() => mode(page)).toBe("insert");
  });

  test("if the focused field is removed, keys come back to PaneMux", async ({ page }) => {
    await open(page, "editors.html");
    await page.click("#doomed");
    expect(await mode(page)).toBe("insert");
    await page.evaluate(() => document.getElementById("doomed").remove()); // no focusout we can rely on
    await page.keyboard.press("j");
    await expect.poll(() => mode(page)).toBe("normal");
    await expect.poll(() => scrollY(page)).toBeGreaterThan(0);
  });

  test("clicking out of a field returns to Normal", async ({ page }) => {
    await open(page, "editors.html");
    await page.click("#ce");
    expect(await mode(page)).toBe("insert");
    await page.mouse.click(600, 500);
    await expect.poll(() => mode(page)).toBe("normal");
  });
});
