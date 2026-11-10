// Bench-only observation of the real reference-displacement Newton/search path.
// No solve, gradient refresh, boundary API, target reset or force-gate substitution.
import { createHash } from 'node:crypto';
import { EnergySearch } from '../src/xpbd/energy-search.js';
import { hessianTimes } from '../src/xpbd/pcg.js';
import { World } from '../src/index.js';
import { REFERENCE_STATE_IDENTITY, validateReferenceBinding } from '../src/xpbd/reference-state.js';
import { validateIncrementDomain, INCREMENT_SEARCH_IDENTITY } from '../src/xpbd/increment-search.js';
import * as K from '../src/constants.js';

const attached = new WeakSet(), MODE = 'reference-displacement';
const demand = (ok, message) => { if (!ok) throw new Error('membrane-state-modal-solve-observer: ' + message); };
const message = error => error?.message ?? String(error);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const vector = (a, n) => a instanceof Float64Array && a.length === n && a.every(finite);
const zero = a => Array.from(a).every(x => x === 0);
const same = (a, b) => !!a && !!b && a.length === b.length && Array.from(a).every((x, i) => Object.is(x, b[i]));
const norm = a => a.reduce((sum, v) => Math.hypot(sum, v), 0);
const maximum = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const clone = a => a instanceof Float64Array ? a.slice() : null;
const littleEndian = new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 2;

// Preserve actual typed words (including zero signs and invalid-candidate NaN
// payloads), rather than making JSON numbers authoritative for failed trials.
function bindings(fields) {
  const stateFloat64LE = {}, stateSHA256 = {}, nonfiniteFields = [];
  for (const [key, a] of Object.entries(fields)) {
    demand(a instanceof Float64Array, 'typed binding unavailable: ' + key);
    const source = new DataView(a.buffer, a.byteOffset, a.byteLength), bytes = Buffer.alloc(a.byteLength);
    for (let i = 0; i < a.length; i++) bytes.writeBigUInt64LE(source.getBigUint64(8 * i, littleEndian), 8 * i);
    stateFloat64LE[key] = bytes.toString('base64'); stateSHA256[key] = createHash('sha256').update(bytes).digest('hex');
    if (!a.every(finite)) nonfiniteFields.push(key);
  }
  return { stateFloat64LE, stateSHA256, nonfiniteFields };
}

function domain(w, context, policy, candidate = false) {
  const errors = [];
  try {
    demand(w.opts.stateCoordinates === MODE && JSON.stringify(w._referenceIdentity) === JSON.stringify(REFERENCE_STATE_IDENTITY), 'reference state identity changed');
    validateReferenceBinding(w); validateIncrementDomain(w, w.x);
    demand(w.energySearch instanceof EnergySearch && w.energySearch.increment, 'actual increment EnergySearch required');
    demand(w.sys.freeIdx.every((k, i) => k === i) && w.sys.nFree === w.mesh.nV, 'unexpected native free-index ordering');
    demand(w.dt === 1 / (60 * w.opts.substeps), 'public timestep mismatch');
    demand(context.world === w && Object.is(context.forceScale, policy.forceScale) && Object.is(context.forceTolerance, policy.forceTolerance), 'World association or fixed force policy changed');
    const n = w.x.length;
    for (const name of ['_us', '_ut', 'xs', 'xt', 'v', '_referenceOrigin']) demand(vector(w[name], n), 'invalid native state buffer: ' + name);
    if (!candidate) {
      demand(vector(w._u, n), 'invalid initial authoritative buffer');
      demand(w.x.every((x, i) => Object.is(w._referenceOrigin[i] + w._u[i], x)), 'initial public/latent projection mismatch');
    }
  } catch (error) { errors.push(message(error)); }
  return errors;
}

function shadowWorld(w) {
  const shadow = Object.create(w);
  for (const key of ['thetaPred', 'hingeGrad', 'edgeDir', 'edgeComp', 'edgeK', 'factorDir', 'g']) shadow[key] = w[key].slice();
  const membrane = Object.create(w.orthotropicMembrane);
  membrane.work = structuredClone(w.orthotropicMembrane.work); membrane.block = w.orthotropicMembrane.block.slice();
  shadow.orthotropicMembrane = membrane;
  return shadow;
}

/** The operator that actually produced this iteration's direction. Gauss–Newton
 * Worlds return null (their records keep the historical shape and wording).
 * Exact-curvature Worlds bind the loop's own receipt: an exact direction uses
 * exact membrane curvature; a visible fallback uses Gauss–Newton.
 * @param {any} w @param {string} source */
function effectiveOperator(w, source) {
  if (w.opts.membraneCurvature !== 'exact-hessian') return null;
  const last = w._exactCurvature?.last;
  demand(last && ['exact-hessian', 'gauss-newton-fallback'].includes(last.direction) && last.requested === 'exact-hessian', 'exact-curvature iteration receipt unavailable');
  demand(last.source === (source === 'pcg' ? 'pcg' : 'direct') && (source !== 'direct-after-pcg-failure' || (last.pcg && last.pcg.reason !== 'converged')), 'exact-curvature receipt does not match the inferred direction source');
  return { requested: 'exact-hessian', operator: last.direction === 'exact-hessian' ? 'exact-hessian' : 'gauss-newton', receipt: structuredClone(last),
    scope: 'nominal/realized defects use the operator that produced this direction; a fallback is never labelled exact' };
}

function measure(w, startU, direction, gradient, curvature = null) {
  const product = new Float64Array(gradient.length);
  if (curvature) hessianTimes(shadowWorld(w), startU, direction, product, MODE, curvature);
  else hessianTimes(shadowWorld(w), startU, direction, product, MODE);
  const residual = Array.from(product, (x, i) => x + gradient[i]), rhsNorm = norm(gradient), residualNorm = norm(residual);
  demand(product.every(finite) && residual.every(finite) && finite(rhsNorm) && finite(residualNorm), 'nonfinite latent Hessian product/residual');
  return { direction: Array.from(direction), product: Array.from(product), residual, residualInfinity: maximum(residual),
    residualNorm, rhsNorm, relativeResidual: rhsNorm > 0 ? residualNorm / rhsNorm : residualNorm === 0 ? 0 : null,
    zeroDirection: zero(direction), coordinates: MODE,
    ...(curvature ? { operator: curvature } : {}),
    equation: curvature === 'exact-hessian' ? 'actual incremental exact-membrane-curvature H(startU)*direction + actual latent solver gradient; not final nonlinear/public force'
      : 'actual incremental GN H(startU)*direction + actual latent solver gradient; not final nonlinear/public force' };
}

function propertyDescriptor(search, name) {
  const descriptor = Object.getOwnPropertyDescriptor(search, name);
  demand(descriptor ? Object.hasOwn(descriptor, 'value') && descriptor.writable === true : Object.isExtensible(search), 'method cannot be safely wrapped/restored: ' + name);
  return descriptor;
}
const descriptorSame = (a, b) => a && b && ['value', 'writable', 'enumerable', 'configurable', 'get', 'set'].every(k => Object.is(a[k], b[k]));
function restoreDescriptor(search, name, original) {
  if (original) Object.defineProperty(search, name, original); else delete search[name];
}

/** Observe one-substep public calls without changing native budgets or calls.
 * Callback receives a detached record; its errors count separately from physics.
 * Retain none for streaming summaries; all full fields are still delivered.
 */
export function attachStateModalSolveObserver(context, { onIteration, retain = 'all', ...unknown } = {}) {
  demand(Object.keys(unknown).length === 0, 'unknown observer option');
  demand(['all', 'none'].includes(retain), 'unknown retention policy');
  demand(onIteration === undefined || typeof onIteration === 'function' && !['AsyncFunction', 'AsyncGeneratorFunction'].includes(onIteration.constructor?.name), 'synchronous callback required');
  const w = context?.world;
  demand(w instanceof World, 'actual reference-state World context required');
  const policy = { forceScale: context.forceScale, forceTolerance: context.forceTolerance };
  demand(finite(policy.forceScale) && policy.forceScale >= 0 && finite(policy.forceTolerance) && policy.forceTolerance === Math.max(1e-7, 1e-10 * policy.forceScale), 'unchanged fixed initial force scale/tolerance required');
  demand(!w._referenceStepActive && !w._referenceNewtonActive && !w.energySearch?._incrementObjective, 'attach only at a completed boundary');
  const initialErrors = domain(w, context, policy);
  demand(initialErrors.length === 0, initialErrors.join('; '));
  const search = w.energySearch;
  demand(!attached.has(search), 'observer already attached');
  demand(search.begin === EnergySearch.prototype.begin && search.finish === EnergySearch.prototype.finish, 'unrecognized or already wrapped EnergySearch methods');
  const beginDescriptor = propertyDescriptor(search, 'begin'), finishDescriptor = propertyDescriptor(search, 'finish');
  const originalBegin = search.begin, originalFinish = search.finish, records = [], callbackErrors = [];
  const counts = { begins: 0, finishes: 0, observed: 0, retained: 0, missing: 0, callbackErrors: 0 };
  let pending = null, detached = false;
  const emit = record => {
    counts.observed++; if (!record.valid) counts.missing++;
    if (retain === 'all') { records.push(record); counts.retained++; }
    if (onIteration) {
      try {
        const result = onIteration(structuredClone(record));
        if (result && typeof result.then === 'function') {
          // Reject asynchronous observation without leaving an already-rejected
          // native Promise unhandled. Arbitrary thenables are never invoked.
          if (result instanceof Promise) Promise.prototype.then.call(result, undefined, () => {});
          throw new Error('membrane-state-modal-solve-observer: async callback result unsupported');
        }
      }
      catch (error) { counts.callbackErrors++; callbackErrors.push({ iteration: record.iteration, message: message(error) }); }
    }
  };
  function begin(world) {
    counts.begins++;
    if (pending) { emit({ iteration: pending.iteration, valid: false, incomplete: true, missing: ['begin without matching finish'] }); pending = null; }
    let result;
    try { result = originalBegin.call(this, world); }
    catch (error) { emit({ iteration: counts.begins, valid: false, incomplete: true, missing: ['original begin threw: ' + message(error)] }); throw error; }
    try {
      const errors = world === w && this === search ? domain(world, context, policy) : ['unexpected World/search association'];
      pending = { iteration: counts.begins, startU: world._u.slice(), startX: world.x.slice(), us: world._us.slice(), ut: world._ut.slice(),
        xs: world.xs.slice(), xt: world.xt.slice(), x0: world._referenceOrigin.slice(), mass: world.mass.slice(), h: world.dt,
        factorCount: world.factorCount, dirty: world.dirty, pcgFail: world._pcgFail, backtracks: this.backtracks, rejected: this.rejected,
        time: world.time, framesRun: world.framesRun, substepsRun: world.substepsRun, increment: structuredClone(this.increment), errors,
        stateIdentity: structuredClone(world._referenceIdentity), arithmeticIdentity: structuredClone(world.orthotropicMembrane.configuration.arithmetic),
        referenceIdentity: structuredClone(world.orthotropicMembrane.configuration.reference) };
      if (world.framesRun !== world.substepsRun + 1 || !world._referenceStepActive || !world._referenceNewtonActive) pending.errors.push('not inside the supported one-substep public Newton call');
    } catch (error) { pending = { iteration: counts.begins, errors: ['begin capture unavailable: ' + message(error)] }; }
    return result;
  }
  function finish(world, g) {
    const before = pending, missing = [], record = { iteration: before?.iteration ?? null, valid: false, missing,
      nominal: null, realized: null, source: null, acceptedAlpha: null, lineSearch: null, incrementTrial: null, lastTrialU: null, lastTrialX: null };
    pending = null; counts.finishes++;
    const candidate = clone(world?._u), candidatePublic = clone(world?.x), gradient = clone(g);
    let nominalPacked = null;
    try {
      demand(before && world === w && this === search, 'finish without matching actual begin');
      missing.push(...before.errors, ...domain(world, context, policy, true));
      Object.assign(record, { startU: Array.from(before.startU), startX: Array.from(before.startX), candidateU: candidate && Array.from(candidate),
        candidatePublicBeforeFinish: candidatePublic && Array.from(candidatePublic), gradient: gradient && Array.from(gradient),
        us: Array.from(before.us), ut: Array.from(before.ut), xs: Array.from(before.xs), xt: Array.from(before.xt), x0: Array.from(before.x0), mass: Array.from(before.mass), h: before.h,
        time: before.time, framesRun: before.framesRun, substepsRun: before.substepsRun, forceScale: policy.forceScale, forceTolerance: policy.forceTolerance,
        stateCoordinates: MODE, stateIdentity: before.stateIdentity, membraneArithmetic: 'double-double', membraneArithmeticIdentity: before.arithmeticIdentity,
        membraneReference: 'uv-displacement', membraneReferenceIdentity: before.referenceIdentity });
      demand(missing.length === 0, 'unsupported World state');
      demand(same(this.start, before.startU), 'EnergySearch authoritative start changed');
      demand(vector(gradient, w.x.length) && vector(candidate, w.x.length), 'actual candidate/gradient unavailable or nonfinite');
      demand(same(candidatePublic, before.startX), 'public view changed before real search finish');
      const factorDelta = w.factorCount - before.factorCount;
      Object.assign(record, { factorCountBefore: before.factorCount, factorCountAfter: w.factorCount, factorDelta,
        dirtyBefore: before.dirty, pcgFailBefore: before.pcgFail, pcgFailAfterSolve: w._pcgFail,
        pcgAttempted: before.dirty === false && !(before.pcgFail > 0), pcgIterations: null });
      let packed;
      if (factorDelta === 1) {
        packed = w.sys.rhs; record.source = record.pcgAttempted ? 'direct-after-pcg-failure' : 'direct';
        if (record.pcgAttempted) { demand(w._pcgFail === K.PCG_FAIL_HOLD, 'failed-PCG fallback hold not observed'); record.pcgIterations = w.pcgIterations; }
      } else if (factorDelta === 0 && record.pcgAttempted && w._pcgFail === before.pcgFail) {
        packed = w._pcg?.d; record.source = 'pcg'; record.pcgIterations = w.pcgIterations;
      } else throw new Error('nominal direction source cannot be inferred safely');
      demand(vector(packed, 3 * w.sys.nFree), 'nominal direction buffer unavailable/nonfinite');
      nominalPacked = packed.slice(); record.packedDirection = Array.from(nominalPacked);
      record.packedDirectionSource = record.source === 'pcg' ? '_pcg.d' : 'sys.rhs';
      if (record.pcgAttempted) demand(Number.isSafeInteger(record.pcgIterations) && record.pcgIterations >= 0 && record.pcgIterations <= K.PCG_MAX_ITER, 'PCG iteration count unavailable');
      const nominal = new Float64Array(w.x.length);
      for (let v = 0; v < w.mesh.nV; v++) for (let c = 0; c < 3; c++) nominal[3 * v + c] = packed[3 * w.sys.freeIdx[v] + c];
      const zeroRhsSkip = record.source === 'pcg' && record.pcgIterations === 0 && zero(gradient) && zero(nominal);
      demand(zeroRhsSkip ? same(candidate, before.startU) : candidate.every((u, i) => Object.is(u, before.startU[i] + nominal[i])), 'nominal buffer does not reconstruct actual candidate');
      record.nominalUpdateApplied = !zeroRhsSkip;
      const curvature = effectiveOperator(w, record.source);
      if (curvature) record.membraneCurvature = curvature;
      record.nominal = measure(w, before.startU, nominal, gradient, curvature?.operator ?? null);
      record.realized = measure(w, before.startU, Float64Array.from(candidate, (u, i) => u - before.startU[i]), gradient, curvature?.operator ?? null);
      if (curvature?.operator === 'gauss-newton') record.requestedOperatorNominal = { ...measure(w, before.startU, nominal, gradient, 'exact-hessian'),
        scope: 'additional named diagnostic: requested exact operator against the Gauss–Newton fallback direction; not the solved-system defect' };
      record.nominal.directionArithmetic = 'actual packed native binary64 solve buffer, unpacked in native free-index order';
      record.realized.directionArithmetic = 'native binary64 candidateU-startU; exact endpoint words are bound separately';
      record.roundingDifferenceInfinity = maximum(record.realized.direction.map((u, i) => u - nominal[i]));
    } catch (error) { missing.push(message(error)); }
    // Original finish always executes exactly once, even when observation failed.
    let result, originalError;
    try { result = originalFinish.call(this, world, g); }
    catch (error) { originalError = error; missing.push('original finish threw: ' + message(error)); }
    try {
      demand(before && world === w && this === search, 'missing search association after finish');
      record.afterU = Array.from(w._u); record.afterX = Array.from(w.x);
      record.acceptedRealizedDirection = Array.from(w._u, (u, i) => u - before.startU[i]);
      record.increment = structuredClone(this.increment);
      demand(!originalError, 'original finish did not complete; decision unavailable');
      demand(same(w._ut, before.ut) && same(w.mass, before.mass) && Object.is(w.dt, before.h), 'native objective changed during observed search');
      demand(w.x.every((x, i) => Object.is(x, before.x0[i] + w._u[i])), 'finish did not publish actual authoritative projection');
      const backtracks = this.backtracks - before.backtracks, rejected = this.rejected - before.rejected, current = this.increment, last = current?.last;
      demand(Number.isSafeInteger(backtracks) && backtracks >= 0 && backtracks <= 20 && (rejected === 0 || rejected === 1), 'unrecognized search counter deltas');
      demand(last && Number.isSafeInteger(last.trials) && last.trials >= 1 && last.trials <= 21 && last.alpha === 2 ** -(last.trials - 1), 'last actual trial/count unavailable');
      const decision = last.decision, accepted = decision === 'accepted', stationaryNoop = decision === 'stationary-noop', precisionLimited = decision === 'precision-limited-zero-step';
      demand(accepted || stationaryNoop || precisionLimited || decision === 'rejected', 'unknown increment decision');
      demand(current.accepted - before.increment.accepted === Number(accepted) && current.stationaryNoops - before.increment.stationaryNoops === Number(stationaryNoop) &&
        current.precisionLimited - before.increment.precisionLimited === Number(precisionLimited), 'increment decision/counter mismatch');
      const invalidTrials = current.invalidTrials - before.increment.invalidTrials;
      demand(Number.isSafeInteger(invalidTrials) && invalidTrials >= 0 && invalidTrials <= last.trials, 'invalid trial counter mismatch');
      demand(rejected === Number(!accepted && !stationaryNoop) && (!rejected || backtracks === 0), 'increment/legacy rejection mismatch');
      if (accepted) demand(last.alpha === 2 ** -backtracks && last.trials === backtracks + 1, 'accepted alpha/backtrack mismatch');
      demand(Object.values(last).every(v => typeof v !== 'number' || finite(v)), 'nonfinite last-trial diagnostics');
      record.acceptedAlpha = accepted ? last.alpha : stationaryNoop ? null : 0;
      record.lineSearch = { accepted, stationaryNoop, precisionLimited, rejected: rejected === 1, decision, acceptedBacktracks: backtracks,
        invalidTrials, trials: last.trials, rejectedTrialCount: last.trials - Number(accepted || stationaryNoop),
        rejectedTrialCountScope: 'actual increment trial count; stationary no-op is distinct from an accepted update' };
      demand(candidate && gradient, 'trial inputs unavailable');
      const lastTrial = last.trials === 1 ? candidate.slice() : Float64Array.from(before.startU, (u, i) => u + last.alpha * (candidate[i] - u));
      const lastTrialX = Float64Array.from(lastTrial, (u, i) => before.x0[i] + u);
      record.lastTrialU = Array.from(lastTrial); record.lastTrialX = Array.from(lastTrialX);
      record.lastTrialSource = last.trials === 1 ? 'actual pre-search candidate' : 'exact declared runtime interpolation expression, not the restored endpoint';
      record.incrementTrial = { coordinates: MODE, beforeU: Array.from(before.startU), trialU: Array.from(lastTrial), ut: Array.from(before.ut), mass: Array.from(before.mass), h: before.h,
        gradient: Array.from(gradient), runtime: { ...structuredClone(last), c1: INCREMENT_SEARCH_IDENTITY.armijo },
        scope: 'last evaluated trial in authoritative coordinates; final restored/accepted state is record.afterU, not necessarily trialU' };
      if (accepted) demand(same(lastTrial, w._u), 'accepted trial differs from final authority');
      if (stationaryNoop) demand(zero(record.acceptedRealizedDirection) && zero(gradient) && backtracks === 0, 'stationary no-op is not an accepted nonzero update');
      if (rejected) demand(same(w._u, before.startU), 'rejected search did not restore authority');
      const fields = { startU: before.startU, candidateU: candidate, afterU: w._u, lastTrialU: lastTrial, startX: before.startX,
        candidatePublicBeforeFinish: candidatePublic, afterX: w.x, lastTrialX, us: before.us, ut: before.ut, xs: before.xs, xt: before.xt,
        x0: before.x0, mass: before.mass, h: Float64Array.of(before.h), gradient, acceptedRealizedDirection: Float64Array.from(record.acceptedRealizedDirection) };
      if (nominalPacked) fields.packedDirection = nominalPacked;
      if (record.nominal) fields.nominalDirection = Float64Array.from(record.nominal.direction);
      if (record.realized) fields.realizedDirection = Float64Array.from(record.realized.direction);
      Object.assign(record, bindings(fields));
      const trialBindings = [['beforeU', 'startU'], ['trialU', 'lastTrialU'], ['ut', 'ut'], ['mass', 'mass'], ['h', 'h'], ['gradient', 'gradient']];
      record.incrementTrial.stateFloat64LE = Object.fromEntries(trialBindings.map(([key, source]) => [key, record.stateFloat64LE[source]]));
      record.incrementTrial.stateSHA256 = Object.fromEntries(trialBindings.map(([key, source]) => [key, record.stateSHA256[source]]));
      if (record.nonfiniteFields.length) missing.push('nonfinite realized trial fields: ' + record.nonfiniteFields.join(','));
    } catch (error) { missing.push(message(error)); }
    record.valid = missing.length === 0; emit(record);
    if (originalError) throw originalError;
    return result;
  }
  const installedBegin = beginDescriptor ? { ...beginDescriptor, value: begin } : { value: begin, writable: true, enumerable: true, configurable: true };
  const installedFinish = finishDescriptor ? { ...finishDescriptor, value: finish } : { value: finish, writable: true, enumerable: true, configurable: true };
  try { Object.defineProperty(search, 'begin', installedBegin); Object.defineProperty(search, 'finish', installedFinish); }
  catch (error) { restoreDescriptor(search, 'begin', beginDescriptor); restoreDescriptor(search, 'finish', finishDescriptor); throw error; }
  attached.add(search);
  return { records, counts, callbackErrors, retentionPolicy: retain,
    detach() {
      if (detached) return;
      demand(descriptorSame(Object.getOwnPropertyDescriptor(search, 'begin'), installedBegin) && descriptorSame(Object.getOwnPropertyDescriptor(search, 'finish'), installedFinish), 'methods/descriptors replaced while attached; refusing to overwrite another wrapper');
      restoreDescriptor(search, 'begin', beginDescriptor); restoreDescriptor(search, 'finish', finishDescriptor);
      attached.delete(search); detached = true;
      if (pending) { emit({ iteration: pending.iteration, valid: false, incomplete: true, missing: ['detached before matching finish'] }); pending = null; }
    } };
}
