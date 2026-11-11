// The bending-mode fixture: deterministic extraction and verification only, no stepping.
// The initial field is the lowest discrete bending mode from the independent stdlib reference
// (bending-modal-reference.py); every word the World consumes is pinned here by SHA-256.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { World } from '../src/index.js';
import { makePatch } from './membrane-patch.mjs';
import { encodeStateModalVectors } from './membrane-state-modal-runtime.mjs';
import * as K from '../src/constants.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sha = data => createHash('sha256').update(data).digest('hex');
export const BENDING_STATE_INPUT_PATH = 'packages/engine/bench/fixtures/bending-state-input.json';
export const BENDING_STATE_INPUT_SHA256 = 'b6605dfdd6b1cc8c42e9d11766b17dd86b53d91e704260ef79bc7259a0c9db54';
export const BENDING_REFERENCE_PROGRAM = 'packages/engine/bench/bending-modal-reference.py';
export const BENDING_STATE_GEOMETRY = Object.freeze({ cells: 2, pattern: 'forward', grain: 0 });
export const BENDING_STATE_PROTOCOL = Object.freeze({ stage: 'diagnostic', matrix: 'bending-smoke', amplitude: .004, z0: '0.08', nu12: .293,
  levels: Object.freeze([1, 2, 4, 8]), budgets: Object.freeze([1, 4, 16]), seeds: Object.freeze([false, true]), trajectories: 24 });
let cached = null;
function freeze(value) { if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; }

/** Research options shared by every bending row; per-row substeps, budgets and starts are added. */
export function bendingStateOptions(patch) {
  return { ...patch.options, damping: 0, bendDamping: 0, gravity: false, ground: false, contact: false, plasticity: false, lineSearch: true,
    lineSearchArithmetic: 'membrane-inertia-increment', membraneArithmetic: 'double-double', membraneReference: 'uv-displacement',
    stateCoordinates: 'reference-displacement', referenceBending: 'panel-hinges' };
}
export function bendingStatePatch() {
  return makePatch({ ...BENDING_STATE_GEOMETRY, membraneModel: 'orthotropic-stvk', membraneNu12: BENDING_STATE_PROTOCOL.nu12 });
}

/** Input the reference reads: the represented words only, no engine-derived mode or plan. */
export function bendingReferenceInput(patch, world) {
  const m = world.materials[0], H = Array.from(world.mesh.hinges);
  assert.ok(world.mesh.hingeKind.every(k => k === 0), 'every hinge of the fixture must be a flat panel hinge');
  assert.ok(world.restTheta.every(t => t === 0), 'flat rest angles required');
  return { schema: 'pliego-bending-modal-reference-input/1', vertices: patch.vertices, triangles: patch.triangles,
    hinges: Array.from({ length: world.mesh.nH }, (_, h) => H.slice(4 * h, 4 * h + 4)),
    material: { dHarm: Array.from(m.dHarm), D11: m.D11, D22: m.D22 }, CB: K.C_B, panelStiffness: world.opts.panelStiffness,
    grainDeg: BENDING_STATE_GEOMETRY.grain, masses: Array.from(world.mass), engineHingeK: Array.from(world.hingeK),
    amplitude: BENDING_STATE_PROTOCOL.amplitude, z0: BENDING_STATE_PROTOCOL.z0 };
}

/** Run explicitly once when preparing the committed fixture. */
export function extractBendingStateInputs() {
  const patch = bendingStatePatch(), world = new World(patch.doc, { ...bendingStateOptions(patch), substeps: 1 });
  const input = bendingReferenceInput(patch, world), program = readFileSync(join(root, BENDING_REFERENCE_PROGRAM));
  const output = execFileSync('python3', ['-I', join(root, BENDING_REFERENCE_PROGRAM)], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 1 << 26 });
  const reference = JSON.parse(output);
  assert.equal(reference.schema, 'pliego-bending-modal-reference/1');
  assert.ok(reference.maximumEngineStiffnessRelativeDifference <= 1e-14, 'engine hinge stiffness differs from the independent law');
  const n = patch.vertices.length, phi = reference.mode.phiBinary64, A = BENDING_STATE_PROTOCOL.amplitude;
  assert.equal(phi.length, n); assert.equal(Math.max(...phi.map(Math.abs)), 1, 'mode must have maximum nodal magnitude 1');
  // Out-of-plane displacement A*phi_i (one binary64 product); in-plane displacement and velocity exactly zero.
  const u = new Float64Array(3 * n); for (let i = 0; i < n; i++) u[3 * i + 1] = A * phi[i];
  const plan = reference.plan, rows = [];
  for (const level of BENDING_STATE_PROTOCOL.levels) for (const budget of BENDING_STATE_PROTOCOL.budgets) for (const seed of BENDING_STATE_PROTOCOL.seeds) {
    const substeps = plan.S0 * level;
    rows.push({ level, budget, seed, amplitude: A, substeps, steps: plan.N0 * level, h: 1 / (60 * substeps) });
  }
  const words = encodeStateModalVectors({ u, v: new Float64Array(3 * n), mass: world.mass, hingeK: world.hingeK, x0: world.X0 });
  return { schema: 'pliego-bending-state-inputs/1', geometry: BENDING_STATE_GEOMETRY, protocol: { ...BENDING_STATE_PROTOCOL },
    vertices: patch.vertices, triangles: patch.triangles, material: patch.material, mesh: patch.info, fixtureSHA256: patch.fixtureSHA256, meshSHA256: patch.meshSHA256,
    referenceInput: input, reference, plan, rows, initial: words,
    provenance: { referenceProgram: BENDING_REFERENCE_PROGRAM, referenceProgramSHA256: sha(program), extractor: 'packages/engine/bench/bending-state-inputs.mjs', extractorVersion: 1,
      scope: 'patch words and the independent flat-state bending mode only; no stepping, no oracle targets, no engine-derived mode' } };
}
export function bendingStateInputBytes() { return Buffer.from(JSON.stringify(extractBendingStateInputs()) + '\n'); }

const decode = (words, key) => {
  const raw = Buffer.from(words.stateFloat64LE[key], 'base64');
  assert.equal(raw.toString('base64'), words.stateFloat64LE[key]); assert.equal(sha(raw), words.stateSHA256[key]); assert.equal(raw.length % 8, 0);
  return Array.from({ length: raw.length / 8 }, (_, i) => raw.readDoubleLE(8 * i));
};
export function verifyBendingStateInputs(data) {
  assert.equal(data.schema, 'pliego-bending-state-inputs/1'); assert.deepEqual(data.geometry, { ...BENDING_STATE_GEOMETRY });
  assert.deepEqual(data.protocol, { ...BENDING_STATE_PROTOCOL, levels: [...BENDING_STATE_PROTOCOL.levels], budgets: [...BENDING_STATE_PROTOCOL.budgets], seeds: [...BENDING_STATE_PROTOCOL.seeds] });
  const r = data.reference, n = data.vertices.length;
  assert.equal(r.schema, 'pliego-bending-modal-reference/1'); assert.equal(r.checks.symmetric, true); assert.equal(r.checks.rigidNullVectors.length, 3);
  assert.ok(r.checks.maximumEigenResidual <= 1e-60 && r.checks.maximumModalOrthogonality <= 1e-60, 'reference eigen self-checks failed');
  assert.ok(r.maximumEngineStiffnessRelativeDifference <= 1e-14);
  assert.equal(r.plan.S0, data.plan.S0); assert.equal(data.rows.length, 24);
  const keys = new Set(); let steps = 0, events = 0;
  for (const t of data.rows) {
    const key = [t.level, t.budget, t.seed].join(':'); assert.ok(!keys.has(key)); keys.add(key);
    assert.equal(t.amplitude, data.protocol.amplitude); assert.equal(t.substeps, data.plan.S0 * t.level); assert.equal(t.steps, data.plan.N0 * t.level); assert.equal(t.h, 1 / (60 * t.substeps));
    steps += t.steps; events += t.steps * t.budget;
  }
  const u = decode(data.initial, 'u'), v = decode(data.initial, 'v'), phi = r.mode.phiBinary64;
  assert.equal(u.length, 3 * n); assert.ok(v.every(x => Object.is(x, 0)), 'initial velocity must be exactly +0');
  for (let i = 0; i < n; i++) assert.ok(Object.is(u[3 * i], 0) && Object.is(u[3 * i + 2], 0) && Object.is(u[3 * i + 1], data.protocol.amplitude * phi[i]), 'initial field is not A*phi');
  return { trajectories: keys.size, poststeps: steps, newtonEvents: events, S0: data.plan.S0, N0: data.plan.N0, omega: r.mode.omegaBinary64 };
}
/** Committed fixture, pinned by hash, with the reference program unchanged. */
export function loadBendingStateInputs() {
  if (cached) return cached;
  const bytes = readFileSync(join(root, BENDING_STATE_INPUT_PATH));
  assert.equal(sha(bytes), BENDING_STATE_INPUT_SHA256, 'committed bending input fixture changed');
  const data = JSON.parse(bytes); verifyBendingStateInputs(data);
  assert.equal(sha(readFileSync(join(root, BENDING_REFERENCE_PROGRAM))), data.provenance.referenceProgramSHA256, 'independent bending reference program changed');
  for (const key of ['u', 'v', 'mass', 'hingeK', 'x0']) data[key + 'Words'] = decode(data.initial, key);
  data.provenance = { ...data.provenance, smallFixture: BENDING_STATE_INPUT_PATH, smallFixtureSHA256: BENDING_STATE_INPUT_SHA256, smallFixtureBytes: bytes.length };
  cached = freeze(data); return cached;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 2 && args[0] === '--extract' && !args[1].startsWith('--'), 'only --extract fresh-output is supported');
  const data = bendingStateInputBytes(); const summary = verifyBendingStateInputs(JSON.parse(data));
  writeFileSync(resolve(args[1]), data, { flag: 'wx', mode: 0o600 });
  console.error('bending-state-inputs: ' + JSON.stringify(summary) + ' bytes=' + data.length + ' SHA256=' + sha(data));
}
