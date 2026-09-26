/* Backwards-compatible facade: every symbol that used to live here now has a
   focused home, re-exported so existing imports keep working. New code should
   import from the canonical modules directly:
     shared/utils/math.js     TAU clamp lerp rnd pick angDiff clampDt DT_*
     shared/utils/debug.js    TRIP
     shared/config/tuning.js  GRAV SPR SOLDIER_* LEG_LIFT NET SPAWN NADE PICKUP BOT COMBAT WORLD
     shared/config/maps.js    MAPS resolveMapId mapLabel
     shared/avatar.js         partOrigin skinFor avatarMetrics */
export {
  TAU,
  clamp,
  lerp,
  rnd,
  pick,
  angDiff,
  clampDt,
  DT_MIN,
  DT_MAX,
  DT_FALLBACK,
} from "./utils/math.js";
export { TRIP } from "./utils/debug.js";
export {
  GRAV,
  SPR,
  SOLDIER_W,
  SOLDIER_H,
  LEG_LIFT,
  NET,
  SPAWN,
  NADE,
  PICKUP,
  BOT,
  COMBAT,
  WORLD,
} from "./config/tuning.js";
export { MAPS, resolveMapId, mapLabel } from "./config/maps.js";
export { partOrigin, skinFor, avatarMetrics } from "./avatar.js";
