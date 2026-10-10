// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadDocument, World } from '../src/index.js';
import { fixtureDocs } from './helpers/fixtures.js';

test('fixtures: committed .fold files load, simulate a frame, and match their builders', async () => {
  const docs = await fixtureDocs();
  for (const [name, doc] of Object.entries(docs)) {
    const text = readFileSync(new URL(`./fixtures/${name}.fold`, import.meta.url), 'utf8');
    assert.equal(text, `${JSON.stringify(doc, null, 1)}\n`, `${name}.fold drifted — run node packages/engine/test/helpers/write-fixtures.js`);
    const d = loadDocument(text);
    const w = new World(d, { meshEdge: 10 });
    w.step();
    assert.ok(w.stats().finite);
    console.log(`fixture ${name}: sheets=${d.sheets.length} vertices=${d.nV} edges=${d.nE} faces=${d.nF} joins=${d.joins.length} mesh V=${w.mesh.nV}`);
  }
});
