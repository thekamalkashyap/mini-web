/* Sfx — WebAudio via Phaser's sound manager (established lib), same API the
   legacy Sfx exposed: play(name, vol, rate), loop(name, vol) -> {stop()}, and
   a global mute. Buffers come from the carved .ckb wav bank. */
export const SND_NAMES = ["ak47","awol","back","base","basics","bolt","boots","bringit","center","checkpoint","clank","cmonboy","control","coverme","dead","deagle","death1","death2","death3","death4","death5","death6","death7","death8","death9","destroy","disassemble","dryfire","energy","explode","explosives","flame","future","gas","getsome","good","goodgame","gotit","gotme","green","grenade1","grenade2","grenades","hoorah","impact","impact2","impact3","impale","jet","jump","jumps","laser","live","lock","look","m14","m16","m61","m93ba","made","magnum","malfunction","mecha","melee","moveout","mp5","niceshot","no","nuts","over","perfect","pickup","piece","proxy","pull","readyup","reload","rg6","ricochet","rocket","saw","shotgun","silencer","snatch","soar","standdown","switch","targets","tavor","tec9","thanks","think","throw","thrust","time","ugly","uzi","welcome","well","weps","will","xm8","yeah","zoom"].map(n => n + ".wav");

export class Sfx {
  constructor(soundManager) { this.sound = soundManager; this._muted = false; }
  get muted() { return this._muted; }
  toggleMute() { this._muted = !this._muted; if (this.sound) this.sound.mute = this._muted; return this._muted; }
  play(name, vol = 1, rate = 1) {
    if (!this.sound || this._muted || !this.sound.get(name)) return;
    try { this.sound.play(name, { volume: vol, rate, detune: 0 }); } catch (e) { /* busy sound manager */ }
  }
  loop(name, vol = 0.5) {
    if (!this.sound || !this.sound.get(name)) return { stop() {} };
    try {
      const s = this.sound.add(name, { loop: true, volume: vol });
      s.play();
      return { stop() { try { s.stop(); s.destroy(); } catch (e) {} } };
    } catch (e) { return { stop() {} }; }
  }
}
