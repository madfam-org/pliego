// Contact-free constitutive/time-integration counterexample. No preview or
// wall-time-based compression. Engine sleep is counted separately. Compare to an axial bar;
// this is a synthetic estimate-based stock, not physical material calibration.
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { World } from '../src/index.js';
import { DocBuilder } from '../test/helpers/docbuilder.js';

const hash = data => createHash('sha256').update(data).digest('hex');
const root = fileURLToPath(new URL('../../../', import.meta.url));
function engineFiles() {
  const result = {}, base = fileURLToPath(new URL('../src/', import.meta.url));
  function visit(dir, prefix = '') {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (e.isDirectory()) visit(join(dir, e.name), prefix + e.name + '/');
      else if (e.name.endsWith('.js')) result[prefix + e.name] = hash(readFileSync(join(dir, e.name)));
    }
  }
  visit(base); return result;
}
const sourceStart = { git: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  status: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), files: engineFiles(),
  harnessSHA256: hash(readFileSync(fileURLToPath(import.meta.url))) };
const localContact = process.argv.includes('--local-contact');
const b = new DocBuilder('axial paper strip, 100 by 10 mm');
b.rect({ id: 'strip', width: 100, height: 10, grain: 0,
  placement: { origin: [0, 100, 0], rotation: [0, 0, 0, 1] } });
b.joins.push({ id: 'root', type: 'pin', a: { sheet: 'strip', along: [[0, 0], [0, 10]] }, world: null });
const json = b.build(), force = 10000;
const d = json['pliego:stocks']['copy-80'].derived;
const reference = force * 100 / (d.E_md * d.thickness * 10);
const settings = localContact ? [32, 128].flatMap(barrierIterations => ['off', 'surface-guarded'].map(edgeEdgeMollification => ({
  substeps: 8, newtonIterations: 1, physicalMembrane: true, barrierContact: true, barrierIterations,
  barrierLinearSolver: 'direct-local', consistentMembraneCurvature: true,
  ...(edgeEdgeMollification === 'off' ? {} : { edgeEdgeMollification }),
}))) : [
  { substeps: 8, newtonIterations: 1, physicalMembrane: false },
  { substeps: 8, newtonIterations: 1, physicalMembrane: true },
  { substeps: 8, newtonIterations: 1, physicalMembrane: true, lineSearch: true },
  { substeps: 8, newtonIterations: 8, physicalMembrane: true, lineSearch: true },
  { substeps: 64, newtonIterations: 1, physicalMembrane: true, lineSearch: true },
  { substeps: 128, newtonIterations: 1, physicalMembrane: true, lineSearch: true },
  { substeps: 256, newtonIterations: 1, physicalMembrane: true, lineSearch: true },
  { substeps: 8, newtonIterations: 1, physicalMembrane: true, lineSearch: true, previousPoseStart: true },
  ...[8, 32, 256].map(barrierIterations => ({ substeps: 8, newtonIterations: 1, physicalMembrane: true, barrierContact: true, barrierIterations })),
];
const results = [];
for (const options of settings) {
  const r = { options, frames: 0, finite: true, maxStrain: 0, error: null, extensionMm: null,
    extensionAtHalfTimeMm: null, driftMm: null, relativeBarError: null, maxSpeedMmPerSecond: null };
  const times = [], activeTimes = [];
  r.activeFrames = 0; r.asleepFrames = 0; r.maximumBarrierStencils = 0; r.maximumBarrierEnergy = 0;
  try {
    const w = new World(json, { ...options, meshEdge: 10, gravity: false, ground: false, contact: !!options.barrierContact, plasticity: false, seed: 1 });
    const tip = [];
    for (let v = 0; v < w.mesh.nV; v++) if (Math.abs(w.mesh.uv[2 * v] - 100) < 1e-9) tip.push(v);
    for (const v of tip) w.setForce(v, [force / tip.length, 0, 0]);
    const extension = () => tip.reduce((s, v) => s + w.positions[3 * v] - 100, 0) / tip.length;
    for (let f = 0; f < 180; f++) {
      const asleep = w.stats().asleep, t = performance.now(); w.step(1 / 60); const elapsed = performance.now() - t; times.push(elapsed);
      if (asleep) r.asleepFrames++; else { r.activeFrames++; activeTimes.push(elapsed); }
      const stats = w.stats(); r.frames++;
      if (stats.coupledContact) {
        r.maximumBarrierStencils = Math.max(r.maximumBarrierStencils, stats.coupledContact.last.contacts);
        r.maximumBarrierEnergy = Math.max(r.maximumBarrierEnergy, stats.coupledContact.last.barrierEnergy);
        if (r.maximumBarrierStencils || r.maximumBarrierEnergy) throw new Error('Axial reference acquired barrier forces; no longer contact-free');
      }
      r.finite &&= stats.finite; r.maxStrain = Math.max(r.maxStrain, stats.maxStrain);
      if (f === 89) r.extensionAtHalfTimeMm = extension();
      if (!stats.finite) throw new Error('Non-finite strip');
    }
    r.extensionMm = extension(); r.driftMm = Math.abs(r.extensionMm - r.extensionAtHalfTimeMm);
    r.relativeBarError = Math.abs(r.extensionMm - reference) / reference;
    r.maxSpeedMmPerSecond = 0;
    for (let v = 0; v < w.mesh.nV; v++) r.maxSpeedMmPerSecond = Math.max(r.maxSpeedMmPerSecond, Math.hypot(...w.v.subarray(3 * v, 3 * v + 3)));
    r.backtracks = w.stats().lineSearchBacktracks; r.rejected = w.stats().lineSearchRejected;
    r.poseSHA256 = hash(Buffer.from(w.positions.buffer));
    r.vertices = w.mesh.nV;
    r.substepsExecuted = w.substepsRun; r.coupledContact = w.stats().coupledContact;
    if (localContact) {
      for (const v of tip) w.setForce(v, [0, 0, 0]);
      r.unload = { frames: 0, extensionMm: null, finalMaxSpeedMmPerSecond: 0, coupledContact: null, poseSHA256: null,
        timing: 'not included in loaded-phase timing statistics' };
      for (let frame = 0; frame < 120; frame++) {
        w.step(1 / 60); r.unload.frames++;
        const stats = w.stats();
        if (!stats.finite) throw new Error('Non-finite unloaded strip');
        if (stats.coupledContact.last.contacts || stats.coupledContact.last.barrierEnergy) throw new Error('Unloaded axial strip acquired contact forces');
      }
      r.unload.extensionMm = extension(); r.unload.coupledContact = w.stats().coupledContact;
      r.unload.poseSHA256 = hash(Buffer.from(w.positions.buffer));
      for (let v = 0; v < w.mesh.nV; v++) r.unload.finalMaxSpeedMmPerSecond = Math.max(r.unload.finalMaxSpeedMmPerSecond, Math.hypot(...w.v.subarray(3 * v, 3 * v + 3)));
      r.unload.gates = { restWithin1PercentBarExtension: Math.abs(r.unload.extensionMm) <= 0.01 * reference,
        finalForceConverged: r.unload.coupledContact.last.converged,
        allUnloadingStepsConverged: r.unload.coupledContact.unconverged === r.coupledContact.unconverged };
    }
  } catch (e) { r.error = e.message; }
  r.meanStepMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  r.p95StepMs = times.toSorted((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1] ?? null;
  r.p95ActiveStepMs = activeTimes.toSorted((a, b) => a - b)[Math.ceil(activeTimes.length * 0.95) - 1] ?? null;
  r.maxStepMs = times.length ? Math.max(...times) : null;
  r.gates = { tensile: !r.error && r.extensionMm > 0,
    axialBar5Percent: !r.error && r.relativeBarError <= 0.05,
    drift1Percent: !r.error && r.driftMm <= 0.01 * reference,
    physics8ms: !r.error && r.p95ActiveStepMs !== null && r.p95ActiveStepMs <= 8,
    finalForceConverged: options.barrierContact ? !r.error && r.coupledContact?.last.converged : 'not measured by legacy path',
    allSolverStepsConverged: options.barrierContact ? !r.error && r.coupledContact?.unconverged === 0 : 'not measured by legacy path' };
  results.push(r);
  console.error(`axial-pull: S=${options.substeps} I=${options.newtonIterations} physical=${options.physicalMembrane} search=${!!options.lineSearch} barrier=${!!options.barrierContact} BI=${options.barrierIterations ?? 0} extension=${r.extensionMm} mm referenceError=${r.relativeBarError} drift=${r.driftMm} activeP95=${r.p95ActiveStepMs?.toFixed(3)}ms ${r.error || ''}`);
}
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== sourceStart.git
  || execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }) !== sourceStart.status
  || JSON.stringify(engineFiles()) !== JSON.stringify(sourceStart.files)
  || hash(readFileSync(fileURLToPath(import.meta.url))) !== sourceStart.harnessSHA256) throw new Error('Source changed during axial benchmark; discard results');
const report = { schema: localContact ? 'pliego-axial-pull/0.3' : 'pliego-axial-pull/0.2', recordedAt: new Date().toISOString(),
  source: { git: sourceStart.git, dirty: !!sourceStart.status.trim(), fixtureSHA256: hash(JSON.stringify(json)),
    files: sourceStart.files, harnessSHA256: sourceStart.harnessSHA256 },
  runtime: { node: process.version, cpu: cpus()[0]?.model },
  protocol: { forceMicroNewtons: force, lengthMm: 100, widthMm: 10, frames: 180, frameSeconds: 1 / 60,
    contact: 'disabled in legacy; enabled in coupled path but zero active barrier stencils/energy required',
    analyticalBarExtensionMm: reference, materialBasis: 'DocBuilder copy-80 synthetic estimate; E*t*width axial-bar reference, not a calibrated 2D FE solution',
    ...(localContact ? { unloadFrames: 120, variants: 'direct-local, consistent curvature, uncapped membrane; I32/I128 each with smoothing off/on; zero active contact required' } : {}),
    timing: 'one local exploratory run; step only; includes warm-up; active-step p95 excludes frames already asleep at step start; max includes all frames' }, results };
const output = JSON.stringify(report, null, 2) + '\n';
const i = process.argv.indexOf('--out');
if (i >= 0) writeFileSync(process.argv[i + 1], output); else process.stdout.write(output);
console.error(`axial-pull: cases=${results.length} tensile=${results.filter(r => r.gates.tensile).length} bar5Percent=${results.filter(r => r.gates.axialBar5Percent).length}`);
