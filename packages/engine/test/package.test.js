// @ts-check
/**
 * The published package's metadata (owner ruling 2026-10-22: `@pliego/engine` is published to npm.madfam.io).
 * ENGINE_VERSION is the package version; the exports map points at files that exist; the tarball is an allowlist
 * that leaves tests and benchmarks out; publishing can only target MADFAM's registry.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ENGINE_KIND, ENGINE_VERSION } from '../src/index.js';

const pkgUrl = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'));

test('package: name, version and licence match the engine', () => {
  assert.equal(pkg.name, '@pliego/engine');
  assert.equal(ENGINE_VERSION, pkg.version, 'bump src/index.js ENGINE_VERSION with package.json');
  assert.equal(ENGINE_KIND, 'pliego-engine');
  assert.equal(pkg.license, 'AGPL-3.0-only');
  assert.equal(pkg.private, undefined, 'publishable');
  assert.match(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), new RegExp(`^## ${pkg.version.replace(/\./g, '\\.')} `, 'm'));
});

test('package: entry points exist, deep imports are not exported, no runtime dependency', () => {
  assert.deepEqual(Object.keys(pkg.exports).sort(), ['.', './package.json']);
  assert.equal(pkg.exports['.'].default, './src/index.js');
  assert.equal(pkg.exports['.'].types, './types/index.d.ts');
  assert.equal(pkg.main, './src/index.js');
  assert.ok(existsSync(new URL('../src/index.js', import.meta.url)));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.type, 'module');
});

test('package: the tarball allowlist leaves tests, benchmarks and scripts out; publish targets npm.madfam.io only', () => {
  assert.deepEqual(pkg.files, ['src/', 'types/', 'README.md', 'CHANGELOG.md', 'LICENSE']);
  assert.deepEqual(pkg.publishConfig, { registry: 'https://npm.madfam.io/' });
});
