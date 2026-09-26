/* Collision mask pipeline: trace the 2px alpha mask from tile art, then clean
   it (decor exclusion, despike, destair). Runs identically on server (pngjs
   pixels) and browser (canvas pixels) — AGENT.md #4. Pure functions over the
   map JSON; GameMap owns the resulting mask. */

/* 2px-resolution solid bitmap traced from the tile art's alpha channel.
   getTilePixels(gid) -> Uint8ClampedArray RGBA (or null) — implemented via
   pngjs on the server and canvas/Phaser textures on the client, so BOTH
   sides see identical collision (the old headless whole-tile fallback
   diverged from the browser; masks are now mandatory for sim hosts). */
export function buildMaskData(json, getTilePixels) {
  const step = 2;
  const w = json.w * json.tileW,
    h = json.h * json.tileH;
  const cols = Math.ceil(w / step),
    rows = Math.ceil(h / step);
  const mask = new Uint8Array(cols * rows);
  const green = new Uint8Array(cols * rows);
  const black = new Uint8Array(cols * rows);
  const tw = json.tileW,
    th = json.tileH;
  const solid =
    json.layers.find((l) => l.name === "tile") ||
    json.layers[json.layers.length - 1];
  const dataCache = {};
  for (let ty = 0; ty < json.h; ty++) {
    for (let tx = 0; tx < json.w; tx++) {
      const gid = solid.data[ty * json.w + tx] & 0x1fffffff;
      if (!gid) continue;
      let data = dataCache[gid];
      if (data === undefined) {
        data = getTilePixels(gid, json);
        dataCache[gid] = data;
      }
      if (!data) continue;
      for (let py = 0; py < th; py += step)
        for (let px = 0; px < tw; px += step) {
          const o = (py * tw + px) * 4;
          if (data[o + 3] <= 36) continue;
          /* decorative grass tufts are painted strongly green (rock is tan/
             gray, outlines near-black). Record green separately — tufts
             sticking off the surface are cleared below, but green inside
             the rock mass (mossy crack streaks down cliff faces) stays
             solid: blanket removal would punch slots through cliffs. Both
             hosts see the same RGBA, so the split is pixel-identical on
             server and browser. */
          const r = data[o],
            g = data[o + 1],
            b = data[o + 2];
          const mi =
            (((ty * th + py) / step) | 0) * cols +
            (((tx * tw + px) / step) | 0);
          mask[mi] = 1;
          /* Grass decor = VIVID green tufts AND their darker olive shading
             (g-dominant, both darker (56,79,56) and brighter (99,144,99)).
             Rock is tan/olive where g never dominates by 14+. */
          if (
            (g > 60 && g > r + 25 && g > b + 15) ||
            (g >= 45 && g > r && g > b && g - Math.min(r, b) >= 14)
          )
            green[mi] = 1;
          else if (r < 40 && g < 40 && b < 40) black[mi] = 1;
        }
    }
  }
  /* Clear decor off the rock surface (runs before despike so the profiler
     sees the true rock line). Rock is the first solid BROWN/GRAY pixel per
     column: vivid GREEN tufts and BLACK outline strokes (all channels < 40
     — blade shells, tuft tips, AA) see through. Blades used to masquerade
     as rock through their dark tips, zigzagging colliders through grass;
     rock teeth lose only their 1-2px outline caps and stay rock. Everything
     above true rock clears; rock-less columns (bushes, vines) clear fully.
     Green at/below rock (crack streaks, flush moss) stays. */
  for (let c = 0; c < cols; c++) {
    let rock = -1;
    for (let r = 0; r < rows; r++) {
      const i = r * cols + c;
      if (!mask[i] || green[i] || black[i]) continue;
      rock = r;
      break;
    }
    for (let r = 0; r < rows; r++) {
      if (!mask[r * cols + c]) continue;
      if (rock < 0 || r < rock) mask[r * cols + c] = 0;
    }
  }
  /* Tile art carries decorative grass tufts / rock spikes that jut off every
     surface (<=16px wide, up to ~30px tall). They used to become solid:
     snagging feet, sparking bullets on bare air. Strip them here — inside
     the shared builder — so server (pngjs) and browser (canvas) stay
     pixel-identical (AGENT.md #4). */
  despikeMask(mask, cols, rows);
  /* Diagonal slopes are authored as chunky stair tiles: the traced surface
     zigzags in 8-30px teeth even where the eye (and the grass over it) sees
     one straight ramp. Straighten it so the walkable collider is the ramp
     itself — the flipped-V line — not a stair of walls. */
  destairMask(mask, cols, rows);
  return { mask, step, cols };
}

/* Remove thin protrusions from up- and down-facing surfaces.
   1) horizontal opening: drop solid runs narrower than 14px (7 cells) —
      grass blades are thin in every row, bulk terrain never is.
   2) profile cut: anything sticking >12px above the local median surface
      (median over +-24px) and narrower than 48px is a tuft, not a hill —
      shave it flush. Same mirrored for ceiling stalactites. */
export function despikeMask(mask, cols, rows) {
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (!mask[r * cols + c]) {
        c++;
        continue;
      }
      let e = c;
      while (e + 1 < cols && mask[r * cols + e + 1]) e++;
      if (e - c + 1 < 7) for (let k = c; k <= e; k++) mask[r * cols + k] = 0;
      c = e + 1;
    }
  }
  for (const dir of [1, -1]) {
    const edge = new Int32Array(cols).fill(-1);
    for (let c = 0; c < cols; c++) {
      if (dir > 0) {
        for (let r = 0; r < rows; r++)
          if (mask[r * cols + c]) {
            edge[c] = r;
            break;
          }
      } else {
        for (let r = rows - 1; r >= 0; r--)
          if (mask[r * cols + c]) {
            edge[c] = r;
            break;
          }
      }
    }
    const smooth = new Int32Array(cols);
    for (let c = 0; c < cols; c++) {
      const vals = [];
      for (let k = -12; k <= 12; k++) {
        const cc = c + k;
        if (cc >= 0 && cc < cols && edge[cc] >= 0) vals.push(edge[cc]);
      }
      vals.sort((a, b) => a - b);
      smooth[c] = vals.length ? vals[vals.length >> 1] : edge[c];
    }
    let s = -1;
    const flush = (cx) => {
      const cut = smooth[cx],
        top = edge[cx];
      /* stop AT the smoothed surface row — eating it too leaves a 1-cell
         step that the next audit mistakes for residue */
      if (dir > 0) {
        for (let r = top; r < cut && r < rows; r++) mask[r * cols + cx] = 0;
      } else {
        for (let r = top; r > cut && r >= 0; r--) mask[r * cols + cx] = 0;
      }
    };
    /* run width just under the tip: tufts stay narrow, wall-face steps
       widen into the diagonal bulk immediately — spare those */
    const runWidthAt = (cx, r) => {
      if (r < 0 || r >= rows) return 0;
      let a = cx,
        b = cx;
      while (a - 1 >= 0 && mask[r * cols + a - 1]) a--;
      while (b + 1 < cols && mask[r * cols + b + 1]) b++;
      return b - a + 1;
    };
    for (let c = 0; c <= cols; c++) {
      const prot =
        c < cols &&
        edge[c] >= 0 &&
        smooth[c] >= 0 &&
        (smooth[c] - edge[c]) * dir > 6;
      if (prot && s < 0) s = c;
      if (!prot && s >= 0) {
        if (c - s < 24) {
          const km = (s + c) >> 1;
          if (runWidthAt(km, edge[km] + dir * 2) < 12)
            for (let k = s; k < c; k++) flush(k);
        }
        s = -1;
      }
    }
  }
}

/* Straighten stair-quantized diagonals: art slopes come as chunky tiles,
   so the mask surface steps 8-30px at every tile boundary. Shave cells
   sticking above the rolling-median surface line (window +-64px) down to
   just above the median — NEVER fill (air the art shows stays air) and
   never touch walls/ledges (steps > 24px are real terrain and skipped).
   After this, one 45-degree slope reads as one straight ramp and traces to
   one clean segment instead of a staircase of teeth. */
export function destairMask(mask, cols, rows) {
  const top = new Int32Array(cols).fill(-1);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++)
      if (mask[r * cols + c]) {
        top[c] = r;
        break;
      }
  }
  const W = 32,
    TOL = 3,
    MAX_CUT = 10; /* cells (2px): window +-64px, tol 6px, cut <= 20px */
  const med = new Int32Array(cols).fill(-1);
  const buf = [];
  for (let c = 0; c < cols; c++) {
    buf.length = 0;
    for (let k = -W; k <= W; k++) {
      const cc = c + k;
      if (cc >= 0 && cc < cols && top[cc] >= 0) buf.push(top[cc]);
    }
    if (!buf.length) continue;
    buf.sort((a, b) => a - b);
    med[c] = buf[buf.length >> 1];
  }
  for (let c = 0; c < cols; c++) {
    if (top[c] < 0 || med[c] < 0) continue;
    const prot = top[c] - med[c]; /* negative = above the median line */
    if (prot > -TOL) continue; /* flush already */
    if (prot < -MAX_CUT) continue; /* real ledge/hill top — leave it */
    const cut = Math.max(med[c] - 2, top[c] + 1);
    for (let r = top[c]; r < cut; r++) mask[r * cols + c] = 0;
  }
}
