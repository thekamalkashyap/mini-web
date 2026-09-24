/* WebSocket client layer + tiny snapshot serializer for the mmc-web relay */
class Net {
  constructor() {
    this.ws = null;
    this.id = 0;
    this.hostId = 0;
    this.isHost = false;
    this.guest = false;           // true when connected and not host
    this.connected = false;
    this.onC2C = null;            // (fromId, data) => void
    this.onPeerJoin = null;       // ({id, name, host}) => void
    this.onPeerLeave = null;      // ({id, host}) => void
    this._onWelcome = null;
  }

  connect(url, room, name) {
    return new Promise((res, rej) => {
      let opened = false;
      try { this.ws = new WebSocket(url); } catch (e) { return rej(e); }
      const kill = msg => { try { this.ws.close(); } catch (e) {} rej(new Error(msg)); };
      this.ws.onopen = () => {
        opened = true;
        this.ws.send(JSON.stringify({ t: "join", room, name }));
      };
      this.ws.onerror = () => kill(opened ? "connection error" : "cannot reach server");
      this.ws.onclose = () => { if (!this.connected) kill("connection closed"); else this.connected = false; };
      this.ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === "welcome") {
          this.id = m.id; this.hostId = m.host; this.isHost = m.host === m.id;
          this.guest = !this.isHost;
          this.connected = true;
          this._onWelcome = m;
          res(m);
        } else if (m.t === "c2c") { this.onC2C && this.onC2C(m.from, m.d); }
        else if (m.t === "pjoin") { this.onPeerJoin && this.onPeerJoin(m); }
        else if (m.t === "pleave") { this.onPeerLeave && this.onPeerLeave(m); }
      };
      setTimeout(() => { if (!this.connected) kill("join timeout"); }, 6000);
    });
  }

  send(d, to) { if (this.connected) this.ws.send(JSON.stringify({ t: "c2c", d, to })); }
  close() { this.connected = false; try { this.ws && this.ws.close(); } catch (e) {} }
}

/* ---- snapshot codec (host -> guests, 20 Hz) ----
   row: [id, x, y, aim, hp, dead, weaponId, ammo, fuel, facing] */
function snapPack(players) {
  return players.map(p => [
    Math.round(p.id), Math.round(p.x), Math.round(p.y),
    +p.aim.toFixed(2), Math.round(p.hp), p.dead ? 1 : 0,
    p.weaponId || "m61", p.ammo | 0, Math.round(p.fuel), p.facing,
  ]);
}
function snapUnpack(rows) {
  return rows.map(r => ({ id: r[0], x: r[1], y: r[2], aim: r[3], hp: r[4], dead: !!r[5], wep: r[6], ammo: r[7], fuel: r[8], facing: r[9] }));
}

/* input packet (guest -> host, 30 Hz) */
function inputPack(i) {
  return { t: "inp", l: i.left ? 1 : 0, r: i.right ? 1 : 0, j: i.jet ? 1 : 0, f: i.fire ? 1 : 0, x: Math.round(i.aimX || 0), y: Math.round(i.aimY || 0) };
}
function inputUnpack(d) {
  return { left: !!d.l, right: !!d.r, jet: !!d.j, fire: !!d.f, aimX: d.x, aimY: d.y };
}
