# AGENT.md — working guide for AI agents on this codebase

A browser port of Mini Militia Classic built from assets reverse-engineered out of
the official APK. React + Vite + Phaser frontend, Colyseus authoritative backend,
one shared simulation module. Read `context.md` first for how the assets were
obtained and what the binary formats are. This file tells you how to work on the
code without re-breaking things.

## Golden rules

1. **Never trust raw timestamps for dt.** dt must be
   `clamp((t - lastT)/1000 || 0.016, 0.001, 0.033)` — everywhere: the room tick,
   the client loop, tests. A negative dt once caused an infinite loop in the
   soldier collision walk (real browser scenario: tab switches). Tripwire guards
   (`TRIP(...)`) exist in hot loops; keep them.
2. **TMX object y-coordinates are stored bottom-up** (cocos convention, double
   flip). `GameMap` flips them once at load: `y: this.h - o.y`. Tile layer data
   is NOT flipped. Do not "fix" either of these; palms-on-the-ground and
   spawns-on-platforms depend on this exact combination.
3. **Spawn points can sit inside floating geometry** (Outpost cave ceilings).
   `Soldier.respawn()` seeks feet-on-ground (flat-first spiral, then sky-drop,
   legacy walk-up de-embed last); `postPhysics()` has a NaN/void safety net.
   Preserve both. Weapon pickups settle the same way (`initPickups`); a drop
   buried with no groundable neighbor is skipped, sky drops stay as authored.
   Pads hold 128x64 spacing (grounded shift along the ground, floating rows
   spread sideways in air, unresolvable stacks list-merge). Guns and
   nades grab on an E press (`input.use` edge, prompt via `pickupNear`); bots
   keep auto-grab; health/fuel/shield items auto-grab.
4. **The collision mask must exist on BOTH sides.** The 2px alpha mask is traced
   from tile art: server via pngjs (`server/assets.js`), browser via canvas
   (`BootScene.buildMask`). The old whole-tile fallback exists only for
   mask-less local sims — never let an authoritative host run without a mask
   (invisible-solid tiles like 1outpost's gid 15 make whole-tile collision
   diverge wildly from the art). Grass-tuft despiking lives inside
   `buildMaskData` so both sides stay pixel-identical; slope-skin bodies
   (`solidShapes()`) derive from the same mask, never from art (runs
   re-anchor joint-to-joint for an unbroken surface line; bulk rects tuck
   under the skin line, never poke above it; runs bridge sub-foot notches so
   the collider rides teeth tops, never the dips). Vivid-green pixels and
   black outline strokes above the rock line are decor (walk-through); green
   inside the rock (mossy crack streaks) stays solid.
5. **matter.js is collision-resolution only.** Gravity/accel/jet are integrated
   by game code (feel constants in `shared/soldier.js`: run 380, climb -750)
   and handed to matter as per-step velocities
   (`Body.setVelocity({x: vx*dt, y: vy*dt})`, `Engine.update(engine, 1000/60)`).
   Direct x/y teleports must also `Body.setPosition` — matter overwrites raw
   coords next step. `postPhysics()` auto-steps grounded soldiers up ≤36px
   ledges with headroom + a landing; taller walls still block.
6. Everything here is for **personal/educational use** — the assets are
   © Appsomniacs/Miniclip. Never add anything that publishes/redistributes them.

## Architecture (2-minute tour)

```
index.html            Vite entry (React root)
src/
  main.jsx App.jsx    screen router: lobby → game (deep links preserved)
  ui/Lobby.jsx        map picker + solo/online launch (server URL persisted)
  ui/Hud.jsx          React HUD overlay (health/fuel/ammo/legend), fed via zustand
  store.js            zustand bridge Phaser → React (~10 Hz updates)
  game/
    boot.js           Phaser.Game factory (opts via registry — config-array
                      scenes auto-start with NO data, remember this!)
    BootScene.js      loads assets, converts formats, builds the alpha mask
    WorldScene.js     the world: render layers, input, local sim / prediction,
                      remote interpolation, fx/sfx from events, collider debug
    SoldierView.js    port of the legacy Soldier.draw: mirrored container +
                      pooled part images; partOrigin() converts legacy full-box
                      drawA anchors to trimmed-frame setOrigin (joints coincide;
                      the legacy 2px trim stretch is NOT reproduced). Avatar box
                      is SOLDIER_W/H (44x84) — views must take dims from state,
                      never hardcode them.
    plist.js          cocos plist atlas → Phaser atlas JSON-hash (one-time map)
    tiled.js          pipeline map JSON → Tiled JSON (Phaser tilemap pipeline)
    Sfx.js            Phaser sound wrapper (play/loop/mute, wav bank)
  net/ClientNet.js    colyseus.js glue: join, input @30 Hz, batched "evs" events
shared/               THE simulation — runs identically in room and browser
  constants.js        GRAV/SPR/MAPS/utils/skinFor (legacy feel constants)
  weapons.js          WEAPONS/NADES dicts (ids = TMX pickup ids)
  map.js              GameMap: tile gids + 2px alpha mask + greedy solid rects
  soldier.js          Soldier physics/combat (verbatim legacy math) + botThink
  sim.js              WorldSim: players/bullets/nades/pickups + matter world
  input.js            input pack/unpack (compact wire shape)
server/
  index.js            Colyseus Server (ws transport, room "mm", port 2567)
  rooms/MMRoom.js     authoritative room: 60 Hz sim tick, 20 Hz patch rate,
                      batched event broadcast
  rooms/schema.js     @colyseus/schema state (players/pickups/mapName)
  assets.js           pngjs tile-pixel provider + map bundles (cached per map)
test/
  sim_test.js         headless WorldSim regression (deterministic, see notes)
  room_test.js        real server + 2 real colyseus clients e2e (MM_DEBUG=1
                      enables the e2e-only dbgTeleport hook — never in prod)
  terrain_test.js     despike/skins/spawn-settle/pickup/avatar-collider regression
data/ img/ audio/     generated by ../mm_analysis/pipeline/extract.py — do not
                      hand-edit; served via public/ symlinks (dev + build)
```

### Netcode model (server-authoritative)
- The **room** runs the full WorldSim (`setSimulationInterval` 60 Hz); schema
  patches go out at 20 Hz (legacy snapshot cadence).
- **Clients** simulate only their OWN soldier locally for responsiveness
  (prediction, cosmetic fire — no local bullets) and get corrected each patch:
  lerp 0.18 toward authoritative position, hard snap if > 220 px apart;
  hp/weapon/ammo/fuel/dead are authoritative; respawn is state-driven, never a
  local timer (a local timer flapped against the host's in the old build).
- Remote players are interpolated stubs (lerp 0.25 pos / 0.3 aim).
- Transient world effects (fire/boom/death/pk/sfx/hit/smoke/spark) are batched
  per tick into one `evs` message; clients turn them into fx/sfx. In solo mode
  the local sim's events drive the same pipeline (fire/nade visuals come from
  sim state, not events — no double ghosts).
- Input travels up at 30 Hz (`inp` message); nade/reload are separate messages.

## Commands

```bash
cd ~/mm_web
npm install              # first time
npm run dev              # Vite dev server (5173) — lobby at /
npm run build            # production build (dist/, assets copied via symlinks)
npm run server           # Colyseus server on 2567 (PORT=xxx to override)
npm test                 # sim_test.js + room_test.js
```

**Run `npm test` before declaring any change to shared/, server/ or src/game/
done.** The room test spawns a real child-process server — if you change the
protocol or schema, update it too.

### Deep links (preserved from the legacy build)
`?solo=<map>[&demo][&flashhold][&colliders][&bots][&zoom=N]` skips the lobby.
`demo` holds fire, `flashhold` pins the muzzle flash (visual debugging),
`colliders` starts with the collider overlay on (runtime toggle: `` ` ``),
`bots` spawns the 2 practice bots in solo.

## Adding things (where they go)

- **New weapon:** entry in `shared/weapons.js` (key MUST match the TMX pickup
  id), sprite must exist in `data/atlas/menuTexture.json` (check with python/jq).
- **New map to the lobby:** add to `MAPS` in `shared/constants.js`. Nothing
  else — tilesets/backgrounds resolve by name (bg = tileset name with `tile64`
  → `bg`).
- **New net message:** `ClientNet.send*` + `MMRoom.onMessage` + room_test.
  Keep payloads plain; batched event vocabulary lives in `WorldSim.ev()`.
- **New sound trigger:** `this.sim.ev("sfx", {n, vol, rate})` — the client's
  `applyEvent` plays it; name = wav basename in `audio/`.

## Known sharp edges

- **Phaser config-array scenes auto-start with NO data** — `createGame()` stashes
  opts on the registry; `BootScene.init` falls back to it. Passing `{}` from
  Phaser is truthy — check `opts.map`, not `opts`.
- **`addAtlasJSONArray` ≠ hash format.** The cocos→Phaser conversion emits the
  JSON-hash shape (frames keyed by name); it must be registered with
  `addAtlasJSONHash`. The tilemap cache entry must be
  `{ format: TILED_JSON, data }`.
- **Vite dev server can serve stale/empty module transforms after rapid edits**
  (symptom: "module does not provide an export named X", blank root). Fix:
  kill vite, `rm -rf node_modules/.vite`, restart, hard-reload.
- **Phaser Container has no `setScaleX`** — use `setScale(x, y)`.
- Soldier art orientation (pixel-verified): ALL part art faces RIGHT naturally;
  only the outer facing mirror (container scale -1) turns the soldier. Legs
  swing from hip pivots; the gun assembly is a nested container pivoting at the
  shoulder; `xE.png` = gun with mag removed (reload state), `xMag.png` = mag.
- Guest own-death/respawn is state-driven only (`correctPrediction`); never
  auto-respawn locally.
- Bots are opt-in (`&bots` / `addPlayer({isBot:true})`); solo_test's bot checks
  need the deterministic fallbacks that are already written (park-on-target +
  auto weapon) — see `test/sim_test.js` comments before touching them.
- `humanInput`-equivalent lives in `WorldScene.humanInput` (camera.getWorldPoint
  for aim); bot AI never uses it.
- Test determinism (hard-won, see sim_test comments): matter ejects bodies
  teleported into solid terrain — every placement goes through `findClear` and
  is re-pinned each step; two individually-clear boxes can have a pillar between
  them — `findClearRight` also validates the firing corridor; semi-auto weapons
  fire on a trigger edge only — use auto weapons for fire assertions; void death
  bypasses invuln — re-pin walkers that fall off the map.
- Colyseus version pairing matters: JS client is 0.16.x, so the server packages
  are pinned to 0.16.x + `@colyseus/schema@^3` (a 0.18 server breaks the 0.16
  client's matchmaking).
- Background processes: launch detached (`setsid nohup ... &`) or the harness
  reaps them; kill by exact pattern carefully — `pkill -f vite` matches your
  own shell command string.

## Rebuilding assets from the APK

```bash
python3 ~/mm_analysis/pipeline/extract.py    # re-extracts everything into ~/mm_web
```
Sources: `~/mm_analysis/apktool_out/assets`. The pipeline carves 111 wavs out of
`da2sound16.ckb`, converts TMX → JSON, converts both atlas plists → JSON, copies
spritesheets. New maps appear automatically; wire them into `MAPS`.
