// The fixed 24-trajectory bending capture: the lowest discrete bending mode of the cells2 patch,
// levels 1/2/4/8, Newton budgets 1/4/16 and both previous-pose starts. Mirrors the planar
// membrane-state-modal-audit.mjs structure; no widened geometry, amplitude or retry.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadBendingStateInputs, BENDING_STATE_INPUT_PATH, BENDING_STATE_PROTOCOL } from './bending-state-inputs.mjs';
import { createBendingStateWorld, runBendingStateContext, BENDING_STATE_PCG_STOPS, BENDING_STATE_IDENTITY } from './bending-state-runtime.mjs';
import { bendingComparatorSetup, advanceBackwardEuler, measureBendingState } from './bending-state-metrics.mjs';
import { validateBendingObservation } from './bending-state-validation.mjs';
import { attachStateModalSolveObserver } from './membrane-state-modal-solve-observer.mjs';
import { encodeStateModalVectors } from './membrane-state-modal-runtime.mjs';
import { reserveStateModalOutput } from './membrane-state-modal-output.mjs';
import { EXACT_CURVATURE_IDENTITY } from '../src/xpbd/membrane-curvature.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sha = data => createHash('sha256').update(data).digest('hex');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clone = value => structuredClone(value);
export const BENDING_STATE_LIMITS = Object.freeze({ discreteField: .001, discreteVelocity: .001, discreteEnergy: .005,
  continuousField: .01, continuousVelocity: .01, continuousEnergy: .05, phaseCycles: .01, solveIsolation: 1e-4 });

/** Every producer, helper, oracle and test in the engine package plus the fixture. */
export function bendingStateSource() {
  const paths = [];
  const visit = (folder, prefix, accept) => { for (const e of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (e.isDirectory()) visit(join(folder, e.name), prefix + e.name + '/', accept); else if (accept(e.name)) paths.push(prefix + e.name);
  } };
  visit(join(root, 'packages/engine/src'), 'packages/engine/src/', n => n.endsWith('.js'));
  visit(join(root, 'packages/engine/bench'), 'packages/engine/bench/', n => /\.(mjs|py)$/.test(n));
  visit(join(root, 'packages/engine/test'), 'packages/engine/test/', n => n.endsWith('.js'));
  paths.push(BENDING_STATE_INPUT_PATH);
  return { git: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    status: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    files: paths.sort().map(path => { const b = readFileSync(join(root, path)); return { path, bytes: b.length, sha256: sha(b) }; }) };
}
export function assertBendingStateSource(before) { assert.deepEqual(bendingStateSource(), before, 'source changed during bending matrix; discard capture'); }

function stateHistory(o) {
  const a = o.authoritative, fields = {};
  for (const key of ['x', 'xs', 'xt', 'v']) fields[key] = clone(o[key]);
  for (const key of ['u', 'us', 'ut', 'x0', 'initialX', 'initialU', 'initialV', 'hingeAngles']) fields[key] = clone(a[key]);
  return { step: o.step, time: o.time, h: o.h, targetValid: o.targetValid, execution: clone(o.execution), ...fields,
    publicElasticGradient: clone(o.elasticGradient), publicInertiaGradient: clone(o.inertiaGradient), publicResidual: clone(o.residual),
    authoritativeElasticGradient: clone(a.elasticGradient), authoritativeInertiaGradient: clone(a.inertiaGradient), authoritativeResidual: clone(a.residual),
    publicBendingEnergy: o.bendingEnergy, authoritativeBendingEnergy: a.bendingEnergy,
    stateFloat64LE: clone(o.stateFloat64LE), stateSHA256: clone(o.stateSHA256), forceFloat64LE: clone(o.forceFloat64LE), forceSHA256: clone(o.forceSHA256),
    forceBindingScope: clone(o.forceBindingScope) };
}
function linearSummary(r) {
  const result = { iteration: r.iteration, substepsRun: r.substepsRun, source: r.source, valid: r.valid, missing: clone(r.missing), pcgIterations: r.pcgIterations,
    acceptedAlpha: r.acceptedAlpha, lineSearch: clone(r.lineSearch), increment: clone(r.increment) };
  for (const kind of ['nominal', 'realized']) if (r[kind]) result[kind] = Object.fromEntries(Object.entries(r[kind]).filter(([_k, v]) => !Array.isArray(v) && !ArrayBuffer.isView(v)));
  return result;
}
const initialMaximum = () => { const m = { phaseCycles: 0, inPlaneRelative: 0, membraneCouplingEnergy: 0, clockRelative: 0 };
  for (const scope of ['', 'full']) for (const prefix of ['discrete', 'continuous']) for (const suffix of ['Displacement', 'Velocity', 'State', 'Energy']) m[(scope ? scope + prefix[0].toUpperCase() + prefix.slice(1) : prefix) + suffix] = 0;
  return m; };
// Unprefixed keys are the gated out-of-plane scope; full* keys include in-plane motion and membrane energy.
function updateMaximum(maximum, m, o, steps, phase, context) {
  for (const [prefix, key] of [['discrete', 'backwardEuler'], ['continuous', 'continuous']]) for (const [suffix, field] of [['Displacement', 'displacement'], ['Velocity', 'velocity'], ['State', 'state'], ['Energy', 'energy']]) {
    maximum[prefix + suffix] = Math.max(maximum[prefix + suffix], m.errors[key].outOfPlane[field] ?? Infinity);
    const full = 'full' + prefix[0].toUpperCase() + prefix.slice(1) + suffix;
    maximum[full] = Math.max(maximum[full], m.errors[key].full[field] ?? Infinity);
  }
  maximum.membraneCouplingEnergy = Math.max(maximum.membraneCouplingEnergy, m.membraneCouplingEnergyRelative ?? Infinity);
  maximum.inPlaneRelative = Math.max(maximum.inPlaneRelative, o.inPlaneMassNorm / (Math.abs(context.amplitude) * Math.sqrt(context.modalMass)));
  maximum.clockRelative = Math.max(maximum.clockRelative, Math.abs(m.time - m.step * m.h) / Math.max(steps * m.h, m.h));
  if (phase !== null) maximum.phaseCycles = Math.max(maximum.phaseCycles, Math.abs(phase - context.omega * m.time) / (2 * Math.PI));
}

export function runBendingStateTrajectory(inputs, row, { instrument = true, restoreContinuation = true, membraneCurvature = 'gauss-newton', pcgStop } = {}) {
  const context = createBendingStateWorld(inputs, row, { membraneCurvature, ...(pcgStop === undefined ? {} : { pcgStop }) }), w = context.world;
  assert.equal(w.dt, row.h); assert.equal(w.opts.newtonIterations, row.budget); assert.equal(w.opts.previousPoseStart, row.seed);
  const history = [], trace = [], snapshots = {}, linearTrace = [], linearSnapshots = {}, checkpointSteps = new Set(Array.from({ length: 17 }, (_, i) => Math.round(row.steps * i / 16)));
  let previous = null, setup = null, publicSetup = null, last = null, checkpoint = null, allValid = true;
  const phase = { authoritative: null, public: null }, previousPhase = { authoritative: null, public: null }, phaseObservable = { authoritative: true, public: true };
  let publicFailed = 0, authorityFailed = 0, firstPublicFailure = null, firstAuthorityFailure = null, worstPublic = -1, worstAuthority = -1, closestPublic = Infinity, closestAuthority = Infinity;
  let worstNominal = -1, worstRealized = -1; const maxima = { authoritative: initialMaximum(), public: initialMaximum() };
  const observer = instrument ? attachStateModalSolveObserver(context, { retain: 'none', onIteration: r => {
    linearTrace.push(linearSummary(r));
    const save = role => { linearSnapshots[role] = clone(r); };
    for (const [flag, role] of [['accepted', 'first-accepted'], ['stationaryNoop', 'first-stationary'], ['precisionLimited', 'first-precision-limited'], ['rejected', 'first-rejected']]) if (r.lineSearch?.[flag] && !linearSnapshots[role]) save(role);
    if (!r.valid && !linearSnapshots['first-invalid']) save('first-invalid');
    if (r.nominal?.relativeResidual > worstNominal) { worstNominal = r.nominal.relativeResidual; save('worst-nominal'); }
    if (r.realized?.residualInfinity > worstRealized) { worstRealized = r.realized.residualInfinity; save('worst-realized'); }
  } }) : null;
  let runtime;
  try { runtime = runBendingStateContext(context, { steps: row.steps, retain: 'initial-final', onObservation: o => {
    let validation;
    try { validation = validateBendingObservation(o, { context, previous, world: w }); }
    catch (cause) { validation = { valid: false, converged: false, publicConverged: false, authoritativeConverged: false, errors: ['validator exception: ' + cause.message] }; }
    allValid &&= validation.valid && (o.initial || validation.boundaryCertified === true);
    history.push(stateHistory(o));
    let measured = null, projected = null, metricsError = null;
    const publicU = o.x.map((x, i) => x - o.authoritative.x0[i]);
    try {
      if (o.initial) { setup = bendingComparatorSetup(context, inputs.reference.spectrum, { u: o.authoritative.u, v: o.authoritative.v }); publicSetup = bendingComparatorSetup(context, inputs.reference.spectrum, { u: publicU, v: o.v }); }
      else { advanceBackwardEuler(setup, o.h); advanceBackwardEuler(publicSetup, o.h); }
      measured = { ...measureBendingState(context, setup, { u: o.authoritative.u, v: o.authoritative.v, elasticEnergy: o.authoritative.elasticEnergy, bendingEnergy: o.authoritative.bendingEnergy, time: o.time }), step: o.step, h: o.h };
      projected = { ...measureBendingState(context, publicSetup, { u: publicU, v: o.v, elasticEnergy: o.elasticEnergy, bendingEnergy: o.bendingEnergy, time: o.time }), step: o.step, h: o.h };
    } catch (cause) { metricsError = { name: cause.name, message: cause.message }; allValid = false; }
    const record = { observation: clone(o), validation: clone(validation), metrics: measured, publicMetrics: projected, metricsError };
    const save = role => { snapshots[role] = record; };
    if (o.initial) save('initial'); if (checkpointSteps.has(o.step)) save('checkpoint-' + o.step);
    if (!validation.valid && !snapshots['first-invalid']) save('first-invalid');
    if (metricsError && !snapshots['first-metrics-error']) save('first-metrics-error');
    if (!o.initial) {
      const p = validation.valid && validation.publicConverged === true && o.literalForceGate === true, a = validation.valid && validation.authoritativeConverged === true && o.authoritative.converged === true;
      if (!p) { publicFailed++; if (firstPublicFailure === null) { firstPublicFailure = o.step; save('first-public-failure'); } }
      if (!a) { authorityFailed++; if (firstAuthorityFailure === null) { firstAuthorityFailure = o.step; save('first-authoritative-failure'); } }
      const pr = finite(o.residualInfinity) ? o.residualInfinity / context.forceTolerance : Infinity, ar = finite(o.authoritative.residualInfinity) ? o.authoritative.residualInfinity / context.forceTolerance : Infinity;
      if (pr > worstPublic) { worstPublic = pr; save('worst-public-force'); } if (ar > worstAuthority) { worstAuthority = ar; save('worst-authoritative-force'); }
      if (p && 1 - pr < closestPublic) { closestPublic = 1 - pr; save('closest-public-pass'); } if (a && 1 - ar < closestAuthority) { closestAuthority = 1 - ar; save('closest-authoritative-pass'); }
      if (a && !p && !snapshots['first-latent-pass-public-fail']) save('first-latent-pass-public-fail');
    }
    if (measured && projected) for (const [kind, m, obs] of [['authoritative', measured, o.authoritative], ['public', projected, o]]) {
      if (m.errors.continuous.phaseObservable) { phase[kind] = phase[kind] === null ? m.actualPhase : phase[kind] + Math.atan2(Math.sin(m.actualPhase - previousPhase[kind]), Math.cos(m.actualPhase - previousPhase[kind])); previousPhase[kind] = m.actualPhase; }
      else phaseObservable[kind] = false;
      updateMaximum(maxima[kind], m, obs, row.steps, phase[kind], context);
    }
    trace.push({ step: o.step, time: o.time, h: o.h, targetValid: o.targetValid, elasticEnergy: o.elasticEnergy, bendingEnergy: o.bendingEnergy, inertiaEnergy: o.inertiaEnergy, rawImplicitEnergy: o.rawImplicitEnergy,
      authoritativeElasticEnergy: o.authoritative.elasticEnergy, authoritativeBendingEnergy: o.authoritative.bendingEnergy, authoritativeInertiaEnergy: o.authoritative.inertiaEnergy, authoritativeRawImplicitEnergy: o.authoritative.rawImplicitEnergy,
      residualInfinity: o.residualInfinity, forceTolerance: o.forceTolerance, literalForceGate: o.literalForceGate,
      authoritativeResidualInfinity: o.authoritative.residualInfinity, authoritativeConverged: o.authoritative.converged, modalCoordinate: o.authoritative.modalCoordinate, modalVelocity: o.authoritative.modalVelocity,
      modalLeakageMassNorm: o.authoritative.modalLeakageMassNorm, inPlaneMassNorm: o.authoritative.inPlaneMassNorm, rawSHA256: clone(o.rawSHA256), stateSHA256: clone(o.stateSHA256),
      validation: { valid: validation.valid, converged: validation.converged, publicConverged: validation.publicConverged, authoritativeConverged: validation.authoritativeConverged, boundaryCertified: validation.boundaryCertified,
        actualGradientChecked: validation.actualGradientChecked, liveWorldChecked: validation.liveWorldChecked, losslessBindingsVerified: validation.losslessBindingsVerified, forceBindingsVerified: validation.forceBindingsVerified, errors: clone(validation.errors) },
      authoritativeErrors: measured ? clone(measured.errors) : null, publicErrors: projected ? clone(projected.errors) : null, metricsError,
      unwrappedAuthoritativePhase: phase.authoritative, unwrappedPublicPhase: phase.public, solver: clone(o.solver), execution: clone(o.execution) });
    if (restoreContinuation && o.step === row.steps - 1 && !o.initial && validation.valid) checkpoint = w.snapshot();
    previous = o; last = record;
  } }); } finally { observer?.detach(); }
  snapshots.final = last;
  const continuation = { requested: restoreContinuation, checkpointStep: row.steps - 1, attemptedPublicCalls: 0, replayedPublicCalls: 0, declaredNewtonBudget: row.budget, extraControlNotJudgedTrajectory: true, pass: false, error: null };
  if (restoreContinuation && checkpoint && runtime.completedSteps === row.steps && runtime.status === 'completed') {
    try { const end = w.snapshot(); w.restore(checkpoint); continuation.attemptedPublicCalls = 1; const returned = w.step(w.dt); continuation.replayedPublicCalls = 1; assert.equal(returned, 1); assert.deepEqual(w.snapshot(), end); continuation.pass = true; }
    catch (cause) { continuation.error = { name: cause.name, message: cause.message }; continuation.failureState = { ...encodeStateModalVectors({ u: w._u, us: w._us, ut: w._ut, x: w.x, xs: w.xs, xt: w.xt, v: w.v }), time: w.time, scope: 'raw internal failure buffers; no completed-target certificate' }; }
  }
  const clockPass = maxima.authoritative.clockRelative <= 64 * Number.EPSILON * Math.max(1, row.steps) && maxima.public.clockRelative <= 64 * Number.EPSILON * Math.max(1, row.steps);
  const measurement = clockPass && runtime.status === 'completed' && allValid && runtime.gates.measurementValid && runtime.gates.noSleep && runtime.gates.completeRequestedSteps && runtime.gates.exactActualSubstepCounters;
  const L = BENDING_STATE_LIMITS, agreement = kind => ({
    discrete: measurement && maxima[kind].discreteDisplacement <= L.discreteField && maxima[kind].discreteVelocity <= L.discreteVelocity && maxima[kind].discreteEnergy <= L.discreteEnergy,
    continuous: measurement && phaseObservable[kind] && maxima[kind].phaseCycles <= L.phaseCycles && maxima[kind].continuousDisplacement <= L.continuousField && maxima[kind].continuousVelocity <= L.continuousVelocity && maxima[kind].continuousEnergy <= L.continuousEnergy });
  const linear = instrument && observer.counts.missing === 0 && observer.counts.callbackErrors === 0 && observer.counts.begins === row.steps * row.budget && observer.counts.finishes === row.steps * row.budget && linearTrace.length === row.steps * row.budget;
  const publicAll = measurement && publicFailed === 0, authorityAll = measurement && authorityFailed === 0;
  return { level: row.level, budget: row.budget, seed: row.seed, amplitude: row.amplitude, substeps: row.substeps, steps: row.steps, h: w.dt, options: clone(context.options), parameters: clone(context.parameters),
    fixedForceScale: context.forceScale, forceTolerance: context.forceTolerance, modalMass: context.modalMass, oracleModalMass: inputs.reference.mode.modalMassBinary64,
    modalMassRelativeDifference: Math.abs(context.modalMass - inputs.reference.mode.modalMassBinary64) / inputs.reference.mode.modalMassBinary64,
    comparator: setup ? { modalCoordinates: setup.modes.map(m => ({ c: m.c, d: m.d, omega: m.omega, rigid: m.rigid })), reconstructionMassNorm: setup.reconstructionMassNorm, scale: setup.scale } : null,
    referenceCoefficients: clone(context.referenceCoefficients), referenceWords: encodeStateModalVectors({ reference: context.referenceWords, hingeK: context.hingeKWords }),
    runtime: { ...runtime, observations: undefined, initial: undefined, final: undefined }, trace, history, snapshots, maxima, phaseObservable,
    failedSteps: publicFailed, authoritativeFailedSteps: authorityFailed, firstFailedStep: firstPublicFailure, firstAuthoritativeFailedStep: firstAuthorityFailure,
    poseHistorySHA256: sha(JSON.stringify(history.map(s => s.stateSHA256))), continuation,
    solveObservation: { enabled: instrument, counts: observer ? clone(observer.counts) : null, callbackErrors: clone(observer?.callbackErrors ?? []), trace: linearTrace, snapshots: linearSnapshots,
      scope: 'all actual Newton decision scalars; selected full copied endpoints only; no real-Armijo certification of unsampled events' },
    snapshotPolicy: 'every step retains all native state and force words with SHA; 17 horizon snapshots plus initial/final/first/worst/closest passes; selected Newton full records; no hidden truncation',
    gates: { measurementValid: measurement, clockAccumulation: clockPass, literalForceEverySubstep: publicAll, authoritativeForceEverySubstep: authorityAll, perNewtonLinearDiagnostics: instrument ? linear : 'not measured',
      boundaryRestoreContinuation: restoreContinuation ? continuation.pass : 'not measured',
      linearBendingAgreement: { authoritative: agreement('authoritative'), public: agreement('public') }, timeAccuracyAcceptance: false },
    classification: !measurement ? 'measurement-invalid' : !publicAll ? 'public-incremental-force-nonconvergence' : !authorityAll ? 'authoritative-incremental-force-nonconvergence' : 'force-gates-pass-time-acceptance-open' };
}

function decodeWords(h, key) { const b = Buffer.from(h.stateFloat64LE[key], 'base64'); assert.equal(sha(b), h.stateSHA256[key]); return Array.from({ length: b.length / 8 }, (_, i) => b.readDoubleLE(8 * i)); }
/** Mass-norm state change between two retained states, relative to the mode's amplitude scales. */
export function compareBendingStates(scale, mass, a, b) {
  let du = 0, dv = 0; const ua = decodeWords(a, 'u'), ub = decodeWords(b, 'u'), va = decodeWords(a, 'v'), vb = decodeWords(b, 'v');
  for (let i = 0; i < mass.length; i++) for (let c = 0; c < 3; c++) { du += mass[i] * (ua[3 * i + c] - ub[3 * i + c]) ** 2; dv += mass[i] * (va[3 * i + c] - vb[3 * i + c]) ** 2; }
  const displacement = Math.sqrt(du) / scale.displacement, velocity = Math.sqrt(dv) / scale.velocity;
  return { displacement, velocity, state: Math.hypot(displacement, velocity) };
}
export function bendingStatePairedControls(rows, scale, mass) {
  const budgets = [], levels = [];
  for (const a of rows) for (const b of rows) {
    const budget = a.level === b.level && a.seed === b.seed && ((a.budget === 1 && b.budget === 4) || (a.budget === 4 && b.budget === 16));
    const level = b.level === 2 * a.level && a.budget === b.budget && a.seed === b.seed;
    if (!budget && !level) continue;
    let change = 0, count = 0, maxClock = 0; const errors = [];
    for (let k = 0; k < a.history.length; k++) {
      const l = level ? 2 * k : k, pa = a.history[k], pb = b.history[l]; if (!pb) continue;
      assert.equal(k * a.h, l * b.h, 'paired states must have identical nominal physical time');
      try { change = Math.max(change, compareBendingStates(scale, mass, pa, pb).state); maxClock = Math.max(maxClock, Math.abs(pa.time - pb.time)); count++; }
      catch (cause) { errors.push({ coarseStep: k, refinedStep: l, name: cause.name, message: cause.message }); }
    }
    const result = { seed: a.seed, fromLevel: a.level, toLevel: b.level, fromBudget: a.budget, toBudget: b.budget, matchedStates: count, completeCommonStates: errors.length === 0 && count === a.steps + 1, errors,
      maximumAuthoritativeStateChange: change, maximumActualClockDifference: maxClock, bothAuthorityForceGates: a.gates.authoritativeForceEverySubstep && b.gates.authoritativeForceEverySubstep,
      scope: budget ? 'every matched native step' : 'common coarse index k and refined index 2k; exact nominal h identity, actual clock drift retained' };
    if (budget) { result.authoritativeIsolationPass = result.completeCommonStates && result.bothAuthorityForceGates && change <= BENDING_STATE_LIMITS.solveIsolation; budgets.push(result); } else levels.push(result);
  }
  return { budget: budgets, commonTimeLevels: levels, amplitude: { measured: false, reason: 'only the declared A=.004 mm' }, scope: 'full-state diagnostics cannot waive either force gate or establish time, material or booklet acceptance' };
}

export function runBendingStateAudit({ instrument = true, membraneCurvature = 'gauss-newton', pcgStop, ...unknown } = {}) {
  assert.equal(Object.keys(unknown).length, 0, 'unknown bending audit options'); assert.equal(typeof instrument, 'boolean');
  assert.ok(['gauss-newton', 'exact-hessian'].includes(membraneCurvature)); assert.ok(pcgStop === undefined || Object.hasOwn(BENDING_STATE_PCG_STOPS, pcgStop));
  const before = bendingStateSource(); assert.equal(before.status, '', 'clean source required; no accepted dirty override');
  const inputs = loadBendingStateInputs(), rows = [];
  for (const row of inputs.rows) {
    const result = runBendingStateTrajectory(inputs, row, { instrument, membraneCurvature, ...(pcgStop === undefined ? {} : { pcgStop }) }); rows.push(result);
    console.error('bending-state-progress: level=' + row.level + ' I=' + row.budget + ' previous=' + row.seed + ' public=' + result.failedSteps + '/' + row.steps + ' authoritative=' + result.authoritativeFailedSteps + '/' + row.steps);
  }
  const paired = bendingStatePairedControls(rows, rows[0].comparator.scale, inputs.massWords); assertBendingStateSource(before);
  const exact = membraneCurvature === 'exact-hessian';
  return { schema: 'pliego-bending-state-audit/1', recordedAt: new Date().toISOString(), source: { ...before, status: undefined, dirty: false },
    runtime: { node: process.version, arch: process.arch, platform: process.platform },
    protocol: { ...BENDING_STATE_PROTOCOL, S0: inputs.plan.S0, N0: inputs.plan.N0, poststeps: rows.reduce((s, r) => s + r.steps, 0), newtonEvents: rows.reduce((s, r) => s + r.steps * r.budget, 0), instrument,
      stateIdentity: clone(BENDING_STATE_IDENTITY), limits: BENDING_STATE_LIMITS, membraneCurvature, ...(exact ? { membraneCurvatureIdentity: { ...EXACT_CURVATURE_IDENTITY } } : {}),
      ...(pcgStop === undefined ? {} : { pcgStop: { name: pcgStop, ...BENDING_STATE_PCG_STOPS[pcgStop] } }),
      initialization: 'fixture u = A*phi of the independent lowest bending mode, v = +0, converted once; no target supplied by any oracle',
      referenceMeaning: 'independent stdlib flat-state spectrum of the represented panel-hinge law with real M/h^2; linear comparator, not plate theory or exact native-coefficient propagation',
      perNewtonLinearDiagnostics: instrument ? 'transparent copied streaming callback; all decision scalars and selected full endpoints' : 'not measured',
      extraControls: 'one separately labelled final-substep snapshot continuation per completed trajectory; not judged steps',
      acceptance: 'both force gates and all failures retained; no time, material, booklet, device or 8 ms acceptance' },
    executionTotals: { judgedCompletedPublicCalls: rows.reduce((s, r) => s + r.runtime.completedSteps, 0), retainedStates: rows.reduce((s, r) => s + r.history.length, 0),
      restoreControlCompletedPublicCalls: rows.reduce((s, r) => s + r.continuation.replayedPublicCalls, 0), restoreControlDeclaredNewtonIterations: rows.reduce((s, r) => s + r.continuation.attemptedPublicCalls * r.budget, 0) },
    referenceCapture: clone(inputs.provenance),
    results: [{ geometry: inputs.geometry, vertices: inputs.vertices, triangles: inputs.triangles, material: inputs.material, mesh: inputs.mesh, fixtureSHA256: inputs.fixtureSHA256, meshSHA256: inputs.meshSHA256,
      reference: inputs.reference, plan: inputs.plan, trajectories: rows, pairedControls: paired }],
    gates: { sourceClean: true, completeDeclaredMatrix: rows.length === 24, completeRequestedPoststeps: rows.every(r => r.runtime.completedSteps === r.steps),
      measurementValid: rows.every(r => r.gates.measurementValid), literalForceEverySubstep: rows.every(r => r.gates.literalForceEverySubstep), authoritativeForceEverySubstep: rows.every(r => r.gates.authoritativeForceEverySubstep),
      perNewtonLinearDiagnostics: instrument ? rows.every(r => r.gates.perNewtonLinearDiagnostics === true) : 'not measured', boundaryRestoreContinuation: rows.every(r => r.gates.boundaryRestoreContinuation === true),
      actualTimeAccuracyAcceptance: false, physicalStockCalibration: 'not measured', newModelBooklet: 'not measured', interactionPerformance: 'not measured' },
    scope: 'one fixed 24-row bending matrix; every raw step retained; repeat and observer parity need dedicated comparison; truth samples cannot certify all Newton events' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), plain = args.includes('--no-solve-observer'), oi = args.indexOf('--out'), ci = args.indexOf('--membrane-curvature'), si = args.indexOf('--pcg-stop');
  assert.ok(oi >= 0 && args[oi + 1] && !args[oi + 1].startsWith('--'), '--out fresh durable path required');
  assert.ok(ci < 0 || args[ci + 1] === 'exact-hessian', '--membrane-curvature names only exact-hessian; omission is Gauss-Newton');
  assert.ok(si < 0 || Object.hasOwn(BENDING_STATE_PCG_STOPS, args[si + 1]), '--pcg-stop names one declared stop');
  assert.ok(args.every((a, i) => ['--out', '--no-solve-observer', '--membrane-curvature', '--pcg-stop'].includes(a) || i === oi + 1 || (ci >= 0 && i === ci + 1) || (si >= 0 && i === si + 1)), 'unknown option; fixed 24-row scope only');
  for (const flag of ['--out', '--no-solve-observer', '--membrane-curvature', '--pcg-stop']) assert.ok(args.filter(a => a === flag).length <= 1, 'duplicate option: ' + flag);
  const sink = reserveStateModalOutput(args[oi + 1]);
  try { sink.write(runBendingStateAudit({ instrument: !plain, membraneCurvature: ci >= 0 ? 'exact-hessian' : 'gauss-newton', ...(si >= 0 ? { pcgStop: args[si + 1] } : {}) })); } finally { sink.close(); }
  console.error('bending-state-audit: fixed 24-row bending matrix; raw failed outcomes retained; untimed research');
}
