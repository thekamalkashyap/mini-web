/* Avatar seam audit v3 — exact SoldierView part placement (partOrigin trim
   conversion, SPR scale, anchor-pivot rotation), rasterized from the atlas.
   Reports the worst CENTER-column daylight between body hem and leg ink. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { SPR, partOrigin, LEG_LIFT } from "../shared/constants.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const atlas = JSON.parse(fs.readFileSync(path.join(ROOT, "data/atlas/menuTexture.json"), "utf8"));
const png = PNG.sync.read(fs.readFileSync(path.join(ROOT, "img/menuTexture.png")));
const F = name => atlas.frames[name];

/* blit with rotation around the ORIGIN (anchor) — Phaser semantics */
function blit(R, name, x, y, ax, ay, rot, layer) {
  const fr = F(name);
  const tw = fr.w, th = fr.h, sw = fr.srcW || tw, sh = fr.srcH || th;
  const [ox, oy] = partOrigin(tw, th, sw, sh, ax, ay, fr.offX || 0, fr.offY || 0);
  const axp = ox * tw * SPR, ayp = oy * th * SPR;         /* anchor offset in screen px */
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const W = Math.ceil(tw * SPR) + 10, H = Math.ceil(th * SPR) + 10;
  for (let dy = -H; dy <= H; dy++) for (let dx = -W; dx <= W; dx++) {
    /* screen point relative to anchor */
    const vx = dx - axp, vy = dy - ayp;
    if (Math.abs(vx) > W || Math.abs(vy) > H) continue;
    const px = Math.round(x + dx), py = Math.round(y + dy);
    if (px < 0 || py < 0 || px >= R.W || py >= R.H) continue;
    /* inverse rotate around anchor, then back to quad coords */
    const ux = (vx * cos + vy * sin) / SPR + ox * tw;
    const uy = (-vx * sin + vy * cos) / SPR + oy * th;
    const sx = Math.floor(ux), sy = Math.floor(uy);
    if (sx < 0 || sy < 0 || sx >= tw || sy >= th) continue;
    const o = ((fr.y + sy) * png.width + (fr.x + sx)) * 4;
    if (png.data[o + 3] > 36) R.d[py * R.W + px] = layer;
  }
}

export function measure(legN, bodyN, swing, lift, span = 3) {
  const legH = F(legN).h * SPR, bodyH = F(bodyN).h * SPR, hip = legH - 5;
  const w = 96, h = Math.ceil(legH + bodyH) + 24;
  const R = { W: w, H: h, d: new Uint8Array(w * h) };
  const ox0 = 48, base = h - 12;
  blit(R, bodyN, ox0, base - hip, 0.5, 1, 0, 1);
  blit(R, legN, ox0 - 8, base - hip - lift, 0.5, 0.08, swing, 2);
  blit(R, legN, ox0 + 8, base - hip - lift, 0.5, 0.08, -swing, 2);
  let worst = -Infinity, atX = 0, feet = 0;
  for (let dx = -span; dx <= span; dx++) {
    const X = ox0 + dx;
    let bodyBot = -1, legTop = -1;
    for (let yy = 0; yy < h; yy++) {
      const v = R.d[yy * w + X];
      if (v === 1) bodyBot = yy;
      if (v === 2 && legTop < 0) legTop = yy;
    }
    if (bodyBot < 0 || legTop < 0) continue;
    const gap = legTop - bodyBot - 1;
    if (gap > worst) { worst = gap; atX = dx; }
  }
  for (let yy = h - 1; yy >= 0; yy--) {
    let any = false;
    for (let xx = 0; xx < w; xx++) if (R.d[yy * w + xx]) { any = true; break; }
    if (any) { feet = base - yy; break; }
  }
  return { worst, atX, feet };
}

if (process.argv[1] && process.argv[1].endsWith("avatar_seam_audit.js")) {
  for (const LIFT of [6, 7, 8]) {
    const rows = [];
    for (let b = 1; b <= 18; b++) for (let l = 1; l <= 17; l++) {
      if (!F(`leg${l}.png`) || !F(`body${b}.png`)) continue;
      let worst = -Infinity, ph = 0, feet = 0;
      for (const sw of [0, 0.2, 0.35, -0.35]) {
        const m = measure(`leg${l}.png`, `body${b}.png`, sw, LIFT);
        if (m.worst > worst) { worst = m.worst; ph = sw; feet = m.feet; }
      }
      rows.push({ c: `body${b}+leg${l}`, g: worst, ph, feet });
    }
    rows.sort((a, b) => b.g - a.g);
    const open = rows.filter(r => r.g >= 1);
    console.log(`LEG_LIFT=${LIFT}: center-open=${open.length}/${rows.length} worst=${rows[0].g}px (${rows[0].c} swing ${rows[0].ph}) feet-below-box=${rows[0].feet}px`);
    if (open.length) console.log("  top:", open.slice(0, 6).map(r => `${r.c}:${r.g}@${r.ph}`).join(" "));
  }
}
