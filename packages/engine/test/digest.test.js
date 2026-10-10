// @ts-check
/**
 * meta.digest verification (spec §5.7, rule 10), over the canonical serialisation of wave-3 lane H's
 * spec §5.15 (RFC 8785 / JCS). The vector below is lane H's shared test vector
 * (packages/kernel/tests/fixtures/digest_vector.json on its branch), copied so this test stands
 * alone: the kernel and the engine must agree on it byte for byte.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadDocument } from '../src/index.js';
import { canonicalJSON, sha256Hex, documentDigest } from '../src/digest.js';
import { squareValley } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

// JSON.parse of the vector's text: 150.0 → 150, 5e-06 → 0.000005, -0.0 → -0, as any reader sees it
const VECTOR = {
  document: JSON.parse("{\"file_spec\": 1.2, \"vertices_coords\": [[0, 0], [150.0, 5e-06], [1e-07, 1e+21], [-0.0, 12.5]], \"pliego:sheets\": [{\"id\": \"s\", \"label\": {\"en\": \"Caf\\u00e9 \\u2615\", \"es\": \"L\\u00ednea\\u2028nueva\"}}], \"pliego:meta\": {\"kernel\": \"pliego-kernel 0.2.0\", \"params\": {\"b\": 2, \"a\": 0.1, \"\\ud83d\\ude00\": true, \"\\ue000\": null}, \"digest\": null}}"),
  canonical: "{\"file_spec\":1.2,\"pliego:meta\":{\"digest\":null,\"kernel\":\"pliego-kernel 0.2.0\",\"params\":{\"a\":0.1,\"b\":2,\"\ud83d\ude00\":true,\"\ue000\":null}},\"pliego:sheets\":[{\"id\":\"s\",\"label\":{\"en\":\"Caf\u00e9 \u2615\",\"es\":\"L\u00ednea\u2028nueva\"}}],\"vertices_coords\":[[0,0],[150,0.000005],[1e-7,1e+21],[0,12.5]]}",
  digest: "sha256:1c9d6a6ad4f1ea789d7b23d28b86348a869866392f4705b8ca01d6c92a34619d",
};

test('SHA-256 (FIPS 180-4) matches node:crypto on 0–2000-byte inputs', () => {
  let bad = 0;
  for (let n = 0; n < 2000; n += 37) {
    const b = new Uint8Array(n).map((_, i) => (i * 131 + n) & 255);
    if (sha256Hex(b) !== crypto.createHash('sha256').update(b).digest('hex')) bad++;
  }
  assert.equal(bad, 0);
});

test('canonical serialisation and digest reproduce the kernel\'s shared vector', () => {
  const text = canonicalJSON(VECTOR.document);
  const dig = documentDigest(VECTOR.document);
  const pass = text === VECTOR.canonical && dig === VECTOR.digest;
  proof('digest-vector', dig === VECTOR.digest ? 'match' : dig, VECTOR.digest, 'byte-identical canonical text and digest', pass, `${text.length} canonical bytes (UTF-16 key order, ECMAScript numbers, U+2028 raw)`);
  assert.ok(pass);
  assert.throws(() => canonicalJSON({ s: '\ud800' }), /lone surrogate/);
});

test('rule 10: a sealed document loads; any change to it, or a wrong digest, is rejected', () => {
  const { doc } = squareValley({ size: 90 });
  doc['pliego:meta'].digest = documentDigest(doc);
  assert.doesNotThrow(() => loadDocument(doc));
  assert.doesNotThrow(() => loadDocument(JSON.stringify(doc, null, 2)), 'whitespace and key order of the file do not matter');
  const moved = JSON.parse(JSON.stringify(doc));
  moved.vertices_coords[1][0] += 0.001;
  assert.throws(() => loadDocument(moved), /rule 10: pliego:meta.digest .* does not match/);
  const wrong = JSON.parse(JSON.stringify(doc));
  wrong['pliego:meta'].digest = 'sha256:' + '0'.repeat(64);
  assert.throws(() => loadDocument(wrong), /rule 10/);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) documentDigest(doc);
  console.log(`digest: ${((performance.now() - t0) / 20).toFixed(2)} ms per verification of a ${JSON.stringify(doc).length}-byte document`);
});
