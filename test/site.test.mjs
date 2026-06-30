/* Unit tests for pure helpers in site.js.
 * site.js is a browser-global plain script; we load it into a vm context
 * (mirroring mapview.test.mjs / build/verify_pages.mjs) and pull the
 * helpers off the synthesized window. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = vm.createContext({});
ctx.window = ctx;
vm.runInContext(fs.readFileSync(new URL("../site.js", import.meta.url), "utf8"), ctx);
const { fmtDate, flag } = ctx;

test("site.js exports fmtDate", () => {
  assert.equal(typeof fmtDate, "function");
});

test("fmtDate renders a full, human date from an ISO day", () => {
  assert.equal(fmtDate("2025-01-31"), "Jan 31, 2025");
  assert.equal(fmtDate("2025-12-25"), "Dec 25, 2025");
});

test("fmtDate drops the leading zero on the day-of-month", () => {
  assert.equal(fmtDate("2025-02-09"), "Feb 9, 2025");
  assert.equal(fmtDate("2025-06-01"), "Jun 1, 2025");
});

test("fmtDate handles every month index without falling off the array", () => {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  months.forEach((name, i) => {
    const mm = String(i + 1).padStart(2, "0");
    assert.equal(fmtDate(`2025-${mm}-15`), `${name} 15, 2025`);
  });
});

test("fmtDate ignores a trailing time component", () => {
  assert.equal(fmtDate("2025-06-30T12:34:56"), "Jun 30, 2025");
});

test("fmtDate returns '' for empty/nullish input", () => {
  assert.equal(fmtDate(""), "");
  assert.equal(fmtDate(null), "");
  assert.equal(fmtDate(undefined), "");
});

test("fmtDate passes through a non-ISO string unchanged", () => {
  assert.equal(fmtDate("sometime in 2025"), "sometime in 2025");
});

/* flag() is unchanged logic, but the emoji-font fallback work is about flags —
 * a quick guard that the curated override + derived path still hold. */
test("flag uses curated overrides and derives the rest from the ISO code", () => {
  assert.equal(flag("US"), "🇺🇸");          // derived from regional indicators
  assert.equal(flag("GB"), "🏴󠁧󠁢󠁳󠁣󠁴󠁿");  // curated override (Scotland)
  assert.equal(flag("zz".toUpperCase()), "🇿🇿"); // still derives for unknown-but-valid codes
  assert.equal(flag(""), "🏳️");            // falls back to a neutral flag
});
