// @ts-check
// Direct radial GN solve only when every active free contact pair fits the
// existing elastic graph. General nonlocal self contact needs another pattern.
import { BlockCholesky } from '../linalg/blockchol.js';
import { assembleElastic } from './implicit.js';

export class LocalContactSolve {
  /** @param {any} w */
  constructor(w) {
    const elastic = w.sys.ch, pairs = [];
    if (elastic) for (let c = 0; c < elastic.n; c++) for (let p = elastic.Ap[c]; p < elastic.Ap[c + 1]; p++) {
      if (elastic.Ai[p] !== c) pairs.push(elastic.perm[elastic.Ai[p]], elastic.perm[c]);
    }
    // Identical graph and deterministic ordering give identical assembly slots.
    // Separate values/factors leave the saved PCG preconditioner untouched.
    this.ch = elastic ? new BlockCholesky(elastic.n, Int32Array.from(pairs)) : null;
    this.block = new Float64Array(9); this.ids = new Int32Array(4); this.grad = new Float64Array(12);
    this.rhs = new Float64Array(3 * w.sys.nFree);
  }

  /** Collapse repeated vertex IDs and remove fixed/zero-gradient entries. */
  stencil(w, potential, row) {
    this.grad.fill(0); let count = 0;
    for (let i = 0; i < 4; i++) {
      const v = potential.stencilIds[4 * row + i], free = w.sys.freeIdx[v];
      if (free < 0) continue;
      let q = 0; while (q < count && this.ids[q] !== free) q++;
      if (q === count) this.ids[count++] = free;
      for (let k = 0; k < 3; k++) this.grad[3 * q + k] += potential.stencilGrad[12 * row + 3 * i + k];
    }
    for (let i = count - 1; i >= 0; i--) if (this.grad[3 * i] === 0 && this.grad[3 * i + 1] === 0 && this.grad[3 * i + 2] === 0) {
      count--;
      this.ids.copyWithin(i, i + 1, count + 1); this.grad.copyWithin(3 * i, 3 * i + 3, 3 * count + 3);
    }
    return count;
  }

  /** Check all free pair slots before changing any matrix or position. */
  supports(w, potential) {
    const ch = this.ch; if (!ch) return true;
    for (let row = 0; row < potential.count; row++) {
      if (potential.curvature[row] === 0) continue;
      const count = this.stencil(w, potential, row);
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
        try { ch.slot(this.ids[i], this.ids[j]); } catch (e) { if (e instanceof RangeError) return false; throw e; }
      }
    }
    return true;
  }

  /** Fresh assembly/factor each call; no scratch factor survives as solver state.
   * Returns false on a nonlocal contact graph, with no mutation to x or the
   * elastic preconditioner. The caller must explicitly fall back or refuse.
   */
  solve(w, potential) {
    if (!this.supports(w, potential)) return false;
    const ch = this.ch; if (!ch) return true;
    assembleElastic(w, w.x, ch, true);
    const B = this.block, G = this.grad;
    for (let row = 0; row < potential.count; row++) {
      const count = this.stencil(w, potential, row), k = potential.curvature[row];
      for (let i = 0; i < count; i++) for (let j = i; j < count; j++) {
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) B[3 * r + c] = k * G[3 * i + r] * G[3 * j + c];
        ch.add(ch.slot(this.ids[i], this.ids[j]), B);
      }
    }
    const fi = w.sys.freeIdx;
    for (let v = 0; v < w.mesh.nV; v++) if (fi[v] >= 0) {
      B.fill(0); B[4] = potential.groundCurvature[v]; ch.add(ch.slot(fi[v], fi[v]), B);
      for (let k = 0; k < 3; k++) this.rhs[3 * fi[v] + k] = -w.g[3 * v + k];
    }
    ch.factor(); w.factorCount++; ch.solve(this.rhs);
    for (let v = 0; v < w.mesh.nV; v++) if (fi[v] >= 0) for (let k = 0; k < 3; k++) w.x[3 * v + k] += this.rhs[3 * fi[v] + k];
    return true;
  }
}
