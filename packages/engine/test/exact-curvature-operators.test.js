import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { World } from '../src/index.js';
import { makePatch } from '../bench/membrane-patch.mjs';
import { OrthotropicMembrane, createOrthotropicElement, evaluateOrthotropicElement } from '../src/xpbd/orthotropic-membrane.js';
import { buildSystem, assembleElastic, SLOT_NONE } from '../src/xpbd/implicit.js';
import { hessianTimes } from '../src/xpbd/pcg.js';
import { BlockCholesky } from '../src/linalg/blockchol.js';

const research = { damping: 0, bendDamping: 0, substeps: 4000, newtonIterations: 4, membraneReference: 'uv-displacement',
  membraneArithmetic: 'double-double', lineSearchArithmetic: 'membrane-inertia-increment', stateCoordinates: 'reference-displacement' };
function world(curvature = 'exact-hessian', grain = 31) {
  const p = makePatch({ cells: 2, grain, pattern: 'perturbed', membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  return new World(p.doc, { ...p.options, ...research, membraneCurvature: curvature });
}
/** Skewed, sheared, partly compressed planar displacement of the actual patch. */
const distortion = w => w.X0.map((x, i) => i % 3 === 1 ? 0 : i % 3 === 0 ? .04 * x + .03 * w.X0[i + 2] : -.06 * x + .02 * w.X0[i - 2]);
const norm = a => Math.hypot(...a);
/** Panel hinges add their own (unchanged GN) blocks; compare the membrane operator alone. */
function withoutHinges(w, fn) { const k = w.hingeK.slice(); w.hingeK.fill(0); try { return fn(); } finally { w.hingeK.set(k); } }

/** Dense free-vertex matrix of an assembled BlockCholesky (transpose slots decoded). */
function dense(ch, freeIdx) {
  const n = 3 * ch.n, out = new Float64Array(n * n);
  const free = Array.from(freeIdx).flatMap((f, v) => f < 0 ? [] : [[v, f]]);
  for (const [, a] of free) for (const [, b] of free) {
    let s; try { s = ch.slot(a, b); } catch { continue; }
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      out[(3 * a + r) * n + 3 * b + c] = s >= 0 ? ch.Ax[s + 3 * r + c] : ch.Ax[-s - 1 + 3 * c + r];
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) out[i * n + j] = out[j * n + i]; // stored once: upper block triangle
  return out;
}
/** Element evaluator summed in assembly order, canonical (upper) entries only. */
function evaluatorDense(membrane, x, freeIdx, nFree, coordinates, arithmetic, massDiagonal) {
  const n = 3 * nFree, out = new Float64Array(n * n), m = membrane.mesh;
  if (massDiagonal) for (let v = 0; v < m.nV; v++) if (freeIdx[v] >= 0) for (let c = 0; c < 3; c++) out[(3 * freeIdx[v] + c) * n + 3 * freeIdx[v] + c] += massDiagonal[v];
  for (let t = 0; t < m.nT; t++) {
    const ids = Array.from(m.tris.subarray(3 * t, 3 * t + 3)), e = membrane.elements[t];
    const local = Float64Array.from(ids.flatMap(v => [0, 1, 2].map(r => x[3 * v + r])));
    const h = evaluateOrthotropicElement(e, local, { arithmetic, coordinates }).hessian;
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
      const fi = freeIdx[ids[Math.floor(i / 3)]], fj = freeIdx[ids[Math.floor(j / 3)]];
      if (fi < 0 || fj < 0) continue;
      const a = Math.min(i, j), b = Math.max(i, j), gi = 3 * fi + i % 3, gj = 3 * fj + j % 3;
      if (gi <= gj) out[gi * n + gj] += h[9 * a + b];
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) out[i * n + j] = out[j * n + i];
  return out;
}

test('exact membrane blocks equal the element exact Hessian bit for bit, distinct from GN, with mass, both coordinates', () => {
  const w = world(), u = distortion(w), x = Float64Array.from(w.X0, (v, i) => v + u[i]);
  w.setInitialReferencePose(x);
  const S = w.sys, idt2 = 1 / (w.dt * w.dt), mass = Array.from(w.mass, m => m * idt2);
  assert.ok(Array.from(S.membraneSlots).some(s => s < 0 && s !== SLOT_NONE), 'transpose-encoded slots exercised');
  assert.ok(Array.from({ length: w.mesh.nT }, (_, t) => w.mesh.tris.subarray(3 * t, 3 * t + 3)).some(([a, b, c]) => !(a < b && b < c)), 'nonmonotone triangle ids exercised');
  let entries = 0;
  for (const [coordinates, pose] of [['reference-displacement', w._u], ['absolute-position', x]]) {
    const ch = Object.assign(Object.create(BlockCholesky.prototype), structuredClone(S.ch));
    withoutHinges(w, () => assembleElastic(w, pose, ch, false, coordinates, 'exact-hessian'));
    const assembled = dense(ch, S.freeIdx), expected = evaluatorDense(w.orthotropicMembrane, pose, S.freeIdx, S.nFree, coordinates, 'double-double', mass);
    for (let i = 0; i < assembled.length; i++) assert.ok(Object.is(assembled[i], expected[i]), `${coordinates} entry ${i}`);
    entries += assembled.length;
    const gn = Object.assign(Object.create(BlockCholesky.prototype), structuredClone(S.ch));
    withoutHinges(w, () => assembleElastic(w, pose, gn, false, coordinates));
    const difference = norm(dense(gn, S.freeIdx).map((v, i) => v - assembled[i]));
    assert.ok(difference > 1e-3 * norm(assembled), 'stressed exact curvature differs from GN');
    // Fixed vertices: the membrane blocks omit their rows/columns exactly as GN does.
    const fixed = Float64Array.from(w.invMass, (v, i) => i % 3 === 0 ? 0 : v);
    const fake = { mesh: w.mesh, invMass: fixed, terms: { count: 0, start: Int32Array.of(0), verts: new Int32Array(0) }, orthotropicMembrane: w.orthotropicMembrane };
    const sys = buildSystem(fake); w.orthotropicMembrane.addExactHessianBlocks({ sys }, pose, sys.ch, coordinates);
    const masked = evaluatorDense(w.orthotropicMembrane, pose, sys.freeIdx, sys.nFree, coordinates, 'double-double', null);
    dense(sys.ch, sys.freeIdx).forEach((v, i) => assert.ok(Object.is(v, masked[i]), `masked ${coordinates} entry ${i}`));
  }
  console.log(`exact-curvature-blocks: ${entries} assembled entries (mass + exact membrane) bit-equal the element exact Hessian in both coordinates; fixed-vertex masks, transpose slots and nonmonotone triangles exercised; GN distinct`);
});

test('exact products match their blocks; binary64 and fixed masks follow the native contract', () => {
  const w = world(), u = distortion(w); w.setInitialReferencePose(Float64Array.from(w.X0, (v, i) => v + u[i]));
  const S = w.sys, ch = Object.assign(Object.create(BlockCholesky.prototype), structuredClone(S.ch));
  withoutHinges(w, () => assembleElastic(w, w._u, ch, false, 'reference-displacement', 'exact-hessian'));
  const H = dense(ch, S.freeIdx), n = 3 * S.nFree;
  let worst = 0;
  for (let k = 0; k < 6; k++) {
    const p = Float64Array.from(w._u, (_, i) => i % 3 === 1 && k % 2 ? 0 : Math.sin(1.7 * i + k)), out = new Float64Array(p.length);
    withoutHinges(w, () => hessianTimes(w, w._u, p, out, 'reference-displacement', 'exact-hessian'));
    const expected = Array.from({ length: n }, (_, i) => p.reduce((s, _, j) => s + H[i * n + j] * p[j], 0));
    worst = Math.max(worst, norm(out.map((v, i) => v - expected[i])) / norm(expected));
  }
  assert.ok(worst < 1e-12, String(worst));
  // binary64 material-coefficient membrane, absolute coordinates, with fixed vertices
  const g = world('gauss-newton'), m = new OrthotropicMembrane(g.mesh, g.materials, g.doc, [.293], 'binary64', 'material-coefficients', 'exact-hessian');
  const fixed = Float64Array.from(g.invMass, (v, i) => i % 4 === 0 ? 0 : v), x = Float64Array.from(g.X0, (v, i) => v + distortion(g)[i]);
  const fake = { mesh: g.mesh, invMass: fixed, terms: { count: 0, start: Int32Array.of(0), verts: new Int32Array(0) }, orthotropicMembrane: m };
  const sys = buildSystem(fake); m.addExactHessianBlocks({ sys }, x, sys.ch);
  const B = dense(sys.ch, sys.freeIdx), expectedBlocks = evaluatorDense(m, x, sys.freeIdx, sys.nFree, 'absolute-position', 'binary64', null);
  B.forEach((v, i) => assert.ok(Object.is(v, expectedBlocks[i]), `binary64 entry ${i}`));
  const p = Float64Array.from(x, (_, i) => Math.cos(.9 * i)), out = new Float64Array(p.length);
  m.addExactHessianTimes(x, p, out, fixed);
  const nf = 3 * sys.nFree, free = Array.from(sys.freeIdx);
  let maskedWorst = 0;
  for (let v = 0; v < g.mesh.nV; v++) for (let r = 0; r < 3; r++) {
    if (free[v] < 0) { assert.equal(out[3 * v + r], 0, 'fixed output omitted'); continue; }
    let expected = 0;
    for (let q = 0; q < g.mesh.nV; q++) if (free[q] >= 0) for (let c = 0; c < 3; c++) expected += B[(3 * free[v] + r) * nf + 3 * free[q] + c] * p[3 * q + c];
    maskedWorst = Math.max(maskedWorst, Math.abs(out[3 * v + r] - expected) / norm(B) / norm(p));
  }
  assert.ok(maskedWorst < 1e-13, String(maskedWorst));
  console.log(`exact-curvature-products: double-double product/block relative error ${worst.toExponential(2)}; binary64 masked product/block ${maskedWorst.toExponential(2)}; fixed inputs zero, fixed outputs omitted`);
});

test('exact membrane operator converges to finite differences of the actual gradient under step halving', () => {
  const w = world(), u = distortion(w); w.setInitialReferencePose(Float64Array.from(w.X0, (v, i) => v + u[i]));
  const membrane = w.orthotropicMembrane, base = w._u.slice(), cases = [];
  for (let k = 0; k < 4; k++) {
    const p = Float64Array.from(base, (_, i) => i % 3 === 1 ? 0 : Math.sin(2.3 * i + .7 * k)), exact = new Float64Array(p.length);
    membrane.addExactHessianTimes(base, p, exact, w.invMass, 'reference-displacement');
    const gn = new Float64Array(p.length); membrane.addGaussNewtonTimes(base, p, gn, w.invMass, 'reference-displacement');
    let previous = Infinity, gnError = 0;
    for (const h of [1e-3, 5e-4, 2.5e-4, 1.25e-4]) {
      const plus = new Float64Array(p.length), minus = new Float64Array(p.length);
      membrane.addGradient(base.map((v, i) => v + h * p[i]), plus, 'reference-displacement');
      membrane.addGradient(base.map((v, i) => v - h * p[i]), minus, 'reference-displacement');
      const fd = plus.map((v, i) => (v - minus[i]) / (2 * h)), error = norm(fd.map((v, i) => v - exact[i])) / norm(fd);
      gnError = norm(fd.map((v, i) => v - gn[i])) / norm(fd);
      assert.ok(error < .3 * previous + 1e-10, `${previous} -> ${error}`); previous = error;
    }
    assert.ok(previous < 1e-7, String(previous)); assert.ok(gnError > 1e3 * previous, 'GN omits the stress curvature');
    cases.push({ exact: previous, gn: gnError });
  }
  console.log(`exact-curvature-fd: 4 directions, central differences halve 4x per step; finest exact ${Math.max(...cases.map(c => c.exact)).toExponential(2)} vs GN ${Math.min(...cases.map(c => c.gn)).toExponential(2)}`);
});

test('double-double exact entries agree with an independent exact-rational Hessian', () => {
  const material = { E1: 5.5e9, E2: 2.5e9, G12: 1.43e9, thickness: .1 }, uv = [0, 0, 2, .2, .3, 1.5];
  const cases = [];
  for (const [grain, scale] of [[.37, .93], [-.61, 1.04], [Math.PI / 4, .8]]) {
    const e = createOrthotropicElement(uv, material, grain, .293);
    const x = [0, 0, 0, 2 * scale, .1, .25, .2 * scale, -.05, 1.5 * scale + .1];
    const result = evaluateOrthotropicElement(e, x, { arithmetic: 'double-double' });
    cases.push({ alpha: [e.alpha[1], e.alpha[2]], beta: [e.beta[1], e.beta[2]], Q: Array.from(e.Q), volume: e.volume, x, hessian: Array.from(result.hessian) });
  }
  const proof = JSON.parse(execFileSync(process.env.PLIEGO_AUDIT_PYTHON || 'python3', ['-c', `
import json,sys
from fractions import Fraction as F
out=[]
for c in json.load(sys.stdin):
  a=[-(F(c['alpha'][0])+F(c['alpha'][1])),F(c['alpha'][0]),F(c['alpha'][1])]
  b=[-(F(c['beta'][0])+F(c['beta'][1])),F(c['beta'][0]),F(c['beta'][1])]
  q=[F(v) for v in c['Q']];vol=F(c['volume']);x=[F(v) for v in c['x']]
  A=[a[1]*(x[3+r]-x[r])+a[2]*(x[6+r]-x[r]) for r in range(3)];B=[b[1]*(x[3+r]-x[r])+b[2]*(x[6+r]-x[r]) for r in range(3)]
  e=[(sum(v*v for v in A)-1)/2,(sum(v*v for v in B)-1)/2,sum(A[r]*B[r] for r in range(3))]
  s=[q[0]*e[0]+q[2]*e[1],q[2]*e[0]+q[1]*e[1],q[3]*e[2]]
  J=[[a[i]*A[r] for i in range(3) for r in range(3)],[b[i]*B[r] for i in range(3) for r in range(3)],[a[i]*B[r]+b[i]*A[r] for i in range(3) for r in range(3)]]
  worst=F(0)
  for i in range(9):
    for j in range(9):
      gt=[J[0][i]*q[0]*J[0][j],J[0][i]*q[2]*J[1][j],J[1][i]*q[2]*J[0][j],J[1][i]*q[1]*J[1][j],J[2][i]*q[3]*J[2][j]]
      ni,nj=i//3,j//3
      ht=[s[0]*a[ni]*a[nj],s[1]*b[ni]*b[nj],s[2]*a[ni]*b[nj],s[2]*b[ni]*a[nj]] if i%3==j%3 else []
      exact=vol*(sum(gt)+sum(ht));observed=F(c['hessian'][9*i+j])
      scale=vol*sum(abs(t) for t in gt+ht)
      bound=abs(exact)/2**52+scale/2**95
      assert abs(observed-exact)<=bound,(i,j,float(observed),float(exact))
      if scale: worst=max(worst,abs(observed-exact)/scale)
  out.append(float(worst))
print(json.dumps({'proofs':len(out),'worstScaledError':max(out)}))
`], { input: JSON.stringify(cases), encoding: 'utf8' }));
  assert.equal(proof.proofs, 3);
  console.log(`exact-curvature-rational: 3 elements x 81 entries within one binary64 rounding of the exact rational GN+geometric Hessian; worst scaled error ${proof.worstScaledError.toExponential(2)}`);
});

test('only the requested curvature changes: energy, gradient, increment, reference, mass and initial bytes are identical', () => {
  const gn = world('gauss-newton'), exact = world('exact-hessian'), u = distortion(gn);
  for (const w of [gn, exact]) w.setInitialReferencePose(Float64Array.from(w.X0, (v, i) => v + u[i]));
  const a = gn.orthotropicMembrane, b = exact.orthotropicMembrane, x = gn._u, y = x.map((v, i) => i % 3 === 1 ? v : v * 1.01);
  assert.ok(Object.is(a.energy(x, 'reference-displacement'), b.energy(x, 'reference-displacement')));
  const ga = new Float64Array(x.length), gb = new Float64Array(x.length);
  a.addGradient(x, ga, 'reference-displacement'); b.addGradient(x, gb, 'reference-displacement'); assert.deepEqual(ga, gb);
  const da = a.energyDifferenceDetails(x, y, 'reference-displacement'), db = b.energyDifferenceDetails(x, y, 'reference-displacement');
  assert.deepEqual(da, db);
  for (const key of ['X0', 'mass', 'x', 'v', '_u', '_ut', 'invMass']) assert.deepEqual(exact[key], gn[key], key);
  const configuration = ({ curvature, curvaturePolicy, ...rest }) => rest;
  assert.deepEqual(configuration(b.configuration), configuration(a.configuration));
  assert.equal(a.configuration.curvature, 'gauss-newton'); assert.equal(a.configuration.curvaturePolicy, undefined);
  assert.equal(b.configuration.curvature, 'exact-hessian'); assert.equal(b.configuration.curvaturePolicy.fallback, 'gauss-newton-once-on-finite-nonpositive-pivot');
  assert.match(gn.orthotropicMembraneSignature, /^\{"model":"orthotropic-stvk","version":1,"curvature":"gauss-newton","poissonConvention":"nu12",/);
  console.log('exact-curvature-identity: energy/gradient/two-word increment, X0/mass/initial authority identical; only curvature identity and its policy differ; GN configuration bytes keep their historical order');
});
