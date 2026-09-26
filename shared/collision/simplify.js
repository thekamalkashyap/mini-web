/* Loop simplification — closed-loop Douglas-Peucker plus a collinear merge.
   Pixel stairs collapse into clean diagonals (a 2px stair corner deviates
   ~1.4px from its diagonal, under the tolerance), real corners survive, and
   curves keep vertices wherever they bend beyond tolerance. Tiny loops keep
   raw 2px fidelity instead of degenerating. Output stays on input vertices
   (grid points), implicitly closed. */
export function simplifyLoop(loop, tol = 2) {
  const n = loop.length;
  if (n < 3) return loop.slice();
  let per = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i],
      b = loop[(i + 1) % n];
    per += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (per < 24) return loop.slice();

  /* split the ring at the point furthest from 0, simplify both halves */
  let m = 0,
    best = -1;
  for (let i = 1; i < n; i++) {
    const d =
      (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2;
    if (d > best) {
      best = d;
      m = i;
    }
  }
  if (best <= 0) return [loop[0].slice()]; // all points identical (defensive)
  const keep = new Array(n).fill(false);
  const idx1 = [];
  for (let i = 0; i <= m; i++) idx1.push(i);
  const idx2 = [];
  for (let i = m; i < n; i++) idx2.push(i);
  idx2.push(0);
  dpChain(loop, idx1, tol, keep);
  dpChain(loop, idx2, tol, keep);

  const pts = [];
  for (let i = 0; i < n; i++) if (keep[i]) pts.push(loop[i]);
  return mergeCollinear(pts);
}

/* Douglas-Peucker over one open index chain; marks kept vertices. */
function dpChain(pts, idx, tol, keep) {
  keep[idx[0]] = true;
  keep[idx[idx.length - 1]] = true;
  const stack = [[0, idx.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    if (e - s < 2) continue;
    const a = pts[idx[s]],
      b = pts[idx[e]];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    let mi = -1,
      md = tol;
    for (let i = s + 1; i < e; i++) {
      const p = pts[idx[i]];
      const dev = Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / len;
      if (dev > md) {
        md = dev;
        mi = i;
      }
    }
    if (mi > 0) {
      keep[idx[mi]] = true;
      stack.push([s, mi], [mi, e]);
    }
  }
}

/* Floor smoothing — chord through feet-scale teeth and notches so soldiers
   sit and walk smooth instead of perching on teeth and dipping between
   them. Only FLOOR runs qualify (chord heads eastward-ish: outward normal
   up); walls, ceilings and crisp corners are never touched:
   - span gate: chord <= 48px
   - height gate (asymmetric): teeth cut to 32px; narrow (<= 32px) cracks
     bridge to 64px deep (feet span sub-foot mouths physically, so bridging
     is exact); wider pits stay open past 24px (real pits you can drop into)
   - alignment gate: both beyond-tangents within 30° of the chord — this is
     what keeps real corners (apexes, wall bases/tops, ledges): their
     tangents diverge from any spanning chord, while teeth/notch rims on a
     run continue straight. Greedy longest-first, advancing past accepted
     chords (no overlap chaining); repeats to a fixpoint. Deterministic. */
export const FLOOR_SMOOTH_SPAN = 48;
export const FLOOR_SMOOTH_NARROW = 32; // sub-foot: the 44px box bridges these physically
export const FLOOR_SMOOTH_TOOTH = 32; // cut spikes this tall (taller = real obstacle)
export const FLOOR_SMOOTH_NOTCH_DEEP = 64; // bridge narrow cracks this deep (feet never enter)
export const FLOOR_SMOOTH_NOTCH_WIDE = 16; // wider pits stay open past this depth (real pits)
const ALIGN_DOT = 0.866; // cos(30°)
const ALIGN_REACH = 48; // tangent sampling reach (sees the run past teeth and bends)
const ALIGN_EAST = 0.3; // reach tangents must head eastward-ish (rejects wall chamfers)

/* Run direction at index i looking backward (dir=-1) or forward (dir=+1):
   walks until ALIGN_REACH px accumulated. Adjacent-edge tangents are useless
   in teeth fields (they ARE the tooth flanks); the reach averages 1-2 teeth
   into the run direction, while still diverging across real corners. */
function reachTangent(pts, i, dir) {
  const n = pts.length;
  const ax = pts[i][0],
    ay = pts[i][1];
  let px = ax,
    py = ay,
    dist = 0;
  for (let k = 1; k <= 12 && dist < ALIGN_REACH; k++) {
    const q = pts[(i + dir * k + n * 12) % n];
    dist += Math.hypot(q[0] - px, q[1] - py);
    px = q[0];
    py = q[1];
  }
  const dx = dir > 0 ? px - ax : ax - px,
    dy = dir > 0 ? py - ay : ay - py;
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

export function smoothFloorRuns(ring) {
  let pts = ring;
  for (let pass = 0; pass < 4; pass++) {
    const n = pts.length;
    if (n < 4) return pts;
    const drop = new Array(n).fill(false);
    let changed = false;
    let i = 0;
    let guard = 0;
    while (guard++ < n + 4) {
      if (i >= n) break;
      if (drop[i]) {
        i++;
        continue;
      }
      let bestJ = -1;
      /* longest valid chord first (k window bounds the search; span gate
         binds on sparse vertices) */
      for (let k = 2; k <= 10; k++) {
        const j = (i + k) % n;
        if (drop[j]) break;
        const a = pts[i],
          b = pts[j];
        const dx = b[0] - a[0],
          dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len > FLOOR_SMOOTH_SPAN || len < 1) continue;
        /* floor-like chord: heads eastward within 60° (outward normal up) */
        if (dx / len < 0.5) continue;
        /* asymmetric height gate (dev > 0 = air side / teeth, dev < 0 =
           solid side / notches): narrow cracks bridge deep (feet physically
           span sub-foot mouths, so bridging is exact), wider pits stay open
           past shin depth (real pits you can drop into), spikes cut to knee
           height (taller = real obstacle). Stairs/S-wiggles obey both. */
        let hmax = 0,
          hmin = 0;
        for (let m = 1; m < k; m++) {
          const p = pts[(i + m) % n];
          const dev = (dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / len;
          if (dev > hmax) hmax = dev;
          if (dev < hmin) hmin = dev;
        }
        if (hmax > FLOOR_SMOOTH_TOOTH) continue;
        const notchAllow =
          len <= FLOOR_SMOOTH_NARROW
            ? FLOOR_SMOOTH_NOTCH_DEEP
            : FLOOR_SMOOTH_NOTCH_WIDE;
        if (-hmin > notchAllow) continue;
        /* alignment: the run must stay a floor on both sides (wall
           tangents head north/south and fail the eastward check, so wall
           bases/tops are never chamfered), and the run direction on EITHER
           side must continue the chord — spanning chords legitimately follow
           run bends (shoulder curves) through teeth fields, while real
           corners diverge on both sides and are kept */
        const [t1x, t1y] = reachTangent(pts, i, -1);
        const [t2x, t2y] = reachTangent(pts, j, 1);
        if (t1x < ALIGN_EAST || t2x < ALIGN_EAST) continue;
        const d1 = (t1x * dx + t1y * dy) / len;
        const d2 = (t2x * dx + t2y * dy) / len;
        if (Math.max(d1, d2) < ALIGN_DOT) continue;
        bestJ = j;
      }
      if (bestJ >= 0) {
        /* drop intermediates strictly between i and bestJ along the ring */
        let m = (i + 1) % n;
        while (m !== bestJ) {
          drop[m] = true;
          m = (m + 1) % n;
        }
        changed = true;
        if (bestJ <= i) break; // wrapped past the ring end: next pass resumes at 0
        i = bestJ; // advance past the chord (no overlap chaining)
      } else i++;
    }
    if (!changed) return pts;
    const next = pts.filter((_, idx) => !drop[idx]);
    if (next.length < 2) return pts; // dead defense: never empty a ring
    pts = next;
  }
  return pts;
}

/* Drop vertices sitting on the straight line through their neighbors
   (same direction only — spikes double back, so dot <= 0 keeps them).
   Simultaneous drops are exact here: any subset of a straight run stays
   straight, so one pass flattens whole walls to single segments. */
function mergeCollinear(pts) {
  if (pts.length < 3) return pts;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i - 1 + pts.length) % pts.length],
      q = pts[i],
      r = pts[(i + 1) % pts.length];
    const dx = r[0] - p[0],
      dy = r[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    const dev = Math.abs(dx * (p[1] - q[1]) - dy * (p[0] - q[0])) / len;
    const dot = (q[0] - p[0]) * (r[0] - q[0]) + (q[1] - p[1]) * (r[1] - q[1]);
    if (dev <= 0.5 && dot > 0) continue; // q redundant
    out.push(q);
  }
  return out.length >= 2 ? out : pts;
}
