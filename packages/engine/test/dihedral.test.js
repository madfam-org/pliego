// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { dihedral } from '../src/xpbd/dihedral.js';
import { World } from '../src/index.js';
import { squareValley } from './helpers/docbuilder.js';
import { mulberry32 } from '../src/geom.js';
import { proof } from './helpers/bench.js';

/** Hinge with edge p0→p1 and wings rotated so the fold angle is `theta`, randomly placed in space. */
function hinge(rnd, theta) {
  const L = 2 + 4 * rnd();
  const h0 = 1 + 3 * rnd(), h1 = 1 + 3 * rnd();
  const a0 = (0.15 + 0.7 * rnd()) * L, a1 = (0.15 + 0.7 * rnd()) * L;
  // flat layout: w0 on the −z side (local v > 0 → z < 0), w1 on +z; valley lifts both wings toward +y
  const phi0 = theta / 2, phi1 = theta / 2;
  const P = [[0, 0, 0], [L, 0, 0], [a0, h0 * Math.sin(phi0), -h0 * Math.cos(phi0)], [a1, h1 * Math.sin(phi1), h1 * Math.cos(phi1)]];
  // random rigid motion
  const ax = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
  const n = Math.hypot(...ax);
  const k = ax.map((c) => c / n), ang = 6 * rnd();
  const c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  const R = [c + k[0] * k[0] * C, k[0] * k[1] * C - k[2] * s, k[0] * k[2] * C + k[1] * s, k[1] * k[0] * C + k[2] * s, c + k[1] * k[1] * C, k[1] * k[2] * C - k[0] * s, k[2] * k[0] * C - k[1] * s, k[2] * k[1] * C + k[0] * s, c + k[2] * k[2] * C];
  const t = [10 * rnd(), 10 * rnd(), 10 * rnd()];
  const x = new Float64Array(12);
  P.forEach((p, i) => { for (let r = 0; r < 3; r++) x[3 * i + r] = R[3 * r] * p[0] + R[3 * r + 1] * p[1] + R[3 * r + 2] * p[2] + t[r]; });
  return x;
}

test('dihedral-gradient: analytic gradient matches central finite differences (incl. θ ≈ ±179°)', () => {
  const rnd = mulberry32(42);
  const DEG = Math.PI / 180;
  const angles = [0, 1e-3, -1e-3, 90 * DEG, -90 * DEG, 179 * DEG, -179 * DEG, 179.9 * DEG, -179.9 * DEG];
  for (let i = 0; i < 40; i++) angles.push((rnd() * 2 - 1) * 179 * DEG);
  let worst = 0, worstTheta = 0, maxThetaErr = 0;
  const g = new Float64Array(12);
  for (const th of angles) {
    for (let rep = 0; rep < 3; rep++) {
      const x = hinge(rnd, th);
      const t = dihedral(x, 0, 1, 2, 3, g);
      maxThetaErr = Math.max(maxThetaErr, Math.abs(t - th));
      const h = 1e-6;
      let err = 0, mag = 0;
      for (let k = 0; k < 12; k++) {
        const xp = x.slice(), xm = x.slice();
        xp[k] += h; xm[k] -= h;
        let d = dihedral(xp, 0, 1, 2, 3, null) - dihedral(xm, 0, 1, 2, 3, null);
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
        const fd = d / (2 * h);
        err = Math.max(err, Math.abs(fd - g[k]));
        mag = Math.max(mag, Math.abs(g[k]));
      }
      const rel = err / mag;
      if (rel > worst) { worst = rel; worstTheta = th; }
      // translation invariance: gradients sum to zero
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(g[c] + g[3 + c] + g[6 + c] + g[9 + c]) < 1e-9 * mag);
    }
  }
  const pass = worst < 1e-6 && maxThetaErr < 1e-9;
  proof('dihedral-gradient', worst, 0, '<1e-6 rel', pass, `${angles.length * 3} hinges, worst at θ=${(worstTheta / DEG).toFixed(2)}°, |θ−θ_built|max=${maxThetaErr.toExponential(1)}`);
  assert.ok(pass, `relative gradient error ${worst}`);
});

test('sign-convention: valley fold of a flat square is positive, mountain negative', () => {
  const { doc } = squareValley({ size: 100 });
  const w = new World(doc, { meshEdge: 25, contact: false, ground: false });
  const m = w.mesh;
  const creaseH = [];
  for (let h = 0; h < m.nH; h++) if (m.hingeKind[h] === 1) creaseH.push(h);
  assert.ok(creaseH.length > 0);
  // rotate every vertex on the (u < v) side of the diagonal about the diagonal toward the front (+Y)
  const fold = (/** @type {number} */ ang) => {
    const x = Float64Array.from(m.X0);
    const axis = [1 / Math.SQRT2, 0, -1 / Math.SQRT2]; // diagonal (0,0)→(100,100) maps to (u,0,−v)
    for (let v = 0; v < m.nV; v++) {
      const u = m.uv[2 * v], vv = m.uv[2 * v + 1];
      if (vv - u <= 1e-9) continue;
      const p = [x[3 * v], x[3 * v + 1], x[3 * v + 2]];
      const c = Math.cos(ang), s = Math.sin(ang), d = p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2];
      const cr = [axis[1] * p[2] - axis[2] * p[1], axis[2] * p[0] - axis[0] * p[2], axis[0] * p[1] - axis[1] * p[0]];
      for (let r = 0; r < 3; r++) x[3 * v + r] = p[r] * c + cr[r] * s + axis[r] * d * (1 - c);
    }
    return x;
  };
  // pick the rotation sense that lifts the moving half to +Y
  let x = fold(0.5);
  let lifted = 0;
  for (let v = 0; v < m.nV; v++) if (m.uv[2 * v + 1] - m.uv[2 * v] > 1) lifted += x[3 * v + 1];
  const sense = lifted > 0 ? 1 : -1;
  x = fold(sense * 0.5);
  const H = m.hinges;
  const valley = dihedral(x, H[4 * creaseH[0]], H[4 * creaseH[0] + 1], H[4 * creaseH[0] + 2], H[4 * creaseH[0] + 3], null);
  x = fold(-sense * 0.5);
  const mountain = dihedral(x, H[4 * creaseH[0]], H[4 * creaseH[0] + 1], H[4 * creaseH[0] + 2], H[4 * creaseH[0] + 3], null);
  const pass = valley > 0.49 && valley < 0.51 && mountain < -0.49 && mountain > -0.51;
  proof('sign-convention', `valley=${valley.toFixed(6)} mountain=${mountain.toFixed(6)}`, 'valley=+0.5 mountain=−0.5 rad', '±0.01', pass);
  assert.ok(pass);
});
