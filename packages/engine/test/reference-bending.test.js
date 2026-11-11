import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { makePatch } from '../bench/membrane-patch.mjs';
import { gradient } from '../src/xpbd/implicit.js';
import { dihedral } from '../src/xpbd/dihedral.js';
import { REFERENCE_STATE_IDENTITY } from '../src/xpbd/reference-state.js';
import { REFERENCE_BENDING_IDENTITY, latentHingeAngle, addBendingGradient, bendingIncrement, angleChange } from '../src/xpbd/reference-bending.js';

const research = { damping: 0, bendDamping: 0, membraneReference: 'uv-displacement', membraneArithmetic: 'double-double',
  lineSearchArithmetic: 'membrane-inertia-increment', stateCoordinates: 'reference-displacement' };
const bending = { referenceBending: 'panel-hinges' };
const TAU = 8.81400646629321e-5; // the fixed-24 force tolerance, microN

function world(extra = {}) {
  const p = makePatch({ cells: 2, grain: 31, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  return new World(p.doc, { ...p.options, ...research, substeps: 4000, newtonIterations: 4, ...extra });
}
/** The vertex nearest the patch centre: the only interior vertex of the 2-cell patch. */
function centre(w) {
  const n = w.mesh.nV, c = [0, 2].map(k => Array.from({ length: n }, (_, i) => w.X0[3 * i + k]).reduce((a, b) => a + b) / n);
  let best = 0, distance = Infinity;
  for (let i = 0; i < n; i++) { const d = Math.hypot(w.X0[3 * i] - c[0], w.X0[3 * i + 2] - c[1]); if (d < distance) { distance = d; best = i; } }
  return best;
}
/** Small transverse bump: lift the centre vertex out of the plane. */
function bump(w, amplitude = 0.25) { const x = w.x.slice(); x[3 * centre(w) + 1] = amplitude; return x; }
const raw = w => ({ x: w.x.slice(), v: w.v.slice(), u: w._u.slice(), us: w._us.slice(), ut: w._ut.slice(), theta: w.theta.slice(),
  time: w.time, substeps: w.substepsRun, factorCount: w.factorCount, search: structuredClone(w.energySearch.increment) });
const hinges = w => Array.from({ length: w.mesh.nH }, (_, h) => h);

test('admission: panel bending is a named identity of the reference-displacement domain only', () => {
  const p = makePatch({ cells: 2, grain: 31, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  const { stateCoordinates, ...absolute } = research;
  assert.throws(() => new World(p.doc, { ...p.options, ...absolute, ...bending }), /admitted only with reference-displacement/);
  assert.throws(() => world({ referenceBending: 'shell' }), /admitted only with reference-displacement/);
  const planar = world(), bent = world(bending);
  assert.equal(Object.hasOwn(planar.opts, 'referenceBending'), false);
  assert.equal(JSON.stringify(planar._referenceIdentity), JSON.stringify(REFERENCE_STATE_IDENTITY));
  assert.deepEqual(bent._referenceIdentity, { ...REFERENCE_STATE_IDENTITY, bending: { ...REFERENCE_BENDING_IDENTITY } });
  assert.ok(bent.hingeK.some(k => k > 0), 'the fixture has nonzero panel stiffness');
  assert.throws(() => planar.setInitialReferencePose(bump(planar)), /Y=0/);
  bent.setInitialReferencePose(bump(bent));
  bent.opts.referenceBending = undefined;
  assert.throws(() => bent._substep(), /identity changed/);
  console.log('bending-admission: absolute coordinates and unknown laws refused; omission keeps the planar identity byte for byte; nonplanar poses need the bending identity; dropping it mid-run refused');
});

/** Exact binary64 → integer numerator over 2^200 (every value used here has its lowest bit at or above 2^-200). */
const SCALED = v => BigInt(v * 2 ** 200);
/** The exact latent difference (X0[b]+u[b]) − (X0[a]+u[a]), rounded once to nearest by BigInt → Number. */
const exactDifference = (w, u, b, a) => Number(SCALED(w.X0[b]) + SCALED(u[b]) - SCALED(w.X0[a]) - SCALED(u[a])) / 2 ** 200;

test('latent hinge geometry: exact sums match the public dihedral; rounded sums use exact differences rounded once', () => {
  const w = world(bending); w.setInitialReferencePose(bump(w));
  const g1 = new Float64Array(12), g2 = new Float64Array(12), H = w.mesh.hinges;
  for (const h of hinges(w)) {
    const latent = latentHingeAngle(w, w._u, h, g1), pub = dihedral(w.x, H[4 * h], H[4 * h + 1], H[4 * h + 2], H[4 * h + 3], g2);
    assert.ok(Object.is(latent, pub), `hinge ${h}: ${latent} vs ${pub}`);
    assert.ok(g1.every((v, i) => Object.is(v, g2[i])), `hinge ${h} gradient`);
  }
  // Non-dyadic displacements whose sums with X0 round: the latent angle is the dihedral of the exactly
  // formed, once-rounded local differences; the public angle sees the rounded sums instead.
  const v = world(bending), u = Float64Array.from(v.X0, (_, i) => (i % 3 === 1 ? 0.1 : 1e-3) * Math.sin(0.9 * i + 0.4) / 3);
  const local = new Float64Array(12);
  let publicDiffers = 0;
  for (const h of hinges(v)) {
    const a = 3 * H[4 * h];
    for (let i = 1; i < 4; i++) for (let c = 0; c < 3; c++) local[3 * i + c] = exactDifference(v, u, 3 * H[4 * h + i] + c, a + c);
    const expected = dihedral(local, 0, 1, 2, 3, g2), latent = latentHingeAngle(v, u, h, g1);
    assert.ok(Object.is(latent, expected), `hinge ${h}: ${latent} vs ${expected}`);
    assert.ok(g1.every((value, i) => Object.is(value, g2[i])), `hinge ${h} gradient`);
    const x = Float64Array.from(u, (value, i) => v.X0[i] + value);
    if (!Object.is(dihedral(x, H[4 * h], H[4 * h + 1], H[4 * h + 2], H[4 * h + 3], null), latent)) publicDiffers++;
  }
  console.log(`bending-geometry: latent = public bitwise on exact sums (${w.mesh.nH} hinges, angle and gradient); on rounded sums latent = exact-difference-rounded-once oracle on every hinge, public differs on ${publicDiffers}/${v.mesh.nH}`);
});

test('bending energy, gradient and search increment agree with finite differences', () => {
  const w = world(bending); w.setInitialReferencePose(bump(w));
  const u = w._u.slice(), n = u.length, scratch = new Float64Array(n), g = new Float64Array(n);
  const energy = x => addBendingGradient(w, x, scratch.fill(0), 'reference-displacement');
  const e0 = addBendingGradient(w, u, g, 'reference-displacement');
  assert.ok(e0 > 0, 'a lifted centre stores bending energy');
  const d = Float64Array.from({ length: n }, (_, i) => Math.sin(1.3 * i + 0.7));
  const slope = g.reduce((s, gi, i) => s + gi * d[i], 0);
  const errors = [1e-2, 1e-3, 1e-4].map(eps => {
    const plus = energy(u.map((x, i) => x + eps * d[i])), minus = energy(u.map((x, i) => x - eps * d[i]));
    return Math.abs((plus - minus) / (2 * eps) - slope);
  });
  assert.ok(errors[1] < errors[0] / 50 && errors[2] < 1e-7 * Math.abs(slope), `central differences ${errors} vs slope ${slope}`);
  // The engine gradient's hinge part is this gradient.
  const full = new Float64Array(n), membrane = new Float64Array(n);
  gradient(w, u, full, 'reference-displacement'); w.orthotropicMembrane.addGradient(u, membrane, 'reference-displacement');
  for (let i = 0; i < n; i++) assert.ok(Math.abs(full[i] - membrane[i] - g[i]) <= 1e-9 * (1 + Math.abs(g[i])), `component ${i}`);
  // The search's bending change is the energy difference; its linear part is g·d.
  for (const eps of [1e-3, 1e-6]) {
    const after = u.map((x, i) => x + eps * d[i]), r = bendingIncrement(w, u, after);
    assert.equal(r.valid, true);
    assert.ok(Math.abs(r.linear - eps * slope) <= 1e-9 * Math.abs(eps * slope), `linear ${r.linear} vs ${eps * slope}`); // summation order only
    assert.ok(Math.abs(r.difference - (energy(after) - e0)) <= 1e-9 * Math.abs(eps * slope) + 1e-14 * e0, `eps ${eps}: ${r.difference} vs ${energy(after) - e0}`);
  }
  assert.ok(Math.abs(angleChange(Math.PI - 0.1, -Math.PI + 0.1) + 0.2) < 1e-12);
  console.log(`bending-derivatives: central-difference errors ${errors.map(e => e.toExponential(1)).join(' > ')} (slope ${slope.toExponential(3)}); engine gradient hinge part and search increment agree`);
});

test('nonplanar stepping: bending joins the Armijo change and the authoritative force balance', () => {
  const w = world({ ...bending, newtonIterations: 16 }), c = centre(w); w.setInitialReferencePose(bump(w));
  const lift = [w._u[3 * c + 1]];
  for (let s = 0; s < 8; s++) { w._substep(); lift.push(w._u[3 * c + 1]); }
  assert.ok(w._u.every(Number.isFinite) && w.x.every(Number.isFinite));
  assert.ok(lift.at(-1) < lift[0], `the bump relaxes: ${lift}`);
  const counts = w.energySearch.increment, last = counts.last;
  assert.ok(counts.accepted > 0 && counts.invalidTrials === 0, JSON.stringify(counts));
  for (const key of ['bendingDifference', 'bendingLinear', 'bendingRemainder', 'bendingMagnitude']) assert.equal(typeof last[key], 'number', key);
  const r = w.authoritativeResiduals(TAU);
  assert.ok(r.authoritative.bendingEnergy > 0 && r.authoritative.converged === true, `latent residual ${r.authoritative.residualInfinity}`);
  const bendingForce = new Float64Array(w._u.length); addBendingGradient(w, w._u, bendingForce, 'reference-displacement');
  const withoutBending = Math.max(...r.authoritative.residual.map((v, i) => Math.abs(v - bendingForce[i])));
  assert.ok(withoutBending > 1e3 * TAU, `bending force is material to the balance: ${withoutBending}`);
  assert.ok(w.authoritativeState().identity.bending, 'diagnostics carry the bending identity');
  console.log(`bending-stepping: centre lift ${lift[0]} -> ${lift.at(-1).toFixed(6)} mm over 8 substeps; ${counts.accepted} Armijo accepts; latent residual ${r.authoritative.residualInfinity.toExponential(2)} <= tau; omitting bending would leave ${withoutBending.toExponential(2)} microN`);
});

test('refusals before any write: nonflat rest angles, drives and bending damping stay out', () => {
  for (const [mutate, pattern] of [[w => { w.restTheta[0] = 0.125; }, /nonflat rest angle/], [w => { w.driveOn[0] = 1; }, /active hinge drives/]]) {
    const w = world(bending); w.setInitialReferencePose(bump(w)); w._substep();
    mutate(w); const before = raw(w);
    assert.throws(() => w._substep(), pattern);
    assert.deepEqual(raw(w), before);
  }
  assert.throws(() => { const w = world({ ...bending, bendDamping: 0.1 }); w.setInitialReferencePose(bump(w)); w._substep(); }, /damping/);
  console.log('bending-refusals: rest angles, drives and bending damping refused with the state untouched');
});

test('snapshots continue bitwise and refuse the other identity', () => {
  const a = world(bending); a.setInitialReferencePose(bump(a));
  for (let s = 0; s < 3; s++) a._substep();
  const s = a.snapshot();
  s.referenceState.identity.bending.version = 99;
  assert.equal(a._referenceIdentity.bending.version, REFERENCE_BENDING_IDENTITY.version, 'snapshots hold copies of the identity');
  s.referenceState.identity.bending.version = REFERENCE_BENDING_IDENTITY.version;
  for (let k = 0; k < 3; k++) a._substep();
  const end = a.snapshot();
  a.restore(s); for (let k = 0; k < 3; k++) a._substep();
  assert.deepEqual(a.snapshot(), end);
  // Same planar arrays, different identity: refused both ways before any write.
  const flat = world(bending), planar = world();
  for (const w of [flat, planar]) { w.setInitialReferencePose(w.x.map((v, i) => i % 3 === 0 ? v * 1.0001 : v)); w._substep(); }
  const fromBending = flat.snapshot(), fromPlanar = planar.snapshot();
  const before = raw(planar);
  assert.throws(() => planar.restore(fromBending), /binding mismatch/); assert.deepEqual(raw(planar), before);
  assert.throws(() => flat.restore(fromPlanar), /binding mismatch/);
  console.log('bending-snapshots: restore continues bitwise; snapshot identity is a copy; planar and bending snapshots refuse each other');
});
