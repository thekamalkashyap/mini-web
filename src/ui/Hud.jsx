/* Hud — React overlay: health/fuel/ammo, kill strip, death screen, colliders
   legend. State flows from WorldScene via the zustand store at ~10 Hz. */
import React from "react";
import { useStore } from "../store.js";

const LEGEND = [["#3cdc78", "terrain"], ["#ff3b30", "surface"], ["#c85ae6", "boundary"], ["#ff8c28", "soldier"], ["#ffd732", "nade"]];

export default function Hud() {
  const hud = useStore(s => s.hud);
  const toastMsg = useStore(s => s.toastMsg);
  const exitGame = useStore(s => s.actions.exitGame);
  if (!hud) return null;
  const {
    hp, fuel, ammo, mag, reloading, weaponName, nades, kills, dead, deadT,
    mapLabel, mode, players, showColliders, muted, connected, pickupName,
  } = hud;

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", fontFamily: "Trebuchet MS, Verdana, sans-serif", userSelect: "none" }}>
      {/* health / fuel */}
      <div style={{ position: "absolute", left: 16, top: 16, background: "rgba(0,0,0,.63)", borderRadius: 6, padding: "6px 12px 8px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 180, height: 12, background: "#222e3d", borderRadius: 2 }}>
            <div style={{ width: 180 * Math.max(0, Math.min(100, hp)) / 100 + "px", height: "100%", background: hp > 35 ? "#6fdc7a" : "#e74c3c", borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 10, color: "#cfe2f3" }}>HEALTH</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{ width: 180, height: 10, background: "#222e3d", borderRadius: 2 }}>
            <div style={{ width: 180 * Math.max(0, Math.min(100, fuel)) / 100 + "px", height: "100%", background: "#7ec3f0", borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 10, color: "#cfe2f3" }}>FUEL</span>
        </div>
      </div>

      {/* weapon */}
      <div style={{ position: "absolute", left: 16, top: 68, background: "rgba(0,0,0,.63)", borderRadius: 6, padding: "6px 12px", minWidth: 208 }}>
        <div style={{ fontSize: 12, fontWeight: "bold", color: "#e8f0f8" }}>{weaponName}</div>
        <div style={{ fontSize: 19, fontWeight: "bold", color: ammo === 0 ? "#e74c3c" : "#ffd76e" }}>
          {reloading > 0 ? "RELOADING" : (mag === 0 ? "∞" : `${ammo}/${mag}`)}
        </div>
        <div style={{ fontSize: 10, color: "#9fb4c8" }}>✦ {nades} grenades</div>
      </div>

      {/* top strip */}
      <div style={{
        position: "absolute", left: "50%", top: 12, transform: "translateX(-50%)",
        background: "rgba(0,0,0,.63)", borderRadius: 6, padding: "5px 16px",
        fontSize: 12, fontWeight: "bold", color: "#ffd76e", letterSpacing: 1,
      }}>
        YOU {kills} · {String(mapLabel || "").toUpperCase()} · {mode === "online" ? `PLAYERS ${players}` : "SOLO"}
        {mode === "online" && !connected && <span style={{ color: "#e74c3c" }}> · CONNECTION LOST</span>}
      </div>

      {/* help + legend */}
      <div style={{ position: "absolute", right: 14, bottom: 12, fontSize: 10, color: "#5f7188", textAlign: "right" }}>
        WASD move · W jetpack · mouse aim · LMB fire · E pickup · G nade · R reload · RMB scope · M mute{muted ? " (muted)" : ""}
      </div>

      {pickupName && !dead && (
        <div style={{ position: "absolute", left: "50%", bottom: 108, transform: "translateX(-50%)", background: "rgba(0,0,0,.63)", borderRadius: 6, padding: "6px 16px", fontSize: 13, fontWeight: "bold", color: "#e8f0f8" }}>
          Press <span style={{ color: "#ffd76e" }}>E</span> — {pickupName}
        </div>
      )}
      {showColliders && (
        <div style={{ position: "absolute", left: 16, bottom: 14, display: "flex", gap: 14 }}>
          {LEGEND.map(([c, l]) => (
            <span key={l} style={{ fontSize: 10, color: "#cfe2f3" }}>
              <span style={{ display: "inline-block", width: 8, height: 8, background: c, marginRight: 4 }} />{l}
            </span>
          ))}
        </div>
      )}

      {toastMsg && (
        <div style={{ position: "absolute", left: "50%", bottom: 64, transform: "translateX(-50%)", background: "rgba(0,0,0,.6)", color: "#cfe2f3", fontSize: 11, padding: "4px 12px", borderRadius: 6 }}>
          {toastMsg}
        </div>
      )}

      {dead && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(8,10,16,.55)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ color: "#e74c3c", fontSize: 34, fontWeight: "bold" }}>YOU DIED</div>
          <div style={{ color: "#cfe2f3", fontSize: 14, marginTop: 8 }}>respawning in {Math.max(0, deadT).toFixed(1)}s</div>
          <button onClick={exitGame} style={{ pointerEvents: "auto", marginTop: 24, padding: "8px 20px", borderRadius: 6, background: "#39516e", border: "none", color: "#e8f0f8", cursor: "pointer" }}>EXIT TO LOBBY</button>
        </div>
      )}
    </div>
  );
}
