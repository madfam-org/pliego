import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BoundsTree } from '../src/collision/bounds-tree.js';
import { WasmBoundsTree } from '../src/collision/wasm-bounds-tree.js';
import { boundsKernelMetadata } from '../src/collision/wasm-bounds-code.js';
import { mulberry32 } from '../src/geom.js';

const bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

test('Wasm binary64 refits and queries match JS bytes, hits and structural work', () => {
  let queries = 0;
  for (const size of [0, 1, 7, 64, 137]) {
    const a = new BoundsTree(size), b = new WasmBoundsTree(size), random = mulberry32(918 + size);
    const boxes = new Float64Array(6 * size), flags = new Uint8Array(size), order = Array.from({ length: size }, (_, i) => i);
    const query = new Float64Array(24);
    for (let sample = 0; sample < 32; sample++) {
      for (let i = 0; i < size; i++) {
        flags[i] = sample % 3 ? Math.floor(3 * random()) : 0;
        for (let k = 0; k < 3; k++) {
          boxes[6 * i + k] = sample % 7 ? 100 * random() - 50 : -0;
          boxes[6 * i + 3 + k] = sample % 7 ? boxes[6 * i + k] + 10 * random() : 0;
        }
      }
      if (sample === 31 && size) { boxes[0] = -Infinity; boxes[3] = Infinity; }
      order.sort((i, j) => boxes[6 * i] - boxes[6 * j] || i - j);
      a.refit(boxes, order, flags); b.refit(boxes, order, flags);
      assert.equal(b.nodes, a.nodes);
      for (const key of ['boxes', 'left', 'right', 'primitive', 'inactive', 'anyInactive', 'maximumRank', 'rank']) assert.deepEqual(bytes(b[key]), bytes(a[key]), `${key}, size=${size}, sample=${sample}`);
      query.set([-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity]);
      query.set([-0, -0, -0, 0, 0, 0], 6);
      query.set(size ? boxes.subarray(0, 6) : new Float64Array(6), 12);
      query.set([1e6, 1e6, 1e6, 2e6, 2e6, 2e6], 18);
      for (let q = 0; q < 4; q++) for (const after of [-Infinity, -1, 0, 0.5, size - 1, Infinity, NaN]) for (const inactive of [false, true, 2]) for (const before of [false, true]) {
        const na = a.query(query, q, inactive, after, before), nb = b.query(query, q, inactive, after, before);
        assert.equal(nb, na); assert.deepEqual(b.hits.slice(0, nb), a.hits.slice(0, na));
        assert.equal(b.nodeTests, a.nodeTests); assert.equal(b.rootContainmentTests, a.rootContainmentTests); assert.equal(b.queries, a.queries); queries++;
      }
    }
  }
  console.log(`wasm-bounds-parity: 160 refits, ${queries} queries; node/rank/flag bytes and hit/work results exact, including signed zero and infinities`);
});

test('Wasm layout and invalid inputs reject before unsafe access; valid refit recovers', () => {
  for (const n of [-1, 0.5, 0x3fffffff]) assert.throws(() => new WasmBoundsTree(n), /primitive count|capacity/);
  const t = new WasmBoundsTree(1), boxes = new Float64Array([0, 0, 0, 1, 1, 1]), flags = new Uint8Array(1);
  assert.throws(() => t.refit(boxes, [1], flags), /primitive rank/);
  assert.throws(() => t.refit(boxes, [], flags), /refit size/);
  boxes[0] = NaN; assert.throws(() => t.refit(boxes, [0], flags), /NaN bound/); boxes[0] = 0;
  t.refit(boxes, [0], flags); assert.equal(t.query(boxes, 0, false), 1);
  assert.throws(() => t.query(boxes, -1, false), /query index/);
  assert.throws(() => t.query(boxes, 1, false), /query index/);
  boxes[0] = NaN; assert.throws(() => t.query(boxes, 0, false), /NaN query/); boxes[0] = 0;
  const size = t.memory.buffer.byteLength; assert.throws(() => t.memory.grow(1), RangeError); assert.equal(t.memory.buffer.byteLength, size);
  t.refit(boxes, [0], flags); assert.equal(t.query(boxes, 0, false), 1);
  console.log('wasm-bounds-domain: size/rank/NaN/index/address limits reject; no memory growth or hidden fallback; valid refit recovers');
});

test('Generated Wasm source/binary fingerprints and ABI remain reproducible inputs', () => {
  const hash = x => createHash('sha256').update(x).digest('hex');
  const source = readFileSync(new URL('../bench/wasm/bounds-tree.wat', import.meta.url));
  const generated = readFileSync(new URL('../src/collision/wasm-bounds-code.js', import.meta.url), 'utf8');
  const binary = Buffer.from(generated.match(/^const base64 = '([A-Za-z0-9+/=]+)'/m)[1], 'base64');
  assert.equal(hash(source), boundsKernelMetadata.sourceSHA256); assert.equal(hash(binary), boundsKernelMetadata.binarySHA256);
  assert.equal(binary.length, boundsKernelMetadata.binaryBytes);
  const module = new WebAssembly.Module(binary);
  assert.deepEqual(WebAssembly.Module.imports(module), [{ module: 'env', name: 'memory', kind: 'memory' }]);
  assert.deepEqual(WebAssembly.Module.exports(module), [{ name: 'refit', kind: 'function' }, { name: 'query', kind: 'function' }]);
  console.log(`wasm-bounds-build: ${binary.length}B scalar binary; source/binary SHA256 exact; only host-memory import`);
});
