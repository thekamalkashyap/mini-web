/* CameraController — eased follow + scope zoom. Keeps the classic eased
   follow (lerp toward the clamped target) and the RMB scope zoom. */
import { clamp, lerp } from "../../../shared/utils/math.js";

export class CameraController {
  constructor(zoomOverride = 0) {
    this.zoomOverride = zoomOverride;
    this.zoom = 1;
  }

  setup(scene, map) {
    const cam = scene.cameras.main;
    cam.setBounds(0, 0, map.w, map.h);
    cam.setBackgroundColor("#8ecbf0");
  }

  update(scene, me, dt, scoped) {
    if (!me) return;
    const cam = scene.cameras.main;
    const zoomT = this.zoomOverride ? this.zoomOverride : scoped ? 1.8 : 1;
    this.zoom = lerp(this.zoom, zoomT, 1 - Math.pow(0.001, dt));
    cam.setZoom(this.zoom);
    const vw = scene.scale.width / this.zoom,
      vh = scene.scale.height / this.zoom;
    const tx = clamp(me.cx() - vw / 2, 0, Math.max(0, scene.map.w - vw));
    const ty = clamp(me.cy() - vh / 2, 0, Math.max(0, scene.map.h - vh));
    cam.scrollX = lerp(cam.scrollX, tx, 1 - Math.pow(0.0001, dt));
    cam.scrollY = lerp(cam.scrollY, ty, 1 - Math.pow(0.0001, dt));
  }
}
