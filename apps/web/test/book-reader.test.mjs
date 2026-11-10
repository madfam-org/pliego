import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as engine from '../../../packages/engine/src/index.js';
import { BookWorld } from '../studio/src/book-world.js';
import { readingBook, readingPose, spreadPages } from '../studio/src/book-layout.js';
import { engineOptions } from '../studio/src/physics.js';
import { attachBookReader } from '../studio/src/book-reader.js';

const json = JSON.parse(readFileSync(new URL('../studio/books/eight-page.fold', import.meta.url)));
const options = engineOptions(json);
function surface(width, scale) {
  const handlers = new Map(), events = new Map(), outer = new Map();
  const ownerDocument = { hidden: false, addEventListener: (k, f) => events.set(k, f), removeEventListener: k => events.delete(k),
    defaultView: { addEventListener: (k, f) => outer.set(k, f), removeEventListener: k => outer.delete(k) } };
  const canvas = { ownerDocument, focus() {}, setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height: 600 }),
    addEventListener: (k, f) => handlers.set(k, f), removeEventListener: k => handlers.delete(k) };
  return { canvas, handlers, send(type, x) { handlers.get(type)({ type, pointerId: 1, button: 0,
    clientX: width * (1 + x / scale) / 2, clientY: 300, preventDefault() {} }); } };
}
const stepTurn = w => {
  for (let f = 0; f < 84; f++) {
    w.step(1 / 60);
    const s = w.stats();
    assert.ok(s.finite && s.maxStrain < 0.01, `reading frame ${f}: strain=${s.maxStrain}`);
  }
};

test('book reader admits independent native leaves and leaves fabrication source untouched', () => {
  const before = JSON.stringify(json), book = readingBook(json);
  assert.equal(book.leaves.length, 4); assert.equal(book.pages, 8);
  for (let active = 0; active < 4; active++) {
    const pose = readingPose(json, book, active), doc = engine.loadDocument(pose);
    assert.equal(doc.sheets.length, 4);
    assert.deepEqual(pose.vertices_coords, json.vertices_coords);
    assert.deepEqual(pose['pliego:stocks'], json['pliego:stocks']);
    assert.deepEqual(pose['pliego:sheets'].map(s => [s.id, s.front, s.back]), json['pliego:sheets'].map(s => [s.id, s.front, s.back]));
    assert.equal(pose['pliego:mechanisms'].length, 1);
    assert.equal(pose['pliego:sheets'].filter(s => !s.kinematic).length, 1);
  }
  assert.equal(JSON.stringify(json), before);
  for (const mutate of [
    j => { j['pliego:controls'][0].default = 90; },
    j => { j['pliego:mechanisms'][0].keys = [[0, 0], [180, 90]]; },
    j => { j['pliego:joins'][0].a.along[1][0] = 3; },
    j => { j['pliego:sheets'][0].placement.rotation = [0, 1, 0, 0]; },
    j => { delete j.file_frames; },
  ]) { const j = structuredClone(json); mutate(j); assert.equal(readingBook(j), null); }
  assert.equal(readingBook(null), null);
  assert.throws(() => spreadPages(5, 4), RangeError);
  console.log('book-admission: native=4 leaves, pages=8, source/material/art immutable, unsupported=5 rejected');
});

test('book reader turns all leaves in both directions with fixed resting sheets and bounded models', () => {
  const before = JSON.stringify(json), w = new BookWorld(engine, json, options), observed = [];
  assert.equal(w.navigate('backward'), false); assert.equal(w.select(2), false);
  assert.equal(w.finish(180, 4), false); assert.equal(w.navigate('sideways'), false);
  for (const direction of ['forward', 'backward']) for (let k = 0; k < 4; k++) {
    assert.equal(w.navigate(direction), true);
    const world = w.world, resting = world.x.slice();
    assert.equal(w.navigate(direction), false, 'release is serialized');
    assert.equal(w.select(0), false, 'no model swap during a release');
    stepTurn(w);
    assert.ok(w.lastRelease.stats.finite, 'keep pre-promotion physics evidence');
    const sheet = w.book.leaves[w.active].sheet;
    for (let v = 0; v < world.mesh.nV; v++) if (world.mesh.vSheet[v] === sheet) {
      assert.equal(world.x[3 * v + 1], world.X0[3 * v + 1], 'released page joins a flat resting block');
      assert.ok((w.active < w.position ? -1 : 1) * (world.x[3 * v] - w.book.origin[0]) >= -1e-9);
    }
    for (let v = 0; v < world.mesh.nV; v++) if (world.mesh.vSheet[v] !== w.book.leaves[w.active].sheet) {
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(world.x[3 * v + c] - resting[3 * v + c]) < 1e-9);
    }
    observed.push(w.readingState().pages);
    assert.ok(w.models.size <= 2);
  }
  assert.deepEqual(observed, [[2, 3], [4, 5], [6, 7], [8], [6, 7], [4, 5], [2, 3], [1]]);
  assert.equal(w.position, 0); assert.equal(w.navigate('backward'), false);
  const substeps = w.world.substepsRun;
  for (let i = 0; i < 10; i++) w.step();
  assert.equal(w.world.substepsRun, substeps, 'resting page blocks do no solver work');
  assert.equal(JSON.stringify(json), before);
  w.dispose(); assert.equal(w.models.size, 0); assert.equal(w.select(0), false);
  console.log('book-sequence: forward=4 backward=4, finite, stretch<1%, stationary resting sheets, models<=2');
});

test('book release timing follows simulation time rather than caller frame count', () => {
  const w = new BookWorld(engine, json, options);
  assert.throws(() => w.step(0), RangeError);
  w.navigate('forward');
  for (let i = 0; i < 84; i++) w.step(1 / 120);
  assert.equal(w.position, 0); assert.equal(w.readingBusy, true);
  for (let i = 0; i < 84; i++) w.step(1 / 120);
  assert.equal(w.position, 1); assert.equal(w.readingBusy, false);
  console.log('book-time: release=1.4 simulation seconds at both 60 and 120 caller frames/s');
});

test('cancelled partial turn keeps the spread and queued navigation visits every leaf', () => {
  const w = new BookWorld(engine, json, options);
  w.setControl('turn-1', 65);
  for (let f = 0; f < 20; f++) w.step(1 / 60);
  assert.equal(w.finish(0, 0), true); stepTurn(w);
  assert.deepEqual(w.readingState().pages, [1]);
  assert.equal(w.goTo(4), true);
  for (let k = 0; k < 4; k++) stepTurn(w);
  assert.deepEqual(w.readingState().pages, [8]);
  assert.equal(w.goTo(5), false); assert.equal(w.navigate('forward'), false);
  assert.equal(w.goTo(0), true);
  for (let k = 0; k < 4; k++) stepTurn(w);
  assert.deepEqual(w.readingState().pages, [1]);
  console.log('book-cancel: partial restored; queued forward/backward visits 8 turns without skipping');
});

test('book drag follows page geometry across narrow viewports and zoom, without orbiting', () => {
  for (const [width, scale] of [[390, 150], [1280, 300]]) {
    const w = new BookWorld(engine, json, options), s = surface(width, scale), held = [];
    const camera = { yaw: 0, pitch: 1.17, target: [0, 0, -64],
      ray: x => ({ origin: [x * scale, 100, -64], dir: [0, -1, 0] }),
      orbit() { assert.fail('book orbited'); }, pan() { assert.fail('book panned'); }, zoom() {}, reset() {} };
    const input = attachBookReader({ canvas: s.canvas, camera }, { getWorld: () => w,
      onStart() {}, onHolding: v => held.push(v), onChange() {} });
    s.send('pointerdown', 45); s.send('pointermove', -45); s.send('pointerup', -45);
    assert.equal(w.getControl('turn-1'), 180); stepTurn(w); assert.equal(w.position, 1);
    s.send('pointerdown', -45); s.send('pointermove', 45); s.send('pointerup', 45);
    assert.equal(w.getControl('turn-1'), 0); stepTurn(w); assert.equal(w.position, 0);
    s.send('pointerdown', 45); s.send('pointermove', 20); s.send('pointercancel', 20);
    stepTurn(w); assert.equal(w.position, 0); assert.equal(w.getControl('turn-1'), 0);
    assert.deepEqual(held, [true, false, true, false, true, false]);
    assert.equal(camera.yaw, 0); assert.equal(camera.pitch, 1.17); assert.deepEqual(camera.target, [0, 0, -64]);
    input.destroy(); assert.equal(s.handlers.size, 0); w.dispose();
  }
  console.log('book-drag: native picks at 390/1280 px and two zoom scales; forward/reverse/cancel; camera fixed');
});
