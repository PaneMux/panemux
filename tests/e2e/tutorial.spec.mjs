// First-run tutorial: opens on install, waits for real keys at every step,
// skippable, re-runnable.
import { test, expect, type } from "./fixtures.mjs";

const TUTORIAL = (id) => `chrome-extension://${id}/tutorial/tutorial.html`;

async function openTutorial(context, extensionId) {
  const t = await context.newPage();
  await t.goto(TUTORIAL(extensionId));
  await t.waitForFunction(() => document.querySelector("panemux-hud")?.shadowRoot?.adoptedStyleSheets.length === 2);
  await t.evaluate(() => window.focus());
  return t;
}
const met = (t) => t.evaluate(() => [...document.querySelectorAll(".goal.met")].map((g) => g.dataset.goal));
const step = (t) => t.evaluate(() => document.getElementById("card").dataset.step);
const hintLabelFor = (t, sel) => t.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  const h = [...document.querySelector("panemux-hud").shadowRoot.querySelectorAll(".hint")]
    .find((h) => Math.abs(parseFloat(h.style.left) - r.left) < 2 && Math.abs(parseFloat(h.style.top) - r.top) < 2);
  return h && h.dataset.label;
}, sel);

test.describe("new install", () => {
  test.use({ pmxSettings: {} }); // Classic, like a fresh install

  test("the tutorial opens by itself on first install", async ({ context, extensionId }) => {
    // The fixture waits for it and closes it so other specs start clean.
    expect(context.pmxTutorialUrl).toBe(TUTORIAL(extensionId));
  });

  test("walks through hjkl, f, a text field and ? — each step waits for the real key", async ({ context, extensionId, serviceWorker }) => {
    const t = await openTutorial(context, extensionId);
    expect(await step(t)).toBe("1");
    expect(await t.locator("#finish").isVisible()).toBe(false);
    await t.screenshot({ path: "test-results/tutorial-1.png" });

    // Step 1: nothing happens until j then k
    await t.keyboard.press("k");
    await t.waitForTimeout(300);
    expect(await step(t)).toBe("1");
    await t.keyboard.press("j");
    await expect.poll(() => met(t)).toEqual(["j"]); // keycaps light up as you go
    await t.keyboard.press("k");
    await expect.poll(() => step(t)).toBe("2");
    expect(await t.locator("#lesson-link").getAttribute("class")).toContain("spotlight");
    await t.screenshot({ path: "test-results/tutorial-2.png" });

    // Step 2: clicking some other link doesn't count; the lesson link via hints does
    await t.keyboard.press("f");
    const label = await hintLabelFor(t, "#lesson-link");
    expect(label).toBeTruthy();
    await type(t, label.split(""));
    await expect.poll(() => step(t)).toBe("3");

    // Step 3: into the box, type, Esc out
    await t.keyboard.press("g");
    await t.keyboard.press("i");
    await t.keyboard.type("hello");
    expect(await step(t)).toBe("3");
    expect(await met(t)).toEqual(["in", "type"]);
    await t.keyboard.press("Escape");
    await expect.poll(() => step(t)).toBe("4");

    // Step 4: open and close help
    await t.keyboard.press("?");
    await t.waitForTimeout(250);
    expect(await step(t)).toBe("4");
    await t.keyboard.press("Escape");
    await expect.poll(() => step(t)).toBe("done");
    expect(await t.locator("#step-text").textContent()).toBe("That's everything you need for day one. Press ? anytime to see more.");
    expect(await t.locator("#finish").isVisible()).toBe(true);
    await t.screenshot({ path: "test-results/tutorial-done.png" });
    expect((await serviceWorker.evaluate(() => chrome.storage.local.get("onboarding"))).onboarding).toMatchObject({ done: true, how: "finished" });
  });

  test("a lesson can be skipped without doing it", async ({ context, extensionId }) => {
    const t = await openTutorial(context, extensionId);
    await t.click("#skip-step");
    expect(await step(t)).toBe("2");
    expect(await t.locator("#progress li").first().getAttribute("class")).toBe("skipped");
    expect(await t.locator("#step-count").textContent()).toBe("Lesson 2 of 4");
  });

  test("Skip closes it and remembers", async ({ context, extensionId, serviceWorker }) => {
    const t = await openTutorial(context, extensionId);
    await Promise.all([t.waitForEvent("close"), t.click("#skip")]);
    expect((await serviceWorker.evaluate(() => chrome.storage.local.get("onboarding"))).onboarding).toMatchObject({ done: true, how: "skipped" });
  });

  test("it never mentions macros, registers, splits or Vimgolf", async ({ context, extensionId }) => {
    const t = await openTutorial(context, extensionId);
    const text = await t.evaluate(() => document.body.innerText);
    const steps = await t.evaluate(() => fetch("tutorial.js").then((r) => r.text()));
    for (const word of ["macro", "register", "split", "vimgolf"]) {
      expect(text.toLowerCase()).not.toContain(word);
      expect(steps.toLowerCase()).not.toContain(word);
    }
  });
});
