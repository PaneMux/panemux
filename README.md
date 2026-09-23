# PaneMux

Keyboard-driven browsing for Chrome, in the spirit of Vimium — but modal all the way down.
Pages are buffers, tabs are registers, and your browsing history is an undo tree.

No backend, no network calls, no AI: everything runs locally on plain DOM work and string matching.

- **Vimium-style navigation** — link hints, scrolling, tabs, find, history, marks
- **`:` command bar** — fuzzy-matched ex commands (`:tabdo close *twitter*`, `:g/news/pin`, `:vsp`, `:reg`)
- **Visual mode for elements** — walk the DOM with `hjkl`, hide things, copy them as Markdown, read them distraction-free
- **Macros** — `qa … q`, `@a`; they replay across page loads and tab switches
- **Tab registers** — yank a set of tabs into `"a`, reopen them later, synced across your devices
- **Undo tree** — closed tabs, hidden elements and form edits, with `u` / `Ctrl-r` / `g-` / `g+` and a clickable tree panel
- **Splits** — two real windows tiled side by side, with `W h/j/k/l` to move between them
- **Terminal HUD** — JetBrains Mono, translucent panels, a mode orb that glows in the current mode's color

The full design lives in [`panemux-spec.md`](panemux-spec.md), including the roadmap.
Phases 1–4 are built; phase 5 (text objects, Vimgolf mode, HUD polish) is next.

## Install

PaneMux isn't on the Chrome Web Store yet. Build it and load it unpacked:

```sh
npm install
npm run build          # -> dist/panemux/ and dist/panemux-<version>.zip
```

1. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and pick `dist/panemux` (or `extension/` while you're hacking on it).
3. Reload tabs that were already open — content scripts only reach pages loaded after install.
4. The toolbar icon opens the options page.

After pulling changes, run `npm run build` again and hit ↻ on the extension card.

## Keys

Most commands take a count: `5j`, `3gt`, `2@a`.

### Normal mode

| Keys | Action |
|---|---|
| `f` / `F` | Link hints — open in this tab / a background tab |
| `j` `k` `h` `l` | Scroll |
| `gg` / `G` | Top / bottom |
| `d` / `Ctrl-d`, `Ctrl-u` | Half page down, half page up |
| `t` | New tab |
| `J` / `K`, `gt` / `gT` | Next / previous tab (`{n}gt` jumps to tab n) |
| `/`, `n` / `N` | Find (smartcase), next / previous match |
| `H` / `L` | Back / forward |
| `m{a-z}` / `m{A-Z}` | Set a page mark / a global mark |
| `` `{mark} `` | Jump to a mark; ` `` ` jumps back |
| `yy`, `"ayy` | Copy the page URL (into register `a`) |
| `i` / `Esc` | Insert mode / back to Normal |
| `:` | Command bar |
| `v` | Visual mode |
| `q{a-z}` … `q`, `@{a-z}`, `@@` | Record / play / replay a macro |
| `T`, `"{a-z}p` | Tab overview, reopen a tab register |
| `u`, `Ctrl-r`, `g-` / `g+`, `U` | Undo, redo, walk history across branches, undo-tree panel |
| `Wh` `Wj` `Wk` `Wl`, `Ww`, `Wc` | Focus split left/down/up/right, next window, close split |

`u` is undo by default. If you'd rather keep Vimium's half-page-up, flip **Normal-mode u** in Options.

### Command bar

Tab completes, ↑/↓ picks a suggestion, `Ctrl-k` / `Ctrl-j` walks history. An inexact name runs the
highlighted match, so `:tbdo close x` works.

| Command | What it does |
|---|---|
| `:tabdo <action> [pattern]` | Run an action on every tab in the window, optionally filtered by glob or substring |
| `:bufdo <action> [pattern]` | Same, across all windows |
| `:g/regex/<action>`, `:g!/regex/<action>` | Tabs whose title/URL match (or don't) |
| `:sp [url]`, `:vsp [url]`, `:close` | Split horizontally / vertically, close a split |
| `:reg`, `:macros`, `:undotree` | Show registers, macros, toggle the undo tree |

Actions: `close reload pin unpin mute unmute duplicate discard`.

### Visual mode

| Keys | Action |
|---|---|
| `h` / `l` | Parent / first child |
| `j` / `k` | Next / previous sibling |
| `d`, `u` | Hide the element (undoable), undo |
| `y` | Copy as Markdown |
| `>` | Open in a reading pane |
| `f` | Pick a different element with hints |
| `Esc` / `v` | Leave Visual mode |

### Tab overview (`T`)

`j`/`k` move, `Space` selects, `"ay` yanks the selection into register `a`, `"ap` reopens it, `x` closes,
`Enter` switches, `Esc` closes the overview.

## How some of it works

**Key handling** is one finite-state machine (`extension/content/keyHandler.js`) with Vim's grammar:
`[count] [operator [count]] (motion | text-object | action) [char]`. Bindings live in a trie per mode,
and a key that's both a full binding and a prefix waits a moment before firing, like Vim's `timeoutlen`.

**Macros** record what happened, not just which keys were hit: hint clicks are stored as a stable
element descriptor (CSS path, href, text), so replays still hit the right link when hint labels change.
The service worker drives playback, so a macro that follows a link or switches tabs keeps going on the
next page.

**Tab registers** keep a full copy in `chrome.storage.local` and sync a small index plus the tab list in
chunks under 8 KB to `chrome.storage.sync`, staying inside its per-item and total quotas. Registers too
big to sync stay on the device that made them.

**The undo tree** lives in `chrome.storage.session` (memory only, never written to disk). Password
fields and credit-card/one-time-code inputs are never recorded.

**Splits** are real windows. Splitting a single tab with iframes breaks on any site that sends
`X-Frame-Options` or a CSP `frame-ancestors` header, which is most of them. Chrome also reserves
Ctrl+W, so the window prefix is `W` instead of Vim's `Ctrl-w`.

## Limits

- Runs in the top frame only, so keys don't work inside iframes yet.
- Chrome doesn't let extensions run on `chrome://` pages or the New Tab page.
- Scripts inject at `document_idle`, so keys pressed before a page finishes loading go to the page.
- Mouse clicks aren't recorded in macros.

## Development

```sh
npm install
npx playwright install chromium
npm test                  # unit tests (node:test) + end-to-end tests with the extension loaded
HEADED=1 npm run test:e2e # watch it drive a real browser
npm run build
```

`tools/try-site.mjs`, `tools/try-phase2.mjs` and `tools/try-phase3.mjs` poke at real sites with the
extension loaded and save screenshots to `test-results/`.

See [CONTRIBUTING.md](CONTRIBUTING.md) before sending a patch.

## License

[MIT](LICENSE). JetBrains Mono is bundled under the SIL Open Font License
([`extension/ui/fonts/OFL-LICENSE.txt`](extension/ui/fonts/OFL-LICENSE.txt)).
