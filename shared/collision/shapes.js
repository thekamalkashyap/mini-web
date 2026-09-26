/* Physics-shape builder: traced boundary segments.
   Every solid/air boundary in the mask (floors, walls, ceilings, overhangs,
   cave interiors) is traced into closed loops, simplified, and emitted as
   segments; the sim extrudes each segment inward into a static quad whose
   air-side face IS the segment. One shape type, complete coverage, no stairs
   anywhere — the old topmost-profile skins covered only ~20% of floors and
   left everything else as 8px stair rects. */
import { TRIP } from "../utils/debug.js";
import { traceBoundaryLoops } from "./trace.js";
import { simplifyLoop, smoothFloorRuns } from "./simplify.js";

export const SIMPLIFY_TOL = 6; // px: sub-foot art teeth chord through (feet
// span them — the old skins used the same 6px fit), pixel stairs collapse,
// real corners and ledges survive. Tighter values reproduce art texture as
// staircase noise; looser values facet curves.
export const EXTRUDE_MAX = 48; // inward bulk: anti-tunnel depth in solid
export const EXTRUDE_MIN = 8; // solver-stable minimum quad thickness
/* Body budget: real maps peak near 7k segments; past this, smallest loops
   (dust, UI strokes) are dropped first. The old builder hard-crashed the
   process here (exit 99) — a lobby-selectable map must never do that. */
export const SEGMENT_BUDGET = 20000;

/* Inward extrusion depth for a segment midpoint: reach the solid first
   (chords can bridge shallow notches), then stop at the far side — thin
   walls and platforms stay exact on BOTH faces instead of poking an
   invisible slab past the far side. Sub-8px slivers keep the minimum
   thickness for solver stability (a <=6px nub past the far face). */
function extrudeDepth(map, mx, my, nx, ny) {
  let d = 0;
  while (d <= EXTRUDE_MAX && !map.solidAtPixel(mx + nx * d, my + ny * d))
    d += 2;
  let exit = EXTRUDE_MAX;
  for (; d <= EXTRUDE_MAX; d += 2) {
    if (!map.solidAtPixel(mx + nx * d, my + ny * d)) {
      exit = d;
      break;
    }
  }
  return Math.min(EXTRUDE_MAX, Math.max(EXTRUDE_MIN, exit));
}

/* Segments: {ax,ay,bx,by} air-face endpoints (world px, loop order, solid on
   the right of travel), {nx,ny} inward unit normal, depth inward extrusion.
   Consecutive segments share exact endpoints — closed loops, no cracks. */
export function buildColliderSegments(map) {
  let loops;
  if (map.mask) {
    const rows = (map.mask.length / map.maskCols) | 0;
    loops = traceBoundaryLoops(map.mask, map.maskCols, rows, map.maskStep);
  } else {
    /* mask-less fallback (whole tiles, never authoritative): trace the tile
       grid itself, so tile edges become exact segment faces */
    const coarse = new Uint8Array(map.cols * map.rows);
    for (let ty = 0; ty < map.rows; ty++)
      for (let tx = 0; tx < map.cols; tx++)
        coarse[ty * map.cols + tx] = map.gidAt(map.solid, tx, ty) > 0 ? 1 : 0;
    loops = traceBoundaryLoops(coarse, map.cols, map.rows, map.tw);
  }
  /* simplify per loop, smooth feet-scale floor teeth, then enforce the
     body budget smallest-first */
  const rings = [];
  for (const loop of loops) {
    /* dedupe (defensive: trace/simplify emit grid points, so distinct
       vertices are >= 2px apart and the ring below cannot degenerate) */
    const clean = [];
    for (const p of smoothFloorRuns(simplifyLoop(loop, SIMPLIFY_TOL))) {
      const q = clean[clean.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= 0.5) clean.push(p);
    }
    if (clean.length > 1) {
      const f = clean[0],
        l = clean[clean.length - 1];
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.5) clean.pop();
    }
    if (clean.length < 2) continue;
    let per = 0;
    for (let i = 0; i < clean.length; i++) {
      const a = clean[i],
        b = clean[(i + 1) % clean.length];
      per += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    rings.push({ pts: clean, per });
  }
  rings.sort((a, b) => b.per - a.per);
  const segs = [];
  let dropped = 0;
  for (const r of rings) {
    if (segs.length + r.pts.length > SEGMENT_BUDGET) {
      dropped++;
      continue;
    }
    for (let i = 0; i < r.pts.length; i++) {
      const a = r.pts[i],
        b = r.pts[(i + 1) % r.pts.length];
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      /* inward normal: solid rides on the right of travel (trace.js) */
      const nx = -dy / len,
        ny = dx / len;
      segs.push({
        ax: a[0],
        ay: a[1],
        bx: b[0],
        by: b[1],
        nx,
        ny,
        depth: extrudeDepth(map, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, nx, ny),
      });
    }
  }
  if (dropped)
    console.warn(
      `[colliders] over budget: dropped ${dropped} smallest loops (${segs.length} segments kept)`,
    );
  TRIP("segments", segs.length, SEGMENT_BUDGET + 1000);
  return segs;
}

/* Physics shapes: the single segment list. Static-static overlap is free,
   so neighboring extruded quads may freely overlap inside the solid. */
export function buildSolidShapes(map) {
  return { segments: buildColliderSegments(map) };
}
