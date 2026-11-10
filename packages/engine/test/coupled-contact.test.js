import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { pageLeaf, DocBuilder } from './helpers/docbuilder.js';
import { CoupledContact } from '../src/xpbd/coupled-contact.js';
import { buildSystem } from '../src/xpbd/implicit.js';
import { gapBarrier } from '../src/collision/barrier.js';
import * as K from '../src/constants.js';
import { implicitEnergy } from '../src/xpbd/energy-search.js';

// Analytical point-mass contact element, not a fabricated native sheet document.
// Uses the actual assembly, PCG, barrier and CCD search with no elastic elements.
function pointMass() {
  const x = new Float64Array([0.25, 0.3, 0.25, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const mesh = { nV: 4, nT: 1, nE: 0, nH: 0, tris: new Int32Array([1, 2, 3]), edges: new Int32Array(), hinges: new Int32Array(),
    edgeLen: new Float64Array(), vGroup: new Int32Array([0, 1, 2, 3]), vSheet: new Int32Array(4), triSheet: new Int32Array([0]) };
  const empty = new Float64Array();
  const w = { mesh, doc: { sheets: [{ derived: { collision_thickness: 0.1 } }] }, opts: { ground: false },
    fixed: new Uint8Array([0, 1, 1, 1]), invMass: new Float64Array([1, 0, 0, 0]), mass: new Float64Array(4).fill(1), dt: 1,
    x, xs: x.slice(), xt: x.slice(), g: new Float64Array(12), contact: { weldSheet: new Int32Array(4).fill(-1) },
    terms: { count: 0, start: new Int32Array([0]), verts: new Int32Array(), info: [] },
    edgeDir: empty, edgeK: empty, hingeGrad: empty, kMem: empty, theta: empty, driveOn: empty, hingeK: empty,
    dirty: true, factorCount: 0, _pcg: null, _factorState: null,
    _checkStrings() {}, _saveFactorState(x) { this._factorState = { x: x.slice() }; } };
  w.xt[1] = -0.3; w.sys = buildSystem(w); return w;
}

test('coupled normal force reaches the independently bracketed point-mass equilibrium without tunneling', () => {
  const w = pointMass(), solver = new CoupledContact(w, { barrierStiffness: 100, barrierIterations: 32, barrierTolerance: 1e-9 });
  solver.solve(w);
  const derivatives = new Float64Array(2); let lo = 0.1, hi = 0.15;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2; gapBarrier(mid - 0.1, 0.05, 100, derivatives);
    if (mid + 0.3 + derivatives[0] < 0) lo = mid; else hi = mid;
  }
  assert.ok(Math.abs(w.x[1] - (lo + hi) / 2) < 1e-10);
  assert.ok(solver.last.converged); assert.ok(w.x[1] > 0.1); assert.ok(solver.guard.limited > 0);
  assert.ok(solver.last.energyAfter <= solver.last.energyBefore + 1e-12);
  console.log(`coupled-element: y=${w.x[1]} mm, bracketed equilibrium=${(lo + hi) / 2}, residual=${solver.last.residual} µN, iterations=${solver.last.iterations}`);
});

test('iteration exhaustion is observable and cannot turn a zero-velocity candidate into sleep', () => {
  const w = new World(pageLeaf({ width: 20, height: 30 }), { meshEdge: 12, substeps: 4, barrierContact: true,
    barrierIterations: 1, ground: false, gravity: false, plasticity: false });
  w.setControl('turn', 45); w.step(); assert.equal(w.stats().coupledContact.last.converged, false);
  w.drivers.goal = new Map(w.drivers.value); w.v.fill(0); w._quiet = K.SLEEP_FRAMES - 1; w._sleepCheck();
  assert.equal(w._asleep, false); assert.equal(w._quiet, 0);
  assert.ok(w.stats().coupledContact.unconverged > 0);
  console.log('coupled-residual: exhausted nonlinear budget remains unconverged and awake despite zero velocity');
});

test('native coupled leaf replays positions and solver diagnostics exactly after restore', () => {
  const w = new World(pageLeaf({ width: 20, height: 30 }), { meshEdge: 12, substeps: 4, barrierContact: true,
    barrierIterations: 4, ground: false, gravity: false, plasticity: false });
  w.setControl('turn', 45); for (let i = 0; i < 3; i++) w.step();
  const saved = w.snapshot(); for (let i = 0; i < 3; i++) w.step();
  const x = w.x.slice(), diagnostics = w.stats().coupledContact;
  w.restore(saved); for (let i = 0; i < 3; i++) w.step();
  assert.deepEqual(w.x, x); assert.deepEqual(w.stats().coupledContact, diagnostics); assert.ok(w.stats().finite);
  assert.throws(() => new World(pageLeaf(), { barrierContact: true, contact: false }), /requires contact/);
  assert.throws(() => new World(pageLeaf(), { barrierContact: true, continuousContact: true }), /replaces continuousContact/);
  console.log('coupled-native: pose and full solver/CCD diagnostics replay bit-exactly; invalid combinations refused');
});

test('whole native elastic/inertial/contact objective agrees with its assembled first derivative', () => {
  const b = new DocBuilder('tilted contact derivative fixture');
  b.rect({ id: 'lower', width: 2, height: 3, placement: { origin: [0, 1, 0], rotation: [0, 0, 0, 1] } });
  b.rect({ id: 'upper', width: 2, height: 3, placement: { origin: [0.2, 1.115, -0.1], rotation: [0.005, 0, 0.0075, Math.sqrt(1 - 0.005 ** 2 - 0.0075 ** 2)] } });
  const w = new World(b.build(), { meshEdge: 10, substeps: 8, barrierContact: true, ground: false, gravity: false, plasticity: false });
  // Stay off the membrane's tension/compression switch so central differences
  // test the smooth branch, rather than its O(h) error at the C1 rest point.
  for (let i = 0; i < w.x.length; i++) w.x[i] += 0.0002 * Math.sin(i * 0.7);
  w.xt.set(w.x.map((x, i) => x + 0.001 * Math.cos(i)));
  w.coupledContact.evaluate(w); assert.ok(w.coupledContact.potential.count > 0);
  const d = w.x.map((_, i) => Math.sin(i + 0.3)), a = w.x.map((x, i) => x + 1e-7 * d[i]), z = w.x.map((x, i) => x - 1e-7 * d[i]);
  const objective = x => implicitEnergy(w, x) + w.coupledContact.potential.evaluate(w, x);
  const fd = (objective(a) - objective(z)) / 2e-7, slope = d.reduce((s, v, i) => s + v * w.g[i], 0);
  const error = Math.abs(fd - slope) / Math.max(1, Math.abs(fd), Math.abs(slope));
  assert.ok(error < 1e-5, `combined directional derivative error=${error}`);
  console.log(`coupled-objective: native sheets=2, active stencils=${w.coupledContact.potential.count}, directional FD error=${error}`);
});

test('a native freely falling sheet reaches supported force balance above the strict ground plane', () => {
  const b = new DocBuilder('native falling sheet reference');
  b.rect({ id: 'drop', width: 2, height: 2, placement: { origin: [0, 1, 0], rotation: [0, 0, 0, 1] } });
  const w = new World(b.build(), { meshEdge: 5, substeps: 4, barrierContact: true, barrierIterations: 16,
    barrierTolerance: 1e-6, plasticity: false });
  for (let f = 0; f < 100; f++) w.step();
  const g = new Float64Array(w.x.length); w.coupledContact.potential.evaluate(w, w.x, g);
  const weight = w.mass.reduce((s, m) => s + m * K.GRAVITY, 0);
  const support = -g.reduce((s, force, i) => s + (i % 3 === 1 ? force : 0), 0);
  assert.ok(Math.abs(support - weight) / weight < 1e-4);
  assert.ok(w.stats().coupledContact.last.converged); assert.ok(w.stats().coupledContact.last.residual <= 1e-6);
  assert.ok(w.x.every((x, i) => i % 3 !== 1 || x > 0)); assert.ok(w.stats().maxStrain < 1e-6);
  console.log(`coupled-ground-balance: vertices=${w.mesh.nV}, weight=${weight} µN, support=${support} µN, residual=${w.stats().coupledContact.last.residual} µN`);
});

test('native active ground-contact iterations replay exactly through a World snapshot', () => {
  const b = new DocBuilder('active contact replay');
  b.rect({ id: 'drop', width: 2, height: 2, placement: { origin: [0, 1, 0], rotation: [0, 0, 0, 1] } });
  const w = new World(b.build(), { meshEdge: 5, substeps: 4, barrierContact: true, barrierIterations: 16,
    barrierTolerance: 1e-6, plasticity: false });
  for (let f = 0; f < 4; f++) w.step();
  assert.ok(w.stats().coupledContact.last.grounded > 0); assert.equal(w.stats().asleep, false);
  const saved = w.snapshot(); for (let f = 0; f < 4; f++) w.step();
  const x = w.x.slice(), diagnostics = w.stats().coupledContact;
  w.restore(saved); for (let f = 0; f < 4; f++) w.step();
  assert.deepEqual(w.x, x); assert.deepEqual(w.stats().coupledContact, diagnostics);
  console.log('coupled-contact-replay: native falling sheet, active ground force, non-sleeping iterations, pose/diagnostics exact');
});

test('infeasible initial table touch and moving prescribed vertices are explicit failures', () => {
  const b = new DocBuilder('initial table touch'); b.rect({ id: 'touch', width: 2, height: 2 });
  const w = new World(b.build(), { barrierContact: true }); const before = w.x.slice();
  assert.throws(() => w.step(), /infeasible/); assert.deepEqual(w.x, before);
  const p = pointMass(); p.fixed[0] = 1;
  assert.throws(() => new CoupledContact(p).solve(p), /prescribed vertices/); assert.deepEqual(p.x, p.xs);
  console.log('coupled-domain: initial table contact and moving Dirichlet targets fail explicitly; no hidden pose repair');
});

test('uncapped S8 coupled iterations recover reversible axial-bar response without active contact', () => {
  const b = new DocBuilder('coupled axial reference');
  b.rect({ id: 'strip', width: 100, height: 10, grain: 0, placement: { origin: [0, 100, 0], rotation: [0, 0, 0, 1] } });
  b.joins.push({ id: 'root', type: 'pin', a: { sheet: 'strip', along: [[0, 0], [0, 10]] }, world: null });
  const w = new World(b.build(), { meshEdge: 10, substeps: 8, barrierContact: true, barrierIterations: 256,
    physicalMembrane: true, gravity: false, ground: false, plasticity: false });
  const tip = []; for (let v = 0; v < w.mesh.nV; v++) if (Math.abs(w.mesh.uv[2 * v] - 100) < 1e-9) tip.push(v);
  for (const v of tip) w.setForce(v, [10000 / tip.length, 0, 0]);
  for (let f = 0; f < 90; f++) { w.step(); assert.equal(w.stats().coupledContact.last.barrierEnergy, 0); }
  const extension = () => tip.reduce((s, v) => s + w.x[3 * v] - 100, 0) / tip.length;
  const loaded = extension(), expected = 10000 * 100 / (5.5e9 * 0.1 * 10);
  assert.ok(Math.abs(loaded - expected) / expected < 0.05); assert.equal(w.stats().coupledContact.unconverged, 0);
  w.clearForces(); for (let f = 0; f < 90; f++) w.step();
  assert.ok(Math.abs(extension()) < 0.01 * expected); assert.ok(w.stats().coupledContact.last.converged);
  console.log(`coupled-axial: S8 I<=256, extension=${loaded} mm, bar=${expected} mm, unload=${extension()} mm; zero barrier energy, synthetic stock only`);
});
