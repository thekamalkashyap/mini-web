/* Soldier — the full legacy movement/combat model, verbatim where it matters.
   Runs inside the authoritative WorldSim (server room, solo, client prediction).
   No rendering, no DOM, no sound side effects: everything observable is exposed
   as state fields (for views) and sim events (for fx/sfx). */
import Matter from "matter-js";
import {
  GRAV,
  TAU,
  clamp,
  lerp,
  rnd,
  pick,
  SPR,
  SOLDIER_W,
  SOLDIER_H,
} from "./constants.js";
import { WEAPONS, NADES, fireSoundOf } from "./weapons.js";

export class Soldier {
  constructor(sim, opts) {
    this.sim = sim;
    Object.assign(
      this,
      {
        id: 0,
        name: "PLAYER",
        isBot: false,
        remote: false,
        ghost: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        w: SOLDIER_W,
        h: SOLDIER_H,
        hp: 100,
        fuel: 100,
        grounded: false,
        dead: false,
        deadT: 0,
        invuln: 1.2,
        aim: 0,
        facing: 1,
        walkT: 0,
        shootT: 0,
        flashT: 0,
        swingT: 0,
        recoilT: 0,
        weapon: WEAPONS.m61,
        weaponId: "m61",
        ammo: 30,
        reloading: 0,
        nades: 2,
        shieldT: 0,
        jetOn: false,
        flaming: false,
        skin: {
          head: "head1.png",
          body: "body1.png",
          arm: "arm1.png",
          leg: "leg1.png",
        },
        kills: 0,
        ai: null,
        input: null,
        cosmeticFire: false /* prediction: flash/recoil only, host owns the real bullets */,
        authoritativeRespawn: false /* prediction: respawn comes from state, never local timer */,
      },
      opts,
    );
    this.equip(this.weapon, true);
    if (!this.ghost) this.respawn(true);
  }

  /* Feet-on-ground placement near (sx, sy): spiral out for a clear box with
     real ground below (never inside rock, never over the void). Flat spots
     win the first pass — frictionless slopes slide, so spawning mid-slope
     is no fun; steep-but-standable ground is the fallback. Candidates that
     would stack on another soldier's box are skipped — squads spawning at
     one point fan out instead of rendering as one blob. */
  placeNear(sx, sy) {
    const map = this.sim.map;
    const overlapsPlayer = (x, y) => {
      for (const o of this.sim.players) {
        if (o === this || o.dead) continue;
        if (
          x < o.x + o.w + 16 &&
          x + this.w + 16 > o.x &&
          y < o.y + o.h + 8 &&
          y + this.h + 8 > o.y
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
        const g = map.groundBelow(cx, sy + dy - this.h, 600);
        if (!g) continue;
        if (flatOnly) {
          const gl = map.groundBelow(cx - 30, g.y - 40, 120);
          const gr = map.groundBelow(cx + 30, g.y - 40, 120);
          if (!gl || !gr || Math.abs(gl.y - gr.y) > 24) continue;
        }
        const x = clamp(cx - this.w / 2, 0, map.w - this.w);
        /* jagged neighbors can clip the box corners — rise minimally until
           clear (short drop on the first frames, never a float) */
        for (let lift = 0; lift <= 64; lift += 8) {
          const y = g.y - this.h - lift;
          if (y < 0) break;
          if (map.rectHitsWorld(x, y, this.w, this.h)) continue;
          if (overlapsPlayer(x, y))
            break; /* same column, higher lift won't help */
          this.x = x;
          this.y = y;
          return true;
        }
      }
    }
    return false;
  }

  /* Sky drop near sx: first column with ground visible from above (never
     inside rock, never over the void). Catches void/high spawns. */
  placeSkyDrop(sx) {
    const map = this.sim.map;
    const offs = [0];
    for (const r of [48, 128, 256, 512, 1024, 2048]) offs.push(-r, r);
    for (const dx of offs) {
      const cx = clamp(sx + dx, 8, map.w - 8);
      const g = map.groundBelow(cx, 0, map.h + 100);
      if (!g) continue;
      const x = clamp(cx - this.w / 2, 0, map.w - this.w);
      for (let lift = 0; lift <= 64; lift += 8) {
        const y = g.y - this.h - lift;
        if (y < 0) break;
        if (map.rectHitsWorld(x, y, this.w, this.h)) continue;
        this.x = x;
        this.y = y;
        return true;
      }
    }
    return false;
  }

  respawn(first) {
    const map = this.sim.map;
    const sp = map.objects.filter(
      (o) => o.name.startsWith("sp_p") || o.name.startsWith("ctf_sp"),
    );
    /* maps with no spawn objects (training) fall back to a top-center drop */
    const pool = sp.length ? sp : [{ x: map.w / 2, y: 80 }];
    /* Authored pools often have points 64px apart — a pure random pick stacks
       respawners into one blob. Pick the spawn FARTHEST from every living
       soldier (random tiebreak keeps respawn points unpredictable). */
    const pickSpawn = () => {
      const live = this.sim.players.filter(
        (p) => p !== this && !p.dead && !p.ghost,
      );
      if (!live.length) return pick(pool);
      let best = null,
        bestD = -1;
      for (const s of pool) {
        let d = Infinity;
        for (const p of live)
          d = Math.min(d, Math.hypot(p.cx() - s.x, p.cy() - s.y));
        d += Math.random() * 220; /* tiebreak: near-equal spawns stay random */
        if (d > bestD) {
          bestD = d;
          best = s;
        }
      }
      return best;
    };
    let placed = false;
    for (let t = 0; t < 8 && !placed; t++) {
      const s = pickSpawn();
      placed = this.placeNear(s.x, s.y);
    }
    if (!placed) {
      const s = pickSpawn();
      placed = this.placeSkyDrop(s.x);
    }
    if (!placed) {
      /* last resort: legacy walk-up de-embed from a random candidate */
      const s = pick(pool);
      this.x = clamp(s.x - this.w / 2, 0, map.w - this.w);
      this.y = s.y - this.h;
      let tries = 0;
      while (
        map.rectHitsWorld(this.x, this.y, this.w, this.h) &&
        tries++ < 64
      ) {
        this.y -= 8;
        if (tries % 16 === 0)
          this.x = clamp(this.x + rnd(-96, 96), 0, map.w - this.w);
      }
    }
    this.vx = 0;
    this.vy = 0;
    this.hp = 100;
    this.fuel = 100;
    this.dead = false;
    this.invuln = first ? 1.5 : 2.0;
    this.nades = 2;
    this.shieldT = 0;
    this.recoilT = 0;
    this.equip(WEAPONS.m61, true);
    if (this.isBot)
      this.ai = {
        t: 0,
        side: Math.random() < 0.5 ? -260 : 260,
        wantX: this.x,
        weapon: pick(["ak47", "m16", "mp5", "uzi", "shotgun", "tavor", "xm8"]),
      };
    this.ensureBody(true);
  }

  /* matter body: collides with the static world only (soldiers pass through
     each other and nades, like the original) */
  ensureBody(place) {
    if (this.ghost || !this.sim.engine) return;
    if (!this.body) {
      this.body = Matter.Bodies.rectangle(
        this.x + this.w / 2,
        this.y + this.h / 2,
        this.w,
        this.h,
        {
          friction: 0,
          frictionStatic: 0,
          frictionAir: 0,
          restitution: 0,
          inertia: Infinity,
          slop: 0.02,
          chamfer: {
            radius: 10,
          } /* rounded feet ride slopes & rock steps smoothly */,
          collisionFilter: { category: 0x0002, mask: 0x0001 },
        },
      );
      this.body._soldier = true;
      Matter.Composite.add(this.sim.engine.world, this.body);
    } else if (place) {
      Matter.Body.setPosition(this.body, {
        x: this.x + this.w / 2,
        y: this.y + this.h / 2,
      });
    }
    Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
    Matter.Body.setAngle(this.body, 0);
  }
  detachBody() {
    if (this.body && this.sim.engine) {
      Matter.Composite.remove(this.sim.engine.world, this.body);
      this.body = null;
    }
  }

  equip(w, silent) {
    this.weapon = w;
    this.weaponId = Object.keys(WEAPONS).find((k) => WEAPONS[k] === w) || "m61";
    this.ammo = w.mag || 0;
    this.reloading = 0;
    if (!silent) this.sim.ev("sfx", { n: "switch", vol: 0.5 });
  }

  reload() {
    const w = this.weapon;
    if (w.melee || this.reloading > 0 || this.ammo >= w.mag) return;
    this.reloading = w.reload;
    this.sim.ev("sfx", { n: "reload", vol: 0.6 });
  }

  muzzle() {
    const gw = (this.sim.frameSize(this.weapon.sprite).w || 60) * SPR;
    const k = this.metrics();
    const reach =
      gw * 0.72 + 6; /* grip-anchored barrel tip, matches the drawn gun */
    /* pivot sits at the rear shoulder edge (opposite the facing), like the view */
    const px = this.cx() + this.facing * k.shoulderDx;
    return {
      x: px + Math.cos(this.aim) * reach,
      y: this.shoulderY() + Math.sin(this.aim) * reach,
    };
  }
  cx() {
    return this.x + this.w / 2;
  }
  cy() {
    return this.y + this.h / 2;
  }
  /* vertical assembly metrics (positive = up from the feet line) */
  metrics() {
    const leg = (this.sim.frameSize(this.skin.leg).h || 84) * SPR;
    const body = (this.sim.frameSize(this.skin.body).h || 102) * SPR;
    const bodyW = (this.sim.frameSize(this.skin.body).w || 56) * SPR;
    return {
      leg,
      body,
      hip: leg - 5,
      neck: leg - 5 + body - 7,
      shoulder: leg - 5 + body * 0.28,
      shoulderDx: -bodyW * 0.35,
    }; /* horizontal: behind center, negated by facing */
  }
  shoulderY() {
    const k = this.metrics();
    return this.y + this.h - k.shoulder;
  }

  throwNade() {
    if (this.dead || this.nades <= 0) return;
    this.nades--;
    const m = this.muzzle();
    const vx = Math.cos(this.aim) * 780 + this.vx * 0.4;
    const vy = Math.sin(this.aim) * 780 - 160;
    const n = {
      x: m.x,
      y: m.y,
      vx,
      vy,
      t: 0,
      fuse: 2.0,
      def: NADES.fragnade,
      owner: this,
    };
    if (this.sim.engine) {
      n.body = Matter.Bodies.circle(n.x, n.y, 8, {
        restitution: 0.45,
        friction: 0.02,
        frictionAir: 0,
        density: 0.002,
        collisionFilter: { category: 0x0004, mask: 0x0001 },
      });
      n.body._nade = true;
      Matter.Composite.add(this.sim.engine.world, n.body);
      Matter.Body.setVelocity(n.body, { x: n.vx / 60, y: n.vy / 60 });
    }
    this.sim.nades.push(n);
    this.sim.ev("sfx", { n: "throw", vol: 0.5 });
    this.sim.ev("nade", {
      x: Math.round(m.x),
      y: Math.round(m.y),
      vx: Math.round(vx),
      vy: Math.round(vy),
    });
  }

  fire(pressed, dt) {
    const w = this.weapon;
    if (this.dead || this.reloading > 0) return;
    const trigger = w.auto ? pressed : pressed && !this._trig;
    this._trig = pressed;
    if (w.melee) {
      if (trigger && this.shootT <= 0) this.meleeSwing();
      return;
    }
    if (!trigger) return;
    if (this.shootT > 0) return;
    if (this.ammo <= 0) {
      this.sim.ev("sfx", { n: "dryfire", vol: 0.5 });
      this.shootT = 0.3;
      this.reload();
      return;
    }

    this.shootT = 60 / (w.rpm * (this.isBot ? 0.5 : 1));
    this.flashT = this.sim.flashHold ? 0.5 : 0.05;
    this.recoilT = w.kick || 0.08;

    if (w.flame) {
      this.ammo = Math.max(0, this.ammo - 1);
      const m = this.muzzle();
      for (let i = 0; i < 2; i++) {
        const a = this.aim + rnd(-w.spread, w.spread);
        const vx = Math.cos(a) * w.speed * rnd(0.85, 1.15),
          vy = Math.sin(a) * w.speed * rnd(0.85, 1.15) - 30;
        this.sim.bullets.push({
          x: m.x,
          y: m.y,
          vx,
          vy,
          dmg: w.dmg * (this.isBot ? 0.6 : 1),
          life: w.range / w.speed,
          owner: this,
          flame: true,
          r: rnd(14, 22),
        });
        this._fc = (this._fc || 0) + 1;
        if (this._fc % 3 === 0)
          this.sim.ev("fire", {
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

    this.ammo--;
    const m = this.muzzle();
    const dmgMul = this.isBot ? 0.6 : 1;
    const spread = w.spread + (this.isBot ? 0.1 : 0);

    if (w.beam) {
      const a = this.aim + rnd(-spread, spread);
      const hit = this.sim.raycast(m.x, m.y, a, 2200);
      this.sim.beams.push({ x0: m.x, y0: m.y, x1: hit.x, y1: hit.y, t: 0.08 });
      for (const p of this.sim.players)
        if (
          p !== this &&
          !p.dead &&
          this.sim.segHitsRect(m.x, m.y, hit.x, hit.y, p)
        )
          p.damage(w.dmg * dmgMul, this);
      this.sim.ev("sfx", { n: "laser", vol: 0.55 });
      if (this.sim.map.solidAtPixel(hit.x, hit.y))
        this.sim.ev("spark", { x: hit.x, y: hit.y, n: 3 });
    } else {
      for (let i = 0; i < (w.pellets || 1); i++) {
        const a = this.aim + rnd(-spread, spread);
        const vx = Math.cos(a) * w.speed,
          vy = Math.sin(a) * w.speed;
        this.sim.bullets.push({
          x: m.x,
          y: m.y,
          vx,
          vy,
          dmg: w.dmg * dmgMul,
          life: w.rocket ? 3.2 : 0.95,
          owner: this,
          rocket: w.rocket,
          splash: w.splash,
          arc: w.arc,
        });
        if (i === 0)
          this.sim.ev("fire", {
            x: Math.round(m.x),
            y: Math.round(m.y),
            vx: Math.round(vx),
            vy: Math.round(vy),
            rocket: w.rocket ? 1 : 0,
            sfx: fireSoundOf(w),
            life: w.rocket ? 3.2 : 0.95,
          });
      }
    }
    this.sim.ev("sfx", { n: fireSoundOf(w), vol: 0.55, rate: rnd(0.95, 1.06) });
    if (this.ammo === 0) this.reload();
  }

  meleeSwing() {
    const w = this.weapon;
    this.shootT = 60 / w.rpm;
    this.swingT = 0.22;
    this.sim.ev("sfx", { n: "melee", vol: 0.4, rate: rnd(0.9, 1.1) });
    for (const p of this.sim.players) {
      if (p === this || p.dead) continue;
      const dx = p.cx() - this.cx(),
        dy = p.cy() - this.shoulderY();
      const d = Math.hypot(dx, dy);
      if (
        d < w.range &&
        Math.abs(angDiff(Math.atan2(dy, dx), this.aim)) < 1.0
      ) {
        p.damage(w.dmg * (this.isBot ? 0.6 : 1), this);
        p.vx += Math.sign(dx || 1) * 300;
        p.vy -= 120;
        this.sim.ev("sfx", { n: "impale", vol: 0.5 });
      }
    }
  }

  damage(d, by) {
    if (this.dead || this.invuln > 0) return;
    if (this.weapon.shield) d *= this.weapon.shield;
    if (this.shieldT > 0) d *= 0.5;
    this.hp -= d;
    this.sim.ev("hit", {
      x: this.cx(),
      y: this.cy(),
      n: Math.min(8, 2 + d / 6),
    });
    this.sim.ev("sfx", { n: pick(["impact", "impact2", "impact3"]), vol: 0.4 });
    if (this.hp <= 0) this.die(by);
  }

  die(by) {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 2.6;
    this.detachBody(); /* corpses don't block the world */
    this.sim.ev("hit", { x: this.cx(), y: this.cy(), n: 16 });
    this.sim.ev("sfx", {
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
    if (by && by !== this) {
      by.kills++;
      this.sim.ev("death", { who: this.id, by: by.id });
    } else this.sim.ev("death", { who: this.id, by: 0 });
  }

  physics(dt, input) {
    if (this.dead) {
      this.deadT -= dt;
      /* predicted own-soldier: respawn is state-driven — a local timer would
         flap against the authoritative one */
      if (this.authoritativeRespawn) return;
      if (!this.ghost && this.deadT <= 0) this.respawn();
      return;
    }
    const map = this.sim.map;
    this.invuln = Math.max(0, this.invuln - dt);
    this.shootT -= dt;
    this.flashT -= dt;
    this.swingT -= dt;
    this.recoilT = Math.max(0, this.recoilT - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.ammo = this.weapon.mag;
        this.reloading = 0;
      }
    }
    this.flaming = !!(
      this.weapon.flame &&
      input &&
      input.fire &&
      !this.dead &&
      this.reloading <= 0
    );
    this._lastInp = input || {};

    const accel = this.grounded ? 2100 : 1200;
    if (input.left) this.vx -= accel * dt;
    if (input.right) this.vx += accel * dt;
    this.vx = clamp(this.vx, -380, 380);
    if (!input.left && !input.right)
      this.vx *= Math.pow(this.grounded ? 0.0002 : 0.2, dt);

    let thrusting = false;
    if (input.jet && this.fuel > 0) {
      this.vy -= 2100 * dt;
      this.fuel = Math.max(0, this.fuel - 30 * dt);
      thrusting = true;
      if (Math.random() < 0.6)
        this.sim.ev("smoke", {
          x: this.cx() - this.facing * 10,
          y: this.y + this.h * 0.75,
        });
    }
    this.jetOn = thrusting;
    this.vy += GRAV * dt;
    this.vy = clamp(this.vy, -750, 1250);
    if (this.grounded && !thrusting)
      this.fuel = Math.min(100, this.fuel + 26 * dt);
    for (const o of map.objects)
      if (
        o.name.startsWith("fp_b") &&
        Math.abs(o.x - this.cx()) < 70 &&
        Math.abs(o.y - this.y - this.h) < 90
      )
        this.fuel = Math.min(100, this.fuel + 55 * dt);

    /* matter resolves the collisions: hand it this frame's velocity (px/step) */
    if (this.body)
      Matter.Body.setVelocity(this.body, { x: this.vx * dt, y: this.vy * dt });

    if (Math.abs(this.vx) > 40 && this.grounded)
      this.walkT += dt * Math.abs(this.vx) * 0.008;
    else this.walkT = 0;

    if (input.aimX !== undefined && input.aimX !== null) {
      this.aim = Math.atan2(
        input.aimY - this.shoulderY(),
        input.aimX - this.cx(),
      );
    }
    this.facing = Math.cos(this.aim) >= 0 ? 1 : -1;
    /* predicted own-soldier: weapon sim is authoritative-side; run a cosmetic
       flash/recoil so the player still sees their own barrel working */
    if (this.cosmeticFire) {
      if (
        input.fire &&
        !this.dead &&
        this.reloading <= 0 &&
        this.shootT <= 0 &&
        this.ammo > 0 &&
        !this.weapon.melee &&
        !this.weapon.flame
      ) {
        this.flashT = this.sim.flashHold ? 0.5 : 0.05;
        this.recoilT = this.weapon.kick || 0.08;
        this.shootT = 60 / this.weapon.rpm;
      }
    } else this.fire(input.fire, dt);
  }

  /* after the matter step: read back position, ground contact, void death */
  postPhysics() {
    if (!this.body || this.dead) return;
    const wasGrounded = this.grounded,
      fallV = this.vy;
    this.x = this.body.position.x - this.w / 2;
    this.y = this.body.position.y - this.h / 2;
    this.x = clamp(this.x, 0, this.sim.map.w - this.w);
    this.grounded =
      this.vy >= 0 &&
      this.sim.map.rectHitsWorld(
        this.x + 2,
        this.y + this.h - 2,
        this.w - 4,
        8,
      );
    if (this.grounded) {
      if (!wasGrounded && fallV > 500)
        this.sim.ev("sfx", { n: "boots", vol: 0.25 });
      this.vy = 0;
    }
    /* small-step climbing: grounded + pushing into a low step (rock ledges,
       decor piles, grassy stair nubs) lifts the soldier onto it instead of
       pinning — tall walls (no landing within reach) still block */
    if (this.grounded) {
      const li = this._lastInp || {};
      const dir = li.right ? 1 : li.left ? -1 : 0;
      const pushing = dir !== 0 && Math.abs(this.vx) > 200;
      const matterVx = Math.abs(this.body.velocity.x) * 60;
      if (pushing && matterVx < 80) {
        for (const h of [36, 28, 20, 12]) {
          const ny = this.y - h;
          if (ny < 0) continue;
          if (this.sim.map.rectHitsWorld(this.x, ny, this.w, this.h))
            continue; /* headroom */
          /* landing: ground under the lifted FRONT foot (the step top ahead) */
          const lx = dir > 0 ? this.x + this.w / 2 : this.x - 16;
          if (!this.sim.map.rectHitsWorld(lx, ny + this.h, this.w / 2 + 16, 10))
            continue;
          this.y = ny;
          Matter.Body.setPosition(this.body, {
            x: this.x + this.w / 2,
            y: this.y + this.h / 2,
          });
          break;
        }
      }
    }
    if (!Number.isFinite(this.x + this.y)) this.respawn();
    if (this.y > this.sim.map.h + 300) {
      this.hp = 0;
      this.die(null);
    }
  }

  update(dt, input) {
    if (this.ghost) return; /* remote render stub */
    if (this.isBot) botThink(this, dt);
    const inp =
      input || (this.isBot ? this.ai && this.ai.input : this.input) || {};
    this.physics(dt, inp);
  }
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/* ---------------------------------------------------------- bot AI */
export function botThink(b, dt) {
  const ai = b.ai;
  ai.t -= dt;
  const sim = b.sim;
  const target =
    sim.me && !sim.me.dead
      ? sim.me
      : sim.players.find((p) => p !== b && !p.isBot) ||
        sim.players.find((p) => p !== b);
  if (ai.t <= 0) {
    ai.t = rnd(0.25, 0.5);
    ai.wantX = target ? target.cx() + ai.side * rnd(0.4, 1.1) : b.cx();
    if (Math.random() < 0.15) ai.side *= -1;
    if (Math.random() < 0.3 && b.grounded) b.vy = -rnd(300, 550);
  }
  const input = {
    left: false,
    right: false,
    jet: false,
    fire: false,
    aimX: null,
    aimY: null,
  };
  const dx = ai.wantX - b.cx();
  if (Math.abs(dx) > 40) {
    if (dx < 0) input.left = true;
    else input.right = true;
  }
  if (target) {
    if (target.cy() < b.cy() - 140 && Math.random() < 0.7) input.jet = true;
    if (b.grounded && Math.abs(b.vx) < 30 && Math.abs(dx) > 60)
      input.jet = true;
    const los = !sim.segHitsSolid(
      b.cx(),
      b.shoulderY(),
      target.cx(),
      target.cy(),
    );
    input.aimX = target.cx() + rnd(-40, 40);
    input.aimY = target.cy() + rnd(-30, 30);
    const dist = Math.hypot(target.cx() - b.cx(), target.cy() - b.cy());
    input.fire = los && dist < 1300 && !target.dead;
  }
  ai.input = input;
}
