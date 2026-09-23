// First-run tutorial (panemux-ux-guidelines.md §1): one practice page, four
// steps, each waiting for the real keypress before moving on. Skippable any
// time; re-run it from Settings or the toolbar menu.
(() => {
  const $ = (id) => document.getElementById(id);
  const kbd = (k) => `<kbd>${k}</kbd>`;

  const STEPS = [
    {
      title: "Scroll with the keyboard",
      text: `PaneMux moves the page with single keys. ${kbd("h")} and ${kbd("l")} go sideways the same way.`,
      try: `Try it: press ${kbd("j")} to scroll down, then ${kbd("k")} to scroll back up.`,
      done: "Nice — that's scrolling.",
      setup(next) {
        const seen = new Set();
        return PaneMux.Keys.onDispatch((ctx) => {
          if (ctx.binding.command === "scrollDown") seen.add("j");
          if (ctx.binding.command === "scrollUp" && seen.has("j")) next();
        });
      },
    },
    {
      title: "Click links without the mouse",
      text: `${kbd("f")} puts a few letters on every link and button. Type the letters and PaneMux clicks it.`,
      try: `Try it: press ${kbd("f")}, then type the letters shown on <b>“Open the next lesson”</b>.`,
      done: "That's link hints. Press Esc any time to back out of them.",
      setup(next) {
        return PaneMux.Bus.on("hint", ({ el }) => { if (el.id === "lesson-link") next(); });
      },
    },
    {
      title: "Type in a text box",
      text: "When you're in a text box, PaneMux steps aside and your keys type normally — the status bar at the bottom says Insert.",
      try: `Try it: click the “Say hello” box (or press ${kbd("g")}${kbd("i")}), type anything, then press ${kbd("Esc")} to leave it.`,
      done: "Esc always gets you back.",
      setup(next) {
        let typed = false;
        const input = $("practice-input");
        const onInput = () => { typed = input.value.trim().length > 0; };
        input.addEventListener("input", onInput);
        const off = PaneMux.Modes.onChange((mode, prev) => {
          if (prev === "insert" && mode === "normal" && typed) next();
        });
        return () => { input.removeEventListener("input", onInput); off && off(); };
      },
    },
    {
      title: "Find every other key",
      text: "You don't need to memorise anything. Help lists every key that's switched on, in plain English, with a search box.",
      try: `Try it: press ${kbd("?")} to open help, then ${kbd("Esc")} to close it.`,
      done: "",
      setup(next) {
        let opened = false;
        const timer = setInterval(() => {
          if (PaneMux.Help.isOpen) opened = true;
          else if (opened) next();
        }, 100);
        return () => clearInterval(timer);
      },
    },
  ];

  let index = 0;
  let teardown = null;

  function renderProgress() {
    const ol = $("progress");
    ol.textContent = "";
    STEPS.forEach((_, i) => {
      const li = document.createElement("li");
      li.className = i < index ? "done" : i === index ? "now" : "";
      ol.appendChild(li);
    });
  }

  function show(i) {
    index = i;
    renderProgress();
    const s = STEPS[i];
    const card = $("card");
    card.classList.remove("passed");
    card.dataset.step = String(i + 1);
    $("step-title").textContent = `${i + 1}. ${s.title}`;
    $("step-text").innerHTML = s.text;
    $("step-try").innerHTML = s.try;
    $("step-done").hidden = true;
    if (teardown) teardown();
    let moved = false;
    teardown = s.setup(() => {
      if (moved) return;
      moved = true;
      pass(s);
    });
  }

  function pass(s) {
    const card = $("card");
    card.classList.add("passed");
    if (s.done) { $("step-done").textContent = `✓ ${s.done}`; $("step-done").hidden = false; }
    setTimeout(() => (index + 1 < STEPS.length ? show(index + 1) : finish()), s.done ? 900 : 200);
  }

  async function markDone(how) {
    await chrome.storage.local.set({ onboarding: { done: true, how, time: Date.now() } });
  }

  function finish() {
    if (teardown) teardown();
    teardown = null;
    index = STEPS.length;
    renderProgress();
    const card = $("card");
    card.dataset.step = "done";
    card.classList.add("passed");
    $("step-title").textContent = "You're set";
    $("step-text").innerHTML = `That's everything you need for day one. Press ${kbd("?")} anytime to see more.`;
    $("step-try").textContent = "";
    $("step-done").hidden = true;
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
  $("close").addEventListener("click", () => window.close());
  $("open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

  show(0);
  window.PaneMuxTutorial = { get step() { return index; }, show, finish };
})();
