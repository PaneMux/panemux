// Splits: :sp / :vsp, and moving between / closing them.
//
// NOTE: a single tab can't render two pages side by side. The "obvious"
// in-page approach — two <iframe>s in one tab — fails on most real sites:
// anything sending `X-Frame-Options: DENY/SAMEORIGIN` or a CSP
// `frame-ancestors` directive (Google, GitHub, banks, social sites…) refuses
// to load framed. So a split here is two real browser windows positioned
// edge to edge with chrome.windows, which works on every site.
//
// Chrome reserves Ctrl+W (close tab) — pages and extensions can't intercept
// it — so Vim's <C-w> prefix is `W` here: Wh/Wj/Wk/Wl focus, Wc close, Ww cycle.

const GROUPS = "splitGroups"; // storage.session: [{ ids: [a, b], bounds, vertical }]

const getGroups = async () => (await chrome.storage.session.get(GROUPS))[GROUPS] || [];
const setGroups = (groups) => chrome.storage.session.set({ [GROUPS]: groups });

// `screen` is the page's screen.avail* (the service worker can't see the
// display without the system.display permission); Chrome rejects windows
// that are mostly off-screen, so the split is clamped to that work area.
export async function split(vertical, args, { tab, screen }) {
  let win = await chrome.windows.get(tab.windowId);
  if (win.state !== "normal") {
    await chrome.windows.update(win.id, { state: "normal" });
    win = await chrome.windows.get(win.id);
  }
  let { left = 0, top = 0, width = 1200, height = 800 } = win;
  if (screen && screen.width > 0 && screen.height > 0) {
    const l = Math.max(left, screen.left), t = Math.max(top, screen.top);
    const r = Math.min(left + width, screen.left + screen.width), b = Math.min(top + height, screen.top + screen.height);
    // Mostly off-screen window: split the whole work area instead.
    if ((r - l) * (b - t) < 0.5 * width * height) ({ left, top, width, height } = screen);
    else ({ left, top, width, height } = { left: l, top: t, width: r - l, height: b - t });
  }
  const url = args ? (/^[a-z][\w+.-]*:/i.test(args) ? args : `https://${args}`) : tab.url;
  let a, b;
  if (vertical) {
    const w = Math.floor(width / 2);
    a = { left, top, width: w, height };
    b = { left: left + w, top, width: width - w, height };
  } else {
    const h = Math.floor(height / 2);
    a = { left, top, width, height: h };
    b = { left, top: top + h, width, height: height - h };
  }
  await chrome.windows.update(win.id, a);
  const created = await chrome.windows.create({ url, focused: true, type: "normal", ...b });
  // Chrome may size a new window from its defaults instead; pin the bounds.
  await chrome.windows.update(created.id, b);
  const groups = (await getGroups()).filter((g) => !g.ids.includes(win.id));
  groups.push({ ids: [win.id, created.id], bounds: { left, top, width, height }, vertical });
  await setGroups(groups);
  return { message: `${vertical ? "vsplit" : "split"}: ${url}`, windowId: created.id };
}

const center = (w) => ({ x: w.left + w.width / 2, y: w.top + w.height / 2 });

// Nearest window in a direction (h/j/k/l), by window centres.
export async function focusDirection(dir, fromWindowId) {
  const wins = (await chrome.windows.getAll({ windowTypes: ["normal"] })).filter((w) => w.state !== "minimized");
  const cur = wins.find((w) => w.id === fromWindowId);
  if (!cur) return { ok: false, error: "No current window" };
  const c = center(cur);
  const axis = { h: ["x", -1], l: ["x", 1], k: ["y", -1], j: ["y", 1] }[dir];
  if (!axis) return { ok: false, error: `Bad direction ${dir}` };
  const [main, sign] = axis;
  const cross = main === "x" ? "y" : "x";
  let best = null, bestScore = Infinity;
  for (const w of wins) {
    if (w.id === cur.id) continue;
    const p = center(w);
    const d = (p[main] - c[main]) * sign;
    if (d <= 1) continue;
    const score = d + 2 * Math.abs(p[cross] - c[cross]);
    if (score < bestScore) { best = w; bestScore = score; }
  }
  if (!best) return { ok: false, error: "No split in that direction" };
  await chrome.windows.update(best.id, { focused: true });
  return { ok: true, windowId: best.id };
}

// Ww: next window (by position, left-to-right then top-to-bottom), wrapping.
export async function cycle(fromWindowId) {
  const wins = (await chrome.windows.getAll({ windowTypes: ["normal"] }))
    .filter((w) => w.state !== "minimized")
    .sort((a, b) => a.left - b.left || a.top - b.top || a.id - b.id);
  if (wins.length < 2) return { ok: false, error: "Only one window" };
  const i = wins.findIndex((w) => w.id === fromWindowId);
  const next = wins[(i + 1) % wins.length];
  await chrome.windows.update(next.id, { focused: true });
  return { ok: true, windowId: next.id };
}

// Wc: close this split window; its partner takes back the whole area.
export async function closeSplit(windowId) {
  const groups = await getGroups();
  const g = groups.find((x) => x.ids.includes(windowId));
  const all = await chrome.windows.getAll({ windowTypes: ["normal"] });
  if (all.length < 2) return { ok: false, error: "Won't close the last window" };
  await chrome.windows.remove(windowId);
  if (g) {
    const partner = g.ids.find((id) => id !== windowId);
    await chrome.windows.update(partner, { ...g.bounds, focused: true }).catch(() => {});
    await setGroups(groups.filter((x) => x !== g));
  }
  return { ok: true };
}

// Forget groups whose windows are gone. (Guarded so unit tests can import this.)
globalThis.chrome?.windows?.onRemoved.addListener(async (id) => {
  const groups = await getGroups();
  const left = groups.filter((g) => !g.ids.includes(id));
  if (left.length !== groups.length) await setGroups(left);
});
