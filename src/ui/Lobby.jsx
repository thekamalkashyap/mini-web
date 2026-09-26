/* Lobby — map picker + solo/online launch. */
import React, { useState } from "react";
import { useStore } from "../store.js";
import { ClientNet } from "../net/ClientNet.js";
import { parsePartySearch } from "../partyLink.js";
import { COLORS, FONT } from "./styles.js";
import MapPicker from "./lobby/MapPicker.jsx";
import LaunchPanel from "./lobby/LaunchPanel.jsx";

export default function Lobby() {
  const [map, setMap] = useState("1outpost");
  const [name, setName] = useState("player");
  const [bots, setBots] = useState(false);
  const [serverUrl, setServerUrl] = useState(
    localStorage.getItem("mm:server") || "",
  );
  const [code, setCode] = useState(() => parsePartySearch(location.search) || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const startGame = useStore((s) => s.actions.startGame);
  const setConn = useStore((s) => s.actions.setConn);

  const solo = () => startGame({ mode: "solo", map, bots, startKey: Date.now() });

  /* the server's map wins: state.mapName is set at room creation, so a guest
     whose picker disagrees still boots the room's map (art matches sim) */
  const bootMap = (net, picked) => (net.room.state.mapName || picked);

  const online = async () => {
    setBusy(true);
    setErr("");
    try {
      const net = new ClientNet(serverUrl || undefined);
      setConn("connecting…");
      await net.join(map, name || "player");
      localStorage.setItem("mm:server", serverUrl);
      startGame({ mode: "online", map: bootMap(net, map), net, startKey: Date.now() });
    } catch (e) {
      setErr("cannot reach server: " + (e.message || e));
      setConn("");
      setBusy(false);
    }
  };

  const createParty = async () => {
    setBusy(true);
    setErr("");
    try {
      const net = new ClientNet(serverUrl || undefined);
      setConn("creating party…");
      await net.createParty(map, name || "player");
      localStorage.setItem("mm:server", serverUrl);
      startGame({ mode: "online", map: bootMap(net, map), net, startKey: Date.now() });
    } catch (e) {
      setErr("cannot reach server: " + (e.message || e));
      setConn("");
      setBusy(false);
    }
  };

  const joinParty = async () => {
    const roomId = code.trim();
    if (!roomId) { setErr("paste a room code first"); return; }
    setBusy(true);
    setErr("");
    try {
      const net = new ClientNet(serverUrl || undefined);
      setConn("joining party…");
      await net.joinParty(roomId, name || "player");
      localStorage.setItem("mm:server", serverUrl);
      startGame({ mode: "online", map: bootMap(net, map), net, startKey: Date.now() });
    } catch (e) {
      setErr(/not found/i.test(e.message || "") ? "room expired or invalid code" : "cannot reach server: " + (e.message || e));
      setConn("");
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflowY: "auto",
        padding: "24px",
        background: "linear-gradient(180deg, #16202e 0%, #0d1420 100%)",
        fontFamily: FONT,
        color: COLORS.text,
      }}
    >
      <h1
        style={{
          letterSpacing: 2,
          fontSize: 26,
          color: COLORS.accent,
          marginBottom: 4,
        }}
      >
        MINI MILITIA <span style={{ color: COLORS.blue }}>WEB</span>
      </h1>
      <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 18 }}>
        react · vite · phaser · colyseus — personal/educational port, do not
        redistribute
      </div>

      <div
        style={{
          display: "flex",
          gap: 18,
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        <MapPicker map={map} onPick={setMap} />
        <LaunchPanel
          name={name}
          onName={setName}
          bots={bots}
          onBots={setBots}
          serverUrl={serverUrl}
          onServerUrl={setServerUrl}
          code={code}
          onCode={setCode}
          busy={busy}
          err={err}
          onSolo={solo}
          onOnline={online}
          onCreateParty={createParty}
          onJoinParty={joinParty}
        />
      </div>
    </div>
  );
}
