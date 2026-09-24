/* MMRoom — the authoritative game room. The shared WorldSim runs inside
   setSimulationInterval (60 Hz); schema patches go out at 20 Hz; transient
   world events (fire/boom/death/pk/...) are batched per tick into one "evs"
   message that clients turn into fx/sfx — the exact event vocabulary the
   legacy guests already spoke. */
import { Room } from "@colyseus/core";
import { GameState, PlayerState, PickupState } from "./schema.js";
import { loadMapBundle } from "../assets.js";
import { WorldSim } from "../../shared/sim.js";
import { skinFor } from "../../shared/constants.js";
import { inputUnpack } from "../../shared/input.js";

const TICK = 1000 / 60;
const PATCH = 50;          /* 20 Hz state sync */

export class MMRoom extends Room {
  maxClients = 8;

  onCreate(opts) {
    const mapName = String(opts.map || "1outpost").replace(/[^a-zA-Z0-9]/g, "");
    const bundle = loadMapBundle(mapName);
    this.mapName = mapName;
    this.sim = new WorldSim({
      mapJson: bundle.mapJson, maskData: bundle.maskData,
      frameSize: bundle.frameSize, mode: "server",
    });
    this.sim.me = null;   /* no local player: every soldier is a session */

    this.setState(new GameState());
    this.state.mapName = mapName;
    for (const p of this.sim.pickups) {
      const ps = new PickupState(); ps.idx = p.idx; ps.respawn = p.respawn;
      this.state.pickups.push(ps);
    }

    this.onMessage("inp", (client, d) => {
      const p = this.sim.getPlayer(client.sessionId);
      if (p) p.input = inputUnpack(d || {});
    });
    this.onMessage("nade", (client) => {
      const p = this.sim.getPlayer(client.sessionId);
      if (p) p.throwNade();
    });
    this.onMessage("reload", (client) => {
      const p = this.sim.getPlayer(client.sessionId);
      if (p) p.reload();
    });
    /* e2e-only teleport (MM_DEBUG=1): deterministic kill geometry for
       room_test — never enabled in production. */
    if (process.env.MM_DEBUG) {
      this.onMessage("dbgTeleport", (client, d) => {
        const p = this.sim.getPlayer(client.sessionId);
        if (!p || !d) return;
        const x = Number(d.x), y = Number(d.y);
        if (!Number.isFinite(x + y)) return;
        p.x = Math.min(Math.max(x, 0), this.sim.map.w - p.w);
        p.y = Math.min(Math.max(y, 0), this.sim.map.h - p.h);
        p.vx = 0; p.vy = 0;
        p.ensureBody(true);
      });
    }

    this._last = Date.now();
    this.setPatchRate(PATCH);
    this.setSimulationInterval(() => this.tick(), TICK);
    console.log(`[room ${this.roomId}] created on ${mapName} (${this.sim.map.w}x${this.sim.map.h})`);
  }

  tick() {
    /* AGENT.md golden rule #1 — never trust raw timestamps for dt */
    const now = Date.now();
    const dt = Math.min(Math.max(((now - this._last) / 1000) || 0.016, 0.001), 0.033);
    this._last = now;

    this.sim.step(dt);
    this.state.time = this.sim.time;

    /* sync soldiers */
    for (const p of this.sim.players) {
      let s = this.state.players.get(p.id);
      if (!s) { s = new PlayerState(); s.name = p.name; this.state.players.set(p.id, s); }
      s.x = p.x; s.y = p.y; s.aim = p.aim; s.hp = p.hp; s.dead = p.dead;
      s.wep = p.weaponId; s.ammo = p.ammo; s.fuel = p.fuel; s.facing = p.facing;
      s.nades = p.nades; s.kills = p.kills; s.walkT = p.walkT;
      s.reloading = p.reloading; s.invuln = p.invuln; s.shield = p.shieldT;
      s.jet = p.jetOn;
    }

    /* sync pickups */
    for (let i = 0; i < this.sim.pickups.length && i < this.state.pickups.length; i++) {
      this.state.pickups[i].idx = this.sim.pickups[i].idx;
      this.state.pickups[i].respawn = this.sim.pickups[i].respawn;
    }

    /* batch transient events for everyone */
    const evs = this.sim.drainEvents();
    if (evs.length) this.broadcast("evs", evs);
  }

  onJoin(client, opts) {
    const name = String((opts && opts.name) || "player").slice(0, 14).replace(/[<>]/g, "");
    const p = this.sim.addPlayer({ id: client.sessionId, name, skin: skinFor(client.sessionId) });
    p.input = { left: false, right: false, jet: false, fire: false };
    console.log(`[room ${this.roomId}] + ${name} (${client.sessionId.slice(0, 8)})`);
  }

  onLeave(client) {
    this.sim.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
    console.log(`[room ${this.roomId}] - ${client.sessionId.slice(0, 8)}`);
  }

  onDispose() {
    console.log(`[room ${this.roomId}] disposed`);
  }
}
