/* Projectiles + explosions — ray/segment queries, bullet and grenade
   integration, splash damage. Ghost (visual-only) bullets/nades never damage;
   the authority owns real damage, guests mirror it through events. */
import Matter from "matter-js";
import { clamp, lerp, rnd } from "../utils/math.js";
import { COMBAT, EMP, NADE } from "../config/tuning.js";
import { Ev } from "../events.js";
import { stepGhostNade } from "../combat.js";

export function raycastFor(sim, x, y, ang, maxD) {
  const dx = Math.cos(ang),
    dy = Math.sin(ang);
  for (let d = 0; d < maxD; d += 16) {
    const px = x + dx * d,
      py = y + dy * d;
    if (
      sim.map.solidAtPixel(px, py) ||
      px < 0 ||
      py < 0 ||
      px > sim.map.w ||
      py > sim.map.h
    )
      return { x: px, y: py };
  }
  return { x: x + dx * maxD, y: y + dy * maxD };
}

export function segHitsRect(x0, y0, x1, y1, r) {
  const steps = Math.max(2, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 12));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      x = lerp(x0, x1, t),
      y = lerp(y0, y1, t);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

export function segHitsSolidFor(sim, x0, y0, x1, y1) {
  const steps = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 32);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (sim.map.solidAtPixel(lerp(x0, x1, t), lerp(y0, y1, t))) return true;
  }
  return false;
}

export function explodeFor(sim, x, y, def, owner) {
  sim.ev(Ev.BOOM, { x: Math.round(x), y: Math.round(y), r: def.splash });
  sim.ev(Ev.SFX, { n: "explode", vol: 0.8, rate: rnd(0.9, 1.1) });
  for (const p of sim.players) {
    if (p.dead) continue;
    const d = Math.hypot(p.cx() - x, p.cy() - y);
    if (d < def.splash) {
      let dmg = def.dmg * (1 - d / def.splash);
      if (p === owner) dmg *= COMBAT.SELF_SPLASH_MUL;
      if (dmg > 1) {
        p.damage(dmg, owner);
        const dx = p.cx() - x,
          dy = p.cy() - y,
          inv = d > 0.001 ? 1 / d : 0; /* d==0 must not NaN-poison physics */
        p.vx += dx * inv * 420;
        p.vy += dy * inv * 420 - 120;
      }
    }
  }
  for (let i = 0; i < 10; i++)
    sim.ev(Ev.SPARK, { x: x + rnd(-40, 40), y: y + rnd(-40, 40), n: 2 });
}

export function updateBulletsFor(sim, dt) {
  for (let i = sim.bullets.length - 1; i >= 0; i--) {
    const b = sim.bullets[i];
    b.life -= dt;
    if (b.life <= 0) {
      sim.bullets.splice(i, 1);
      continue;
    }
    const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 20));
    let hit = false;
    for (let s = 0; s < steps && !hit; s++) {
      b.x += (b.vx * dt) / steps;
      b.y += (b.vy * dt) / steps;
      if (b.arc) b.vy += (900 * dt) / steps;
      if (sim.map.solidAtPixel(b.x, b.y)) {
        if (b.rocket) {
          if (!b.ghost)
            sim.explode(b.x, b.y, { splash: b.splash, dmg: b.dmg }, b.owner);
        } else if (!b.flame && !b.emp) {
          sim.ev(Ev.SPARK, { x: b.x, y: b.y, n: 2 });
          if (Math.random() < 0.3)
            sim.ev(Ev.SFX, { n: "ricochet", vol: 0.15 });
        }
        hit = true;
        break;
      }
      if (b.ghost) continue; /* visual-only bullets never damage */
      for (const p of sim.players) {
        if (p === b.owner || p.dead || p.invuln > 0 || p.ghost) continue;
        if (b.x > p.x && b.x < p.x + p.w && b.y > p.y && b.y < p.y + p.h) {
          if (b.rocket)
            sim.explode(b.x, b.y, { splash: b.splash, dmg: b.dmg }, b.owner);
          else p.damage(b.dmg, b.owner);
          if (b.emp) p.empT = EMP.DISABLE_T;
          hit = true;
          break;
        }
      }
    }
    if (hit) sim.bullets.splice(i, 1);
  }
}

export function updateNadesFor(sim, dt) {
  for (let i = sim.nades.length - 1; i >= 0; i--) {
    const n = sim.nades[i];
    n.t += dt;
    if (n.body) {
      /* physical nade: legacy gravity, matter resolves the bounces */
      n.vy = clamp(n.vy + NADE.GRAVITY * dt, -1800, 1800);
      Matter.Body.setVelocity(n.body, { x: n.vx * dt, y: n.vy * dt });
      n.x = n.body.position.x;
      n.y = n.body.position.y;
    } else {
      /* ghost nade (visual only, prediction): legacy integration */
      stepGhostNade(n, dt, (x, y) => sim.map.solidAtPixel(x, y));
    }
    const prox =
      !n.ghost &&
      n.def.proxy &&
      n.t > NADE.PROXY_ARM &&
      sim.players.some(
        (p) =>
          p !== n.owner &&
          !p.dead &&
          !p.ghost &&
          Math.hypot(p.cx() - n.x, p.cy() - n.y) < n.def.proxy,
      );
    if (n.t >= (n.fuse || NADE.FUSE) || prox) {
      if (!n.ghost) {
        if (n.body && sim.engine)
          Matter.Composite.remove(sim.engine.world, n.body);
        sim.explode(n.x, n.y, { splash: n.def.splash, dmg: n.def.dmg }, n.owner);
      }
      sim.nades.splice(i, 1);
    }
  }
}
