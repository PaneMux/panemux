# Notes for the AMO reviewer

Paste into "Notes to Reviewer" when uploading a version.

---

PaneMux is keyboard navigation for the web, in the style of Vimium and Tridactyl. It makes no network
requests and collects nothing. The package is the plain source (no minification, bundling or build
step beyond writing a Firefox manifest): https://github.com/PaneMux/panemux (each release is tagged vX.Y.Z; the package matches that tag's extension/ folder).

How to try it

1. After install a tutorial tab opens; it walks through j/k, f, a text box and ? (about 2 minutes).
2. On any page: j/k scroll, f shows link hints (type the letters), / finds, ? lists every key.
3. Settings (right-click the toolbar button → Settings) → "Power User" enables the rest: the : command
   bar (try ":tabdo pin example"), v for Visual mode, gO for the page outline, yap to copy a paragraph,
   q a … q / @a for macros, u to undo, :golf for Vimgolf.

Permissions

- Access to all websites (content script on <all_urls>): it's a keyboard layer for every page; the
  keys have to work wherever you browse. Nothing is read from pages except to act on a key you pressed
  (for example the link you picked, or the paragraph you asked to copy).
- tabs: switching, moving, pinning and closing tabs from the keyboard (J/K, gt, :tabdo, the tab list),
  and reopening closed tabs for undo.
- storage: settings and remapped keys (sync), macros, marks and saved tab groups (local, sync for small
  items), the undo history (storage.session, memory only).
- clipboardWrite: the copy commands (yy page URL, yap paragraph as Markdown).
- contextMenus: the toolbar button's right-click menu (pause on this site, turn off, settings, tutorial).

Things that might look unusual

- The HUD is drawn inside a shadow root (custom element <panemux-hud>) with pointer-events off, so
  page CSS can't restyle it and it never intercepts clicks.
- Undo for edits made with PaneMux (cit / dip) keeps copies of the affected nodes in the page's memory
  only; nothing from the page is sent anywhere.
- tests/ and tools/ in the repository aren't part of the package.
