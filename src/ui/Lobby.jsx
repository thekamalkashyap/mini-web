/* Lobby — map picker + solo/online launch. */
import React, { useState } from "react";
import { MAPS } from "../../shared/constants.js";
import { useStore } from "../store.js";
import { ClientNet } from "../net/ClientNet.js";

export default function Lobby() {
  const [map, setMap] = useState("1outpost");
  const [name, setName] = useState("player");
  const [bots, setBots] = useState(false);
  const [serverUrl, setServerUrl] = useState(localStorage.getItem("mm:server") || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const startGame = useStore(s => s.actions.startGame);
  const setConn = useStore(s => s.actions.setConn);

  const solo = () => startGame({ mode: "solo", map, bots, startKey: Date.now() });

  const online = async () => {
    setBusy(true); setErr("");
    try {
      const net = new ClientNet(serverUrl || undefined);
      setConn("connecting…");
      await net.join(map, name || "player");
      localStorage.setItem("mm:server", serverUrl);
      startGame({ mode: "online", map, net, startKey: Date.now() });
    } catch (e) {
      setErr("cannot reach server: " + (e.message || e));
      setConn("");
      setBusy(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, overflowY: "auto", padding: "24px",
      background: "linear-gradient(180deg, #16202e 0%, #0d1420 100%)",
      fontFamily: "Trebuchet MS, Verdana, sans-serif", color: "#cfe2f3",
    }}>
      <h1 style={{ letterSpacing: 2, fontSize: 26, color: "#ffd76e", marginBottom: 4 }}>MINI MILITIA <span style={{ color: "#7ec3f0" }}>WEB</span></h1>
      <div style={{ fontSize: 11, color: "#5f7188", marginBottom: 18 }}>react · vite · phaser · colyseus — personal/educational port, do not redistribute</div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 420px", maxWidth: 640 }}>
          <div style={{ fontSize: 12, color: "#9fb4c8", margin: "10px 0 6px" }}>MAP — {MAPS.find(m => m[0] === map)?.[1]}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(128px, 1fr))", gap: 6 }}>
            {MAPS.map(([id, label]) => (
              <button key={id} onClick={() => setMap(id)} style={{
                padding: "10px 8px", borderRadius: 6, border: id === map ? "2px solid #ffd76e" : "1px solid #2a3950",
                background: id === map ? "#22344e" : "#16202e", color: id === map ? "#ffd76e" : "#cfe2f3",
                fontSize: 11, cursor: "pointer", textAlign: "left",
              }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{ width: 280, display: "flex", flexDirection: "column", gap: 10, background: "#121c2a", border: "1px solid #2a3950", borderRadius: 8, padding: 16 }}>
          <label style={{ fontSize: 11, color: "#9fb4c8" }}>CALLSIGN
            <input value={name} onChange={e => setName(e.target.value.slice(0, 14))} style={{
              width: "100%", marginTop: 4, padding: 8, borderRadius: 6, border: "1px solid #2a3950", background: "#0d1420", color: "#e8f0f8",
            }} />
          </label>

          <button onClick={solo} style={{
            padding: 12, borderRadius: 6, border: "none", background: "#2e9e57", color: "#08130c",
            fontWeight: "bold", fontSize: 14, cursor: "pointer",
          }}>SOLO PRACTICE</button>

          <label style={{ fontSize: 11, color: "#9fb4c8", display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={bots} onChange={e => setBots(e.target.checked)} /> spawn practice bots
          </label>

          <div style={{ borderTop: "1px solid #2a3950", margin: "4px 0" }} />
          <label style={{ fontSize: 11, color: "#9fb4c8" }}>SERVER (colyseus ws://host:port)
            <input value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="ws://localhost:2567" style={{
              width: "100%", marginTop: 4, padding: 8, borderRadius: 6, border: "1px solid #2a3950", background: "#0d1420", color: "#e8f0f8",
            }} />
          </label>
          <button disabled={busy} onClick={online} style={{
            padding: 12, borderRadius: 6, border: "none", background: busy ? "#39516e" : "#2e7ee0", color: "#eaf4ff",
            fontWeight: "bold", fontSize: 14, cursor: busy ? "wait" : "pointer",
          }}>{busy ? "CONNECTING…" : "PLAY ONLINE"}</button>
          {err && <div style={{ color: "#e74c3c", fontSize: 11 }}>{err}</div>}

          <div style={{ fontSize: 10, color: "#5f7188", lineHeight: 1.6 }}>
            WASD move · W jetpack · mouse aim · LMB fire<br />
            G nade · R reload · RMB scope · M mute · ` colliders
          </div>
        </div>
      </div>
    </div>
  );
}
