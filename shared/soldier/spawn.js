/* Spawn placement — feet-on-ground assignment for new/respawning soldiers.
   Spawn points can sit inside floating geometry (Outpost cave ceilings), so
   placement seeks flat ground first, then any standable ground, then a sky
   drop; the legacy walk-up de-embed is the last resort. AGENT.md #3. */
import { clamp, rnd, pick } from "../utils/math.js";
import { SPAWN } from "../config/tuning.js";
import { WEAPONS } from "../weapons.js";

/* Feet-on-ground placement near (sx, sy): spiral out for a clear box with
   real ground below (never inside rock, never over the void). Flat spots
   win the first pass — frictionless slopes slide, so spawning mid-slope
   is no fun; steep-but-standable ground is the fallback. Candidates that
   would stack on another soldier's box are skipped — squads spawning at
   one point fan out instead of rendering as one blob. */
export function placeNearSoldier(s, sx, sy) {
  const map = s.sim.map;
  const overlapsPlayer = (x, y) => {
    for (const o of s.sim.players) {
      if (o === s || o.dead) continue;
      if (
        x < o.x + o.w + 16 &&
        x + s.w + 16 > o.x &&
        y < o.y + o.h + 8 &&
        y + s.h + 8 > o.y
      )
        return true;
    }
    return false;
  };
  const offs = [[0, 0]];
  for (const r of [24, 48, 96, 160, 260, 420, 640]) {
    offs.push([-r, 0], [r, 0], [0, -r], [-r, -r], [r, -r], [0, r * 0.5]);
  }
  for (const flatOnly of [true, false]) {
    for (const [dx, dy] of offs) {
      const cx = clamp(sx + dx, 0, map.w - 1);
      const g = map.groundBelow(cx, sy + dy - s.h, 600);
      if (!g) continue;
      if (flatOnly) {
        const gl = map.groundBelow(cx - 30, g.y - 40, 120);
        const gr = map.groundBelow(cx + 30, g.y - 40, 120);
        if (!gl || !gr || Math.abs(gl.y - gr.y) > 24) continue;
      }
      const x = clamp(cx - s.w / 2, 0, map.w - s.w);
      /* jagged neighbors can clip the box corners — rise minimally until
         clear (short drop on the first frames, never a float) */
      for (let lift = 0; lift <= 64; lift += 8) {
        const y = g.y - s.h - lift;
        if (y < 0) break;
        if (map.rectHitsWorld(x, y, s.w, s.h)) continue;
        if (overlapsPlayer(x, y))
          break; /* same column, higher lift won't help */
        s.x = x;
        s.y = y;
        return true;
      }
    }
  }
  return false;
}

/* Sky drop near sx: first column with ground visible from above (never
   inside rock, never over the void). Catches void/high spawns. */
export function placeSkyDropSoldier(s, sx) {
  const map = s.sim.map;
  const offs = [0];
  for (const r of [48, 128, 256, 512, 1024, 2048]) offs.push(-r, r);
  for (const dx of offs) {
    const cx = clamp(sx + dx, 8, map.w - 8);
    const g = map.groundBelow(cx, 0, map.h + 100);
    if (!g) continue;
    const x = clamp(cx - s.w / 2, 0, map.w - s.w);
    for (let lift = 0; lift <= 64; lift += 8) {
      const y = g.y - s.h - lift;
      if (y < 0) break;
      if (map.rectHitsWorld(x, y, s.w, s.h)) continue;
      s.x = x;
      s.y = y;
      return true;
    }
  }
  return false;
}

export function respawnSoldier(s, first) {
  const map = s.sim.map;
  const sp = map.objects.filter(
    (o) => o.name.startsWith("sp_p") || o.name.startsWith("ctf_sp"),
  );
  /* maps with no spawn objects (training) fall back to a top-center drop */
  const pool = sp.length ? sp : [{ x: map.w / 2, y: 80 }];
  /* Authored pools often have points 64px apart — a pure random pick stacks
     respawners into one blob. Pick the spawn FARTHEST from every living
     soldier (random tiebreak keeps respawn points unpredictable). */
  const pickSpawn = () => {
    const live = s.sim.players.filter(
      (p) => p !== s && !p.dead && !p.ghost,
    );
    if (!live.length) return pick(pool);
    let best = null,
      bestD = -1;
    for (const o of pool) {
      let d = Infinity;
      for (const p of live)
        d = Math.min(d, Math.hypot(p.cx() - o.x, p.cy() - o.y));
      d += Math.random() * 220; /* tiebreak: near-equal spawns stay random */
      if (d > bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  };
  let placed = false;
  for (let t = 0; t < 8 && !placed; t++) {
    const o = pickSpawn();
    placed = placeNearSoldier(s, o.x, o.y);
  }
  if (!placed) {
    const o = pickSpawn();
    placed = placeSkyDropSoldier(s, o.x);
  }
  if (!placed) {
    /* last resort: legacy walk-up de-embed from a random candidate */
    const o = pick(pool);
    s.x = clamp(o.x - s.w / 2, 0, map.w - s.w);
    s.y = o.y - s.h;
    let tries = 0;
    while (
      map.rectHitsWorld(s.x, s.y, s.w, s.h) &&
      tries++ < 64
    ) {
      s.y -= 8;
      if (tries % 16 === 0)
        s.x = clamp(s.x + rnd(-96, 96), 0, map.w - s.w);
    }
  }
  s.vx = 0;
  s.vy = 0;
  s.hp = 100;
  s.fuel = 100;
  s.dead = false;
  s.invuln = first ? SPAWN.INVULN_FIRST : SPAWN.INVULN_RESPAWN;
  s.nades = 2;
  s.shieldT = 0;
  s.recoilT = 0;
  s.equip(WEAPONS.m61, true);
  if (s.isBot)
    s.ai = {
      t: 0,
      side: Math.random() < 0.5 ? -260 : 260,
      wantX: s.x,
      weapon: pick(["ak47", "m16", "mp5", "uzi", "shotgun", "tavor", "xm8"]),
    };
  s.ensureBody(true);
}
