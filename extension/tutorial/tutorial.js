// First-run tutorial (panemux-ux-guidelines.md §1): one practice page, four
// lessons, each waiting for the real keypresses before moving on. Every
// lesson lists its goals as keycaps that light up as they're done. Skippable
// any time; re-run it from Settings or the toolbar menu.
(() => {
  const $ = (id) => document.getElementById(id);
  const kbd = (k) => `<kbd>${k}</kbd>`;

  // goals: [id, keys shown as keycaps, caption]. setup(next, mark) marks goals
  // as they happen and calls next() when the lesson is complete.
  const STEPS = [
    {
      title: "Scroll with the keyboard",
      short: "Scroll",
      text: `PaneMux moves the page with single keys. ${kbd("h")} and ${kbd("l")} go sideways the same way.`,
      try: `Press ${kbd("j")} to scroll down, then ${kbd("k")} to scroll back up.`,
      done: "Nice — that's scrolling.",
      goals: [["j", ["j"], "Scroll down"], ["k", ["k"], "Scroll up"]],
      setup(next, mark) {
        let down = false;
        return PaneMux.Keys.onDispatch((ctx) => {
          if (ctx.binding.command === "scrollDown") { down = true; mark("j"); }
          if (ctx.binding.command === "scrollUp" && down) { mark("k"); next(); }
        });
      },
    },
    {
      title: "Click links without the mouse",
      short: "Click links",
      text: `${kbd("f")} puts a few letters on every link and button. Type the letters and PaneMux clicks it.`,
      try: `Press ${kbd("f")}, then type the letters shown on <b>“Open the next lesson”</b>.`,
      done: "That's link hints. Press Esc any time to back out of them.",
      goals: [["f", ["f"], "Show hints"], ["hint", ["a", "b"], "Type its letters"]],
      spotlight: "#lesson-link",
      setup(next, mark) {
        const offKeys = PaneMux.Keys.onDispatch((ctx) => { if (ctx.binding.command === "linkHints") mark("f"); });
        const offHint = PaneMux.Bus.on("hint", ({ el }) => { if (el.id === "lesson-link") { mark("f"); mark("hint"); next(); } });
        return () => { offKeys && offKeys(); offHint && offHint(); };
      },
    },
    {
      title: "Type in a text box",
      short: "Type in a box",
      text: "When you're in a text box, PaneMux steps aside and your keys type normally — the status bar at the bottom says Insert.",
      try: `Click the “Say hello” box (or press ${kbd("g")}${kbd("i")}), type anything, then press ${kbd("Esc")} to leave it.`,
      done: "Esc always gets you back.",
      goals: [["in", ["g", "i"], "Jump into the box"], ["type", ["Aa"], "Type something"], ["out", ["Esc"], "Leave it"]],
      spotlight: ".field",
      setup(next, mark) {
        let typed = false;
        const input = $("practice-input");
        const onInput = () => {
          typed = input.value.trim().length > 0;
          if (typed) mark("type");
        };
        input.addEventListener("input", onInput);
        const off = PaneMux.Modes.onChange((mode, prev) => {
          if (mode === "insert") mark("in");
          if (prev === "insert" && mode === "normal" && typed) { mark("out"); next(); }
        });
        return () => { input.removeEventListener("input", onInput); off && off(); };
      },
    },
    {
      title: "Find every other key",
      short: "Get help",
      text: "You don't need to memorise anything. Help lists every key that's switched on, in plain English, with a search box.",
      try: `Press ${kbd("?")} to open help, then ${kbd("Esc")} to close it.`,
      done: "",
      goals: [["open", ["?"], "Open help"], ["close", ["Esc"], "Close it"]],
      setup(next, mark) {
        let opened = false;
        const timer = setInterval(() => {
          if (PaneMux.Help.isOpen) { opened = true; mark("open"); }
          else if (opened) { mark("close"); next(); }
        }, 100);
        return () => clearInterval(timer);
      },
    },
  ];

  let index = 0;
  let teardown = null;
  const passed = new Set(); // lessons finished (not skipped)

  function renderProgress() {
    const ol = $("progress");
    ol.textContent = "";
    STEPS.forEach((s, i) => {
      const li = document.createElement("li");
      li.className = i < index ? (passed.has(i) ? "done" : "skipped") : i === index ? "now" : "";
      if (i === index) li.setAttribute("aria-current", "step");
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = i < index && passed.has(i) ? "✓" : String(i + 1);
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = s.short;
      li.append(n, t);
      ol.appendChild(li);
    });
    const pct = Math.round((Math.min(index, STEPS.length) / STEPS.length) * 100);
    $("bar-fill").style.width = `${pct}%`;
  }

  function renderGoals(s) {
    const ul = $("goals");
    ul.textContent = "";
    for (const [id, keys, caption] of s.goals || []) {
      const li = document.createElement("li");
      li.className = "goal";
      li.dataset.goal = id;
      const caps = document.createElement("span");
      caps.className = "caps";
      // The hint letters differ every time, so show placeholders dimmed.
      for (const k of keys) {
        const c = document.createElement("span");
        c.className = id === "hint" ? "keycap ghost" : "keycap";
        c.textContent = id === "hint" ? "·" : k;
        c.dataset.key = k;
        caps.appendChild(c);
      }
      const cap = document.createElement("span");
      cap.className = "caption";
      cap.textContent = caption;
      li.append(caps, cap);
      ul.appendChild(li);
    }
    nextGoal();
  }

  // The first unfinished goal gets a gentle pulse.
  function nextGoal() {
    const goals = [...document.querySelectorAll(".goal")];
    goals.forEach((g) => g.classList.remove("current"));
    const first = goals.find((g) => !g.classList.contains("met"));
    if (first) first.classList.add("current");
  }

  function mark(id) {
    const g = document.querySelector(`.goal[data-goal="${id}"]`);
    if (!g || g.classList.contains("met")) return;
    g.classList.add("met");
    nextGoal();
  }

  function spotlight(sel) {
    document.querySelectorAll(".spotlight").forEach((el) => el.classList.remove("spotlight"));
    if (sel) document.querySelector(sel).classList.add("spotlight");
  }

  function show(i) {
    index = i;
    renderProgress();
    const s = STEPS[i];
    const card = $("card");
    card.classList.remove("passed");
    card.dataset.step = String(i + 1);
    $("step-count").textContent = `Lesson ${i + 1} of ${STEPS.length}`;
    $("step-title").textContent = s.title;
    $("step-text").innerHTML = s.text;
    $("step-try").innerHTML = `<span class="try-label">Try it</span> ${s.try}`;
    $("step-done").hidden = true;
    renderGoals(s);
    spotlight(s.spotlight);
    if (teardown) teardown();
    let moved = false;
    teardown = s.setup(() => {
      if (moved) return;
      moved = true;
      pass(s);
    }, mark);
  }

  function pass(s) {
    passed.add(index);
    const card = $("card");
    card.classList.add("passed");
    if (s.done) { $("step-done").textContent = `✓ ${s.done}`; $("step-done").hidden = false; }
    setTimeout(advance, s.done ? 900 : 200);
  }

  const advance = () => (index + 1 < STEPS.length ? show(index + 1) : finish());

  async function markDone(how) {
    await chrome.storage.local.set({ onboarding: { done: true, how, time: Date.now() } });
  }

  function finish() {
    if (teardown) teardown();
    teardown = null;
    index = STEPS.length;
    renderProgress();
    spotlight(null);
    const card = $("card");
    card.dataset.step = "done";
    card.classList.add("passed", "finished");
    $("step-count").textContent = "All done";
    $("step-title").textContent = "You're set";
    $("step-text").innerHTML = `That's everything you need for day one. Press ${kbd("?")} anytime to see more.`;
    $("step-try").textContent = "";
    $("step-done").hidden = true;
    $("goals").textContent = "";
    $("card-foot").hidden = true;
    $("cheats").hidden = false;
    $("finish").hidden = false;
    $("skip").hidden = true;
    markDone("finished");
  }

  // The lesson link shouldn't navigate anywhere.
  document.querySelectorAll("[data-demo]").forEach((a) => a.addEventListener("click", (e) => e.preventDefault()));

  $("skip").addEventListener("click", async () => {
    await markDone("skipped");
    window.close();
  });
  $("skip-step").addEventListener("click", (e) => {
    e.currentTarget.blur();
    advance();
  });
  $("close").addEventListener("click", () => window.close());
  $("open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

  show(0);
  window.PaneMuxTutorial = { get step() { return index; }, show, finish };
})();
