/* Mini Militia Web — single-service entry: Express serves the built client
   (dist/) while Colyseus handles WS upgrades + /matchmake/* on the same
   $PORT. No SPA fallback needed — every link is / or /?room=..., both
   answered by index.html.
   Run: npm run server   (default port 2567, Cloud Run injects 8080) */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MMRoom } from "./rooms/MMRoom.js";

const PORT = parseInt(process.env.PORT || "2567", 10);
const here = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.static(path.join(here, "..", "dist")));

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("mm", MMRoom);
/* invite-only room: reachable via create/joinById, never via "mm" quick-play */
gameServer.define("party", MMRoom);

gameServer.onShutdown(() => console.log("game server shut down"));

gameServer.listen(PORT).then(() => {
  console.log(`mm-web listening on http://0.0.0.0:${PORT} (client + colyseus)`);
}, err => {
  console.error("failed to listen:", err);
  process.exit(1);
});
