// Pure capture-to-oracle projection for the panel-bending capture. Never steps or constructs a World,
// never supplies solver targets. Mirrors membrane-state-modal-probes.mjs: every retained completed
// endpoint role, deduplicated by trajectory+step, no pass/fail filtering, skipped roles listed.
// Adds what the bending oracle needs: hinge quadruples, hingeK/restTheta words (copied with their
// original LE bindings) and the World's bound continuation angles (state key `theta`).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reserveStateModalOutput } from './membrane-state-modal-output.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sha = b => createHash('sha256').update(b).digest('hex');
export const BENDING_PROBE_SCHEMA = 'pliego-bending-state-probes/1';
const STATE = ['x', 'xs', 'xt', 'v', 'u', 'us', 'ut', 'x0', 'mass', 'h', 'initialX', 'initialU', 'initialV'];
const FORCE = ['publicElasticGradient', 'publicInertiaGradient', 'publicResidual', 'authoritativeElasticGradient', 'authoritativeInertiaGradient', 'authoritativeResidual'];
const BENDING = ['hingeK', 'restTheta', 'theta'];
/** Same declared native order as membrane-reference-binding.py. */
export const REFERENCE_ENCODING = Object.freeze({ version: 1, order: ['u[3]', 'v[3]', 'x0[9]', 'c', 's', 'Q[4]', 'volume'], floatsPerElement: 22, nativeElementOrder: true });

function decode(encoded, hash) {
  const b = Buffer.from(encoded, 'base64'); assert.equal(b.toString('base64'), encoded); assert.equal(sha(b), hash); assert.equal(b.length % 8, 0);
  const values = Array.from({ length: b.length / 8 }, (_, i) => b.readDoubleLE(8 * i)); assert.ok(values.every(Number.isFinite), 'oracle probes require finite native words'); return values;
}
const bits = x => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return b.toString('hex'); };

/** Hinge quadruples from the report's independent reference (or its input), checked against hingeK words. */
export function bendingHinges(group, hingeK) {
  const records = group.reference?.hinges, input = group.referenceInput?.hinges;
  assert.ok(Array.isArray(records) || Array.isArray(input), 'report must carry reference hinge quadruples');
  const hinges = Array.isArray(records) ? records.map((r, i) => { assert.equal(r.index, i, 'reference hinges must be in native order'); return r.vertices; }) : input;
  if (Array.isArray(records) && Array.isArray(input)) assert.deepEqual(input, hinges, 'reference input and reference hinge quadruples differ');
  const n = group.vertices.length;
  assert.equal(hinges.length, hingeK.length, 'one hinge stiffness word per hinge required');
  if (group.mesh?.nH !== undefined) assert.equal(hinges.length, group.mesh.nH);
  for (const ids of hinges) assert.ok(Array.isArray(ids) && ids.length === 4 && new Set(ids).size === 4 && ids.every(i => Number.isSafeInteger(i) && i >= 0 && i < n), 'hinge must be four distinct vertex ids');
  if (Array.isArray(records)) records.forEach((r, i) => assert.equal(bits(r.kBinary64), bits(hingeK[i]), 'native hingeK differs from the reference hinge record ' + i));
  return hinges.map(ids => ids.slice());
}

/** Native element descriptors decoded from the 22 reference words per element. Element order is the
 * authored triangle order; native ids are the unique cyclic rotation whose x0 words equal X0.
 * Used only as an independent check of the row's captured descriptor. */
export function referenceCoefficientsFromWords(group, words, x0) {
  assert.equal(words.length, 22 * group.triangles.length, 'reference words must hold 22 floats per triangle');
  const triangles = [], elements = [];
  group.triangles.forEach((authored, t) => {
    const w = words.slice(22 * t, 22 * t + 22), local = w.slice(6, 15);
    const rotations = [0, 1, 2].map(k => [...authored.slice(k), ...authored.slice(0, k)])
      .filter(ids => ids.every((id, j) => [0, 1, 2].every(c => local[3 * j + c] === x0[3 * id + c])));
    assert.equal(rotations.length, 1, 'native element ' + t + ' must match exactly one cyclic rotation of its authored face');
    triangles.push(rotations[0]);
    elements.push({ Q: w.slice(17, 21), volume: w[21], reference: { mode: 'uv-displacement', version: 1, u: w.slice(0, 3), v: w.slice(3, 6), x0: local, c: w[15], s: w[16] } });
  });
  return { triangles, elements };
}

/** The row's captured descriptor (captureModalReference at row creation) must equal the bound words. */
export function checkedReferenceCoefficients(group, row, words, x0) {
  const captured = row.referenceCoefficients, decoded = referenceCoefficientsFromWords(group, words, x0);
  assert.ok(captured && Array.isArray(captured.triangles) && Array.isArray(captured.elements), 'audit row must carry captured referenceCoefficients');
  assert.deepEqual(captured.triangles, decoded.triangles, 'captured native triangles differ from the bound reference words');
  assert.equal(captured.elements.length, decoded.elements.length);
  captured.elements.forEach((e, t) => {
    const d = decoded.elements[t], r = e.reference;
    assert.ok(r?.mode === 'uv-displacement' && r.version === 1, 'captured uv-displacement reference version 1 required');
    const pairs = [[e.Q, d.Q], [[e.volume], [d.volume]], [r.u, d.reference.u], [r.v, d.reference.v], [r.x0, d.reference.x0], [[r.c, r.s], [d.reference.c, d.reference.s]]];
    assert.ok(pairs.every(([a, b]) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i])), 'captured descriptor differs from the bound 22-word reference, element ' + t);
  });
  return structuredClone(captured);
}

/** Original LE bytes are copied unchanged; JSON is only a numeric convenience view. */
export function bendingProbeCase(group, row, observation, selection) {
  const o = observation, a = o.authoritative;
  assert.equal(o.schema, 'pliego-bending-state-observation/1'); assert.equal(o.initial, false); assert.equal(o.targetValid, true); assert.equal(a.targetValid, true);
  assert.equal(o.solver?.membraneReference, 'uv-displacement'); assert.equal(o.solver?.referenceBending, 'panel-hinges');
  const stateFloat64LE = {}, stateSHA256 = {}, values = {};
  for (const key of [...STATE, ...BENDING]) { stateFloat64LE[key] = o.stateFloat64LE[key]; stateSHA256[key] = o.stateSHA256[key]; values[key] = decode(stateFloat64LE[key], stateSHA256[key]); }
  for (const key of FORCE) { stateFloat64LE[key] = o.forceFloat64LE[key]; stateSHA256[key] = o.forceSHA256[key]; values[key] = decode(stateFloat64LE[key], stateSHA256[key]); }
  const referenceFloat64LE = o.stateFloat64LE.reference, referenceSHA256 = o.stateSHA256.reference, reference = decode(referenceFloat64LE, referenceSHA256);
  for (const key of ['reference', 'hingeK']) {
    assert.equal(row.referenceWords.stateFloat64LE[key], o.stateFloat64LE[key], 'trajectory ' + key + ' words differ from the endpoint');
    assert.equal(row.referenceWords.stateSHA256[key], o.stateSHA256[key]);
  }
  assert.equal(values.h.length, 1); assert.equal(values.h[0], row.h); assert.equal(o.forceTolerance, row.forceTolerance); assert.equal(o.forceScale, row.fixedForceScale);
  const hinges = bendingHinges(group, values.hingeK);
  assert.equal(values.restTheta.length, hinges.length);
  assert.equal(values.theta.length, hinges.length, 'one bound continuation angle per hinge required');
  assert.ok(Array.isArray(a.hingeAngles) && a.hingeAngles.every((t, i) => t === values.theta[i]), 'hingeAngles view differs from the bound theta words');
  const forceRecord = prefix => {
    const r = prefix === 'public' ? o : a;
    return { energy: r.elasticEnergy, bendingEnergy: r.bendingEnergy, elasticGradient: values[prefix + 'ElasticGradient'], inertiaGradient: values[prefix + 'InertiaGradient'],
      residual: values[prefix + 'Residual'], residualInfinity: r.residualInfinity, ...(prefix === 'public' ? { literalForceGate: o.literalForceGate } : { converged: a.converged }) };
  };
  return { vertices: group.vertices, triangles: group.triangles, material: group.material, grain: group.geometry.grain,
    referenceCoefficients: checkedReferenceCoefficients(group, row, reference, values.x0), referenceEncoding: { ...REFERENCE_ENCODING, order: [...REFERENCE_ENCODING.order] }, referenceFloat64LE, referenceSHA256,
    x: values.x, xs: values.xs, xt: values.xt, mass: values.mass, h: values.h[0],
    state: { ...a.identity, u: values.u, us: values.us, ut: values.ut, v: values.v, x0: values.x0, targetValid: true,
      initialization: { x: values.initialX, u: values.initialU, v: values.initialV } },
    bending: { hinges, hingeK: values.hingeK, restTheta: values.restTheta, theta: values.theta,
      continuationSource: 'bound state key theta = World theta after the step (public dihedral, continued); the unwrap reference of both meanings' },
    runtime: { fixedForceScale: row.fixedForceScale, forceTolerance: row.forceTolerance, public: forceRecord('public'), authoritative: forceRecord('authoritative') },
    stateFloat64LE, stateSHA256, includeHessian: false, selection,
    scope: 'one captured completed endpoint; independent latent/public membrane+bending force truth, not trajectory or time/material acceptance' };
}

/** Select every retained poststep role, regardless of either force result. */
export function bendingTrajectoryProbes(group, row, trajectoryIndex) {
  const byStep = new Map(), skipped = [];
  for (const [role, record] of Object.entries(row.snapshots)) {
    const o = record.observation;
    if (o.initial || !o.targetValid) { skipped.push({ trajectoryIndex, step: o.step, role, reason: o.initial ? 'constructor target is not a completed solve' : 'uncertified target', stateSHA256: o.stateSHA256 }); continue; }
    const entry = byStep.get(o.step);
    if (entry) { assert.deepEqual(entry.observation, o, 'same endpoint roles must bind identical observations'); entry.roles.push(role); }
    else byStep.set(o.step, { observation: o, roles: [role] });
  }
  const cases = Array.from(byStep.entries()).sort(([a], [b]) => a - b).map(([step, entry]) => bendingProbeCase(group, row, entry.observation,
    { trajectoryIndex, level: row.level, budget: row.budget, seed: row.seed, step, roles: entry.roles.sort(), measurementValid: entry.observation.measurementValid }));
  return { cases, skipped };
}

export function buildBendingStateProbes(report, inputSHA256) {
  assert.equal(report.schema, 'pliego-bending-state-audit/1'); assert.equal(report.source?.dirty, false);
  assert.match(inputSHA256, /^[a-f0-9]{64}$/); assert.equal(report.results.length, 1);
  const group = report.results[0]; assert.ok(Array.isArray(group.trajectories) && group.trajectories.length > 0);
  const cases = [], skipped = [];
  group.trajectories.forEach((row, index) => { const result = bendingTrajectoryProbes(group, row, index); cases.push(...result.cases); skipped.push(...result.skipped); });
  assert.ok(cases.length > 0, 'no completed endpoint was retained');
  return { schema: BENDING_PROBE_SCHEMA, source: report.source, inputSHA256,
    selectionPolicy: 'every retained completed endpoint role; deduplicate trajectory+step only; no pass/fail filtering; all skipped constructor/uncertified roles listed',
    cases, skipped,
    coverage: { cases: cases.length, trajectories: group.trajectories.length, declaredTrajectories: report.protocol?.trajectories ?? null, declaredRequestedPoststeps: report.protocol?.poststeps ?? null,
      capturedCompletedPoststeps: group.trajectories.reduce((sum, row) => sum + (row.runtime?.completedSteps ?? 0), 0), allPoststepsEvaluated: false, allNewtonArmijoEvaluated: false },
    scope: 'predeclared retained endpoint samples only; cannot certify unsampled force equations or complete time/material/booklet acceptance' };
}

/** The capture's recorded source must be this clean checkout: same HEAD, clean tree, same file bytes. */
export function assertBendingProbeSource(source) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(git('status', '--porcelain'), '', 'clean source required');
  assert.equal(source.git, git('rev-parse', 'HEAD'), 'report was captured at a different commit');
  assert.ok(Array.isArray(source.files) && source.files.length > 0, 'report must list its source files');
  for (const f of source.files) assert.equal(sha(readFileSync(join(root, f.path))), f.sha256, 'source file changed since capture: ' + f.path);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); assert.equal(args.length, 4); assert.equal(args[0], '--input'); assert.equal(args[2], '--out');
  const bytes = readFileSync(args[1]), report = JSON.parse(bytes);
  assertBendingProbeSource(report.source);
  const sink = reserveStateModalOutput(args[3]);
  try {
    const result = buildBendingStateProbes(report, sha(bytes)); assertBendingProbeSource(report.source); sink.write(result);
    console.error('bending-state-probes: ' + result.cases.length + ' distinct completed endpoint samples, ' + result.skipped.length + ' skipped roles; no solve executed');
  } finally { sink.close(); }
}
