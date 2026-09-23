# PaneMux UX & Onboarding Guidelines

## The problem
Vim-style tools are famously hostile to newcomers: an alien mode system, dozens of keybindings with no visible affordance, and destructive actions with no safety net. PaneMux adds *more* power (macros, registers, undo tree, splits) on top of that, which makes the gap worse unless UX is deliberately designed to close it. This doc defines how the extension stays approachable without dumbing down the power-user surface.

## Principles
1. **Powerful by ceiling, simple by floor** — a brand-new user should be productive in under a minute; an expert should still reach every Tier 1 feature
2. **Nothing destructive without a safety net** — closing tabs, hiding elements, bulk ex-commands must always be undoable or previewable
3. **Always show the way back** — a confused user's first instinct is "how do I turn this off / get back to normal," so that answer must always be one obvious action away
4. **Discoverable, not memorized** — every feature should be find-able through a visible UI path, not just documentation

## 1. First-Run Onboarding
- On install, open a single interactive tutorial page (not a wall of text) — a real mock page with a few links, a text field, and a scrollable section
- Teaches, one at a time, with a "try it" prompt that waits for the actual keypress before advancing: `hjkl` to scroll, `f` to click a link via hints, `i`/`Esc` to enter/exit a text field, `?` to open help
- Ends with: "That's everything you need for day one. Press `?` anytime to see more." — does **not** front-load macros, registers, splits, or Vimgolf in this flow
- Skippable at any point; re-runnable later from settings

## 2. Progressive Disclosure via Presets
Ship three settings presets instead of one giant list of toggles:

| Preset | What's on |
|---|---|
| **Classic** (default for new installs) | Tier 0 only — navigation, link hints, find, history, marks |
| **Power User** | Everything — Visual mode, command bar, macros, registers, undo tree, splits, text objects, Vimgolf |
| **Custom** | User picks individually |

New users start on Classic. The options page surfaces "Try Power User features" as an opt-in nudge after ~3 days of regular use, not on day one.

## 3. Always-Visible Escape Hatches
- **Auto-passthrough on inputs**: focusing any `<input>`, `<textarea>`, or `contenteditable` element automatically suspends Normal-mode key handling so typing "just works," with a subtle mode-indicator change (not a jarring popup) showing "Insert" — this is the single biggest source of "it's broken" complaints in tools like this if missing
- **One-click disable**: the extension's toolbar icon always shows current state (on/off/paused-for-this-site) and toggles it in one click — no digging through settings
- **Per-site pause**: a visible option to disable PaneMux entirely on sites like Gmail or Docs that have their own dense keyboard shortcuts

## 4. Contextual Help, Not Just Documentation
- `?` opens a searchable overlay listing only the keybindings currently enabled (respects the active preset), grouped simply: Move, Click, Tabs, Edit, Advanced
- Each entry is one line: key, plain-English description — no jargon like "ex-command" or "operator-pending" in the beginner-facing text (save precise terminology for a linked advanced section)
- The command bar (`:`) shows live autocomplete as the user types, with a one-line description per matched command — never just a raw list of command names

## 5. Safety Nets for Destructive Actions
- Any action that closes 2+ tabs at once (`:tabdo close`, `:g/pattern/close`, etc.) shows a preview first: "This will close 4 tabs matching 'twitter.com' — press Enter to confirm, Esc to cancel"
- Every destructive action (closed tab, hidden element, bulk close) triggers a small toast in the corner: "Tab closed — Undo" with both a clickable Undo button and the `u` keybinding — so a newcomer who doesn't trust the keyboard yet still has a mouse-clickable way out
- Confirmation previews can be turned off in Power User preset for people who don't want the friction

## 6. Mode Clarity Reinforcement
- The bottom status strip (see design-system.md) is the single source of truth for current mode — always visible, never optional
- The first several times a user switches modes, a small transient label briefly appears next to the status strip ("Insert mode — Esc to exit") — this fades out permanently after ~5 occurrences per mode, tracked locally, so it never becomes permanent nagging
- Getting "stuck" (rapid repeated invalid keypresses in a short window) triggers a one-time gentle hint: "Press Esc to return to Normal mode"

## 7. Settings Page UX
- Leads with the three presets as big, clear cards (not a settings list) — Classic / Power User / Custom
- Search box at the top for finding a specific keybinding or command, since a flat list of 40+ bindings is unusable without one
- Every custom keybinding shows the default in muted text next to it, with a one-click "Reset to default" per row

## What this explicitly avoids
- No AI/chat-based help — all guidance above is static, deterministic UI (matches the "no AI backend" constraint already in the project)
- No forced tutorials on every update — onboarding is first-install only, re-runnable on demand
- No modal dialogs that block the page for confirmations — use inline toasts/previews instead, consistent with the "never obstruct content" rule from the design system
