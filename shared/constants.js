/* Shared game constants + tiny utils — used identically by the Colyseus room
   (authoritative sim) and the browser (solo + client-side prediction).
   Values are the legacy feel constants; do NOT tweak casually. */

export const GRAV = 1500;
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rnd = (a, b) => a + Math.random() * (b - a);
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const SPR = 0.34;   /* soldier part scale: 84px leg art -> ~29px on screen */

/* tripwire guard for hot loops — a runaway walk must kill the process loudly,
   never hang the room (see AGENT.md golden rule #1) */
export const TRIP = (name, i, limit = 200000, ctxd) => {
  if (i > limit) {
    console.error("TRIPWIRE:", name, i, JSON.stringify(ctxd));
    if (typeof process !== "undefined" && process.exit) process.exit(99);
    else throw new Error("TRIPWIRE: " + name);
  }
};

export const MAPS = [
  ["1outpost", "Outpost"], ["2highTower", "High Tower"], ["3subdivision", "Subdivision"],
  ["4bottleNeck", "Bottle Neck"], ["5noEscape", "No Escape"], ["6solong", "So Long"],
  ["7lunarcy", "Lunarcy"], ["8icebox", "Icebox"], ["9snowblind", "Snowblind"],
  ["10pyramid", "Pyramid"], ["11catacombs", "Catacombs"], ["12overseer", "Overseer"],
  ["13suspension", "Suspension"], ["14cliffhanger", "Cliffhanger"], ["15crossfire", "Crossfire"],
  ["16undermine", "Undermine"], ["17crucible", "Crucible"], ["18stronghold", "Stronghold"],
  ["19losttomb", "Lost Tomb"], ["20deadlock", "Deadlock"], ["0hunger", "Hunger"],
  ["kingofthehill", "King of the Hill"], ["survival", "Survival"], ["training", "Training"],
];

/* deterministic skin per player id (string session ids hash to a number) */
export function skinFor(id) {
  const n = typeof id === "number" ? id : [...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const h = 1 + (n * 7) % 17, b = 1 + (n * 5) % 18, a = 1 + (n * 3) % 18, l = 1 + (n * 11) % 17;
  return { head: `head${h}.png`, body: `body${b}.png`, arm: `arm${a}.png`, leg: `leg${l}.png` };
}
