/* Soldier movement — per-frame integration (run/jetpack/fuel/aim/fire) plus
   the post-matter readback (ground contact, step-up climbing, void death).
   matter.js is collision-resolution only: game code owns gravity and hands
   matter per-step velocities (AGENT.md #5). */
import Matter from "matter-js";
import { clamp } from "../utils/math.js";
import { GRAV, WORLD } from "../config/tuning.js";
import { Ev } from "../events.js";

export function stepPhysics(s, dt, input) {
  if (s.dead) {
    s.deadT -= dt;
    /* predicted own-soldier: respawn is state-driven — a local timer would
       flap against the authoritative one */
    if (s.authoritativeRespawn) return;
    if (!s.ghost && s.deadT <= 0) s.respawn();
    return;
  }
  const map = s.sim.map;
  s.invuln = Math.max(0, s.invuln - dt);
  s.shootT -= dt;
  s.flashT -= dt;
  s.swingT -= dt;
  s.recoilT = Math.max(0, s.recoilT - dt);
  if (s.reloading > 0) {
    s.reloading -= dt;
    if (s.reloading <= 0) {
      s.ammo = s.weapon.mag;
      s.reloading = 0;
    }
  }
  s.flaming = !!(
    s.weapon.flame &&
    input &&
    input.fire &&
    !s.dead &&
    s.reloading <= 0
  );
  s._lastInp = input || {};

  const accel = s.grounded ? 2100 : 1200;
  if (input.left) s.vx -= accel * dt;
  if (input.right) s.vx += accel * dt;
  s.vx = clamp(s.vx, -380, 380);
  if (!input.left && !input.right)
    s.vx *= Math.pow(s.grounded ? 0.0002 : 0.2, dt);

  s.empT = Math.max(0, (s.empT || 0) - dt);
  let thrusting = false;
  if (input.jet && s.fuel > 0 && s.empT <= 0) {
    s.vy -= 2100 * dt;
    s.fuel = Math.max(0, s.fuel - 30 * dt);
    thrusting = true;
    if (Math.random() < 0.6)
      s.sim.ev(Ev.SMOKE, {
        x: s.cx() - s.facing * 10,
        y: s.y + s.h * 0.75,
      });
  }
  s.jetOn = thrusting;
  s.vy += GRAV * dt;
  s.vy = clamp(s.vy, -750, 1250);
  if (s.grounded && !thrusting)
    s.fuel = Math.min(100, s.fuel + 26 * dt);
  for (const o of map.objects)
    if (
      o.name.startsWith("fp_b") &&
      Math.abs(o.x - s.cx()) < 70 &&
      Math.abs(o.y - s.y - s.h) < 90
    )
      s.fuel = Math.min(100, s.fuel + 55 * dt);

  /* matter resolves the collisions: hand it this frame's velocity (px/step) */
  if (s.body)
    Matter.Body.setVelocity(s.body, { x: s.vx * dt, y: s.vy * dt });

  if (Math.abs(s.vx) > 40 && s.grounded)
    s.walkT += dt * Math.abs(s.vx) * 0.008;
  else s.walkT = 0;

  if (input.aimX !== undefined && input.aimX !== null) {
    s.aim = Math.atan2(
      input.aimY - s.shoulderY(),
      input.aimX - s.cx(),
    );
  }
  s.facing = Math.cos(s.aim) >= 0 ? 1 : -1;
  /* predicted own-soldier: weapon sim is authoritative-side; run a cosmetic
     flash/recoil so the player still sees their own barrel working */
  if (s.cosmeticFire) {
    if (
      input.fire &&
      !s.dead &&
      s.reloading <= 0 &&
      s.shootT <= 0 &&
      s.ammo > 0 &&
      !s.weapon.melee &&
      !s.weapon.flame
    ) {
      s.flashT = s.sim.flashHold ? 0.5 : 0.05;
      s.recoilT = s.weapon.kick || 0.08;
      s.shootT = 60 / s.weapon.rpm;
    }
  } else s.fire(input.fire, dt);
}

/* after the matter step: read back position, ground contact, void death */
export function postPhysicsStep(s) {
  if (!s.body || s.dead) return;
  const wasGrounded = s.grounded,
    fallV = s.vy;
  s.x = s.body.position.x - s.w / 2;
  s.y = s.body.position.y - s.h / 2;
  s.x = clamp(s.x, 0, s.sim.map.w - s.w);
  s.grounded =
    s.vy >= 0 &&
    s.sim.map.rectHitsWorld(
      s.x + 2,
      s.y + s.h - 2,
      s.w - 4,
      8,
    );
  if (s.grounded) {
    if (!wasGrounded && fallV > 500)
      s.sim.ev(Ev.SFX, { n: "boots", vol: 0.25 });
    s.vy = 0;
  }
  /* small-step climbing: grounded + pushing into a low step (rock ledges,
     decor piles, grassy stair nubs) lifts the soldier onto it instead of
     pinning — tall walls (no landing within reach) still block */
  if (s.grounded) {
    const li = s._lastInp || {};
    const dir = li.right ? 1 : li.left ? -1 : 0;
    const pushing = dir !== 0 && Math.abs(s.vx) > 200;
    const matterVx = Math.abs(s.body.velocity.x) * 60;
    if (pushing && matterVx < 80) {
      for (const h of [36, 28, 20, 12]) {
        const ny = s.y - h;
        if (ny < 0) continue;
        if (s.sim.map.rectHitsWorld(s.x, ny, s.w, s.h))
          continue; /* headroom */
        /* landing: ground under the lifted FRONT foot (the step top ahead) */
        const lx = dir > 0 ? s.x + s.w / 2 : s.x - 16;
        if (!s.sim.map.rectHitsWorld(lx, ny + s.h, s.w / 2 + 16, 10))
          continue;
        s.y = ny;
        Matter.Body.setPosition(s.body, {
          x: s.x + s.w / 2,
          y: s.y + s.h / 2,
        });
        break;
      }
    }
  }
  if (!Number.isFinite(s.x + s.y)) s.respawn();
  if (s.y > s.sim.map.h + WORLD.VOID_MARGIN) {
    s.hp = 0;
    s.die(null);
  }
}
