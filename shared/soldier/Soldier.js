/* Soldier — the full legacy movement/combat model, verbatim where it matters.
   Runs inside the authoritative WorldSim (server room, solo, client prediction).
   No rendering, no DOM, no sound side effects: everything observable is exposed
   as state fields (for views) and sim events (for fx/sfx).

   Behavior lives in focused modules; this class owns identity + state:
     spawn.js     placeNear / skyDrop / respawn
     movement.js  per-frame physics + post-matter readback
     combat.js    equip / reload / fire / nades / damage / death
     bot.js       botThink (AI input) */
import Matter from "matter-js";
import { SOLDIER_W, SOLDIER_H } from "../config/tuning.js";
import { avatarMetrics } from "../avatar.js";
import { WEAPONS } from "../weapons.js";
import { placeNearSoldier, placeSkyDropSoldier, respawnSoldier } from "./spawn.js";
import { stepPhysics, postPhysicsStep } from "./movement.js";
import {
  equipSoldier,
  reloadSoldier,
  muzzleOf,
  throwNadeSoldier,
  fireSoldier,
  meleeSwingSoldier,
  damageSoldier,
  dieSoldier,
} from "./combat.js";
import { botThink } from "./bot.js";

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
        empT: 0, // EMP-grounded timer (blocks jet thrust while > 0)
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

  /* ---- spawn (see spawn.js) ---- */
  placeNear(sx, sy) {
    return placeNearSoldier(this, sx, sy);
  }
  placeSkyDrop(sx) {
    return placeSkyDropSoldier(this, sx);
  }
  respawn(first) {
    return respawnSoldier(this, first);
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

  /* ---- combat (see combat.js) ---- */
  equip(w, silent) {
    return equipSoldier(this, w, silent);
  }
  reload() {
    return reloadSoldier(this);
  }
  muzzle() {
    return muzzleOf(this);
  }
  throwNade() {
    return throwNadeSoldier(this);
  }
  fire(pressed, dt) {
    return fireSoldier(this, pressed, dt);
  }
  meleeSwing() {
    return meleeSwingSoldier(this);
  }
  damage(d, by) {
    return damageSoldier(this, d, by);
  }
  die(by) {
    return dieSoldier(this, by);
  }

  cx() {
    return this.x + this.w / 2;
  }
  cy() {
    return this.y + this.h / 2;
  }
  /* vertical assembly metrics — MUST match the view's layout (avatar.js) */
  metrics() {
    return avatarMetrics(this.sim.frameSize, this.skin);
  }
  shoulderY() {
    const k = this.metrics();
    return this.y + this.h - k.shoulder;
  }

  /* ---- movement (see movement.js) ---- */
  physics(dt, input) {
    return stepPhysics(this, dt, input);
  }
  postPhysics() {
    return postPhysicsStep(this);
  }

  update(dt, input) {
    if (this.ghost) return; /* remote render stub */
    if (this.isBot) botThink(this, dt);
    const inp =
      input || (this.isBot ? this.ai && this.ai.input : this.input) || {};
    this.physics(dt, inp);
  }
}
