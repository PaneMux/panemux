// Unit tests: fuzzy matcher (content) and ex-command parsing (background).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, globMatcher, listCommands, findCommand } from "../../extension/background/commandRegistry.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "extension");
const ctx = vm.createContext({});
ctx.window = ctx;
vm.runInContext("window.PaneMux = {};", ctx);
vm.runInContext(fs.readFileSync(path.join(root, "content/fuzzy.js"), "utf8"), ctx);
const { Fuzzy } = ctx.PaneMux;

const COMMANDS = listCommands();
const names = (c) => [c.name, ...c.aliases];
const top = (q) => Fuzzy.filter(q, COMMANDS, names)[0]?.item.name;

test("fuzzy: subsequence required", () => {
  assert.equal(Fuzzy.match("xyz", "tabdo"), null);
  assert.ok(Fuzzy.match("tbd", "tabdo"));
});

test("fuzzy: exact > prefix > scattered", () => {
  const exact = Fuzzy.match("sp", "sp").score;
  const prefix = Fuzzy.match("sp", "split").score;
  const scattered = Fuzzy.match("sp", "vsp").score;
  assert.ok(exact > prefix && prefix > scattered);
});

test("fuzzy: ranks registry commands sensibly", () => {
  assert.equal(top("tbd"), "tabdo");
  assert.equal(top("bu"), "bufdo");
  assert.equal(top("vs"), "vsp");
  assert.equal(top("sp"), "sp");
  assert.equal(top("rg"), "reg");
  assert.equal(top("regis"), "reg"); // via alias
});

test("fuzzy: match indices point at matched chars", () => {
  assert.deepEqual([...Fuzzy.match("tbd", "tabdo").indices], [0, 2, 3]);
});

test("parse: names, args, :g forms", () => {
  assert.deepEqual(parse(":tabdo close *twitter.com*"), { name: "tabdo", args: "close *twitter.com*" });
  assert.deepEqual(parse("bufdo reload"), { name: "bufdo", args: "reload" });
  assert.deepEqual(parse("g/news/close"), { name: "g", args: "/news/close" });
  assert.deepEqual(parse("g!/news/close"), { name: "g!", args: "/news/close" });
  assert.deepEqual(parse("v/news/close"), { name: "g!", args: "/news/close" });
  assert.deepEqual(parse("vsp"), { name: "vsp", args: "" });
});

test("globMatcher: glob vs substring, url or title, case-insensitive", () => {
  const tabs = [
    { url: "https://twitter.com/home", title: "Home / X" },
    { url: "https://news.ycombinator.com/", title: "Hacker News" },
  ];
  assert.deepEqual(tabs.filter(globMatcher("*twitter.com*")).length, 1);
  assert.deepEqual(tabs.filter(globMatcher("hacker")).length, 1);
  assert.deepEqual(tabs.filter(globMatcher("https://*")).length, 2);
  assert.deepEqual(tabs.filter(globMatcher("")).length, 2);
  assert.deepEqual(tabs.filter(globMatcher("*.com/")).length, 1);
});

test("registry has the Phase 2 commands", () => {
  for (const n of ["tabdo", "bufdo", "sp", "vsp", "reg", "g", "g!", "macros"]) assert.ok(findCommand(n), n);
  assert.equal(findCommand("vsplit").name, "vsp");
});
