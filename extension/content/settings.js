// Shared namespace for all PaneMux content-script modules. Content scripts
// share one isolated world per frame, so plain globals are private to us.
window.PaneMux = window.PaneMux || {};

PaneMux.Settings = (() => {
  const DEFAULTS = {
    theme: "terminal",        // "terminal" | "classic"
    showModeOrb: true,
    smoothScroll: true,
    scrollStep: 60,           // px per j/k/h/l
    hintChars: "sadfjklewcmpgh",
    openNewTabInBackground: true, // F opens links in a background tab (Vimium default)
    ambiguousTimeout: 1000,   // ms to wait when a key is both a full binding and a prefix
    uKey: "undo",             // Normal-mode u: "undo" (Vim, Phase 4) or "scroll" (Vimium half page up)
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
