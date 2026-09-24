// Ex-command registry for the ":" command bar. Pure string matching on the
// content side (fuzzy over `name`/`aliases`), plain handlers here — no
// network, no model.
//
// A command: { name, aliases?, usage, desc, run(args, ctx) -> result }
//   args: string after the command name (":tabdo close x" -> "close x")
//   ctx:  { tab, raw }   the tab the bar was opened in
//   result: { message } | { output: { title, columns, rows } } | throws Error
import { allRegisters, listTabRegisters } from "./registers.js";
import { listMacros } from "./macroRecorder.js";
import { split, closeSplit } from "./splits.js";
import { closeTabs } from "./safety.js";
import * as Golf from "./vimgolf.js";

const commands = [];

export function registerCommand(cmd) {
  commands.push(cmd);
}

export function listCommands() {
  return commands.map(({ name, aliases = [], usage, desc }) => ({ name, aliases, usage, desc }));
}

export function findCommand(name) {
  return commands.find((c) => c.name === name || (c.aliases || []).includes(name)) || null;
}

// ":g/pat/act" and ":g!/pat/act" don't have a space after the name.
export function parse(raw) {
  const text = raw.trim().replace(/^:+/, "");
  const g = text.match(/^(g!?|global!?|vglobal|v)(\/.*)$/);
  if (g) return { name: g[1].startsWith("v") ? "g!" : g[1].replace("global", "g"), args: g[2] };
  const m = text.match(/^(\S+)\s*(.*)$/);
  return m ? { name: m[1], args: m[2].trim() } : { name: "", args: "" };
}

export async function execute(raw, ctx) {
  const { name, args } = parse(raw);
  if (!name) return { message: "" };
  const cmd = findCommand(name);
  if (!cmd) throw new Error(`Not an editor command: ${name}`);
  return (await cmd.run(args, { ...ctx, raw })) || {};
}

// ---- tab actions shared by :tabdo, :bufdo, :g -------------------------------

const TAB_ACTIONS = {
  close:     null, // handled by safety.closeTabs (preview + undo toast)
  reload:    (tabs) => Promise.all(tabs.map((t) => chrome.tabs.reload(t.id))),
  pin:       (tabs) => Promise.all(tabs.map((t) => chrome.tabs.update(t.id, { pinned: true }))),
  unpin:     (tabs) => Promise.all(tabs.map((t) => chrome.tabs.update(t.id, { pinned: false }))),
  mute:      (tabs) => Promise.all(tabs.map((t) => chrome.tabs.update(t.id, { muted: true }))),
  unmute:    (tabs) => Promise.all(tabs.map((t) => chrome.tabs.update(t.id, { muted: false }))),
  duplicate: (tabs) => Promise.all(tabs.map((t) => chrome.tabs.duplicate(t.id))),
  discard:   (tabs) => Promise.all(tabs.filter((t) => !t.active).map((t) => chrome.tabs.discard(t.id))),
};
const ACTION_NAMES = Object.keys(TAB_ACTIONS).join(", ");
const PAST = { close: "closed", reload: "reloaded", pin: "pinned", unpin: "unpinned", mute: "muted", unmute: "unmuted", duplicate: "duplicated", discard: "discarded" };

// "*twitter.com*" -> glob; plain text -> substring. Case-insensitive, matched
// against URL and title.
export function globMatcher(pattern) {
  if (!pattern) return () => true;
  if (!pattern.includes("*") && !pattern.includes("?")) {
    const p = pattern.toLowerCase();
    return (t) => (t.url || "").toLowerCase().includes(p) || (t.title || "").toLowerCase().includes(p);
  }
  const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
  return (t) => re.test(t.url || "") || re.test(t.title || "");
}

// describe: how the tabs were picked, shown in the close preview
async function runTabAction(action, tabs, ctx, describe) {
  if (!(action in TAB_ACTIONS)) throw new Error(`Unknown tab action "${action || ""}" (use: ${ACTION_NAMES})`);
  if (!tabs.length) return { message: "No matching tabs", affected: 0 };
  if (action === "close") return { ...(await closeTabs(tabs, { describe, notifyTabId: ctx.tab && ctx.tab.id })), affected: tabs.length };
  await TAB_ACTIONS[action](tabs);
  return { message: `${PAST[action]} ${tabs.length} tab${tabs.length === 1 ? "" : "s"}`, affected: tabs.length };
}

registerCommand({
  name: "tabdo",
  usage: ":tabdo <action> [pattern]",
  desc: "Do something to every tab in this window, or only those matching — e.g. close *news*",
  async run(args, ctx) {
    const [action, ...rest] = args.split(/\s+/).filter(Boolean);
    const pattern = rest.join(" ");
    const tabs = (await chrome.tabs.query({ windowId: ctx.tab.windowId })).filter(globMatcher(pattern));
    return runTabAction(action, tabs, ctx, pattern ? `matching '${pattern}'` : "in this window");
  },
});

registerCommand({
  name: "bufdo",
  usage: ":bufdo <action> [pattern]",
  desc: "Do something to every open tab in every window — e.g. reload",
  async run(args, ctx) {
    const [action, ...rest] = args.split(/\s+/).filter(Boolean);
    const pattern = rest.join(" ");
    const tabs = (await chrome.tabs.query({})).filter(globMatcher(pattern));
    return runTabAction(action, tabs, ctx, pattern ? `matching '${pattern}' in every window` : "in every window");
  },
});

// :g/pattern/action — regex over title + URL. :g!/pattern/action inverts.
function globalCommand(invert) {
  return async (args, ctx) => {
    const { tab } = ctx;
    const m = args.match(/^\/((?:\\.|[^/])*)\/(\w*)\s*$/);
    if (!m) throw new Error(`Usage: :g${invert ? "!" : ""}/pattern/action`);
    let re;
    try { re = new RegExp(m[1], "i"); } catch (e) { throw new Error(`Bad pattern: ${e.message}`); }
    const tabs = (await chrome.tabs.query({ windowId: tab.windowId }))
      .filter((t) => re.test(t.title || "") || re.test(t.url || "") ? !invert : invert);
    return runTabAction(m[2], tabs, ctx, `${invert ? "not matching" : "matching"} /${m[1]}/`);
  };
}
registerCommand({ name: "g", aliases: ["global"], usage: ":g/pattern/action", desc: "Do something to tabs whose title or address matches a pattern", run: globalCommand(false) });
registerCommand({ name: "g!", aliases: ["v", "vglobal"], usage: ":g!/pattern/action", desc: "Do something to tabs that don't match a pattern", run: globalCommand(true) });

// ---- splits (two real windows; see splits.js for why not iframes) ------------
registerCommand({ name: "sp", aliases: ["split"], usage: ":sp [url]", desc: "Split the screen: this window on top, a new one below", run: (a, c) => split(false, a, c) });
registerCommand({ name: "vsp", aliases: ["vsplit"], usage: ":vsp [url]", desc: "Split the screen: this window on the left, a new one on the right", run: (a, c) => split(true, a, c) });
registerCommand({
  name: "close", aliases: ["clo"], usage: ":close", desc: "Close this half of a split; the other window fills the screen",
  async run(args, { tab }) {
    const r = await closeSplit(tab.windowId);
    if (!r.ok) throw new Error(r.error);
    return {};
  },
});

// ---- registers ----------------------------------------------------------------
registerCommand({
  name: "reg",
  aliases: ["registers", "di", "display"],
  usage: ":reg",
  desc: "Show everything you've copied and every saved tab group",
  async run() {
    const text = await allRegisters();
    const tabs = await listTabRegisters();
    if (!text.length && !tabs.length) return { message: "All registers are empty" };
    const clip = (s) => s.replace(/\s+/g, " ").slice(0, 200);
    return {
      output: {
        title: ":registers",
        columns: ["Reg", "Type", "Content"],
        rows: [
          ...text.map((r) => [`"${r.name}`, r.type, clip(String(r.value))]),
          ...tabs.map((r) => [`"${r.name}`, `tabs×${r.n}${r.localOnly ? " (local)" : ""}`, clip(r.preview)]),
        ],
      },
    };
  },
});

registerCommand({
  name: "undotree", aliases: ["undolist", "ut"], usage: ":undotree", desc: "Show or hide the history of changes",
  run: () => ({ action: "undoPanel" }),
});

registerCommand({
  name: "outline", aliases: ["minimap", "toc"], usage: ":outline", desc: "Show the page's headings as an outline to jump around (gO)",
  run: () => ({ action: "minimap" }),
});

registerCommand({
  name: "macros",
  aliases: ["mac"],
  usage: ":macros",
  desc: "List your recorded key sequences",
  async run() {
    const macros = await listMacros();
    const names = Object.keys(macros).sort();
    if (!names.length) return { message: "No macros recorded (q{a-z} to record)" };
    return {
      output: {
        title: ":macros",
        columns: ["Reg", "Steps", "Keys"],
        rows: names.map((n) => [`@${n}`, String(macros[n].steps.length), macros[n].keys.join("").slice(0, 200)]),
      },
    };
  },
});

// ---- Vimgolf -------------------------------------------------------------------
async function golfEnabled() {
  const { preset = "classic", features = {} } = await chrome.storage.sync.get({ preset: "classic", features: {} });
  return preset === "power" || (preset === "custom" && !!features.vimgolf);
}

const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "E"); // golf: under par is negative, E = even
const verdict = (r) => {
  const d = r.strokes - r.par;
  return d < 0 ? `${-d} under par` : d > 0 ? `${d} over par` : "even par";
};
const when = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

registerCommand({
  name: "golf",
  aliases: ["vimgolf"],
  usage: ":golf [board | clear]",
  desc: "Score yourself: keys you press against the mouse clicks the same work would take. :golf again ends the round",
  async run(args) {
    if (!(await golfEnabled())) throw new Error("Vimgolf is off — switch it on in Settings (Power User, or Custom)");
    const sub = args.trim();
    if (sub === "board") {
      const list = await Golf.board();
      if (!list.length) return { message: "No finished rounds yet — :golf starts one" };
      return {
        output: {
          title: "Vimgolf leaderboard",
          columns: ["#", "When", "Strokes", "Par", "Score", "vs mouse"],
          rows: list.map((r, i) => [String(i + 1), when(r.date), String(r.strokes), String(r.par), signed(r.strokes - r.par), `${Golf.ratio(r).toFixed(1)}×`]),
        },
      };
    }
    if (sub === "clear") {
      await Golf.clear();
      return { message: "Leaderboard cleared" };
    }
    if (sub && sub !== "start" && sub !== "stop") throw new Error("Usage: :golf, :golf board, :golf clear");
    if (await Golf.running()) {
      if (sub === "start") return { message: "A round is already going — :golf ends it" };
      const res = await Golf.stop();
      const r = res.round;
      if (!r.strokes && !r.par) return { message: "Round over — nothing was scored" };
      return {
        output: {
          title: `Round over: ${verdict(r)}${res.rank ? ` · #${res.rank} on your board` : ""}`,
          columns: ["Strokes", "Par", "Score", "vs mouse", "Commands", "Minutes"],
          rows: [[String(r.strokes), String(r.par), signed(r.strokes - r.par), `${Golf.ratio(r).toFixed(1)}×`, String(r.commands), String(r.minutes)]],
        },
      };
    }
    if (sub === "stop") return { message: "No round going — :golf starts one" };
    await Golf.start();
    return { message: "Vimgolf round started — every key counts. :golf again to finish" };
  },
});
