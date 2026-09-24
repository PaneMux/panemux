// Gentle guidance (panemux-ux-guidelines.md, "Mode Clarity Reinforcement").
//
// Mode hints: the first few times you enter a mode, a small label next to the
// status strip says what it is and how to get out ("Insert mode — Esc to
// exit"). After 5 showings per mode it never appears again. Counts live in
// chrome.storage.local.
//
// Stuck nudge: several keys in a row that do nothing (typing into the page
// while in Normal mode, stray keys in Visual mode…) shows one quiet hint for
// this page load.
PaneMux.Nudges = (() => {
  const MAX_SHOWS = 5;
  const HINTS = {
    insert: "Insert mode — typing goes to the page. Esc to exit",
    visual: "Visual mode — h j k l pick an element. Esc to exit",
    command: "Command bar — type a command. Esc to cancel",
    hints: "Type the letters on a link to click it. Esc to cancel",
    find: "Type to search, Enter to keep it. Esc to cancel",
    tabs: "Tab list — j / k to move. Esc to close",
    outline: "Outline — j / k to move, Enter to go there. Esc to go back",
  };
  const STUCK_KEYS = 6;
  const STUCK_WINDOW = 3000;

  const box = PaneMux.HUD.el("div", "modehint panel");
  box.hidden = true;
  box.setAttribute("role", "status");
  let counts = null;
  let hideTimer = null;
  let stuckShown = false;
  let recent = [];

  const load = () => new Promise((resolve) => {
    if (counts) return resolve(counts);
    try {
      chrome.storage.local.get("modeHintCounts", (r) => resolve((counts = (r && r.modeHintCounts) || {})));
    } catch (e) {
      resolve((counts = {}));
    }
  });

  function show(text, ms = 2600) {
    box.textContent = "";
    PaneMux.HUD.el("span", "dot", box);
    box.append(text);
    box.hidden = false;
    box.classList.remove("out");
    PaneMux.HUD.host.classList.add("pmx-hinting");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      box.classList.add("out");
      hideTimer = setTimeout(hide, 200);
    }, ms);
  }

  function hide() {
    box.hidden = true;
    PaneMux.HUD.host.classList.remove("pmx-hinting");
  }

  async function onMode(mode) {
    if (!HINTS[mode] || PaneMux.Settings.get("modeHints") === false) return;
    const c = await load();
    if ((c[mode] || 0) >= MAX_SHOWS) return;
    c[mode] = (c[mode] || 0) + 1;
    try { chrome.storage.local.set({ modeHintCounts: c }); } catch (e) {}
    if (PaneMux.Modes.current === mode) show(HINTS[mode]);
  }

  function invalidKey() {
    if (stuckShown) return;
    const now = Date.now();
    recent = recent.filter((t) => now - t < STUCK_WINDOW);
    recent.push(now);
    if (recent.length < STUCK_KEYS) return;
    stuckShown = true;
    show(PaneMux.Modes.current === "normal"
      ? "Those keys aren't shortcuts here. Click a text box (or press gi) to type, or press ? for help"
      : "Press Esc to return to Normal mode", 5000);
  }

  PaneMux.Modes.onChange((mode) => {
    if (mode === "normal" && !box.hidden && !stuckShown) hide();
    onMode(mode);
  });

  // Days PaneMux was actually used (a key handled), for the options page's
  // "try Power User" suggestion after ~3 days. Last 30 days only.
  let dayMarked = null;
  function touchDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (dayMarked === today) return;
    dayMarked = today;
    try {
      chrome.storage.local.get("usageDays", (r) => {
        const days = (r && r.usageDays) || [];
        if (!days.includes(today)) chrome.storage.local.set({ usageDays: [...days, today].slice(-30) });
      });
    } catch (e) {}
  }

  return { invalidKey, touchDay, show, HINTS, MAX_SHOWS };
})();
