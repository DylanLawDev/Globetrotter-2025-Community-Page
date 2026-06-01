/* Unit tests for the pure zoom/pan transform math in mapview.js.
 * mapview.js is a browser-global plain script; we load it into a vm
 * context (mirroring build/verify_pages.mjs) and pull MapView off it. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = vm.createContext({});
ctx.window = ctx;
vm.runInContext(fs.readFileSync(new URL("../mapview.js", import.meta.url), "utf8"), ctx);
const MapView = ctx.MapView;

const VW = 600, VH = 300; // the chart viewport (2:1)

test("MapView is exported with a MAX_SCALE", () => {
  assert.ok(MapView, "MapView global should exist");
  assert.ok(MapView.MAX_SCALE > 1, "MAX_SCALE should be > 1");
});

test("clamp pins translation to 0 at scale 1 (no room to pan)", () => {
  const s = MapView.clamp({ scale: 1, x: 50, y: -30 }, VW, VH);
  assert.equal(s.scale, 1);
  assert.equal(s.x, 0);
  assert.equal(s.y, 0);
});

test("clamp stops panning past the top-left edge", () => {
  // positive x/y would reveal empty space before the map's left/top
  const s = MapView.clamp({ scale: 2, x: 100, y: 80 }, VW, VH);
  assert.equal(s.x, 0);
  assert.equal(s.y, 0);
});

test("clamp stops panning past the bottom-right edge", () => {
  // at scale 2 the content is 1200x600; min translate is vw*(1-scale)
  const s = MapView.clamp({ scale: 2, x: -9999, y: -9999 }, VW, VH);
  assert.equal(s.x, VW * (1 - 2)); // -600
  assert.equal(s.y, VH * (1 - 2)); // -300
});

test("clamp floors scale at 1", () => {
  const s = MapView.clamp({ scale: 0.3, x: 0, y: 0 }, VW, VH);
  assert.equal(s.scale, 1);
});

test("clamp caps scale at MAX_SCALE", () => {
  const s = MapView.clamp({ scale: 999, x: 0, y: 0 }, VW, VH);
  assert.equal(s.scale, MapView.MAX_SCALE);
});

test("zoomAt keeps the point under the cursor fixed", () => {
  const start = { scale: 1, x: 0, y: 0 };
  const px = 450, py = 100; // cursor somewhere off-center
  const next = MapView.zoomAt(start, 2, px, py, VW, VH);
  assert.equal(next.scale, 2);
  // content coordinate under the cursor must be unchanged after zoom
  const before = (px - start.x) / start.scale;
  const after = (px - next.x) / next.scale;
  assert.ok(Math.abs(before - after) < 1e-9, `cursor x drifted: ${before} -> ${after}`);
  const beforeY = (py - start.y) / start.scale;
  const afterY = (py - next.y) / next.scale;
  assert.ok(Math.abs(beforeY - afterY) < 1e-9, `cursor y drifted: ${beforeY} -> ${afterY}`);
});

test("zoomAt out below scale 1 resets to a fully-fit map", () => {
  const next = MapView.zoomAt({ scale: 1, x: 0, y: 0 }, 0.5, 300, 150, VW, VH);
  assert.equal(next.scale, 1);
  assert.equal(next.x, 0);
  assert.equal(next.y, 0);
});

test("markerScale is 1 at zoom 1 (dots at their base size)", () => {
  assert.equal(MapView.markerScale(1), 1);
});

test("markerScale grows the dot at low zoom", () => {
  const net1 = 1 * MapView.markerScale(1);
  const net2 = 2 * MapView.markerScale(2);
  assert.ok(net2 > net1, "dot should be bigger at 2x than 1x");
});

test("net dot size is capped so dense clusters can't blob at high zoom", () => {
  const CAP = MapView.DOT_CAP;
  assert.ok(CAP > 1, "cap should allow some growth");
  for (const z of [4, 8, 16, MapView.MAX_SCALE]) {
    const net = z * MapView.markerScale(z);
    assert.ok(net <= CAP + 1e-9, `net dot at ${z}x (${net}) exceeded cap ${CAP}`);
  }
});

test("beyond the cap, dots shrink relative to the map so they separate", () => {
  // the counter-scale factor keeps decreasing as you zoom further in
  assert.ok(MapView.markerScale(16) < MapView.markerScale(8));
  assert.ok(MapView.markerScale(8) < MapView.markerScale(4));
  assert.ok(MapView.markerScale(4) < MapView.markerScale(1));
});

test("zoomAt result is always within clamp bounds", () => {
  // zoom hard at a corner; pan must not escape the frame
  const next = MapView.zoomAt({ scale: 4, x: -100, y: -100 }, 1.5, 599, 299, VW, VH);
  assert.ok(next.x <= 0 && next.x >= VW * (1 - next.scale), `x out of bounds: ${next.x}`);
  assert.ok(next.y <= 0 && next.y >= VH * (1 - next.scale), `y out of bounds: ${next.y}`);
});
