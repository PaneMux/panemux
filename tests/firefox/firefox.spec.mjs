// PaneMux in Firefox: the Firefox build, installed as a temporary add-on,
// driven with real key presses. One fresh profile per test.
import { test, expect, EXT_ORIGIN, BASE, open, ready, hud, mode, scrollY, toast, waitScroll, type, activeTabUrl } from "./fixtures.mjs";

const hintFor = (page, selector) => page.evaluate((sel) => {
  const t = document.querySelector(sel).getBoundingClientRect();
  const h = [...document.querySelector("panemux-hud").shadowRoot.querySelectorAll(".hint:not(.hide)")]
    .find((h) => Math.abs(parseFloat(h.style.left) - Math.max(0, t.left)) < 2 && Math.abs(parseFloat(h.style.top) - Math.max(0, t.top)) < 2);
  return h && h.dataset.label;
}, selector);

async function ex(page, text) {
  await page.keyboard.press(":");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

const tabCount = (background) => background(() => browser.tabs.query({}).then((t) => t.length));

test.describe("install", () => {
  test.use({ pmxSettings: {} });

  test("the Firefox build installs and opens the tutorial with its HUD", async ({ ff }) => {
    // the fixture closed it; open it again the way the toolbar menu does
    await ff.background((u) => browser.tabs.create({ url: u }), `${EXT_ORIGIN}/tutorial/tutorial.html`);
    const tutorial = await ff.extPage("tutorial/");
    await expect.poll(() => tutorial(() => ({
      step: document.getElementById("card").dataset.step,
      strip: !!document.querySelector("panemux-hud")?.shadowRoot?.querySelector(".strip, .pill"),
    }))).toEqual({ step: "1", strip: true });
  });

  test("background runs as an event page with the chrome.* API", async ({ background }) => {
    const info = await background(async () => ({
      scripts: browser.runtime.getManifest().background.scripts.map((u) => new URL(u, location.href).pathname),
      promises: typeof chrome.storage.local.get("x").then,
      session: typeof chrome.storage.session?.get,
    }));
    expect(info).toEqual({ scripts: ["/background/background.js"], promises: "function", session: "function" });
  });
});

test.describe("site access withheld", () => {
  // what happens when someone declines (or later revokes) access to websites
  test.use({ pmxPrefs: { "extensions.originControls.grantByDefault": false } });

  test("the tutorial and settings explain it and offer the fix", async ({ ff, page }) => {
    await page.goto(`${BASE}/long.html`);
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => !!document.querySelector("panemux-hud"))).toBe(false);
    await ff.background((u) => browser.tabs.create({ url: u }), `${EXT_ORIGIN}/options/options.html`);
    const s = await ff.extPage("options/");
    await expect.poll(() => s(() => [typeof PaneMux.SiteAccess, document.getElementById("site-access")?.hidden])).toEqual(["object", false]);
    expect(await s(() => document.getElementById("grant-access").textContent)).toBe("Allow on all websites");
  });
});

test.describe("site access granted", () => {
  test("no banner", async ({ ff }) => {
    await ff.background((u) => browser.tabs.create({ url: u }), `${EXT_ORIGIN}/options/options.html`);
    const s = await ff.extPage("options/");
    await expect.poll(() => s(() => document.getElementById("site-access")?.hidden)).toBe(true);
  });
});

test.describe("HUD", () => {
  test("status strip with reserved space, design tokens and bundled fonts", async ({ page }) => {
    await open(page);
    await expect.poll(() => hud(page, (r) => {
      const strip = r.querySelector(".strip");
      return { h: strip.getBoundingClientRect().height, label: strip.querySelector(".label").textContent, dot: getComputedStyle(strip.querySelector(".dot")).backgroundColor };
    })).toEqual({ h: 24, label: "Normal", dot: "rgb(52, 211, 153)" });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).paddingBottom)).toBe("24px");
    expect(await page.evaluate(async () => (await document.fonts.load('500 11px "PaneMux Inter"')).map((f) => f.status))).toEqual(["loaded"]);
    expect(await page.evaluate(() => { const h = document.querySelector("panemux-hud").getBoundingClientRect(); return [h.width, h.height]; })).toEqual([0, 0]);
    await page.screenshot({ path: "test-results/firefox-strip.png" });
  });

  test("mode colors change on Insert", async ({ page }) => {
    await open(page);
    await page.keyboard.press("i");
    expect(await mode(page)).toBe("insert");
    await expect.poll(() => hud(page, (r) => getComputedStyle(r.querySelector(".strip .dot")).backgroundColor)).toBe("rgb(251, 191, 36)");
    await page.keyboard.press("Escape");
    expect(await mode(page)).toBe("normal");
  });
});

test.describe("moving", () => {
  test("j / 3j / k / d / G / gg", async ({ page }) => {
    await open(page);
    await page.keyboard.press("j");
    expect(await waitScroll(page, (y) => y === 60)).toBe(60);
    await type(page, ["3", "j"]);
    expect(await waitScroll(page, (y) => y === 240)).toBe(240);
    await page.keyboard.press("k");
    expect(await waitScroll(page, (y) => y === 180)).toBe(180);
    const max = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
    await page.keyboard.press("Shift+G");
    expect(await waitScroll(page, (y) => y >= max - 1)).toBeGreaterThanOrEqual(max - 1);
    await type(page, ["g", "g"]);
    expect(await waitScroll(page, (y) => y === 0)).toBe(0);
    const half = await page.evaluate(() => innerHeight / 2);
    await page.keyboard.press("d");
    expect(await waitScroll(page, (y) => Math.abs(y - half) <= 1)).toBeCloseTo(half, -1);
  });

  test("handled keys don't reach the page; unbound ones do", async ({ page }) => {
    await open(page);
    await type(page, ["j", "z", "x"]);
    expect(await page.evaluate(() => window.pageKeys)).toEqual(["z", "x"]);
  });

  test("marks: m a, gg, ` a", async ({ page }) => {
    await open(page);
    await type(page, ["1", "0", "j"]);
    await waitScroll(page, (y) => y === 600);
    await type(page, ["m", "a"]);
    await expect.poll(() => toast(page)).toContain("Mark 'a' set");
    await type(page, ["g", "g"]);
    await waitScroll(page, (y) => y === 0);
    await type(page, ["`", "a"]);
    expect(await waitScroll(page, (y) => y === 600)).toBe(600);
  });

  test("H / L walk history", async ({ page }) => {
    await open(page);
    await page.goto(`${BASE}/page2.html`);
    await ready(page);
    await Promise.all([page.waitForURL(/long\.html$/), page.keyboard.press("Shift+H")]);
    await ready(page);
    await Promise.all([page.waitForURL(/page2\.html$/), page.keyboard.press("Shift+L")]);
  });
});

test.describe("clicking", () => {
  test("f + label follows a link", async ({ page }) => {
    await open(page);
    await page.keyboard.press("f");
    expect(await mode(page)).toBe("hints");
    await page.screenshot({ path: "test-results/firefox-hints.png" });
    const label = await hintFor(page, "#link-page2");
    expect(label).toBeTruthy();
    await Promise.all([page.waitForURL(/page2\.html$/), type(page, label.split(""))]);
  });

  test("f clicks buttons; f on an input enters Insert", async ({ page }) => {
    await open(page);
    await page.keyboard.press("f");
    await type(page, (await hintFor(page, "#btn")).split(""));
    await expect(page.locator("#btn")).toHaveText("clicked 1");
    await page.keyboard.press("f");
    await type(page, (await hintFor(page, "#text-input")).split(""));
    expect(await mode(page)).toBe("insert");
    await page.keyboard.type("jk");
    await expect(page.locator("#text-input")).toHaveValue("jk");
    await page.keyboard.press("Escape");
    expect(await mode(page)).toBe("normal");
  });

  test("F opens the link in a new tab", async ({ page, background }) => {
    await open(page);
    await page.keyboard.press("Shift+F");
    await type(page, (await hintFor(page, "#link-blank")).split(""));
    await expect.poll(() => background(() => browser.tabs.query({}).then((t) => t.map((x) => x.url).filter((u) => u.includes("page2.html?new"))))).toHaveLength(1);
  });

  test("clicking into a text box hands the keyboard to the page", async ({ page }) => {
    await open(page);
    await page.click("#text-input");
    expect(await mode(page)).toBe("insert");
    await page.keyboard.type("hjkl");
    await expect(page.locator("#text-input")).toHaveValue("hjkl");
    expect(await scrollY(page)).toBe(0);
  });
});

test.describe("find", () => {
  test("/ needle, Enter, n / N", async ({ page }) => {
    await open(page);
    await page.keyboard.press("/");
    expect(await mode(page)).toBe("find");
    await page.keyboard.type("needle");
    await expect.poll(() => hud(page, (r) => r.querySelector(".findbar .count").textContent)).toBe("[1/5]");
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => getSelection().toString())).toBe("Needle");
    await page.keyboard.press("n");
    await page.keyboard.press("n");
    expect(await toast(page)).toContain("[3/5]");
    await page.keyboard.press("Shift+N");
    expect(await toast(page)).toContain("[2/5]");
  });
});

test.describe("tabs", () => {
  test("t opens a tab; J / K cycle", async ({ page, newTab, background }) => {
    await open(page, "long.html?1");
    const p2 = await newTab("long.html?2");
    await p2.bringToFront();
    await expect.poll(() => activeTabUrl(background)).toMatch(/\?2$/);
    await p2.keyboard.press("Shift+J"); // wraps to 1
    await expect.poll(() => activeTabUrl(background)).toMatch(/\?1$/);
    await page.bringToFront();
    await page.keyboard.press("Shift+K");
    await expect.poll(() => activeTabUrl(background)).toMatch(/\?2$/);
    await p2.bringToFront();
    const before = await tabCount(background);
    await p2.keyboard.press("t");
    await expect.poll(() => tabCount(background)).toBe(before + 1);
  });

  test("yy copies the page address", async ({ page }) => {
    await open(page);
    await type(page, ["y", "y"]);
    await expect.poll(() => toast(page)).toContain("Yanked");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${BASE}/long.html`);
  });
});

test.describe("help", () => {
  test("? lists the keys; search filters; Esc closes", async ({ page }) => {
    await open(page);
    await page.keyboard.press("?");
    await expect.poll(() => hud(page, (r) => r.querySelectorAll(".help-row").length)).toBeGreaterThan(20);
    await page.keyboard.type("tab");
    await expect.poll(() => hud(page, (r) => [...r.querySelectorAll(".help-row .text")].every((t) => /tab/i.test(t.textContent)))).toBe(true);
    await page.keyboard.press("Escape");
    expect(await hud(page, (r) => !!r.querySelector(".help"))).toBe(false);
  });
});

test.describe("command bar", () => {
  test(": suggests commands with descriptions", async ({ page }) => {
    await open(page);
    await page.keyboard.press(":");
    expect(await mode(page)).toBe("command");
    await page.keyboard.type("tab");
    await expect.poll(() => hud(page, (r) => r.querySelector(".suggestions li")?.dataset.name)).toBe("tabdo");
    await page.screenshot({ path: "test-results/firefox-palette.png" });
    await page.keyboard.press("Escape");
    expect(await mode(page)).toBe("normal");
  });

  test(":tabdo close previews, closes, and u brings the tabs back", async ({ page, newTab, background }) => {
    await open(page);
    for (const q of ["a", "b"]) await newTab(`page2.html?${q}`);
    await page.bringToFront();
    expect(await tabCount(background)).toBe(3);
    await ex(page, "tabdo close *page2.html*");
    await expect.poll(() => hud(page, (r) => r.querySelector(".preview .title")?.textContent)).toContain("This will close 2 tabs");
    await page.keyboard.press("Enter");
    await expect.poll(() => tabCount(background)).toBe(1);
    await expect.poll(() => toast(page)).toContain("Closed 2 tabs");
    await page.keyboard.press("u");
    await expect.poll(() => tabCount(background)).toBe(3);
  });

  test(":g/pattern/pin", async ({ page, newTab, background }) => {
    await open(page);
    await newTab("page2.html");
    await page.bringToFront();
    await ex(page, "g/page two/pin");
    await expect.poll(() => background(() => browser.tabs.query({ pinned: true }).then((t) => t.map((x) => new URL(x.url).pathname)))).toEqual(["/page2.html"]);
  });

  test(":vsp opens a second window beside this one", async ({ page, background }) => {
    await open(page);
    await ex(page, "vsp");
    await expect.poll(() => background(() => browser.windows.getAll().then((w) => w.length))).toBe(2);
  });
});

test.describe("visual mode", () => {
  test("v, h, d hides; u restores; y copies Markdown", async ({ page }) => {
    await open(page, "visual.html");
    await page.click("#p2");
    await page.keyboard.press("v");
    expect(await mode(page)).toBe("visual");
    await page.keyboard.press("d");
    await expect(page.locator("#p2")).toBeHidden();
    await page.keyboard.press("u");
    await expect(page.locator("#p2")).toBeVisible();
    await page.keyboard.press("y");
    await expect.poll(() => toast(page)).toContain("of Markdown");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Second para.");
    await page.keyboard.press("Escape");
    expect(await mode(page)).toBe("normal");
  });
});

test.describe("macros", () => {
  test("qa j 2j q, then @a replays", async ({ page, background }) => {
    await open(page);
    await type(page, ["q", "a"]);
    await type(page, ["j", "2", "j"]);
    await waitScroll(page, (y) => y === 180);
    await page.keyboard.press("q");
    await expect.poll(() => background(() => browser.storage.local.get("macros").then((r) => r.macros?.a?.keys.join("")))).toBe("j2j");
    await type(page, ["@", "a"]);
    expect(await waitScroll(page, (y) => y === 360)).toBe(360);
  });
});

test.describe("pausing", () => {
  test("pausing the site removes the HUD and gives keys back; resuming restores it", async ({ page, background }) => {
    await open(page);
    await background(() => browser.storage.sync.set({ pausedSites: ["localhost"] }));
    await expect.poll(() => page.evaluate(() => !!document.querySelector("panemux-hud"))).toBe(false);
    const tabId = await background(() => browser.tabs.query({ url: "http://localhost/*" }).then((t) => t[0].id));
    await expect.poll(() => background((id) => browser.action.getBadgeText({ tabId: id }), tabId)).toBe("II");
    await page.keyboard.press("j");
    expect(await page.evaluate(() => window.pageKeys)).toContain("j");
    await background(() => browser.storage.sync.set({ pausedSites: [] }));
    await expect.poll(() => page.evaluate(() => !!document.querySelector("panemux-hud"))).toBe(true);
  });
});

test.describe("settings page", () => {
  test("renders presets and keys; picking a preset saves it", async ({ ff }) => {
    await ff.background((u) => browser.tabs.create({ url: u }), `${EXT_ORIGIN}/options/options.html`);
    const s = await ff.extPage("options/");
    await expect.poll(() => s(() => document.querySelectorAll("#keys tr:not(.group)").length)).toBeGreaterThan(30);
    await s(() => document.querySelector('.preset[data-preset="classic"]').click());
    await expect.poll(() => ff.background(() => browser.storage.sync.get("preset").then((r) => r.preset))).toBe("classic");
  });
});

test.describe("text objects", () => {
  test("yap copies the paragraph at the cursor; dap hides it; u restores", async ({ page }) => {
    await open(page, "textobjects.html");
    await page.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.getElementById("kw"));
      r.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await type(page, ["y", "a", "p"]);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("PaneMux treats the page like a document. The **needle** is in this paragraph.");
    await type(page, ["d", "a", "p"]);
    await expect(page.locator("#p-intro")).toBeHidden();
    await expect.poll(() => toast(page)).toContain("Hid paragraph");
    expect(await waitScroll(page, (y) => y === 0)).toBe(0);
    await page.keyboard.press("u");
    await expect(page.locator("#p-intro")).toBeVisible();
  });

  test("cit edits in place and Esc finishes", async ({ page }) => {
    await open(page, "textobjects.html");
    await page.click("#p-usage");
    await type(page, ["c", "i", "t"]);
    expect(await mode(page)).toBe("insert");
    await page.keyboard.type("Changed");
    await page.keyboard.press("Escape");
    await expect(page.locator("#p-usage")).toHaveText("Changed");
  });
});
