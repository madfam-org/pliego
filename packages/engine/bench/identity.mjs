#!/usr/bin/env node
// @ts-check
/**
 * Bit-identity check of the engine over a corpus (geo-stab lane E4, 2026-10-18). A performance
 * change must not change the physics: this drives every document exactly like
 * `scripts/qa/sim-matrix.mjs` (packages/engine/test/helpers/sim-matrix.js `simulateDocument`), and
 * records an exact hash of the positions (every bit of every Float64) after every step.
 *
 *   node packages/engine/bench/identity.mjs <corpus> --out a.jsonl [--engine path/to/src/index.js]
 *        [--list file-of-relative-paths] [--filter substring] [--budget-ms 20000] [--jobs 3]
 *   node packages/engine/bench/identity.mjs --diff a.jsonl b.jsonl
 *
 * A document's drive stops at the CPU budget like the matrix's does, so a faster engine runs more
 * steps: `--diff` compares the common prefix of the two hash sequences and reports, per document,
 * `identical (N steps)` or the first step whose positions differ. Exit 1 on any difference or on a
 * document missing from either side. Read-proof: one `identity <doc>` line per document and an
 * `identity: documents=N` summary line.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { simulateDocument } from '../test/helpers/sim-matrix.js';
import { exactHash } from './profile-docs.mjs';

function parseArgs(argv) {
  const a = { root: '', out: '', engine: '', list: '', filter: '', budgetMs: 20000, jobs: 3, diff: /** @type {string[]} */ ([]) };
  const rest = [...argv];
  while (rest.length) {
    const k = /** @type {string} */ (rest.shift());
    const val = () => { if (!rest.length) throw new Error(`${k} needs a value`); return /** @type {string} */ (rest.shift()); };
    if (k === '--out') a.out = val();
    else if (k === '--engine') a.engine = val();
    else if (k === '--list') a.list = val();
    else if (k === '--filter') a.filter = val();
    else if (k === '--budget-ms') a.budgetMs = Number(val());
    else if (k === '--jobs') a.jobs = Number(val());
    else if (k === '--diff') { a.diff.push(val(), val()); }
    else if (k.startsWith('--')) throw new Error(`unknown option ${k}`);
    else a.root = k;
  }
  if (!a.diff.length && (!a.root || !a.out)) throw new Error('usage: identity.mjs <corpus> --out a.jsonl [options] | --diff a.jsonl b.jsonl');
  return a;
}

/** `<root>/<cartridge>/*.fold` (sorted), optionally restricted to a list or a substring. */
function corpus(root, list, filter) {
  const keep = list ? new Set(fs.readFileSync(list, 'utf8').split('\n').map((s) => s.trim().split(/\s+/)[0]).filter((s) => s && !s.startsWith('#'))) : null;
  const out = [];
  for (const d of fs.readdirSync(root).sort()) {
    const dir = path.join(root, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      const name = `${d}/${f}`;
      if (!f.endsWith('.fold') || (keep && !keep.has(name)) || (filter && !name.includes(filter))) continue;
      out.push({ file: path.join(dir, f), name });
    }
  }
  return out;
}

/** Simulate one document with a World that hashes its positions after every step. @param {any} E @param {string} file @param {number} budgetMs */
function hashRun(E, file, budgetMs) {
  /** @type {any} */ let last = null;
  class HashWorld extends E.World {
    /** @param {any} doc @param {any} opts */
    constructor(doc, opts) { super(doc, opts); this._hashes = /** @type {string[]} */ ([]); last = this; }
    /** @param {number} [dt] */
    step(dt) { const n = super.step(dt); this._hashes.push(exactHash(this.x)); return n; }
  }
  const rec = simulateDocument(JSON.parse(fs.readFileSync(file, 'utf8')), { budgetMs }, { World: HashWorld, loadDocument: E.loadDocument });
  return { status: rec.status, error: rec.error || '', steps: last ? last._hashes.length : 0, hashes: last ? last._hashes : [] };
}

async function worker(opts) {
  const E = await (opts.engine ? import(pathToFileURL(path.resolve(opts.engine)).href) : import('../src/index.js'));
  process.on('message', (/** @type {any} */ job) => { process.send?.({ name: job.name, rec: hashRun(E, job.file, opts.budgetMs) }); });
}

async function run(a) {
  const files = corpus(a.root, a.list, a.filter);
  const out = fs.createWriteStream(a.out);
  let next = 0, done = 0;
  await new Promise((resolve) => {
    let live = 0;
    const spawn = () => {
      if (next >= files.length) { if (live === 0) resolve(undefined); return; }
      const w = fork(fileURLToPath(import.meta.url), ['--worker', JSON.stringify({ engine: a.engine, budgetMs: a.budgetMs })], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      live++;
      /** @type {any} */ let job = null;
      const feed = () => { if (next >= files.length) { w.disconnect(); return; } job = files[next++]; w.send(job); };
      w.on('message', (/** @type {any} */ m) => {
        out.write(`${JSON.stringify({ doc: m.name, ...m.rec })}\n`);
        console.log(`identity ${m.name} status=${m.rec.status} steps=${m.rec.steps} last=${m.rec.hashes[m.rec.hashes.length - 1] ?? '-'} (${++done}/${files.length})`);
        job = null; feed();
      });
      w.on('exit', (code) => {
        live--;
        if (job) { out.write(`${JSON.stringify({ doc: job.name, status: 'harness-error', error: `worker exit ${code}`, steps: 0, hashes: [] })}\n`); done++; }
        spawn();
      });
      feed();
    };
    for (let i = 0; i < Math.max(1, Math.min(a.jobs, files.length)); i++) spawn();
    if (!files.length) resolve(undefined);
  });
  await new Promise((r) => out.end(r));
  console.log(`identity: documents=${files.length} out=${a.out} engine=${a.engine || 'this checkout'} budgetMs=${a.budgetMs} node=${process.version}`);
}

/** @param {string} f */
const readRuns = (f) => new Map(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.doc, r]; }));

function diff(fa, fb) {
  const A = readRuns(fa), B = readRuns(fb);
  let same = 0, differ = 0, missing = 0, steps = 0;
  for (const doc of [...new Set([...A.keys(), ...B.keys()])].sort()) {
    const a = A.get(doc), b = B.get(doc);
    if (!a || !b) { missing++; console.log(`identity ${doc}: MISSING from ${a ? fb : fa}`); continue; }
    const n = Math.min(a.hashes.length, b.hashes.length);
    let k = 0;
    while (k < n && a.hashes[k] === b.hashes[k]) k++;
    if (k === n) { same++; steps += n; console.log(`identity ${doc}: identical (${n} steps; ${a.hashes.length} vs ${b.hashes.length} run)`); }
    else { differ++; console.log(`identity ${doc}: DIFFERS at step ${k + 1} of ${n} (${a.hashes[k]} vs ${b.hashes[k]})`); }
  }
  console.log(`identity: documents=${same + differ + missing} identical=${same} differ=${differ} missing=${missing} steps-compared=${steps}`);
  return differ === 0 && missing === 0;
}

if (process.argv[2] === '--worker') worker(JSON.parse(process.argv[3]));
else {
  const a = parseArgs(process.argv.slice(2));
  if (a.diff.length) process.exit(diff(a.diff[0], a.diff[1]) ? 0 : 1);
  else run(a).catch((e) => { console.error(e); process.exit(1); });
}
