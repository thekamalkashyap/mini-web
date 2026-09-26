import React from "react";
import { MAPS } from "../../../shared/constants.js";
import { COLORS } from "../styles.js";

export default function MapPicker({ map, onPick }) {
  return (
    <div style={{ flex: "1 1 420px", maxWidth: 640 }}>
      <div style={{ fontSize: 12, color: COLORS.dim, margin: "10px 0 6px" }}>
        MAP — {MAPS.find((m) => m[0] === map)?.[1]}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(128px, 1fr))",
          gap: 6,
        }}
      >
        {MAPS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => onPick(id)}
            style={{
              padding: "10px 8px",
              borderRadius: 6,
              border:
                id === map
                  ? `2px solid ${COLORS.accent}`
                  : `1px solid ${COLORS.border}`,
              background: id === map ? COLORS.selectedBg : "#16202e",
              color: id === map ? COLORS.accent : COLORS.text,
              fontSize: 11,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
