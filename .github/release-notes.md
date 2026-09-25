{{KIND}}. Pick the zip for your browser below.

| File | Browsers |
|---|---|
| `panemux-chrome-{{VERSION}}.zip` | Chrome, Edge, Brave, Opera, Vivaldi, Arc |
| `panemux-firefox-{{VERSION}}.zip` | Firefox 128+, LibreWolf, Waterfox, Floorp, Zen, Mullvad Browser |

### Chrome and friends

1. Download `panemux-chrome-{{VERSION}}.zip` and unzip it into a folder you'll keep (the browser loads it from there).
2. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder.
4. Reload tabs that were already open.

### Firefox and its forks

1. Download `panemux-firefox-{{VERSION}}.zip`.
2. Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick the zip.
3. Allow access to all websites if Firefox asks.

Firefox drops temporary add-ons when it quits. To keep it installed, use Firefox Developer Edition or Nightly
with `xpinstall.signatures.required` set to `false` in `about:config`, then install the zip from
`about:addons` → ⚙ → **Install Add-on From File…**.

To update, download the new zip and repeat (Chrome: unzip over the same folder and click ↻ on the extension card).
