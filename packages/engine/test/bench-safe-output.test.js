import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
// Importing the entrypoints must not launch a benchmark, browser or HTTP server.
import { createIsolatedOutputDirectory, writeIsolatedOutput } from '../bench/isolated-broadphase.mjs';
import { browserOutputPrefix, writeBrowserReport } from '../bench/wasm/browser-server.mjs';

function temporary(testBody) {
  const root = mkdtempSync(join(tmpdir(), 'pliego-safe-output-test-'));
  try { testBody(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const refused = action => assert.throws(action, error => error.code === 'EEXIST');
const privateDirectory = path => { assert.equal(statSync(path).isDirectory(), true); assert.equal(statSync(path).mode & 0o777, 0o700); };
const privateFile = path => { assert.equal(statSync(path).isFile(), true); assert.equal(statSync(path).mode & 0o777, 0o600); };

test('bench output defaults create distinct private directories; explicit isolated paths refuse existing entries', () => {
  const a = createIsolatedOutputDirectory(), b = createIsolatedOutputDirectory(), browser = browserOutputPrefix();
  try {
    assert.notEqual(a, b); assert.notEqual(a, dirname(browser));
    for (const path of [a, b, dirname(browser)]) { privateDirectory(path); assert.equal(dirname(path), resolve(tmpdir())); }
    assert.equal(browser, join(dirname(browser), 'probe'));
    temporary(root => {
      const requested = join(root, 'chosen'), out = createIsolatedOutputDirectory(requested);
      assert.equal(out, requested); privateDirectory(out); refused(() => createIsolatedOutputDirectory(requested));
      const file = join(root, 'file'); writeFileSync(file, 'preserve', { flag: 'wx' });
      refused(() => createIsolatedOutputDirectory(file)); assert.equal(readFileSync(file, 'utf8'), 'preserve');
      const link = join(root, 'link'); symlinkSync(out, link); refused(() => createIsolatedOutputDirectory(link));
      const dangling = join(root, 'dangling'); symlinkSync(join(root, 'absent'), dangling); refused(() => createIsolatedOutputDirectory(dangling));
      const nested = join(root, 'missing-parent', 'chosen');
      assert.throws(() => createIsolatedOutputDirectory(nested), error => error.code === 'ENOENT');
      assert.equal(browserOutputPrefix(join(root, 'explicit-prefix')), join(root, 'explicit-prefix'));
    });
  } finally { for (const path of [a, b, dirname(browser)]) rmSync(path, { recursive: true, force: true }); }
  console.log('bench-safe-directories: three distinct mkdtemp defaults mode0700; exact explicit output path retained; existing file/directory/symlink/dangling link atomically refused; parent directory required');
});

test('isolated report/log/comparison creation is exclusive and cannot overwrite regular files or symlink targets', () => temporary(root => {
  const out = createIsolatedOutputDirectory(join(root, 'run'));
  for (const name of ['component-r1-bvh.json', 'component-r1-bvh.json.log', 'isolated-comparison.json']) {
    const bytes = name.endsWith('.log') ? 'child diagnostic\n' : '{"complete":true}\n';
    const path = writeIsolatedOutput(out, name, bytes); privateFile(path); assert.equal(readFileSync(path, 'utf8'), bytes);
    refused(() => writeIsolatedOutput(out, name, 'overwrite')); assert.equal(readFileSync(path, 'utf8'), bytes);
  }
  const target = join(root, 'target'); writeFileSync(target, 'retained target', { flag: 'wx' });
  symlinkSync(target, join(out, 'linked.json')); refused(() => writeIsolatedOutput(out, 'linked.json', 'overwrite'));
  assert.equal(readFileSync(target, 'utf8'), 'retained target');
  symlinkSync(join(root, 'absent'), join(out, 'dangling.json')); refused(() => writeIsolatedOutput(out, 'dangling.json', 'overwrite'));
  assert.throws(() => writeIsolatedOutput(out, '../escape.json', 'bad'), /plain output filename/);
  console.log('bench-safe-isolated: normal report/log/comparison bytes mode0600; duplicate files and final/dangling symlinks refused by wx, target bytes unchanged; no component/timing run');
}));

test('browser report prefixes preserve explicit names and reject duplicate files, symlinks and invalid modes', () => temporary(root => {
  const prefix = browserOutputPrefix(join(root, 'chosen-prefix'));
  for (const mode of ['strict', 'allow']) {
    const report = { mode, status: 'IO_TEST_ONLY', results: [] }, path = writeBrowserReport(prefix, mode, report);
    assert.equal(path, prefix + '-' + mode + '.json'); privateFile(path); assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), report);
    refused(() => writeBrowserReport(prefix, mode, { ...report, status: 'overwrite' }));
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), report);
  }
  const target = join(root, 'target'); writeFileSync(target, 'preserve', { flag: 'wx' });
  const linked = join(root, 'linked'); symlinkSync(target, linked + '-strict.json');
  refused(() => writeBrowserReport(linked, 'strict', {})); assert.equal(readFileSync(target, 'utf8'), 'preserve');
  symlinkSync(join(root, 'missing'), linked + '-allow.json'); refused(() => writeBrowserReport(linked, 'allow', {}));
  assert.throws(() => writeBrowserReport(prefix, '../escape', {}), /unknown browser report mode/);
  console.log('bench-safe-browser: explicit prefix-strict/allow.json names unchanged; normal bytes mode0600; duplicate POST outputs and existing/dangling links refused, mode whitelist enforced; no browser/physics/server run');
}));
