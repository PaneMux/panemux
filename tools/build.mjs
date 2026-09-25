// Packages extension/ into dist/, once per browser:
//   dist/chrome/                        unpacked, for chrome://extensions -> "Load unpacked"
//   dist/panemux-chrome-<ver>.zip       Chrome, Edge, Brave, Opera, Vivaldi, Arc
//   dist/firefox/                       unpacked, for about:debugging -> "Load Temporary Add-on"
//   dist/panemux-firefox-<ver>.zip      Firefox and its forks (LibreWolf, Waterfox, Floorp, Zen)
// The source manifest is the Chrome one; Firefox gets a few keys swapped (see
// firefoxManifest). No dependencies: the zip writer below uses node:zlib.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "extension");
const dist = path.join(root, "dist");

const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));

// Sanity-check that every file the manifest references exists.
const referenced = [
  manifest.background.service_worker,
  manifest.options_ui.page,
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap((c) => [...(c.js || []), ...(c.css || [])]),
];
const missing = referenced.filter((f) => !fs.existsSync(path.join(src, f)));
if (missing.length) {
  console.error("Missing files referenced by manifest:", missing);
  process.exit(1);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

// Firefox has no extension service workers: the same module runs as an event
// page instead. It also wants an add-on id (storage.sync needs one) and, for
// addons.mozilla.org, a data-collection declaration.
export const GECKO_ID = "panemux@fd885aef-af0c-4b0e-81ed-db51fbf3509c";

export function firefoxManifest(m) {
  const f = structuredClone(m);
  f.background = { scripts: [m.background.service_worker], type: "module" };
  f.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      // 140 is the first release (and an ESR) that knows data_collection_permissions
      strict_min_version: "140.0",
      data_collection_permissions: { required: ["none"] },
    },
    gecko_android: { strict_min_version: "142.0" },
  };
  return f;
}

const TARGETS = {
  chrome: { manifest: (m) => m },
  firefox: {
    manifest: firefoxManifest,
    // Content-script CSS can't use relative URLs for extension files, so
    // page.css spells out the extension's origin, which differs per browser.
    rewrite: { "ui/page.css": (css) => css.replaceAll("chrome-extension://", "moz-extension://") },
  },
};

const files = walk(src).filter((f) => !path.basename(f).startsWith("."));

// ---- minimal zip writer (deflate) ------------------------------------------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// Fixed timestamp (1980-01-01) so builds are reproducible; an all-zero date
// is month 0, which strict unzippers reject.
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);         // version needed
    local.writeUInt16LE(0x0800, 6);     // UTF-8 names
    local.writeUInt16LE(8, 8);          // deflate
    local.writeUInt16LE(0, 10);         // time 00:00
    local.writeUInt16LE(DOS_DATE, 12);  // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function build(target, outDir = path.join(dist, target)) {
  const entries = files.map((f) => {
    const name = path.relative(src, f).split(path.sep).join("/");
    const { manifest: toManifest, rewrite = {} } = TARGETS[target];
    let data = name === "manifest.json"
      ? Buffer.from(JSON.stringify(toManifest(manifest), null, 2) + "\n")
      : fs.readFileSync(f);
    if (rewrite[name]) data = Buffer.from(rewrite[name](data.toString("utf8")));
    return { name, data };
  });
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const { name, data } of entries) {
    const dest = path.join(outDir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  return { outDir, entries };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.rmSync(path.join(dist, "panemux"), { recursive: true, force: true }); // pre-0.6 layout
  console.log(`Built PaneMux ${manifest.version}`);
  for (const target of Object.keys(TARGETS)) {
    const { outDir, entries } = build(target);
    const zipPath = path.join(dist, `panemux-${target}-${manifest.version}.zip`);
    fs.writeFileSync(zipPath, zip(entries));
    console.log(`  ${target.padEnd(8)} ${path.relative(root, outDir)}  +  ${path.relative(root, zipPath)} (${entries.length} files)`);
  }
}
