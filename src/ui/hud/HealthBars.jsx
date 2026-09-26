import React from "react";
import { COLORS, panel, barStyle, barTrack } from "../styles.js";

function Bar({ value, color, label, width = 180, height = 12 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={barTrack(width, height)}>
        <div style={barStyle(width, value, color)} />
      </div>
      <span style={{ fontSize: 10, color: COLORS.text }}>{label}</span>
    </div>
  );
}

export default function HealthBars({ hp, fuel, emp }) {
  return (
    <div
      style={{
        ...panel,
        position: "absolute",
        left: 16,
        top: 16,
        padding: "6px 12px 8px 8px",
      }}
    >
      <Bar value={hp} color={hp > 35 ? COLORS.green : COLORS.red} label="HEALTH" />
      <div style={{ marginTop: 4 }}>
        <Bar
          value={fuel}
          color={emp ? COLORS.faint : COLORS.blue}
          label={emp ? "EMP'D" : "FUEL"}
          height={10}
        />
      </div>
    </div>
  );
}
