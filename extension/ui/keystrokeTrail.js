// Keystroke trail: the last few keys PaneMux handled, as small chips in the
// bottom-left that fade and drift up over 1.2s. Only keys PaneMux consumed are
// shown, never text typed into the page or into our own inputs.
PaneMux.Trail = (() => {
  const MAX = 6;
  const box = PaneMux.HUD.el("div", "trail");
  box.setAttribute("aria-hidden", "true");

  // "<c-d>" -> "Ctrl-d", "<esc>" -> "Esc", "<space>" -> "Space"
  function pretty(key) {
    if (key.length === 1) return key;
    const inner = key.slice(1, -1).split("-");
    const base = inner.pop();
    const names = { esc: "Esc", cr: "Enter", bs: "⌫", tab: "Tab", space: "Space", up: "↑", down: "↓", left: "←", right: "→", del: "Del" };
    const mods = inner.map((m) => ({ c: "Ctrl", a: "Alt", m: "Cmd", s: "Shift" }[m] || m));
    return [...mods, names[base] || base].join("-");
  }

  function push(key) {
    if (!PaneMux.Features.enabled("trail")) return;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = pretty(key);
    chip.addEventListener("animationend", () => chip.remove());
    setTimeout(() => chip.remove(), 1400); // reduced motion: no animationend
    box.appendChild(chip);
    while (box.children.length > MAX) box.firstChild.remove();
  }

  return { push, pretty };
})();
