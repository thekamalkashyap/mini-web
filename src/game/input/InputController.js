/* InputController — keyboard + mouse capture, translated to sim input each
   frame. Discrete actions (reload/nade/mute/colliders) fire through hooks so
   the scene stays the only mode-switch. */
export class InputController {
  /* hooks: { onReload, onNade, onToggleMute, onToggleColliders, getMe }
     opts:  { demo } (demo = auto-fire forward, visual debugging) */
  constructor(scene, opts, hooks) {
    this.scene = scene;
    this.opts = opts || {};
    this.hooks = hooks || {};
    this.lmb = false;
    this.rmb = false;
    this.demoHold = !!this.opts.demo;
  }

  attach() {
    const kb = this.scene.input.keyboard;
    this.keys = kb.addKeys({
      left: "A",
      right: "D",
      jet: "W",
      up: "UP",
      leftA: "LEFT",
      rightA: "RIGHT",
      space: "SPACE",
      use: "E",
    });
    kb.on("keydown-R", () => this.hooks.onReload && this.hooks.onReload());
    kb.on("keydown-G", () => this.hooks.onNade && this.hooks.onNade());
    kb.on("keydown-M", () => this.hooks.onToggleMute && this.hooks.onToggleMute());
    kb.on("keydown-BACKTICK", () => {
      this.hooks.onToggleColliders && this.hooks.onToggleColliders();
    });
    this.scene.input.mouse && this.scene.input.mouse.disableContextMenu();
    this.scene.input.on("pointerdown", (p) => {
      if (p.leftButtonDown()) this.lmb = true;
      if (p.rightButtonDown()) this.rmb = true;
    });
    this.scene.input.on("pointerup", (p) => {
      if (!p.leftButtonDown()) this.lmb = false;
      if (!p.rightButtonDown()) this.rmb = false;
    });
  }

  humanInput() {
    const k = this.keys,
      cam = this.scene.cameras.main;
    const ptr = this.scene.input.activePointer;
    const wp = cam.getWorldPoint(ptr.x, ptr.y);
    const inp = {
      left: k.left.isDown || k.leftA.isDown,
      right: k.right.isDown || k.rightA.isDown,
      jet: k.jet.isDown || k.space.isDown || k.up.isDown,
      fire: !!this.lmb || !!this.demoHold,
      use: k.use.isDown,
      aimX: wp.x,
      aimY: wp.y,
    };
    if (this.opts.demo) {
      const me = this.hooks.getMe && this.hooks.getMe();
      inp.fire = true;
      inp.aimX = me ? me.cx() + 400 : wp.x;
      inp.aimY = me ? me.cy() - 100 : wp.y;
    }
    return inp;
  }
}
