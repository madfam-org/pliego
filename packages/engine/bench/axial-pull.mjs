// Contact-free constitutive/time-integration counterexample. No preview or step
// skipping. Compare numerical response to a small-strain axial-bar reference;
// this is a synthetic estimate-based stock, not physical material calibration.
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { World } from '../src/index.js';
import { DocBuilder } from '../test/helpers/docbuilder.js';

const hash = data => createHash('sha256').update(data).digest('hex');
const b = new DocBuilder('axial paper strip, 100 by 10 mm');
b.rect({ id: 'strip', width: 100, height: 10, grain: 0,
  placement: { origin: [0, 100, 0], rotation: [0, 0, 0, 1] } });
b.joins.push({ id: 'root', type: 'pin', a: { sheet: 'strip', along: [[0, 0], [0, 10]] }, world: null });
const json = b.build(), force = 10000;
const d = json['pliego:stocks']['copy-80'].derived;
const reference = force * 100 / (d.E_md * d.thickness * 10);
const settings = [
  { substeps: 8, newtonIterations: 1, physicalMembrane: false },
  { substeps: 8, newtonIterations: 1, physicalMembrane: true },
  { substeps: 8, newtonIterations: 1, physicalMembrane: true, lineSearch: true },
  { substeps: 8, newtonIterations: 8, physicalMembrane: true, lineSearch: true },
  { substeps: 64, newtonIterations: 1, physicalMembrane: true, lineSearch: true },
  { substeps: 128, newtonIterations: 1, physicalMembrane: true, lineSearch: true },
  { substeps: 256, newtonIterations: 1, physicalMembrane: true, lineSearch: true },
];
const results = [];
for (const options of settings) {
  const r = { options, frames: 0, finite: true, maxStrain: 0, error: null, extensionMm: null,
    extensionAtHalfTimeMm: null, driftMm: null, relativeBarError: null, maxSpeedMmPerSecond: null };
  const times = [];
  try {
    const w = new World(json, { ...options, meshEdge: 10, gravity: false, ground: false, contact: false, plasticity: false, seed: 1 });
    const tip = [];
    for (let v = 0; v < w.mesh.nV; v++) if (Math.abs(w.mesh.uv[2 * v] - 100) < 1e-9) tip.push(v);
    for (const v of tip) w.setForce(v, [force / tip.length, 0, 0]);
    const extension = () => tip.reduce((s, v) => s + w.positions[3 * v] - 100, 0) / tip.length;
    for (let f = 0; f < 180; f++) {
      const t = performance.now(); w.step(1 / 60); times.push(performance.now() - t);
      const stats = w.stats(); r.frames++;
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
  } catch (e) { r.error = e.message; }
  r.meanStepMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  r.p95StepMs = times.toSorted((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1] ?? null;
  r.gates = { tensile: !r.error && r.extensionMm > 0,
    axialBar5Percent: !r.error && r.relativeBarError <= 0.05,
    drift1Percent: !r.error && r.driftMm <= 0.01 * reference,
    physics8ms: !r.error && r.p95StepMs <= 8 };
  results.push(r);
  console.error(`axial-pull: S=${options.substeps} I=${options.newtonIterations} physical=${options.physicalMembrane} search=${!!options.lineSearch} extension=${r.extensionMm} mm referenceError=${r.relativeBarError} drift=${r.driftMm} p95=${r.p95StepMs?.toFixed(3)}ms ${r.error || ''}`);
}
const sourceFiles = ['xpbd/world.js', 'xpbd/energy-search.js', 'xpbd/implicit.js', 'xpbd/pcg.js', 'constants.js'];
const report = { schema: 'pliego-axial-pull/0.1', recordedAt: new Date().toISOString(),
  source: { git: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8' }).trim(),
    fixtureSHA256: hash(JSON.stringify(json)), files: Object.fromEntries(sourceFiles.map(name => [name, hash(readFileSync(new URL('../src/' + name, import.meta.url)))])),
    harnessSHA256: hash(readFileSync(fileURLToPath(import.meta.url))) },
  runtime: { node: process.version, cpu: cpus()[0]?.model },
  protocol: { forceMicroNewtons: force, lengthMm: 100, widthMm: 10, frames: 180, frameSeconds: 1 / 60, contact: false,
    analyticalBarExtensionMm: reference, materialBasis: 'DocBuilder copy-80 synthetic estimate; E*t*width axial-bar reference, not a calibrated 2D FE solution',
    timing: 'one local exploratory run; step only; includes warm-up' }, results };
const output = JSON.stringify(report, null, 2) + '\n';
const i = process.argv.indexOf('--out');
if (i >= 0) writeFileSync(process.argv[i + 1], output); else process.stdout.write(output);
console.error(`axial-pull: cases=${results.length} tensile=${results.filter(r => r.gates.tensile).length} bar5Percent=${results.filter(r => r.gates.axialBar5Percent).length}`);
