/* Input codec — client -> server, 30 Hz.
   Same compact wire shape as the legacy protocol (l/r/j/f flags + aim point). */
export function inputPack(i) {
  return { l: i.left ? 1 : 0, r: i.right ? 1 : 0, j: i.jet ? 1 : 0, f: i.fire ? 1 : 0, u: i.use ? 1 : 0, x: Math.round(i.aimX || 0), y: Math.round(i.aimY || 0) };
}
export function inputUnpack(d) {
  return { left: !!d.l, right: !!d.r, jet: !!d.j, fire: !!d.f, use: !!d.u, aimX: d.x, aimY: d.y };
}

/* fresh neutral input (spawn default, test setup) */
export function emptyInput() {
  return { left: false, right: false, jet: false, fire: false, use: false, aimX: 0, aimY: 0 };
}

/* fill missing fields so physics/bots never see undefined flags */
export function normalizeInput(partial) {
  return Object.assign(emptyInput(), partial || {});
}
