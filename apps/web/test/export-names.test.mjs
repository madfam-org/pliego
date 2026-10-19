// Studio export file names follow the API's, and the Studio offers the API's bundle export
// (geo-stab V3 P3-1: the Studio saved HPGL as `valley-fold.hpgl` and dropped the mode, while the
// API names it `valley-fold-default.plt`; the bundle existed only server-side).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exportFileName, attachmentName, exportDownload, canBundle, EXPORT_EXTENSIONS, BUNDLE_CUT_FORMATS } from '../studio/src/data.js';
import { exportButtons } from '../studio/src/panels.js';

const api = (p) => fs.readFileSync(new URL(`../../api/${p}`, import.meta.url), 'utf8');

test('the extensions and the bundle rule mirror the API (render.py TRANSPORT, generator.py CUT_FORMATS)', () => {
  const transport = Object.fromEntries([...api('render.py').matchAll(/^\s+"(\w+)": \("[^"]+", "(\w+)"\),$/gm)].map((m) => [m[1], m[2]]));
  assert.ok(Object.keys(transport).length >= 6, 'TRANSPORT parsed');
  const { bundle, ...studio } = EXPORT_EXTENSIONS;
  assert.deepEqual(studio, transport);
  assert.equal(bundle, 'zip');
  const cut = /^CUT_FORMATS = \(([^)]*)\)$/m.exec(api('generator.py'));
  assert.ok(cut, 'CUT_FORMATS parsed');
  assert.deepEqual([...BUNDLE_CUT_FORMATS], [...cut[1].matchAll(/"(\w+)"/g)].map((m) => m[1]));
});

test('names are <slug>-<mode>.<extension>, like generator.file_name', () => {
  assert.equal(exportFileName('valley-fold', 'default', 'hpgl'), 'valley-fold-default.plt');
  assert.equal(exportFileName('case-binding', 'book', 'pdf'), 'case-binding-book.pdf');
  assert.equal(exportFileName('valley-fold', 'default', 'fold'), 'valley-fold-default.fold');
  assert.equal(exportFileName('valley-fold', 'default', 'bundle'), 'valley-fold-default.zip');
  assert.equal(exportFileName('valley-fold', null, 'svg'), 'valley-fold.svg');
});

test('Content-Disposition names are read, and only plain names are accepted', () => {
  assert.equal(attachmentName('attachment; filename="valley-fold-default.plt"'), 'valley-fold-default.plt');
  assert.equal(attachmentName('attachment; filename=valley-fold-default-0123456789ab.zip'), 'valley-fold-default-0123456789ab.zip');
  for (const bad of [null, '', 'attachment', 'attachment; filename="../x.svg"', 'attachment; filename="a/b.svg"', 'attachment; filename=".hidden"']) {
    assert.equal(attachmentName(bad), null, String(bad));
  }
});

test('a download takes the API name; without one it falls back to the same rule', async () => {
  const named = async () => new Response('IN;', { status: 200, headers: { 'Content-Type': 'application/vnd.hp-hpgl', 'Content-Disposition': 'attachment; filename="valley-fold-default.plt"' } });
  const r1 = await exportDownload('valley-fold', {}, 'hpgl', 'default', { fetchImpl: named });
  assert.equal(r1.name, 'valley-fold-default.plt');
  assert.equal(await r1.blob.text(), 'IN;');
  const calls = [];
  const bare = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response('PK', { status: 200, headers: { 'Content-Type': 'application/zip' } }); };
  const r2 = await exportDownload('case-binding', { width: 120 }, 'bundle', 'book', { fetchImpl: bare });
  assert.equal(r2.name, 'case-binding-book.zip');
  assert.deepEqual(calls[0], { slug: 'case-binding', mode: 'book', params: { width: 120 }, format: 'bundle' });
});

test('the bundle is offered when a cut format is published, after the formats', () => {
  assert.deepEqual(exportButtons(['fold', 'svg', 'dxf', 'pdf', 'hpgl', 'glb']), ['fold', 'svg', 'dxf', 'pdf', 'hpgl', 'glb', 'bundle']);
  assert.deepEqual(exportButtons(['fold', 'svg', 'pdf', 'glb']), ['fold', 'svg', 'pdf', 'glb', 'bundle']);
  assert.deepEqual(exportButtons(['fold', 'glb']), ['fold', 'glb']);
  assert.equal(canBundle([]), false);
});
