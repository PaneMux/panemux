// Marks: m{a-z} sets a page-local mark (persisted per URL), m{A-Z} a global
// mark (URL + position, jumps across tabs). `{mark} jumps; `` (or `')
// returns to the position before the last jump.
PaneMux.Marks = (() => {
  let previous = null; // position before the last jump, for ``

  const pageKey = () => "marks:" + location.href.split("#")[0];
  const isLocal = (c) => /^[a-z]$/.test(c);
  const isGlobal = (c) => /^[A-Z]$/.test(c);

  function loadLocal() {
    return new Promise((resolve) => chrome.storage.local.get(pageKey(), (r) => resolve((r && r[pageKey()]) || {})));
  }

  async function set(char) {
    const pos = PaneMux.Scroll.position();
    if (isLocal(char)) {
      const marks = await loadLocal();
      marks[char] = pos;
      await chrome.storage.local.set({ [pageKey()]: marks });
      PaneMux.HUD.toast(`Mark '${char}' set`);
    } else if (isGlobal(char)) {
      await chrome.runtime.sendMessage({ type: "marks.setGlobal", mark: char, url: location.href, x: pos.x, y: pos.y });
      PaneMux.HUD.toast(`Global mark '${char}' set`);
    } else {
      PaneMux.HUD.toast(`Invalid mark '${char}' (use a-z or A-Z)`, { error: true });
    }
  }

  function jumpTo(pos) {
    previous = PaneMux.Scroll.position();
    PaneMux.Scroll.to(pos);
  }

  async function jump(char) {
    if (char === "`" || char === "'") {
      if (!previous) { PaneMux.HUD.toast("No previous position", { error: true }); return; }
      jumpTo(previous);
      return;
    }
    if (isLocal(char)) {
      const pos = (await loadLocal())[char];
      if (!pos) { PaneMux.HUD.toast(`Mark '${char}' not set`, { error: true }); return; }
      jumpTo(pos);
    } else if (isGlobal(char)) {
      const res = await chrome.runtime.sendMessage({ type: "marks.jumpGlobal", mark: char });
      if (!res || !res.ok) PaneMux.HUD.toast(`Mark '${char}' not set`, { error: true });
    } else {
      PaneMux.HUD.toast(`Invalid mark '${char}'`, { error: true });
    }
  }

  // Background asks us to scroll after a global-mark jump landed on this tab.
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg && msg.type === "marks.scrollTo") {
      jumpTo({ x: msg.x, y: msg.y });
      PaneMux.HUD.toast(`Jumped to mark '${msg.mark}'`);
      reply({ ok: true });
    }
  });

  return { set, jump };
})();
