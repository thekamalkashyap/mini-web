/* Sim event vocabulary — the transient effects channel.
   Producers: WorldSim/Soldier (`sim.ev(Ev.BOOM, {...})`).
   Consumers: the Colyseus room (batches one "evs" message per tick) and the
   client's Effects controller (fx + sfx). Using Ev.* instead of string
   literals keeps producers, the room broadcast and the client switch in sync.

   Payload shapes (all plain JSON, all optional unless noted):
   FIRE  {x,y,vx,vy,life,rocket?,flame?,emp?,sfx?} — tracer to render + fire sound
   NADE  {x,y,vx,vy}                           — authoritative nade visual seed
   BOOM  {x,y,r}                               — explosion fx (shake + sprite)
   HIT   {x,y,n}                               — blood burst (n particles)
   SPARK {x,y,n}                               — impact sparks
   SMOKE {x,y}                                — one jetpack puff
   DEATH {who,by}                              — death sting (sfx only)
   PICKUP {i,idx,rsp}                          — pad i advanced (sync bookkeeping)
   SFX   {n,vol?,rate?}                        — named wav from the bank */
export const Ev = Object.freeze({
  FIRE: "fire",
  NADE: "nade",
  BOOM: "boom",
  HIT: "hit",
  SPARK: "spark",
  SMOKE: "smoke",
  DEATH: "death",
  PICKUP: "pk",
  SFX: "sfx",
});

export function makeEvent(t, d = {}) {
  return Object.assign({ t }, d);
}
