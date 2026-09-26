# context.md — project background & reverse-engineered knowledge

## What this is

`~/mm_web` is a from-scratch browser implementation of *Mini Militia Classic*
(`com.appsomniacs.mmc`), running on the game's **actual content** — maps, sprites,
fonts and sounds — extracted from the official Play-store APK. The gameplay
engine itself was re-written in JavaScript because the original engine is
compiled C++ (`libcocos2dcpp.so`) living in the ABI split APK, which we never had
(and compiled ARM code isn't portable to the web anyway).

## Origin chain

```
Mini Militia Classic.apk (61 MB, base split, v0.14.4 / build 88)
  └─ apktool d → ~/mm_analysis/apktool_out/     (manifest, resources, assets)
  └─ jadx     → ~/mm_analysis/jadx_out/         (Java decompiled — glue only:
                                                 billing, ads, analytics, JNI bridge)
  └─ pipeline → ~/mm_analysis/pipeline/extract.py
                └─ ~/mm_web/  (this project: assets converted + web game)
```

The Java layer taught us the shape of the product (AdMob + AppLovin MAX, Firebase
suite, Play Billing 6 with XID-bound server-verified purchases, Cocos2d-x
`System.loadLibrary("cocos2dcpp")`, ~25 JNI natives) — see
`~/mm_analysis/REPORT.md` for the full reverse-engineering report.

**Legal:** everything here is © Appsomniacs / Miniclip. This is a personal,
educational port. Don't publish or redistribute.

## Reverse-engineered formats (the valuable bits)

### `da2sound16.ckb` — CocosDenshion sound bank
```
0x00  'ckmk' magic
0x04  u32 version (63)
0x08  u32 1, 0x0c u32 2
0x10  bank name 'da2sound' + pad   (40-byte field)
0x38  u32 entry count (111)        (repeated at 0x3c)
0x40  u32 1, 0x44 u32 1
0x48  TOC: 111 × 72-byte entries:
      +0x00 char name[32]           e.g. "ak47.wav"
      +0x20 u16 flags (0x0100), u16 sampleRate (16000)
      +0x24 u32 numFrames
      +0x28 u16 bytesPerSample (2), u16 channels (1)   → all entries 16 kHz mono s16
      +0x2c u32 0xffff (loop sentinel), +0x30 u32 0
      +0x34 u32 numFrames (repeat), +0x38 u32 0
      +0x3c u32 numBytes (== frames × 2)
then  raw PCM, sequential, in TOC order (sizes sum exactly to the tail)
```
Verified: sum-of-bytes == filesize − data_start for all 111 entries.
Carving = wrap each PCM blob in a RIFF/WAVE header.

### Maps — Tiled TMX with a twist
Standard Tiled 1.1.5 XML, base64-uncompressed tile data, 128 px tiles,
tilesets `tile64_new` (classic), `tile64Desert/Moon/Snow_new` (themes), each
1984×1984, margin 4, spacing 4 → 15×15 grid.

**The twist:** object Y coordinates are stored **bottom-up**. Appsomniacs
authored maps programmatically with y measured from the bottom; cocos2d-x then
flips them again on load. Net effect for us: `worldY = mapPixelH − tmxY`
(tile layer data stays top-down/normal). Evidence that settled it:
palm/bush decor lands on the ground and survival-map spawns land on the floor
only under the flip; some spawns still intersect floating cave geometry
(Outpost has interior caverns), hence the de-embed logic.

Object taxonomy: `sp_p_NN` spawns · `wp_p_NN` weapon pickups (property
`weapon` = comma-list, cycled on grab) · `fp_b_N` flag/fuel stations
(sprite `flagStationBlue/Orange`) · `ctf_sp_N`/`ctf_wp_N` CTF spawns/weapons ·
`spritebg`/`spritefg` decor (palmTree, bushFan, bushPalm — repeat names gain
`_N` suffixes, matched by prefix; center-anchored at the flipped point, the
author sights the whole sprite against the art: 51-sprite in-situ audit).
24 maps shipped: Outpost → Deadlock, Lunarcy (moon), Icebox/Snowblind (snow),
Pyramid/Catacombs/Lost Tomb (desert), plus KOTH/survival/training.

### Texture atlases — Cocos2d-x plist
`menuTexture.plist` (331 frames: soldier parts head1-17/body1-18/arm1-18/leg1-17,
every weapon + `xE.png` muzzle flash + `xMag.png` mags, pickups, flags, UI) and
`partsTexture.plist` (271 frames: the avatar editor kit — hair, hats, beards,
glasses…). Fields: `textureRect {{x,y},{w,h}}`, `spriteSize`, `spriteSourceSize`,
`spriteOffset`, `textureRotated` (90° stored rotated — handled in `Atlas.draw`).
Bottom-center anchor convention is used by the game's renderer; our `Atlas.draw`
mirrors it.

**Weapon frame system (pixel-verified later):** `xE.png` frames are NOT muzzle
flashes — they are the gun with its magazine/ammo box removed (compare ak47 vs
ak47E: the curved mag is gone). `xMag.png` frames are the detached magazine
itself. The original used them for the reload animation: gun swaps to the E
frame while the mag drops out and slides back in. Muzzle flash is procedural
(`flare.png` + additive blend). Soldier body art (head/arm/leg) faces LEFT
while gun art faces RIGHT — the renderer flips the body parts, not the gun.

### Weapon roster (datamined from map spawn lists)
~30 ids: ak47, m16, m14, mp5, uzi, tec9, tavor, xm8, shotgun, sawgun, minigun,
m93ba (sniper), m1881, magnum, deagle, gdeagle, aa12, emp, laser, phasr, smaw
(rocket), rg6 (grenade launcher), flame (flamethrower), machete, riot (shield),
fragnade/gasnade/proxynade/empnade, healthpack, boosttank, shield.
Per-gun fire sounds exist in the bank for most (ak47.wav, m93ba.wav, rg6.wav…).

## Decisions & rationale

- **Vanilla JS + canvas 2D, no build step.** Runs from `python3 -m http.server`;
  nothing to compile; easy to hack on in Termux.
- **Host-authoritative netcode** (guest inputs 30 Hz ↑, snapshots 20 Hz ↓,
  events immediate) — reuses the solo sim verbatim on the host, keeps the relay
  server ~90 lines and protocol-agnostic, tolerates latency with client-side
  prediction for one's own soldier. P2P/WebRTC was rejected: harder NAT handling,
  no benefit at this scale.
- **Guest bullets are visual-only.** One source of truth for damage prevents
  divergence; explosions always come from host `boom` events.
- **Sounds decoded eagerly** (111 wavs ≈ 3.6 MB) — avoids first-shot jank.
- **Testing without a browser:** `test/harness_lib.js` stubs canvas/Image/fetch/
  AudioContext/WebSocket-enough to run the *real* game headless in Node; e2e
  test runs the real relay + host + guest across two processes. This caught two
  ship-stopper bugs already (negative-dt freeze; e2e join race).

## Environment notes (Termux on Android)

- Tools present: `apktool 3.0.3`, `jadx 1.5.5`, `node v24` (global WebSocket
  client), `python3` (+ PIL, sqlite3). `ws` npm package installed under
  `server/node_modules`.
- No browser available in-session → all verification via the headless harness.
- Port 8090 occasionally gets held by stray servers (Termux `kill %N` doesn't
  work in non-interactive shells); `server.js` now auto-falls-forward and the
  log states the real port.

## Pointers

- Full APK analysis: `~/mm_analysis/REPORT.md`
- Asset pipeline: `~/mm_analysis/pipeline/extract.py`
- Decompiled Java: `~/mm_analysis/jadx_out/sources/com/appsomniacs/`
- Agent working guide (conventions, pitfalls, how to test): `AGENT.md`
