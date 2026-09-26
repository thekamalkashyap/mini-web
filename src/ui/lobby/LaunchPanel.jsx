import React from "react";
import { COLORS, button, field, fieldLabel } from "../styles.js";

export default function LaunchPanel({
  name,
  onName,
  bots,
  onBots,
  serverUrl,
  onServerUrl,
  code,
  onCode,
  busy,
  err,
  onSolo,
  onOnline,
  onCreateParty,
  onJoinParty,
}) {
  return (
    <div
      style={{
        width: 280,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: COLORS.cardBg,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <label style={fieldLabel}>
        CALLSIGN
        <input value={name} onChange={(e) => onName(e.target.value.slice(0, 14))} style={field} />
      </label>

      <button onClick={onSolo} style={button("#2e9e57", "#08130c")}>
        SOLO PRACTICE
      </button>

      <label
        style={{ ...fieldLabel, display: "flex", gap: 6, alignItems: "center" }}
      >
        <input
          type="checkbox"
          checked={bots}
          onChange={(e) => onBots(e.target.checked)}
        />{" "}
        spawn practice bots
      </label>

      <div style={{ borderTop: `1px solid ${COLORS.border}`, margin: "4px 0" }} />
      <label style={fieldLabel}>
        SERVER (colyseus ws://host:port)
        <input
          value={serverUrl}
          onChange={(e) => onServerUrl(e.target.value)}
          placeholder="same origin (prod) · ws://localhost:2567 (dev)"
          style={field}
        />
      </label>
      <button
        disabled={busy}
        onClick={onOnline}
        style={{
          ...button(busy ? "#39516e" : "#2e7ee0"),
          cursor: busy ? "wait" : "pointer",
        }}
      >
        {busy ? "CONNECTING…" : "PLAY ONLINE"}
      </button>

      <div style={{ borderTop: `1px solid ${COLORS.border}`, margin: "4px 0" }} />
      <button
        disabled={busy}
        onClick={onCreateParty}
        style={{
          ...button(busy ? "#39516e" : COLORS.accent, busy ? undefined : "#08130c"),
          cursor: busy ? "wait" : "pointer",
        }}
      >
        CREATE PARTY
      </button>
      <label style={fieldLabel}>
        ROOM CODE (from invite link)
        <input
          value={code}
          onChange={(e) => onCode(e.target.value.trim())}
          placeholder="e.g. K6mk3vZaS"
          style={field}
        />
      </label>
      <button
        disabled={busy}
        onClick={onJoinParty}
        style={{
          ...button(busy ? "#39516e" : "#2e9e8f"),
          cursor: busy ? "wait" : "pointer",
        }}
      >
        JOIN PARTY
      </button>
      {err && <div style={{ color: COLORS.red, fontSize: 11 }}>{err}</div>}

      <div style={{ fontSize: 10, color: COLORS.faint, lineHeight: 1.6 }}>
        WASD move · W jetpack · mouse aim · LMB fire
        <br />
        G nade · R reload · RMB scope · M mute · ` colliders
      </div>
    </div>
  );
}
