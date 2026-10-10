// @ts-check
// Orbit camera: yaw/pitch/distance around a target, Y up. Produces view/projection matrices and
// world-space picking rays from normalised device coordinates.

import { mat4, vec3, clamp, DEG } from './math.js';

export class OrbitCamera {
  constructor() {
    this.target = [0, 0, 0];
    this.yaw = -30 * DEG;      // around +Y, 0 = looking down −Z from +Z
    this.pitch = 35 * DEG;     // elevation above the ground plane
    this.distance = 400;
    this.fovy = 40 * DEG;
    this.aspect = 1;
    this.minDistance = 20;
    this.maxDistance = 5000;
    this.view = mat4.create();
    this.proj = mat4.create();
    this.viewProj = mat4.create();
    this.invViewProj = mat4.create();
    this.home = null;
  }

  /** @returns {number[]} eye position */
  eye() {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
  }

  orbit(dYaw, dPitch) {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -85 * DEG, 89 * DEG);
  }

  zoom(factor) {
    this.distance = clamp(this.distance * factor, this.minDistance, this.maxDistance);
  }

  /** Pan in the view plane by a fraction of the visible height. */
  pan(dxFrac, dyFrac) {
    const h = 2 * this.distance * Math.tan(this.fovy / 2);
    const right = [this.view[0], this.view[4], this.view[8]];
    const up = [this.view[1], this.view[5], this.view[9]];
    const d = vec3.add(vec3.scale(right, -dxFrac * h * this.aspect), vec3.scale(up, dyFrac * h));
    this.target = vec3.add(this.target, d);
  }

  /** Frame a bounding sphere and remember it as home. */
  fit(center, radius) {
    this.target = [center[0], center[1], center[2]];
    const r = Math.max(radius, 10);
    this.distance = clamp(r / Math.sin(this.fovy / 2) * 1.15, this.minDistance, this.maxDistance);
    this.minDistance = r * 0.15;
    this.maxDistance = Math.max(r * 30, 500);
    this.home = { target: [...this.target], yaw: this.yaw, pitch: this.pitch, distance: this.distance };
  }

  reset() {
    if (!this.home) return;
    this.target = [...this.home.target];
    this.yaw = this.home.yaw; this.pitch = this.home.pitch; this.distance = this.home.distance;
  }

  update(aspect) {
    this.aspect = aspect > 0 ? aspect : 1;
    const near = Math.max(this.distance * 0.01, 0.5), far = this.distance * 20 + 2000;
    mat4.perspective(this.fovy, this.aspect, near, far, this.proj);
    mat4.lookAt(this.eye(), this.target, [0, 1, 0], this.view);
    mat4.multiply(this.proj, this.view, this.viewProj);
    mat4.invert(this.viewProj, this.invViewProj);
  }

  /**
   * World ray through NDC (x, y ∈ [−1, 1], y up).
   * @returns {{origin: number[], dir: number[]}}
   */
  ray(ndcX, ndcY) {
    const a = mat4.transformPoint(this.invViewProj, [ndcX, ndcY, -1]);
    const b = mat4.transformPoint(this.invViewProj, [ndcX, ndcY, 1]);
    return { origin: a, dir: vec3.normalize(vec3.sub(b, a)) };
  }

  /** Unit vector from the target toward the eye. */
  forward() {
    return vec3.normalize(vec3.sub(this.eye(), this.target));
  }
}

/** Ray–plane intersection; plane through `p` with normal `n`. Returns null when parallel/behind. */
export function rayPlane(origin, dir, p, n) {
  const den = vec3.dot(dir, n);
  if (Math.abs(den) < 1e-9) return null;
  const t = vec3.dot(vec3.sub(p, origin), n) / den;
  return t < 0 ? null : vec3.add(origin, vec3.scale(dir, t));
}
