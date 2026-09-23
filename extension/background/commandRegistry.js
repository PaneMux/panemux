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
  close:     (tabs) => chrome.tabs.remove(tabs.map((t) => t.id)),
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

async function runTabAction(action, tabs) {
  const fn = TAB_ACTIONS[action];
  if (!fn) throw new Error(`Unknown tab action "${action || ""}" (use: ${ACTION_NAMES})`);
  if (!tabs.length) return { message: "No matching tabs" };
  await fn(tabs);
  return { message: `${PAST[action]} ${tabs.length} tab${tabs.length === 1 ? "" : "s"}` };
}

registerCommand({
  name: "tabdo",
  usage: ":tabdo <action> [pattern]",
  desc: `Run an action on every tab in this window, optionally matching a glob (${ACTION_NAMES})`,
  async run(args, { tab }) {
    const [action, ...rest] = args.split(/\s+/).filter(Boolean);
    const tabs = (await chrome.tabs.query({ windowId: tab.windowId })).filter(globMatcher(rest.join(" ")));
    return runTabAction(action, tabs);
  },
});

registerCommand({
  name: "bufdo",
  usage: ":bufdo <action> [pattern]",
  desc: `Run an action on every open tab in every window (${ACTION_NAMES})`,
  async run(args) {
    const [action, ...rest] = args.split(/\s+/).filter(Boolean);
    const tabs = (await chrome.tabs.query({})).filter(globMatcher(rest.join(" ")));
    return runTabAction(action, tabs);
  },
});

// :g/pattern/action — regex over title + URL. :g!/pattern/action inverts.
function globalCommand(invert) {
  return async (args, { tab }) => {
    const m = args.match(/^\/((?:\\.|[^/])*)\/(\w*)\s*$/);
    if (!m) throw new Error(`Usage: :g${invert ? "!" : ""}/pattern/action`);
    let re;
    try { re = new RegExp(m[1], "i"); } catch (e) { throw new Error(`Bad pattern: ${e.message}`); }
    const tabs = (await chrome.tabs.query({ windowId: tab.windowId }))
      .filter((t) => re.test(t.title || "") || re.test(t.url || "") ? !invert : invert);
    return runTabAction(m[2], tabs);
  };
}
registerCommand({ name: "g", aliases: ["global"], usage: ":g/pattern/action", desc: "Run an action on tabs whose title/URL matches a regex", run: globalCommand(false) });
registerCommand({ name: "g!", aliases: ["v", "vglobal"], usage: ":g!/pattern/action", desc: "Run an action on tabs that do NOT match a regex", run: globalCommand(true) });

// ---- splits (two real windows; see splits.js for why not iframes) ------------
registerCommand({ name: "sp", aliases: ["split"], usage: ":sp [url]", desc: "Horizontal split: this window on top, new window below", run: (a, c) => split(false, a, c) });
registerCommand({ name: "vsp", aliases: ["vsplit"], usage: ":vsp [url]", desc: "Vertical split: this window left, new window right", run: (a, c) => split(true, a, c) });
registerCommand({
  name: "close", aliases: ["clo"], usage: ":close", desc: "Close this split window (partner takes the full area)",
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
  desc: "Show all registers (text and tab groups)",
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
  name: "undotree", aliases: ["undolist", "ut"], usage: ":undotree", desc: "Toggle the undo-tree side panel (U)",
  run: () => ({ action: "undoPanel" }),
});

registerCommand({
  name: "macros",
  aliases: ["mac"],
  usage: ":macros",
  desc: "List recorded macros (q{a-z} records, @{a-z} plays)",
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
