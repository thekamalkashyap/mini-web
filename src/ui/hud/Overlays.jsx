import React from "react";
import { COLORS, panel } from "../styles.js";

export function PickupPrompt({ pickupName, dead }) {
  if (!pickupName || dead) return null;
  return (
    <div
      style={{
        ...panel,
        position: "absolute",
        left: "50%",
        bottom: 108,
        transform: "translateX(-50%)",
        padding: "6px 16px",
        fontSize: 13,
        fontWeight: "bold",
        color: COLORS.bright,
      }}
    >
      Press <span style={{ color: COLORS.accent }}>E</span> — {pickupName}
    </div>
  );
}

const LEGEND = [
  ["#3cdc78", "terrain"],
  ["#ff3b30", "surface"],
  ["#c85ae6", "boundary"],
  ["#ff8c28", "soldier"],
  ["#ffd732", "nade"],
  ["#28d8ff", "gun axis"],
];

export function ColliderLegend({ show }) {
  if (!show) return null;
  return (
    <div
      style={{ position: "absolute", left: 16, bottom: 14, display: "flex", gap: 14 }}
    >
      {LEGEND.map(([c, l]) => (
        <span key={l} style={{ fontSize: 10, color: COLORS.text }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              background: c,
              marginRight: 4,
            }}
          />
          {l}
        </span>
      ))}
    </div>
  );
}

export function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 64,
        transform: "translateX(-50%)",
        background: "rgba(0,0,0,.6)",
        color: COLORS.text,
        fontSize: 11,
        padding: "4px 12px",
        borderRadius: 6,
      }}
    >
      {msg}
    </div>
  );
}

export function DeathScreen({ dead, deadT, onExit }) {
  if (!dead) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(8,10,16,.55)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ color: COLORS.red, fontSize: 34, fontWeight: "bold" }}>
        YOU DIED
      </div>
      <div style={{ color: COLORS.text, fontSize: 14, marginTop: 8 }}>
        respawning in {Math.max(0, deadT).toFixed(1)}s
      </div>
      <button
        onClick={onExit}
        style={{
          pointerEvents: "auto",
          marginTop: 24,
          padding: "8px 20px",
          borderRadius: 6,
          background: "#39516e",
          border: "none",
          color: COLORS.bright,
          cursor: "pointer",
        }}
      >
        EXIT TO LOBBY
      </button>
    </div>
  );
}

export function HelpLine({ muted }) {
  return (
    <div
      style={{
        position: "absolute",
        right: 14,
        bottom: 12,
        fontSize: 10,
        color: COLORS.faint,
        textAlign: "right",
      }}
    >
      WASD move · W jetpack · mouse aim · LMB fire · E pickup · G nade · R reload
      · RMB scope · M mute{muted ? " (muted)" : ""}
    </div>
  );
}
