# Mini Militia Classic — Web Port (PoC)

A browser remake of the Outpost map from Mini Militia Classic, built entirely
from assets reverse-engineered out of the original APK (`com.appsomniacs.mmc` v0.14.4).

**Personal / educational project.** All art, sounds, maps and the game itself are
© Appsomniacs / Miniclip — do not publish or distribute this build.

## Run it
```bash
cd ~/mm_web
python3 -m http.server 8080          # serve the client
# open http://localhost:8080 (termux-open-url http://localhost:8080)
```
Click/tap once to arm audio. Pick a **map** (all 24 from the APK), then:

- **SOLO vs BOTS** — instant deathmatch with 2 bot soldiers
- **HOST ONLINE** — start a room on your relay server, share the URL
- **JOIN** — enter a friend's `ws://IP:8090` and jump in

### Multiplayer server
```bash
cd ~/mm_web/server
node server.js 8090        # or: PORT=8090 node server.js
```
First client in a room becomes **host** (authoritative sim); others are guests
streaming inputs at 30 Hz and receiving 20 Hz snapshots + events. Host migration
is handled by the relay if the host drops. Rooms are keyed by map name.

## Controls
| Action | Desktop | Touch |
|---|---|---|
| Move | A / D | left-half stick |
| Jetpack | W or Space (hold, drains fuel) | left stick up |
| Aim / fire | mouse + LMB | right-half stick |
| Grenade | G | — |
| Reload | R | auto |
| Scope (M93BA) | RMB hold | — |
| Mute | M | — |

## What's real (extracted from the APK)
- **Map** — Outpost TMX converted to JSON: tile geometry, both tile layers,
  every weapon spawn (`wp_p_*` with its exact weapon lists), spawn points,
  fuel/flag stations, palm/bush decor — at original coordinates.
- **Sprites** — the game's own atlas (`menuTexture.png`, 331 frames): the actual
  soldier parts, all 30+ weapons with muzzle flashes, pickups, flags, decor.
- **Sounds** — all 111 WAVs carved from the `da2sound16.ckb` CocosDenshion bank
  (per-gun fire sounds, reloads, ricochets, explosions, the death voice lines).
- **Weapon behaviour** — roster, mag sizes, fire rates approximated from the
  original's feel; rocket/grenade splash, flamethrower, laser beam, melee.

## What's reimplemented (gameplay was C++ inside `libcocos2dcpp.so`)
- Jetpack physics (thrust/fuel/regen), tile collision, camera + shake + parallax
- Bullet/rocket/grenade simulation, explosions, blood/smoke/spark particles
- Weapon pickups that cycle the map's real loadout lists, med/boost/shield items
- 2 bots with jetpack AI (they can and will fall off Outpost — just like the real thing)

## Structure
```
index.html          entry
js/main.js          engine: loop, physics, soldiers, bots, HUD
js/weapons.js       weapon definitions (ids = TMX pickup ids)
js/map.js           TMX map + Cocos2d atlas renderers
js/audio.js         WebAudio loader for carved wavs
data/maps/*.json    24 converted maps (only 1outpost is wired in)
data/atlas/*.json   plist-atlas frame tables
img/                spritesheets, tilesets, fx
audio/*.wav         111 carved sounds
../mm_analysis/pipeline/extract.py   the asset pipeline
test/solo_test.js   headless solo smoke test (node test/solo_test.js)
test/e2e_test.js    full MP test: real server + host + guest over WebSockets
```

## Try other maps
Every map from the APK is already converted in `data/maps/`. In `js/main.js`
`boot()` swap `1outpost.json` for e.g. `7lunarcy`, `9snowblind`, `20deadlock`.
Maps that use desert/moon/snow tilesets need their `t64*_new.tsx` image copied
from the APK (already in `img/` — the renderer picks tilesets by firstgid).
