# PaneMux — Feature Spec & Build Prompt Document

**One-line pitch:** Vimium, but the entire browser becomes a modal text editor — pages are buffers, tabs are registers, and your browsing history is an undo tree.

No AI backend. Everything below runs on plain JS pattern-matching and DOM manipulation.

---

## 1. Design Direction

> **Superseded.** The original "Terminal HUD" look (neon glow, a big mode orb, CRT scanlines, skewed
> glitch animations) has been replaced. **`panemux-design-system.md` is the source of truth for all HUD
> visuals**, and **`panemux-ux-guidelines.md` for onboarding, defaults and safety UX.** Summary:

| Element | Look |
|---|---|
| Surfaces | Layered dark surfaces (`--surface-base` `#0B0B0F`, `--surface-raised` `#16161C`), 1px `--border-subtle` hairlines, a soft shadow instead of glow |
| Type | Inter for UI chrome, JetBrains Mono for keys and commands; 11 / 13 / 15 / 20px |
| Mode accents | Normal emerald `#34D399`, Insert amber `#FBBF24`, Visual violet `#A78BFA`, Command sky `#38BDF8`, Operator-pending rose `#FB7185` |
| Mode indicator | A 24px status strip on the bottom edge with reserved page space; falls back to a 64×24 corner pill (55% opacity at rest) when a site owns the bottom edge |
| Keystroke trail | Bottom-left monospace chips that fade and drift up over 1.2s |
| Command palette | ~15% from the top, max 560px wide, fade + scale in over 150ms. No skew, no glitch |
| Motion | 120–180ms ease-out, fade + scale only; everything off under `prefers-reduced-motion` |
| Scanlines | Opt-in easter egg in settings, off by default |
| Click-through | The HUD root is a zero-size, `pointer-events: none` box; only interactive panels take pointer events |
| Minimap (stretch) | Collapsed outline of the page's headings, click to jump |

Everything stays togglable: the **Classic** preset (default for new installs) is plain Vimium behaviour.

---

## 2. Feature Tiers

### Tier 0 — Vimium Core (must-have parity)

| Keys | Action |
|---|---|
| `f` / `F` | Link hints — open in current / new tab |
| `j k h l` | Scroll down/up/left/right |
| `gg` / `G` | Scroll to top / bottom |
| `d` / `u` | Half-page down / up |
| `t` | New tab |
| `J` / `K` or `gt` / `gT` | Next / previous tab |
| `/` , `n` / `N` | Find on page, next/prev match |
| `H` / `L` | Back / forward in history |
| `m{a}` / `` `{a} `` | Set mark / jump to mark |
| `yy` | Yank current page URL |

**Also from Vimium / Tridactyl** (surveyed both projects' default keymaps; these are the ones worth having that the list above lacked):

| Keys | Action | Source |
|---|---|---|
| `<C-d>` / `<C-u>`, `<C-f>` / `<C-b>` | Half page / full page down & up | both |
| `0` / `$` (or `zH` / `zL`) | Scroll all the way left / right | Vimium `zH zL`, Tridactyl `^ $` |
| `r` / `R` | Reload / hard reload (bypass cache) | both |
| `x` / `X` | Close tab / restore last closed tab (closes land in the undo tree) | Vimium |
| `yf` | Copy a link's URL via hints | Vimium `yf`, Tridactyl `;y` |
| `yt` / `ym` / `ys` | Yank page title / `[title](url)` Markdown link / shortest canonical URL | Tridactyl `yt ym ys` |
| `p` / `P` | Open clipboard URL (or search it) in this tab / a new tab | both |
| `gu` / `gU` | Up one URL path level / to the site root | both |
| `[[` / `]]` | Follow the page's "previous" / "next" link (rel=prev/next, then link text) | both |
| `<C-a>` / `<C-x>` | Increment / decrement the last number in the URL (page 3 → 4) | Tridactyl |
| `gi` | Focus the first text input ({count}gi = nth) | both |
| `g0` / `g$`, `^` | First / last tab, previously-visited tab | Vimium (`^`), both (`g0 g$`) |
| `<<` / `>>` | Move tab left / right | both |
| `<A-p>` / `<A-m>` | Pin / mute toggle | both |
| `o` / `O`, `b` / `B` | Open URL/history/bookmark (fuzzy) in this / a new tab; bookmarks only | Vimium Vomnibar, Tridactyl `o b` |
| `*` / `#` | Find the selected text forward / backward | Vimium |
| `<C-o>` / `<C-i>` | Jump list: back / forward through scroll & mark jumps | Tridactyl |
| `zi` / `zo` / `zz` | Zoom in / out / reset | both |
| `<C-v>` | Pass the next key straight to the page | Vimium `passNextKey`, Tridactyl |
| `.` | Repeat the last command (with its count) | Tridactyl |
| `?` | Help overlay listing live bindings | Vimium |
| Site rules | Disable PaneMux (or pass through chosen keys) on matching URLs — e.g. let Gmail keep `j/k` | Vimium exclusion rules |
| `:map` / `:unmap` | User key remapping, persisted and synced | both |

**Key conflicts, resolved:** the Tier 1 undo tree wants `u`, which Tier 0 gives to half-page up. Vim wins by default (`u` = undo, `<C-u>` = half page up) with an Options switch back to Vimium behaviour. Tridactyl's `d` (close tab) and `W` (new window) are *not* adopted: `d` stays half-page down and is the future delete operator, `W` is the split prefix. Vimium's `T` (tab search) becomes the tab-register overview, which lists every tab in the window (fuzzy filtering in it is a good follow-up).

### Presets

New installs start on **Classic** (Tier 0 only). **Power User** turns on everything in Tier 1; **Custom**
picks features one by one (see `panemux-ux-guidelines.md` §2). Keys belonging to a switched-off feature
aren't bound at all, so they reach the page untouched.

### Tier 1 — The New Stuff

**Visual Mode (element selection, not text)**
- `v` enters Visual mode on the currently focused/hinted element
- `hjkl` or arrow keys expand the selection: to parent, child, next sibling, previous sibling
- `d` — hide element from view (soft-remove, restorable with `u`)
- `y` — copy the element's content to clipboard as clean Markdown
- `>` — send the selected section into a distraction-free reading pane
- `Esc` — exit Visual mode

**Command Bar (`:`) — pure string matching, zero AI**
- `:` opens a text input; you type a command name
- Matched via fuzzy string matching (e.g. a small local library like `fuzzysort`) against a fixed command registry you define in code — no network call, no model, instant
- Example built-in commands:
  - `:tabdo close *twitter.com*` — run an action across all matching tabs
  - `:bufdo reload` — reload every open tab
  - `:g/pattern/close` — close tabs whose title/URL matches a pattern
  - `:sp` / `:vsp` — open a split
  - `:reg` — show all registers
  - `:macros` — list saved macros

**More ex-commands** (from Tridactyl's command line; same fuzzy registry):
- `:open` / `:tabopen` / `:winopen <url|search>` — with history + bookmark completion
- `:buffer <fuzzy title>` — jump to a tab by name (`:b`)
- `:tabonly`, `:tabmove <n>`, `:tabclose [pattern]`, `:tabduplicate`
- `:set <option> <value>` — every Options-page setting from the keyboard
- `:bind` / `:unbind` / `:map` — remap keys per mode (backed by the FSM's `map`/`unmap`)
- `:source` — load a `panemuxrc` of `:set`/`:map` lines pasted into Options (Tridactyl-style rc)
- `:help [command]`, `:zoom <n>`, `:reload` / `:reloadall`, `:pin`, `:mute`, `:viewsource`
- `:qall` — close the window (asks first)

**Hint modes** (Tridactyl's `;` family — one prefix, many actions):
- `;y` yank link URL · `;i` open image · `;s` save/download link · `;t` open in background tab
- `;v` select an element into Visual mode (same as Visual `f`) · `;;` focus an element without clicking
- `F` with a count, or `;q`, queues several links to open in new tabs

**Macros**
- `q{a-z}` — start recording into register `a-z`
- `q` — stop recording
- `@{a-z}` — replay the macro
- `@@` — replay the last-used macro
- Macros store both keystrokes *and* the resulting DOM actions, so they survive page reloads

**Tab Registers**
- In a tab-list overview, `"{a-z}y` yanks the selected tabs into a named register
- `"{a-z}p` reopens that whole group of tabs later — same session or (via `chrome.storage.sync`) a different device
- Think of it as clipboard slots, but for groups of tabs instead of text

**Undo Tree**
- `u` — undo the last action (closed tab, hidden element, form edit)
- `Ctrl-r` — redo
- `g-` / `g+` — step backward/forward through the *entire* action tree, including branches you took after undoing
- A small side panel visualizes the tree so you can see and click any past state

**Text Objects**
- Works inside Visual mode or as an operator target: `dap` deletes a paragraph block, `yip` yanks the inner paragraph, `cit` edits the inner text of the current tag in place
- Implemented by walking up/down the DOM tree from the focused node to find the nearest matching structural boundary (`<p>`, `<section>`, `<article>`, `<td>`, etc.)

**Splits**
- `:sp` / `:vsp` — horizontal/vertical split
- `Ctrl-w h/j/k/l` — move focus between splits
- `Ctrl-w c` — close the focused split
- **Key caveat:** Chrome reserves Ctrl+W (close tab) — neither pages nor extensions can intercept it — so the build uses `W` as the window prefix: `Wh/Wj/Wk/Wl`, `Wc`, plus `Ww` (next window) and `:close`.
- **Technical caveat:** a single tab can't render two separate pages side-by-side inside itself. The realistic implementation is `chrome.windows` positioning two real browser windows edge-to-edge to *simulate* a split — true in-page iframes only work for sites that don't send `X-Frame-Options`/CSP frame-blocking headers, so most real sites won't support the iframe approach. Worth stating this plainly in the build so nobody's surprised later.

**Vimgolf Mode**
- Toggle a HUD that scores your session: keystrokes/commands used vs. an estimated "mouse-only" baseline for the same actions
- Local leaderboard stored in `chrome.storage.local`; optional sync leaderboard between your own devices via `chrome.storage.sync`

---

## 3. Technical Architecture

**Manifest V3**, permissions: `tabs`, `storage`, `scripting`, `activeTab`, `clipboardWrite`, `contextMenus`
(splits use `chrome.windows`, which needs no permission of its own).

```
extension/
  manifest.json
  background/
    background.js         // service worker: message router, tabs, global marks
    commandRegistry.js     // ex-command name -> handler map (fuzzy-matched in the page)
    registers.js           // named registers: text + tab groups (synced in <8KB chunks)
    macroRecorder.js        // record/replay steps across tabs and page loads
    undoTree.js             // the branching undo tree (pure data structure)
    undoService.js          // feeds the tree: closed tabs, hides, form edits; applies undo/redo
    splits.js               // :sp / :vsp as tiled windows, W h/j/k/l, W c
    safety.js               // previews before closing 2+ tabs
    toolbar.js              // on / off / paused-for-this-site button, menu, shortcut
  content/
    content.js             // entry point: key routing, auto-passthrough, site pause
    keyHandler.js           // FSM: counts + operators + motions + text objects
    modes.js                // Normal / Insert / Visual / Command / Operator-pending state
    features.js             // Classic / Power User / Custom presets gate bindings
    keymap.js               // user key overrides
    commands.js, scroll.js, linkHints.js, find.js, marks.js
    domSelector.js, markdown.js, visualMode.js
    macro.js, tabOverview.js, undo.js, nudges.js
    textObjects.js, vimgolf.js      // Phase 5
  ui/
    tokens.css              // design tokens (single source of truth)
    hud.css, hud.js          // HUD shadow root, toasts, scanlines
    modeIndicator.js         // status strip / corner pill
    keystrokeTrail.js, commandPalette.js, preview.js, help.js, undoPanel.js
  tutorial/                 // first-run interactive tutorial
  options/                  // presets, searchable keys, settings
  icons/
```

Key handling is the core engine: a small finite-state machine that accumulates a numeric count, an optional operator (`d`, `y`, `c`, `>`), and a motion or text object, then dispatches one final action — exactly like real Vim's grammar, just aimed at DOM nodes instead of text characters.

Storage notes: `chrome.storage.sync` caps out around 100KB total / ~8KB per item, so large tab-register groups or long macro histories should live in `chrome.storage.local` and only sync a lightweight index.

---

## 4. Build Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Vimium core parity (Tier 0) + HUD | done |
| 2 | Command bar + Visual mode | done |
| 3 | Macros + Tab registers | done |
| 4 | Undo tree + Splits | done |
| 4.5 | Design system + UX pass: new HUD look and status strip, keystroke trail, opt-in scanlines, Classic / Power User / Custom presets, first-run tutorial, auto-passthrough, toolbar on/off/pause, `?` help, close previews + undo toasts, mode hints, settings rebuild | done |
| 5 | Text objects + Vimgolf mode + minimap | next |

Phase 4.5 was slotted in after Phase 4 so the UX floor (safe defaults, onboarding, escape hatches) exists
before more power features land. It pulled the keystroke trail and the scanline toggle forward from
Phase 5.

---

## 5. Ready-to-Use Prompts (one per phase)

Copy each into your coding AI of choice (e.g. Claude Code) once the previous phase is working.

**Phase 1 prompt:**
> Build a Chrome Manifest V3 extension called PaneMux. Implement Vimium-style core navigation: link hints (f/F), scroll motions (hjkl, gg, G, d, u), tab navigation (J/K, gt/gT), find-on-page (/, n, N), history (H, L), marks (m, `). Add a "Terminal HUD" visual theme: dark translucent panel, JetBrains Mono font, a bottom-right mode indicator orb that glows green in Normal mode. Structure the code so key handling lives in a single FSM module I can extend later with operators and text objects.

**Phase 2 prompt:**
> Add two features to the PaneMux extension: (1) a `:` command bar — a centered input with a glitch-in animation that fuzzy-matches typed text against a command registry object (no AI, no network), starting with `:tabdo`, `:bufdo`, `:sp`, `:vsp`, `:reg`; (2) a Visual mode entered with `v` that lets hjkl expand a DOM element selection (parent/child/sibling), with `d` to hide the element, `y` to copy it as Markdown, and `Esc` to exit. Color Visual mode's HUD orb magenta and Command mode's cyan.

**Phase 3 prompt:**
> Add macro recording (`q{a-z}` to start/stop, `@{a-z}` to replay, `@@` for last macro) that stores both keystrokes and resulting DOM/tab actions in chrome.storage.local so macros survive reloads. Add tab registers: in a tab-overview mode, `"{a-z}y` saves the selected tabs' URLs into a named register, `"{a-z}p` reopens them as new tabs, synced via chrome.storage.sync with a small index to stay under sync storage limits.

**Phase 4 prompt:**
> Add an undo tree: every closed tab, hidden element, and form edit becomes a node; `u`/`Ctrl-r` move linearly, `g-`/`g+` walk the full branching tree, and add a small collapsible side panel visualizing the tree with clickable nodes. Add splits: `:sp`/`:vsp` position two real browser windows edge-to-edge via chrome.windows (note in code comments that true same-tab iframe splitting won't work on sites with frame-blocking headers), `Ctrl-w hjkl` to move focus between them, `Ctrl-w c` to close one.

**Phase 4.5 prompt (design system + UX pass):**
> Treat `panemux-design-system.md` and `panemux-ux-guidelines.md` as the source of truth. Replace the neon/CRT theme with the design tokens; swap the mode orb for a 24px bottom status strip with reserved space (corner-pill fallback when a site owns the bottom edge); make the HUD root zero-size with `pointer-events: none`; remove the glitch animation and make scanlines opt-in. Ship Classic as the default preset (Tier 0 only) with Power User and Custom opt-in; add the interactive first-run tutorial, auto-passthrough on editable elements, a toolbar on/off/paused-for-this-site toggle, a searchable `?` help overlay, previews before closing 2+ tabs and Undo toasts, first-time mode hints and a stuck-user nudge, and rebuild settings around preset cards with search and per-key reset.

**Phase 5 prompt:**
> Add text objects usable after an operator or in Visual mode: `dap`/`yip`/`cit` etc., implemented by walking up the DOM to the nearest matching structural boundary (p, section, article, td). Add Vimgolf mode: a toggleable HUD scoring keystroke/command count per session against an estimated mouse-only baseline, with a local leaderboard in chrome.storage.local. Finish with the collapsible DOM-outline minimap. Follow `panemux-design-system.md` for every new HUD element (the keystroke trail and scanline toggle already shipped in Phase 4.5).

---

Everything above is written so you can build and test one phase at a time — each prompt assumes the previous phase's code already exists.
