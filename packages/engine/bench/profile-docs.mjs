#!/usr/bin/env node
// @ts-check
/**
 * Where a step's time goes, per document (geo-stab lane E4, 2026-10-18).
 *
 * Each document is loaded with the studio's interactive options (apps/web/studio/src/physics.js
 * `engineOptions`), every control is set to its default, three warm-up steps run, the sequence (if
 * any) is set to its end, and `--steps` 60 Hz steps are timed on this process's CPU clock (what
 * `scripts/qa/sim-matrix.mjs` measures). Reported per document: ms/step (mean, median), garbage
 * collector time inside the timed steps, refactorisations, peak stretch and an exact hash of the
 * final positions (every bit of every Float64).
 *
 *   node packages/engine/bench/profile-docs.mjs [--steps 20] [--engine path/to/src/index.js]
 *        [--compare path/to/other/src/index.js] [--prof-dir dir] [--interval-us 250] <doc.fold>…
 *
 * With `--compare`, both engines are also timed step by step (`ms/step2`, `ratio`), but in one
 * process the garbage one engine makes is often collected during the other's step, and the CPU
 * clock counts the JIT and GC threads of both: use the ratio as a hint, and time A against B in
 * separate processes, alternated, for numbers.
 *
 * `--prof-dir` records a V8 CPU profile of the timed steps only (node:inspector, the same sampler as
 * `node --cpu-prof`; the `.cpuprofile` files open in Chrome DevTools) and prints the self time by
 * engine stage and the top functions. `--compare` steps a second engine (another checkout's
 * `packages/engine/src/index.js`) in lockstep on the same document and prints the largest position
 * difference over every step: 0 means bit-identical.
 *
 * Read-proof: one `profile <doc>:` line per document (plus the stage table with --prof-dir) and a
 * `profile: documents=N` summary line.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Session } from 'node:inspector';
import { PerformanceObserver } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { engineOptions } from '../../../apps/web/studio/src/physics.js';

/** Engine stage of a profiled function: [stage, file basename, function names (empty = any)]. */
const STAGES = /** @type {[string, string, string[]][]} */ ([
  ['contact broad phase', 'contact.js', ['broadPhase', 'key']],
  ['contact projection (vertex–triangle, ground)', 'contact.js', ['project', 'ground']],
  ['edge–face contact', 'edgecontact.js', []],
  ['stretch guard + fold limit (_projections)', 'world.js', ['_projections']],
  ['BlockCholesky factor', 'blockchol.js', ['factor']],
  ['BlockCholesky solve (direct + PCG preconditioner)', 'blockchol.js', ['solve']],
  ['assembly (H = M/dt² + Σ k∇C∇Cᵀ)', 'implicit.js', ['assembleAndFactor', 'addOuter']],
  ['assembly (H = M/dt² + Σ k∇C∇Cᵀ)', 'blockchol.js', ['add', 'clear']],
  ['gradient ∇E', 'implicit.js', ['gradient', 'termResidual', 'termProjector', 'unwrap']],
  ['PCG (H·p, rotation, vectors)', 'pcg.js', []],
  ['dihedral angles + gradients', 'dihedral.js', []],
  ['substep integration, rotation check, hinges, sleep', 'world.js', []],
  ['joins, gates, drivers', 'joins.js', []],
  ['joins, gates, drivers', 'gates.js', []],
  ['joins, gates, drivers', 'drivers.js', []],
  ['joins, gates, drivers', 'program.js', []],
  ['joins, gates, drivers', 'facetree.js', []],
  ['air and wind', 'air.js', []],
  ['diagnostics (stats)', '', ['stats']],
  ['garbage collector', '', ['(garbage collector)']],
]);

function parseArgs(argv) {
  const a = { steps: 20, engine: '', compare: '', profDir: '', intervalUs: 250, files: /** @type {string[]} */ ([]) };
  const rest = [...argv];
  while (rest.length) {
    const k = /** @type {string} */ (rest.shift());
    const val = () => { if (!rest.length) throw new Error(`${k} needs a value`); return /** @type {string} */ (rest.shift()); };
    if (k === '--steps') a.steps = Number(val());
    else if (k === '--engine') a.engine = val();
    else if (k === '--compare') a.compare = val();
    else if (k === '--prof-dir') a.profDir = val();
    else if (k === '--interval-us') a.intervalUs = Number(val());
    else if (k.startsWith('--')) throw new Error(`unknown option ${k}`);
    else a.files.push(k);
  }
  if (!a.files.length || !(a.steps >= 1)) throw new Error('usage: profile-docs.mjs [--steps N] [--engine src/index.js] [--compare src/index.js] [--prof-dir dir] <doc.fold>…');
  return a;
}

/** @param {string} p */
const importEngine = async (p) => (p ? import(pathToFileURL(path.resolve(p)).href) : import('../src/index.js'));
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

/** FNV-1a over every 32-bit word of a Float64Array (exact: any bit change changes it). @param {Float64Array} x */
export function exactHash(x) {
  const u = new Uint32Array(x.buffer, x.byteOffset, 2 * x.length);
  let h = 2166136261;
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** A world at the studio's options, controls at their defaults, warmed up, sequence started. @param {any} E @param {any} json */
function prepare(E, json) {
  const doc = E.loadDocument(structuredClone(json));
  const w = new E.World(doc, engineOptions(json));
  for (const c of doc.controls) w.setControl(c.id, c.default);
  for (let i = 0; i < 3; i++) w.step(1 / 60);
  const seq = doc.controls.find((/** @type {any} */ c) => c.kind === 'sequence');
  if (seq && doc.sequence) w.setControl(seq.id, doc.sequence.steps.length);
  return w;
}

/** @param {Session} s @param {string} method @param {any} [params] @returns {Promise<any>} */
const post = (s, method, params = {}) => new Promise((res, rej) => s.post(method, params, (e, r) => (e ? rej(e) : res(r))));

/** Self time (ms) per stage and per function of a V8 CPU profile. @param {any} prof */
export function summarizeProfile(prof) {
  const byId = new Map(prof.nodes.map((/** @type {any} */ n) => [n.id, n]));
  const selfUs = new Map();
  for (let i = 0; i < prof.samples.length; i++) selfUs.set(prof.samples[i], (selfUs.get(prof.samples[i]) || 0) + (prof.timeDeltas[i] || 0));
  /** @type {Map<string, number>} */ const fns = new Map();
  /** @type {Map<string, number>} */ const stages = new Map();
  let total = 0;
  for (const [id, us] of selfUs) {
    const cf = byId.get(id).callFrame, file = path.basename(cf.url || ''), fn = cf.functionName || '(anonymous)';
    total += us;
    const fk = `${fn} ${file}:${cf.lineNumber + 1}`;
    fns.set(fk, (fns.get(fk) || 0) + us);
    const st = STAGES.find(([, f, names]) => (!f || f === file) && (!names.length || names.includes(fn)));
    const sk = st ? st[0] : (cf.url && cf.url.includes('/engine/src/') ? `other engine (${file})` : `other (${fn === '(anonymous)' ? file || 'runtime' : fn})`);
    stages.set(sk, (stages.get(sk) || 0) + us);
  }
  const rows = (/** @type {Map<string, number>} */ m) => [...m.entries()].sort((p, q) => q[1] - p[1]).map(([k, us]) => ({ name: k, ms: us / 1000, share: total ? us / total : 0 }));
  return { totalMs: total / 1000, stages: rows(stages), functions: rows(fns) };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const E = await importEngine(a.engine);
  const C = a.compare ? await importEngine(a.compare) : null;
  let gcMs = 0, gcOn = false;
  const obs = new PerformanceObserver((list) => { if (gcOn) for (const e of list.getEntries()) gcMs += e.duration; });
  obs.observe({ entryTypes: ['gc'] });
  const session = a.profDir ? new Session() : null;
  if (session) { session.connect(); await post(session, 'Profiler.enable'); await post(session, 'Profiler.setSamplingInterval', { interval: a.intervalUs }); fs.mkdirSync(a.profDir, { recursive: true }); }
  let ran = 0;
  for (const file of a.files) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const w = prepare(E, json);
    const w2 = C ? prepare(C, json) : null;
    let maxDiff = w2 ? diff(w.x, w2.x) : 0;
    const f0 = w.factorCount, ts = [], ts2 = [];
    let peak = 0;
    // let pending GC entries of the load drain before counting
    await new Promise((r) => setImmediate(r));
    gcMs = 0; gcOn = true;
    if (session) await post(session, 'Profiler.start');
    for (let i = 0; i < a.steps; i++) {
      const c0 = cpuMs();
      w.step(1 / 60);
      ts.push(cpuMs() - c0);
      if (w2) { const c1 = cpuMs(); w2.step(1 / 60); ts2.push(cpuMs() - c1); maxDiff = Math.max(maxDiff, diff(w.x, w2.x)); }
      if (!w2) peak = Math.max(peak, w.stats().maxStrain);
    }
    const prof = session ? (await post(session, 'Profiler.stop')).profile : null;
    await new Promise((r) => setImmediate(r));
    gcOn = false;
    const sorted = ts.slice().sort((p, q) => p - q);
    const mean = ts.reduce((p, q) => p + q, 0) / ts.length;
    const name = path.basename(file);
    const mean2 = ts2.length ? ts2.reduce((p, q) => p + q, 0) / ts2.length : NaN;
    const cmp = w2 ? ` compare=${maxDiff === 0 ? 'bit-identical' : `maxDiff=${maxDiff.toExponential(3)}mm`} hash2=${exactHash(w2.x)} ms/step2=${mean2.toFixed(1)} ratio=${(mean / mean2).toFixed(3)}` : '';
    console.log(`profile ${name}: V=${w.mesh.nV} T=${w.mesh.nT} steps=${a.steps} ms/step mean=${mean.toFixed(1)} median=${sorted[sorted.length >> 1].toFixed(1)} ` +
      `gc=${gcMs.toFixed(1)}ms (${(100 * gcMs / Math.max(1e-9, mean * a.steps)).toFixed(1)}%) refactors=${w.factorCount - f0} pairs=${w.contact ? w.contact.nPairs : 0} ` +
      `peakStretch=${w2 ? 'n/a' : (100 * peak).toFixed(3) + '%'} hash=${exactHash(w.x)}${cmp}`);
    if (prof) {
      const out = path.join(a.profDir, `${name.replace(/\.fold$/, '')}.cpuprofile`);
      fs.writeFileSync(out, JSON.stringify(prof));
      const s = summarizeProfile(prof);
      console.log(`  stages (self time over ${s.totalMs.toFixed(0)} ms sampled; ${out}):`);
      for (const r of s.stages.slice(0, 14)) console.log(`    ${(100 * r.share).toFixed(1).padStart(5)} %  ${r.ms.toFixed(0).padStart(7)} ms  ${r.name}`);
      console.log('  top functions:');
      for (const r of s.functions.slice(0, 12)) console.log(`    ${(100 * r.share).toFixed(1).padStart(5)} %  ${r.name}`);
    }
    ran++;
  }
  obs.disconnect();
  if (session) session.disconnect();
  console.log(`profile: documents=${ran} steps=${a.steps} engine=${a.engine || 'this checkout'}${a.compare ? ` compare=${a.compare}` : ''} node=${process.version}`);
}

/** Largest |a_i − b_i| (Infinity on a length mismatch or NaN). @param {Float64Array} p @param {Float64Array} q */
function diff(p, q) {
  if (p.length !== q.length) return Infinity;
  let m = 0;
  for (let i = 0; i < p.length; i++) { const d = Math.abs(p[i] - q[i]); if (!(d <= m)) m = Number.isNaN(d) ? Infinity : d; }
  return m;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
