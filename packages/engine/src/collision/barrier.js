// @ts-check
// Experimental finite-gap log barrier. This is not C-IPC: no area weighting,
// parallel-edge mollification, friction or strain barrier is implemented here.
import { SweptCandidates } from './swept.js';
import { pointTriangleDistanceSquared, edgeEdgeDistanceSquared } from './distance.js';

/** b(g)=-k(g-h)^2 log(g/h) for 0<g<h; C² clamped at h.
 * Gap and activation are mm; k is g/s², b is nJ, b' is µN.
 * @param {number} gap @param {number} activation @param {number} stiffness
 * @param {Float64Array|number[]} [derivatives] receives [b',b'']
 */
export function gapBarrier(gap, activation, stiffness, derivatives) {
  if (gap <= 0 || !Number.isFinite(gap)) {
    if (derivatives) { derivatives[0] = -Infinity; derivatives[1] = Infinity; }
    return Infinity;
  }
  if (gap >= activation) { if (derivatives) { derivatives[0] = 0; derivatives[1] = 0; } return 0; }
  const z = gap - activation, log = Math.log(gap / activation), ratio = z / gap;
  if (derivatives) {
    derivatives[0] = stiffness * (-2 * z * log - z * ratio);
    derivatives[1] = stiffness * (-2 * log - 4 * ratio + ratio * ratio);
  }
  return -stiffness * z * z * log;
}

export class BarrierContact {
  /** @param {any} w @param {{distance?:number,stiffness?:number}} [opts] */
  constructor(w, opts = {}) {
    this.mesh = w.mesh; this.distance = opts.distance ?? 0.05; this.stiffness = opts.stiffness ?? 1e5;
    for (const value of [this.distance, this.stiffness]) if (!(Number.isFinite(value) && value > 0)) throw new RangeError('Barrier: distance/stiffness must be positive finite');
    this.thickness = Float64Array.from(w.mesh.vSheet, s => Math.max(0.05, w.doc.sheets[s].derived.collision_thickness));
    this.candidates = new SweptCandidates(w.mesh, this.thickness.map(t => t + this.distance));
    this.ids = new Int32Array(4); this.weights = new Float64Array(4); this.derivatives = new Float64Array(2);
    this.stencilIds = new Int32Array(4 * 1024); this.stencilGrad = new Float64Array(12 * 1024); this.curvature = new Float64Array(1024);
    this.groundCurvature = new Float64Array(w.mesh.nV);
    this.count = 0; this.groundCount = 0; this.minimumGap = this.distance; this.energy = 0;
  }

  /** Rebuild all active candidates for the supplied pose, including trial energies.
   * A gradient call caches a PSD radial GN curvature, not the exact Hessian.
   * @param {any} w @param {Float64Array} x @param {Float64Array} [gradient]
   */
  evaluate(w, x, gradient) {
    const C = this.candidates, m = this.mesh, ids = this.ids, tc = this.thickness;
    C.build(x, x, w.fixed, w.contact.weldSheet);
    if (gradient) { this.count = 0; this.groundCount = 0; this.minimumGap = this.distance; this.groundCurvature.fill(0); }
    let energy = 0;
    for (let pair = 0; pair < C.vertexTriangleCount; pair++) {
      const v = C.vt[2 * pair], t = C.vt[2 * pair + 1];
      ids[0] = v; ids[1] = m.tris[3 * t]; ids[2] = m.tris[3 * t + 1]; ids[3] = m.tris[3 * t + 2];
      energy += this.stencil(x, ids, 0.5 * (tc[v] + Math.max(tc[ids[1]], tc[ids[2]], tc[ids[3]])), true, gradient);
      if (!Number.isFinite(energy)) return Infinity;
    }
    for (let pair = 0; pair < C.edgeEdgeCount; pair++) {
      const e = C.ee[2 * pair], f = C.ee[2 * pair + 1];
      ids[0] = m.edges[2 * e]; ids[1] = m.edges[2 * e + 1]; ids[2] = m.edges[2 * f]; ids[3] = m.edges[2 * f + 1];
      energy += this.stencil(x, ids, 0.5 * (Math.max(tc[ids[0]], tc[ids[1]]) + Math.max(tc[ids[2]], tc[ids[3]])), false, gradient);
      if (!Number.isFinite(energy)) return Infinity;
    }
    // Retain the native mid-surface ground convention y>=0. Initially touching
    // free vertices are infeasible for this strict barrier, not silently lifted.
    if (w.opts.ground) for (let v = 0; v < m.nV; v++) if (!w.fixed[v]) {
      const gap = x[3 * v + 1], value = gapBarrier(gap, this.distance, this.stiffness, this.derivatives);
      if (!Number.isFinite(value)) return Infinity;
      energy += value;
      if (gradient) {
        this.minimumGap = Math.min(this.minimumGap, gap);
        gradient[3 * v + 1] += this.derivatives[0]; this.groundCurvature[v] = this.derivatives[1];
        if (gap < this.distance) this.groundCount++;
      }
    }
    if (gradient) this.energy = energy;
    return energy;
  }

  stencil(x, ids, thickness, vertexTriangle, gradient) {
    const weights = this.weights, d = Math.sqrt(vertexTriangle
      ? pointTriangleDistanceSquared(x, ids[0], ids[1], ids[2], ids[3], weights)
      : edgeEdgeDistanceSquared(x, ids[0], ids[1], ids[2], ids[3], weights));
    const gap = d - thickness, energy = gapBarrier(gap, this.distance, this.stiffness, this.derivatives);
    if (gradient) this.minimumGap = Math.min(this.minimumGap, gap);
    if (!gradient || gap >= this.distance || !Number.isFinite(energy)) return energy;
    const row = this.count;
    if (row === this.curvature.length) {
      const ids2 = new Int32Array(8 * row), grad2 = new Float64Array(24 * row), k2 = new Float64Array(2 * row);
      ids2.set(this.stencilIds); grad2.set(this.stencilGrad); k2.set(this.curvature);
      this.stencilIds = ids2; this.stencilGrad = grad2; this.curvature = k2;
    }
    this.stencilIds.set(ids, 4 * row); this.curvature[row] = this.derivatives[1];
    for (let k = 0; k < 3; k++) {
      let relative = 0;
      for (let i = 1; i < 4; i++) relative += weights[i] * (x[3 * ids[i] + k] - x[3 * ids[0] + k]);
      const normal = relative / d;
      for (let i = 0; i < 4; i++) {
        const g = weights[i] * normal;
        this.stencilGrad[12 * row + 3 * i + k] = g;
        gradient[3 * ids[i] + k] += this.derivatives[0] * g;
      }
    }
    this.count++;
    return energy;
  }

  /** Add the cached PSD radial GN operator to out; fixed entries of p must be zero. */
  hessianTimes(p, out) {
    for (let row = 0; row < this.count; row++) {
      let dot = 0;
      for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) dot += this.stencilGrad[12 * row + 3 * i + k] * p[3 * this.stencilIds[4 * row + i] + k];
      dot *= this.curvature[row];
      for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) out[3 * this.stencilIds[4 * row + i] + k] += dot * this.stencilGrad[12 * row + 3 * i + k];
    }
    for (let v = 0; v < this.mesh.nV; v++) out[3 * v + 1] += this.groundCurvature[v] * p[3 * v + 1];
  }
}
