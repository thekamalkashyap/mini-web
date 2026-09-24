/* Deep-link parser for ?solo=<map>[&demo][&flashhold][&colliders][&bots][&zoom=N].
   Pure (no React/Phaser/DOM at import time) so the headless node suite can
   cover the exact URL shape. Returns the game opts object, or null when the
   URL carries no solo deep link. Unknown map ids fall back to 1outpost via
   resolveMapId (a typo/label must load, never blank-screen). */
import { resolveMapId } from "../shared/constants.js";

export function parseSoloSearch(search) {
  const qp = new URLSearchParams(search);
  if (!qp.has("solo")) return null;
  return {
    mode: "solo",
    map: resolveMapId(qp.get("solo")),
    demo: qp.has("demo"),
    flashHold: qp.has("flashhold"),
    colliders: qp.has("colliders"),
    bots: qp.has("bots"),
    zoom: parseFloat(qp.get("zoom")) || 0,
  };
}
