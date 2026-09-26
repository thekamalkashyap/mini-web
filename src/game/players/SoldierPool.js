/* SoldierPool — SoldierView lifecycle for local + remote soldiers.
   Solo: one view per sim player. Online: the own view renders prediction
   state, remotes render interpolated schema stubs. */
import { lerp } from "../../../shared/utils/math.js";
import { NET, SOLDIER_W, SOLDIER_H } from "../../../shared/config/tuning.js";
import { skinFor } from "../../../shared/avatar.js";
import { SoldierView } from "../SoldierView.js";

export function soldierStateOf(p, showTag) {
  return {
    x: p.x,
    y: p.y,
    w: p.w || SOLDIER_W,
    h: p.h || SOLDIER_H,
    aim: p.aim,
    facing: p.facing,
    dead: p.dead,
    invuln: p.invuln,
    shield: p.shieldT,
    walkT: p.walkT,
    grounded: p.grounded,
    reloading: p.reloading,
    weaponId: p.weaponId,
    flashT: p.flashT,
    recoilT: p.recoilT,
    swingT: p.swingT,
    name: p.name,
    hp: p.hp,
    showTag,
    skin: p.skin,
  };
}

export class SoldierPool {
  constructor(scene) {
    this.scene = scene;
    this.views = new Map(); /* id -> SoldierView (local/predicted + solo bots) */
    this.remotes = new Map(); /* sessionId -> {view, x, y, aim, tx, ty, taim} */
  }

  syncSolo(players, dt, t) {
    const alive = new Set();
    for (const p of players) {
      alive.add(p.id);
      let v = this.views.get(p.id);
      if (!v) {
        v = new SoldierView(this.scene);
        v.setSkin(p.skin);
        this.views.set(p.id, v);
      }
      v.update(soldierStateOf(p, p.id !== "me"), dt, t);
    }
    for (const [id, v] of this.views)
      if (!alive.has(id)) {
        v.destroy();
        this.views.delete(id);
      }
  }

  syncOnline(room, pred, dt, t, effects) {
    if (!room) return;
    const seen = new Set();
    room.state.players.forEach((s, id) => {
      seen.add(id);
      if (id === room.sessionId) {
        /* own view = prediction state */
        let v = this.views.get(id);
        if (!v) {
          v = new SoldierView(this.scene);
          v.setSkin(pred.skin);
          this.views.set(id, v);
        }
        v.update(soldierStateOf(pred, false), dt, t);
        return;
      }
      let r = this.remotes.get(id);
      if (!r) {
        r = { view: new SoldierView(this.scene), tx: s.x, ty: s.y, taim: s.aim };
        r.view.setSkin(skinFor(id));
        r.view.nameText.setColor("#ffd76e");
        this.remotes.set(id, r);
      }
      r.tx = s.x;
      r.ty = s.y;
      r.taim = s.aim;
      r.state = s;
      r.x = r.x === undefined ? s.x : lerp(r.x, r.tx, NET.REMOTE_POS_LERP);
      r.y = r.y === undefined ? s.y : lerp(r.y, r.ty, NET.REMOTE_POS_LERP);
      r.aim = r.aim === undefined ? s.aim : lerp(r.aim, r.taim, NET.REMOTE_AIM_LERP);
      const facing = Math.cos(r.aim) >= 0 ? 1 : -1;
      r.view.update(
        {
          x: r.x,
          y: r.y,
          w: SOLDIER_W,
          h: SOLDIER_H,
          aim: r.aim,
          facing,
          dead: s.dead,
          invuln: s.invuln,
          shield: s.shield,
          walkT: s.walkT,
          grounded: false,
          reloading: s.reloading,
          weaponId: s.wep,
          recoilT: 0,
          swingT: 0,
          name: s.name,
          hp: s.hp,
          showTag: true,
        },
        dt,
        t,
      );
      if (s.jet) effects.jetpuff(r.x + 22, r.y + 80);
    });
    for (const [id, r] of this.remotes)
      if (!seen.has(id)) {
        r.view.destroy();
        this.remotes.delete(id);
      }
    for (const [id, v] of this.views)
      if (!seen.has(id)) {
        v.destroy();
        this.views.delete(id);
      }
  }
}
