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

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
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
  const times = [], options = { ...engineOptions(json), ...settings, mechanismRate: 240, plasticity: false };
  const r = { model, options, frames: 0, turns: 0, maxStrain: 0, maxCompression: 0,
    minY: Infinity, finite: true, error: null, completed: false, modelCachePeak: 0,
    vertexRestBlockOverlapMm: model === 'active-leaf' ? 0 : null, supported: true };
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
    for (const goal of [180, 0]) for (const index of goal ? [0, 1, 2, 3] : [3, 2, 1, 0]) {
      if (model === 'active-leaf') {
        if (!w.navigate(goal ? 'forward' : 'backward')) throw new Error('Reader refused an exposed turn');
      } else w.setControl(`turn-${index + 1}`, goal);
      for (let f = 0; f < 84; f++) {
        const t = performance.now(); w.step(1 / 60); times.push(performance.now() - t); r.frames++;
        const released = model === 'active-leaf' && f === 83 ? w.lastRelease : null;
        const stats = released?.stats || w.stats(), native = model === 'active-leaf' ? w.world : w;
        r.finite &&= stats.finite;
        r.maxStrain = Math.max(r.maxStrain, stats.maxStrain);
        r.maxCompression = Math.max(r.maxCompression, stats.maxCompression);
        const positions = released?.positions || native.x;
        for (let i = 1; i < positions.length; i += 3) r.minY = Math.min(r.minY, positions[i]);
        if (w.models) r.modelCachePeak = Math.max(r.modelCachePeak, w.models.size);
        if (model === 'active-leaf') r.vertexRestBlockOverlapMm = Math.max(r.vertexRestBlockOverlapMm,
          overlapWithRestingBlocks(native, w.book.leaves[w.active].sheet, released?.positions || native.x));
        if (!r.finite || r.maxStrain > 0.01 || r.minY < -0.1) throw new Error('Numerical gate failed');
      }
      r.turns++;
    }
    r.completed = true;
  } catch (e) { r.error = e.message; }
  if (w) {
    const native = model === 'active-leaf' ? w.world : w;
    r.poseSHA256 = hash(Buffer.from(native.x.buffer, native.x.byteOffset, native.x.byteLength));
    r.vertices = native.mesh.nV; r.freeVertices = native.sys.nFree;
    r.lineSearchBacktracks = native.stats().lineSearchBacktracks ?? null;
    r.lineSearchRejected = native.stats().lineSearchRejected ?? null;
    w.dispose?.();
  }
  r.stepMeanMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  r.stepP95Ms = quantile(times, 0.95); r.stepMaxMs = times.length ? Math.max(...times) : null;
  r.gates = {
    numerical1Percent: r.completed && r.finite && r.maxStrain <= 0.01 && r.minY >= -0.1,
    numericalPoint1Percent: r.completed && r.finite && r.maxStrain <= 0.001 && r.minY >= -0.1,
    physics8ms: r.completed && r.stepP95Ms <= 8,
    restingBlockVertexThickness: model === 'active-leaf' ? r.completed && r.vertexRestBlockOverlapMm <= 0.001 : 'not evaluated for all-deformable stacks',
    physicalMaterialValidation: 'not measured by this booklet benchmark',
    browserInteraction: 'requires separate browser/device acceptance',
  };
  return r;
}

const results = [];
for (const settings of [{ substeps: 8, newtonIterations: 1 }, { substeps: 4, newtonIterations: 2 }, { substeps: 16, newtonIterations: 1 }, { substeps: 8, newtonIterations: 1, physicalMembrane: true }, { substeps: 8, newtonIterations: 1, physicalMembrane: true, lineSearch: true }]) {
  for (const model of ['all-leaves', 'active-leaf']) {
    const r = run(model, settings); results.push(r);
    console.error(`paper-campaign: ${model} S=${settings.substeps} I=${settings.newtonIterations} physical=${!!settings.physicalMembrane} search=${!!settings.lineSearch} turns=${r.turns}/8 strain=${r.maxStrain} p95=${r.stepP95Ms?.toFixed(2)}ms ${r.error || 'completed'}`);
  }
}
const report = {
  schema: 'pliego-paper-campaign/0.1', recordedAt: new Date().toISOString(),
  source: { git: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    engine: arg('--engine-label') || (enginePath ? 'external engine (caller must record source)' : 'current checkout'),
    engineTreeSHA256, readerSHA256, harnessSHA256,
    fixture: 'pliego.book.codex(leaves=4,width=90,height=128)', fixtureSHA256: hash(bytes) },
  runtime: { node: process.version, arch: arch(), platform: platform(), cpu: cpus()[0]?.model },
  protocol: { seed: 1, frameSeconds: 1 / 60, framesPerTurn: 84, requestedTurns: 8,
    fallback: false, repetitions: 1, timingScope: 'World.step only; includes first-frame/JIT cost; exploratory local measurement' },
  reduction: 'Active-leaf reader promotes releases to flat resting blocks after 1.4 simulation seconds; pre-promotion release poses are audited. Plasticity disabled for reading. Not an unconstrained stack equilibrium.',
  materialAudit: Object.fromEntries(Object.entries(json['pliego:stocks']).map(([id, stock]) => {
    const d = stock.derived, cap = engine.constants.MEMBRANE_CAP_LENGTH * d.areal_density * engine.constants.GRAVITY;
    return [id, { capY: cap, physicalYmd: d.E_md * d.thickness, physicalYcd: d.E_cd * d.thickness,
      retainedMD: Math.min(1, cap / (d.E_md * d.thickness)), retainedCD: Math.min(1, cap / (d.E_cd * d.thickness)) }];
  })),
  results,
};
const output = JSON.stringify(report, null, 2) + '\n';
if (arg('--out')) writeFileSync(resolve(arg('--out')), output); else process.stdout.write(output);
console.error(`paper-campaign: cases=${results.length} completed=${results.filter(r => r.completed).length} numericalGate=${results.filter(r => r.gates.numerical1Percent).length}`);
