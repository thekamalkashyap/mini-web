/* Shared game constants + tiny utils — used identically by the Colyseus room
   (authoritative sim) and the browser (solo + client-side prediction).
   Values are the legacy feel constants; do NOT tweak casually. */

export const GRAV = 1500;
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rnd = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const SPR = 0.34; /* soldier part scale: 84px leg art -> ~29px on screen */

/* Canonical avatar box: 44 wide, 84 tall. The art stack tops out at ~80.5px
   over all skins (head above feet), so 84 leaves a few px margin — the old
   104 box had ~25px of empty "tip padding" that ate headshots. Single source
   of truth for sim bodies and views (views must never hardcode 22/104). */
export const SOLDIER_W = 44,
  SOLDIER_H = 95;

/* Hip-joint overlap: thigh tops tuck this far (world px) above the hip pivot
   so no body+leg skin combo shows daylight at the waist. Measured worst gap
   is 4.46px (body12 hem rides 15src px above the pivot at the leg bands);
   6px leaves >=1.5px overlap even there, and feet still plant within 3px of
   the box bottom. Single-sourced: SoldierView lifts the legs, terrain_test
   re-measures the ink joint against it. */
export const LEG_LIFT = 6;

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
  ["1outpost", "Outpost"],
  ["2highTower", "High Tower"],
  ["3subdivision", "Subdivision"],
  ["4bottleNeck", "Bottle Neck"],
  ["5noEscape", "No Escape"],
  ["6solong", "So Long"],
  ["7lunarcy", "Lunarcy"],
  ["8icebox", "Icebox"],
  ["9snowblind", "Snowblind"],
  ["10pyramid", "Pyramid"],
  ["11catacombs", "Catacombs"],
  ["12overseer", "Overseer"],
  ["13suspension", "Suspension"],
  ["14cliffhanger", "Cliffhanger"],
  ["15crossfire", "Crossfire"],
  ["16undermine", "Undermine"],
  ["17crucible", "Crucible"],
  ["18stronghold", "Stronghold"],
  ["19losttomb", "Lost Tomb"],
  ["20deadlock", "Deadlock"],
  ["0hunger", "Hunger"],
  ["kingofthehill", "King of the Hill"],
  ["survival", "Survival"],
  ["training", "Training"],
];

/* Deep links (?solo=<map>...) and scene inits take the map id verbatim — an
   unknown id used to 404 the map JSON (Vite serves index.html as fallback),
   killing JSON.parse in BootScene and hanging on a blank page. Resolve to a
   known id up front so a typo/label always loads instead of dying. */
export function resolveMapId(id) {
  const key = String(id || "").trim();
  return MAPS.some((m) => m[0] === key) ? key : "1outpost";
}

/* Origin conversion for trimmed atlas frames.
   The legacy canvas renderer anchored every part to its FULL source box
   (trim padding included) with the trimmed quad offset by (offX, offY);
   Phaser's setOrigin anchors to the TRIMMED quad. To reproduce a legacy
   anchor (ax, ay) in trimmed space:
     ox = (ax * srcW - offX) / trimW,  oy = (ay * srcH - offYtop) / trimH
   offX/offY are the cocos bottom-up trim offsets from the atlas JSON
   (offYtop = srcH - trimH - offY); untrimmed parts (src == trim, offsets 0)
   reduce to the anchor itself. Matches legacy Atlas.drawA exactly. */
export function partOrigin(
  trimW,
  trimH,
  srcW,
  srcH,
  ax,
  ay,
  offX = 0,
  offY = 0,
) {
  const sw = srcW || trimW,
    sh = srcH || trimH,
    tw = trimW || 1,
    th = trimH || 1;
  return [(ax * sw - offX) / tw, (ay * sh - (sh - th - offY)) / th];
}

/* deterministic skin per player id (string session ids hash to a number) */
export function skinFor(id) {
  const n =
    typeof id === "number"
      ? id
      : [...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const h = 1 + ((n * 7) % 17),
    b = 1 + ((n * 5) % 18),
    a = 1 + ((n * 3) % 18),
    l = 1 + ((n * 11) % 17);
  return {
    head: `head${h}.png`,
    body: `body${b}.png`,
    arm: `arm${a}.png`,
    leg: `leg${l}.png`,
  };
}
