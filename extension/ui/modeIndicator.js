// Mode orb (bottom-right) + pending-keys readout. Glows in the current
// mode's color and pulses on every mode switch.
PaneMux.ModeIndicator = (() => {
  const orb = PaneMux.HUD.el("div", "orb");
  const pending = PaneMux.HUD.el("div", "pending panel");

  function render(mode) {
    const info = PaneMux.Modes.info(mode);
    orb.textContent = info.label;
    orb.dataset.mode = mode;
    orb.title = `PaneMux — ${mode} mode`;
    PaneMux.HUD.setModeColor(info.color);
  }

  function pulse() {
    orb.classList.remove("pulse");
    void orb.offsetWidth; // restart the animation
    orb.classList.add("pulse");
  }
  orb.addEventListener("animationend", () => orb.classList.remove("pulse"));

  PaneMux.Modes.onChange((mode) => { render(mode); pulse(); });
  PaneMux.Keys.onPending((p) => { pending.textContent = p; });

  function setVisible(show) { orb.hidden = !show; }

  render(PaneMux.Modes.current);
  return { orb, render, pulse, setVisible };
})();
