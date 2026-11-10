// Bench-only observation of actual World Newton directions; no solve is repeated.
import { EnergySearch } from '../src/xpbd/energy-search.js';
import { hessianTimes } from '../src/xpbd/pcg.js';
import { World } from '../src/index.js';
import * as K from '../src/constants.js';

const attached = new WeakSet();
const demand = (ok, message) => { if (!ok) throw new Error('membrane-modal-solve-observer: ' + message); };
const finite = x => typeof x === 'number' && Number.isFinite(x);
const vector = (a, n) => a instanceof Float64Array && a.length === n && a.every(finite);
const zero = a => a && Array.from(a).every(x => x === 0);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const norm = a => a.reduce((sum, v) => Math.hypot(sum, v), 0);
const maximum = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

function domain(w) {
  const errors = [], check = (ok, message) => { if (!ok) errors.push(message); };
  check(w?.orthotropicMembrane?.configuration?.model === 'orthotropic-stvk', 'selected research law missing');
  check(w.opts.membraneModel === 'orthotropic-stvk' && w.opts.membraneCurvature === 'gauss-newton' && w.opts.membraneProjection === 'none', 'research law/operator/projection configuration changed');
  check(w?.opts?.lineSearch === true && w.energySearch instanceof EnergySearch, 'actual EnergySearch required');
  check(!w.fixed.some(Boolean) && w.sys.nFree === w.mesh.nV && w.invMass.every(m => m > 0), 'only all-free native DOFs supported');
  check(!w.contact && !w.coupledContact && !w.motionGuard && !w.edgeContact && !w.opts.contact && !w.opts.ground, 'contact/ground outside observer domain');
  check(!w.opts.gravity && !w.opts.plasticity && w.opts.damping === 0 && w.bendDamp === 0, 'external/dissipative options outside domain');
  check(zero(w.userForce) && zero(w.fext) && w.drivers.wind === 0 && zero(w.driveOn) && zero(w.terms.active), 'external/drive/join force outside domain');
  check(w.x.every((x, i) => finite(x) && (i % 3 !== 1 || x === 0)) && w.v.every((x, i) => finite(x) && (i % 3 !== 1 || x === 0)), 'only finite exactly planar state supported');
  check(w.sys.freeIdx.every((k, i) => k === i), 'unexpected native free-index ordering');
  check(finite(w.dt) && w.dt > 0 && w.dt === 1 / (60 * w.opts.substeps), 'public timestep mismatch');
  return errors;
}

// hessianTimes uses the actual gradient's hinge caches. Copy all mutable scratch
// rather than refreshing gradient, assembling, factoring or touching live caches.
function shadowWorld(w) {
  const shadow = Object.create(w);
  for (const key of ['thetaPred', 'hingeGrad', 'edgeDir', 'edgeComp', 'edgeK']) shadow[key] = w[key].slice();
  const selected = Object.create(w.orthotropicMembrane);
  selected.work = Object.fromEntries(Object.entries(w.orthotropicMembrane.work).map(([key, value]) => [key, ArrayBuffer.isView(value) ? value.slice() : value]));
  selected.block = w.orthotropicMembrane.block.slice();
  shadow.orthotropicMembrane = selected;
  return shadow;
}

function measure(w, start, direction, g) {
  const product = new Float64Array(g.length);
  hessianTimes(shadowWorld(w), start, direction, product);
  const residual = Array.from(product, (value, i) => value + g[i]), rhsNorm = norm(g), residualNorm = norm(residual);
  demand(product.every(finite) && residual.every(finite) && finite(rhsNorm) && finite(residualNorm), 'nonfinite actual Hessian product/residual norm');
  return { direction: Array.from(direction), product: Array.from(product), residual,
    residualInfinity: maximum(residual), residualNorm, rhsNorm,
    relativeResidual: rhsNorm > 0 ? residualNorm / rhsNorm : residualNorm === 0 ? 0 : null,
    zeroDirection: zero(direction), equation: 'actual incremental Gauss-Newton H(start)*direction + actual solver gradient; not final nonlinear force' };
}

/** Attach only to the supported free, planar modal research World. Originals run
 * exactly once; diagnostics never solve, alter options or refresh live caches.
 * retain='none' streams copied records without retaining full fields. Callback
 * exceptions are recorded as observation failures and do not interrupt physics.
 */
export function attachModalSolveObserver(context, { onIteration, retain = 'all', ...unknown } = {}) {
  demand(Object.keys(unknown).length === 0, 'unknown observer option');
  demand(['all', 'none'].includes(retain), 'unknown retention policy');
  demand(onIteration === undefined || typeof onIteration === 'function' && onIteration.constructor.name !== 'AsyncFunction', 'synchronous callback required');
  const w = context?.world;
  demand(w instanceof World && w.mesh && w.sys, 'actual modal World context required');
  const initialErrors = domain(w);
  demand(initialErrors.length === 0, initialErrors.join('; '));
  const search = w.energySearch;
  demand(!attached.has(search), 'observer already attached');
  demand(search.begin === EnergySearch.prototype.begin && search.finish === EnergySearch.prototype.finish, 'unrecognized or already wrapped EnergySearch methods');
  const beginDescriptor = Object.getOwnPropertyDescriptor(search, 'begin'), finishDescriptor = Object.getOwnPropertyDescriptor(search, 'finish');
  const originalBegin = search.begin, originalFinish = search.finish, records = [];
  const counts = { begins: 0, finishes: 0, observed: 0, retained: 0, missing: 0, callbackErrors: 0 };
  const callbackErrors = [];
  let pending = null, detached = false;
  const emit = record => {
    counts.observed++; if (!record.valid) counts.missing++;
    if (retain === 'all') { records.push(record); counts.retained++; }
    if (onIteration) {
      try { const value = onIteration(structuredClone(record)); demand(!value || typeof value.then !== 'function', 'async callback result unsupported'); }
      catch (cause) { counts.callbackErrors++; callbackErrors.push({ iteration: record.iteration, message: cause.message }); }
    }
  };
  function begin(world) {
    // Capturing cannot replace or suppress an original begin exception.
    counts.begins++;
    let result;
    try { result = originalBegin.call(this, world); }
    catch (cause) {
      emit({ iteration: counts.begins, valid: false, missing: ['original begin threw: ' + cause.message], incomplete: true });
      throw cause;
    }
    if (pending) emit({ iteration: pending.iteration, valid: false, missing: ['begin without matching finish'], incomplete: true });
    try {
      pending = { iteration: counts.begins, start: world.x.slice(), factorCount: world.factorCount,
        dirty: world.dirty, pcgFail: world._pcgFail, backtracks: this.backtracks, rejected: this.rejected,
        time: world.time, framesRun: world.framesRun, substepsRun: world.substepsRun, h: world.dt,
        errors: world === w && this === search ? domain(world) : ['unexpected World/search association'] };
      if (world.framesRun !== world.substepsRun + 1) pending.errors.push('not inside the supported one-substep public call');
    } catch (cause) { pending = { iteration: counts.begins, errors: ['begin capture unavailable: ' + cause.message] }; }
    return result;
  }
  function finish(world, g) {
    const before = pending, missing = [], record = { iteration: before?.iteration ?? null, valid: false, missing,
      nominal: null, rounded: null, source: null, acceptedAlpha: null, lineSearch: null };
    pending = null; counts.finishes++;
    let candidate = null;
    try {
      demand(before && world === w && this === search, 'finish without matching actual begin');
      missing.push(...before.errors, ...domain(world)); demand(missing.length === 0, 'unsupported World state');
      const size = w.x.length, factorDelta = w.factorCount - before.factorCount;
      demand(same(this.start, before.start), 'EnergySearch start changed');
      demand(vector(g, size), 'actual solver gradient unavailable');
      candidate = w.x.slice();
      const rounded = Float64Array.from(candidate, (x, i) => x - before.start[i]);
      Object.assign(record, { start: Array.from(before.start), candidate: Array.from(candidate), gradient: Array.from(g),
        h: before.h, time: before.time, framesRun: before.framesRun, substepsRun: before.substepsRun,
        factorCountBefore: before.factorCount, factorCountAfter: w.factorCount, factorDelta,
        dirtyBefore: before.dirty, pcgFailBefore: before.pcgFail, pcgFailAfterSolve: w._pcgFail,
        pcgAttempted: before.dirty === false && !(before.pcgFail > 0),
        pcgIterations: null, rounded: measure(w, before.start, rounded, g) });
      let packed = null;
      if (factorDelta === 1) {
        packed = w.sys.rhs;
        record.source = record.pcgAttempted ? 'direct-after-pcg-failure' : 'direct';
        if (record.pcgAttempted) {
          demand(w._pcgFail === K.PCG_FAIL_HOLD, 'failed-PCG fallback hold not observed');
          record.pcgIterations = w.pcgIterations;
        }
      } else if (factorDelta === 0 && record.pcgAttempted && w._pcgFail === before.pcgFail) {
        packed = w._pcg?.d; record.source = 'pcg'; record.pcgIterations = w.pcgIterations;
      } else throw new Error('nominal direction source cannot be inferred safely');
      demand(vector(packed, 3 * w.sys.nFree), 'nominal direction buffer unavailable/nonfinite');
      if (record.pcgAttempted) demand(Number.isSafeInteger(record.pcgIterations) && record.pcgIterations >= 0 && record.pcgIterations <= K.PCG_MAX_ITER, 'PCG iteration count unavailable');
      const nominal = new Float64Array(size);
      for (let v = 0; v < w.mesh.nV; v++) for (let c = 0; c < 3; c++) nominal[3 * v + c] = packed[3 * w.sys.freeIdx[v] + c];
      demand(candidate.every((x, i) => x === before.start[i] + nominal[i]), 'nominal buffer does not reconstruct actual pre-search candidate');
      record.nominal = measure(w, before.start, nominal, g);
      record.roundingDifferenceInfinity = maximum(Array.from(rounded, (x, i) => x - nominal[i]));
    } catch (cause) { missing.push(cause.message); }
    // Never skip or duplicate the real globalization, including diagnostic failure.
    let result, originalError;
    try { result = originalFinish.call(this, world, g); }
    catch (cause) { originalError = cause; missing.push('original finish threw: ' + cause.message); }
    try {
      demand(before && world === w && this === search, 'missing search association after finish');
      record.after = Array.from(w.x); record.acceptedRoundedDirection = Array.from(w.x, (x, i) => x - before.start[i]);
      demand(!originalError, 'original finish did not complete; acceptance decision unavailable');
      const backtracks = this.backtracks - before.backtracks, rejected = this.rejected - before.rejected;
      demand(Number.isSafeInteger(backtracks) && backtracks >= 0 && backtracks <= 20 && (rejected === 0 || rejected === 1), 'unrecognized search counter deltas');
      demand(rejected === 0 || backtracks === 0, 'rejected search changed accepted-backtrack count');
      record.acceptedAlpha = rejected ? 0 : 2 ** -backtracks;
      record.lineSearch = { accepted: rejected === 0, rejected: rejected === 1, acceptedBacktracks: backtracks,
        rejectedTrialCount: null, rejectedTrialCountScope: 'not exposed by original EnergySearch; never inferred from accepted-backtrack counter' };
      if (candidate) demand(w.x.every((x, i) => x === (rejected ? before.start[i] : backtracks ? before.start[i] + record.acceptedAlpha * (candidate[i] - before.start[i]) : candidate[i])), 'actual post-search position differs from counter-derived decision');
    } catch (cause) { missing.push(cause.message); }
    record.valid = missing.length === 0; emit(record);
    if (originalError) throw originalError;
    return result;
  }
  search.begin = begin; search.finish = finish; attached.add(search);
  return { records, counts, callbackErrors, retentionPolicy: retain,
    detach() {
      if (detached) return;
      demand(search.begin === begin && search.finish === finish, 'methods replaced while observer attached; refusing to overwrite another wrapper');
      if (beginDescriptor) Object.defineProperty(search, 'begin', beginDescriptor); else delete search.begin;
      if (finishDescriptor) Object.defineProperty(search, 'finish', finishDescriptor); else delete search.finish;
      attached.delete(search); detached = true;
      if (pending) { emit({ iteration: pending.iteration, valid: false, missing: ['detached before matching finish'], incomplete: true }); pending = null; }
    } };
}
