/* Map roster — the lobby list and the deep-link vocabulary.
   To add a map: add one row here. Nothing else — tilesets/backgrounds
   resolve by name (bg = tileset name with `tile64` -> `bg`). */
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

export function mapLabel(id) {
  return (MAPS.find((m) => m[0] === id) || [null, id])[1];
}
