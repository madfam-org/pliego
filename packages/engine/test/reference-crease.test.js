import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { DocBuilder } from './helpers/docbuilder.js';
import { makePatch } from '../bench/membrane-patch.mjs';
import { REFERENCE_STATE_IDENTITY } from '../src/xpbd/reference-state.js';
import { REFERENCE_BENDING_IDENTITY, REFERENCE_CREASE_BENDING_IDENTITY, latentHingeAngle, creaseBeyondFoldLimit } from '../src/xpbd/reference-bending.js';
import { HINGE_CREASE } from '../src/mesh.js';

const research = { damping: 0, bendDamping: 0, membraneReference: 'uv-displacement', membraneArithmetic: 'double-double',
  lineSearchArithmetic: 'membrane-inertia-increment', stateCoordinates: 'reference-displacement' };
const creaseLaw = { referenceBending: 'panel-and-crease-hinges' };
const base = makePatch({ cells: 2, grain: 0, membraneModel: 'orthotropic-stvk', membraneNu12: .293 }).options;

/** Two 20 x 40 mm panels joined by one valley crease along u = 20 with the given rest angle (degrees). */
function card({ rest = 90, treatment = 'crease', assignment = 'V', panelRest = 0 } = {}) {
  const b = new DocBuilder('folded card', { exact: true }), s = b.sheet({ id: 'card', width: 40, height: 40, grain: 0 });
  const v = [[0, 0], [20, 0], [40, 0], [40, 40], [20, 40], [0, 40], [10, 0], [10, 40]].map(([x, y]) => b.vertex(s, x, y));
  // With panelRest the left panel is split by an F line at u = 10 that carries a set angle.
  if (panelRest) { b.face([v[0], v[6], v[7], v[5]]); b.face([v[6], v[1], v[4], v[7]]); } else b.face([v[0], v[6], v[1], v[4], v[7], v[5]]);
  b.face([v[1], v[2], v[3], v[4]]);
  b.assign(v[1], v[4], assignment, 0, treatment, rest);
  if (panelRest) b.assign(v[6], v[7], 'F', 0, 'none', panelRest);
  return b.build();
}
const world = (doc, extra = {}) => new World(doc, { ...base, ...research, ...creaseLaw, substeps: 600, newtonIterations: 16, ...extra });
const crease = w => Array.from(w.mesh.hingeKind).indexOf(HINGE_CREASE);
/** Fold the u > 20 side about the crease line by `angle` (radians, valley positive), on a 2^-30 mm grid
 * so that x - X0 is one exact binary64 word, as the initial conversion requires. */
function fold(w, angle) {
  const x = w.X0.slice(), grid = v => Math.round(v * 2 ** 30) / 2 ** 30;
  for (let i = 0; i < w.mesh.nV; i++) { const du = x[3 * i] - 20; if (du > 0) { x[3 * i] = grid(20 + du * Math.cos(angle)); x[3 * i + 1] = grid(du * Math.sin(angle)); } }
  return x;
}
const D = Math.PI / 180;

test('crease law: a separate identity; the panel identity and panel Worlds are unchanged', () => {
  const w = world(card());
  assert.deepEqual(w._referenceIdentity, { ...REFERENCE_STATE_IDENTITY, bending: { ...REFERENCE_CREASE_BENDING_IDENTITY } });
  assert.equal(w.restTheta[crease(w)], 90 * D);
  const p = makePatch({ cells: 2, grain: 0, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  const panel = new World(p.doc, { ...p.options, ...research, referenceBending: 'panel-hinges' });
  assert.equal(JSON.stringify(panel._referenceIdentity), JSON.stringify({ ...REFERENCE_STATE_IDENTITY, bending: { ...REFERENCE_BENDING_IDENTITY } }));
  assert.equal(REFERENCE_BENDING_IDENTITY.version, 2);
  assert.throws(() => world(card(), { referenceBending: 'panel-hinges' }), /creases, perforations and set angles are unsupported/);
  const { stateCoordinates, ...absolute } = research;
  assert.throws(() => new World(card(), { ...base, ...absolute, ...creaseLaw }), /admitted only with reference-displacement/);
  console.log('crease-admission: separate identity latent-panel-crease-bending v1; panel-hinges identity and Worlds unchanged; crease docs refused under the panel law');
});

test('crease law: the angle memory starts on the rest branch; poses past the fold limit are refused', () => {
  const near = world(card({ rest: 170 })), h = crease(near), limit = near.foldLimit[h];
  const almost = limit - 0.002;
  near.setInitialReferencePose(fold(near, almost));
  assert.ok(Math.abs(near.theta[h] - almost) < 1e-6 && near.theta[h] > 3, `memory ${near.theta[h]} vs ${almost}`);
  // Past pi the measured angle wraps to the negative branch; the memory follows the rest branch instead.
  const past = world(card({ rest: 170 }));
  assert.throws(() => past.setInitialReferencePose(fold(past, limit + 0.001)), /beyond its fold limit/);
  assert.ok(past._u.every(x => x === 0) && past.theta.every(t => t === 0), 'a refused pose leaves the World pristine');
  assert.throws(() => { const flat = world(card({ rest: 180 })); flat.setInitialReferencePose(fold(flat, 90 * D)); flat._substep(); }, /rest angle outside its fold limit/);
  console.log(`crease-memory: memory ${near.theta[h].toFixed(6)} rad at a pose ${(limit - almost).toExponential(1)} rad inside the ${limit.toFixed(5)} rad fold limit; poses past it refused`);
});

// Folded states need large displacements u (up to about 20 mm here). One binary64 ulp of u then moves the
// membrane force by about stiffness x ulp(u), roughly 1e-6 microN: Newton corrections below it round to a
// zero step. The latent residual converges to that floor, not to 1e-7. A two-word state is the named fix.
test('crease law: a perturbed folded card relaxes toward its rest angle; latent forces converge to the single-word floor', () => {
  const w = world(card()), h = crease(w);
  w.setInitialReferencePose(fold(w, 95 * D));
  const angles = [w.theta[h]];
  let worst = 0;
  for (let s = 0; s < 20; s++) {
    w._substep(); angles.push(w.theta[h]);
    worst = Math.max(worst, w.authoritativeResiduals(1e-7).authoritative.residualInfinity);
  }
  const counts = w.energySearch.increment, maxU = Math.max(...Array.from(w._u, Math.abs)), ulp = 2 ** (Math.floor(Math.log2(maxU)) - 52);
  assert.ok(counts.accepted > 0 && counts.invalidTrials === 0, JSON.stringify(counts));
  assert.ok(counts.precisionLimited > 0, 'Newton reaches the representation floor');
  assert.ok(worst <= 1e-5, `latent residual ${worst} above the single-word floor`);
  assert.ok(angles.at(-1) < angles[0] && angles.at(-1) > 90 * D - 5 * D, `crease angle ${angles[0] / D} -> ${angles.at(-1) / D} degrees`);
  console.log(`crease-stepping: crease ${(angles[0] / D).toFixed(3)} -> ${(angles.at(-1) / D).toFixed(3)} degrees in 20 substeps; ${counts.accepted} Armijo accepts, ${counts.precisionLimited} precision-limited zero steps; worst latent residual ${worst.toExponential(2)} microN at max|u| ${maxU.toFixed(1)} mm (ulp ${ulp.toExponential(1)} mm)`);
});

test('crease law: crossing the fold limit needs contact and is refused visibly, never crossed', () => {
  const w = world(card({ rest: 175 }), { newtonIterations: 4 }), h = crease(w), limit = w.foldLimit[h];
  const x = fold(w, limit - 0.004), v = new Float64Array(x.length);
  // Fold the free wing further at speed: the unconstrained motion would cross the limit.
  for (let i = 0; i < w.mesh.nV; i++) if (w.X0[3 * i] > 20) { const du = w.X0[3 * i] - 20, a = limit - 0.004; v[3 * i] = -du * Math.sin(a) * 2000; v[3 * i + 1] = du * Math.cos(a) * 2000; }
  w.setInitialReferencePose(x, v);
  let maximum = -Infinity, error = null, steps = 0;
  try { for (let s = 0; s < 10; s++) { w._substep(); steps++; maximum = Math.max(maximum, Math.abs(latentHingeAngle(w, w._u, h, null))); assert.equal(creaseBeyondFoldLimit(w, w._u), -1); } }
  catch (cause) { error = cause; }
  assert.match(String(error?.message), /fold limit; contact is not admitted/);
  assert.ok(steps === 0 || maximum <= limit, `${maximum} vs limit ${limit}`);
  console.log(`crease-fold-limit: ${steps} completed substeps stayed inside ${limit.toFixed(6)} rad; then refused: ${error.message}`);
});

test('crease law: scores, set panel angles and plasticity stay refused; snapshots refuse across identities', () => {
  assert.throws(() => world(card({ treatment: 'score' })), /unsupported/);
  assert.throws(() => world(card({ panelRest: 10 })), /unsupported/);
  assert.throws(() => world(card(), { plasticity: true }), /plasticity:false/);
  const a = world(card()); a.setInitialReferencePose(fold(a, 95 * D)); a._substep(); a._substep();
  const s = a.snapshot(); a._substep(); const end = a.snapshot();
  const b = world(card()); b.restore(s); b._substep();
  assert.deepEqual(b.snapshot(), end, 'restore continues bit for bit');
  const p = makePatch({ cells: 2, grain: 0, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  const panel = new World(p.doc, { ...p.options, ...research, referenceBending: 'panel-hinges', substeps: 600 });
  assert.throws(() => panel.restore(s), /mismatch|differ|identity|invalid snapshot/);
  console.log('crease-refusals: scores, set panel angles and plasticity refused; snapshots continue bit for bit and refuse across identities');
});
