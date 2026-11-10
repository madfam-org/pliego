// @ts-check
// Experimental whole-mesh motion bound, not a contact force model. All eligible
// swept vertex–triangle AND edge–edge pairs participate. A global bound can stall
// sliding; diagnostics and endpoint fidelity must accompany numerical checks.
import { AdditiveCCD } from './accd.js';
import { SweptCandidates } from './swept.js';

export class MotionGuard {
  /** @param {any} w @param {number} [maxIterations] */
  constructor(w, maxIterations = 256) {
    this.mesh = w.mesh;
    this.thickness = Float64Array.from(w.mesh.vSheet, s => Math.max(0.05, w.doc.sheets[s].derived.collision_thickness));
    this.candidates = new SweptCandidates(w.mesh, this.thickness, w.opts?.contactBroadPhase);
    this.ccd = new AdditiveCCD({ maxIterations });
    this.steps = 0; this.limited = 0; this.iterationLimits = 0; this.precisionLimits = 0; this.initialOverlaps = 0; this.minimumTime = 1;
    this.last = { time: 1, queries: 0, iterations: 0, vertexTrianglePairs: 0, edgeEdgePairs: 0, status: 'clear', pair: [] };
  }
  /** Compute a bound without changing positions. @param {any} w @param {Float64Array} from @param {Float64Array} to */
  limit(w, from, to) {
    const m = this.mesh, C = this.candidates, tc = this.thickness;
    C.build(from, to, w.fixed, w.contact.weldSheet);
    const r = this.last;
    r.time = 1; r.queries = 0; r.iterations = 0; r.status = 'clear'; r.pair = [];
    r.vertexTrianglePairs = C.vertexTriangleCount; r.edgeEdgePairs = C.edgeEdgeCount;
    for (let i = 0; i < C.vertexTriangleCount; i++) {
      const v = C.vt[2 * i], t = C.vt[2 * i + 1], a = m.tris[3 * t], b = m.tris[3 * t + 1], c = m.tris[3 * t + 2];
      const time = this.ccd.query('vertex-triangle', from, to, v, a, b, c, 0.5 * (tc[v] + Math.max(tc[a], tc[b], tc[c])), r.time);
      this.note(time, [0, v, t]);
      if (r.time === 0) break;
    }
    if (r.time > 0) for (let i = 0; i < C.edgeEdgeCount; i++) {
      const e = C.ee[2 * i], f = C.ee[2 * i + 1], a = m.edges[2 * e], b = m.edges[2 * e + 1], c = m.edges[2 * f], d = m.edges[2 * f + 1];
      const time = this.ccd.query('edge-edge', from, to, a, b, c, d, 0.5 * (Math.max(tc[a], tc[b]) + Math.max(tc[c], tc[d])), r.time);
      this.note(time, [1, e, f]);
      if (r.time === 0) break;
    }
    this.steps++; if (r.time < 1) this.limited++; this.minimumTime = Math.min(this.minimumTime, r.time);
    return r;
  }
  note(time, pair) {
    const r = this.last, ccd = this.ccd;
    r.queries++; r.iterations += ccd.iterations;
    if (ccd.status === 'initial-overlap') this.initialOverlaps++;
    if (ccd.status === 'iteration-limit') this.iterationLimits++;
    if (ccd.status === 'precision-limit') this.precisionLimits++;
    if (time < r.time || ccd.status === 'initial-overlap') { r.time = time; r.status = ccd.status; r.pair = pair; }
  }
  /** Apply a free-motion bound. Moving prescribed vertices need driver coupling;
   * fail explicitly rather than silently violate their Dirichlet targets.
   * @param {any} w @param {Float64Array} from @param {Float64Array} to
   */
  apply(w, from, to) {
    const r = this.limit(w, from, to);
    if (r.status === 'initial-overlap') { to.set(from); throw new Error(`CCD: initially infeasible pair ${r.pair.join(':')}`); }
    if (r.time < 1) {
      for (let v = 0; v < this.mesh.nV; v++) if (w.fixed[v]) for (let k = 0; k < 3; k++) if (to[3 * v + k] !== from[3 * v + k]) {
        to.set(from); throw new Error('CCD: limited prescribed motion requires adaptive driver coupling');
      }
      for (let i = 0; i < to.length; i++) to[i] = from[i] + r.time * (to[i] - from[i]);
      w.dirty = true;
    }
  }
  snapshot() { return { steps: this.steps, limited: this.limited, iterationLimits: this.iterationLimits, precisionLimits: this.precisionLimits, initialOverlaps: this.initialOverlaps, minimumTime: this.minimumTime, last: { ...this.last, pair: this.last.pair.slice() } }; }
  restore(s) {
    this.steps = s.steps; this.limited = s.limited; this.iterationLimits = s.iterationLimits; this.precisionLimits = s.precisionLimits;
    this.initialOverlaps = s.initialOverlaps; this.minimumTime = s.minimumTime; this.last = { ...s.last, pair: s.last.pair.slice() };
  }
}
