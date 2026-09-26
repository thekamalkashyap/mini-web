import React from "react";
import { COLORS, panel } from "../styles.js";

export default function TopStrip({ kills, mapLabel, mode, players, connected, roomId, onCopyInvite }) {
  return (
    <div
      style={{
        ...panel,
        position: "absolute",
        left: "50%",
        top: 12,
        transform: "translateX(-50%)",
        padding: "5px 16px",
        fontSize: 12,
        fontWeight: "bold",
        color: COLORS.accent,
        letterSpacing: 1,
      }}
    >
      YOU {kills} · {String(mapLabel || "").toUpperCase()} ·{" "}
      {mode === "online" ? `PLAYERS ${players}` : "SOLO"}
      {mode === "online" && !connected && (
        <span style={{ color: COLORS.red }}> · CONNECTION LOST</span>
      )}
      {mode === "online" && roomId && (
        <>
          <span style={{ color: COLORS.faint }}> · ROOM {roomId}</span>
          <button
            onClick={onCopyInvite}
            style={{
              pointerEvents: "auto",
              marginLeft: 8,
              padding: "2px 8px",
              fontSize: 11,
              fontWeight: "bold",
              borderRadius: 4,
              border: `1px solid ${COLORS.border}`,
              background: COLORS.cardBg,
              color: COLORS.blue,
              cursor: "pointer",
            }}
          >
            COPY INVITE
          </button>
        </>
      )}
    </div>
  );
}
