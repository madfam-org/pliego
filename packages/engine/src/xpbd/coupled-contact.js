// @ts-check
// Research candidate: elastic + finite-gap normal barrier in one incremental
// potential. Feasible iterates, matrix-free radial GN contact and CCD line search.
// No IPC equivalence claim: friction, strain/fold barriers and weighting are open.
import { BarrierContact } from '../collision/barrier.js';
import { MotionGuard } from '../collision/motion-guard.js';
import { implicitEnergy } from './energy-search.js';
import { gradient, assembleAndFactor } from './implicit.js';
import { updateTerms } from './joins.js';
import { pcgStep } from './pcg.js';

export class CoupledContact {
  /** @param {any} w @param {{barrierDistance?:number,barrierStiffness?:number,barrierIterations?:number,barrierCgIterations?:number,barrierTolerance?:number,ccdIterations?:number}} [opts] */
  constructor(w, opts = {}) {
    this.potential = new BarrierContact(w, { distance: opts.barrierDistance, stiffness: opts.barrierStiffness });
    this.guard = new MotionGuard(w, opts.ccdIterations);
    this.maxIterations = opts.barrierIterations ?? 8; this.cgIterations = opts.barrierCgIterations ?? 128;
    this.tolerance = opts.barrierTolerance ?? 1e-3;
    for (const n of [this.maxIterations, this.cgIterations]) if (!(Number.isInteger(n) && n > 0)) throw new RangeError('Coupled contact: iteration budgets must be positive integers');
    if (!(Number.isFinite(this.tolerance) && this.tolerance > 0)) throw new RangeError('Coupled contact: tolerance must be positive finite');
    this.start = new Float64Array(w.x.length); this.delta = new Float64Array(w.x.length);
    this.multiply = (p, out) => this.potential.hessianTimes(p, out);
    this.steps = 0; this.unconverged = 0; this.iterations = 0; this.cgTotal = 0; this.linearFailures = 0; this.backtracks = 0; this.rejected = 0;
    this.initialAdjustment = 0;
    this.maximumEndResidual = 0;
    this.last = { converged: false, residual: Infinity, iterations: 0, status: 'unstarted', energyBefore: 0, energyAfter: 0, incrementalEnergy: 0, barrierEnergy: 0, contacts: 0, grounded: 0, minimumGap: 0, alpha: 1 };
  }

  /** Canonicalize the initial static Dirichlet pose to its evaluated targets.
   * Only roundoff-sized differences are admitted, and the maximum is reported.
   * This is not prescribed-motion interpolation or a feasibility repair.
   */
  initialise(w) {
    w.drivers.apply(w, 0);
    for (let v = 0; v < w.mesh.nV; v++) if (w.fixed[v]) for (let k = 0; k < 3; k++) {
      const i = 3 * v + k, delta = Math.abs(w.x[i] - w.fixedTarget[i]);
      const tolerance = 64 * Number.EPSILON * Math.max(1, Math.abs(w.x[i]), Math.abs(w.fixedTarget[i]));
      if (delta > tolerance) throw new Error('Coupled contact: initial prescribed pose disagrees with targets');
      this.initialAdjustment = Math.max(this.initialAdjustment, delta); w.x[i] = w.fixedTarget[i];
    }
  }

  /** Exact first derivative of our declared potential; cache its radial GN operator. */
  evaluate(w) {
    const x = w.x, g = w.g, idt2 = 1 / w.dt ** 2;
    updateTerms(w, x); w._checkStrings(x);
    g.fill(0); gradient(w, x, g);
    const contactEnergy = this.potential.evaluate(w, x, g);
    if (!Number.isFinite(contactEnergy)) { this.last.status = 'infeasible'; throw new Error('Coupled contact: infeasible initial/iterate geometry (including strict y>0 ground)'); }
    let residual = 0;
    for (let v = 0; v < w.mesh.nV; v++) if (!w.fixed[v]) for (let k = 0; k < 3; k++) {
      const i = 3 * v + k;
      g[i] += w.mass[v] * idt2 * (x[i] - w.xt[i]); residual = Math.max(residual, Math.abs(g[i]));
    }
    if (!Number.isFinite(residual)) throw new Error('Coupled contact: non-finite force residual');
    this.last.residual = residual; this.last.contacts = this.potential.count; this.last.grounded = this.potential.groundCount;
    this.last.minimumGap = this.potential.minimumGap;
    this.last.barrierEnergy = contactEnergy; this.last.incrementalEnergy = implicitEnergy(w, x) + contactEnergy;
    return this.last.incrementalEnergy;
  }

  refactor(w) { assembleAndFactor(w, w.x); w._saveFactorState(w.x); w.dirty = false; }

  /** PCG includes contact blocks without changing the elastic sparse pattern.
   * A failed linear solve uses a preconditioned descent direction, with an
   * observable failure count and the same feasibility/energy search.
   */
  direction(w) {
    if (w.dirty || !w._factorState) this.refactor(w);
    let result = pcgStep(w, w.x, w.g, this.cgIterations, 1e-5, this.multiply, false);
    this.cgTotal += result.iterations;
    if (!result.converged) {
      this.refactor(w);
      result = pcgStep(w, w.x, w.g, this.cgIterations, 1e-5, this.multiply, false);
      this.cgTotal += result.iterations;
    }
    if (!result.converged) {
      this.linearFailures++;
      const fi = w.sys.freeIdx, rhs = w.sys.rhs;
      for (let v = 0; v < w.mesh.nV; v++) if (fi[v] >= 0) for (let k = 0; k < 3; k++) rhs[3 * fi[v] + k] = -w.g[3 * v + k];
      w.sys.ch.solve(rhs);
      for (let v = 0; v < w.mesh.nV; v++) if (fi[v] >= 0) for (let k = 0; k < 3; k++) w.x[3 * v + k] += rhs[3 * fi[v] + k];
    }
  }

  search(w, before) {
    const x = w.x, old = this.start, delta = this.delta;
    let slope = 0;
    for (let i = 0; i < x.length; i++) { delta[i] = x[i] - old[i]; if (!w.fixed[Math.floor(i / 3)]) slope += w.g[i] * delta[i]; }
    const bound = this.guard.limit(w, old, x);
    let alpha = bound.time;
    if (w.opts.ground) for (let v = 0; v < w.mesh.nV; v++) if (!w.fixed[v] && delta[3 * v + 1] < 0) alpha = Math.min(alpha, -0.9 * old[3 * v + 1] / delta[3 * v + 1]);
    const allowance = 1e-12 * Math.max(1, Math.abs(before));
    if (Number.isFinite(slope) && slope < 0 && alpha > 0 && bound.status !== 'initial-overlap') {
      for (let trial = 0; trial <= 24; trial++, alpha *= 0.5) {
        for (let i = 0; i < x.length; i++) x[i] = old[i] + alpha * delta[i];
        const after = implicitEnergy(w, x) + this.potential.evaluate(w, x);
        if (Number.isFinite(after) && after <= before + 1e-4 * alpha * slope + allowance) {
          this.backtracks += trial; this.last.alpha = alpha; this.last.energyBefore = before; this.last.energyAfter = after;
          return true;
        }
      }
    }
    x.set(old); this.rejected++; this.last.alpha = 0; this.last.status = 'rejected-step'; return false;
  }

  /** Called after the inertial target xt is built, before any projections. */
  solve(w) {
    this.steps++;
    this.last = { converged: false, residual: Infinity, iterations: 0, status: 'iteration-limit', energyBefore: 0, energyAfter: 0, incrementalEnergy: 0, barrierEnergy: 0, contacts: 0, grounded: 0, minimumGap: 0, alpha: 1 };
    for (let v = 0; v < w.mesh.nV; v++) if (w.fixed[v]) for (let k = 0; k < 3; k++) if (w.xt[3 * v + k] !== w.xs[3 * v + k]) {
      w.x.set(w.xs); this.last.status = 'prescribed-motion'; throw new Error('Coupled contact: moving prescribed vertices need adaptive driver coupling');
    }
    w.x.set(w.xs); // feasible starting pose; xt remains the inertial target
    for (let it = 0; it < this.maxIterations; it++) {
      const energy = this.evaluate(w);
      if (this.last.residual <= this.tolerance) break;
      this.start.set(w.x); this.direction(w); this.last.iterations++; this.iterations++;
      if (!this.search(w, energy)) break;
    }
    this.evaluate(w);
    this.last.converged = this.last.residual <= this.tolerance;
    this.maximumEndResidual = Math.max(this.maximumEndResidual, this.last.residual);
    if (this.last.converged) this.last.status = 'converged'; else this.unconverged++;
    w._contacts = this.last.contacts; w._grounded = this.last.grounded; w._edgeContacts = 0;
  }

  snapshot() { return { configuration: { distance: this.potential.distance, stiffness: this.potential.stiffness, iterations: this.maxIterations, cgIterations: this.cgIterations, tolerance: this.tolerance }, initialAdjustment: this.initialAdjustment, maximumEndResidual: this.maximumEndResidual, steps: this.steps, unconverged: this.unconverged, iterations: this.iterations, cgTotal: this.cgTotal, linearFailures: this.linearFailures, backtracks: this.backtracks, rejected: this.rejected, last: { ...this.last }, guard: this.guard.snapshot() }; }
  restore(s) { for (const key of ['initialAdjustment', 'maximumEndResidual', 'steps', 'unconverged', 'iterations', 'cgTotal', 'linearFailures', 'backtracks', 'rejected']) this[key] = s[key]; this.last = { ...s.last }; this.guard.restore(s.guard); }
}
