/* Mini Militia Web — Colyseus game server (authoritative).
   Run: npm run server   (default port 2567, override with PORT) */
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MMRoom } from "./rooms/MMRoom.js";

const PORT = parseInt(process.env.PORT || "2567", 10);

const gameServer = new Server({
  transport: new WebSocketTransport({}),
});

gameServer.define("mm", MMRoom);

gameServer.onShutdown(() => console.log("game server shut down"));

gameServer.listen(PORT).then(() => {
  console.log(`mm-web colyseus server listening on ws://0.0.0.0:${PORT}`);
}, err => {
  console.error("failed to listen:", err);
  process.exit(1);
});
