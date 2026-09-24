/* Mini Militia Web — relay server.
   Rooms keyed by map name. First client = host (simulates the match and
   broadcasts snapshots); others are guests. Server only relays + manages
   membership/host promotion.
   Run: node server.js [port]  (default 8090; auto-falls forward if busy) */
const http = require("http");
const { WebSocketServer } = require("ws");

const BASE_PORT = parseInt(process.argv[2] || process.env.PORT || "8090", 10);
let PORT = BASE_PORT;

/** @type {Map<string, {clients:Map<number,{ws:any,name:string}>, hostId:number|null}>} */
const rooms = new Map();
let nextId = 1;

const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const roomSummary = room => [...room.clients.entries()].map(([id, c]) => ({ id, name: c.name, host: id === room.hostId }));

const httpServer = http.createServer((req, res) => {
  res.writeHead(426, { "Content-Type": "text/plain" });
  res.end("WebSocket relay — connect with ws://host:port\n");
});
const wss = new WebSocketServer({ noServer: true });
httpServer.on("upgrade", (req, socket, head) =>
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req)));

/* auto-fall-forward if the port is taken (e.g. a stray instance) */
let retries = 0;
httpServer.on("error", err => {
  if (err.code === "EADDRINUSE" && retries++ < 10) {
    console.log(`port ${PORT} busy, trying ${PORT + 1}...`);
    PORT++;
    httpServer.listen(PORT);
  } else if (err.code === "EADDRINUSE") {
    console.error(`ports ${BASE_PORT}-${PORT} all in use — free one or run: node server.js <port>`);
    process.exit(1);
  } else { throw err; }
});
httpServer.on("listening", () => console.log(`mmc-web relay listening on ws://0.0.0.0:${PORT}`));
httpServer.listen(PORT);

wss.on("connection", (ws, req) => {
  let id = 0, room = null, roomName = null, name = "";

  ws.on("message", (data) => {
    let m; try { m = JSON.parse(data); } catch { return; }

    if (m.t === "join") {
      if (room) return; // already joined
      id = nextId++;
      name = String(m.name || "player").slice(0, 14).replace(/[<>]/g, "");
      roomName = String(m.room || "1outpost").replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);
      if (!rooms.has(roomName)) rooms.set(roomName, { clients: new Map(), hostId: null });
      room = rooms.get(roomName);
      room.clients.set(id, { ws, name });
      if (room.hostId == null) room.hostId = id;
      send(ws, { t: "welcome", id, room: roomName, host: room.hostId, players: roomSummary(room) });
      for (const [oid, c] of room.clients)
        if (oid !== id) send(c.ws, { t: "pjoin", id, name, host: id === room.hostId });
      console.log(`[+${roomName}] ${name}#${id} (${room.clients.size} online, host=${room.hostId}) from ${req.socket.remoteAddress}`);
      return;
    }

    if (m.t === "c2c" && room) {
      const payload = JSON.stringify({ t: "c2c", from: id, d: m.d });
      for (const [oid, c] of room.clients) {
        if (oid === id) continue;
        if (m.to != null && oid !== m.to) continue;
        if (c.ws.readyState === 1) c.ws.send(payload);
      }
    }
  });

  const cleanup = () => {
    if (!room) return;
    room.clients.delete(id);
    if (room.clients.size === 0) { rooms.delete(roomName); console.log(`[-${roomName}] empty, closed`); return; }
    let promoted = false;
    if (room.hostId === id) { room.hostId = [...room.clients.keys()][0]; promoted = true; }
    for (const [, c] of room.clients)
      send(c.ws, { t: "pleave", id, host: room.hostId, promoted });
    console.log(`[-${roomName}] ${name}#${id} left${promoted ? `, host promoted to ${room.hostId}` : ""}`);
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
});
