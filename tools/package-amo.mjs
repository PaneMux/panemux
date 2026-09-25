// Builds the package to upload to addons.mozilla.org and checks it the way
// AMO will, with Mozilla's addons-linter (through web-ext).
//
//   npm run package:amo    ->  dist/panemux-firefox-<version>.zip, linted
//
// Upload that zip at https://addons.mozilla.org/developers/addon/submit/.
// The listing text, reviewer notes and screenshots are in store/amo/.
// No source-code upload is needed: nothing in the package is minified,
// bundled or generated.
import { execFileSync } from "node:child_process";
import webExt from "web-ext";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "extension", "manifest.json"), "utf8"));
execFileSync(process.execPath, ["tools/build.mjs"], { cwd: root, stdio: "inherit" });
const lint = await webExt.cmd.lint(
  { sourceDir: path.join(root, "dist", "firefox"), warningsAsErrors: true, output: "text" },
  { shouldExitProgram: false },
);
if (lint.errors.length || lint.warnings.length) {
  console.error("\nFix the problems above before uploading.");
  process.exit(1);
}

const zip = path.join("dist", `panemux-firefox-${version}.zip`);
const kb = Math.round(fs.statSync(path.join(root, zip)).size / 1024);
console.log(`\nReady for addons.mozilla.org: ${zip} (${kb} KB)
  1. https://addons.mozilla.org/developers/addon/submit/ -> "On this site"
  2. upload the zip; answer "No" to "Do you need to submit source code?"
  3. paste the listing from store/amo/listing.md and the notes from store/amo/reviewer-notes.md
  4. add the screenshots in store/amo/screenshots/`);
