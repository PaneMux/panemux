// Packages extension/ into dist/:
//   dist/panemux/            unpacked folder for chrome://extensions -> "Load unpacked"
//   dist/panemux-<ver>.zip   same files zipped (share / Chrome Web Store upload)
// No dependencies: the zip writer below uses node:zlib.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "extension");
const dist = path.join(root, "dist");
const outDir = path.join(dist, "panemux");

const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));

// Sanity-check that every file the manifest references exists.
const referenced = [
  manifest.background.service_worker,
  manifest.options_page,
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

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const files = walk(src).filter((f) => !path.basename(f).startsWith("."));
for (const f of files) {
  const dest = path.join(outDir, path.relative(src, f));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(f, dest);
}

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
    local.writeUInt32LE(0, 10);         // time/date
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
    central.writeUInt32LE(0, 12);
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

const zipPath = path.join(dist, `panemux-${manifest.version}.zip`);
const entries = files.map((f) => ({ name: path.relative(src, f).split(path.sep).join("/"), data: fs.readFileSync(f) }));
fs.writeFileSync(zipPath, zip(entries));

console.log(`Built PaneMux ${manifest.version}
  unpacked: ${outDir}
  zip:      ${zipPath} (${entries.length} files)`);
