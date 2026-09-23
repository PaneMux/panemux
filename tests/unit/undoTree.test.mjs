// Unit tests for the undo tree's navigation (pure logic).
import { test } from "node:test";
import assert from "node:assert/strict";
import { UndoTree } from "../../extension/background/undoTree.js";

const ops = (list) => list.map((o) => `${o.dir}:${o.node.id}`);

test("linear undo / redo", () => {
  const t = new UndoTree();
  t.push({ kind: "edit", label: "1" });
  t.push({ kind: "edit", label: "2" });
  assert.deepEqual(ops(t.undo()), ["undo:2"]);
  assert.equal(t.cur, 1);
  assert.deepEqual(ops(t.undo(5)), ["undo:1"]); // stops at the root
  assert.deepEqual(ops(t.undo()), []);
  assert.deepEqual(ops(t.redo(2)), ["redo:1", "redo:2"]);
  assert.deepEqual(ops(t.redo()), []);
});

test("acting after undo branches; redo follows the newest branch", () => {
  const t = new UndoTree();
  t.push({ kind: "edit" });           // 1
  t.undo();                           // at 0
  t.push({ kind: "edit" });           // 2, sibling of 1
  assert.deepEqual(t.nodes[0].children, [1, 2]);
  t.undo();
  assert.deepEqual(ops(t.redo()), ["redo:2"]);
});

test("redo returns down the branch you undid from", () => {
  const t = new UndoTree();
  t.push({}); t.undo(); t.push({});   // 1 and 2 under root, at 2
  t.goto(1);                          // over to branch 1
  t.undo();                           // back to root, from 1
  assert.deepEqual(ops(t.redo()), ["redo:1"]);
});

test("g- / g+ walk states in time order across branches", () => {
  const t = new UndoTree();
  t.push({}); // 1
  t.push({}); // 2
  t.undo(2);  // root
  t.push({}); // 3 (branch off root)
  assert.deepEqual(ops(t.step(-1)), ["undo:3", "redo:1", "redo:2"]); // to state 2
  assert.equal(t.cur, 2);
  assert.deepEqual(ops(t.step(-1)), ["undo:2"]);                     // state 1
  assert.deepEqual(ops(t.step(-1)), ["undo:1"]);                     // original
  assert.deepEqual(ops(t.step(-1)), []);                             // clamp
  assert.deepEqual(ops(t.step(+3)), ["redo:3"]);
});

test("goto walks via the common ancestor", () => {
  const t = new UndoTree();
  t.push({}); t.push({});        // 1 -> 2
  t.undo(); t.push({});          // 1 -> 3
  assert.deepEqual(ops(t.goto(2)), ["undo:3", "redo:2"]);
  assert.deepEqual(ops(t.goto(0)), ["undo:2", "undo:1"]);
});

test("serialises and restores", () => {
  const t = new UndoTree();
  t.push({ kind: "hide", label: "x", data: { secret: 1 } });
  const u = new UndoTree(JSON.parse(JSON.stringify(t)));
  assert.equal(u.cur, 1);
  assert.deepEqual(ops(u.undo()), ["undo:1"]);
  assert.ok(!("data" in u.view().nodes[1]), "view() must not leak payloads");
});

test("prunes old leaf branches past the cap, keeps the current path", () => {
  const t = new UndoTree();
  for (let i = 0; i < 600; i++) { t.push({}); t.undo(); } // 600 dead leaves under root
  for (let i = 0; i < 600; i++) t.push({});              // long live path
  assert.ok(Object.keys(t.nodes).length <= 1000);
  assert.equal(t.pathToRoot(t.cur).length, 601);
});
