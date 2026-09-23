# Contributing to PaneMux

Thanks for taking a look. PaneMux is a small project, so the process is light.

## Getting set up

```sh
npm install
npx playwright install chromium
npm test
```

Load `extension/` unpacked from `chrome://extensions` (Developer mode on) to try your changes by hand.
After editing, click ↻ on the extension card and reload the page you're testing on.

## Where things live

- `extension/content/keyHandler.js` — the key state machine. New keys go through `PaneMux.Keys.defineCommand`
  and `PaneMux.Keys.map`; don't add a second keydown listener.
- `extension/content/commands.js` — the Normal-mode command set and default keymap.
- `extension/background/commandRegistry.js` — `:` ex commands. Add one with `registerCommand`.
- `extension/background/` — anything that needs `chrome.tabs` / `chrome.windows` / storage quotas.
- `extension/ui/` — the HUD. All of it renders inside one shadow root, so page CSS can't touch it.

The design and roadmap are in `panemux-spec.md`. If you want to build something big, open an issue first
so we can agree on the keys. Key collisions are the usual sticking point.

## Tests

Every keybinding should have an end-to-end test that presses the real keys against the loaded
extension (`tests/e2e/`). Pure logic (the FSM, fuzzy matching, the undo tree, sync chunking) gets a
unit test in `tests/unit/`. Run `npm test` before you open a PR. It has to pass.

If a test needs a page, add a small one under `tests/pages/` rather than hitting a real website.

## Style

- Plain JavaScript, no build step for the extension itself, no runtime dependencies.
- Two-space indent, double quotes, semicolons. Match the file you're in.
- Comments explain *why*, not what. Keep them short.
- Never record or store secrets: password, credit-card and one-time-code fields stay out of macros and
  the undo tree.

## Commits and PRs

- One logical change per commit, message in the imperative ("Add :tabonly command", "Fix hint
  labels on scrolled pages").
- Keep PRs focused. A bug fix and a refactor go in separate PRs.
- Describe how you tested it, especially for anything that touches tabs or windows.

By contributing you agree that your work is released under the project's MIT license.
