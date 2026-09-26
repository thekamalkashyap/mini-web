/* Body layout — legs/body/head on the mirrored root container.
   Metrics come from the shared avatarMetrics (sim + view MUST agree). */
import { LEG_LIFT } from "../../../shared/config/tuning.js";
import { avatarMetrics } from "../../../shared/avatar.js";

const DEFAULT_SKIN = {
  head: "head1.png",
  body: "body1.png",
  arm: "arm1.png",
  leg: "leg1.png",
};

export function resolveSkin(view, s) {
  return view.skin || s.skin || DEFAULT_SKIN;
}

export function layoutBody(view, s, skin, sw, sh, time) {
  const m = view.scene.frameSizeCache;
  const { hip, neck } = avatarMetrics(m, skin);

  const walk = s.walkT ? Math.sin(s.walkT * 10) : 0;
  const bob =
    s.grounded && s.walkT ? Math.abs(Math.cos(s.walkT * 10)) * 2 : 0;
  view.root.setPosition(s.x + sw / 2, s.y + sh - bob);
  view.root.setScale(s.facing, 1); /* containers have no setScaleX */
  view.root.setAlpha(
    s.invuln > 0 && Math.floor(time * 12) % 2 === 0 ? 0.35 : 1,
  );

  const legSwing = s.walkT ? walk * 0.35 : 0;
  const place = view.frames.place.bind(view.frames);
  place(view.legL, skin.leg, -8, -hip - LEG_LIFT, 0.5, 0.08, legSwing);
  place(view.legR, skin.leg, 8, -hip - LEG_LIFT, 0.5, 0.08, -legSwing);
  place(view.body, skin.body, 0, -hip, 0.5, 0.95);
  place(view.head, skin.head, 1, -neck - 10, 0.5, 0.92);
}
