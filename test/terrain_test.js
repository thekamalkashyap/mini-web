/* Terrain + avatar regression: traced segment colliders, despiked grass,
   grounded spawns and pickups, trim-correct avatar anchors, tight collider.
   Headless WorldSim on the real maps (server mask pipeline == browser). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMapBundle } from "../server/assets.js";
import { GameMap } from "../shared/map.js";
import { WorldSim } from "../shared/sim.js";
import { SEGMENT_BUDGET, SIMPLIFY_TOL } from "../shared/collision/shapes.js";
import { FLOOR_SMOOTH_NARROW, FLOOR_SMOOTH_TOOTH, FLOOR_SMOOTH_NOTCH_DEEP } from "../shared/collision/simplify.js";
import { MAPS, partOrigin, SOLDIER_W, SOLDIER_H, LEG_LIFT } from "../shared/constants.js";
/* §2 envelopes derive from the floor-smoother contract: teeth cut to TOOTH
   outward, narrow cracks bridged to NOTCH_DEEP inward — PLUS the D-P
   tolerance (the smoother gauges post-D-P vertices, and the true mask can
   sit a further SIMPLIFY_TOL beyond them when both cuts align: observed
   38-39px on capped tooth cuts) plus 4px grid/slack. A WIDE departure
   still fails (lidded pit, buried hill). */
const TRACK_OUT = FLOOR_SMOOTH_TOOTH + SIMPLIFY_TOL + 4;
const TRACK_IN = FLOOR_SMOOTH_NOTCH_DEEP + SIMPLIFY_TOL + 4;
const COV_NARROW = FLOOR_SMOOTH_NARROW + 2;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let errors = 0;
const fail = m => { console.error("FAIL:", m); errors++; };
const pass = m => console.log("PASS:", m);

/* kingofthehill is a menu-screen backdrop baked as tiles (UI strokes as
   "terrain") — not a level. Its collider build is covered by the dedicated
   budget test (§7); spawn/settle/pickup physics assertions skip it. */
const SKIP_PHYS = new Set(["kingofthehill"]);

const overlapArea = (map, p) => {
  let n = 0;
  for (let y = Math.max(0, Math.floor(p.y)); y < Math.min(map.h, p.y + p.h); y += 4)
    for (let x = Math.max(0, Math.floor(p.x)); x < Math.min(map.w, p.x + p.w); x += 4)
      if (map.solidAtPixel(x, y)) n++;
  return n * 16;
};

/* ---- 1. despike: synthetic tufts removed, bulk + wide hills spared ---- */
{
  const cols = 120, rows = 60;
  const M = (fill) => {
    const m = new Uint8Array(cols * rows);
    if (fill) for (const [c0, c1, r0, r1] of fill)
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) m[r * cols + c] = 1;
    return m;
  };
  const topAt = (m, c) => { for (let r = 0; r < rows; r++) if (m[r * cols + c]) return r; return -1; };
  /* flat ground rows 40-59, narrow tuft (3w x 12h), wide tuft (6w x 10h),
     narrow bump (10w x 10h, isolated — shaved), wide hill (30w x 10h) */
  const m = M([[0, 119, 40, 59], [20, 22, 28, 39], [50, 55, 30, 39], [70, 79, 30, 39], [90, 119, 30, 39]]);
  GameMap.despikeMask(m, cols, rows);
  if (topAt(m, 21) !== 40) fail("narrow tuft not shaved");
  else if (topAt(m, 52) !== 40) fail("wide tuft not shaved");
  else if (topAt(m, 75) !== 40) fail("narrow bump not shaved");
  else if (topAt(m, 100) !== 30) fail("wide hill not spared");
  else if (topAt(m, 10) !== 40) fail("flat ground damaged");
  else pass("despike: tufts shaved, ground + wide hills intact");
}
/* ---- 1a. green filter: wide grass blocks excluded, same-size rock kept ----
   (wide enough that despike spares both — isolates the color rule itself) */
{
  const json = {
    w: 2, h: 1, tileW: 64, tileH: 64, tilesets: [{ firstgid: 1 }],
    layers: [{ name: "tile", data: [1, 1] }], objects: [],
  };
  const tile = (top) => {
    const t = new Uint8ClampedArray(64 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const o = (y * 64 + x) * 4;
      t[o + 3] = 255;
      /* mossy crack streak inside the bulk, broken by rock bands the way real
         crack outlines/shading break it (a pixel-perfect full-height green
         column is a grass blade wall — correctly cleared) */
      if (y >= 16 && x >= 30 && x <= 33 && !(y >= 32 && y <= 33) && !(y >= 48 && y <= 49)) { t[o] = 99; t[o + 1] = 144; t[o + 2] = 99; }
      else if (y < 16 && x >= 2 && x <= 61) { const c = top; t[o] = c[0]; t[o + 1] = c[1]; t[o + 2] = c[2]; }
      else if (y < 16) t[o + 3] = 0;
      else { t[o] = 150; t[o + 1] = 120; t[o + 2] = 90; }
    }
    return t;
  };
  const md = GameMap.buildMaskData(json, () => tile([99, 144, 99]));
  const map = new GameMap(json, md);
  if (map.solidAtPixel(32, 8)) fail("green block not excluded from mask");
  else if (!map.solidAtPixel(20, 40)) fail("brown bulk lost from mask");
  else if (!map.solidAtPixel(31, 48)) fail("mossy crack streak punched through (slot)");
  else pass("green tuft excluded, bulk + crack streak kept");
  const md2 = GameMap.buildMaskData(json, () => tile([150, 120, 90]));
  const map2 = new GameMap(json, md2);
  if (!map2.solidAtPixel(32, 8)) fail("same-size brown block wrongly removed");
  else pass("brown protrusion spared");
}
/* ---- 1c. outlined blades cleared (tip + body), outlined rock teeth spared ----
   Grass blades wear dark outlines: the rock finder must see through black
   strokes AND green bodies to the brown below, while an identical-geometry
   brown tooth (brown body under its outline) stays rock. */
{
  /* 48px wide on purpose: despike spares wide runs, so only the
     blade-aware rock finder can clear the blade (isolates the finder) */
  const json = {
    w: 2, h: 1, tileW: 64, tileH: 64, tilesets: [{ firstgid: 1 }],
    layers: [{ name: "tile", data: [1, 2] }], objects: [],
  };
  const DARK = [8, 8, 8], GREEN = [99, 144, 99], BROWN = [150, 120, 90];
  const tile = body => () => {
    const t = new Uint8ClampedArray(64 * 64 * 4);
    const px = (x, y, c, a = 255) => { const o = (y * 64 + x) * 4; t[o] = c[0]; t[o + 1] = c[1]; t[o + 2] = c[2]; t[o + 3] = a; };
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      if (y >= 32) px(x, y, BROWN);
      else if (x >= 8 && x <= 55 && y >= 8 && y <= 31) {
        px(x, y, (x <= 9 || x >= 54 || y <= 9) ? DARK : body);
      } else px(x, y, BROWN, 0);
    }
    return t;
  };
  const tiles = { 1: tile(GREEN)(), 2: tile(BROWN)() };
  const map = new GameMap(json, GameMap.buildMaskData(json, gid => tiles[gid]));
  if (map.solidAtPixel(31, 20)) fail("outlined blade body not cleared");
  else if (map.solidAtPixel(31, 8)) fail("dark blade tip not cleared");
  else if (!map.solidAtPixel(95, 20)) fail("outlined rock tooth body wrongly cleared");
  else if (!map.solidAtPixel(95, 12)) fail("rock tooth body below its cap wrongly cleared");
  else if (!map.solidAtPixel(5, 50)) fail("bulk lost under blade test");
  else pass("outlined blades cleared, outlined teeth + bulk kept");
}
/* ---- 1b. real map: no large tuft residue (stair nubs <= 24px tolerated) ----
   Color-aware: small brown/gray BOULDERS on flat grass legitimately jut
   (feet step over them); only green/black residue tops (grass, outline
   shells) count as tuft. The check reads the exact art pixel that set the
   mask cell — a surviving green/black topmost solid is always a clearing
   bug, since decor above rock must clear. */
{
  const b = loadMapBundle("1outpost");
  const { maskData } = b;
  const cols = maskData.cols, rows = (maskData.mask.length / cols) | 0;
  const top = new Int32Array(cols).fill(-1);
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      if (maskData.mask[r * cols + c]) { top[c] = r; break; }
  const med = new Int32Array(cols);
  for (let c = 0; c < cols; c++) {
    const v = [];
    for (let k = -12; k <= 12; k++) { const cc = c + k; if (cc >= 0 && cc < cols && top[cc] >= 0) v.push(top[cc]); }
    v.sort((a, x) => a - x);
    med[c] = v.length ? v[v.length >> 1] : top[c];
  }
  const { PNG } = await import("pngjs");
  const J = b.mapJson, ts = J.tilesets[0];
  const tspng = PNG.sync.read(fs.readFileSync(path.join(ROOT, "img", ts.image)));
  const tcols = Math.floor((tspng.width - ts.margin * 2 + ts.spacing) / (ts.tileW + ts.spacing));
  const artAt = (x, y) => {
    const tx = Math.floor(x / J.tileW), ty = Math.floor(y / J.tileH);
    const solid = J.layers.find(l => l.name === "tile");
    const gid = solid.data[ty * J.w + tx] & 0x1fffffff;
    if (!gid) return null;
    const idx = gid - ts.firstgid;
    const sx = ts.margin + (idx % tcols) * (ts.tileW + ts.spacing) + (x - tx * J.tileW);
    const sy = ts.margin + Math.floor(idx / tcols) * (ts.tileH + ts.spacing) + (y - ty * J.tileH);
    const o = (sy * tspng.width + sx) * 4;
    return [tspng.data[o], tspng.data[o + 1], tspng.data[o + 2], tspng.data[o + 3]];
  };
  const isDecor = (x, y) => {
    const p = artAt(x, y);
    if (!p || p[3] <= 36) return false;
    return (p[1] > 60 && p[1] > p[0] + 25 && p[1] > p[2] + 15) || (p[0] < 40 && p[1] < 40 && p[2] < 40);
  };
  let worst = 0, s = -1;
  for (let c = 0; c <= cols; c++) {
    const prot = c < cols && top[c] >= 0 && med[c] >= 0 && (med[c] - top[c]) > 12;
    if (prot && s < 0) s = c;
    if (!prot && s >= 0) {
      let h = 0;
      for (let k = s; k < c; k++) h = Math.max(h, med[k] - top[k]);
      if (c - s < 24 && h > worst) {
        const mc = (s + c) >> 1, mx = mc * 2;
        let ty = -1;
        for (let r = 0; r < rows; r++) if (maskData.mask[r * cols + mc]) { ty = r * 2; break; }
        if (ty >= 0 && isDecor(mx, ty)) worst = h;
      }
      s = -1;
    }
  }
  if (worst > 12) fail(`large tuft remains: ${worst} cells tall`);
  else pass("despike: no large tufts on 1outpost");
}

/* ---- 2. segments: closed loops on the art surface, full coverage ---- */
for (const [id] of MAPS) {
  if (SKIP_PHYS.has(id)) continue;
  const b = loadMapBundle(id);
  const map = new GameMap(b.mapJson, b.maskData);
  const { segments } = map.solidShapes();
  const mask = map.mask, cols = map.maskCols, rows = (mask.length / cols) | 0, st = map.maskStep;
  let bad = 0;

  /* (a) non-empty and within the body budget */
  if (!segments.length) { fail(`${id}: no collider segments`); continue; }
  if (segments.length > SEGMENT_BUDGET) { fail(`${id}: body budget blown (${segments.length})`); bad++; }

  /* (b) closure: every segment start exactly matches another segment's end
     (shared loop vertices — no cracks for soldiers to fall through) */
  const ends = new Set(segments.map(s => s.bx + "," + s.by));
  let open = 0;
  for (const s of segments) if (!ends.has(s.ax + "," + s.ay)) open++;
  if (open) { fail(`${id}: ${open} unclosed segment joints`); bad++; }

  /* (c) endpoint fidelity (EXACT): every endpoint is a true mask-boundary
     vertex — on-grid with mixed solid/air incident cells */
  const isBoundaryVertex = (x, y) => {
    const gx = Math.round(x / st), gy = Math.round(y / st);
    if (Math.abs(gx * st - x) > 0.01 || Math.abs(gy * st - y) > 0.01) return false;
    let s = 0, a = 0;
    for (const [cx, cy] of [[gx - 1, gy - 1], [gx, gy - 1], [gx - 1, gy], [gx, gy]]) {
      const solid = cx >= 0 && cy >= 0 && cx < cols && cy < rows && mask[cy * cols + cx] === 1;
      solid ? s++ : a++;
    }
    return s > 0 && a > 0;
  };
  let endBad = 0;
  for (const s of segments) {
    if (!isBoundaryVertex(s.ax, s.ay) || !isBoundaryVertex(s.bx, s.by)) endBad++;
  }
  if (endBad) { fail(`${id}: ${endBad}/${segments.length} segments off-surface endpoints`); bad++; }

  /* (d) midpoint tracking: the art surface stays within the smoother
     contract of every chord — asymmetric: teeth cut outward to TOOTH,
     narrow cracks bridged inward to NOTCH_DEEP (a WIDE departure means a
     pit got lidded or a hill buried). Marches at 1px (finer than the 2px
     cells) and compares CONSECUTIVE samples: a 2px probe at 2px stride
     can phase-miss a crossing that falls exactly between two samples. */
  let trackBad = 0;
  for (const s of segments) {
    const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
    let prev = null, near = false;
    for (let d = -TRACK_OUT; d <= TRACK_IN && !near; d += 1) {
      const c = map.solidAtPixel(mx + s.nx * d, my + s.ny * d);
      if (prev !== null && c !== prev) near = true;
      prev = c;
    }
    if (!near) trackBad++;
  }
  if (trackBad) { fail(`${id}: ${trackBad}/${segments.length} chords off-surface`); bad++; }

  /* (e) quad sanity: convex non-degenerate extrusion, inward normal into solid */
  let quadBad = 0, normBad = 0;
  for (const s of segments) {
    const q = [[s.ax, s.ay], [s.bx, s.by],
      [s.bx + s.nx * s.depth, s.by + s.ny * s.depth],
      [s.ax + s.nx * s.depth, s.ay + s.ny * s.depth]];
    let sign = 0, area = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
      const cr = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (cr !== 0) { sign = sign || Math.sign(cr); if (Math.sign(cr) !== sign) { quadBad++; break; } }
      area += (q[(i + 1) % 4][0] - ax) * (q[(i + 1) % 4][1] + ay);
    }
    if (Math.abs(area) / 2 < 1) quadBad++;
    /* rock must sit within the notch-bridging contract inward (bridged
       crack bottoms read solid only 10s of px past the face — a coarse
       stride steps over thin floors, hence 0.5px). Past TRACK_IN the
       normal points at void: a flipped or runaway chord. */
    const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
    let inward = false;
    for (let d = 0.5; d <= TRACK_IN && !inward; d += 0.5) {
      if (map.solidAtPixel(mx + s.nx * d, my + s.ny * d)) inward = true;
    }
    if (!inward) normBad++;
  }
  if (quadBad) { fail(`${id}: ${quadBad} degenerate/non-convex quads`); bad++; }
  if (normBad) { fail(`${id}: ${normBad} inward normals miss the solid`); bad++; }

  /* (f) coverage: every mask boundary cell has a segment nearby, within
     that segment's contract allowance (spatial hash over segment bounds;
     span-aware: deep notch bottoms are only legal under narrow bridges,
     tooth tips under any cutter; a missing wall/loop reads 100s of px off).
     ±3 hash rings cover the 68px reach (3*32). */
  const HS = 32;
  const hash = new Map();
  const segLen = segments.map(s => Math.hypot(s.bx - s.ax, s.by - s.ay));
  segments.forEach((s, i) => {
    const x0 = Math.min(s.ax, s.bx), x1 = Math.max(s.ax, s.bx);
    const y0 = Math.min(s.ay, s.by), y1 = Math.max(s.ay, s.by);
    for (let gx = (x0 / HS) | 0; gx <= (x1 / HS) | 0; gx++)
      for (let gy = (y0 / HS) | 0; gy <= (y1 / HS) | 0; gy++) {
        const k = gx + "," + gy;
        let l = hash.get(k);
        if (!l) { l = []; hash.set(k, l); }
        l.push(i);
      }
  });
  const segDist = (x, y, s) => {
    const dx = s.bx - s.ax, dy = s.by - s.ay;
    const t = Math.min(1, Math.max(0, ((x - s.ax) * dx + (y - s.ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - (s.ax + dx * t), y - (s.ay + dy * t));
  };
  let bound = 0, cov = 0;
  for (let r = 1; r < rows - 1; r += 4) {
    for (let c = 1; c < cols - 1; c += 4) {
      if (mask[r * cols + c] !== 1) continue;
      if (mask[(r - 1) * cols + c] === 1 && mask[(r + 1) * cols + c] === 1 &&
          mask[r * cols + c - 1] === 1 && mask[r * cols + c + 1] === 1) continue;
      bound++;
      const x = c * st + st / 2, y = r * st + st / 2;
      let ok = false;
      const gx = (x / HS) | 0, gy = (y / HS) | 0;
      for (let ix = gx - 3; ix <= gx + 3 && !ok; ix++)
        for (let iy = gy - 3; iy <= gy + 3 && !ok; iy++) {
          const l = hash.get(ix + "," + iy);
          if (!l) continue;
          for (const i of l) {
            const allow = segLen[i] <= COV_NARROW ? TRACK_IN : TRACK_OUT;
            if (segDist(x, y, segments[i]) <= allow) { ok = true; break; }
          }
        }
      if (ok) cov++;
    }
  }
  const ratio = bound ? cov / bound : 1;
  if (ratio < 0.99) { fail(`${id}: boundary coverage ${cov}/${bound} (${ratio.toFixed(3)})`); bad++; }

  /* (g) smoothness: the walk surface must not wiggle more than the art —
     stairs would multiply total variation; chords track or undercut it */
  const stepX = 8;
  const mhs = [], gys = [];
  for (let x = stepX; x < map.w - stepX; x += stepX) {
    const g = map.groundBelow(x, 0, map.h);
    if (!g) { mhs.push(-1); gys.push(-1); continue; }
    gys.push(g.y);
    let h = Infinity;
    for (const s of segments) {
      if (s.ny < 0.3) continue;
      const x0 = Math.min(s.ax, s.bx), x1 = Math.max(s.ax, s.bx);
      if (x < x0 || x > x1 || x1 - x0 < 1) continue;
      const t = (x - s.ax) / (s.bx - s.ax || 1e-9);
      if (t < 0 || t > 1) continue;
      const y = s.ay + (s.by - s.ay) * t;
      if (Math.abs(y - g.y) < TRACK_OUT && y < h) h = y;
    }
    mhs.push(h === Infinity ? -1 : h);
  }
  const tv = arr => {
    let t = 0;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] < 0 || arr[i - 1] < 0) continue;
      t += Math.abs(arr[i] - arr[i - 1]);
    }
    return t;
  };
  const tvArt = tv(gys), tvMat = tv(mhs);
  if (tvMat > tvArt * 1.25 + 50) { fail(`${id}: matter TV ${tvMat.toFixed(0)} vs art TV ${tvArt.toFixed(0)}`); bad++; }

  if (!bad) pass(`${id}: ${segments.length} closed on-surface segments (${cov}/${bound} boundary), TV ${tvMat.toFixed(0)}/${tvArt.toFixed(0)}`);
}

/* ---- 3. respawn: clear, grounded, settled standing ---- */
for (const [id] of MAPS) {
  if (SKIP_PHYS.has(id)) continue;
  const b = loadMapBundle(id);
  const sim = new WorldSim({ mapJson: b.mapJson, maskData: b.maskData, frameSize: b.frameSize, mode: "solo" });
  let bad = 0;
  for (let i = 0; i < 5; i++) {
    const p = sim.addPlayer({ id: `r${i}`, name: "R" });
    if (overlapArea(sim.map, p) > p.w * p.h * 0.05) { bad++; console.error(`  buried at spawn ${id}`, Math.round(p.x), Math.round(p.y)); }
    /* idle sliders on frictionless slopes must come to rest standing (or die
       trying) — settle until rest, not for a fixed step count */
    p.input = {};
    let rest = 0;
    for (let s = 0; s < 600 && rest < 10; s++) {
      sim.step(1 / 60);
      if (!p.dead && p.grounded && Math.abs(p.vx) < 8 && p.vy === 0) rest++;
      else rest = 0;
    }
    const ov = overlapArea(sim.map, p);
    if (!Number.isFinite(p.x + p.y)) { bad++; console.error(`  non-finite ${id}`); }
    else if (p.dead) { bad++; console.error(`  dead after idle settle ${id}`, Math.round(p.x), Math.round(p.y)); }
    else if (!p.grounded) { bad++; console.error(`  airborne after settle ${id}`, Math.round(p.x), Math.round(p.y)); }
    else if (ov > p.w * p.h * 0.25) { bad++; console.error(`  buried after settle ${id}`, Math.round(p.x), Math.round(p.y)); }
    else if (ov > p.w * p.h * 0.05) {
      /* steep-slope rests straddle the art diagonal — legal as long as the
         soldier can walk out of it; only a true trap fails */
      const x0 = p.x;
      p.input = { left: false, right: true, jet: false, fire: false, aimX: p.cx() + 300, aimY: p.cy() };
      for (let s = 0; s < 30; s++) sim.step(1 / 60);
      p.input = { left: true, right: false, jet: false, fire: false, aimX: p.cx() - 300, aimY: p.cy() };
      for (let s = 0; s < 30; s++) sim.step(1 / 60);
      if (p.dead || Math.abs(p.x - x0) < 25) { bad++; console.error(`  trapped after settle ${id}`, Math.round(p.x), Math.round(p.y)); }
    }
    sim.removePlayer(p.id);
  }
  if (bad) fail(`${id}: ${bad} spawn/settle problems`);
  else pass(`${id}: spawns settle standing`);
}

/* ---- 4. pickups: settled on ground where ground exists, non-overlapping ---- */
for (const [id] of MAPS) {
  if (SKIP_PHYS.has(id)) continue;
  const b = loadMapBundle(id);
  const sim = new WorldSim({ mapJson: b.mapJson, maskData: b.maskData, frameSize: b.frameSize, mode: "solo" });
  let bad = 0, overVoid = 0;
  /* fine (2px) ground scan: the game's 6px-stride groundBelow can phase-miss
     a thin ledge a pad legitimately rests on — verify against the true floor */
  const fineGround = (x, y) => {
    for (let d = 0; d <= 600; d += 2) if (sim.map.solidAtPixel(x, y + d)) return y + d;
    return null;
  };
  const grounded = [];
  for (const k of sim.pickups) {
    if (sim.map.solidAtPixel(k.x, k.y)) { bad++; console.error(`  embedded pickup ${id}`, Math.round(k.x), Math.round(k.y)); continue; }
    const g = sim.map.groundBelow(k.x, k.y, 600);
    if (!g) { overVoid++; continue; }   /* authored over the void: floats as designed */
    const gy = fineGround(k.x, k.y);
    if (gy === null || gy - k.y > 24) { bad++; console.error(`  floating pickup ${id}`, Math.round(k.x), Math.round(k.y), "dist", gy === null ? "void" : Math.round(gy - k.y)); }
    else grounded.push(k);
  }
  /* spacing holds for grounded AND floating pads alike (dense authored rows
     spread sideways in air, exact stacks fuse into one cycling pad) */
  for (let i = 0; i < sim.pickups.length; i++)
    for (let j = i + 1; j < sim.pickups.length; j++) {
      const a = sim.pickups[i], c = sim.pickups[j];
      if (Math.abs(a.x - c.x) < 128 && Math.abs(a.y - c.y) < 64) {
        bad++;
        console.error(`  overlapping pads ${id}`, Math.round(a.x), Math.round(a.y), "vs", Math.round(c.x), Math.round(c.y));
      }
    }
  if (bad) fail(`${id}: ${bad} pickup problems (${overVoid} over void)`);
  else pass(`${id}: ${sim.pickups.length} pickups grounded + separated (${overVoid} over void)`);
}

/* ---- 5. avatar anchors + collider ---- */
{
  /* partOrigin reproduces legacy full-box anchors in trimmed space, trim
     offsets included (body1: 100x102 quad at cocos offset (-1,5) of 102x112) */
  const [ox, oy] = partOrigin(100, 102, 102, 112, 0.5, 1, -1, 5);
  if (Math.abs(ox - 0.52) > 1e-9 || Math.abs(oy - 107 / 102) > 1e-9) fail("partOrigin body1 math");
  else pass("partOrigin converts legacy anchors incl. trim offsets");
  const [ux, uy] = partOrigin(70, 84, 70, 84, 0.5, 0.08);
  if (ux !== 0.5 || Math.abs(uy - 0.08) > 1e-9) fail("partOrigin no-op for untrimmed");
  else pass("partOrigin no-op when src == trim");
  /* the origin math assumes unrotated quads (legacy drawA's rot branch has
     no Phaser-side equivalent) — fail loudly if packed art ever rotates */
  const menuRot = JSON.parse(fs.readFileSync(path.join(ROOT, "data/atlas/menuTexture.json"), "utf8"));
  const rotated = Object.entries(menuRot.frames).filter(([, f]) => f.rot).map(([n]) => n);
  if (rotated.length) fail(`rotated atlas frames need origin handling: ${rotated.slice(0, 5).join(",")}`);
  else pass("atlas has no rotated frames");
  /* jetpack flames + flamethrower share the menu-atlas flame frame — the
     Phaser particle emitter + bullet sprites fail silently without it */
  if (!menuRot.frames["flame1.png"]) fail("menu atlas lost flame1.png (jet/flamer art)");
  else pass("menu atlas keeps flame1.png for jet + flamer art");

  /* collider h must cover the tallest skin stack (legacy full-box anchors) */
  const menu = JSON.parse(fs.readFileSync(path.join(ROOT, "data/atlas/menuTexture.json"), "utf8"));
  const F = n => menu.frames[n];
  const SPR = 0.34;
  let top = 0;
  for (let l = 1; l <= 17; l++) for (let bo = 1; bo <= 18; bo++) for (let h = 1; h <= 17; h++) {
    const leg = F(`leg${l}.png`), body = F(`body${bo}.png`), head = F(`head${h}.png`);
    if (!leg || !body || !head) continue;
    const neck = (leg.h * SPR - 5) + (body.h * SPR - 7);
    const headTop = neck - 9 + 0.92 * head.srcH * SPR;
    if (headTop > top) top = headTop;
  }
  /* collider dims asserted via a live soldier on a fresh sim */
  const b = loadMapBundle("1outpost");
  const sim = new WorldSim({ mapJson: b.mapJson, maskData: b.maskData, frameSize: b.frameSize, mode: "solo" });
  const p = sim.addPlayer({ id: "dim", name: "D" });
  if (p.h < top + 2) fail(`collider h=${p.h} below visual top ${top.toFixed(1)}`);
  else if (p.h >= 104) fail(`collider tip padding not removed (h=${p.h})`);
  else pass(`collider h=${p.h} covers visual top ${top.toFixed(1)} (was 104)`);
  if (p.w !== 44) fail(`collider w changed (${p.w})`);
  else pass("collider w unchanged (44)");
  /* view-state contract: SoldierView anchors off s.w/s.h — they must be
     finite here and in every view-state object (a missing dim NaN-poisons
     the whole avatar container invisible). Canonical dims are single-sourced
     in SOLDIER_W/H with view-side fallbacks. */
  if (!Number.isFinite(p.w + p.h)) fail("soldier dims not finite");
  else if (p.w !== SOLDIER_W || p.h !== SOLDIER_H) fail(`dims ${p.w}x${p.h} != canonical ${SOLDIER_W}x${SOLDIER_H}`);
  else pass(`dims canonical ${SOLDIER_W}x${SOLDIER_H}, finite for views`);
  sim.removePlayer(p.id);
  /* hip joint: thigh ink must tuck under the shirt hem for EVERY body+leg
     skin combo — hems ride up to 15src px above the pivot at the leg bands,
     so an unlifted joint shows up to 4.5px of daylight at the waist */
  {
    const { PNG } = await import("pngjs");
    const apng = PNG.sync.read(fs.readFileSync(path.join(ROOT, "img/menuTexture.png")));
    const AA = (x, y) => apng.data[(y * apng.width + x) * 4 + 3];
    const F = menu.frames;
    let worst = -Infinity, worstC = "";
    for (let b = 1; b <= 18; b++) for (let l = 1; l <= 17; l++) {
      const B = F[`body${b}.png`], L = F[`leg${l}.png`];
      if (!B || !L) continue;
      for (const side of [-8, 8]) {
        const qcx = B.w / 2 + side / SPR;
        let hem = -1;
        for (let r = B.h - 1; r >= 0 && hem < 0; r--)
          for (let c = Math.max(0, Math.floor(qcx - 12)); c <= Math.min(B.w - 1, qcx + 12); c++)
            if (AA(B.x + c, B.y + r) > 36) { hem = r; break; }
        let top = L.h;
        for (let r = 0; r < L.h && top === L.h; r++)
          for (let c = Math.floor(L.w / 2 - 12); c <= L.w / 2 + 12; c++)
            if (AA(L.x + c, L.y + r) > 36) { top = r; break; }
        const hemAbove = (B.srcH || B.h) - (((B.srcH || B.h) - B.h - (B.offY || 0)) + hem);
        const legBelow = (((L.srcH || L.h) - L.h - (L.offY || 0)) + top) - 0.08 * (L.srcH || L.h);
        const gap = hem < 0 ? 99 : (hemAbove + legBelow) * SPR - LEG_LIFT;
        if (gap > worst) { worst = gap; worstC = `body${b}+leg${l}@${side}`; }
      }
    }
    if (worst > -1) fail(`hip joint daylight: worst overlap ${(-worst).toFixed(2)}px (${worstC})`);
    else pass(`hip joint tucked: worst overlap ${(-worst).toFixed(2)}px over all skin combos`);
  }
}

/* ---- 6. smoothness: synthetic slope climb (no bumps/stalls) ----
   A hand-built mask (straight 30° slope between flats) pins the physical
   contract: steady ascent, zero lip-catches. The soldier climbs uphill on
   purpose: stairs nose-ride smooth downhill but pop riser-by-riser uphill,
   so the climb discriminates. Bumps count only where the ART is smooth (a real art
   ledge legitimately pops the soldier). A solid cover slab hangs over the
   whole run, so the climb floor is NOT the topmost surface in its columns —
   the old topmost-only skins left exactly such floors as 8px stairs, and
   this test fails on that design (verified via worktree A/B). */
{
  const TW = 128, W = 16, H = 6; // 2048 x 768 px
  const json = {
    w: W, h: H, tileW: TW, tileH: TW,
    tilesets: [{ firstgid: 1, image: "synth.png" }],
    layers: [{ name: "tile", w: W, h: H, data: new Array(W * H).fill(0) }],
    objects: [],
  };
  const step = 2, cols = (W * TW) / step, rows = (H * TW) / step;
  const floorY = x => (x < 800 ? 256 : x < 1400 ? 256 + (x - 800) * Math.tan(Math.PI / 6) : 256 + 600 * Math.tan(Math.PI / 6));
  const mask = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const wy = (r + 1) * step;
      if (wy >= floorY(c * step)) mask[r * cols + c] = 1; // slide floor
      if (wy >= 40 && wy < 90) mask[r * cols + c] = 1; // cover slab overhead
    }
  const sim = new WorldSim({
    mapJson: json, maskData: { mask, step, cols },
    frameSize: () => ({ w: 60, h: 40 }), mode: "solo",
  });
  const p = sim.addPlayer({ id: "slide", name: "S" });
  p.x = 1900; p.y = (256 + 600 * Math.tan(Math.PI / 6)) - p.h; p.vx = 0; p.vy = 0; p.ensureBody(true);
  p.input = { left: true, right: false, jet: false, fire: false, aimX: p.cx() - 300, aimY: p.cy() };
  const flatYs = [];
  const slopePts = [];
  let bumps = 0, stalls = 0, stallRun = 0, prevY = null, prevArt = null;
  for (let s = 0; s < 900 && p.x > 100 && !p.dead; s++) {
    sim.step(1 / 60);
    if (!p.grounded) { prevY = null; prevArt = null; continue; }
    const g = sim.map.groundBelow(p.cx(), 100, 560); // below the cover slab: the slide floor
    const art = g ? g.y : null;
    if (prevY !== null && art !== null && prevArt !== null) {
      /* a bump is matter motion WITHOUT art motion (real ledges excluded) */
      if (Math.abs(p.y - prevY) > 4 && Math.abs(art - prevArt) <= 2) bumps++;
    }
    if (Math.abs(p.vx) < 30) { stallRun++; if (stallRun === 10) stalls++; }
    else stallRun = 0;
    if (p.x > 150 && p.x < 750) flatYs.push(p.y);
    if (p.x > 900 && p.x < 1300) slopePts.push([p.x, p.y]);
    prevY = p.y; prevArt = art;
  }
  const mean = flatYs.reduce((a, v) => a + v, 0) / Math.max(1, flatYs.length);
  const sd = Math.sqrt(flatYs.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, flatYs.length));
  /* slope residual vs best-fit line (a straight chord descends straight) */
  const n = slopePts.length;
  const sx = slopePts.reduce((a, q) => a + q[0], 0), sy = slopePts.reduce((a, q) => a + q[1], 0);
  const sxx = slopePts.reduce((a, q) => a + q[0] * q[0], 0), sxy = slopePts.reduce((a, q) => a + q[0] * q[1], 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const icept = (sy - slope * sx) / Math.max(1, n);
  const resid = Math.sqrt(slopePts.reduce((a, q) => a + (q[1] - (slope * q[0] + icept)) ** 2, 0) / Math.max(1, n));
  if (p.dead) fail("synthetic climb died");
  else if (p.x > 150) fail(`synthetic climb stalled at x=${p.x.toFixed(0)}`);
  else if (bumps) fail(`synthetic climb: ${bumps} bumps on smooth art`);
  else if (stalls) fail(`synthetic climb: ${stalls} lip stalls`);
  else if (sd > 0.6) fail(`synthetic flat jitter sd=${sd.toFixed(2)}px`);
  else if (resid > 1.0) fail(`synthetic slope residual sd=${resid.toFixed(2)}px`);
  else pass(`synthetic climb: flat sd=${sd.toFixed(2)}px, slope residual=${resid.toFixed(2)}px, 0 bumps/stalls`);
}

/* ---- 6b. real-map teeth: settle + walk the 1outpost grass plateau ----
   The plateau top (x 996-1056, art y=264) used to trace as a zigzag of
   grass teeth the 44px box could not sit on (jitter/bounce). The floor
   smoother bridges it to one flat chord: a dropped soldier settles dead
   still and walks the flat with zero bumps. Ground truth pins: mask-top
   profile is flat 264 across the run, needle notch at x=1068 bridged. */
{
  const b = loadMapBundle("1outpost");
  const sim = new WorldSim({ mapJson: b.mapJson, maskData: b.maskData, frameSize: b.frameSize, mode: "solo" });
  const p = sim.addPlayer({ id: "teeth", name: "T" });
  p.input = {};
  /* drop onto the plateau from above */
  p.x = 1026 - p.w / 2; p.y = 264 - 120; p.vx = 0; p.vy = 0; p.ensureBody(true);
  let rest = 0;
  for (let s = 0; s < 600 && rest < 10; s++) {
    sim.step(1 / 60);
    if (!p.dead && p.grounded && Math.abs(p.vx) < 8 && p.vy === 0) rest++;
    else rest = 0;
  }
  const ys = [];
  for (let s = 0; s < 60; s++) { sim.step(1 / 60); ys.push(p.y); }
  const mean = ys.reduce((a, v) => a + v, 0) / ys.length;
  const sd = Math.sqrt(ys.reduce((a, v) => a + (v - mean) ** 2, 0) / ys.length);
  const ov = overlapArea(sim.map, p);
  if (p.dead) fail("teeth plateau: died settling");
  else if (!p.grounded) fail(`teeth plateau: airborne after settle (${p.x.toFixed(0)},${p.y.toFixed(0)})`);
  else if (ov > p.w * p.h * 0.05) fail(`teeth plateau: buried after settle (overlap ${ov.toFixed(0)})`);
  else if (sd > 0.6) fail(`teeth plateau: sitting jitter sd=${sd.toFixed(2)}px`);
  else pass(`teeth plateau: settles still (sd=${sd.toFixed(2)}px)`);
  /* walk the flat run: matter must not move without art motion */
  p.x = 1000; p.y = 264 - p.h; p.vx = 0; p.vy = 0; p.ensureBody(true);
  p.input = { left: false, right: true, jet: false, fire: false, aimX: p.cx() + 300, aimY: p.cy() };
  let bumps = 0, prevY = null, prevArt = null;
  const walkYs = [];
  for (let s = 0; s < 300 && p.cx() < 1052 && !p.dead; s++) {
    sim.step(1 / 60);
    if (!p.grounded) { prevY = null; prevArt = null; continue; }
    const g = sim.map.groundBelow(p.cx(), 100, 560);
    const art = g ? g.y : null;
    if (prevY !== null && art !== null && prevArt !== null) {
      if (Math.abs(p.y - prevY) > 4 && Math.abs(art - prevArt) <= 2) bumps++;
    }
    if (p.cx() > 1005) walkYs.push(p.y);
    prevY = p.y; prevArt = art;
  }
  const wmean = walkYs.reduce((a, v) => a + v, 0) / Math.max(1, walkYs.length);
  const wsd = Math.sqrt(walkYs.reduce((a, v) => a + (v - wmean) ** 2, 0) / Math.max(1, walkYs.length));
  if (p.dead) fail("teeth plateau: died walking");
  else if (bumps) fail(`teeth plateau: ${bumps} bumps walking the flat`);
  else if (wsd > 1.0) fail(`teeth plateau: walk jitter sd=${wsd.toFixed(2)}px`);
  else pass(`teeth plateau: 0 bumps walking the flat (sd=${wsd.toFixed(2)}px)`);
  sim.removePlayer(p.id);
}

/* ---- 7. kingofthehill: pathological map stays within budget, no crash ----
   The old builder hard-exited the process here (exit 99); the budget keeps
   the biggest loops and drops dust first. Kept loops must still be closed. */
{
  const b = loadMapBundle("kingofthehill");
  const map = new GameMap(b.mapJson, b.maskData);
  const { segments } = map.solidShapes();
  if (segments.length > SEGMENT_BUDGET) fail(`kingofthehill over budget (${segments.length})`);
  else {
    const ends = new Set(segments.map(s => s.bx + "," + s.by));
    let open = 0;
    for (const s of segments) if (!ends.has(s.ax + "," + s.ay)) open++;
    if (open) fail(`kingofthehill: ${open} unclosed joints after budget drop`);
    else pass(`kingofthehill: ${segments.length} closed segments within budget`);
  }
}

console.log(errors ? `\nTERRAIN TEST FAILED (${errors})` : "\nTERRAIN TEST PASSED");
process.exit(errors ? 1 : 0);
