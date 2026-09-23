// Inline preview for destructive actions: "This will close 4 tabs matching
// 'twitter.com' — Enter to confirm, Esc to cancel". Not a modal dialog: the
// page stays usable, the panel just holds the keyboard until answered.
PaneMux.Preview = (() => {
  let current = null;

  // ask({ message, items, more }) -> Promise<boolean>
  function ask({ message, items = [], more = 0, confirmLabel = "Close tabs" }) {
    if (current) current.finish(false);
    return new Promise((resolve) => {
      PaneMux.HUD.attach();
      const panel = PaneMux.HUD.el("div", "preview panel");
      panel.setAttribute("role", "alertdialog");
      PaneMux.HUD.el("div", "title", panel).textContent = message;
      const list = PaneMux.HUD.el("ul", "", panel);
      for (const it of items) PaneMux.HUD.el("li", "", list).textContent = it;
      if (more) PaneMux.HUD.el("li", "", list).textContent = `…and ${more} more`;
      const keys = PaneMux.HUD.el("div", "keys", panel);
      keys.append("Press ");
      PaneMux.HUD.el("kbd", "", keys).textContent = "Enter";
      keys.append(" to confirm, ");
      PaneMux.HUD.el("kbd", "", keys).textContent = "Esc";
      keys.append(" to cancel · ");
      const yes = PaneMux.HUD.el("button", "action", keys);
      yes.type = "button";
      yes.textContent = confirmLabel;
      const no = PaneMux.HUD.el("button", "action", keys);
      no.type = "button";
      no.textContent = "Cancel";

      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        panel.remove();
        current = null;
        if (PaneMux.Modes.handler === handler) PaneMux.Modes.enter("normal");
        resolve(ok);
      };
      yes.addEventListener("click", () => finish(true));
      no.addEventListener("click", () => finish(false));
      const handler = {
        onKey(key) {
          if (key === "<cr>" || key === "y") finish(true);
          else if (key === "<esc>" || key === "n" || key === "q") finish(false);
          return "handled";
        },
        onExit: () => finish(false),
      };
      current = { finish };
      PaneMux.Modes.enter("normal", handler);
    });
  }

  return { ask, get open() { return !!current; } };
})();
