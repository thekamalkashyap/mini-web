/* Terrain + avatar regression: slope skins, despiked grass, grounded spawns
   and pickups, trim-correct avatar anchors, tight collider.
   Headless WorldSim on the real maps (server mask pipeline == browser). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMapBundle } from "../server/assets.js";
import { GameMap, skinTopAt } from "../shared/map.js";
import { WorldSim } from "../shared/sim.js";
import { MAPS, partOrigin, SOLDIER_W, SOLDIER_H, LEG_LIFT } from "../shared/constants.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let errors = 0;
const fail = m => { console.error("FAIL:", m); errors++; };
const pass = m => console.log("PASS:", m);

/* kingofthehill is a menu-screen backdrop baked as tiles (45k px, UI strokes
   as "terrain") — not a level. solidRects trips on it by design (as before);
   physics assertions skip it. */
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

/* ---- 2. skins: convex quads tracking the surface; sane body counts ---- */
for (const [id] of MAPS) {
  if (SKIP_PHYS.has(id)) continue;
  const b = loadMapBundle(id);
  const map = new GameMap(b.mapJson, b.maskData);
  const { rects, skins } = map.solidShapes();
  let convexBad = 0;
  for (const s of skins) {
    const q = [[s.x0, s.y0], [s.x1, s.y1], [s.x1, s.y1 + s.depth], [s.x0, s.y0 + s.depth]];
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
      const cr = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (cr !== 0) { sign = sign || Math.sign(cr); if (Math.sign(cr) !== sign) { convexBad++; break; } }
    }
  }
  if (convexBad) fail(`${id}: ${convexBad} non-convex skins`);
  /* skin top edge must ride the mask surface: air just above the midpoint,
     and the topmost solid in that column within a few px of the edge
     (thin floating islands read "air below" — the surface match is the
     invariant, and it also rejects lids bridged over pits) */
  const surfY = (x, yGuess) => {
    for (let d = 0; d <= 120; d += 2) {
      if (map.solidAtPixel(x, yGuess - d)) return yGuess - d;
      if (map.solidAtPixel(x, yGuess + d)) return yGuess + d;
    }
    return null;
  };
  let trackBad = 0;
  for (const s of skins) {
    const mx = (s.x0 + s.x1) / 2, my = (s.y0 + s.y1) / 2;
    /* sub-sample pebbles float over flat floors (harmless — feet ride under
       them); only a WIDE buried span means the chord cuts through a bump */
    const ab = dx => map.solidAtPixel(mx + dx, my - 10);
    if (ab(0) && ab(-8) && ab(8)) { trackBad++; continue; }
    /* sub-foot notches (bridged on purpose — feet span them) and tile seams
       read off-surface at the midpoint; only a WIDE lid (a real pit) fails */
    const off = dx => { const sy = surfY(mx + dx, my); return sy === null || Math.abs(sy - my) > 10; };
    if (off(0) && off(-8) && off(8) && off(-16) && off(16)) trackBad++;
  }
  if (trackBad) fail(`${id}: ${trackBad}/${skins.length} skins off-surface`);
  /* skins arrive x-sorted, disjoint-or-touching at shared joints (endpoint
     contact is intended; both sides snap the joint identically, so skinTopAt
     reads the exact same Y whichever side the binary search lands on) */
  let orderBad = 0;
  for (let i = 1; i < skins.length; i++) if (skins[i].x0 < skins[i - 1].x1) orderBad++;
  if (orderBad) fail(`${id}: ${orderBad} skins out of order/overlapping`);
  /* coverage: every walkable profile sample must sit under the skin line —
     bridged notches count (the chord rides above both rim samples), while
     walls/steps/gaps stay rect-owned by design */
  const { prof, step } = map.surfaceProfile(8);
  let pairs = 0, covered = 0;
  for (let i = 1; i < prof.length; i++) {
    const a = prof[i - 1], c = prof[i];
    if (a < 0 || c < 0) continue;
    const dy = Math.abs(c - a);
    if (dy / step > 2.0 || dy > 12) continue;
    pairs++;
    const xa = (i - 1) * step + step / 2, xb = Math.min(i * step + step / 2, map.w - 1);
    if (skinTopAt(skins, xa) !== null && skinTopAt(skins, xb) !== null) covered++;
  }
  const ratio = pairs ? covered / pairs : 1;
  if (ratio < 0.95) fail(`${id}: skin coverage ${covered}/${pairs} (${ratio.toFixed(2)})`);
  /* tuck: no bulk rect may poke above the skin line spanning its columns —
     sampled at cell centers, exactly where the tuck itself tests */
  let pokeBad = 0;
  for (const r of rects) {
    for (let x = r.x + 4; x < r.x + r.w; x += 8) {
      const sy = skinTopAt(skins, x);
      if (sy !== null && r.y < sy - 0.5) { pokeBad++; break; }
    }
  }
  if (pokeBad) fail(`${id}: ${pokeBad} bulk rects poke above the skin line`);
  if (!convexBad && !trackBad && !orderBad && ratio >= 0.95 && !pokeBad)
    pass(`${id}: ${skins.length} convex skins on-surface (${covered}/${pairs} pairs), ${rects.length} tucked bulk rects`);
  if (rects.length + skins.length > 15000) fail(`${id}: body budget blown (${rects.length + skins.length})`);
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

console.log(errors ? `\nTERRAIN TEST FAILED (${errors})` : "\nTERRAIN TEST PASSED");
process.exit(errors ? 1 : 0);
