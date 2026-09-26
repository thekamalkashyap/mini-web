/* HudSync — pushes scene state into the zustand store (~10 Hz) for the
   React HUD overlay, including the "press E" pickup prompt. */
import { useStore } from "../../store.js";

export function toast(msg) {
  useStore.getState().actions.toast(msg);
}

export function clearHud() {
  useStore.getState().actions.setHud(null);
}

export function syncHud(scene) {
  const online = scene.opts.mode === "online";
  const me = online ? scene.pred : scene.sim.me;
  if (!me) return;
  /* "press E" prompt: a grabbable gun/nade in radius (online also honors
     the authoritative respawn timers, which the prediction sim can't see) */
  const schema = online && scene.room ? scene.room.state.pickups : null;
  const near =
    !me.dead &&
    scene.sim.pickupNear(
      me,
      schema
        ? (i) => {
            const s = schema[i];
            return !!s && s.respawn > 0;
          }
        : null,
    );
  useStore.getState().actions.setHud({
    hp: me.hp,
    fuel: me.fuel,
    emp: (me.empT || 0) > 0,
    ammo: me.ammo,
    mag: me.weapon.mag,
    reloading: me.reloading,
    weaponName: me.weapon.name,
    nades: me.nades,
    kills: me.kills,
    dead: me.dead,
    deadT: Math.max(0, me.deadT),
    mapLabel: scene.mapLabel,
    mode: scene.opts.mode,
    players:
      online && scene.room
        ? scene.room.state.players.size
        : scene.sim.players.length,
    showColliders: scene.showColliders,
    muted: scene.sfx.muted,
    connected:
      scene.opts.mode !== "online" || (scene.net && scene.net.connected),
    pickupName: near ? near.name : null,
    roomId: online && scene.room ? scene.room.roomId : null,
  });
}
