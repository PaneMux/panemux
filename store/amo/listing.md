# addons.mozilla.org listing

Copy these into the fields of the AMO developer hub
(https://addons.mozilla.org/developers/addon/submit/). Field limits are AMO's.

## Name (max 50)

PaneMux

## Add-on URL slug

panemux

## Summary (max 250)

Browse the web from the keyboard, Vim-style. Link hints, scrolling, tabs and find out of the box; turn on text objects, a page outline, macros, tab registers, an undo tree, splits and Vimgolf when you want them. No data collected.

## Description

PaneMux lets you use the web without reaching for the mouse. Press f and every link gets a couple of letters: type them and PaneMux clicks it. j and k scroll, / searches the page, H and L go back and forward, J and K switch tabs. Everything runs locally: no network calls, no accounts, no data collection.

It starts gentle. A two-minute interactive tutorial opens on install, the Classic preset turns on only the essentials, and ? shows every key that's switched on, in plain English, with a search box. Click into any text box and PaneMux steps aside until you press Esc. The toolbar button pauses it on the current site in one click, for web apps that have their own shortcuts.

When you want more, switch to Power User (or pick features one by one):

- Command bar (:) with fuzzy completion: close every tab matching a pattern, pin or reload a group of tabs, split the screen. Closing several tabs always shows them first, and every close has an Undo button.
- Text objects: yap copies the paragraph you're reading as Markdown, dah hides a heading and everything under it, cit lets you edit a line of text right on the page.
- Page outline (gO): the page's headings as a foldable outline. Walk it with j and k and the page follows; pin it while you read.
- Visual mode for elements: walk the page with h/j/k/l, hide things, copy them as Markdown, open them in a clean reading pane.
- Macros: record q a … q, replay with @a, across page loads and tab switches.
- Tab registers: save a set of tabs into a letter and reopen them later.
- Undo tree: closed tabs, hidden elements and form edits, with u, Ctrl-r and a clickable history panel.
- Splits: two windows tiled side by side, with keys to jump between them.
- Vimgolf: score your keystrokes against the mouse clicks they save, with a leaderboard.

Every key can be changed or switched off in Settings. The status strip at the bottom of the window always shows which mode you're in and never blocks a click.

PaneMux is open source (MIT): https://github.com/PaneMux/panemux

## Categories (pick up to 2)

- Tabs
- Other

## Tags (up to 10)

vim, keyboard, vimium, keyboard shortcuts, navigation, productivity, tabs, accessibility, link hints, power user

## Homepage

https://github.com/PaneMux/panemux

## Support site

https://github.com/PaneMux/panemux/issues

## License

MIT License

## Privacy policy

Not required (the add-on declares no data collection), but store/amo/PRIVACY.md can be pasted if you
want one on the listing.

## Screenshots (1280×800, in this order)

| File | Caption |
|---|---|
| screenshots/1-link-hints.png | Press f: every link gets letters. Type them to click. |
| screenshots/2-command-bar.png | The : command bar, with a plain description for every command. |
| screenshots/3-visual-mode.png | Visual mode selects page elements, not characters. |
| screenshots/4-outline.png | gO: an outline of the page's headings. The page follows as you move. |
| screenshots/5-text-objects-and-vimgolf.png | yap copies the paragraph you're reading, while a Vimgolf round keeps score. |
| screenshots/6-help.png | ? lists every key that's switched on, searchable. |
| screenshots/7-tutorial.png | A two-minute tutorial that waits for the real keys. |
| screenshots/8-settings.png | Presets, searchable keys and per-key reset. |

## Compatibility

Firefox for desktop, 140 and later. Don't tick Firefox for Android: PaneMux is built around a keyboard.

## Source code

Answer **No** to "Do you need to submit source code?": nothing in the package is minified, bundled,
transpiled or generated. It's the `extension/` folder of the repository with a Firefox manifest.
