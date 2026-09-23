// Unit tests: tab-register sync chunking (against a fake chrome.storage that
// enforces the real sync quotas) and macro recording.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const ITEM = 8192, TOTAL = 102400;
const bytes = (k, v) => new TextEncoder().encode(k + JSON.stringify(v)).length;

function area(quota) {
  let data = {};
  return {
    _data: () => data,
    async get(keys) {
      if (keys == null) return structuredClone(data);
      const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(obj) {
      const next = { ...data, ...structuredClone(obj) };
      if (quota) {
        for (const [k, v] of Object.entries(obj)) if (bytes(k, v) > ITEM) throw new Error("QUOTA_BYTES_PER_ITEM quota exceeded");
        const total = Object.entries(next).reduce((n, [k, v]) => n + bytes(k, v), 0);
        if (total > TOTAL) throw new Error("QUOTA_BYTES quota exceeded");
      }
      data = next;
    },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
  };
}

beforeEach(() => {
  globalThis.chrome = { storage: { local: area(false), sync: area(true) } };
});

const regs = await import("../../extension/background/registers.js");
const rec = await import("../../extension/background/macroRecorder.js");

const fakeTabs = (n, pad = 0) => Array.from({ length: n }, (_, i) => ({ url: `https://example.com/page/${i}?q=${"x".repeat(pad)}`, title: `Tab number ${i} with a longish title that gets clipped` }));

test("small tab register: one sync chunk + index, round-trips", async () => {
  const e = await regs.setTabRegister("a", fakeTabs(3));
  assert.equal(e.chunks, 1);
  assert.equal(e.localOnly, false);
  const sync = chrome.storage.sync._data();
  assert.deepEqual(Object.keys(sync).sort(), ["treg:a:0", "treg:index"]);
  assert.equal((await regs.getTabRegister("a")).length, 3);
});

test("every sync item stays under 8KB; big register splits into chunks", async () => {
  const e = await regs.setTabRegister("b", fakeTabs(120));
  assert.ok(e.chunks > 1, `chunks=${e.chunks}`);
  for (const [k, v] of Object.entries(chrome.storage.sync._data())) assert.ok(bytes(k, v) <= ITEM, `${k} is ${bytes(k, v)}B`);
  // Another device: no local copy, reads the chunks back in order.
  chrome.storage.local = area(false);
  const back = await regs.getTabRegister("b");
  assert.equal(back.length, 120);
  assert.equal(back[119].url, fakeTabs(120)[119].url);
});

test("titles are clipped to keep the index + chunks small", async () => {
  await regs.setTabRegister("c", [{ url: "https://a.b/", title: "t".repeat(500) }]);
  assert.equal(chrome.storage.sync._data()["treg:c:0"][0].t.length, 60);
});

test("oversized register stays local-only; index still syncs", async () => {
  const e = await regs.setTabRegister("d", fakeTabs(400, 40));
  assert.equal(e.localOnly, true);
  const sync = chrome.storage.sync._data();
  assert.ok(sync["treg:index"].d.localOnly);
  assert.ok(!Object.keys(sync).some((k) => k.startsWith("treg:d:")));
  assert.equal((await regs.getTabRegister("d")).length, 400); // same device: fine
  chrome.storage.local = area(false);
  await assert.rejects(regs.getTabRegister("d"), /too big to sync/);
});

test("overwriting a register removes stale chunks", async () => {
  await regs.setTabRegister("e", fakeTabs(120));
  await regs.setTabRegister("e", fakeTabs(2));
  const keys = Object.keys(chrome.storage.sync._data()).filter((k) => k.startsWith("treg:e:"));
  assert.deepEqual(keys, ["treg:e:0"]);
});

test("many registers fit in the 100KB sync budget (or degrade to local)", async () => {
  for (const n of "abcdefghijklmnopqrstuvwxyz") await regs.setTabRegister(n, fakeTabs(40));
  const total = Object.entries(chrome.storage.sync._data()).reduce((s, [k, v]) => s + bytes(k, v), 0);
  assert.ok(total <= TOTAL);
  const list = await regs.listTabRegisters();
  assert.equal(list.length, 26);
  assert.ok(list.every((r) => r.n === 40));
});

test("macro recording: steps in order, text coalesced, stop key stripped, A appends", async () => {
  await rec.startRecording("a");
  await Promise.all([
    rec.recordKey("j"), rec.recordStep({ t: "cmd", command: "scrollDown", count: null }),
    rec.recordStep({ t: "text", text: "h" }), rec.recordStep({ t: "text", text: "i" }),
    rec.recordKey("q"),
  ]);
  const r = await rec.stopRecording();
  assert.deepEqual(r, { reg: "a", steps: 2 });
  const m = (await rec.listMacros()).a;
  assert.deepEqual(m.steps.map((s) => s.t), ["cmd", "text"]);
  assert.equal(m.steps[1].text, "hi");
  assert.deepEqual(m.keys, ["j"]);
  await rec.startRecording("A");
  await rec.recordStep({ t: "cmd", command: "scrollUp" });
  await rec.stopRecording();
  assert.equal((await rec.listMacros()).a.steps.length, 3);
  assert.equal((await chrome.storage.local.get("macroRecording")).macroRecording, undefined);
});

test("macro: invalid register and steps after stop are ignored", async () => {
  await assert.rejects(rec.startRecording("1"), /Invalid register/);
  await rec.recordStep({ t: "cmd", command: "x" }); // not recording: dropped
  assert.equal(await rec.stopRecording(), null);
});
