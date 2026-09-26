/* MMRoom — the authoritative game room. The shared WorldSim runs inside
   setSimulationInterval (60 Hz); schema patches go out at 20 Hz; transient
   world events (fire/boom/death/pk/...) are batched per tick into one "evs"
   message that clients turn into fx/sfx — the exact event vocabulary the
   legacy guests already spoke. */
import { Room } from "@colyseus/core";
import { GameState, PickupState } from "./schema.js";
import { loadMapBundle } from "../assets.js";
import { WorldSim } from "../../shared/sim.js";
import { skinFor } from "../../shared/avatar.js";
import { clampDt } from "../../shared/utils/math.js";
import { NET } from "../../shared/config/tuning.js";
import { registerMessages } from "./messages.js";
import { syncState } from "./sync.js";

export class MMRoom extends Room {
  maxClients = 8;

  onCreate(opts) {
    const mapName = String(opts.map || "1outpost").replace(/[^a-zA-Z0-9]/g, "");
    const bundle = loadMapBundle(mapName);
    this.mapName = mapName;
    this.sim = new WorldSim({
      mapJson: bundle.mapJson,
      maskData: bundle.maskData,
      frameSize: bundle.frameSize,
      mode: "server",
    });
    this.sim.me = null; /* no local player: every soldier is a session */

    this.setState(new GameState());
    this.state.mapName = mapName;
    for (const p of this.sim.pickups) {
      const ps = new PickupState();
      ps.idx = p.idx;
      ps.respawn = p.respawn;
      this.state.pickups.push(ps);
    }

    registerMessages(this);

    this._last = Date.now();
    this.setPatchRate(NET.PATCH_MS);
    this.setSimulationInterval(() => this.tick(), NET.TICK_MS);
    console.log(
      `[room ${this.roomId}] created on ${mapName} (${this.sim.map.w}x${this.sim.map.h})`,
    );
  }

  tick() {
    /* AGENT.md golden rule #1 — never trust raw timestamps for dt */
    const now = Date.now();
    const dt = clampDt((now - this._last) / 1000);
    this._last = now;

    this.sim.step(dt);
    syncState(this);
  }

  onJoin(client, opts) {
    const name = String((opts && opts.name) || "player")
      .slice(0, 14)
      .replace(/[<>]/g, "");
    const p = this.sim.addPlayer({
      id: client.sessionId,
      name,
      skin: skinFor(client.sessionId),
    });
    /* neutral input with NO aim: physics keeps the spawn aim until the
       client's first real input arrives (an aimX of 0 would snap it) */
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
