// Reproduce the scalar kernel without adding an engine/runtime dependency.
// Usage: node build-bounds.mjs --wabt /absolute/node_modules/wabt [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const args = process.argv.slice(2), wi = args.indexOf('--wabt');
assert.ok(wi >= 0 && args[wi + 1], '--wabt must point to the pinned compiler package');
const dir = resolve(args[wi + 1]), pkg = JSON.parse(readFileSync(join(dir, 'package.json')));
const hash = b => createHash('sha256').update(b).digest('hex');
assert.equal(pkg.name, 'wabt'); assert.equal(pkg.version, '1.0.39');
const compilerSHA256 = hash(readFileSync(join(dir, 'index.js')));
assert.equal(compilerSHA256, 'cecf06ab5c65c3b7c05bafe601bbba61a45e4939889c5c51351e8817ac06f48d');
const wabt = await createRequire(import.meta.url)(dir)();
const source = readFileSync(new URL('./bounds-tree.wat', import.meta.url));
const parsed = wabt.parseWat('bounds-tree.wat', source, { simd: false, relaxed_simd: false, threads: false });
parsed.validate();
const options = { canonicalize_lebs: true, write_debug_names: false };
const bytes = parsed.toBinary(options).buffer, repeat = parsed.toBinary(options).buffer;
assert.deepEqual(bytes, repeat); parsed.destroy();
assert.ok(WebAssembly.validate(bytes));
const metadata = { compiler: 'wabt', version: pkg.version, compilerSHA256, sourceSHA256: hash(source), binarySHA256: hash(bytes), binaryBytes: bytes.length };
const output = `// @ts-check\n// Generated from bench/wasm/bounds-tree.wat; AGPL-3.0-only. Rebuild with build-bounds.mjs.\nexport const boundsKernelMetadata = Object.freeze(${JSON.stringify(metadata)});\nconst base64 = '${Buffer.from(bytes).toString('base64')}';\n/** @type {WebAssembly.Module | null} */\nlet compiled = null;\n/** Lazy synchronous compile, shared per realm. Each tree owns its memory/instance.\n * @param {WebAssembly.Memory} memory\n */\nexport function createBoundsKernel(memory) {\n  if (typeof WebAssembly === 'undefined') throw new Error('Wasm contact: WebAssembly unavailable');\n  if (!compiled) compiled = new WebAssembly.Module(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));\n  return new WebAssembly.Instance(compiled, { env: { memory } });\n}\n`;
const target = new URL('../../src/collision/wasm-bounds-code.js', import.meta.url);
if (args.includes('--check')) assert.equal(readFileSync(target, 'utf8'), output, 'generated kernel drift'); else writeFileSync(target, output);
console.log(`wasm-bounds-build: compiler=${pkg.version} bytes=${bytes.length} deterministic binary; ${args.includes('--check') ? 'checked' : 'generated'} source SHA256=${metadata.sourceSHA256}`);
