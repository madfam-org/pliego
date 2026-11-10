// @ts-check
// Experimental globalization of the existing implicit GN/PCG step. This only
// controls elastic updates; it does not make subsequent contact projections
// energy-decreasing, intersection-free, or a converged implicit solve.
import { dihedral } from './dihedral.js';
import { unwrap, termResidual, termProjector, TERM_STRING } from './implicit.js';
import { hypot3 } from '../fastmath.js';

/** The actual per-substep implicit objective, in nJ. @param {any} w @param {Float64Array} x */
export function implicitEnergy(w, x) {
  let energy = 0;
  const { mesh, terms: T } = w, idt2 = 1 / (w.dt * w.dt);
  for (let v = 0; v < mesh.nV; v++) if (w.invMass[v]) {
    for (let c = 0; c < 3; c++) energy += 0.5 * w.mass[v] * idt2 * (x[3 * v + c] - w.xt[3 * v + c]) ** 2;
  }
  for (let e = 0; e < mesh.nE; e++) {
    const a = 3 * mesh.edges[2 * e], b = 3 * mesh.edges[2 * e + 1];
    const d = hypot3(x[b] - x[a], x[b + 1] - x[a + 1], x[b + 2] - x[a + 2]) - mesh.edgeLen[e];
    energy += 0.5 * (d < 0 ? w.kCompFactor : 1) * w.kMem[e] * d * d;
  }
  for (let h = 0; h < mesh.nH; h++) {
    const o = 4 * h;
    const angle = unwrap(w.theta[h], dihedral(x, mesh.hinges[o], mesh.hinges[o + 1], mesh.hinges[o + 2], mesh.hinges[o + 3], null));
    energy += 0.5 * w.hingeK[h] * ((angle - w.restTheta[h]) ** 2 + w.bendDamp * (angle - w.theta[h]) ** 2);
    if (w.driveOn[h]) energy += 0.5 * w.driveK[h] * w.handScale * (angle - w.driveTarget[h]) ** 2;
  }
  const r = [0, 0, 0], P = new Float64Array(9);
  for (let t = 0; t < T.count; t++) {
    if (!T.active[t] || !T.k[t]) continue;
    termResidual(T, t, x, r);
    if (T.mode[t] === TERM_STRING) {
      const d = Math.max(0, hypot3(r[0], r[1], r[2]) - T.len[t]);
      energy += 0.5 * T.k[t] * d * d;
    } else {
      termProjector(T, t, x, P);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) energy += 0.5 * T.k[t] * r[a] * P[3 * a + b] * r[b];
    }
  }
  return energy;
}

export class EnergySearch {
  constructor(n) { this.start = new Float64Array(n); this.delta = new Float64Array(n); this.energy = 0; this.backtracks = 0; this.rejected = 0; }
  begin(w) {
    this.start.set(w.x); this.energy = implicitEnergy(w, w.x);
    if (!Number.isFinite(this.energy)) throw new Error('Implicit objective is non-finite before the Newton step');
  }
  finish(w, gradient) {
    const x = w.x, old = this.start, d = this.delta;
    let slope = 0;
    for (let i = 0; i < x.length; i++) { d[i] = x[i] - old[i]; if (w.invMass[Math.floor(i / 3)]) slope += gradient[i] * d[i]; }
    const allowance = 1e-12 * Math.max(1, this.energy);
    if (Number.isFinite(slope) && slope <= 0) {
      for (let trial = 0; trial <= 20; trial++) {
        const alpha = 2 ** -trial;
        if (trial) for (let i = 0; i < x.length; i++) x[i] = old[i] + alpha * d[i];
        const energy = implicitEnergy(w, x);
        if (Number.isFinite(energy) && energy <= this.energy + 1e-4 * alpha * slope + allowance) {
          this.backtracks += trial; if (trial) w.dirty = true; return;
        }
      }
    }
    // A failed line search is an observable rejected update, never a green
    // convergence result. The next substep refactors at the restored position.
    x.set(old); this.rejected++; w.dirty = true;
  }
}
