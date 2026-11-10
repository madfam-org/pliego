import test from 'node:test';
import assert from 'node:assert/strict';
import { gapBarrier, BarrierContact } from '../src/collision/barrier.js';

function fixture(kind) {
  const vt = kind === 'vertex-triangle';
  const mesh = { nV: 4, nT: vt ? 1 : 0, nE: vt ? 3 : 2,
    tris: new Int32Array(vt ? [1, 2, 3] : []), edges: new Int32Array(vt ? [1, 2, 2, 3, 3, 1] : [0, 1, 2, 3]),
    vGroup: new Int32Array([0, 1, 2, 3]), vSheet: new Int32Array(4), triSheet: new Int32Array(vt ? [0] : []) };
  return { mesh, opts: { ground: false }, fixed: new Uint8Array(vt ? [0, 1, 1, 1] : [0, 0, 0, 0]),
    contact: { weldSheet: new Int32Array(4).fill(-1) }, doc: { sheets: [{ derived: { collision_thickness: 0.1 } }] } };
}

test('finite-gap barrier derivatives match finite differences and clamp C2 at activation', () => {
  const derivatives = new Float64Array(2); let maximum = 0;
  for (const gap of [0.001, 0.005, 0.02, 0.04, 0.049]) {
    const h = gap * 1e-4, energy = gapBarrier(gap, 0.05, 2.3, derivatives);
    const first = (gapBarrier(gap + h, 0.05, 2.3) - gapBarrier(gap - h, 0.05, 2.3)) / (2 * h);
    const second = (gapBarrier(gap + h, 0.05, 2.3) - 2 * energy + gapBarrier(gap - h, 0.05, 2.3)) / h ** 2;
    for (const [a, b] of [[first, derivatives[0]], [second, derivatives[1]]]) {
      const error = Math.abs(a - b) / Math.max(1, Math.abs(b)); maximum = Math.max(maximum, error); assert.ok(error < 1e-5);
    }
    assert.ok(derivatives[0] < 0 && derivatives[1] > 0);
  }
  assert.equal(gapBarrier(0.05, 0.05, 2.3, derivatives), 0); assert.deepEqual([...derivatives], [0, 0]);
  assert.equal(gapBarrier(0, 0.05, 2.3), Infinity); assert.equal(gapBarrier(-0.01, 0.05, 2.3), Infinity);
  assert.ok(gapBarrier(0.05 - 1e-9, 0.05, 2.3, derivatives) < 1e-20); assert.ok(derivatives[1] < 1e-5);
  console.log(`barrier-scalar: derivative fixtures=5, normalized FD error=${maximum}, C2 clamp and infeasible domain explicit`);
});

test('VT/EE barrier forces match whole-stencil finite differences and balance internal force/torque', () => {
  let checks = 0;
  for (const kind of ['vertex-triangle', 'edge-edge']) {
    const w = fixture(kind), B = new BarrierContact(w, { stiffness: 2.3 });
    const x = new Float64Array(kind === 'vertex-triangle'
      ? [-0.01, 0.12, 0.25, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      : [-1, 0, 0, 1, 0, 0, 0, 0.12, -1, 0, 0.12, 1]);
    const g = new Float64Array(12); assert.ok(B.evaluate(w, x, g) > 0); assert.equal(B.count, 1);
    for (let i = 0; i < 12; i++) {
      const a = x.slice(), b = x.slice(), h = 1e-7; a[i] += h; b[i] -= h;
      const fd = (B.evaluate(w, a) - B.evaluate(w, b)) / (2 * h);
      assert.ok(Math.abs(fd - g[i]) < 1e-7); checks++;
    }
    const force = [0, 0, 0], torque = [0, 0, 0];
    for (let v = 0; v < 4; v++) for (let k = 0; k < 3; k++) {
      force[k] += g[3 * v + k];
      torque[k] += x[3 * v + (k + 1) % 3] * g[3 * v + (k + 2) % 3] - x[3 * v + (k + 2) % 3] * g[3 * v + (k + 1) % 3];
    }
    assert.ok([...force, ...torque].every(v => Math.abs(v) < 1e-12));
    const p = Float64Array.from({ length: 12 }, (_, i) => Math.sin(i + 0.2));
    const q = Float64Array.from({ length: 12 }, (_, i) => Math.cos(i + 0.4)), Hp = new Float64Array(12), Hq = new Float64Array(12);
    B.hessianTimes(p, Hp); B.hessianTimes(q, Hq);
    assert.ok(p.reduce((s, v, i) => s + v * Hp[i], 0) >= -1e-12);
    assert.ok(Math.abs(p.reduce((s, v, i) => s + v * Hq[i] - q[i] * Hp[i], 0)) < 1e-12);
  }
  console.log(`barrier-stencils: FD coordinates=${checks}; internal force/torque balanced, radial GN symmetric PSD`);
});

test('strict ground barrier retains its analytical derivatives and refuses initially touching free vertices', () => {
  const w = fixture('vertex-triangle'); w.opts.ground = true;
  const B = new BarrierContact(w, { stiffness: 2.3 });
  const x = new Float64Array([10, 0.02, 10, 0, 1, 0, 1, 1, 0, 0, 1, 1]), g = new Float64Array(12), d = new Float64Array(2);
  const expected = gapBarrier(0.02, 0.05, 2.3, d);
  assert.equal(B.evaluate(w, x, g), expected); assert.equal(g[1], d[0]); assert.equal(B.groundCount, 1);
  const p = new Float64Array(12), out = p.slice(); p[1] = 2; B.hessianTimes(p, out); assert.equal(out[1], 2 * d[1]);
  x[1] = 0; assert.equal(B.evaluate(w, x), Infinity);
  console.log('barrier-ground: y>0 strict domain, analytical gradient/curvature, initial table touch rejected without hidden lift');
});
