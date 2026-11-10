import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createUVReferenceElement } from '../src/xpbd/orthotropic-membrane.js';

const python = process.env.PLIEGO_AUDIT_PYTHON || 'python3';
const oracle = fileURLToPath(new URL('../bench/membrane-state-precision.py', import.meta.url));
const archive = new URL('../../../docs/research/evidence/membrane-reference-2026-11-10/observed.json', import.meta.url);
const sourceRaw = readFileSync(archive), source = JSON.parse(sourceRaw);
const sha = raw => createHash('sha256').update(raw).digest('hex');
const bytes = values => { const b = Buffer.alloc(values.length*8); values.forEach((x, i) => b.writeDoubleLE(x, 8*i)); return b; };
const decode = text => { const b = Buffer.from(text, 'base64'); return Array.from({ length: b.length/8 }, (_, i) => b.readDoubleLE(8*i)); };
const identity = { mode: 'reference-displacement', version: 1, representation: 'binary64', origin: 'actual-X0', predictor: 'displacement-first', projection: 'round-X0-plus-u', preconditioner: 'rounded-public-pose' };
function origin(c) {
  const native = decode(c.referenceFloat64LE), x0 = Array(c.x.length);
  c.referenceCoefficients.triangles.forEach((t, ti) => t.forEach((id, j) => {
    for (let r=0;r<3;r++) x0[3*id+r] = native[22*ti+6+3*j+r];
  }));
  return x0;
}
function bind(c) {
  const vectors = { x: c.x, xt: c.xt, u: c.state.u, ut: c.state.ut, mass: c.mass, h: [c.h], initialX: c.state.initialization.x, initialU: c.state.initialization.u };
  for (const k of ['us','v','x0']) if (c.state[k]) vectors[k] = c.state[k];
  if (c.xs) vectors.xs = c.xs;
  if (c.state.initialization.v) vectors.initialV = c.state.initialization.v;
  for (const prefix of ['authoritative','public']) {
    for (const k of ['elasticGradient','inertiaGradient','residual']) {
      if (c.runtime[prefix]?.[k]) vectors[prefix+k[0].toUpperCase()+k.slice(1)] = c.runtime[prefix][k];
    }
  }
  c.stateFloat64LE = {}; c.stateSHA256 = {};
  for (const [key, value] of Object.entries(vectors)) {
    const b = bytes(value); c.stateFloat64LE[key] = b.toString('base64'); c.stateSHA256[key] = sha(b);
  }
  return c;
}
function witness() {
  const old = source.cases[80], x0 = origin(old), x = decode(old.stateFloat64LE.x), xt = decode(old.stateFloat64LE.xt);
  assert.equal(old.capture.originalTrialStateSHA256.h, old.stateSHA256.h);
  assert.equal(old.stateFloat64LE.xt, source.cases[0].stateFloat64LE.x, 'same actual native initial x');
  const full = decode(old.stateFloat64LE.incrementalGradient), tolerance = 8.81400646629321e-5;
  const c = { vertices: old.vertices, triangles: old.triangles, material: old.material, grain: old.grain,
    referenceCoefficients: old.referenceCoefficients, referenceFloat64LE: old.referenceFloat64LE,
    referenceSHA256: old.referenceSHA256, referenceEncoding: old.referenceEncoding,
    x, xt, mass: decode(old.stateFloat64LE.mass), h: decode(old.stateFloat64LE.h)[0],
    state: { ...identity, u: x.map((a, i) => a-x0[i]), ut: xt.map((a, i) => a-x0[i]),
      initialization: { x: xt.slice(), u: xt.map((a, i) => a-x0[i]) }, targetValid: true },
    runtime: { fixedForceScale: 881400.646629321, forceTolerance: tolerance,
      public: { energy: old.runtime.energy, elasticGradient: decode(old.stateFloat64LE.gradient),
        inertiaGradient: decode(old.stateFloat64LE.inertiaGradient), residual: full,
        residualInfinity: Math.max(...full.map(Math.abs)), literalForceGate: false } },
    fixture: { source: 'docs/research/evidence/membrane-reference-2026-11-10/observed.json', sha256: sha(sourceRaw),
      caseIndex: 80, selection: source.selections[80], scope: 'converted frozen old-World pose, not a new authoritative World solve' } };
  return bind(c);
}
function control() {
  const c = witness(), x0 = origin(c), u = x0.map((_x, i) => i%3 === 0 ? 2**-10 : 0), x = x0.map((a, i) => a+u[i]);
  c.x = x.slice(); c.xt = x.slice(); c.state = { ...identity, u: u.slice(), ut: u.slice(), targetValid: true,
    initialization: { x: x.slice(), u: u.slice(), v: x.map(() => 0) } };
  const zero = x.map(() => 0), observation = { energy: 0, elasticGradient: zero.slice(), inertiaGradient: zero.slice(), residual: zero.slice(), residualInfinity: 0 };
  c.runtime.authoritative = { ...observation, converged: true };
  c.runtime.public = { ...structuredClone(observation), literalForceGate: true };
  c.fixture.scope = 'exact representable uniform translation analytical control; same native reference/mass/h/force policy';
  return bind(c);
}
function precise(cases, digits=80) {
  const input = JSON.stringify({ cases });
  const r = JSON.parse(execFileSync(python, [oracle, '--digits', String(digits)], { input, encoding: 'utf8', maxBuffer: 16e6 }));
  assert.equal(r.inputSHA256, sha(input)); return r;
}
function parity(cases) {
  const a = precise(cases), b = precise(cases, 100);
  a.cases.forEach((p, i) => { assert.equal(p.decimalDigits, 80); assert.equal(b.cases[i].decimalDigits, 100); delete p.decimalDigits; delete b.cases[i].decimalDigits; });
  assert.deepEqual(a, b); return a.cases;
}
function reject(c, pattern) {
  const result = spawnSync(python, [oracle], { input: JSON.stringify(c), encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.match(JSON.parse(result.stderr).error, pattern);
}
function next(value, up) {
  const b = bytes([value]); let word = b.readBigUInt64LE();
  word += (value >= 0) === up ? 1n : -1n; b.writeBigUInt64LE(word); return b.readDoubleLE();
}
function synthetic(grain=31, moved=false) {
  const c = control(), uv = [0,0,2,.2,.3,1.5];
  const transform = x => x.flatMap((_v, i) => i%3 ? [] : [x[i+2]+4,x[i]-2,x[i+1]+1]);
  let x0 = [3.125,-2.5,4.25,5.125,-2.375,4,3.5,-2,2.75];
  let u = [.03125,.015625,-.0625,.125,-.03125,.015625,-.0625,.03125,.125];
  if (moved) { x0 = transform(x0); u = u.flatMap((_v, i) => i%3 ? [] : [u[i+2],u[i],u[i+1]]); }
  const e = createUVReferenceElement(uv, c.material, grain*Math.PI/180, c.material.nu12, x0);
  const ref = { ...e.reference, u: Array.from(e.reference.u), v: Array.from(e.reference.v), x0: Array.from(e.reference.x0) };
  const element = { Q: Array.from(e.Q), volume: e.volume, reference: ref };
  c.vertices = [uv.slice(0,2),uv.slice(2,4),uv.slice(4,6)]; c.triangles = [[0,1,2]]; c.grain = grain;
  c.referenceCoefficients = { triangles: [[0,1,2]], elements: [element] };
  const raw = bytes([...ref.u,...ref.v,...ref.x0,ref.c,ref.s,...element.Q,element.volume]);
  c.referenceFloat64LE = raw.toString('base64'); c.referenceSHA256 = sha(raw);
  c.x = x0.map((a, i) => a+u[i]); c.xt = x0.slice(); c.mass = [.01,.02,.03];
  c.state = { ...identity, u, ut: x0.map(() => 0), initialization: { x: x0.slice(), u: x0.map(() => 0) }, targetValid: true };
  c.runtime = { fixedForceScale: c.runtime.fixedForceScale, forceTolerance: c.runtime.forceTolerance };
  c.includeHessian = true;
  c.fixture.scope = 'generic finite3D placed pure-law derivative control; no claim of native planar World support';
  return bind(c);
}

test('independent rational state scalar/finite Piola/curvature self-controls are deterministic', () => {
  const a = execFileSync(python, [oracle, '--self-test'], { encoding: 'utf8' });
  assert.equal(a, execFileSync(python, [oracle, '--self-test'], { encoding: 'utf8' }));
  assert.deepEqual(JSON.parse(a).testCases, 3); assert.equal(JSON.parse(a).passed, true);
  console.log('state-oracle-analytic: exact finite Piola energy/gradient, rational FD halving and negative geometric curvature versus GN; no World execution');
});

test('same actual frozen start is exact, public force failure remains, and dyadic rigid control agrees', () => {
  const [w, c] = parity([witness(), control()]);
  assert.equal(w.initialization.twoDiffLowWordsZero, true); assert.equal(w.initialization.exactRealInitialStatePreserved, true);
  assert.equal(w.initialization.publicInitialObjectIsPreserved, true); assert.equal(w.projection.latentEqualsPublicRealState, true);
  assert.equal(w.native.public.literalForceGate, false); assert.ok(w.native.public.residualInfinityMicroN > 50*w.forceToleranceMicroN);
  for (const view of ['authoritative','public']) {
    for (const meaning of Object.values(c.truth[view])) {
      assert.equal(meaning.energyNJ, 0); assert.ok(meaning.elasticGradient.every(x => x === 0));
      assert.equal(meaning.nativeCoefficient.residualInfinityMicroN, 0); assert.equal(meaning.realMass.residualInfinityMicroN, 0);
    }
  }
  assert.equal(c.native.public.literalForceGate, true); assert.equal(c.native.authoritative.converged, true);
  console.log('state-oracle-start: retained UV case80 initial actual LE pose preserved; public failure retained; uniform dyadic translation same reference/mass/h/tau gives exact zero latent/public truth; complete80/100 parity');
});

test('one representable displacement update changes physical q while public x and native public gate stay fixed', () => {
  const c = witness(), x0 = origin(c);
  const index = c.state.u.findIndex((u, i) => u !== 0 && x0[i] !== 0 && Object.is(x0[i]+next(u, true), c.x[i]));
  assert.ok(index >= 0); const old = c.state.u[index]; c.state.u[index] = next(old, true); bind(c);
  const p = parity([c])[0];
  assert.equal(p.projection.publicObjectIsVerified, true); assert.equal(p.projection.latentEqualsPublicRealState, false);
  assert.equal(p.projection.maximumLatentPublicDistanceMm, Math.abs(c.state.u[index]-old));
  assert.ok(p.projection.representedMaximumElasticGradientDifferenceMicroN > 0);
  assert.equal(p.native.public.literalForceGate, false);
  console.log(`state-oracle-grid: coordinate${index} latent delta=${c.state.u[index]-old}mm changes exact real state and force while public LE pose/gate unchanged; no existence/convergence claim`);
});

test('native coefficient and real mass truth are separate; supplied native arithmetic cannot be silently changed', () => {
  const c = control(); c.state.ut[0] -= 2**-20; c.xt[0] = origin(c)[0]+c.state.ut[0];
  const inertia = c.x.map((_v, i) => c.mass[Math.floor(i/3)]*(1/(c.h*c.h))*(c.state.u[i]-c.state.ut[i]));
  for (const prefix of ['authoritative','public']) {
    c.runtime[prefix].inertiaGradient = inertia.slice(); c.runtime[prefix].residual = inertia.slice();
    c.runtime[prefix].residualInfinity = Math.max(...inertia.map(Math.abs));
    c.runtime[prefix][prefix === 'public' ? 'literalForceGate' : 'converged'] = false;
  }
  const p = parity([bind(c)])[0];
  assert.equal(p.native.authoritative.nativeAssociationVerified, true);
  assert.ok(p.truth.authoritative.representedUVDisplacement.nativeVersusRealInertiaMaximumComponentDifferenceMicroN > 0,
    'exact coefficient truths differ even if their separately rounded large residuals coincide');
  c.runtime.authoritative.inertiaGradient[0] = next(inertia[0], true); bind(c);
  reject(c, /native binary64 association/);
  const bad = control(); bad.runtime.forceTolerance *= 2; reject(bad, /fixed initial force/);
  const invalidTarget = control(); invalidTarget.state.targetValid = false;
  invalidTarget.runtime.authoritative.converged = null; invalidTarget.runtime.public.literalForceGate = null;
  const initial = parity([invalidTarget])[0];
  assert.equal(initial.native.authoritative.converged, null); assert.equal(initial.native.public.literalForceGate, null);
  assert.match(initial.forceInterpretation, /cannot certify/);
  invalidTarget.runtime.public.literalForceGate = true; reject(invalidTarget, /native force gate/);
  const forgedNull = control(); forgedNull.runtime.authoritative.converged = null; reject(forgedNull, /native force gate/);
  console.log('state-oracle-inertia: exact native rounded C and realM/h² distinct; unchanged force policy and literal association checked independently');
});

test('state identity, initialization low words, signed-zero projections and lossless corruption refuse visibly', () => {
  const identityBad = control(); identityBad.state.version = true; reject(identityBad, /identity/);
  const low = control(); low.state.initialization.x[0] = Number.MIN_VALUE; low.state.initialization.u[0] = 0; bind(low); reject(low, /TwoDiff/);
  const zero = control(); zero.state.initialization.x[1] = -0; zero.state.initialization.u[1] = -0; bind(zero); reject(zero, /including zero signs/);
  const projected = control(); projected.x[0] = next(projected.x[0], true); bind(projected); reject(projected, /projection/);
  const changed = control(); const raw = Buffer.from(changed.stateFloat64LE.u, 'base64'); raw.writeDoubleLE(7, 0); changed.stateFloat64LE.u = raw.toString('base64'); changed.stateSHA256.u = sha(raw); reject(changed, /state words differ/);
  const badMass = control(); badMass.h = Number.MIN_VALUE; bind(badMass); reject(badMass, /h squared/);
  const changedX0 = control(); changedX0.state.x0 = origin(changedX0); changedX0.state.x0[0] = 7; bind(changedX0); reject(changedX0, /immutable native reference/);
  const signed = control(), native = decode(signed.referenceFloat64LE);
  signed.referenceCoefficients.triangles.forEach((t, ti) => t.forEach((id, j) => {
    if (id === 0) { native[22*ti+6+3*j+1] = -0; signed.referenceCoefficients.elements[ti].reference.x0[3*j+1] = -0; }
  }));
  const rawZero = bytes(native); signed.referenceFloat64LE = rawZero.toString('base64'); signed.referenceSHA256 = sha(rawZero);
  signed.state.initialization.x[1] = -0; signed.state.initialization.u[1] = -0;
  signed.state.u[1] = -0; signed.state.ut[1] = -0; signed.x[1] = -0; signed.xt[1] = -0;
  const signProof = parity([bind(signed)])[0];
  assert.equal(signProof.initialization.signedZeroInitialUOverrides, 1);
  assert.equal(signProof.initialization.publicInitialObjectIsPreserved, true);
  console.log('state-oracle-refusal: strict identity, exact same-start conversion, public Object.is signed-zero projection, LE/source reference consistency and native coefficient domain; no tolerance waiver');
});

test('latent scalar derivatives and exactH are independently checked at generic3D placements and all grains', () => {
  const inputs = [0,31,45,90].flatMap(grain => [synthetic(grain),synthetic(grain, true)]), proofs = parity(inputs);
  for (let i=0;i<proofs.length;i+=2) {
    const a = proofs[i].truth.authoritative.representedUVDisplacement, b = proofs[i+1].truth.authoritative.representedUVDisplacement;
    assert.equal(a.energyNJ, b.energyNJ);
    const movedGradient = a.elasticGradient.flatMap((_x, j) => j%3 ? [] : [a.elasticGradient[j+2],a.elasticGradient[j],a.elasticGradient[j+1]]);
    assert.deepEqual(movedGradient, b.elasticGradient);
  }
  const base = synthetic(), truth = precise([base]).cases[0].truth.authoritative.representedUVDisplacement;
  const index = 3, norm = x => Math.hypot(...x); let lastG = Infinity, lastH = Infinity;
  for (const h of [2**-7,2**-8,2**-9]) {
    const cases = [-1,1].map(sign => {
      const c = structuredClone(base); c.includeHessian = false; c.state.u[index] += sign*h;
      c.x = origin(c).map((x, j) => x+c.state.u[j]); return bind(c);
    });
    const [minus,plus] = precise(cases).cases.map(p => p.truth.authoritative.representedUVDisplacement);
    const ge = Math.abs((plus.energyNJ-minus.energyNJ)/(2*h)-truth.elasticGradient[index]);
    const column = truth.elasticGradient.map((_x, j) => truth.exactHessian[9*j+index]);
    const he = norm(plus.elasticGradient.map((g, j) => (g-minus.elasticGradient[j])/(2*h)-column[j]));
    assert.ok(ge < .26*lastG); assert.ok(he < .26*lastH); lastG = ge; lastH = he;
  }
  assert.ok(lastG/Math.max(1,Math.abs(truth.elasticGradient[index])) < 1e-4);
  console.log('state-oracle-3D:8 generic placed0/31/45/90degree cases complete80/100 parity; exact permutation/translation covariance; independent latent scalar-gradient and gradient-exactH FD halving');
});
