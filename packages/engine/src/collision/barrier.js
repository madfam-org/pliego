// @ts-check
// Experimental finite-gap log barrier, optionally smoothing covered EE energy.
// This is not C-IPC: area weighting, friction and strain barriers remain open.
import { SweptCandidates } from './swept.js';
import { pointTriangleDistanceSquared, edgeEdgeDistanceSquared } from './distance.js';
import { edgeLengthSquared, edgeEdgeMollifier } from './edge-mollifier.js';
import { SurfaceCoverage } from './surface-coverage.js';

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
    this.candidates = new SweptCandidates(w.mesh, this.thickness.map(t => t + this.distance), w.opts?.contactBroadPhase);
    const mode = w.opts?.edgeEdgeMollification ?? 'off';
    if (!['off', 'surface-guarded'].includes(mode)) throw new RangeError('Barrier: invalid edgeEdgeMollification');
    this.surface = mode === 'surface-guarded' ? new SurfaceCoverage(this.candidates, this.thickness) : null;
    if (this.surface && (!w.X0 || w.X0.length !== 3 * w.mesh.nV)) throw new Error('Barrier: mollification requires immutable rest positions');
    this.restEdgeSquared = this.surface ? Float64Array.from({ length: w.mesh.nE }, (_, e) => edgeLengthSquared(w.X0, w.mesh.edges[2 * e], w.mesh.edges[2 * e + 1])) : new Float64Array();
    this.multiplier = new Float64Array(3); this.multiplierGradient = new Float64Array(12); this.crossJacobian = new Float64Array(36); this.distanceGradient = new Float64Array(12);
    this.ids = new Int32Array(4); this.weights = new Float64Array(4); this.derivatives = new Float64Array(2);
    this.stencilIds = new Int32Array(4 * 1024); this.stencilGrad = new Float64Array(12 * 1024); this.curvature = new Float64Array(1024);
    this.groundCurvature = new Float64Array(w.mesh.nV);
    this.count = 0; this.pairCount = 0; this.groundCount = 0; this.minimumGap = this.distance; this.energy = 0;
    this.activeEdges = 0; this.smoothedEdges = 0; this.uncoveredEdges = 0; this.parallelEdges = 0;
  }

  /** Rebuild all active candidates for the supplied pose, including trial energies.
   * A gradient call caches a PSD radial GN curvature, not the exact Hessian.
   * At overlapping parallel EE closest-point ties this is a selected branch
   * derivative; the unmollified distance potential is not differentiable there.
   * @param {any} w @param {Float64Array} x @param {Float64Array} [gradient]
   */
  evaluate(w, x, gradient) {
    const C = this.candidates, m = this.mesh, ids = this.ids, tc = this.thickness;
    C.build(x, x, w.fixed, w.contact.weldSheet);
    if (gradient) {
      this.count = 0; this.pairCount = 0; this.groundCount = 0; this.minimumGap = this.distance; this.groundCurvature.fill(0);
      this.activeEdges = 0; this.smoothedEdges = 0; this.uncoveredEdges = 0; this.parallelEdges = 0;
    }
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
      const offset = 0.5 * (Math.max(tc[ids[0]], tc[ids[1]]) + Math.max(tc[ids[2]], tc[ids[3]]));
      energy += this.surface ? this.smoothedStencil(w, x, ids, offset, e, f, gradient) : this.stencil(x, ids, offset, false, gradient);
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
    this.pairCount++;
    this.radial(x, ids, d, gradient);
    return energy;
  }

  /** Unchanged radial branch for VT, disabled smoothing and uncovered EE. */
  radial(x, ids, d, gradient) {
    const weights = this.weights, row = this.reserve(ids, this.derivatives[1]);
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
  }

  reserve(ids, curvature) {
    const row = this.count;
    if (row === this.curvature.length) {
      const ids2 = new Int32Array(8 * row), grad2 = new Float64Array(24 * row), k2 = new Float64Array(2 * row);
      ids2.set(this.stencilIds); grad2.set(this.stencilGrad); k2.set(this.curvature);
      this.stencilIds = ids2; this.stencilGrad = grad2; this.curvature = k2;
    }
    this.stencilIds.set(ids, 4 * row); this.curvature[row] = curvature;
    this.count++;
    return row;
  }

  cache(ids, buffer, curvature, offset = 0) {
    if (curvature === 0) return;
    const row = this.reserve(ids, curvature);
    for (let i = 0; i < 12; i++) this.stencilGrad[12 * row + i] = buffer[offset + i];
  }

  /** Exact gradient of m(c)b(g), with an explicitly approximate PSD operator:
   * m b'' dg dgᵀ + 2 b m' JcrossᵀJcross. Mixed/feature second derivatives
   * are omitted; this is NOT an exact Hessian or a spectral PSD projection.
   * Strict infeasibility is checked before multiplication, including m=0.
   */
  smoothedStencil(w, x, ids, thickness, e, f, gradient) {
    const d = Math.sqrt(edgeEdgeDistanceSquared(x, ids[0], ids[1], ids[2], ids[3], this.weights));
    const gap = d - thickness, energy = gapBarrier(gap, this.distance, this.stiffness, this.derivatives);
    if (gradient) this.minimumGap = Math.min(this.minimumGap, gap);
    if (gap >= this.distance || !Number.isFinite(energy)) return energy;
    const values = this.multiplier, dm = this.multiplierGradient, J = this.crossJacobian, q = this.distanceGradient;
    edgeEdgeMollifier(x, ids, 1e-3 * this.restEdgeSquared[e] * this.restEdgeSquared[f], values, gradient ? dm : undefined, gradient ? J : undefined);
    const covered = values[0] < 1 && this.surface?.covers(w, e, f, thickness);
    if (gradient) {
      this.pairCount++; this.activeEdges++;
      if (values[0] < 1) { if (covered) { this.smoothedEdges++; if (values[0] === 0) this.parallelEdges++; } else this.uncoveredEdges++; }
    }
    if (!covered) { if (gradient) this.radial(x, ids, d, gradient); return energy; }
    const m = values[0];
    if (!gradient) return m * energy;
    for (let k = 0; k < 3; k++) {
      let relative = 0;
      for (let i = 1; i < 4; i++) relative += this.weights[i] * (x[3 * ids[i] + k] - x[3 * ids[0] + k]);
      const normal = relative / d;
      for (let i = 0; i < 4; i++) {
        const j = 3 * i + k;
        q[j] = this.weights[i] * normal;
        gradient[3 * ids[i] + k] += m * this.derivatives[0] * q[j] + energy * dm[j];
      }
    }
    this.cache(ids, q, m * this.derivatives[1]);
    const angular = 2 * energy * values[1];
    for (let k = 0; k < 3; k++) this.cache(ids, J, angular, 12 * k);
    return m * energy;
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
