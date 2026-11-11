import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { DocBuilder } from './helpers/docbuilder.js';
import { makePatch } from '../bench/membrane-patch.mjs';
import { REFERENCE_STATE_IDENTITY, REFERENCE_STATE_IDENTITY_TWO_WORD, projectReference } from '../src/xpbd/reference-state.js';
import { REFERENCE_CREASE_BENDING_IDENTITY } from '../src/xpbd/reference-bending.js';
import { HINGE_CREASE } from '../src/mesh.js';

const research = { damping: 0, bendDamping: 0, membraneReference: 'uv-displacement', membraneArithmetic: 'double-double',
  lineSearchArithmetic: 'membrane-inertia-increment', stateCoordinates: 'reference-displacement', referenceBending: 'panel-and-crease-hinges' };
const twoWord = { stateRepresentation: 'double-double' };
const base = makePatch({ cells: 2, grain: 0, membraneModel: 'orthotropic-stvk', membraneNu12: .293 }).options;

/** A size x size card folded by one valley crease (rest 90 degrees) along its middle. */
function card(size) {
  const b = new DocBuilder('folded card', { exact: true }), s = b.sheet({ id: 'card', width: size, height: size, grain: 0 }), half = size / 2;
  const v = [[0, 0], [half, 0], [size, 0], [size, size], [half, size], [0, size]].map(([x, y]) => b.vertex(s, x, y));
  b.face([v[0], v[1], v[4], v[5]]); b.face([v[1], v[2], v[3], v[4]]); b.assign(v[1], v[4], 'V', 0, 'crease', 90);
  return b.build();
}
const world = (size, extra = {}) => new World(card(size), { ...base, meshEdge: 4 * size, ...research, substeps: 600, newtonIterations: 16, ...extra });
/** The card folded 95 degrees, on a 2^-30 mm grid so x - X0 is one exact word. */
function folded(w, size) {
  const x = w.X0.slice(), half = size / 2, a = 95 * Math.PI / 180, grid = q => Math.round(q * 2 ** 30) / 2 ** 30;
  for (let i = 0; i < w.mesh.nV; i++) { const du = x[3 * i] - half; if (du > 0) { x[3 * i] = grid(half + du * Math.cos(a)); x[3 * i + 1] = grid(du * Math.sin(a)); } }
  return x;
}
function run(size, extra, steps = 6) {
  const w = world(size, extra); w.setInitialReferencePose(folded(w, size));
  let worst = 0;
  for (let s = 0; s < steps; s++) { w._substep(); worst = Math.max(worst, w.authoritativeResiduals(1e-7).authoritative.residualInfinity); }
  return { w, worst };
}

test('two-word state: opt-in identity; omission keeps the single-word identity', () => {
  const on = world(40, twoWord), off = world(40);
  assert.deepEqual(on._referenceIdentity, { ...REFERENCE_STATE_IDENTITY_TWO_WORD, bending: { ...REFERENCE_CREASE_BENDING_IDENTITY } });
  assert.equal(JSON.stringify(off._referenceIdentity), JSON.stringify({ ...REFERENCE_STATE_IDENTITY, bending: { ...REFERENCE_CREASE_BENDING_IDENTITY } }));
  assert.equal(Object.hasOwn(off.opts, 'stateRepresentation'), false);
  assert.ok(on._anchorHi instanceof Float64Array && on.orthotropicMembrane.work.referenceAnchor.hi === on._anchorHi);
  const { stateCoordinates, ...absolute } = research;
  assert.throws(() => new World(card(40), { ...base, ...absolute, referenceBending: undefined, ...twoWord }), /admitted only with reference-displacement/);
  console.log('two-word-admission: identity version 2 (two-word substep anchor) only with the option; omission keeps version 1 byte for byte');
});

test('two-word state: the folded card reaches the force tolerance where one word cannot', () => {
  const rows = [10, 40, 160].map(size => ({ size, single: run(size, {}).worst, double: run(size, twoWord).worst }));
  for (const r of rows) {
    assert.ok(r.single > 1e-7, `${r.size} mm single-word floor ${r.single}`);
    assert.ok(r.double <= 1e-9, `${r.size} mm two-word residual ${r.double}`);
  }
  console.log('two-word-floor: ' + rows.map(r => `${r.size} mm ${r.single.toExponential(1)} -> ${r.double.toExponential(1)} microN`).join('; '));
});

test('two-word state: the same physics; the public pose is X0 + anchor + offset rounded once', () => {
  const a = run(40, {}, 8).w, b = run(40, twoWord, 8).w, h = Array.from(b.mesh.hingeKind).indexOf(HINGE_CREASE);
  let difference = 0; for (let i = 0; i < a.x.length; i++) difference = Math.max(difference, Math.abs(a.x[i] - b.x[i]));
  assert.ok(difference <= 1e-9, `public poses differ by ${difference} mm`);
  assert.ok(Math.abs(a.theta[h] - b.theta[h]) <= 1e-9);
  assert.deepEqual(Array.from(b.x), Array.from(projectReference(b, b._u)));
  const offset = Math.max(...Array.from(b._u, Math.abs)), anchor = Math.max(...Array.from(b._anchorHi, Math.abs));
  assert.ok(offset < 1e-2 * anchor, `offset ${offset} mm is one substep of motion against an anchor of ${anchor} mm`);
  console.log(`two-word-physics: public poses agree within ${difference.toExponential(1)} mm after 8 substeps; offset ${offset.toExponential(1)} mm against anchor ${anchor.toFixed(1)} mm`);
});

test('two-word state: snapshots continue bit for bit and refuse across representations', () => {
  const { w } = run(40, twoWord, 2);
  const s = w.snapshot(); w._substep(); const end = w.snapshot();
  const r = world(40, twoWord); r.restore(s); r._substep();
  assert.deepEqual(r.snapshot(), end);
  assert.ok(s.referenceState.anchorHi instanceof Float64Array && s.factor?.anchorHi instanceof Float64Array, 'state and factor anchors are bound');
  assert.throws(() => world(40).restore(s), /mismatch/);
  const single = run(40, {}, 2).w.snapshot();
  assert.throws(() => world(40, twoWord).restore(single), /mismatch/);
  console.log('two-word-snapshots: restore continues bit for bit with state and factor anchors; snapshots refuse across representations');
});
