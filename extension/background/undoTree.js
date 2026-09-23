// Undo tree, Vim style. Pure data structure (no chrome.* calls) so it can be
// unit-tested; background.js applies the operations it returns.
//
// Every recorded action (closed tabs, hidden element, form edit) is a node;
// node 0 is the original state. `cur` is the state we're in. New actions
// become children of `cur`, so undoing and then acting again creates a branch
// instead of losing history.
//
//   undo  (u)      revert cur, move to its parent
//   redo  (C-r)    re-apply the child we most recently came from / created
//   step  (g-/g+)  move to the state with seq ±1, across branches (Vim's g-/g+):
//                  undo up to the common ancestor, redo down to the target
//   goto  (panel)  same path walk to any node
//
// Navigation methods return the ordered ops [{ node, dir: "undo" | "redo" }]
// the caller must apply; the pointer has already moved.

const MAX_NODES = 1000;

export class UndoTree {
  constructor(state) {
    if (state && state.nodes) {
      this.nodes = state.nodes;
      this.cur = state.cur;
      this.seq = state.seq;
    } else {
      this.nodes = { 0: { id: 0, parent: null, children: [], last: null, kind: "root", label: "original", time: Date.now() } };
      this.cur = 0;
      this.seq = 0;
    }
  }

  toJSON() {
    return { nodes: this.nodes, cur: this.cur, seq: this.seq };
  }

  push({ kind, label, data }) {
    const id = ++this.seq;
    const parent = this.nodes[this.cur];
    this.nodes[id] = { id, parent: parent.id, children: [], last: null, kind, label, data, time: Date.now() };
    parent.children.push(id);
    parent.last = id;
    this.cur = id;
    this.prune();
    return this.nodes[id];
  }

  // Drop the oldest leaf branches (never the current path) past MAX_NODES.
  prune() {
    const ids = Object.keys(this.nodes).map(Number);
    if (ids.length <= MAX_NODES) return;
    const onPath = new Set(this.pathToRoot(this.cur));
    for (const id of ids.sort((a, b) => a - b)) {
      if (Object.keys(this.nodes).length <= MAX_NODES) break;
      const n = this.nodes[id];
      if (id === 0 || onPath.has(id) || n.children.length) continue;
      const p = this.nodes[n.parent];
      p.children = p.children.filter((c) => c !== id);
      if (p.last === id) p.last = p.children[p.children.length - 1] ?? null;
      delete this.nodes[id];
    }
  }

  pathToRoot(id) {
    const out = [];
    for (let n = this.nodes[id]; n; n = n.parent === null ? null : this.nodes[n.parent]) out.push(n.id);
    return out;
  }

  undo(count = 1) {
    const ops = [];
    for (let i = 0; i < count && this.cur !== 0; i++) {
      const n = this.nodes[this.cur];
      ops.push({ node: n, dir: "undo" });
      this.nodes[n.parent].last = n.id; // redo comes back down this branch
      this.cur = n.parent;
    }
    return ops;
  }

  redo(count = 1) {
    const ops = [];
    for (let i = 0; i < count; i++) {
      const next = this.nodes[this.cur].last;
      if (next == null || !this.nodes[next]) break;
      ops.push({ node: this.nodes[next], dir: "redo" });
      this.cur = next;
    }
    return ops;
  }

  goto(target) {
    if (!this.nodes[target] || target === this.cur) return [];
    const up = this.pathToRoot(this.cur);
    const down = this.pathToRoot(target);
    const downSet = new Set(down);
    const lca = up.find((id) => downSet.has(id));
    const ops = [];
    for (const id of up) {
      if (id === lca) break;
      const n = this.nodes[id];
      ops.push({ node: n, dir: "undo" });
      this.nodes[n.parent].last = n.id;
    }
    const redoPath = down.slice(0, down.indexOf(lca)).reverse();
    for (const id of redoPath) {
      const n = this.nodes[id];
      this.nodes[n.parent].last = id;
      ops.push({ node: n, dir: "redo" });
    }
    this.cur = target;
    return ops;
  }

  // g- / g+: chronological neighbour by sequence number (skipping pruned ids).
  step(delta) {
    const ids = Object.keys(this.nodes).map(Number).sort((a, b) => a - b);
    const i = ids.indexOf(this.cur);
    const j = Math.max(0, Math.min(ids.length - 1, i + delta));
    return this.goto(ids[j]);
  }

  // What the panel needs — no action payloads (form values stay here).
  view() {
    return {
      cur: this.cur,
      nodes: Object.values(this.nodes).map(({ id, parent, kind, label, time }) => ({ id, parent, kind, label, time })),
    };
  }
}
