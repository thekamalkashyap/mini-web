/* ClientNet — colyseus.js glue. Owns the room connection; the scene polls it
   for remote view targets and prediction corrections. */
import { Client } from "colyseus.js";
import { inputPack } from "../../shared/input.js";

export class ClientNet {
  constructor(url) {
    this.client = new Client(url || (location.protocol === "https:" ? "wss://" : "ws://") + location.hostname + ":2567");
    this.room = null;
    this.events = [];
    this.connected = false;
    this.onStatus = null;
  }

  async join(map, name) {
    this.room = await this.client.joinOrCreate("mm", { map, name });
    this.connected = true;
    this.room.onLeave(() => { this.connected = false; this.onStatus && this.onStatus("disconnected"); });
    this.room.onError((code, msg) => { this.onStatus && this.onStatus("error " + code + " " + msg); });
    this.room.onMessage("evs", evs => { for (const e of evs) this.events.push(e); });
    return this.room;
  }

  sendInput(inp) { if (this.room && this.connected) this.room.send("inp", inputPack(inp)); }
  sendNade() { if (this.room && this.connected) this.room.send("nade"); }
  sendReload() { if (this.room && this.connected) this.room.send("reload"); }
  leave() { try { this.room && this.room.leave(); } catch (e) {} this.connected = false; }
}
