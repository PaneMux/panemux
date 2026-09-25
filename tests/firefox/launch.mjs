// Launch Playwright's Firefox with the PaneMux add-on installed.
//
// Playwright can't load Firefox extensions itself, but Firefox's own remote
// debugging protocol can: start the debugger server, connect over TCP and ask
// the root actor's addons actor to install a temporary add-on, the same thing
// about:debugging -> "Load Temporary Add-on" does.
import { firefox } from "@playwright/test";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, GECKO_ID } from "../../tools/build.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Fixed moz-extension:// host so tests can open the add-on's own pages.
export const FIREFOX_UUID = "5b0b8b8e-6a55-4f35-9d0e-2f6c1c3a7d11";
export const EXT_ORIGIN = `moz-extension://${FIREFOX_UUID}`;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// Remote debugging protocol packets are "<length>:<json>".
function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let buf = Buffer.alloc(0);
    const waiting = [];
    const inbox = [];
    const deliver = (msg) => {
      const i = waiting.findIndex((w) => w.from === msg.from);
      if (i === -1) inbox.push(msg);
      else waiting.splice(i, 1)[0].resolve(msg);
    };
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const colon = buf.indexOf(":");
        if (colon === -1) break;
        const len = parseInt(buf.subarray(0, colon).toString(), 10);
        if (buf.length < colon + 1 + len) break;
        deliver(JSON.parse(buf.subarray(colon + 1, colon + 1 + len).toString()));
        buf = buf.subarray(colon + 1 + len);
      }
    });
    socket.on("error", reject);
    const next = (from) => {
      const i = inbox.findIndex((m) => m.from === from);
      if (i !== -1) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((res) => waiting.push({ from, resolve: res }));
    };
    const request = (msg) => {
      const data = Buffer.from(JSON.stringify(msg));
      socket.write(`${data.length}:`);
      socket.write(data);
      return next(msg.to);
    };
    socket.once("connect", async () => {
      await next("root"); // greeting
      const drain = (from) => {
        const out = inbox.filter((m) => m.from === from);
        out.forEach((m) => inbox.splice(inbox.indexOf(m), 1));
        return out;
      };
      resolve({ request, next, drain, close: () => socket.end() });
    });
  });
}

async function debuggerClient(port) {
  for (let i = 0; i < 50; i++) {
    const client = await connect(port).catch(() => null);
    if (client) return client;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("couldn't reach the Firefox debugger server");
}

async function installAddon(client, dir) {
  const rootInfo = await client.request({ to: "root", type: "getRoot" });
  const res = await client.request({ to: rootInfo.addonsActor, type: "installTemporaryAddon", addonPath: dir, openDevTools: false });
  if (res.error) throw new Error(`installTemporaryAddon: ${res.error} ${res.message || ""}`);
  return res.addon.id;
}

// Run fn(arg) in one of the add-on's documents through its console actor and
// return the (awaited) result through JSON — like Playwright's
// serviceWorker.evaluate() in Chrome.
function evaluatorFor(client, consoleActor) {
  const evaluate = async (text) => {
    const ack = await client.request({ to: consoleActor, type: "evaluateJSAsync", text });
    if (ack.error) throw new Error(`${ack.error}: ${ack.message || ""}`); // e.g. the page went away
    let res = ack.type === "evaluationResult" ? ack : null;
    while (!res || res.resultID !== ack.resultID) res = await client.next(consoleActor);
    if (res.exceptionMessage) throw new Error(res.exceptionMessage);
    const v = res.result;
    if (v && typeof v === "object" && v.type === "longString") {
      const full = await client.request({ to: v.actor, type: "substring", start: 0, end: v.length });
      return full.substring;
    }
    return typeof v === "string" ? v : "";
  };
  // The console won't await at the top level in add-on documents, so park the
  // promise's outcome on a global and poll for it.
  let seq = 0;
  return async (fn, arg) => {
    const id = `r${++seq}`;
    await evaluate(`(globalThis.__pmx ||= {}, Promise.resolve().then(() => (${fn.toString()})(${JSON.stringify(arg) ?? "undefined"}))
      .then((v) => { __pmx.${id} = { v: JSON.stringify(v === undefined ? null : v) }; }, (e) => { __pmx.${id} = { e: String(e && e.message || e) }; }), "")`);
    for (;;) {
      const out = await evaluate(`__pmx.${id} ? JSON.stringify(__pmx.${id}) : ""`);
      if (out) {
        await evaluate(`delete __pmx.${id}, ""`);
        const r = JSON.parse(out);
        if ("e" in r) throw new Error(r.e);
        return JSON.parse(r.v);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  };
}

// Tracks the add-on's documents (background page, tutorial, settings...).
// Playwright can't see moz-extension:// tabs, so tests reach them this way.
async function addonTargets(client, id) {
  const { addons } = await client.request({ to: "root", type: "listAddons" });
  const addon = addons.find((a) => a.id === id);
  // Modern Firefox hands out targets through a watcher actor.
  const watcher = await client.request({ to: addon.actor, type: "getWatcher" });
  const targets = new Map(); // actor -> form
  const take = (msg) => {
    if (msg.type === "target-available-form") targets.set(msg.target.actor, msg.target);
    if (msg.type === "target-destroyed-form") targets.delete(msg.target.actor);
  };
  let msg = await client.request({ to: watcher.actor, type: "watchTargets", targetType: "frame" });
  while (msg.type) { take(msg); msg = await client.next(watcher.actor); }
  const find = async (pattern, timeout = 5000) => {
    const end = Date.now() + timeout;
    for (;;) {
      client.drain(watcher.actor).forEach(take);
      const form = [...targets.values()].reverse().find((t) => pattern.test(t.url)); // newest first
      if (form) return evaluatorFor(client, form.consoleActor);
      if (Date.now() > end) throw new Error(`no add-on page matching ${pattern}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  return { find, urls: () => { client.drain(watcher.actor).forEach(take); return [...targets.values()].map((t) => t.url); } };
}

// Returns a persistent Firefox context with the add-on installed and running.
// addonPath: install this instead of a fresh build (e.g. a release zip).
export async function launchFirefox({ headless = !process.env.HEADED, viewport = { width: 1200, height: 800 }, prefs = {}, addonPath = null } = {}) {
  const extDir = path.join(root, "test-results", "firefox-ext");
  build("firefox", extDir);
  const port = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pmx-ff-"));
  const context = await firefox.launchPersistentContext(userDataDir, {
    headless,
    viewport,
    args: ["-start-debugger-server", String(port)],
    firefoxUserPrefs: {
      "devtools.debugger.remote-enabled": true,
      "devtools.debugger.prompt-connection": false,
      "devtools.chrome.enabled": true,
      // what a user grants on the install prompt: access to every site
      "extensions.originControls.grantByDefault": true,
      "extensions.webextensions.uuids": JSON.stringify({ [GECKO_ID]: FIREFOX_UUID }),
      ...prefs,
    },
  });
  const client = await debuggerClient(port);
  const id = await installAddon(client, addonPath || extDir);
  const targets = await addonTargets(client, id);
  const background = await targets.find(/_generated_background_page/);
  context.pmxCleanup = () => {
    client.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  };
  // extPage("options/") -> evaluator for that open add-on page
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { context, id, background, extPage: (part, timeout) => targets.find(new RegExp(escape(part)), timeout), extUrls: targets.urls };
}
