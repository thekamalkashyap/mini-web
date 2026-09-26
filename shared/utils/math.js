/* Math utils shared by sim, views and server. Dependency-free. */
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rnd = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* Shortest signed angular difference a-b in [-PI, PI]. */
export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/* Frame dt in seconds, clamped to the golden-rule window (AGENT.md #1).
   Never trust raw timestamps: tab switches / stalls must not inject
   negative or huge steps into physics. Replaces the copy-pasted
   `clamp(x || 0.016, 0.001, 0.033)` in every loop. */
export const DT_MIN = 0.001;
export const DT_MAX = 0.033;
export const DT_FALLBACK = 0.016;

export function clampDt(dtSeconds, fallback = DT_FALLBACK) {
  return clamp(dtSeconds || fallback, DT_MIN, DT_MAX);
}
