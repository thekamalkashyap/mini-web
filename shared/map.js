/* GameMap — collision + object model shared by server room and client.
   Rendering moved to Phaser (Tiled adapter in the client); this file is the
   authoritative collision model (tile gids + optional 2px alpha mask).

   Golden rule (AGENT.md #2): TMX object y is bottom-up (cocos, double flip);
   flip ONCE here: y: this.h - o.y. Tile layer data is NOT flipped. */
import { TRIP } from "./constants.js";

/* Top-edge Y of the skin trapezoid spanning world x (null = no skin owns
   this column — walls, gaps, ceilings). Skins are x-sorted and disjoint
   except for shared joint endpoints (same snapped Y on both sides), so this
   binary-searches. Single source for the bulk tuck below and the tuck
   regression test. */
export function skinTopAt(skins, x) {
  let lo = 0, hi = skins.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, s = skins[m];
    if (x < s.x0) hi = m - 1;
    else if (x > s.x1) lo = m + 1;
    else {
      const t = (x - s.x0) / Math.max(1, s.x1 - s.x0);
      return s.y0 + (s.y1 - s.y0) * t;
    }
  }
  return null;
}

export class GameMap {
  constructor(json, maskData = null) {
    this.def = json;
    this.tw = json.tileW; this.th = json.tileH;
    this.w = json.w * this.tw;
    this.h = json.h * this.th;
    this.cols = json.w; this.rows = json.h;
    this.tilesets = json.tilesets;
    this.layers = json.layers;
    this.solid = json.layers.find(l => l.name === "tile") || json.layers[json.layers.length - 1];
    this.objects = json.objects.map(o => ({
      ...o, y: this.h - o.y,
      kind: (o.name.match(/^[a-z]+/g) || ["misc"])[0],
    }));
    if (maskData) { this.mask = maskData.mask; this.maskStep = maskData.step; this.maskCols = maskData.cols; }
    else this.mask = null;
  }

  /* 2px-resolution solid bitmap traced from the tile art's alpha channel.
     getTilePixels(gid) -> Uint8ClampedArray RGBA (or null) — implemented via
     pngjs on the server and canvas/Phaser textures on the client, so BOTH
     sides see identical collision (the old headless whole-tile fallback
     diverged from the browser; masks are now mandatory for sim hosts). */
  static buildMaskData(json, getTilePixels) {
    const step = 2;
    const w = json.w * json.tileW, h = json.h * json.tileH;
    const cols = Math.ceil(w / step), rows = Math.ceil(h / step);
    const mask = new Uint8Array(cols * rows);
    const green = new Uint8Array(cols * rows);
    const black = new Uint8Array(cols * rows);
    const tw = json.tileW, th = json.tileH;
    const solid = json.layers.find(l => l.name === "tile") || json.layers[json.layers.length - 1];
    const dataCache = {};
    for (let ty = 0; ty < json.h; ty++) {
      for (let tx = 0; tx < json.w; tx++) {
        const gid = solid.data[ty * json.w + tx] & 0x1fffffff;
        if (!gid) continue;
        let data = dataCache[gid];
        if (data === undefined) { data = getTilePixels(gid, json); dataCache[gid] = data; }
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
            const r = data[o], g = data[o + 1], b = data[o + 2];
            const mi = (((ty * th + py) / step) | 0) * cols + (((tx * tw + px) / step) | 0);
            mask[mi] = 1;
            /* Grass decor = VIVID green tufts AND their darker olive shading
               (g-dominant, both darker (56,79,56) and brighter (99,144,99)).
               Rock is tan/olive where g never dominates by 14+. */
            if ((g > 60 && g > r + 25 && g > b + 15) || (g >= 45 && g > r && g > b && g - Math.min(r, b) >= 14)) green[mi] = 1;
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
        rock = r; break;
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
    GameMap.despikeMask(mask, cols, rows);
    /* Diagonal slopes are authored as chunky stair tiles: the traced surface
       zigzags in 8-30px teeth even where the eye (and the grass over it) sees
       one straight ramp. Straighten it so the walkable collider is the ramp
       itself — the flipped-V line — not a stair of walls. */
    GameMap.destairMask(mask, cols, rows);
    return { mask, step, cols };
  }

  /* Remove thin protrusions from up- and down-facing surfaces.
     1) horizontal opening: drop solid runs narrower than 14px (7 cells) —
        grass blades are thin in every row, bulk terrain never is.
     2) profile cut: anything sticking >12px above the local median surface
        (median over +-24px) and narrower than 48px is a tuft, not a hill —
        shave it flush. Same mirrored for ceiling stalactites. */
  static despikeMask(mask, cols, rows) {
    for (let r = 0; r < rows; r++) {
      let c = 0;
      while (c < cols) {
        if (!mask[r * cols + c]) { c++; continue; }
        let e = c;
        while (e + 1 < cols && mask[r * cols + e + 1]) e++;
        if (e - c + 1 < 7) for (let k = c; k <= e; k++) mask[r * cols + k] = 0;
        c = e + 1;
      }
    }
    for (const dir of [1, -1]) {
      const edge = new Int32Array(cols).fill(-1);
      for (let c = 0; c < cols; c++) {
        if (dir > 0) { for (let r = 0; r < rows; r++) if (mask[r * cols + c]) { edge[c] = r; break; } }
        else { for (let r = rows - 1; r >= 0; r--) if (mask[r * cols + c]) { edge[c] = r; break; } }
      }
      const smooth = new Int32Array(cols);
      for (let c = 0; c < cols; c++) {
        const vals = [];
        for (let k = -12; k <= 12; k++) { const cc = c + k; if (cc >= 0 && cc < cols && edge[cc] >= 0) vals.push(edge[cc]); }
        vals.sort((a, b) => a - b);
        smooth[c] = vals.length ? vals[vals.length >> 1] : edge[c];
      }
      let s = -1;
      const flush = cx => {
        const cut = smooth[cx], top = edge[cx];
        /* stop AT the smoothed surface row — eating it too leaves a 1-cell
           step that the next audit mistakes for residue */
        if (dir > 0) { for (let r = top; r < cut && r < rows; r++) mask[r * cols + cx] = 0; }
        else { for (let r = top; r > cut && r >= 0; r--) mask[r * cols + cx] = 0; }
      };
      /* run width just under the tip: tufts stay narrow, wall-face steps
         widen into the diagonal bulk immediately — spare those */
      const runWidthAt = (cx, r) => {
        if (r < 0 || r >= rows) return 0;
        let a = cx, b = cx;
        while (a - 1 >= 0 && mask[r * cols + a - 1]) a--;
        while (b + 1 < cols && mask[r * cols + b + 1]) b++;
        return b - a + 1;
      };
      for (let c = 0; c <= cols; c++) {
        const prot = c < cols && edge[c] >= 0 && smooth[c] >= 0 && (smooth[c] - edge[c]) * dir > 6;
        if (prot && s < 0) s = c;
        if (!prot && s >= 0) {
          if (c - s < 24) {
            const km = (s + c) >> 1;
            if (runWidthAt(km, edge[km] + dir * 2) < 12) for (let k = s; k < c; k++) flush(k);
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
     After this, one 45-degree slope reads as one straight ramp and gets one
     slope skin instead of a staircase of tiny ramps + walls. */
  static destairMask(mask, cols, rows) {
    const top = new Int32Array(cols).fill(-1);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) if (mask[r * cols + c]) { top[c] = r; break; }
    }
    const W = 32, TOL = 3, MAX_CUT = 10;   /* cells (2px): window +-64px, tol 6px, cut <= 20px */
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
      const prot = top[c] - med[c];          /* negative = above the median line */
      if (prot > -TOL) continue;             /* flush already */
      if (prot < -MAX_CUT) continue;         /* real ledge/hill top — leave it */
      const cut = Math.max(med[c] - 2, top[c] + 1);
      for (let r = top[c]; r < cut; r++) mask[r * cols + c] = 0;
    }
  }

  tilesetFor(gid) {
    let ts = this.tilesets[0];
    for (const t of this.tilesets) if (t.firstgid <= gid) ts = t;
    return ts;
  }

  gidAt(layer, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return 0;
    return layer.data[ty * this.cols + tx] & 0x1fffffff;
  }

  solidAtPixel(x, y) {
    if (this.mask) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
      return this.mask[((y / this.maskStep) | 0) * this.maskCols + ((x / this.maskStep) | 0)] === 1;
    }
    return this.gidAt(this.solid, Math.floor(x / this.tw), Math.floor(y / this.th)) > 0;
  }

  /* AABB vs collision mask (2px sampling) — matches the art's silhouette */
  rectHitsWorld(x, y, w, h) {
    if (this.mask) {
      const st = this.maskStep;
      const x0 = Math.max(0, x), y0 = Math.max(0, y);
      const x1 = Math.min(this.w - 1, x + w - 1), y1 = Math.min(this.h - 1, y + h - 1);
      if (x1 < x0 || y1 < y0) return false;
      for (let py = y0; ; py += st) {
        if (py > y1) py = y1;
        const rowOff = ((py / st) | 0) * this.maskCols;
        for (let px = x0; ; px += st) {
          if (px > x1) px = x1;
          if (this.mask[rowOff + ((px / st) | 0)]) return true;
          if (px >= x1) break;
        }
        if (py >= y1) break;
      }
      return false;
    }
    const x0 = Math.floor(x / this.tw), x1 = Math.floor((x + w - 1) / this.tw);
    const y0 = Math.floor(y / this.th), y1 = Math.floor((y + h - 1) / this.th);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (this.gidAt(this.solid, tx, ty) > 0) return true;
    return false;
  }

  /* greedy-merged solid rectangles for the physics engine —
     8px cells over the art silhouette when a mask exists, else whole tiles.
     Cells above the skin-owned surface line are dropped (tucked): the skin
     trapezoid is the collider there, and the cell's 8px quantization would
     poke stair noise into the air. Walls, ceilings and unskinned runs keep
     every cell — only skinned columns tuck. */
  solidRects() {
    if (this._rects) return this._rects;
    const useMask = !!this.mask;
    const cell = useMask ? 8 : this.tw;
    const cols = Math.ceil(this.w / cell), rows = Math.ceil(this.h / cell);
    const grid = Array.from({ length: rows }, () => new Uint8Array(cols));
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        if (cx * cell >= this.w) continue;
        if (useMask) {
          const mx = ((cx * cell + cell / 2) / this.maskStep) | 0;
          const my = ((cy * cell + cell / 2) / this.maskStep) | 0;
          grid[cy][cx] = this.mask[my * this.maskCols + mx] === 1 ? 1 : 0;
        } else {
          grid[cy][cx] = this.gidAt(this.solid, cx, cy) > 0 ? 1 : 0;
        }
      }
    /* mask-less fallback (whole 128px tiles, never authoritative) skips the
       tuck: dropping a tile-sized cell for 1px of poke would punch real
       holes the 48px skin depth can't cover */
    const skins = useMask ? this.surfaceSkins() : [];
    if (skins.length) {
      for (let cy = 0; cy < rows; cy++)
        for (let cx = 0; cx < cols; cx++) {
          if (!grid[cy][cx]) continue;
          const sy = skinTopAt(skins, cx * cell + cell / 2);
          if (sy !== null && cy * cell < sy) grid[cy][cx] = 0;
        }
    }
    const rects = [];
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        if (!grid[cy][cx]) continue;
        let w = 1;
        while (cx + w < cols && grid[cy][cx + w]) w++;
        let h = 1;
        outer: while (cy + h < rows) {
          for (let k = 0; k < w; k++) if (!grid[cy + h][cx + k]) break outer;
          h++;
        }
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) grid[cy + dy][cx + dx] = 0;
        rects.push({ x: cx * cell, y: cy * cell, w: w * cell, h: h * cell });
      }
    TRIP("mesh", rects.length, 20000);
    this._rects = rects;
    return rects;
  }

  /* Up-facing surface profile sampled every `step` px: topmost solid Y per
     column (-1 = open air). Drives the slope-skin bodies below. */
  surfaceProfile(step = 8) {
    const cols = Math.ceil(this.w / step), prof = new Float32Array(cols).fill(-1);
    if (!this.mask) {
      for (let cx = 0; cx < cols; cx++) {
        const tx = Math.floor((cx * step + step / 2) / this.tw);
        for (let ty = 0; ty < this.rows; ty++)
          if (this.gidAt(this.solid, tx, ty) > 0) { prof[cx] = ty * this.th; break; }
      }
      return { prof, step };
    }
    for (let cx = 0; cx < cols; cx++) {
      const mc = Math.min(this.maskCols - 1, ((cx * step + step / 2) / this.maskStep) | 0);
      const mrows = (this.mask.length / this.maskCols) | 0;
      for (let r = 0; r < mrows; r++)
        if (this.mask[r * this.maskCols + mc]) { prof[cx] = r * this.maskStep; break; }
    }
    return { prof, step };
  }

  /* Nearest mask surface to (x, yGuess) within tol px, or null. */
  snapSurface(x, yGuess, tol = 12) {
    for (let d = 0; d <= tol; d += 2) {
      if (this.solidAtPixel(x, yGuess - d)) return yGuess - d;
      if (d && this.solidAtPixel(x, yGuess + d)) return yGuess + d;
    }
    return null;
  }

  /* Slope-following skins: every walkable surface run (slope <= ~63deg, no
     gaps/steps) gets a convex trapezoid whose top edge is the diagonal
     itself. Runs re-anchor at each joint (the next run starts where the last
     ended), so diagonals meet end-to-end into one unbroken surface line —
     never an 8px stair gap. x-sorted and disjoint by construction. */
  surfaceSkins() {
    if (this._skins) return this._skins;
    const skins = [];
    const { prof, step } = this.surfaceProfile(8);
    const DEPTH = 48, MAX_SLOPE = 2.0, MAX_STEP = 14, MAX_DEV = 6;
    let run = null;
    const emit = r => {
      if (!r || r.x1 - r.x0 < step) return;
      /* joints come off an 8px sample grid — snap each end to the true mask
         surface so the diagonal rides the art instead of hovering/clipping */
      const y0 = this.snapSurface(r.x0, r.y0), y1 = this.snapSurface(r.x1, r.y1);
      if (y0 === null || y1 === null) return;
      if (Math.abs(y1 - y0) / Math.max(1, r.x1 - r.x0) > 2.5) return;
      skins.push({ x0: r.x0, y0, x1: r.x1, y1, depth: DEPTH });
    };
    const ok = (r, x, y) => {
      if (!r || y < 0) return false;
      const dx = x - r.x1, dy = y - r.y1;
      if (dx <= 0) return false;
      const slope = Math.abs(dy) / dx;
      if (slope > MAX_SLOPE || Math.abs(dy) > MAX_STEP) return false;
      /* full-chord fit: the CANDIDATE chord (run start -> new sample) must
         stay within MAX_DEV of EVERY sample the run already swallowed —
         testing only the newest sample lets a curved shoulder creep the
         rotating chord dozens of px into the hill (buried collider) */
      const cdx = x - r.x0, cdy = y - r.y0;
      const clen = Math.max(1, Math.hypot(cdx, cdy));
      const dev = Math.abs(cdx * (y - r.y0) - cdy * (x - r.x0)) / clen;
      if (dev > MAX_DEV) return false;
      if (r.pts) for (const p of r.pts) {
        if (Math.abs(cdx * (p.y - r.y0) - cdy * (p.x - r.x0)) / clen > MAX_DEV) return false;
      }
      return true;
    };
    const push = (r, x, y) => {
      r.x1 = x; r.y1 = y;
      (r.pts || (r.pts = [])).push({ x, y });
    };
    const anchor = (x0, y0) => ({ x0, y0, x1: x0, y1: y0, pts: [{ x: x0, y: y0 }] });
    for (let cx = 0; cx <= prof.length; cx++) {
      const y = cx < prof.length ? prof[cx] : -1;
      /* joints sit on the profiled sample CENTERS (in phase with the mask
         columns the profile read and the 8px bulk grid the tuck tests), so
         the chord passes through exact surface points — no snap swing */
      const x = Math.min(cx * step + step / 2, this.w - 1);
      if (ok(run, x, y)) { push(run, x, y); continue; }
      /* notch bridge: if a sample <=3 ahead re-passes from the run start with
         every skipped sample dipping BELOW the chord (a notch, air gap, or
         stair riser — never a tooth), jump it. Feet span sub-foot dips that
         would otherwise read as walls; teeth tops stay run joints, and wider
         pits still break the run. Bridged samples behind the new run end can
         never re-attach (ok() needs x ahead of the end), so the run only
         ever walks forward. */
      let bridged = false;
      if (run) {
        for (let k = 2; k <= 4 && !bridged; k++) {
          const ci = cx + k - 1;
          if (ci > prof.length) break;
          const jx = Math.min(ci * step + step / 2, this.w - 1);
          const jy = ci < prof.length ? prof[ci] : -1;
          if (jy < 0 || !ok(run, jx, jy)) continue;
          const cdx = jx - run.x0, cdy = jy - run.y0;
          const clen = Math.max(1, Math.hypot(cdx, cdy));
          let dip = true;
          for (let s = 0; s < k - 1; s++) {
            const sx = Math.min((cx + s) * step + step / 2, this.w - 1);
            const sy = cx + s < prof.length ? prof[cx + s] : -1;
            if (sy < 0) continue;
            if ((cdx * (sy - run.y0) - cdy * (sx - run.x0)) / clen < -2) { dip = false; break; }
          }
          if (!dip) continue;
          run.x1 = jx; run.y1 = jy; run.pts.push({ x: jx, y: jy }); bridged = true;
          cx = ci;   /* landing consumed: resume past it (else the re-walked
                        skipped span emits a second, overlapping run) */
        }
      }
      if (bridged) continue;
      emit(run);
      /* re-anchor at the joint: a chord-deviation break keeps walking (fresh
         chord from the joint), while a slope/step/gap break re-fails and the
         joint stays rect-owned wall/step — exactly the split we want */
      run = run ? anchor(run.x1, run.y1) : null;
      if (ok(run, x, y)) push(run, x, y);
      else { emit(run); run = y >= 0 ? anchor(x, y) : null; }
    }
    emit(run);
    TRIP("skins", skins.length, 20000);
    this._skins = skins;
    return skins;
  }

  /* Physics shapes: slope-following skins own every walkable surface; greedy
     bulk rectangles tuck UNDER the skin line and keep walls, ceilings and
     mass. The surface collider is the diagonal itself — never a stair.
     Static-static overlap is free. */
  solidShapes() {
    if (this._shapes) return this._shapes;
    const rects = this.solidRects();
    const skins = this.surfaceSkins();
    this._shapes = { rects, skins };
    return this._shapes;
  }

  /* first solid ground directly below a world point (drop shadows) */
  groundBelow(x, y, maxDist = 420) {
    for (let d = 0; d <= maxDist; d += 6) {
      if (this.solidAtPixel(x, y + d)) return { x, y: y + d };
    }
    return null;
  }
}
