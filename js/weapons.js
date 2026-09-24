/* Weapon definitions — ids match TMX pickup property values datamined from the APK.
   sprite/flash = menuTexture atlas frames; sfx = carved .ckb clips.
   Balancing approximates the original's feel (rpm, dmg, mag, spread). */
const WEAPONS = {
  m61:         { name:"M61",        sprite:"m61.png",        empty:"m61E.png",   sfx:"m61",     rpm:500, dmg:8,  pellets:1, speed:1500, mag:30, reload:1.6, spread:0.050, auto:true, kick:0.08,
    magFrame:"m61Mag.png" },
  ak47:        { name:"AK-47",      sprite:"ak47.png",       empty:"ak47E.png",  sfx:"ak47",    rpm:540, dmg:11, pellets:1, speed:1600, mag:30, reload:1.8, spread:0.045, auto:true, kick:0.09,
    magFrame:"ak47Mag.png" },
  m16:         { name:"M16",        sprite:"m16.png",        empty:"m16E.png",   sfx:"m16",     rpm:460, dmg:13, pellets:1, speed:1700, mag:30, reload:1.7, spread:0.030, auto:false, kick:0.10,
    magFrame:"m16Mag.png" },
  m14:         { name:"M14",        sprite:"hunting.png",    empty:"ak47E.png",  sfx:"m14",     rpm:320, dmg:15, pellets:1, speed:1700, mag:20, reload:1.8, spread:0.025, auto:false, kick:0.11,
    magFrame:"huntingMag.png" },
  mp5:         { name:"MP5",        sprite:"mp5.png",        empty:"mp5E.png",   sfx:"mp5",     rpm:800, dmg:7,  pellets:1, speed:1400, mag:32, reload:1.5, spread:0.060, auto:true, kick:0.06,
    magFrame:"mp5Mag.png" },
  uzi:         { name:"UZI",        sprite:"uzi.png",        empty:"uziE.png",   sfx:"uzi",     rpm:950, dmg:6,  pellets:1, speed:1300, mag:28, reload:1.4, spread:0.080, auto:true, kick:0.05,
    magFrame:"uziMag.png" },
  tec9:        { name:"TEC-9",      sprite:"tec9.png",       empty:"tec9E.png",  sfx:"tec9",    rpm:900, dmg:7,  pellets:1, speed:1350, mag:26, reload:1.4, spread:0.070, auto:true, kick:0.06,
    magFrame:"tec9Mag.png" },
  tavor:       { name:"TAVOR",      sprite:"tavor.png",      empty:"tavorE.png", sfx:"tavor",   rpm:620, dmg:10, pellets:1, speed:1600, mag:30, reload:1.7, spread:0.040, auto:true, kick:0.08,
    magFrame:"tavorMag.png" },
  xm8:         { name:"XM8",        sprite:"xm8.png",        empty:"xm8E.png",   sfx:"xm8",     rpm:600, dmg:10, pellets:1, speed:1650, mag:30, reload:1.7, spread:0.040, auto:true, kick:0.08,
    magFrame:"xm8Mag.png" },
  shotgun:     { name:"SHOTGUN",    sprite:"shotgun.png",    sfx:"shotgun", rpm:75,  dmg:8,  pellets:7, speed:1200, mag:8,  reload:2.2, spread:0.160, auto:false, kick:0.14,
    magFrame:"shotgunMag.png" },
  sawgun:      { name:"SAW",        sprite:"sawgun.png",     empty:"ak47E.png",  sfx:"saw",     rpm:850, dmg:8,  pellets:1, speed:1500, mag:100,reload:3.0, spread:0.070, auto:true, kick:0.06 },
  minigun:     { name:"MINIGUN",    sprite:"sawgun.png",     empty:"ak47E.png",  sfx:"saw",     rpm:1000,dmg:7,  pellets:1, speed:1500, mag:150,reload:3.5, spread:0.090, auto:true, kick:0.07 },
  m93ba:       { name:"M93BA",      sprite:"sniper.png",     sfx:"m93ba",   rpm:45,  dmg:45, pellets:1, speed:2400, mag:5,  reload:2.6, spread:0.005, auto:false, zoom:true, kick:0.18,
    magFrame:"sniperMag.png" },
  m1881:       { name:"M1881",      sprite:"m1881.png",      sfx:"shotgun", rpm:100, dmg:30, pellets:1, speed:1900, mag:8,  reload:2.4, spread:0.020, auto:false, kick:0.16 },
  magnum:      { name:"MAGNUM",     sprite:"magnum.png",     empty:"magnumE.png",sfx:"magnum",  rpm:240, dmg:18, pellets:1, speed:1700, mag:6,  reload:1.8, spread:0.020, auto:false, kick:0.10 },
  deagle:      { name:"DEAGLE",     sprite:"desertEagle.png",empty:"desertEagleE.png", sfx:"deagle", rpm:180, dmg:22, pellets:1, speed:1750, mag:7, reload:1.9, spread:0.018, auto:false, kick:0.12,
    magFrame:"desertEagleMag.png" },
  gdeagle:     { name:"GOLD DEAGLE",sprite:"gDesertEagle.png",empty:"gDesertEagleE.png", sfx:"deagle", rpm:200, dmg:26, pellets:1, speed:1800, mag:7, reload:1.9, spread:0.016, auto:false, kick:0.12,
    magFrame:"desertEagleMag.png" },
  aa12:        { name:"AA-12",      sprite:"aa12.png",       empty:"aa12E.png",  sfx:"shotgun", rpm:300, dmg:9,  pellets:5, speed:1300, mag:20, reload:2.6, spread:0.120, auto:true, kick:0.11,
    magFrame:"aa12Mag.png" },
  emp:         { name:"EMP RIFLE",  sprite:"emp.png",        empty:"empE.png",   sfx:"energy",  rpm:300, dmg:14, pellets:1, speed:1500, mag:16, reload:2.0, spread:0.020, auto:true, kick:0.08,
    magFrame:"empMag.png" },
  laser:       { name:"LASER",      sprite:"laser.png",      sfx:"laser",   rpm:240, dmg:16, pellets:1, speed:9999, mag:12, reload:2.0, spread:0.000, auto:false, beam:true, kick:0.06 },
  phasr:       { name:"PHASR",      sprite:"laser.png",      sfx:"energy",  rpm:340, dmg:12, pellets:1, speed:1800, mag:24, reload:1.8, spread:0.030, auto:true, kick:0.07,
    magFrame:"phasrMag.png" },
  smaw:        { name:"SMAW",       sprite:"smaw.png",       sfx:"rocket",  rpm:40,  dmg:80, pellets:1, speed:900,  mag:1,  reload:3.0, spread:0.010, auto:false, rocket:true, splash:150, kick:0.20 },
  rg6:         { name:"RG6",        sprite:"rg6.png",        sfx:"rg6",     rpm:150, dmg:38, pellets:1, speed:1000, mag:6,  reload:2.8, spread:0.012, auto:false, rocket:true, splash:130, arc:true, kick:0.15,
    magFrame:"rg6Mag.png" },
  flame:       { name:"FLAMETHROWER", sprite:"flamethrower.png",     sfx:"flame",   rpm:1200,dmg:5,  pellets:1, speed:520,  mag:100,reload:3.0, spread:0.140, auto:true, flame:true, range:280, kick:0.03,
    magFrame:"flamethrowerMag.png" },
  machete:     { name:"MACHETE",    sprite:"machete.png",    sfx:"melee",   rpm:130, dmg:34, pellets:1, speed:0,   mag:0,  reload:0,   spread:0,     auto:true, melee:true, range:130, kick:0.05 },
  riot:        { name:"RIOT SHIELD",sprite:"crouchShield.png",sfx:"melee",   rpm:100, dmg:15, pellets:1, speed:0,   mag:0,  reload:0,   spread:0,     auto:true, melee:true, range:110, shield:0.45, kick:0.05 },
  /* pickups that are not weapons */
  healthpack:  { name:"MED PACK",   item:"health", sprite:"medPack.png" },
  boosttank:   { name:"BOOST TANK", item:"fuel",   sprite:"boost.png" },
  shield:      { name:"SHIELD",     item:"shield", sprite:"shield.png" },
};

/* grenade-style throwables share one generic behaviour */
const NADES = {
  fragnade:  { sprite:"grenade.png", dmg:55, splash:150, fuse:2.0 },
  gasnade:   { sprite:"gasNade.png", dmg:4,  splash:120, fuse:3.5, dot:6 },
  proxynade: { sprite:"grenade.png", dmg:55, splash:150, fuse:0,   proxy:220 },
  empnade:   { sprite:"empNade.png", dmg:20, splash:170, fuse:2.0, emp:true },
};

/* fire sound lookup fallback */
function fireSoundOf(w) { return w.sfx || "dryfire"; }
