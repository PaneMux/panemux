// User key remapping. Settings store overrides keyed by the *default*
// binding ("normal:J" -> "L", or "" to switch a key off), so "reset to
// default" is just deleting the entry. Loaded after every module has
// registered its default keys.
PaneMux.Keymap = (() => {
  const MODES = ["normal", "visual"];
  const idOf = (b) => `${b.mode}:${b.keys}`;

  // Snapshot of the defaults, before any user override touches them.
  const defaults = MODES.flatMap((mode) => PaneMux.Keys.bindings(mode).map((b) => ({ ...b })));
  const byId = new Map(defaults.map((b) => [idOf(b), b]));
  let applied = []; // [{ def, keys }]

  const opts = ({ command, keys, mode, ...rest }) => rest;

  function reset() {
    for (const { def, keys } of applied) {
      if (keys) PaneMux.Keys.unmap(def.mode, keys);
      PaneMux.Keys.map(def.mode, def.keys, def.command, opts(def));
    }
    applied = [];
  }

  function apply(overrides = {}) {
    reset();
    for (const [id, keys] of Object.entries(overrides)) {
      const def = byId.get(id);
      if (!def || keys === def.keys) continue;
      PaneMux.Keys.unmap(def.mode, def.keys);
      if (keys) PaneMux.Keys.map(def.mode, keys, def.command, opts(def));
      applied.push({ def, keys });
    }
  }

  // Another binding in the same mode already using exactly these keys. (A key
  // that's a prefix of another, like g and gg, is fine: the FSM waits.)
  function conflict(id, keys, overrides = {}) {
    const def = byId.get(id);
    if (!def || !keys) return null;
    for (const other of defaults) {
      if (other.mode !== def.mode || idOf(other) === id) continue;
      const theirs = idOf(other) in overrides ? overrides[idOf(other)] : other.keys;
      if (theirs === keys) return other;
    }
    return null;
  }

  if (!PaneMux.registryOnly) {
    PaneMux.Settings.ready.then(() => apply(PaneMux.Settings.get("keyOverrides")));
    PaneMux.Settings.onChange((s) => apply(s.keyOverrides));
  }

  return { defaults, idOf, apply, conflict, byId };
})();
