// Shared namespace for all PaneMux content-script modules. Content scripts
// share one isolated world per frame, so plain globals are private to us.
// (The options page sets PaneMux.registryOnly first: it loads these modules
// just to read the command/key registry, without touching its own page.)
window.PaneMux = window.PaneMux || {};

PaneMux.Settings = (() => {
  const DEFAULTS = {
    // on/off and per-site pause (toolbar button)
    enabled: true,
    pausedSites: [],          // hostnames
    // feature presets (see features.js): "classic" | "power" | "custom"
    preset: "classic",
    features: {},             // per-feature switches, used by the "custom" preset
    keyOverrides: {},         // "mode:defaultKeys" -> new keys ("" disables)
    // look
    indicator: "auto",        // "auto" (status strip, pill when it would clash) | "pill"
    modeHints: true,          // "Insert mode — Esc to exit" for the first few switches
    scanlines: false,         // opt-in CRT easter egg
    // behaviour
    smoothScroll: true,
    scrollStep: 60,           // px per j/k/h/l
    hintChars: "sadfjklewcmpgh",
    openNewTabInBackground: true, // F opens links in a background tab (Vimium default)
    ambiguousTimeout: 1000,   // ms to wait when a key is both a full binding and a prefix
    uKey: "undo",             // with undo on: "undo" or "scroll" (Vimium's half page up)
    confirmBulkClose: true,
    golfSync: false,          // mirror the Vimgolf leaderboard to your other devices   // preview before closing 2+ tabs (always on in Classic)
  };

  let values = { ...DEFAULTS };
  const listeners = [];

  const ready = new Promise((resolve) => {
    try {
      chrome.storage.sync.get(DEFAULTS, (stored) => {
        values = { ...DEFAULTS, ...(stored || {}) };
        resolve(values);
      });
    } catch (e) {
      resolve(values);
    }
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      let touched = false;
      for (const [k, { newValue }] of Object.entries(changes)) {
        if (k in DEFAULTS) {
          values[k] = newValue === undefined ? DEFAULTS[k] : newValue;
          touched = true;
        }
      }
      if (touched) listeners.forEach((fn) => fn(values));
    });
  } catch (e) {}

  return {
    DEFAULTS,
    ready,
    get: (key) => values[key],
    all: () => ({ ...values }),
    onChange: (fn) => listeners.push(fn),
  };
})();
