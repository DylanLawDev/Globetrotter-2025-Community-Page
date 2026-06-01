/* ==========================================================================
   MapView — pure zoom/pan transform math for the equirectangular chart.
   No DOM here; map.html wires these into wheel/drag/button handlers.
   State is { scale, x, y }: scale >= 1, (x,y) is a pixel translate applied
   with transform-origin 0 0 to a content box the size of the viewport.
   ========================================================================== */
const MapView = {
  MAX_SCALE: 20,
  DOT_CAP: 1.5,   // max on-screen dot growth; past this, zooming only separates pins

  /* Clamp scale to [1, MAX_SCALE] and pan so the scaled content always
     covers the viewport (no empty gutters). */
  clamp(state, vw, vh) {
    const scale = Math.min(Math.max(state.scale, 1), this.MAX_SCALE);
    const minX = vw * (1 - scale), minY = vh * (1 - scale);
    const x = Math.min(Math.max(state.x, minX), 0);
    const y = Math.min(Math.max(state.y, minY), 0);
    return { scale, x, y };
  },

  /* CSS scale factor applied to a marker to counter the map zoom. The dot's
     net on-screen size is min(sqrt(zoom), DOT_CAP): it grows at low zoom, then
     plateaus — so zooming further only spreads pins apart, never blobs them. */
  markerScale(scale) {
    const s = Math.min(Math.max(scale, 1), this.MAX_SCALE);
    return Math.min(Math.sqrt(s), this.DOT_CAP) / s;
  },

  /* Zoom by `factor` around viewport point (px,py), keeping the content
     coordinate under that point fixed. Returns a clamped state. */
  zoomAt(state, factor, px, py, vw, vh) {
    const newScale = Math.min(Math.max(state.scale * factor, 1), this.MAX_SCALE);
    const cx = (px - state.x) / state.scale;
    const cy = (py - state.y) / state.scale;
    const x = px - cx * newScale;
    const y = py - cy * newScale;
    return this.clamp({ scale: newScale, x, y }, vw, vh);
  },
};

if (typeof window !== "undefined") window.MapView = MapView;
if (typeof module !== "undefined") module.exports = MapView;
