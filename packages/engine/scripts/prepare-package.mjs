#!/usr/bin/env node
/**
 * Prepares `@pliego/engine` for `npm pack` / `npm publish` and checks what the tarball would hold.
 *
 *   node packages/engine/scripts/prepare-package.mjs            # licence + declarations + tarball check
 *   node packages/engine/scripts/prepare-package.mjs --no-types # licence + tarball check (offline)
 *
 * 1. Copies the repository's root LICENSE (AGPL-3.0-only) into the package (gitignored there).
 * 2. Emits TypeScript declarations from the JSDoc in src/ into types/ (gitignored), with the same pinned
 *    TypeScript the CI type check uses (`npx -p typescript@5.9.3`; no install step in the repository).
 * 3. Runs `npm pack --dry-run --json` and fails unless every file is on the allowlist (src/*.js, types/*.d.ts,
 *    README.md, CHANGELOG.md, LICENSE, package.json), the entry points exist, and nothing from test/, bench/,
 *    scripts/ or any dotfile (.npmrc, .env) is in it.
 *
 * Read-proof: one line with the file count and the unpacked size; an empty tarball is a failure.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPESCRIPT = '5.9.3';
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pkgDir, '..', '..');
const withTypes = !process.argv.includes('--no-types');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

function fail(msg) {
  console.error(`engine-pack: FAIL ${msg}`);
  process.exit(1);
}

copyFileSync(join(repoRoot, 'LICENSE'), join(pkgDir, 'LICENSE'));

if (withTypes) {
  rmSync(join(pkgDir, 'types'), { recursive: true, force: true });
  execFileSync(
    'npx',
    ['-y', '-p', `typescript@${TYPESCRIPT}`, 'tsc', '--allowJs', '--declaration', '--emitDeclarationOnly', '--skipLibCheck',
      '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--lib', 'es2022,dom',
      '--outDir', join(pkgDir, 'types'), join(pkgDir, 'src', 'index.js')],
    { stdio: 'inherit' },
  );
}

const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: pkgDir, encoding: 'utf8' });
const [report] = JSON.parse(out);
const files = report.files.map((f) => f.path).sort();
if (files.length === 0) fail('the tarball would be empty');

const ALLOWED = /^(src\/.+\.js|types\/.+\.d\.ts|README\.md|CHANGELOG\.md|LICENSE|package\.json)$/;
const stray = files.filter((f) => !ALLOWED.test(f) || /(^|\/)\./.test(f) || /^(test|bench|scripts)\//.test(f));
if (stray.length) fail(`unexpected files in the tarball: ${stray.join(', ')}`);

const required = ['package.json', 'LICENSE', 'README.md', 'CHANGELOG.md', pkg.main.replace(/^\.\//, '')];
if (withTypes) required.push(pkg.types.replace(/^\.\//, ''));
for (const f of required) if (!files.includes(f)) fail(`missing ${f}`);
for (const target of [pkg.exports['.'].default, ...(withTypes ? [pkg.exports['.'].types] : [])]) {
  if (!existsSync(join(pkgDir, target))) fail(`exports target ${target} does not exist`);
}
if (pkg.private) fail('package.json still says "private": true');

const src = files.filter((f) => f.startsWith('src/')).length;
const types = files.filter((f) => f.startsWith('types/')).length;
console.log(
  `engine-pack: ${report.name}@${report.version} files=${files.length} src=${src} types=${types} ` +
    `unpacked=${report.unpackedSize}B packed=${report.size}B OK`,
);
