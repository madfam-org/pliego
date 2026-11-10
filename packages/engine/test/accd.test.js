import test from 'node:test';
import assert from 'node:assert/strict';
import { AdditiveCCD } from '../src/collision/accd.js';
import { pointTriangleDistanceSquared, edgeEdgeDistanceSquared } from '../src/collision/distance.js';
import { Contact } from '../src/xpbd/contact.js';
import { mulberry32 } from '../src/geom.js';

const mix = (a, b, t) => a.map((v, i) => v + t * (b[i] - v));
function safeSamples(kind, from, to, time, thickness) {
  const distance = kind === 'vertex-triangle' ? pointTriangleDistanceSquared : edgeEdgeDistanceSquared;
  for (let i = 0; i <= 100; i++) assert.ok(distance(mix(from, to, time * i / 100), 0, 1, 2, 3) >= thickness ** 2 - 1e-11);
}

test('ACCD prevents the existing fixed-face tunneling counterexample at finite and zero thickness', () => {
  const from = new Float64Array([0.25, 0.3, 0.25, 0, 0, 0, 1, 0, 0, 0, 0, 1]), to = from.slice(); to[1] = -0.3;
  const c = Object.create(Contact.prototype);
  Object.assign(c, { mesh: { nT: 1, tris: new Int32Array([1, 2, 3]) }, nPairs: 1, used: new Uint8Array([1]),
    pv: new Int32Array([0]), pt: new Int32Array([0]), ps: new Int8Array([-1]), canon: null,
    tc: new Float64Array(4).fill(0.1), mu: new Float64Array(4), faceSide: new Map() });
  const legacy = to.slice(); c.project(legacy, from, new Float64Array([1, 0, 0, 0]));
  assert.equal(legacy[1], -0.3, 'retain the confirmed legacy failure as the comparison');
  for (const thickness of [0, 0.1]) {
    const ccd = new AdditiveCCD(), time = ccd.query('vertex-triangle', from, to, 0, 1, 2, 3, thickness);
    const exact = (0.3 - thickness) / 0.6;
    assert.ok(time > 0.8 * exact && time < exact, `safe time ${time}, exact TOI ${exact}`);
    assert.equal(ccd.status, 'limited'); safeSamples('vertex-triangle', from, to, time, thickness);
  }
  console.log('ACCD-tunneling: legacy crosses 0.6 mm; conservative finite/zero thickness steps stop before analytic TOI');
});

test('ACCD covers edge–edge and lateral rounded triangle-boundary collisions', () => {
  const ccd = new AdditiveCCD();
  const a = new Float64Array([-1, 0, 0, 1, 0, 0, 0, 0.3, -1, 0, 0.3, 1]), b = a.slice(); b[7] = -0.3; b[10] = -0.3;
  const time = ccd.query('edge-edge', a, b, 0, 1, 2, 3, 0.1);
  assert.ok(time > 0.25 && time < 1 / 3); safeSamples('edge-edge', a, b, time, 0.1);
  const p = new Float64Array([-1, 0.05, 0.25, 0, 0, 0, 1, 0, 0, 0, 0, 1]), q = p.slice(); q[0] = 2;
  const boundaryTime = ccd.query('vertex-triangle', p, q, 0, 1, 2, 3, 0.1);
  const exact = (1 - Math.sqrt(0.1 ** 2 - 0.05 ** 2)) / 3;
  assert.ok(boundaryTime > 0 && boundaryTime < exact);
  safeSamples('vertex-triangle', p, q, boundaryTime, 0.1);
  console.log('ACCD-features: edge crossing and lateral triangle-boundary crossing limited; endpoint-only/plane-only checks would miss the latter');
});

test('ACCD reports stationary, initially infeasible and computationally limited queries honestly', () => {
  const x = new Float64Array([0.25, 0.11, 0.25, -100, 0, -100, 100, 0, -100, 0, 0, 100]);
  const ccd = new AdditiveCCD();
  const translated = x.map((v, i) => v + [10, 20, 30][i % 3]);
  assert.equal(ccd.query('vertex-triangle', x, translated, 0, 1, 2, 3, 0.1), 1); assert.equal(ccd.status, 'clear');
  const overlap = x.slice(); overlap[1] = 0.05;
  assert.equal(ccd.query('vertex-triangle', overlap, x, 0, 1, 2, 3, 0.1), 0); assert.equal(ccd.status, 'initial-overlap');
  const tangent = x.slice(); tangent[0] += 30;
  const bounded = new AdditiveCCD({ maxIterations: 2 });
  const t = bounded.query('vertex-triangle', x, tangent, 0, 1, 2, 3, 0.1);
  assert.ok(t > 0 && t < 1); assert.equal(bounded.status, 'iteration-limit');
  safeSamples('vertex-triangle', x, tangent, t, 0.1);
  const near = x.slice(); near[1] = 0.1 + Number.EPSILON;
  assert.equal(ccd.query('vertex-triangle', near, x, 0, 1, 2, 3, 0.1), 0); assert.equal(ccd.status, 'precision-limit');
  const huge = x.map(v => v + 1e20);
  assert.equal(ccd.query('vertex-triangle', x, huge, 0, 1, 2, 3, 0.1), 0);
  assert.equal(ccd.status, 'precision-limit', 'large absolute endpoint scales cannot silently inherit a tiny relative tolerance');
  assert.throws(() => ccd.query('vertex-triangle', x, tangent, 0, 1, 2, 3, -1), RangeError);
  console.log('ACCD-status: common translation clear; infeasible/precision/iteration limits retained, never promoted to full progress');
});

test('moving and deforming pairs replay deterministically and retain sampled separation', () => {
  const rnd = mulberry32(123), ccd = new AdditiveCCD(); let samples = 0;
  for (let k = 0; k < 80; k++) {
    const kind = k % 2 ? 'vertex-triangle' : 'edge-edge';
    const from = kind === 'vertex-triangle'
      ? new Float64Array([0.25, 1, 0.25, 0, 0, 0, 1, 0, 0, 0, 0, 1])
      : new Float64Array([-1, 0, 0, 1, 0, 0, 0, 1, -1, 0, 1, 1]);
    const to = from.map(v => v + 4 * rnd() - 2);
    const time = ccd.query(kind, from, to, 0, 1, 2, 3, 0.05), status = ccd.status, iterations = ccd.iterations;
    assert.equal(ccd.query(kind, from, to, 0, 1, 2, 3, 0.05), time);
    assert.equal(ccd.status, status); assert.equal(ccd.iterations, iterations);
    safeSamples(kind, from, to, time, 0.05); samples += 101;
  }
  console.log(`ACCD-deforming: pairs=80, deterministic replay, trajectory samples=${samples}; analytic cases provide separate TOI checks`);
});
