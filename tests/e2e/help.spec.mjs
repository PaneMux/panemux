// "?" help overlay and command-bar descriptions.
import { test, expect, open, hud, mode } from "./fixtures.mjs";

const help = (page) => hud(page, (r) => {
  const p = r.querySelector(".help");
  if (!p) return null;
  return {
    groups: [...p.querySelectorAll(".help-group")].map((g) => g.dataset.group),
    commands: [...p.querySelectorAll(".help-row")].map((row) => row.dataset.command),
    rows: [...p.querySelectorAll(".help-row")].map((row) => `${[...row.querySelectorAll("kbd")].map((k) => k.textContent).join(" ")} = ${row.querySelector(".text").textContent}`),
  };
});

test.describe("Classic preset", () => {
  test.use({ pmxSettings: {} });

  test("? lists only Tier 0 keys, in plain English, grouped simply", async ({ page }) => {
    await open(page);
    await page.keyboard.press("?");
    const h = await help(page);
    expect(h.groups).toEqual(["Move", "Click", "Tabs", "Edit"]);
    expect(h.commands).not.toContain("undo");
    expect(h.commands).not.toContain("macroRecord");
    expect(h.commands).not.toContain("visualEnter");
    expect(h.rows).toContain("f = Click a link or button by typing its letters");
    expect(h.rows).toContain("u Ctrl-u = Scroll up half a screen"); // Classic keeps Vimium's u
    const text = h.rows.join("\n");
    expect(text).not.toMatch(/ex-command|operator|register/i); // no jargon for beginners
    await page.screenshot({ path: "test-results/help-classic.png" });
  });

  test("keys a preset turns off really do nothing (they reach the page)", async ({ page }) => {
    await open(page);
    await page.keyboard.press("v");
    expect(await mode(page)).toBe("normal");
    await page.keyboard.press(":");
    expect(await mode(page)).toBe("normal");
    expect(await page.evaluate(() => window.pageKeys)).toEqual(["v", ":"]);
  });
});

test.describe("Power User preset", () => {
  test("? shows the Advanced group too; search filters; Esc closes", async ({ page }) => {
    await open(page);
    await page.keyboard.press("?");
    expect((await help(page)).groups).toEqual(["Move", "Click", "Tabs", "Edit", "Advanced"]);
    await page.keyboard.type("tab");
    await expect.poll(async () => (await help(page)).rows.every((r) => /tab/i.test(r))).toBe(true);
    expect((await help(page)).rows.some((r) => r.startsWith("T = "))).toBe(true);
    await page.keyboard.press("Control+a");
    await page.keyboard.type("zzqq");
    expect(await hud(page, (r) => r.querySelector(".help-empty")?.textContent)).toBe('Nothing matches "zzqq".');
    await page.keyboard.press("Escape");
    expect(await help(page)).toBeNull();
    expect(await page.evaluate(() => window.pageKeys.length)).toBe(0); // search typing never leaked
  });

  test("? again (with an empty search) closes it", async ({ page }) => {
    await open(page);
    await page.keyboard.press("?");
    expect(await help(page)).not.toBeNull();
    await page.keyboard.press("?");
    expect(await help(page)).toBeNull();
  });

  test("command bar shows a one-line plain description for each match", async ({ page }) => {
    await open(page);
    await page.keyboard.press(":");
    await page.keyboard.type("tab");
    const rows = await hud(page, (r) => [...r.querySelectorAll(".suggestions li")].map((li) => ({ name: li.dataset.name, desc: li.querySelector(".desc").textContent })));
    expect(rows[0]).toEqual({ name: "tabdo", desc: "Do something to every tab in this window, or only those matching — e.g. close *news*" });
    for (const r of rows) expect(r.desc.length).toBeGreaterThan(10);
    await page.keyboard.press("Escape");
  });
});

test("gi jumps into the first text box", async ({ page }) => {
  await open(page);
  await page.keyboard.press("g");
  await page.keyboard.press("i");
  expect(await page.evaluate(() => document.activeElement.id)).toBe("text-input");
  expect(await mode(page)).toBe("insert");
});
