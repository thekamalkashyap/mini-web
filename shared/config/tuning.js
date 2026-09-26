/* Gameplay tuning — the legacy feel constants in one discoverable place.
   Values are verbatim; do NOT tweak casually. Numbers used in exactly one
   spot stay at their use site; only shared/duplicated values live here. */

export const GRAV = 1500;

/* soldier part scale: 84px leg art -> ~29px on screen */
export const SPR = 0.34;

/* Canonical avatar box: 44 wide, 84 tall. The art stack tops out at ~80.5px
   over all skins (head above feet), so 84 leaves a few px margin — the old
   104 box had ~25px of empty "tip padding" that ate headshots. Single source
   of truth for sim bodies and views (views must never hardcode 22/104). */
export const SOLDIER_W = 44;
export const SOLDIER_H = 95;

/* Hip-joint overlap: thigh tops tuck this far (world px) above the hip pivot
   so no body+leg skin combo shows daylight at the waist. Measured worst gap
   is 4.46px (body12 hem rides 15src px above the pivot at the leg bands);
   6px leaves >=1.5px overlap even there, and feet still plant within 3px of
   the box bottom. Single-sourced: SoldierView lifts the legs, terrain_test
   re-measures the ink joint against it. */
export const LEG_LIFT = 6;

/* netcode cadence + client correction feel */
export const NET = {
  TICK_MS: 1000 / 60, // authoritative sim step (60 Hz)
  PATCH_MS: 50, // schema sync (20 Hz, legacy snapshot cadence)
  INPUT_HZ: 30, // client -> server input
  HUD_HZ: 10, // Phaser -> React HUD bridge
  PREDICT_LERP: 0.18, // own-soldier correction toward authoritative pos
  SNAP_DIST: 220, // beyond this, snap instead of lerping (px)
  REMOTE_POS_LERP: 0.25, // remote player interpolation
  REMOTE_AIM_LERP: 0.3,
};

/* spawn/respawn (sim + prediction correction must agree) */
export const SPAWN = {
  INVULN_FIRST: 1.5,
  INVULN_RESPAWN: 2.0,
  DEAD_TIME: 2.6,
};

/* shared grenade kinematics — one source for the sim's ghost branch,
   the soldier's throw, and the client's visual nades */
export const NADE = {
  THROW_SPEED: 780,
  THROW_UP: 160, // extra upward bias on the throw arc
  MOMENTUM: 0.4, // fraction of thrower velocity inherited
  GRAVITY: 1300,
  BOUNCE: 0.45, // velocity kept per bounce axis
  FUSE: 2.0,
  PROXY_ARM: 0.8, // proxy nades arm after this many seconds
};

/* pickup grab geometry + respawn pacing */
export const PICKUP = {
  RADIUS_X: 46,
  RADIUS_Y: 56,
  RESPAWN_ITEM: 12, // health/fuel/shield
  RESPAWN_GUN: 8,
  RESPAWN_NADE: 10,
  PAD_DX: 128, // min spacing between settled pads
  PAD_DY: 64,
};

/* bots hit softer and wider than humans */
export const BOT = {
  DMG_MUL: 0.6,
  SPREAD_BONUS: 0.1,
  FIRE_RATE_MUL: 0.5,
};

/* explosions hurt their owner less */
export const COMBAT = {
  SELF_SPLASH_MUL: 0.45,
  MELEE_ARC: 1.0, // radians off-aim that still connects
};

/* EMP rifle: direct orb hits ground the victim's jetpack this long */
export const EMP = {
  DISABLE_T: 60,
};

/* world bounds helpers */
export const WORLD = {
  VOID_MARGIN: 300, // below map.h + this => void death
  BOUNDARY_T: 96, // boundary wall thickness (bottom left open)
};
