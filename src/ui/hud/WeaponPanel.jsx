import React from "react";
import { COLORS, panel } from "../styles.js";

export default function WeaponPanel({ weaponName, ammo, mag, reloading, nades }) {
  return (
    <div
      style={{ ...panel, position: "absolute", left: 16, top: 68, minWidth: 208 }}
    >
      <div style={{ fontSize: 12, fontWeight: "bold", color: COLORS.bright }}>
        {weaponName}
      </div>
      <div
        style={{
          fontSize: 19,
          fontWeight: "bold",
          color: ammo === 0 ? COLORS.red : COLORS.accent,
        }}
      >
        {reloading > 0 ? "RELOADING" : mag === 0 ? "∞" : `${ammo}/${mag}`}
      </div>
      <div style={{ fontSize: 10, color: COLORS.dim }}>✦ {nades} grenades</div>
    </div>
  );
}
