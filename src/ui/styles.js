/* Shared UI kit — palette, type and panel/button/field primitives used by
   the lobby and HUD so both screens stay visually consistent. */

export const FONT = "Trebuchet MS, Verdana, sans-serif";

export const COLORS = {
  text: "#cfe2f3",
  bright: "#e8f0f8",
  dim: "#9fb4c8",
  faint: "#5f7188",
  accent: "#ffd76e",
  blue: "#7ec3f0",
  green: "#6fdc7a",
  red: "#e74c3c",
  panelBg: "rgba(0,0,0,.63)",
  cardBg: "#121c2a",
  inputBg: "#0d1420",
  border: "#2a3950",
  selectedBg: "#22344e",
};

export const panel = {
  background: COLORS.panelBg,
  borderRadius: 6,
  padding: "6px 12px",
};

export const button = (bg, fg = "#eaf4ff") => ({
  padding: 12,
  borderRadius: 6,
  border: "none",
  background: bg,
  color: fg,
  fontWeight: "bold",
  fontSize: 14,
  cursor: "pointer",
});

export const field = {
  width: "100%",
  marginTop: 4,
  padding: 8,
  borderRadius: 6,
  border: `1px solid ${COLORS.border}`,
  background: COLORS.inputBg,
  color: COLORS.bright,
};

export const fieldLabel = {
  fontSize: 11,
  color: COLORS.dim,
};

export function barStyle(width, frac, color) {
  return {
    width: width * Math.max(0, Math.min(100, frac)) / 100 + "px",
    height: "100%",
    background: color,
    borderRadius: 2,
  };
}

export const barTrack = (width, height) => ({
  width,
  height,
  background: "#222e3d",
  borderRadius: 2,
});
