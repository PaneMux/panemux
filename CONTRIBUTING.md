# Contributing to PaneMux

Thanks for taking a look. PaneMux is a small project, so the process is light.

**A note on AI:** this repo did use some AI assistance during development, yes — but everything is
human-verified before it's merged or pushed. Please keep that in mind while contributing: if you use AI
tools yourself, you're responsible for reading, testing and understanding every line you submit.

## Getting set up

```sh
npm install
npx playwright install chromium firefox
npm test
```

Load `extension/` unpacked from `chrome://extensions` (Developer mode on) to try your changes by hand.
After editing, click ↻ on the extension card and reload the page you're testing on. For Firefox, run
`npm run build` and load `dist/firefox/manifest.json` from `about:debugging` → **Load Temporary Add-on**.

There is one source tree for both browsers. `tools/build.mjs` derives the Firefox build from it: the
background module runs as an event page instead of a service worker, and the manifest gets a gecko id.
Keep using `chrome.*` (Firefox supports it, promises included) and avoid Chrome-only APIs; if you really
need one, feature-check it.

## Releases

`.github/workflows/build.yml` runs the unit tests and builds both packages on every push and pull
request, and runs the end-to-end suites in Chromium and Firefox alongside. Pushes to `main` refresh the
**nightly** pre-release. To cut a release, bump `version` in `extension/manifest.json` and
`package.json`, commit, then tag it: `git tag v0.6.0 && git push origin v0.6.0`. The workflow refuses a
tag that doesn't match the manifest.

## Publishing to addons.mozilla.org

`npm run package:amo` builds `dist/panemux-firefox-<version>.zip` and runs Mozilla's addons-linter on it
(warnings count as failures, since reviewers read them). Upload that zip in the AMO developer hub; the
listing text, reviewer notes, privacy policy and screenshots are in `store/amo/`. Regenerate the
screenshots with `npm run screenshots` (needs `node tests/server.mjs` running) when the HUD changes.
Each new version needs a higher `version`; AMO won't take the same one twice.

## Where things live

- `extension/content/keyHandler.js` — the key state machine. New keys go through `PaneMux.Keys.defineCommand`
  and `PaneMux.Keys.map`; don't add a second keydown listener.
- `extension/content/commands.js` — the Normal-mode command set and default keymap.
- `extension/background/commandRegistry.js` — `:` ex commands. Add one with `registerCommand`.
- `extension/background/` — anything that needs `chrome.tabs` / `chrome.windows` / storage quotas.
- `extension/ui/` — the HUD. All of it renders inside one shadow root, so page CSS can't touch it.

The design and roadmap are in `panemux-spec.md`. `panemux-design-system.md` is the source of truth for
anything visual in the HUD, and `panemux-ux-guidelines.md` for onboarding, defaults and safety UX. If you want to build something big, open an issue first
so we can agree on the keys. Key collisions are the usual sticking point.

## Tests

Every keybinding should have an end-to-end test that presses the real keys against the loaded
extension (`tests/e2e/`). Pure logic (the FSM, fuzzy matching, the undo tree, sync chunking) gets a
unit test in `tests/unit/`. Run `npm test` before you open a PR. It has to pass.

If a test needs a page, add a small one under `tests/pages/` rather than hitting a real website.

`tests/firefox/` runs the same kind of checks in Playwright's Firefox (`npm run test:firefox`). Playwright
can't load Firefox add-ons itself, so `tests/firefox/launch.mjs` installs the build through Firefox's
remote debugging protocol, and gives tests `background(fn)` (like `serviceWorker.evaluate` in Chrome)
and `extPage("options/")` for the add-on's own pages. If you touch anything that could behave differently
in Firefox (storage, windows, clipboard, CSS in the shadow root), add a check there too.

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
