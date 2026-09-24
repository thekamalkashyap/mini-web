/* WorldSim — the authoritative world: players, bullets, nades, pickups, bots.
   Runs at a fixed cadence driven by the host (Colyseus room on the server,
   requestAnimationFrame loop for solo, same loop for client-side prediction).
   All observable effects are queued as events (drained by the room for
   broadcast / by the client for fx+sfx) — the sim itself has zero DOM deps. */
import Matter from "matter-js";
import { TAU, clamp, lerp, rnd, TRIP } from "./constants.js";
import { GameMap } from "./map.js";
import { Soldier } from "./soldier.js";
import { WEAPONS, NADES } from "./weapons.js";

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
    this.bullets = []; this.nades = []; this.beams = []; this.pickups = [];
    this.events = [];
    this.me = null;
    this._maskData = opts.maskData || null;   /* reused by client view for parity checks */
    this.initPhysics();
    this.initPickups();
  }

  ev(t, d = {}) { this.events.push(Object.assign({ t }, d)); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  /* ---------------------------------------------------------- physics */
  initPhysics() {
    this.engine = Matter.Engine.create({ enableSleeping: false });
    this.engine.gravity.x = 0; this.engine.gravity.y = 0;   /* game code owns gravity */
    const opts = { isStatic: true, friction: 0, frictionStatic: 0, restitution: 0 };
    const shapes = this.map.solidShapes();
    const bodies = shapes.rects.map(r =>
      Matter.Bodies.rectangle(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, opts));
    /* slope skins: one convex trapezoid per walkable surface run, top edge =
       the diagonal itself (no stair steps). Convex quads need no decomp. */
    for (const s of shapes.skins) {
      const quad = [
        { x: s.x0, y: s.y0 }, { x: s.x1, y: s.y1 },
        { x: s.x1, y: s.y1 + s.depth }, { x: s.x0, y: s.y0 + s.depth },
      ];
      const b = Matter.Bodies.fromVertices((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2 + s.depth / 2, quad, opts);
      if (b) bodies.push(b);
    }
    for (const b of bodies) b._terrain = true;
    const T = 96;   /* boundary walls (bottom left open — void death line catches fallers) */
    bodies.push(Matter.Bodies.rectangle(this.map.w / 2, -T / 2, this.map.w + T * 4, T, opts));
    bodies.push(Matter.Bodies.rectangle(-T / 2, this.map.h / 2, T, this.map.h * 3, opts));
    bodies.push(Matter.Bodies.rectangle(this.map.w + T / 2, this.map.h / 2, T, this.map.h * 3, opts));
    for (let i = bodies.length - 3; i < bodies.length; i++) bodies[i]._wall = true;
    Matter.Composite.add(this.engine.world, bodies);
    /* nade bounce clatter (velocity is px per 1/60s step) */
    Matter.Events.on(this.engine, "collisionStart", ev => {
      for (const pair of ev.pairs) {
        const nade = (pair.bodyA._nade && pair.bodyA) || (pair.bodyB._nade && pair.bodyB);
        if (nade) {
          const v = Math.hypot(nade.velocity.x, nade.velocity.y);
          if (v > 2.5) this.ev("sfx", { n: "clank", vol: Math.min(0.3, 0.08 + v / 40) });
        }
      }
    });
  }

  /* ---------------------------------------------------------- players */
  addPlayer(o) {
    const s = new Soldier(this, o);
    this.players.push(s);
    return s;
  }
  removePlayer(id) {
    const p = this.players.find(x => x.id === id);
    if (p) p.detachBody();
    this.players = this.players.filter(x => x.id !== id);
    if (this.me === p) this.me = this.players.find(x => !x.ghost) || null;
  }
  getPlayer(id) { return this.players.find(p => p.id === id); }

  /* ---------------------------------------------------------- pickups */
  initPickups() {
    this.pickups = [];
    for (const o of this.map.objects) {
      if (o.name.startsWith("wp_p") || o.name.startsWith("ctf_wp")) {
        const list = (o.props.weapon || "").split(",").map(s => s.trim()).filter(Boolean);
        if (!list.length) continue;
        /* Authored points float (up to ~260px over the floor) or sit inside
           rock — settle each drop onto nearby ground: lift out of solid,
           rest just above the first surface below, keep the closest
           groundable column. Ungroundable (over void) stays as authored. */
        let bx = o.x, by = o.y, best = Infinity;
        for (const dx of [0, -24, 24, -48, 48, -96, 96, -160, 160, -256, 256, -384, 384, -512, 512]) {
          const cx = Math.min(Math.max(o.x + dx, 8), this.map.w - 8);
          let y = o.y;
          if (this.map.solidAtPixel(cx, y)) {
            for (let d = 6; d <= 600; d += 6) {
              if (y - d < 0 || !this.map.solidAtPixel(cx, y - d)) { y -= d; break; }
            }
            if (this.map.solidAtPixel(cx, y)) continue;
          }
          const g = this.map.groundBelow(cx, y, 600);
          if (!g) continue;
          const cy = g.y - 8;
          if (this.map.solidAtPixel(cx, cy)) continue;
          const cost = Math.abs(dx) + Math.abs(cy - o.y) * 0.5;
          if (cost < best) { best = cost; bx = cx; by = cy; }
        }
        /* Buried in rock with no groundable neighbor: ungrabbable, would only
           render as an icon on the rock face — skip it (server + solo run the
           same code, so the drop set stays identical everywhere). Air points
           over the void are kept as authored (jetpack-reachable by design). */
        if (best === Infinity && this.map.solidAtPixel(o.x, o.y)) continue;
        this.pickups.push({ x: bx, y: by, list, idx: Math.floor(Math.random() * list.length), respawn: 0 });
      }
    }
    /* Fixed, well-spaced spawn pads: drops sharing one spot (same ground
       below both authored points, or a floating authored row) render as one
       blob. Grounded clashers shove sideways to the nearest groundable
       column; floating (void) clashers shove sideways in air at their
       authored height — deterministic, so server and solo agree pad-for-pad.
       Still clashing (isolated sliver/ledge, void on every side): fuse the
       later pad into the earlier one — a single pad cycling both lists beats
       an icon blob, and every authored item stays grabbable. */
    const grounded = k => {
      const g = this.map.groundBelow(k.x, k.y, 600);
      return g && g.y - k.y <= 40 ? g : null;
    };
    const clashes = (a, b) => Math.abs(a.x - b.x) < 128 && Math.abs(a.y - b.y) < 64;
    const free = (cand, i) => !this.pickups.some((q, j) => j !== i && clashes(cand, q));
    for (let i = 0; i < this.pickups.length; i++) {
      const k = this.pickups[i];
      if (!grounded(k)) continue;
      if (free(k, i)) continue;
      for (const dist of [128, 192, 256, 384, 512, 768]) {
        let done = false;
        for (const nx of [k.x + dist, k.x - dist]) {
          const cx = Math.min(Math.max(nx, 8), this.map.w - 8);
          const g = this.map.groundBelow(cx, k.y - 40, 640);
          if (!g) continue;
          const cand = { x: cx, y: g.y - 8 };
          if (this.map.solidAtPixel(cx, cand.y) || !free(cand, i)) continue;
          k.x = cand.x; k.y = cand.y; done = true;
          break;
        }
        if (done) break;
      }
    }
    for (let i = 0; i < this.pickups.length; i++) {
      const k = this.pickups[i];
      if (grounded(k) || free(k, i)) continue;
      for (const dist of [128, 192, 256, 384, 512, 768]) {
        let done = false;
        for (const nx of [k.x + dist, k.x - dist]) {
          const cx = Math.min(Math.max(nx, 8), this.map.w - 8);
          const cand = { x: cx, y: k.y };
          if (this.map.solidAtPixel(cx, cand.y) || !free(cand, i)) continue;
          k.x = cand.x; done = true;
          break;
        }
        if (done) break;
      }
    }
    for (let i = 0; i < this.pickups.length; i++) {
      for (let j = this.pickups.length - 1; j > i; j--) {
        const a = this.pickups[i], c = this.pickups[j];
        if (!clashes(a, c)) continue;
        a.list = a.list.concat(c.list);
        this.pickups.splice(j, 1);
      }
    }
  }

  /* weapon/nade pickup in grab radius (HUD "press E" prompt; null when none).
     skip(i) lets online clients also honor the authoritative respawn timers. */
  pickupNear(p, skip) {
    for (let i = 0; i < this.pickups.length; i++) {
      const k = this.pickups[i];
      if (k.respawn > 0 || (skip && skip(i))) continue;
      if (Math.abs(p.cx() - k.x) >= 46 || Math.abs(p.cy() - k.y) >= 56) continue;
      const id = k.list[k.idx % k.list.length];
      const w = WEAPONS[id];
      if ((w && !w.item) || (!w && NADES[id])) return { i, id, name: (w && w.name) || String(id).toUpperCase() };
    }
    return null;
  }

  updatePickups(dt) {
    /* E-press edges — computed for every soldier every step (not just near
       pickups) so a held key can't fake a fresh press. Bots have no keyboard:
       they stay on the old auto-grab. */
    for (const p of this.players) {
      const held = p.isBot ? true : !!(p.input && p.input.use);
      p._usePressed = held && !p._usePrev;
      p._usePrev = held;
    }
    for (const k of this.pickups) {
      if (k.respawn > 0) { k.respawn -= dt; continue; }
      for (const p of this.players) {
        if (p.dead || p.ghost) continue;
        if (Math.abs(p.cx() - k.x) < 46 && Math.abs(p.cy() - k.y) < 56) {
          const id = k.list[k.idx % k.list.length];
          const w0 = WEAPONS[id];
          /* inventory changes (guns, nades) need an E press — walking over a
             pad must never swap your weapon mid-fight. Instant items (health,
             fuel, shield) still auto-grab: they disrupt nothing. */
          if (((w0 && !w0.item) || (!w0 && NADES[id])) && !p._usePressed && !p.isBot) continue;
          k.idx = (k.idx + 1) % k.list.length;
          const w = WEAPONS[id];
          if (w) {
            if (w.item === "health") { p.hp = 100; if (p === this.me) this.ev("sfx", { n: "pickup", vol: 0.6 }); }
            else if (w.item === "fuel") { p.fuel = 100; if (p === this.me) this.ev("sfx", { n: "pickup", vol: 0.6 }); }
            else if (w.item === "shield") { p.shieldT = 10; if (p === this.me) this.ev("sfx", { n: "pickup", vol: 0.6 }); }
            else { p.equip(w, true); if (p === this.me) this.ev("sfx", { n: "weps", vol: 0.5 }); }
            k.respawn = w.item ? 12 : 8;
            this.ev("pk", { i: this.pickups.indexOf(k), idx: k.idx, rsp: k.respawn });
            break;
          } else if (NADES[id]) {
            p.nades = Math.min(6, p.nades + 2); if (p === this.me) this.ev("sfx", { n: "grenades", vol: 0.5 });
            k.respawn = 10;
            this.ev("pk", { i: this.pickups.indexOf(k), idx: k.idx, rsp: k.respawn });
            break;
          }
        }
      }
    }
  }

  /* ---------------------------------------------------------- combat helpers */
  raycast(x, y, ang, maxD) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let d = 0; d < maxD; d += 16) {
      const px = x + dx * d, py = y + dy * d;
      if (this.map.solidAtPixel(px, py) || px < 0 || py < 0 || px > this.map.w || py > this.map.h) return { x: px, y: py };
    }
    return { x: x + dx * maxD, y: y + dy * maxD };
  }
  segHitsRect(x0, y0, x1, y1, r) {
    const steps = Math.max(2, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 12));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = lerp(x0, x1, t), y = lerp(y0, y1, t);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
    }
    return false;
  }
  segHitsSolid(x0, y0, x1, y1) {
    const steps = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 32);
    for (let i = 1; i <= steps; i++) { const t = i / steps; if (this.map.solidAtPixel(lerp(x0, x1, t), lerp(y0, y1, t))) return true; }
    return false;
  }

  explode(x, y, def, owner) {
    this.ev("boom", { x: Math.round(x), y: Math.round(y), r: def.splash });
    this.ev("sfx", { n: "explode", vol: 0.8, rate: rnd(0.9, 1.1) });
    for (const p of this.players) {
      if (p.dead) continue;
      const d = Math.hypot(p.cx() - x, p.cy() - y);
      if (d < def.splash) {
        let dmg = def.dmg * (1 - d / def.splash);
        if (p === owner) dmg *= 0.45;
        if (dmg > 1) {
          p.damage(dmg, owner);
          const dx = p.cx() - x, dy = p.cy() - y, inv = d > 0.001 ? 1 / d : 0; /* d==0 must not NaN-poison physics */
          p.vx += dx * inv * 420; p.vy += dy * inv * 420 - 120;
        }
      }
    }
    for (let i = 0; i < 10; i++) this.ev("spark", { x: x + rnd(-40, 40), y: y + rnd(-40, 40), n: 2 });
  }

  /* ---------------------------------------------------------- world update */
  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) { this.bullets.splice(i, 1); continue; }
      const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / 20));
      let hit = false;
      for (let s = 0; s < steps && !hit; s++) {
        b.x += b.vx * dt / steps; b.y += b.vy * dt / steps;
        if (b.arc) b.vy += 900 * dt / steps;
        if (this.map.solidAtPixel(b.x, b.y)) {
          if (b.rocket) { if (!b.ghost) this.explode(b.x, b.y, { splash: b.splash, dmg: b.dmg }, b.owner); }
          else if (!b.flame) { this.ev("spark", { x: b.x, y: b.y, n: 2 }); if (Math.random() < 0.3) this.ev("sfx", { n: "ricochet", vol: 0.15 }); }
          hit = true; break;
        }
        if (b.ghost) continue; /* visual-only bullets never damage */
        for (const p of this.players) {
          if (p === b.owner || p.dead || p.invuln > 0 || p.ghost) continue;
          if (b.x > p.x && b.x < p.x + p.w && b.y > p.y && b.y < p.y + p.h) {
            if (b.rocket) this.explode(b.x, b.y, { splash: b.splash, dmg: b.dmg }, b.owner);
            else p.damage(b.dmg, b.owner);
            hit = true; break;
          }
        }
      }
      if (hit) this.bullets.splice(i, 1);
    }
  }

  updateNades(dt) {
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.t += dt;
      if (n.body) {
        /* physical nade: legacy gravity, matter resolves the bounces */
        n.vy = clamp(n.vy + 1300 * dt, -1800, 1800);
        Matter.Body.setVelocity(n.body, { x: n.vx * dt, y: n.vy * dt });
        n.x = n.body.position.x; n.y = n.body.position.y;
      } else {
        /* ghost nade (visual only, prediction): legacy integration */
        n.vy += 1300 * dt;
        const steps = Math.max(1, Math.ceil(Math.hypot(n.vx, n.vy) * dt / 16));
        for (let s = 0; s < steps; s++) {
          const nx = n.x + n.vx * dt / steps, ny = n.y + n.vy * dt / steps;
          if (this.map.solidAtPixel(nx, n.y)) n.vx *= -0.45; else n.x = nx;
          if (this.map.solidAtPixel(n.x, ny)) n.vy *= -0.45; else n.y = ny;
        }
      }
      const prox = !n.ghost && n.def.proxy && n.t > 0.8 && this.players.some(p => p !== n.owner && !p.dead && !p.ghost && Math.hypot(p.cx() - n.x, p.cy() - n.y) < n.def.proxy);
      if (n.t >= (n.fuse || 2) || prox) {
        if (!n.ghost) {
          if (n.body && this.engine) Matter.Composite.remove(this.engine.world, n.body);
          this.explode(n.x, n.y, { splash: n.def.splash, dmg: n.def.dmg }, n.owner);
        }
        this.nades.splice(i, 1);
      }
    }
  }

  /* one fixed-cadence sim step. dt MUST be pre-clamped by the caller
     (AGENT.md golden rule #1: clamp((t-last)/1000 || .016, .001, .033)) */
  step(dt) {
    this.time += dt;
    for (const p of this.players) p.update(dt);
    this.updateNades(dt);                 /* hands matter this frame's nade velocities */
    Matter.Engine.update(this.engine, 1000 / 60);
    for (const p of this.players) p.postPhysics();
    for (const n of this.nades) if (n.body) {   /* capture bounce results (px per 1/60s step) */
      n.x = n.body.position.x; n.y = n.body.position.y;
      n.vx = n.body.velocity.x * 60; n.vy = n.body.velocity.y * 60;
    }
    this.updateBullets(dt);
    this.updatePickups(dt);
    for (let i = this.beams.length - 1; i >= 0; i--) { this.beams[i].t -= dt; if (this.beams[i].t <= 0) this.beams.splice(i, 1); }
  }
}
