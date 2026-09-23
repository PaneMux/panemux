// Feature presets (panemux-ux-guidelines.md, "Progressive Disclosure").
//
//   Classic (default)  Tier 0 only: moving, link hints, find, history, marks, tabs
//   Power User         everything
//   Custom             pick features one by one
//
// Bindings whose command belongs to a disabled feature are invisible to the
// key FSM: the key goes to the page as if PaneMux didn't bind it.
PaneMux.Features = (() => {
  const LIST = [
    { id: "visual",     label: "Visual mode",     desc: "Select page elements with v, hide them, copy them as Markdown" },
    { id: "commandBar", label: "Command bar",     desc: "Type commands after : to act on many tabs at once" },
    { id: "macros",     label: "Macros",          desc: "Record a sequence of keys with q and replay it with @" },
    { id: "registers",  label: "Tab registers",   desc: "Save groups of tabs and reopen them later" },
    { id: "undo",       label: "Undo history",    desc: "u and Ctrl-r for closed tabs, hidden elements and form edits" },
    { id: "splits",     label: "Splits",          desc: "Put two windows side by side and jump between them" },
    { id: "trail",      label: "Keystroke trail", desc: "Show the keys you press in the bottom-left corner" },
  ];
  const PRESETS = {
    classic: Object.fromEntries(LIST.map((f) => [f.id, false])),
    power: Object.fromEntries(LIST.map((f) => [f.id, true])),
  };

  // command name -> feature; anything unlisted is core (always on)
  const BY_COMMAND = {
    visualEnter: "visual",
    commandBar: "commandBar",
    macroRecord: "macros", macroPlay: "macros",
    tabOverview: "registers", selectRegister: "registers", putTabs: "registers",
    undo: "undo", redo: "undo", undoBack: "undo", undoFwd: "undo", undoPanel: "undo",
    splitFocus_h: "splits", splitFocus_j: "splits", splitFocus_k: "splits", splitFocus_l: "splits",
    splitCycle: "splits", splitClose: "splits",
  };

  function current() {
    const preset = PaneMux.Settings.get("preset") || "classic";
    if (PRESETS[preset]) return PRESETS[preset];
    return { ...PRESETS.classic, ...(PaneMux.Settings.get("features") || {}) };
  }

  const enabled = (id) => !id || id === "core" || !!current()[id];
  const forCommand = (command) => BY_COMMAND[command] || "core";
  const commandEnabled = (command) => enabled(forCommand(command));

  // Modes other than Normal are only reachable through a feature's entry key,
  // so their bindings don't need gating one by one.
  if (PaneMux.Keys && PaneMux.Keys.setFilter) {
    PaneMux.Keys.setFilter((binding) => binding.mode !== "normal" || commandEnabled(binding.command));
  }

  return { LIST, PRESETS, BY_COMMAND, current, enabled, forCommand, commandEnabled };
})();
