/* Avatar shared logic: origin math + body metrics + deterministic skins.
   The sim (muzzle/shoulder) and the view (part layout) must agree on the
   body stack exactly — both derive it from avatarMetrics() here. */
import { SPR } from "./config/tuning.js";

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

/* Vertical assembly metrics (positive = up from the feet line) plus the
   horizontal shoulder offset (behind center, negated by facing).
   frameSize: (atlasFrameName) -> {w,h}; skin: {head,body,arm,leg}. */
export function avatarMetrics(frameSize, skin) {
  const leg = (frameSize(skin.leg).h || 84) * SPR;
  const body = (frameSize(skin.body).h || 102) * SPR;
  const bodyW = (frameSize(skin.body).w || 56) * SPR;
  return {
    leg,
    body,
    bodyW,
    hip: leg - 5,
    neck: leg - 5 + body - 7,
    shoulder: leg - 5 + body * 0.28,
    shoulderDx: -bodyW * 0.35,
  };
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
