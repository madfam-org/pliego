// Complete deterministic-gzip evidence storage; no JSON normalization or fields omitted.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const REPORTS = ['baseline.json', 'candidate.json', 'repeat.json', 'control.json', 'constitutive-controls.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const self = readFileSync(new URL(import.meta.url));
const [mode, inputDirectory, outputDirectory, ...artifacts] = process.argv.slice(2);
assert.ok(['--build', '--reconstruct'].includes(mode) && inputDirectory && outputDirectory,
  '--build inputDirectory freshOutputDirectory [artifact.json ...] | --reconstruct archiveDirectory freshOutputDirectory');
assert.notEqual(resolve(inputDirectory), resolve(outputDirectory), 'separate output directory required');
mkdirSync(outputDirectory, { mode: 0o700 }); // Atomically claim a fresh, private directory; no recursive reuse.
const plain = name => { assert.equal(name, basename(name), 'plain filenames only'); assert.ok(name !== '.' && name !== '..'); return name; };
const write = (name, bytes) => writeFileSync(join(outputDirectory, plain(name)), bytes, { flag: 'wx', mode: 0o600 });

if (mode === '--build') {
  const records = []; let sourceGit = null;
  assert.equal(new Set(artifacts).size, artifacts.length, 'duplicate ancillary artifact');
  for (const name of REPORTS) {
    const raw = readFileSync(join(inputDirectory, name)), report = JSON.parse(raw);
    assert.equal(report.schema, name === 'constitutive-controls.json' ? 'pliego-orthotropic-audit/0.1' : 'pliego-membrane-modal-audit/0.1');
    assert.equal(report.source.dirty, false); assert.equal(report.gates.sourceClean, true);
    assert.match(report.source.git, /^[a-f0-9]{40}$/);
    if (sourceGit === null) sourceGit = report.source.git;
    assert.equal(report.source.git, sourceGit, 'all captures must share their actual clean source pin');
    const stored = gzipSync(raw, { level: 9 });
    assert.ok(stored.subarray(4, 8).equals(Buffer.alloc(4)), 'deterministic gzip header has zero timestamp');
    assert.ok(gunzipSync(stored, { maxOutputLength: raw.length }).equals(raw), 'every original captured byte must survive');
    const file = name + '.gz'; write(file, stored);
    records.push({ kind: 'complete-report-gzip', file, target: name, originalSHA256: sha(raw), storedSHA256: sha(stored),
      originalBytes: raw.length, storedBytes: stored.length, allOriginalBytesExact: true });
  }
  for (const name of artifacts) {
    plain(name); assert.ok(name.endsWith('.json') || name === 'extract-increment-trials.py', 'ancillary JSON or declared extraction producer required');
    assert.ok(!REPORTS.includes(name) && name !== 'archive-manifest.json', 'reserved artifact name');
    const raw = readFileSync(join(inputDirectory, name)); if (name.endsWith('.json')) JSON.parse(raw); write(name, raw);
    records.push({ kind: 'complete-artifact-copy', file: name, target: name, originalSHA256: sha(raw), storedSHA256: sha(raw),
      originalBytes: raw.length, storedBytes: raw.length, allOriginalBytesExact: true });
  }
  const reports = records.filter(r => r.kind === 'complete-report-gzip');
  const manifest = { schema: 'pliego-membrane-increment-archive/1', sourceGit, toolSHA256: sha(self),
    producer: { node: process.version, zlib: process.versions.zlib, gzipLevel: 9, gzipTimestamp: 0 },
    reports: REPORTS, records,
    originalReportBytes: reports.reduce((s, r) => s + r.originalBytes, 0), storedReportBytes: reports.reduce((s, r) => s + r.storedBytes, 0),
    method: 'five COMPLETE original report byte streams, deterministic standard gzip; ancillary proofs copied byte-exact; no normalization, delta, abbreviated evidence or omitted field/failure' };
  write('archive-increment-evidence.mjs', self); write('archive-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  console.log('increment-archive: five complete reports, ' + manifest.originalReportBytes + ' original / ' + manifest.storedReportBytes + ' gzip bytes; ' + artifacts.length + ' byte-exact ancillary artifacts');
} else {
  assert.equal(artifacts.length, 0, 'reconstruction uses only the declared manifest');
  const manifest = JSON.parse(readFileSync(join(inputDirectory, 'archive-manifest.json')));
  assert.equal(manifest.schema, 'pliego-membrane-increment-archive/1');
  assert.equal(manifest.toolSHA256, sha(self), 'reconstruction producer must match its manifest');
  assert.deepEqual(manifest.reports, REPORTS);
  assert.ok(Array.isArray(manifest.records) && manifest.records.length >= REPORTS.length);
  const outputs = new Set(), reports = [];
  for (const record of manifest.records) {
    plain(record.file); plain(record.target);
    assert.ok(!outputs.has(record.target), 'duplicate output target'); outputs.add(record.target);
    assert.ok(Number.isSafeInteger(record.originalBytes) && record.originalBytes > 0 && Number.isSafeInteger(record.storedBytes) && record.storedBytes > 0);
    const stored = readFileSync(join(inputDirectory, record.file));
    assert.equal(stored.length, record.storedBytes); assert.equal(sha(stored), record.storedSHA256);
    let raw;
    if (record.kind === 'complete-report-gzip') {
      assert.ok(REPORTS.includes(record.target)); assert.equal(record.file, record.target + '.gz');
      raw = gunzipSync(stored, { maxOutputLength: record.originalBytes }); reports.push(record.target);
    } else { assert.equal(record.kind, 'complete-artifact-copy'); assert.equal(record.target, record.file); raw = stored; }
    assert.equal(raw.length, record.originalBytes); assert.equal(sha(raw), record.originalSHA256, 'original complete byte SHA must match');
    assert.equal(record.allOriginalBytesExact, true); write(record.target, raw);
  }
  assert.deepEqual(reports, REPORTS);
  console.log('increment-reconstruct: all five COMPLETE original reports and ' + (manifest.records.length - REPORTS.length) + ' ancillary artifacts byte/SHA verified');
}
