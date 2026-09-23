// Unit tests for the key-handling FSM, run in a bare VM context (no DOM).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "extension");
const load = (ctx, f) => vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });

let PaneMux, calls;
beforeEach(() => {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, document: { activeElement: null } });
  ctx.window = ctx;
  vm.runInContext("window.PaneMux = {}; PaneMux.Settings = { get: (k) => k === 'ambiguousTimeout' ? 30 : undefined };", ctx);
  load(ctx, "content/modes.js");
  load(ctx, "content/keyHandler.js");
  PaneMux = ctx.PaneMux;
  calls = [];
  const rec = (name) => (c) => calls.push({ name, count: c.count, hasCount: c.hasCount, char: c.char, operator: c.operator, motion: c.motion });
  for (const n of ["down", "top", "tab", "mark", "half", "dap", "insertEsc"]) PaneMux.Keys.defineCommand(n, rec(n));
  PaneMux.Keys.defineOperator("delete", rec("op:delete"));
  PaneMux.Keys.map("normal", "j", "down", { motion: true });
  PaneMux.Keys.map("normal", "gg", "top", { motion: true });
  PaneMux.Keys.map("normal", "gt", "tab");
  PaneMux.Keys.map("normal", "m", "mark", { arg: "char" });
  PaneMux.Keys.map("insert", "<esc>", "insertEsc");
});

const feed = (...ks) => ks.map((k) => PaneMux.Keys.feed(k, {}));

test("single key binding dispatches", () => {
  assert.deepEqual(feed("j"), [true]);
  assert.equal(calls[0].name, "down");
  assert.equal(calls[0].count, 1);
  assert.equal(calls[0].hasCount, false);
});

test("count prefix", () => {
  feed("1", "2", "j");
  assert.equal(calls[0].count, 12);
  assert.equal(calls[0].hasCount, true);
});

test("leading zero is not a count", () => {
  assert.deepEqual(feed("0"), [false]);
  feed("1", "0", "j");
  assert.equal(calls[0].count, 10);
});

test("multi-key sequence waits then fires", () => {
  feed("g");
  assert.equal(calls.length, 0);
  assert.equal(PaneMux.Keys.pending, "g");
  feed("g");
  assert.equal(calls[0].name, "top");
  assert.equal(PaneMux.Keys.pending, "");
});

test("count + sequence (3gt)", () => {
  feed("3", "g", "t");
  assert.deepEqual([calls[0].name, calls[0].count], ["tab", 3]);
});

test("char argument", () => {
  feed("m", "a");
  assert.deepEqual([calls[0].name, calls[0].char], ["mark", "a"]);
});

test("char argument rejects non-char keys", () => {
  feed("m", "<esc>");
  assert.equal(calls.length, 0);
  assert.equal(PaneMux.Keys.state, "IDLE");
});

test("unbound key passes through to the page", () => {
  assert.deepEqual(feed("z"), [false]);
});

test("broken sequence retries last key from root", () => {
  feed("g", "j");
  assert.equal(calls[0].name, "down");
});

test("esc cancels pending", () => {
  feed("5", "g", "<esc>");
  assert.equal(PaneMux.Keys.state, "IDLE");
  feed("j");
  assert.equal(calls[0].count, 1);
});

test("ambiguous prefix fires the short binding after timeout", async () => {
  PaneMux.Keys.map("normal", "d", "half");
  PaneMux.Keys.map("normal", "dap", "dap");
  feed("d");
  assert.equal(calls.length, 0);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls[0].name, "half");
  feed("d", "a", "p");
  assert.equal(calls[1].name, "dap");
});

test("operator + motion with multiplied counts, operator-pending mode", () => {
  PaneMux.Keys.map("normal", "x", "delete", { operator: true });
  feed("2", "x");
  assert.equal(PaneMux.Modes.current, "operator");
  feed("3", "j");
  assert.equal(PaneMux.Modes.current, "normal");
  assert.deepEqual([calls[0].name, calls[0].count, calls[0].motion], ["op:delete", 6, "down"]);
});

test("doubled operator = line target; non-motion target rejected", () => {
  PaneMux.Keys.map("normal", "x", "delete", { operator: true });
  feed("x", "x");
  assert.equal(calls[0].motion, "line");
  feed("x", "g", "t");
  assert.equal(calls.length, 1);
});

test("text objects resolve in operator trie", () => {
  PaneMux.Keys.map("normal", "x", "delete", { operator: true });
  PaneMux.Keys.map("operator", "ap", "paragraph", { motion: true });
  feed("x", "a", "p");
  assert.equal(calls[0].motion, "paragraph");
});

test("insert mode: digits and letters pass, esc bound", () => {
  PaneMux.Modes.enter("insert");
  assert.deepEqual(feed("5", "j"), [false, false]);
  assert.deepEqual(feed("<esc>"), [true]);
  assert.equal(calls[0].name, "insertEsc");
});

test("normalize", () => {
  const n = (key, mods = {}) => PaneMux.Keys.normalize({ key, ...mods });
  assert.equal(n("j"), "j");
  assert.equal(n("J", { shiftKey: true }), "J");
  assert.equal(n("Escape"), "<esc>");
  assert.equal(n("[", { ctrlKey: true }), "<esc>");
  assert.equal(n("w", { ctrlKey: true }), "<c-w>");
  assert.equal(n("Tab", { shiftKey: true }), "<s-tab>");
  assert.equal(n("Shift", { shiftKey: true }), null);
  assert.equal(JSON.stringify(PaneMux.Keys.parseKeys("<C-w>h")), JSON.stringify(["<c-w>", "h"]));
  assert.equal(PaneMux.Keys.parseKeys("gT").join(","), "g,T");
});
