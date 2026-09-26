/* ClientNet — colyseus.js glue. Owns the room connection; the scene polls it
   for remote view targets and prediction corrections. */
import { Client } from "colyseus.js";
import { inputPack } from "../../shared/input.js";

/* Prod serves client + server from one origin, so default to it. Under vite
   dev the game server still runs separately on :2567 (overridable via the
   lobby SERVER field either way). */
const defaultUrl = () =>
  import.meta.env.DEV
    ? (location.protocol === "https:" ? "wss://" : "ws://") + location.hostname + ":2567"
    : location.origin.replace(/^http/, "ws");

export class ClientNet {
  constructor(url) {
    this.client = new Client(url || defaultUrl());
    this.room = null;
    this.events = [];
    this.connected = false;
    this.onStatus = null;
  }

  async join(map, name) {
    this.room = await this.client.joinOrCreate("mm", { map, name });
    return this.watch();
  }

  /* invite-only party room: the roomId is the shareable secret */
  async createParty(map, name) {
    this.room = await this.client.create("party", { map, name });
    return this.watch();
  }

  async joinParty(roomId, name) {
    this.room = await this.client.joinById(roomId, { name });
    return this.watch();
  }

  watch() {
    this.connected = true;
    this.room.onLeave(() => { this.connected = false; this.onStatus && this.onStatus("disconnected"); });
    this.room.onError((code, msg) => { this.onStatus && this.onStatus("error " + code + " " + msg); });
    this.room.onMessage("evs", evs => { for (const e of evs) this.events.push(e); });
    return this.room;
  }

  /* take+clear queued "evs" events (one drain per frame) */
  drainEvents() { const e = this.events; this.events = []; return e; }

  sendInput(inp) { if (this.room && this.connected) this.room.send("inp", inputPack(inp)); }
  sendNade() { if (this.room && this.connected) this.room.send("nade"); }
  sendReload() { if (this.room && this.connected) this.room.send("reload"); }
  leave() { try { this.room && this.room.leave(); } catch (e) {} this.connected = false; }
}
