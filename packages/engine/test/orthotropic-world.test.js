import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { DocBuilder } from './helpers/docbuilder.js';
import { assembleElastic, buildSystem, gradient } from '../src/xpbd/implicit.js';
import { hessianTimes } from '../src/xpbd/pcg.js';
import { implicitEnergy } from '../src/xpbd/energy-search.js';
import { LocalContactSolve } from '../src/xpbd/local-contact-solve.js';

const research = { membraneModel: 'orthotropic-stvk', physicalMembrane: true, membraneCompression: 1,
  membranePoissonConvention: 'nu12', membraneNu12: [0.293], membraneCurvature: 'gauss-newton', membraneProjection: 'none',
  lineSearch: true, plasticity: false, contact: false, ground: false, gravity: false, meshEdge: 5, panelStiffness: 0 };

function patch(options = {}, placement = { origin: [0, 0, 0], rotation: [0, 0, 0, 1] }) {
  const b = new DocBuilder('orthotropic World research patch');
  b.rect({ id: 'patch', width: 2, height: 2, grain: 31, placement });
  return new World(b.build(), { ...research, ...options });
}

function perturb(w) {
  for (let i = 0; i < w.x.length; i++) w.x[i] += 0.0003 * Math.sin(i * 0.7 + 0.2);
}

function matrixProduct(ch, freeVector) {
  const out = new Float64Array(freeVector.length);
  for (let c = 0; c < ch.n; c++) for (let p = ch.Ap[c]; p < ch.Ap[c + 1]; p++) {
    const r = ch.Ai[p], i = ch.perm[r], j = ch.perm[c];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      const value = ch.Ax[9 * p + 3 * a + b];
      out[3 * i + a] += value * freeVector[3 * j + b];
      if (r !== c) out[3 * j + b] += value * freeVector[3 * i + a];
    }
  }
  return out;
}

test('orthotropic World rejects ignored metadata and unsupported policies; legacy shapes remain unchanged', () => {
  const b = new DocBuilder(); b.rect({ id: 'patch', width: 2, height: 2 });
  const json = b.build(), old = new World(json, { contact: false, ground: false });
  assert.equal(Object.hasOwn(old.opts, 'membraneModel'), false);
  assert.equal(Object.hasOwn(old.stats(), 'membrane'), false);
  assert.equal(Object.hasOwn(old.snapshot(), 'membrane'), false);
  for (const key of ['membranePoissonConvention', 'membraneNu12', 'membraneCurvature', 'membraneProjection']) {
    assert.throws(() => new World(json, { [key]: research[key] }), /research metadata/);
  }
  assert.throws(() => new World(json, { membraneModel: 'unknown' }), /membraneModel/);
  for (const options of [{ physicalMembrane: false }, { membraneCompression: 0.05 }, { membranePoissonConvention: undefined },
    { membraneProjection: undefined }, { membraneCurvature: undefined }, { lineSearch: false }, { plasticity: true }]) {
    assert.throws(() => patch(options), /explicitly require/);
  }
  assert.throws(() => patch({ contact: true }), /coupled barrier/);
  assert.throws(() => patch({ ground: true }), /coupled barrier/);
  assert.throws(() => patch({ consistentMembraneCurvature: true }), /inapplicable/);
  assert.throws(() => patch({ membraneNu12: [] }), /nu12|Poisson/i);
  b.joins.push({ id: 'unsupported', type: 'pin', a: { sheet: 'patch', along: [[0, 0], [0, 2]] }, world: null });
  assert.throws(() => new World(b.build(), research), /joins/);
  const flipped = patch({}, { origin: [0, 1, 0], rotation: [1, 0, 0, 0] });
  assert.ok(flipped.stats().membrane.finite); assert.ok(flipped.stats().energy.stretch < 1e-18);
  assert.throws(() => flipped.grab(0, [0, 1, 0]), /hand drives/);
  console.log('orthotropic-world-domain: explicit uncapped symmetric nu12/GN/no-projection policy; legacy metadata unchanged; valid rigid 180-degree sheet admitted');
});

test('orthotropic World objective uses exact triangle energy/gradient and rejects collapsed search trials safely', () => {
  for (const panelStiffness of [0, 1]) {
    const w = patch({ panelStiffness }); perturb(w); w.xt.set(w.x);
    const g = new Float64Array(w.x.length); gradient(w, w.x, g);
    const direction = w.x.map((_, i) => Math.cos(i * 0.37)), h = 1e-6;
    const a = w.x.map((x, i) => x + h * direction[i]), b = w.x.map((x, i) => x - h * direction[i]);
    const fd = (implicitEnergy(w, a) - implicitEnergy(w, b)) / (2 * h);
    const slope = g.reduce((sum, v, i) => sum + v * direction[i], 0);
    const error = Math.abs(fd - slope) / Math.max(1, Math.abs(fd), Math.abs(slope));
    assert.ok(error < 1e-6, `objective derivative=${error}`);
    assert.equal(w.stats().energy.stretch, w.orthotropicMembrane.energy(w.x));
    assert.equal(w.stats().membrane.projectionPolicy, 'none');
    const bending = implicitEnergy(w, w.x) - w.orthotropicMembrane.energy(w.x);
    if (panelStiffness) {
      assert.ok(w.hingeK.some(k => k > 0)); assert.ok(bending > 0, 'nonplanar pose must activate actual bending objective');
    } else assert.equal(bending, 0);
    const collapsed = new Float64Array(w.x.length);
    assert.equal(implicitEnergy(w, collapsed), Infinity);
    for (let v = 0; v < w.mesh.nV; v++) { w.x[3 * v] = w.X0[3 * v] * 1.001; w.x[3 * v + 1] = 0; w.x[3 * v + 2] = w.X0[3 * v + 2] * 1.001; }
    w.xt.set(w.x); g.fill(0); gradient(w, w.x, g);
    w.energySearch.begin(w); const before = implicitEnergy(w, w.x); w.x.fill(0); w.energySearch.finish(w, g);
    assert.ok(implicitEnergy(w, w.x) <= before * (1 + 1e-12)); assert.ok(w.stats().finite);
    assert.ok(w.energySearch.backtracks || w.energySearch.rejected);
    console.log(`orthotropic-world-objective: panelStiffness=${panelStiffness}, nonzero bending=${bending}, energy/gradient FD=${error}; collapsed trial backtracks/rejects visibly, no projection`);
  }
});

test('orthotropic GN sparse assembly equals matrix-free products with all-free and mixed fixed DOFs', () => {
  let maximumError = 0;
  for (const panelStiffness of [0, 1]) for (const fixed of [false, true]) {
    const w = patch({ panelStiffness }); perturb(w); w.xt.set(w.x);
    if (fixed) { w.fixed[0] = 1; w.invMass[0] = 0; w.sys = buildSystem(w); }
    const g = new Float64Array(w.x.length); gradient(w, w.x, g);
    const p = w.x.map((_, i) => Math.sin(0.2 + i)), free = new Float64Array(3 * w.sys.nFree);
    // The whole elastic operator contract takes zero directions at fixed DOFs,
    // as PCG supplies; hinge and point-term products share that convention.
    if (fixed) p.fill(0, 0, 3);
    for (let v = 0; v < w.mesh.nV; v++) if (w.sys.freeIdx[v] >= 0) for (let c = 0; c < 3; c++) free[3 * w.sys.freeIdx[v] + c] = p[3 * v + c];
    for (const current of [false, true]) {
      const ch = current ? new LocalContactSolve(w).ch : w.sys.ch;
      assembleElastic(w, w.x, ch, current);
      const actual = matrixProduct(ch, free), product = new Float64Array(w.x.length);
      hessianTimes(w, w.x, p, product);
      if (panelStiffness) {
        assert.ok(implicitEnergy(w, w.x) - w.orthotropicMembrane.energy(w.x) > 0);
        const stiffness = w.hingeK.slice(), triangleOnly = new Float64Array(p.length);
        w.hingeK.fill(0); hessianTimes(w, w.x, p, triangleOnly); w.hingeK.set(stiffness);
        assert.ok(product.some((value, i) => Math.abs(value - triangleOnly[i]) > 1e-6), 'combined operator must contain nonzero hinge curvature');
      }
      let scale = 0, difference = 0;
      for (let v = 0; v < w.mesh.nV; v++) if (w.sys.freeIdx[v] >= 0) for (let c = 0; c < 3; c++) {
        const i = 3 * w.sys.freeIdx[v] + c;
        scale = Math.max(scale, Math.abs(actual[i])); difference = Math.max(difference, Math.abs(actual[i] - product[3 * v + c]));
      }
      const error = difference / Math.max(1, scale); maximumError = Math.max(maximumError, error);
      assert.ok(error < 1e-12, `GN product=${error}, panelStiffness=${panelStiffness}, fixed=${fixed}, current=${current}`);
    }
    assert.ok(w.factorDir.some(v => v !== 0));
  }
  console.log(`orthotropic-world-GN: triangle plus active/inactive panel bending, elastic/current-local matrices, free/fixed elimination, transpose slots; maximum operator error=${maximumError}`);
});

test('orthotropic ordinary World steps reuse factors and replay positions, velocities and diagnostics exactly', () => {
  const w = patch({ substeps: 2, newtonIterations: 2, previousPoseStart: true }); perturb(w);
  w._projections = () => { throw new Error('research path invoked legacy projections'); };
  for (let i = 0; i < 3; i++) w.step();
  const saved = w.snapshot();
  for (let i = 0; i < 3; i++) w.step();
  const x = w.x.slice(), v = w.v.slice(), stats = w.stats();
  w.restore(saved); for (let i = 0; i < 3; i++) w.step();
  assert.deepEqual(w.x, x); assert.deepEqual(w.v, v); assert.deepEqual(w.stats(), stats);
  assert.ok(w.stats().finite); assert.ok(w.factorCount < w.substepsRun * w.opts.newtonIterations);
  const before = w.x.slice(), old = patch({ membraneModel: 'edge-springs', membranePoissonConvention: undefined,
    membraneNu12: undefined, membraneCurvature: undefined, membraneProjection: undefined }).snapshot();
  assert.throws(() => w.restore(old), /model\/reference\/material convention mismatch/); assert.deepEqual(w.x, before);
  const changed = patch({ membraneNu12: [0.2] });
  assert.throws(() => changed.restore(saved), /model\/reference\/material convention mismatch/);
  console.log(`orthotropic-world-replay: actual ordinary stepping bit-exact; factors=${w.factorCount}/${w.substepsRun * w.opts.newtonIterations} Newton updates; incompatible snapshots reject before mutation`);
});

test('orthotropic coupled PCG/direct-local ground contact steps replay and retain supported force balance', () => {
  for (const barrierLinearSolver of ['pcg', 'direct-local']) {
    const w = patch({ ground: true, gravity: true, contact: true, barrierContact: true, barrierLinearSolver,
      substeps: 4, barrierIterations: 32, barrierTolerance: 1e-6 }, { origin: [0, 1, 0], rotation: [0, 0, 0, 1] });
    w._projections = () => { throw new Error('coupled path invoked legacy projections'); };
    for (let f = 0; f < 4; f++) w.step();
    assert.ok(w.stats().coupledContact.last.grounded > 0);
    const saved = w.snapshot(); for (let f = 0; f < 4; f++) w.step();
    const x = w.x.slice(), v = w.v.slice(), stats = w.stats();
    w.restore(saved); for (let f = 0; f < 4; f++) w.step();
    assert.deepEqual(w.x, x); assert.deepEqual(w.v, v); assert.deepEqual(w.stats(), stats);
    for (let f = 0; f < 92; f++) w.step();
    const g = new Float64Array(w.x.length); w.coupledContact.potential.evaluate(w, w.x, g);
    const weight = w.mass.reduce((sum, m) => sum + m * 9810, 0), support = -g.reduce((sum, f, i) => sum + (i % 3 === 1 ? f : 0), 0);
    assert.ok(Math.abs(support - weight) / weight < 1e-4);
    assert.ok(w.stats().coupledContact.last.residual <= 1e-6); assert.ok(w.stats().finite);
    assert.ok(w.x.every((x, i) => i % 3 !== 1 || x > 0));
    if (barrierLinearSolver === 'direct-local') assert.ok(w.stats().coupledContact.directSolves > 0);
    console.log(`orthotropic-world-ground: solver=${barrierLinearSolver}; actual active-contact replay exact; weight/support error=${Math.abs(support - weight) / weight}, residual=${w.stats().coupledContact.last.residual}`);
  }
});

test('multiple planar orthotropic sheets use the same exact coupled objective and replay active sheet contact', () => {
  const b = new DocBuilder('orthotropic two-sheet contact research');
  b.rect({ id: 'lower', width: 2, height: 3, grain: 17, placement: { origin: [0, 1, 0], rotation: [0, 0, 0, 1] } });
  b.rect({ id: 'upper', width: 2, height: 3, grain: 53, placement: { origin: [0.2, 1.12, -0.1], rotation: [0.005, 0, 0.0075, Math.sqrt(1 - 0.005 ** 2 - 0.0075 ** 2)] } });
  const w = new World(b.build(), { ...research, membraneNu12: [0.293, 0.21], contact: true, barrierContact: true,
    barrierIterations: 64, barrierCgIterations: 256, barrierTolerance: 1e-3, substeps: 2 });
  perturb(w); w.xt.set(w.x.map((x, i) => x + 0.0001 * Math.cos(i)));
  w.coupledContact.evaluate(w); assert.ok(w.coupledContact.potential.count > 0);
  const g = w.g.slice(), direction = w.x.map((_, i) => Math.sin(i + 0.3)), h = 1e-7;
  const a = w.x.map((x, i) => x + h * direction[i]), z = w.x.map((x, i) => x - h * direction[i]);
  const energy = x => implicitEnergy(w, x) + w.coupledContact.potential.evaluate(w, x);
  const fd = (energy(a) - energy(z)) / (2 * h), slope = direction.reduce((sum, v, i) => sum + v * g[i], 0);
  const error = Math.abs(fd - slope) / Math.max(1, Math.abs(fd), Math.abs(slope));
  assert.ok(error < 1e-5, `coupled objective=${error}`);
  w.wake(); w.step(); const saved = w.snapshot(); w.step();
  const x = w.x.slice(), v = w.v.slice(), stats = w.stats(); w.restore(saved); w.step();
  assert.deepEqual(w.x, x); assert.deepEqual(w.v, v); assert.deepEqual(w.stats(), stats);
  assert.ok(w.stats().finite); assert.ok(w.stats().coupledContact.steps > 0);
  console.log(`orthotropic-world-sheet-contact: independent planar orientations, exact coupled gradient FD=${error}; actual sheet-contact steps replay; nonlinear residual=${w.stats().coupledContact.last.residual} (not a general convergence claim)`);
});
