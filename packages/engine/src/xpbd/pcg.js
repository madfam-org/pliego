// @ts-check
/**
 * Inexact Newton step with a stale preconditioner. Between refactorisations each substep solves
 * H(x̃) δ = −∇E(x̃) by preconditioned conjugate gradients, where H(x̃) is applied matrix-free
 * (mass + Gauss–Newton membrane, hinge and point-term blocks at the current positions) and the
 * preconditioner is the last Cholesky factorisation. At rest the preconditioner is exact (one
 * iteration); while the sheet moves the iteration count rises, and the World refactorises when
 * PCG needs more than `maxIter` iterations. The equilibrium never depends on any of this: the
 * gradient is always exact.
 */
import { termProjector, TERM_STRING } from './implicit.js';

/**
 * Best-fit rotation R (row-major 3×3) taking positions X0 to X over the free vertices (Horn 1987,
 * unit quaternion = dominant eigenvector of the 4×4 profile matrix, by shifted power iteration).
 * A sheet that turns rigidly changes H to (I⊗R)·H₀·(I⊗Rᵀ), so the stale factorisation is applied
 * in the co-rotated frame — page turns and swinging flaps keep converging without refactoring.
 * @param {Float64Array} X0 @param {Float64Array} X @param {Int32Array} fi
 */
export function bestRotation(X0, X, fi) {
  let n = 0;
  const c0 = [0, 0, 0], c1 = [0, 0, 0];
  for (let i = 0; i < fi.length; i++) { if (fi[i] < 0) continue; n++; for (let c = 0; c < 3; c++) { c0[c] += X0[3 * i + c]; c1[c] += X[3 * i + c]; } }
  if (!n) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let c = 0; c < 3; c++) { c0[c] /= n; c1[c] /= n; }
  const S = new Float64Array(9);
  for (let i = 0; i < fi.length; i++) {
    if (fi[i] < 0) continue;
    const a0 = X0[3 * i] - c0[0], a1 = X0[3 * i + 1] - c0[1], a2 = X0[3 * i + 2] - c0[2];
    const b0 = X[3 * i] - c1[0], b1 = X[3 * i + 1] - c1[1], b2 = X[3 * i + 2] - c1[2];
    S[0] += a0 * b0; S[1] += a0 * b1; S[2] += a0 * b2; S[3] += a1 * b0; S[4] += a1 * b1; S[5] += a1 * b2; S[6] += a2 * b0; S[7] += a2 * b1; S[8] += a2 * b2;
  }
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S;
  const N = [xx + yy + zz, yz - zy, zx - xz, xy - yx, yz - zy, xx - yy - zz, xy + yx, zx + xz, zx - xz, xy + yx, -xx + yy - zz, yz + zy, xy - yx, zx + xz, yz + zy, -xx - yy + zz];
  let shift = 0;
  for (let i = 0; i < 16; i++) shift += Math.abs(N[i]);
  let q = [1, 0, 0, 0];
  for (let it = 0; it < 60; it++) {
    const r = [0, 0, 0, 0];
    for (let a = 0; a < 4; a++) { let sum = shift * q[a]; for (let b = 0; b < 4; b++) sum += N[4 * a + b] * q[b]; r[a] = sum; }
    const L = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
    let d = 0;
    for (let a = 0; a < 4; a++) { r[a] /= L; d += Math.abs(r[a] - q[a]); }
    q = r;
    if (d < 1e-14) break;
  }
  const [w, x, y, z] = q;
  return [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z];
}

/** z ← R·P⁻¹·Rᵀ·z per 3-vector block (co-rotated stale preconditioner). */
function precond(/** @type {any} */ ch, /** @type {Float64Array} */ z, /** @type {number[]|null} */ R) {
  if (!R) { ch.solve(z); return; }
  for (let i = 0; i < z.length; i += 3) {
    const a = z[i], b = z[i + 1], c = z[i + 2];
    z[i] = R[0] * a + R[3] * b + R[6] * c; z[i + 1] = R[1] * a + R[4] * b + R[7] * c; z[i + 2] = R[2] * a + R[5] * b + R[8] * c;
  }
  ch.solve(z);
  for (let i = 0; i < z.length; i += 3) {
    const a = z[i], b = z[i + 1], c = z[i + 2];
    z[i] = R[0] * a + R[1] * b + R[2] * c; z[i + 1] = R[3] * a + R[4] * b + R[5] * c; z[i + 2] = R[6] * a + R[7] * b + R[8] * c;
  }
}

const P9 = new Float64Array(9);

/**
 * out = H p over all vertices (fixed vertices carry p = 0 and are ignored by the caller).
 * Uses w.edgeDir (unit membrane directions) and w.hingeGrad (∇θ per hinge) cached by gradient().
 * @param {any} w @param {Float64Array} x @param {Float64Array} p @param {Float64Array} out
 */
export function hessianTimes(w, x, p, out) {
  const nV = w.mesh.nV, idt2 = 1 / (w.dt * w.dt);
  for (let i = 0; i < nV; i++) { const m = w.mass[i] * idt2; out[3 * i] = m * p[3 * i]; out[3 * i + 1] = m * p[3 * i + 1]; out[3 * i + 2] = m * p[3 * i + 2]; }
  const E = w.mesh.edges, U = w.edgeDir, kM = w.edgeK;
  for (let e = 0; e < w.mesh.nE; e++) {
    const a = 3 * E[2 * e], b = 3 * E[2 * e + 1];
    const ux = U[3 * e], uy = U[3 * e + 1], uz = U[3 * e + 2];
    const s = kM[e] * (ux * (p[b] - p[a]) + uy * (p[b + 1] - p[a + 1]) + uz * (p[b + 2] - p[a + 2]));
    out[a] -= s * ux; out[a + 1] -= s * uy; out[a + 2] -= s * uz;
    out[b] += s * ux; out[b + 1] += s * uy; out[b + 2] += s * uz;
  }
  const H = w.mesh.hinges, G = w.hingeGrad;
  for (let h = 0; h < w.mesh.nH; h++) {
    const k = w.hingeK[h] + (w.driveOn[h] ? w.driveK[h] : 0);
    if (k === 0) continue;
    let s = 0;
    for (let i = 0; i < 4; i++) { const v = 3 * H[4 * h + i], g = 12 * h + 3 * i; s += G[g] * p[v] + G[g + 1] * p[v + 1] + G[g + 2] * p[v + 2]; }
    s *= k;
    for (let i = 0; i < 4; i++) { const v = 3 * H[4 * h + i], g = 12 * h + 3 * i; out[v] += s * G[g]; out[v + 1] += s * G[g + 1]; out[v + 2] += s * G[g + 2]; }
  }
  const T = w.terms;
  for (let t = 0; t < T.count; t++) {
    if (!T.active[t] || T.k[t] === 0) continue;
    if (T.mode[t] === TERM_STRING && !w._stringTaut[t]) continue;
    termProjector(T, t, x, P9);
    let rx = 0, ry = 0, rz = 0;
    for (let i = T.start[t]; i < T.start[t + 1]; i++) { const v = 3 * T.verts[i], c = T.coef[i]; rx += c * p[v]; ry += c * p[v + 1]; rz += c * p[v + 2]; }
    const k = T.k[t];
    const qx = k * (P9[0] * rx + P9[1] * ry + P9[2] * rz), qy = k * (P9[3] * rx + P9[4] * ry + P9[5] * rz), qz = k * (P9[6] * rx + P9[7] * ry + P9[8] * rz);
    for (let i = T.start[t]; i < T.start[t + 1]; i++) { const v = 3 * T.verts[i], c = T.coef[i]; out[v] += c * qx; out[v + 1] += c * qy; out[v + 2] += c * qz; }
  }
}

/**
 * Solve H δ = −g (free vertices) by PCG with the stale factorisation; δ is added to x.
 * @param {any} w @param {Float64Array} x @param {Float64Array} g gradient (3·nV)
 * @param {number} maxIter @param {number} rtol
 * @returns {{iterations:number, converged:boolean}}
 */
export function pcgStep(w, x, g, maxIter, rtol) {
  const S = w.sys, ch = S.ch, fi = S.freeIdx, nV = w.mesh.nV, n3 = 3 * S.nFree;
  const W = w._pcg ?? (w._pcg = { r: new Float64Array(n3), z: new Float64Array(n3), p: new Float64Array(n3), d: new Float64Array(n3), pv: new Float64Array(3 * nV), Ap: new Float64Array(3 * nV) });
  const { r, z, p, d, pv, Ap } = W;
  for (let i = 0; i < nV; i++) { const k = fi[i]; if (k < 0) continue; r[3 * k] = -g[3 * i]; r[3 * k + 1] = -g[3 * i + 1]; r[3 * k + 2] = -g[3 * i + 2]; }
  d.fill(0);
  let r0 = 0;
  for (let i = 0; i < n3; i++) r0 += r[i] * r[i];
  r0 = Math.sqrt(r0);
  if (r0 === 0) return { iterations: 0, converged: true };
  const R = w._factorState ? bestRotation(w._factorState.x, x, fi) : null;
  z.set(r); precond(ch, z, R);
  p.set(z);
  let rz = 0;
  for (let i = 0; i < n3; i++) rz += r[i] * z[i];
  let it = 0, converged = false;
  for (; it < maxIter; it++) {
    pv.fill(0);
    for (let i = 0; i < nV; i++) { const k = fi[i]; if (k < 0) continue; pv[3 * i] = p[3 * k]; pv[3 * i + 1] = p[3 * k + 1]; pv[3 * i + 2] = p[3 * k + 2]; }
    hessianTimes(w, x, pv, Ap);
    let pAp = 0;
    for (let i = 0; i < nV; i++) { const k = fi[i]; if (k < 0) continue; pAp += p[3 * k] * Ap[3 * i] + p[3 * k + 1] * Ap[3 * i + 1] + p[3 * k + 2] * Ap[3 * i + 2]; }
    if (!(pAp > 0)) break;
    const alpha = rz / pAp;
    let rn = 0;
    for (let i = 0; i < nV; i++) {
      const k = fi[i]; if (k < 0) continue;
      for (let c = 0; c < 3; c++) { d[3 * k + c] += alpha * p[3 * k + c]; r[3 * k + c] -= alpha * Ap[3 * i + c]; rn += r[3 * k + c] ** 2; }
    }
    if (Math.sqrt(rn) <= rtol * r0) { converged = true; it++; break; }
    if (it === 3 && Math.sqrt(rn) > 0.1 * r0) { it++; break; } // stagnating: refactor instead
    z.set(r); precond(ch, z, R);
    let rzn = 0;
    for (let i = 0; i < n3; i++) rzn += r[i] * z[i];
    const beta = rzn / rz;
    rz = rzn;
    for (let i = 0; i < n3; i++) p[i] = z[i] + beta * p[i];
  }
  if (converged) for (let i = 0; i < nV; i++) { const k = fi[i]; if (k < 0) continue; x[3 * i] += d[3 * k]; x[3 * i + 1] += d[3 * k + 1]; x[3 * i + 2] += d[3 * k + 2]; }
  return { iterations: it, converged };
}
