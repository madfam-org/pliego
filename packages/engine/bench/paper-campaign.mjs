// Native multi-leaf benchmark. Run on an idle machine; no preview fallback, skipped
// physics time, or wall-time-dependent inputs. A failed numerical gate stops that
// case and remains a failure in the report (exit 0 means the harness completed).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { cpus, arch, platform } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { BookWorld } from '../../../apps/web/studio/src/book-world.js';
import { engineOptions } from '../../../apps/web/studio/src/physics.js';
import { endpointProgress } from './paper-metrics.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const requestedTurns = Number(arg('--turns') ?? 8);
if (!Number.isInteger(requestedTurns) || requestedTurns < 1 || requestedTurns > 8) throw new RangeError('--turns must be an integer from 1 to 8');
const stopOnZeroProgress = !process.argv.includes('--continue-after-zero');
const turnPlan = [...[0, 1, 2, 3].map(index => ({ index, goal: 180 })), ...[3, 2, 1, 0].map(index => ({ index, goal: 0 }))].slice(0, requestedTurns);
const enginePath = arg('--engine');
const engineURL = enginePath ? pathToFileURL(resolve(enginePath)) : new URL('../src/index.js', import.meta.url);
const engine = await import(engineURL.href);
const path = new URL('../test/fixtures/kernel/codex-four-leaf.fold', import.meta.url);
const bytes = readFileSync(path), json = JSON.parse(bytes);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
function treeHash(directory) {
  const h = createHash('sha256');
  function visit(dir, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = prefix + entry.name, path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path, relative + '/');
      else if (entry.name.endsWith('.js')) { h.update(relative + '\0'); h.update(readFileSync(path)); }
    }
  }
  visit(directory); return h.digest('hex');
}
const engineTreeSHA256 = treeHash(dirname(fileURLToPath(engineURL)));
const readerSHA256 = hash(Buffer.concat(['book-layout.js', 'book-world.js'].map(name => readFileSync(new URL(`../../../apps/web/studio/src/${name}`, import.meta.url)))));
const harnessSHA256 = hash(readFileSync(fileURLToPath(import.meta.url)));
const sourceStart = { git: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  status: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }) };
const quantile = (a, q) => a.length ? a.toSorted((x, y) => x - y)[Math.min(a.length - 1, Math.ceil(a.length * q) - 1)] : null;

// Independent vertex-to-flat-resting-block audit. This does not cover moving
// edge–edge or triangle crossings; a passing result is not a CCD certificate.
function overlapWithRestingBlocks(w, active, positions) {
  let worst = 0;
  const m = w.mesh, x = positions;
  for (let sheet = 0; sheet < w.doc.sheets.length; sheet++) {
    if (sheet === active) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y = 0;
    for (let v = 0; v < m.nV; v++) if (m.vSheet[v] === sheet) {
      x0 = Math.min(x0, w.X0[3 * v]); x1 = Math.max(x1, w.X0[3 * v]);
      z0 = Math.min(z0, w.X0[3 * v + 2]); z1 = Math.max(z1, w.X0[3 * v + 2]); y = w.X0[3 * v + 1];
    }
    const tc = 0.5 * (w.doc.sheets[active].derived.collision_thickness + w.doc.sheets[sheet].derived.collision_thickness);
    for (let v = 0; v < m.nV; v++) if (m.vSheet[v] === active && x[3 * v] >= x0 && x[3 * v] <= x1 && x[3 * v + 2] >= z0 && x[3 * v + 2] <= z1) {
      worst = Math.max(worst, tc - Math.abs(x[3 * v + 1] - y));
    }
  }
  return worst;
}

function run(model, settings) {
  const trajectory = createHash('sha256');
  const times = [], activeTimes = [], options = { ...engineOptions(json), ...settings, mechanismRate: 240, plasticity: false };
  const r = { model, options, frames: 0, turns: 0, maxStrain: 0, maxCompression: 0,
    minY: Infinity, finite: true, error: null, completed: false, modelCachePeak: 0,
    vertexRestBlockOverlapMm: model === 'active-leaf' ? 0 : null, supported: true, endpoints: [],
    continuousContact: { steps: 0, limited: 0, iterationLimits: 0, precisionLimits: 0, initialOverlaps: 0, minimumTime: 1 } };
  r.framesEndingWithZeroProgress = 0;
  r.activeFrames = 0; r.asleepFrames = 0;
  r.coupledContact = { steps: 0, unconverged: 0, iterations: 0, cgTotal: 0, directSolves: 0, nonlocalFallbacks: 0, linearFailures: 0, backtracks: 0, rejected: 0, maximumEndResidual: 0, maximumInitialAdjustment: 0 };
  let w;
  const start = performance.now();
  try {
    w = model === 'active-leaf' ? new BookWorld(engine, json, options) : new engine.World(engine.loadDocument(json), options);
    r.buildMs = performance.now() - start;
    if (settings.physicalMembrane && (w.world || w).opts.physicalMembrane !== true) {
      r.supported = false; throw new Error('Engine does not support the physicalMembrane experiment');
    }
    if (settings.lineSearch && (w.world || w).opts.lineSearch !== true) {
      r.supported = false; throw new Error('Engine does not support the lineSearch experiment');
    }
    if (settings.continuousContact && (w.world || w).opts.continuousContact !== true) {
      r.supported = false; throw new Error('Engine does not support the continuousContact experiment');
    }
    if (settings.barrierContact && (w.world || w).opts.barrierContact !== true) {
      r.supported = false; throw new Error('Engine does not support the barrierContact experiment');
    }
    if (settings.previousPoseStart && (w.world || w).opts.previousPoseStart !== true) {
      r.supported = false; throw new Error('Engine does not support the previousPoseStart experiment');
    }
    if (settings.consistentMembraneCurvature && (w.world || w).opts.consistentMembraneCurvature !== true) {
      r.supported = false; throw new Error('Engine does not support consistent membrane curvature');
    }
    if (settings.barrierLinearSolver && (w.world || w).coupledContact?.linearSolver !== settings.barrierLinearSolver) {
      r.supported = false; throw new Error('Engine does not support the requested barrier linear solver');
    }
    const seenCCD = new Map(), seenCoupled = new Map();
    for (const { index, goal } of turnPlan) {
      if (model === 'active-leaf') {
        if (!w.navigate(goal ? 'forward' : 'backward')) throw new Error('Reader refused an exposed turn');
      } else w.setControl(`turn-${index + 1}`, goal);
      const initialCCD = (w.world || w).stats().continuousContact;
      if (initialCCD) seenCCD.set(w.world || w, initialCCD);
      const initialCoupled = (w.world || w).stats().coupledContact;
      if (initialCoupled) seenCoupled.set(w.world || w, initialCoupled);
      for (let f = 0; f < 84; f++) {
        const asleep = (w.world || w).stats().asleep, t = performance.now(); w.step(1 / 60); const elapsed = performance.now() - t;
        times.push(elapsed); r.frames++; if (asleep) r.asleepFrames++; else { r.activeFrames++; activeTimes.push(elapsed); }
        const released = model === 'active-leaf' && f === 83 ? w.lastRelease : null;
        const stats = released?.stats || w.stats(), native = model === 'active-leaf' ? w.world : w;
        if (stats.continuousContact) {
          const c = stats.continuousContact, prev = seenCCD.get(native) || {};
          for (const key of ['steps', 'limited', 'iterationLimits', 'precisionLimits', 'initialOverlaps']) r.continuousContact[key] += c[key] - (prev[key] || 0);
          r.continuousContact.minimumTime = Math.min(r.continuousContact.minimumTime, c.minimumTime);
          seenCCD.set(native, c);
        }
        if (stats.coupledContact) {
          const c = stats.coupledContact, prev = seenCoupled.get(native) || {};
          for (const key of ['steps', 'unconverged', 'iterations', 'cgTotal', 'directSolves', 'nonlocalFallbacks', 'linearFailures', 'backtracks', 'rejected']) r.coupledContact[key] += (c[key] || 0) - (prev[key] || 0);
          r.coupledContact.maximumEndResidual = Math.max(r.coupledContact.maximumEndResidual, c.maximumEndResidual);
          r.coupledContact.maximumInitialAdjustment = Math.max(r.coupledContact.maximumInitialAdjustment, c.initialAdjustment);
          seenCoupled.set(native, c);
        }
        r.finite &&= stats.finite;
        r.maxStrain = Math.max(r.maxStrain, stats.maxStrain);
        r.maxCompression = Math.max(r.maxCompression, stats.maxCompression);
        const positions = released?.positions || native.x;
        trajectory.update(`${index}:${goal}:${f}:${positions.length}\0`);
        trajectory.update(Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength));
        for (let i = 1; i < positions.length; i += 3) r.minY = Math.min(r.minY, positions[i]);
        if (w.models) r.modelCachePeak = Math.max(r.modelCachePeak, w.models.size);
        if (model === 'active-leaf') r.vertexRestBlockOverlapMm = Math.max(r.vertexRestBlockOverlapMm,
          overlapWithRestingBlocks(native, w.book.leaves[w.active].sheet, released?.positions || native.x));
        if (!r.finite || r.maxStrain > 0.01 || r.minY < -0.1) throw new Error('Numerical gate failed');
        if (stats.continuousContact?.last.time === 0) {
          r.framesEndingWithZeroProgress++;
          if (stopOnZeroProgress) throw new Error('Continuous contact made zero progress; no flat promotion accepted');
        }
        if (f === 83) r.endpoints.push({ sheet: model === 'active-leaf' ? w.book.leaves[w.active].sheet : index,
          goal, ...endpointProgress(native, model === 'active-leaf' ? w.book.leaves[w.active].sheet : index, positions, goal) });
      }
      r.turns++;
      if (settings.barrierContact) console.error(`paper-barrier-progress: ${model} turn=${r.turns}/${requestedTurns} frames=${r.frames} endpointMinimum=${r.endpoints.at(-1).minimum} unconverged=${r.coupledContact.unconverged}/${r.coupledContact.steps} backtracks=${r.coupledContact.backtracks}`);
      if (settings.continuousContact) console.error(`paper-contact-progress: ${model} turn=${r.turns} endpointMinimum=${r.endpoints.at(-1).minimum} limited=${r.continuousContact.limited} iterationLimits=${r.continuousContact.iterationLimits}`);
    }
    r.completed = true;
  } catch (e) { r.error = e.message; }
  if (w) {
    const native = model === 'active-leaf' ? w.world : w;
    r.poseSHA256 = hash(Buffer.from(native.x.buffer, native.x.byteOffset, native.x.byteLength));
    r.vertices = native.mesh.nV; r.freeVertices = native.sys.nFree;
    r.lineSearchBacktracks = native.stats().lineSearchBacktracks ?? null;
    r.lineSearchRejected = native.stats().lineSearchRejected ?? null;
    r.lastContinuousContact = native.stats().continuousContact ?? null;
    r.lastCoupledContact = native.stats().coupledContact ?? null;
    w.dispose?.();
  }
  r.stepMeanMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  r.stepP95Ms = quantile(times, 0.95); r.stepMaxMs = times.length ? Math.max(...times) : null;
  r.activeStepP95Ms = quantile(activeTimes, 0.95);
  r.trajectorySHA256 = trajectory.digest('hex');
  r.gates = {
    numerical1Percent: r.completed && r.finite && r.maxStrain <= 0.01 && r.minY >= -0.1,
    numericalPoint1Percent: r.completed && r.finite && r.maxStrain <= 0.001 && r.minY >= -0.1,
    physics8ms: r.completed && r.activeStepP95Ms !== null && r.activeStepP95Ms <= 8,
    restingBlockVertexThickness: model === 'active-leaf' ? r.completed && r.vertexRestBlockOverlapMm <= 0.001 : 'not evaluated for all-deformable stacks',
    endpointProgress: r.completed && r.endpoints.length === requestedTurns && r.endpoints.every(e => e.samples > 0 && e.minimum >= 0.9),
    allSolverStepsConverged: settings.barrierContact ? r.completed && r.coupledContact.unconverged === 0 : 'not measured by legacy path',
    physicalMaterialValidation: 'not measured by this booklet benchmark',
    browserInteraction: 'requires separate browser/device acceptance',
  };
  return r;
}

const results = [];
const settingsMatrix = process.argv.includes('--local-matrix')
  ? [{ substeps: 8, newtonIterations: 1 }, { substeps: 8, barrierContact: true, barrierIterations: 8 },
    { substeps: 8, barrierContact: true, barrierIterations: 8, barrierLinearSolver: 'direct-local' },
    { substeps: 8, barrierContact: true, barrierIterations: 8, barrierLinearSolver: 'direct-local', consistentMembraneCurvature: true },
    { substeps: 8, barrierContact: true, barrierIterations: 8, consistentMembraneCurvature: true },
    { substeps: 8, barrierContact: true, barrierIterations: 32, barrierLinearSolver: 'direct-local', consistentMembraneCurvature: true },
    { substeps: 8, physicalMembrane: true, barrierContact: true, barrierIterations: 8, barrierLinearSolver: 'direct-local', consistentMembraneCurvature: true },
    { substeps: 1, barrierContact: true, barrierIterations: 64, barrierLinearSolver: 'direct-local', consistentMembraneCurvature: true }]
  : process.argv.includes('--barrier-matrix')
  ? [{ substeps: 8, newtonIterations: 1 }, { substeps: 8, newtonIterations: 8, lineSearch: true },
    { substeps: 8, newtonIterations: 1, lineSearch: true, previousPoseStart: true },
    { substeps: 8, newtonIterations: 1, barrierContact: true, barrierIterations: 8 },
    { substeps: 1, newtonIterations: 1, barrierContact: true, barrierIterations: 64 },
    { substeps: 8, newtonIterations: 1, physicalMembrane: true, barrierContact: true, barrierIterations: 8 }]
  : process.argv.includes('--contact-matrix')
  ? [{ substeps: 8, newtonIterations: 1 }, { substeps: 8, newtonIterations: 1, continuousContact: true },
    { substeps: 16, newtonIterations: 1, continuousContact: true }, { substeps: 8, newtonIterations: 1, physicalMembrane: true, lineSearch: true, continuousContact: true }]
  : [{ substeps: 8, newtonIterations: 1 }, { substeps: 4, newtonIterations: 2 }, { substeps: 16, newtonIterations: 1 }, { substeps: 8, newtonIterations: 1, physicalMembrane: true }, { substeps: 8, newtonIterations: 1, physicalMembrane: true, lineSearch: true }];
const caseIndex = arg('--case') === null ? null : Number(arg('--case'));
if (caseIndex !== null && (!Number.isInteger(caseIndex) || caseIndex < 1 || caseIndex > settingsMatrix.length)) throw new RangeError('--case is a one-based matrix index');
const models = arg('--model') ? [arg('--model')] : ['all-leaves', 'active-leaf'];
if (models.some(m => !['all-leaves', 'active-leaf'].includes(m))) throw new RangeError('--model must be all-leaves or active-leaf');
for (const settings of caseIndex === null ? settingsMatrix : [settingsMatrix[caseIndex - 1]]) {
  for (const model of models) {
    const r = run(model, settings); results.push(r);
    console.error(`paper-campaign: ${model} S=${settings.substeps} I=${settings.barrierContact ? settings.barrierIterations : settings.newtonIterations ?? 1} physical=${!!settings.physicalMembrane} search=${!!settings.lineSearch} CCD=${!!settings.continuousContact} barrier=${!!settings.barrierContact} turns=${r.turns}/${requestedTurns} strain=${r.maxStrain} p95=${r.stepP95Ms?.toFixed(2)}ms ${r.error || 'completed protocol'}`);
  }
}
const report = {
  schema: 'pliego-paper-campaign/0.3', recordedAt: new Date().toISOString(),
  source: { git: sourceStart.git,
    dirty: !!sourceStart.status.trim(),
    engine: arg('--engine-label') || (enginePath ? 'external engine (caller must record source)' : 'current checkout'),
    engineTreeSHA256, readerSHA256, harnessSHA256,
    metricsSHA256: hash(readFileSync(new URL('./paper-metrics.mjs', import.meta.url))),
    fixture: 'pliego.book.codex(leaves=4,width=90,height=128)', fixtureSHA256: hash(bytes) },
  runtime: { node: process.version, arch: arch(), platform: platform(), cpu: cpus()[0]?.model },
  protocol: { seed: 1, frameSeconds: 1 / 60, framesPerTurn: 84, requestedTurns, stopOnZeroProgress,
    selectedCase: caseIndex ?? 'all', models,
    fallback: false, repetitions: 1, matrix: process.argv.includes('--local-matrix') ? 'local-contact' : process.argv.includes('--barrier-matrix') ? 'coupled-contact' : process.argv.includes('--contact-matrix') ? 'continuous-contact' : 'solver',
    trajectory: 'SHA256 of turn/frame headers and every sampled pre-promotion Float64 pose, native-endian; includes frames completed before failure',
    endpointGate: 'every sampled fore-edge vertex reaches >=90% of its destination X displacement before flat promotion; not an equilibrium or material validation',
    continuousContact: 'experimental global endpoint-motion filter; safety=0.1, maxIterations=256 per pair; stopOnZeroProgress declares whether zero progress stops the case',
    timingScope: 'World.step only; includes first-frame/JIT cost; active-step p95 excludes frames asleep at start; exploratory local measurement',
    coupledContact: 'normal finite-gap barrier, h=0.05 mm k=1e5 g/s², force tolerance=0.001 µN, CG cap=128, per-iteration CCD/energy search; no projection constraints or friction' },
  reduction: 'Active-leaf reader promotes releases to flat resting blocks after 1.4 simulation seconds; pre-promotion release poses are audited. Plasticity disabled for reading. Not an unconstrained stack equilibrium.',
  materialAudit: Object.fromEntries(Object.entries(json['pliego:stocks']).map(([id, stock]) => {
    const d = stock.derived, cap = engine.constants.MEMBRANE_CAP_LENGTH * d.areal_density * engine.constants.GRAVITY;
    return [id, { capY: cap, physicalYmd: d.E_md * d.thickness, physicalYcd: d.E_cd * d.thickness,
      retainedMD: Math.min(1, cap / (d.E_md * d.thickness)), retainedCD: Math.min(1, cap / (d.E_cd * d.thickness)) }];
  })),
  results,
};
if (sourceStart.git !== execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  || sourceStart.status !== execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  || engineTreeSHA256 !== treeHash(dirname(fileURLToPath(engineURL)))
  || harnessSHA256 !== hash(readFileSync(fileURLToPath(import.meta.url)))
  || readerSHA256 !== hash(Buffer.concat(['book-layout.js', 'book-world.js'].map(name => readFileSync(new URL(`../../../apps/web/studio/src/${name}`, import.meta.url)))))) {
  throw new Error('Source changed during benchmark; discard these results and rerun');
}
const output = JSON.stringify(report, null, 2) + '\n';
if (arg('--out')) writeFileSync(resolve(arg('--out')), output); else process.stdout.write(output);
console.error(`paper-campaign: cases=${results.length} completedProtocols=${results.filter(r => r.completed).length} numericalGate=${results.filter(r => r.gates.numerical1Percent).length} endpointGate=${results.filter(r => r.gates.endpointProgress).length} solverConvergenceGate=${results.filter(r => r.gates.allSolverStepsConverged === true).length}`);
