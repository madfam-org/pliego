#!/usr/bin/env node
// Simulation matrix over a corpus of sheet documents (the output of scripts/qa/sim_corpus.py: one
// sub-directory per cartridge, *.fold inside). Each document is loaded into the real engine with the
// studio's interactive options and driven the way the studio drives it
// (packages/engine/test/helpers/sim-matrix.js says exactly how). Writes:
//
//   <out>/sim-matrix.csv    one row per document
//   <out>/sim-matrix.json   the same rows plus the summary
//   <out>/sim-matrix.md     counts and the worst 15 of every failure class
//
//   node scripts/qa/sim-matrix.mjs <corpus> --out <dir> [--jobs 3] [--drive 300] [--settle 60]
//        [--budget-ms 60000] [--filter substring] [--list file-of-relative-paths] [--no-compress] [--label text]
//        [--engine path/to/engine/src/index.js]   (another checkout's engine, e.g. a PR worktree; default: this one)
//   node scripts/qa/sim-matrix.mjs --from-json <dir>/sim-matrix.json --out <dir2>   (re-summarise, no simulation)
//   node scripts/qa/sim-matrix.mjs <corpus> --out <dir> --expect scripts/qa/sim-smoke.txt   (CI gate: the listed
//        documents only; each line `<cartridge>/<file>.fold <status>`; exit 1 when any status differs)
//
// Read-proof output: one `sim-matrix: <doc> …` line per document and a summary line. Documents run
// in child processes (--jobs); a document that outlives four budgets plus five minutes is stopped
// and recorded as `timeout`. Timings depend on the machine and its load: the summary prints
// the CPU, Node version and load averages.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fork } from 'node:child_process';

const HELPER = new URL('../../packages/engine/test/helpers/sim-matrix.js', import.meta.url);

function parseArgs(argv) {
  const a = { root: '', out: '', jobs: 3, drive: undefined, settle: undefined, budgetMs: 60000, filter: '', list: '', compress: true, label: '', engine: '', fromJson: '', expect: '' };
  const rest = [...argv];
  while (rest.length) {
    const k = rest.shift();
    const val = () => { if (!rest.length) throw new Error(`${k} needs a value`); return rest.shift(); };
    if (k === '--out') a.out = val();
    else if (k === '--jobs') a.jobs = Number(val());
    else if (k === '--drive') a.drive = Number(val());
    else if (k === '--settle') a.settle = Number(val());
    else if (k === '--budget-ms') a.budgetMs = Number(val());
    else if (k === '--filter') a.filter = val();
    else if (k === '--list') a.list = val();
    else if (k === '--label') a.label = val();
    else if (k === '--engine') a.engine = val();
    else if (k === '--from-json') a.fromJson = val();
    else if (k === '--expect') { a.expect = val(); a.list = a.list || a.expect; }
    else if (k === '--no-compress') a.compress = false;
    else if (k.startsWith('--')) throw new Error(`unknown option ${k}`);
    else a.root = k;
  }
  if ((!a.root && !a.fromJson) || !a.out) throw new Error('usage: sim-matrix.mjs <corpus> --out <dir> [options] | --from-json <sim-matrix.json> --out <dir>');
  return a;
}

/** Every `<root>/<cartridge>/*.fold`, as {file, name: '<cartridge>/<file>'}. */
function corpus(root, filter, list) {
  const keep = list ? new Set(fs.readFileSync(list, 'utf8').split('\n').map((s) => s.trim().split(/\s+/)[0]).filter((s) => s && !s.startsWith('#'))) : null;
  const files = [];
  for (const d of fs.readdirSync(root).sort()) {
    const dir = path.join(root, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.fold')) continue;
      const name = `${d}/${f}`;
      if (filter && !name.includes(filter)) continue;
      if (keep && !keep.has(name)) continue;
      files.push({ file: path.join(dir, f), name });
    }
  }
  return files;
}

async function runAll(files, a) {
  const opts = JSON.stringify({ drive: a.drive, settle: a.settle, budgetMs: a.budgetMs, compress: a.compress, engine: a.engine });
  const hardMs = 4 * a.budgetMs + 300000;
  const results = new Map();
  let next = 0;
  await new Promise((resolve) => {
    let live = 0;
    const spawn = () => {
      if (next >= files.length) { if (live === 0) resolve(); return; }
      // one child process per worker, so process.cpuUsage() measures this document alone
      const w = fork(fileURLToPath(import.meta.url), ['--worker', opts], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      live++;
      let job = null, timer = null;
      const done = (rec) => { clearTimeout(timer); results.set(job.name, rec); report(job.name, rec); job = null; };
      const feed = () => {
        if (next >= files.length) { w.disconnect(); return; }
        job = files[next++];
        timer = setTimeout(() => { done({ status: 'timeout', loads: true, error: `no result after ${hardMs} ms` }); w.kill(); }, hardMs);
        w.send(job);
      };
      w.on('message', (m) => { if (job && m.name === job.name) { done(m.rec); feed(); } });
      w.on('exit', (code, sig) => {
        live--;
        if (job) done({ status: 'harness-error', loads: false, error: `worker exited (code ${code}, signal ${sig})` });
        spawn();
      });
      feed();
    };
    for (let i = 0; i < Math.max(1, Math.min(a.jobs, files.length)); i++) spawn();
    if (!files.length) resolve();
  });
  return files.map((f) => ({ doc: f.name, ...(results.get(f.name) || { status: 'harness-error', error: 'no result' }) }));
}

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '');
const pct = (x) => (Number.isFinite(x) ? (100 * x).toFixed(3) : '');

function report(name, r) {
  const parts = [`status=${r.status}`];
  if (r.loads) parts.push(`V=${r.simVertices} ms=${f1(r.msMean)}/${f1(r.msP95)} probe=${f1(r.probeMs)} stretch=${pct(r.maxStretch)}% fallback=${r.fallback || 'no'}`);
  if (r.error) parts.push(`error=${String(r.error).slice(0, 160)}`);
  console.log(`sim-matrix: ${name} ${parts.join(' ')}`);
}

const COLUMNS = ['doc', 'status', 'loads', 'rejected', 'rules', 'error', 'stable', 'interactive', 'fallback', 'fits', 'estVertices',
  'simVertices', 'triangles', 'meshEdge', 'substeps', 'clock', 'probeMs', 'msMean', 'msP95', 'msMax', 'probeWallMs', 'wallMean', 'wallP95', 'stepsTimed', 'stepsRun', 'truncated',
  'factorPerStep', 'pcgMean', 'maxStretch', 'stretchP95', 'endStretch', 'peakAt', 'maxCompression', 'finite', 'firstNonFinite', 'exploded', 'outsideMm', 'belowGround', 'minY', 'minYFixed',
  'endSpeed', 'asleepAtEnd', 'jitter', 'stretched', 'speedWatchFired', 'speedWatchMs', 'seqScale', 'contactsMax', 'tornWelds',
  'sheets', 'docVertices', 'faces', 'cuts', 'perforations', 'kinematicSheets', 'seqMode', 'seqSteps', 'controls', 'mechanisms', 'joins', 'phases'];

function csvCell(v) {
  if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 1e4) / 1e4) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Peak stretch distribution over documents that ran finite: ≤ 0.5 %, 0.5–1, 1–5, 5–20, > 20 %. */
function stretchBins(rows) {
  const edges = [0.005, 0.01, 0.05, 0.2, Infinity], names = ['≤0.5%', '0.5–1%', '1–5%', '5–20%', '>20%'];
  const out = Object.fromEntries(names.map((k) => [k, 0]));
  for (const r of rows) if (r.loads && r.finite && Number.isFinite(r.maxStretch)) out[names[edges.findIndex((e) => r.maxStretch <= e)]]++;
  return Object.entries(out).map(([k, v]) => `${k} ${v}`).join(', ');
}

function summarize(rows) {
  const n = (p) => rows.filter(p).length;
  const loads = rows.filter((r) => r.loads && r.status !== 'timeout');
  return {
    documents: rows.length,
    cartridges: new Set(rows.map((r) => r.doc.split('/')[0])).size,
    loads: loads.length,
    rejected: n((r) => r.status === 'rejected'),
    worldError: n((r) => r.status === 'world-error'),
    stepError: n((r) => r.status === 'step-error'),
    timeout: n((r) => r.status === 'timeout'),
    harnessError: n((r) => r.status === 'harness-error'),
    stable: n((r) => r.stable),
    unstable: n((r) => r.loads && r.status !== 'timeout' && !r.stable),
    interactive: n((r) => r.interactive),
    stableAndInteractive: n((r) => r.stable && r.interactive),
    fallsBack: n((r) => !!r.fallback),
    fallbackHeavy: n((r) => r.fallback === 'heavy'),
    fallbackProbe: n((r) => r.fallback === 'probe'),
    fallbackSpeed: n((r) => r.fallback === 'speed'),
    nonFinite: n((r) => r.status === 'non-finite'),
    exploded: n((r) => r.status === 'exploded'),
    belowGround: n((r) => r.status === 'below-ground'),
    stretched: n((r) => r.status === 'stretched'),
    jitter: n((r) => r.status === 'jitter'),
    stretchOverHalfPercent: n((r) => r.loads && r.finite && r.maxStretch > 0.005),
    endStretchOverHalfPercent: n((r) => r.loads && r.finite && r.endStretch > 0.005),
    truncated: n((r) => r.truncated),
    compressed: n((r) => r.seqScale > 1),
    drivenBelowGround: n((r) => r.loads && r.minYFixed < -2),
    peakStretchBins: stretchBins(rows),
  };
}

function markdown(rows, sum, meta) {
  const L = [];
  L.push(`# Simulation matrix${meta.label ? ` — ${meta.label}` : ''}`, '');
  L.push(`Generated by \`scripts/qa/sim-matrix.mjs\` (${meta.date}). Node ${meta.node}, ${meta.cpu}, ${meta.jobs} worker(s), ` +
    `load average ${meta.loadStart} at start and ${meta.loadEnd} at the end. Drive window ${meta.drive} frames, settle ${meta.settle}, ` +
    `budget ${meta.budgetMs} ms per document${meta.compress ? '' : ', sequences at real time'}. Step times are ` +
    `${meta.clock === 'wall' ? 'wall-clock' : 'CPU time of the document\'s own process (a loaded machine inflates wall time, not CPU time)'}.`, '');
  L.push('| count | value |', '|---|---|');
  const label = {
    documents: 'documents', cartridges: 'cartridges', loads: 'loads (document accepted, World built)', rejected: 'rejected (DocumentError)',
    worldError: 'World constructor threw', stepError: 'a step threw', timeout: 'timeout', harnessError: 'harness error',
    stable: 'stable (finite, no explosion, nothing below ground, stretch ≤ 1 %, no end jitter)', unstable: 'unstable (loads, not stable)',
    interactive: 'interactive (mean step < 40 ms)', stableAndInteractive: 'stable and interactive', fallsBack: 'studio falls back to the preview',
    fallbackHeavy: '… heavy (estimated vertices > 1500)', fallbackProbe: '… probe step > 40 ms', fallbackSpeed: '… live speed watch',
    nonFinite: 'non-finite', exploded: 'exploded (outside the sane box)', belowGround: 'free paper below the ground plane', stretched: 'stretched > 1 %',
    jitter: 'end jitter (> 200 mm/s after settling)', stretchOverHalfPercent: 'peak stretch > 0.5 % (any status)', endStretchOverHalfPercent: 'stretch > 0.5 % at the end (any status)', truncated: 'truncated by the budget',
    compressed: 'sequence time-compressed into the drive window', peakStretchBins: 'peak stretch distribution (finite runs)', drivenBelowGround: 'driven vertices end below the ground plane (info)',
  };
  for (const [k, v] of Object.entries(sum)) L.push(`| ${label[k] ?? k} | ${v} |`);
  const statusCounts = {};
  for (const r of rows) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  L.push('', `Status: ${Object.entries(statusCounts).sort().map(([k, v]) => `${k} ${v}`).join(', ')}.`, '');
  const worst = (title, pred, key, cols, desc = true) => {
    const list = rows.filter(pred).sort((a, b) => (desc ? (b[key] ?? 0) - (a[key] ?? 0) : (a[key] ?? 0) - (b[key] ?? 0)));
    L.push(`## ${title} (${list.length})`, '');
    if (!list.length) { L.push('None.', ''); return; }
    L.push(`| doc | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`);
    for (const r of list.slice(0, 15)) L.push(`| ${r.doc} | ${cols.map((c) => String(csvCell(r[c])).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').slice(0, 140)).join(' | ')} |`);
    L.push('');
  };
  worst('Rejected', (r) => r.status === 'rejected', 'docVertices', ['rules', 'error']);
  worst('World or step errors', (r) => r.status === 'world-error' || r.status === 'step-error' || r.status === 'timeout' || r.status === 'harness-error', 'docVertices', ['status', 'error']);
  worst('Non-finite', (r) => r.status === 'non-finite', 'simVertices', ['firstNonFinite', 'phases']);
  worst('Exploded', (r) => r.status === 'exploded', 'outsideMm', ['outsideMm', 'maxStretch', 'phases']);
  worst('Below the ground plane', (r) => r.status === 'below-ground', 'minY', ['minY', 'phases'], false);
  worst('Stretched > 1 %', (r) => r.status === 'stretched', 'maxStretch', ['maxStretch', 'stretchP95', 'endStretch', 'peakAt', 'seqScale', 'joins', 'mechanisms']);
  worst('End jitter', (r) => r.status === 'jitter', 'endSpeed', ['endSpeed', 'maxStretch', 'contactsMax']);
  worst('Not interactive (mean step ≥ 40 ms)', (r) => r.loads && !r.interactive && Number.isFinite(r.msMean), 'msMean', ['msMean', 'msP95', 'simVertices', 'factorPerStep', 'pcgMean', 'contactsMax']);
  worst('Falls back to the preview', (r) => !!r.fallback, 'msMean', ['fallback', 'estVertices', 'probeMs', 'msMean']);
  return L.join('\n') + '\n';
}

async function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2)); } catch (e) { console.error(String(e.message)); process.exit(2); }
  if (a.fromJson) {
    // rebuild the summary, CSV and markdown from an earlier run's JSON (no simulation)
    const prev = JSON.parse(fs.readFileSync(a.fromJson, 'utf8'));
    if (a.label) prev.meta.label = a.label;
    write(a.out, prev.rows, prev.meta);
    return;
  }
  const files = corpus(a.root, a.filter, a.list);
  if (!files.length) { console.log(`sim-matrix: FAIL no documents under ${a.root}`); process.exit(1); }
  fs.mkdirSync(a.out, { recursive: true });
  const la = () => os.loadavg().map((x) => x.toFixed(2)).join(' ');
  const meta = {
    label: a.label, date: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', node: process.version,
    cpu: `${os.cpus()[0]?.model ?? 'cpu'} ×${os.cpus().length}`, jobs: a.jobs, loadStart: la(), loadEnd: '',
    drive: a.drive ?? 300, settle: a.settle ?? 60, budgetMs: a.budgetMs, compress: a.compress, clock: 'cpu',
  };
  const rows = await runAll(files, a);
  meta.loadEnd = la();
  write(a.out, rows, meta);
  if (a.expect) process.exit(gate(rows, a.expect) ? 0 : 1);
}

/** CI gate: every listed document has its expected status. Prints one read-proof line per mismatch. */
function gate(rows, file) {
  const want = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [doc, status] = t.split(/\s+/);
    want.set(doc, status);
  }
  const got = new Map(rows.map((r) => [r.doc, r.status]));
  let bad = 0;
  for (const [doc, status] of want) {
    const g = got.get(doc) ?? 'missing';
    if (g !== status) { bad++; console.log(`sim-smoke: MISMATCH ${doc} expected=${status} got=${g}`); }
  }
  console.log(`sim-smoke: documents=${want.size} matched=${want.size - bad} mismatched=${bad}`);
  return want.size > 0 && bad === 0;
}

function write(out, rows, meta) {
  fs.mkdirSync(out, { recursive: true });
  const sum = summarize(rows);
  fs.writeFileSync(path.join(out, 'sim-matrix.csv'), [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'sim-matrix.json'), JSON.stringify({ meta, summary: sum, rows }, null, 1) + '\n');
  fs.writeFileSync(path.join(out, 'sim-matrix.md'), markdown(rows, sum, meta));
  console.log(`sim-matrix: documents=${sum.documents} loads=${sum.loads} stable=${sum.stable} interactive=${sum.interactive} ` +
    `falls-back=${sum.fallsBack} rejected=${sum.rejected} unstable=${sum.unstable} errors=${sum.worldError + sum.stepError + sum.timeout + sum.harnessError}`);
}

if (process.argv[2] === '--worker') {
  const { simulateDocument } = await import(HELPER.href);
  const o = JSON.parse(process.argv[3]);
  const engine = o.engine ? await import(pathToFileURL(path.resolve(o.engine)).href) : undefined;
  process.on('message', (/** @type {{file: string, name: string}} */ m) => {
    let rec;
    try {
      rec = simulateDocument(JSON.parse(fs.readFileSync(m.file, 'utf8')), o, engine);
    } catch (e) {
      rec = { status: 'harness-error', error: String(e && e.message || e).slice(0, 300), loads: false };
    }
    process.send({ name: m.name, rec });
  });
} else {
  await main();
}
