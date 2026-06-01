/* Headless-ish page verifier: runs each page's inline <script> against the real
 * site.js + chart.js + data.js with a forgiving DOM shim. Catches reference/contract
 * errors and confirms dynamic containers actually got populated. Not a pixel test. */
import fs from "node:fs";
import vm from "node:vm";

const reg = {};
const makeCtx = () => new Proxy(function () { return makeCtx(); }, { get: () => (..._a) => makeCtx(), apply: () => makeCtx() });
function makeEl(tag = "div") {
  const store = {
    tagName: (tag || "div").toUpperCase(), innerHTML: "", outerHTML: "", textContent: "", value: "",
    className: "", id: "", dataset: {}, children: [], width: 600, height: 300, offsetWidth: 600, offsetHeight: 300,
    style: new Proxy({}, { get: (_t, p) => (["setProperty", "getPropertyValue", "removeProperty"].includes(p) ? () => "" : ""), set: () => true }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
  const methods = {
    appendChild: (c) => (store.children.push(c), c), append() {}, prepend() {}, insertAdjacentHTML() {},
    setAttribute() {}, setAttributeNS() {}, removeAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, remove() {}, scrollIntoView() {}, focus() {}, cloneNode: () => makeEl(tag),
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ width: 600, height: 300, top: 0, left: 0, right: 600, bottom: 300 }),
    querySelector: () => null, querySelectorAll: () => [],
  };
  return new Proxy(store, {
    get(t, p) { if (p in methods) return methods[p]; if (p in t) return t[p]; return () => undefined; },
    set(t, p, v) { t[p] = v; return true; },
  });
}

const ctx = vm.createContext();
const g = ctx;
g.globalThis = g; g.window = g; g.self = g;
g.console = console; g.Math = Math; g.Date = Date; g.JSON = JSON; g.Set = Set; g.Map = Map;
g.Array = Array; g.Object = Object; g.String = String; g.Number = Number; g.URLSearchParams = URLSearchParams;
g.requestAnimationFrame = () => 0; g.cancelAnimationFrame = () => {};
g.addEventListener = () => {}; g.removeEventListener = () => {}; g.setTimeout = () => 0;
g.navigator = { userAgent: "node" };
g.location = { search: "", hash: "", href: "file:///x.html" };
g.document = {
  getElementById: (id) => reg[id] || (reg[id] = makeEl("div")),
  createElement: (t) => makeEl(t), createElementNS: (_n, t) => makeEl(t),
  querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {},
  body: makeEl("body"), documentElement: makeEl("html"), title: "",
};

const run = (code, label) => vm.runInContext(code, ctx, { filename: label });
// load shared libs + data once
for (const f of ["site.js", "world.js", "mapview.js", "chart.js", "data.js"]) run(fs.readFileSync(f, "utf8"), f);

const inlineScripts = (html) =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");

const cases = [
  ["index.html", {}, ["stat-strip:cell", "featured:stamp-card", "leaderboard:lb-row", "hero-passport:cap"]],
  ["atlas.html", {}, []],
  ["city.html", { search: "?id=budapest" }, ["city-root:submission"]],
  ["city.html", { search: "?id=montreal" }, ["city-root:submission"]],
  ["city.html", { search: "?id=zzz-nope" }, ["city-root:not found"]],
  ["map.html", { search: "" }, ["city-list:li"]],
  ["contributors.html", {}, []],
  ["profile.html", { search: "?id=duck" }, []],
];

let failures = 0;
for (const [page, loc, checks] of cases) {
  for (const k of Object.keys(reg)) delete reg[k];
  g.location.search = loc.search || ""; g.location.hash = loc.hash || "";
  const script = inlineScripts(fs.readFileSync(page, "utf8"));
  const label = `${page} ${loc.search || ""}`.trim();
  try {
    run(`(function(){\n${script}\n})()`, label);
    const notes = checks.map((c) => {
      const [id, needle] = c.split(":");
      const el = reg[id];
      const ok = el && String(el.innerHTML).includes(needle);
      return `${ok ? "✓" : "✗"} #${id}~"${needle}"`;
    });
    const bad = notes.filter((n) => n.startsWith("✗"));
    if (bad.length) failures++;
    console.log(`${bad.length ? "FAIL" : "ok  "}  ${label}   ${notes.join("  ")}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${label}\n      ${e.stack.split("\n").slice(0, 3).join("\n      ")}`);
  }
}
console.log(`\n${failures ? failures + " page(s) with issues" : "all pages executed cleanly"}`);
process.exit(failures ? 1 : 0);
