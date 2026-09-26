/* WorldSim — the authoritative world: players, bullets, nades, pickups, bots.
   Runs at a fixed cadence driven by the host (Colyseus room on the server,
   requestAnimationFrame loop for solo, same loop for client-side prediction).
   All observable effects are queued as events (drained by the room for
   broadcast / by the client for fx+sfx) — the sim itself has zero DOM deps.

   Systems live in focused modules; this class owns the world state + step:
     physics.js      matter world + terrain bodies
     pickups.js      pads + grab rules
     projectiles.js  bullets / nades / explosions + ray queries */
import Matter from "matter-js";
import { GameMap } from "../map.js";
import { Soldier } from "../soldier/Soldier.js";
import { makeEvent } from "../events.js";
import { initPhysicsFor } from "./physics.js";
import { initPickupsFor, pickupNearFor, updatePickupsFor } from "./pickups.js";
import {
  raycastFor,
  segHitsRect,
  segHitsSolidFor,
  explodeFor,
  updateBulletsFor,
  updateNadesFor,
} from "./projectiles.js";

export class WorldSim {
  /* opts:
     mapJson     — parsed data/maps/<name>.json (required)
     maskData    — {mask,step,cols} alpha mask (required for sim hosts; built
                   identically on server via pngjs and client via canvas)
     frameSize   — (atlasFrameName) -> {w,h} from menuTexture.json (metrics/aim)
     mode        — "server" | "solo" | "predict"
     flashHold   — debug: pin muzzle flash (visual testing) */
  constructor(opts) {
    this.map = new GameMap(opts.mapJson, opts.maskData || null);
    this.frameSize = opts.frameSize || (() => ({ w: 60, h: 40 }));
    this.mode = opts.mode || "server";
    this.flashHold = !!opts.flashHold;
    this.time = 0;
    this.players = [];
    this.bullets = [];
    this.nades = [];
    this.beams = [];
    this.pickups = [];
    this.events = [];
    this.me = null;
    this._maskData = opts.maskData || null; /* reused by client view for parity checks */
    this.initPhysics();
    this.initPickups();
  }

  ev(t, d = {}) {
    this.events.push(makeEvent(t, d));
  }
  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /* ---------------------------------------------------------- physics */
  initPhysics() {
    initPhysicsFor(this);
  }

  /* ---------------------------------------------------------- players */
  addPlayer(o) {
    const s = new Soldier(this, o);
    this.players.push(s);
    return s;
  }
  removePlayer(id) {
    const p = this.players.find((x) => x.id === id);
    if (p) p.detachBody();
    this.players = this.players.filter((x) => x.id !== id);
    if (this.me === p) this.me = this.players.find((x) => !x.ghost) || null;
  }
  getPlayer(id) {
    return this.players.find((p) => p.id === id);
  }

  /* ---------------------------------------------------------- pickups */
  initPickups() {
    initPickupsFor(this);
  }
  pickupNear(p, skip) {
    return pickupNearFor(this, p, skip);
  }
  updatePickups(dt) {
    updatePickupsFor(this, dt);
  }

  /* ---------------------------------------------------------- combat helpers */
  raycast(x, y, ang, maxD) {
    return raycastFor(this, x, y, ang, maxD);
  }
  segHitsRect(x0, y0, x1, y1, r) {
    return segHitsRect(x0, y0, x1, y1, r);
  }
  segHitsSolid(x0, y0, x1, y1) {
    return segHitsSolidFor(this, x0, y0, x1, y1);
  }
  explode(x, y, def, owner) {
    explodeFor(this, x, y, def, owner);
  }

  /* ---------------------------------------------------------- world update */
  updateBullets(dt) {
    updateBulletsFor(this, dt);
  }
  updateNades(dt) {
    updateNadesFor(this, dt);
  }

  /* one fixed-cadence sim step. dt MUST be pre-clamped by the caller
     (AGENT.md golden rule #1: clampDt((t-last)/1000)) */
  step(dt) {
    this.time += dt;
    for (const p of this.players) p.update(dt);
    this.updateNades(dt); /* hands matter this frame's nade velocities */
    Matter.Engine.update(this.engine, 1000 / 60);
    for (const p of this.players) p.postPhysics();
    for (const n of this.nades)
      if (n.body) {
        /* capture bounce results (px per 1/60s step) */
        n.x = n.body.position.x;
        n.y = n.body.position.y;
        n.vx = n.body.velocity.x * 60;
        n.vy = n.body.velocity.y * 60;
      }
    this.updateBullets(dt);
    this.updatePickups(dt);
    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].t -= dt;
      if (this.beams[i].t <= 0) this.beams.splice(i, 1);
    }
  }
}
