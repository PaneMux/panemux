// Vimgolf, background side: the round in progress and the leaderboard.
//
// A round counts "strokes" (keys PaneMux handled) against "par": an estimate
// of how many mouse actions (clicks, drags, wheel flicks, typed characters) the
// same work would take without PaneMux. Pages report their strokes and par as
// they go (content/vimgolf.js); ":" commands are scored here, where we know how
// many tabs they touched.
//
//   storage.local  golfSession   the round in progress (pages watch it for the HUD)
//   storage.local  golfBoard     finished rounds, best first
//   storage.sync   golfBoard     the same, merged across your devices (opt-in: golfSync)
const SESSION = "golfSession";
const BOARD = "golfBoard";
const KEEP = 20;
const SYNC_KEEP = 10; // storage.sync items are small

let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));

const getSession = async () => (await chrome.storage.local.get(SESSION))[SESSION] || null;

export const running = async () => !!(await getSession());

export function start() {
  return serial(async () => {
    const s = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, startedAt: Date.now(), strokes: 0, par: 0, commands: 0, last: null };
    await chrome.storage.local.set({ [SESSION]: s });
    return s;
  });
}

// { strokes, par, command, commands } from a page (batched: `command` is the
// latest of `commands`), or par for a ":" command from here.
export function add({ strokes = 0, par = 0, command = null, lastPar = par, commands = command ? 1 : 0 }) {
  return serial(async () => {
    const s = await getSession();
    if (!s) return { ok: false };
    s.strokes += Math.max(0, strokes | 0);
    s.par += Math.max(0, Math.round(par));
    s.commands += commands;
    if (command) s.last = { command, par: Math.round(lastPar) };
    await chrome.storage.local.set({ [SESSION]: s });
    return { ok: true };
  });
}

// Mouse-only estimate for a ":" command (the typing itself counts as par too:
// the mouse user types into a menu or dialog instead).
const EX_PAR = { sp: 8, vsp: 8, close: 2, reg: 3, macros: 3, undotree: 3 };
export function exPar(name, result = {}) {
  if (name === "golf") return 0;
  if (typeof result.affected === "number") return 2 * result.affected + 1; // find + act on each tab
  return EX_PAR[name] ?? 3;
}

export const score = (r) => r.par - r.strokes;
export const ratio = (r) => (r.strokes ? r.par / r.strokes : 0);
const better = (a, b) => ratio(b) - ratio(a) || score(b) - score(a);

function merge(...lists) {
  const byId = new Map();
  for (const r of lists.flat()) if (r && r.id) byId.set(r.id, r);
  return [...byId.values()].sort(better);
}

export async function board() {
  const [{ [BOARD]: local = [] }, { golfSync = false, [BOARD]: synced = [] }] = await Promise.all([
    chrome.storage.local.get(BOARD),
    chrome.storage.sync.get({ golfSync: false, [BOARD]: [] }),
  ]);
  return merge(local, golfSync ? synced : []).slice(0, KEEP);
}

// Finish the round: store it, return it with its rank.
export function stop() {
  return serial(async () => {
    const s = await getSession();
    if (!s) return null;
    await chrome.storage.local.remove(SESSION);
    const round = { id: s.id, date: s.startedAt, minutes: Math.max(1, Math.round((Date.now() - s.startedAt) / 60000)), strokes: s.strokes, par: s.par, commands: s.commands };
    if (!round.strokes && !round.par) return { round, rank: null };
    const list = merge(await board(), [round]).slice(0, KEEP);
    await chrome.storage.local.set({ [BOARD]: list });
    const { golfSync = false } = await chrome.storage.sync.get({ golfSync: false });
    if (golfSync) await chrome.storage.sync.set({ [BOARD]: list.slice(0, SYNC_KEEP) });
    const i = list.findIndex((r) => r.id === round.id);
    return { round, rank: i === -1 ? null : i + 1 };
  });
}

export async function clear() {
  await chrome.storage.local.remove(BOARD);
  await chrome.storage.sync.remove(BOARD);
}
