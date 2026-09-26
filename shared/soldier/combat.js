/* Soldier combat — equip/reload, muzzle geometry, all fire modes (hitscan,
   projectile, beam, flame, melee), grenades, damage and death. Verbatim
   legacy math; everything observable goes out as sim events. */
import Matter from "matter-js";
import { clamp, rnd, pick, angDiff } from "../utils/math.js";
import { BOT, COMBAT, NADE, SPAWN } from "../config/tuning.js";
import { WEAPONS, NADES, fireSoundOf, weaponIdOf } from "../weapons.js";
import { Ev } from "../events.js";
import { barrelReach, nadeThrowVelocity } from "../combat.js";

export function equipSoldier(s, w, silent) {
  s.weapon = w;
  s.weaponId = weaponIdOf(w);
  s.ammo = w.mag || 0;
  s.reloading = 0;
  if (!silent) s.sim.ev(Ev.SFX, { n: "switch", vol: 0.5 });
}

export function reloadSoldier(s) {
  const w = s.weapon;
  if (w.melee || s.reloading > 0 || s.ammo >= w.mag) return;
  s.reloading = w.reload;
  s.sim.ev(Ev.SFX, { n: "reload", vol: 0.6 });
}

export function muzzleOf(s) {
  const reach = barrelReach(s.sim.frameSize, s.weapon);
  const k = s.metrics();
  /* pivot sits at the rear shoulder edge (opposite the facing), like the view */
  const px = s.cx() + s.facing * k.shoulderDx;
  return {
    x: px + Math.cos(s.aim) * reach,
    y: s.shoulderY() + Math.sin(s.aim) * reach,
  };
}

export function throwNadeSoldier(s) {
  if (s.dead || s.nades <= 0) return;
  s.nades--;
  const m = s.muzzle();
  const { vx, vy } = nadeThrowVelocity(s.aim, s.vx);
  const n = {
    x: m.x,
    y: m.y,
    vx,
    vy,
    t: 0,
    fuse: NADE.FUSE,
    def: NADES.fragnade,
    owner: s,
  };
  if (s.sim.engine) {
    n.body = Matter.Bodies.circle(n.x, n.y, 8, {
      restitution: 0.45,
      friction: 0.02,
      frictionAir: 0,
      density: 0.002,
      collisionFilter: { category: 0x0004, mask: 0x0001 },
    });
    n.body._nade = true;
    Matter.Composite.add(s.sim.engine.world, n.body);
    Matter.Body.setVelocity(n.body, { x: n.vx / 60, y: n.vy / 60 });
  }
  s.sim.nades.push(n);
  s.sim.ev(Ev.SFX, { n: "throw", vol: 0.5 });
  s.sim.ev(Ev.NADE, {
    x: Math.round(m.x),
    y: Math.round(m.y),
    vx: Math.round(vx),
    vy: Math.round(vy),
  });
}

export function fireSoldier(s, pressed, dt) {
  const w = s.weapon;
  if (s.dead || s.reloading > 0) return;
  const trigger = w.auto ? pressed : pressed && !s._trig;
  s._trig = pressed;
  if (w.melee) {
    if (trigger && s.shootT <= 0) s.meleeSwing();
    return;
  }
  if (!trigger) return;
  if (s.shootT > 0) return;
  if (s.ammo <= 0) {
    s.sim.ev(Ev.SFX, { n: "dryfire", vol: 0.5 });
    s.shootT = 0.3;
    s.reload();
    return;
  }

  s.shootT = 60 / (w.rpm * (s.isBot ? BOT.FIRE_RATE_MUL : 1));
  s.flashT = s.sim.flashHold ? 0.5 : 0.05;
  s.recoilT = w.kick || 0.08;

  if (w.flame) {
    s.ammo = Math.max(0, s.ammo - 1);
    const m = s.muzzle();
    for (let i = 0; i < 2; i++) {
      const a = s.aim + rnd(-w.spread, w.spread);
      const vx = Math.cos(a) * w.speed * rnd(0.85, 1.15),
        vy = Math.sin(a) * w.speed * rnd(0.85, 1.15) - 30;
      s.sim.bullets.push({
        x: m.x,
        y: m.y,
        vx,
        vy,
        dmg: w.dmg * (s.isBot ? BOT.DMG_MUL : 1),
        life: w.range / w.speed,
        owner: s,
        flame: true,
        r: rnd(14, 22),
      });
      s._fc = (s._fc || 0) + 1;
      if (s._fc % 3 === 0)
        s.sim.ev(Ev.FIRE, {
          flame: 1,
          x: Math.round(m.x),
          y: Math.round(m.y),
          vx: Math.round(vx),
          vy: Math.round(vy),
          life: 0.5,
        });
    }
    return;
  }

  s.ammo--;
  const m = s.muzzle();
  const dmgMul = s.isBot ? BOT.DMG_MUL : 1;
  const spread = w.spread + (s.isBot ? BOT.SPREAD_BONUS : 0);

  if (w.beam) {
    const a = s.aim + rnd(-spread, spread);
    const hit = s.sim.raycast(m.x, m.y, a, 2200);
    s.sim.beams.push({ x0: m.x, y0: m.y, x1: hit.x, y1: hit.y, t: 0.08 });
    for (const p of s.sim.players)
      if (
        p !== s &&
        !p.dead &&
        s.sim.segHitsRect(m.x, m.y, hit.x, hit.y, p)
      )
        p.damage(w.dmg * dmgMul, s);
    s.sim.ev(Ev.SFX, { n: "laser", vol: 0.55 });
    if (s.sim.map.solidAtPixel(hit.x, hit.y))
      s.sim.ev(Ev.SPARK, { x: hit.x, y: hit.y, n: 3 });
  } else {
    for (let i = 0; i < (w.pellets || 1); i++) {
      const a = s.aim + rnd(-spread, spread);
      const vx = Math.cos(a) * w.speed,
        vy = Math.sin(a) * w.speed;
      s.sim.bullets.push({
        x: m.x,
        y: m.y,
        vx,
        vy,
        dmg: w.dmg * dmgMul,
        life: w.rocket ? 3.2 : 0.95,
        owner: s,
        rocket: w.rocket,
        emp: w.emp,
        splash: w.splash,
        arc: w.arc,
      });
      if (i === 0)
        s.sim.ev(Ev.FIRE, {
          x: Math.round(m.x),
          y: Math.round(m.y),
          vx: Math.round(vx),
          vy: Math.round(vy),
          rocket: w.rocket ? 1 : 0,
          emp: w.emp ? 1 : 0,
          sfx: fireSoundOf(w),
          life: w.rocket ? 3.2 : 0.95,
        });
    }
  }
  s.sim.ev(Ev.SFX, { n: fireSoundOf(w), vol: 0.55, rate: rnd(0.95, 1.06) });
  if (s.ammo === 0) s.reload();
}

export function meleeSwingSoldier(s) {
  const w = s.weapon;
  s.shootT = 60 / w.rpm;
  s.swingT = 0.22;
  s.sim.ev(Ev.SFX, { n: "melee", vol: 0.4, rate: rnd(0.9, 1.1) });
  for (const p of s.sim.players) {
    if (p === s || p.dead) continue;
    const dx = p.cx() - s.cx(),
      dy = p.cy() - s.shoulderY();
    const d = Math.hypot(dx, dy);
    if (
      d < w.range &&
      Math.abs(angDiff(Math.atan2(dy, dx), s.aim)) < COMBAT.MELEE_ARC
    ) {
      p.damage(w.dmg * (s.isBot ? BOT.DMG_MUL : 1), s);
      p.vx += Math.sign(dx || 1) * 300;
      p.vy -= 120;
      s.sim.ev(Ev.SFX, { n: "impale", vol: 0.5 });
    }
  }
}

export function damageSoldier(s, d, by) {
  if (s.dead || s.invuln > 0) return;
  if (s.weapon.shield) d *= s.weapon.shield;
  if (s.shieldT > 0) d *= 0.5;
  s.hp -= d;
  s.sim.ev(Ev.HIT, {
    x: s.cx(),
    y: s.cy(),
    n: Math.min(8, 2 + d / 6),
  });
  s.sim.ev(Ev.SFX, { n: pick(["impact", "impact2", "impact3"]), vol: 0.4 });
  if (s.hp <= 0) s.die(by);
}

export function dieSoldier(s, by) {
  if (s.dead) return;
  s.dead = true;
  s.deadT = SPAWN.DEAD_TIME;
  s.detachBody(); /* corpses don't block the world */
  s.sim.ev(Ev.HIT, { x: s.cx(), y: s.cy(), n: 16 });
  s.sim.ev(Ev.SFX, {
    n: pick([
      "death1",
      "death2",
      "death3",
      "death4",
      "death5",
      "death6",
      "death7",
      "death8",
      "death9",
    ]),
    vol: 0.8,
  });
  if (by && by !== s) {
    by.kills++;
    s.sim.ev(Ev.DEATH, { who: s.id, by: by.id });
  } else s.sim.ev(Ev.DEATH, { who: s.id, by: 0 });
}
