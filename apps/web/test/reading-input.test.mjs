import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attachReadingInput } from '../studio/src/render/reading-input.js';
import { attachLeafReader, readingLeaf } from '../studio/src/leaf-reader.js';
import { parseShare, buildShare } from '../studio/src/share.js';
import { World, loadDocument } from '../../../packages/engine/src/index.js';

const base = JSON.parse(readFileSync(new URL('../studio/demo/page-turn.fold', import.meta.url)));
function surface() {
  const handlers = new Map(), documentHandlers = new Map(), windowHandlers = new Map(), released = [];
  const defaultView = { addEventListener: (k, v) => windowHandlers.set(k, v), removeEventListener: (k) => windowHandlers.delete(k) };
  const ownerDocument = { defaultView, hidden: false, addEventListener: (k, v) => documentHandlers.set(k, v), removeEventListener: (k) => documentHandlers.delete(k) };
  const canvas = { ownerDocument, focus() {}, setPointerCapture() {}, releasePointerCapture(id) { released.push(id); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener: (k, v) => handlers.set(k, v), removeEventListener: (k) => handlers.delete(k) };
  let prevented = 0;
  const send = (type, fields = {}) => handlers.get(type)({ type, pointerId: 1, button: 0, clientX: 600, clientY: 300, preventDefault() { prevented++; }, ...fields });
  return { canvas, handlers, documentHandlers, windowHandlers, released, send, prevented: () => prevented };
}

test('paper interaction is explicit and round-trips without admitting unknown modes', () => {
  assert.equal(parseShare('', '').interaction, 'inspect');
  assert.equal(parseShare('?interaction=anything', '').interaction, 'inspect');
  const u = new URL(buildShare('https://example.test/studio/', { slug: 'page-turn', keep: new URLSearchParams('interaction=paper&engine=physics') }));
  assert.equal(parseShare(u.search, '').interaction, 'paper');
  assert.equal(u.searchParams.get('engine'), 'physics');
});

test('reader admits a native single angle-driven leaf and rejects unsupported construction', () => {
  assert.deepEqual(readingLeaf(base), { sheet: 1, control: 'turn' });
  assert.equal(readingLeaf(null), null);
  for (const mutate of [
    (j) => j['pliego:mechanisms'].push(structuredClone(j['pliego:mechanisms'][0])),
    (j) => { j['pliego:mechanisms'][0].keys = [[0, 0], [180, 90]]; },
    (j) => { j['pliego:controls'][0].max = 90; },
    (j) => { j['pliego:mechanisms'][0].sheet = 'missing'; },
  ]) {
    const json = structuredClone(base); mutate(json); assert.equal(readingLeaf(json), null);
  }
});

test('reader input never orbits/pans, preserves wheel scrolling, and cancels capture and pinch safely', () => {
  const s = surface(), calls = [], zooms = [];
  const camera = { orbit() { assert.fail('reader orbited'); }, pan() { assert.fail('reader panned'); }, zoom: (k) => zooms.push(k), reset() {} };
  const input = attachReadingInput(s.canvas, camera, {
    onStart: () => true, onMove: (p) => calls.push(['move', p]), onEnd: (c) => calls.push(['end', c]),
    onNavigate: (d) => calls.push(['navigate', d]), onChange() {},
  });
  s.send('pointermove'); assert.deepEqual(calls, [], 'hover is inert');
  s.send('pointerdown'); s.send('pointermove', { clientX: 200 }); s.send('pointerup', { clientX: 200 });
  assert.deepEqual(calls.at(-1), ['end', false]);
  s.send('pointerdown', { button: 2 }); assert.deepEqual(calls.at(-1), ['end', false]);
  for (const reason of ['pointercancel', 'lostpointercapture', 'blur']) {
    s.send('pointerdown'); s.send(reason); assert.deepEqual(calls.at(-1), ['end', true]);
  }
  s.send('pointerdown'); s.send('keydown', { key: 'Escape' }); assert.deepEqual(calls.at(-1), ['end', true]); s.send('pointerup');
  s.send('pointerdown'); s.canvas.ownerDocument.hidden = true; s.documentHandlers.get('visibilitychange')();
  assert.deepEqual(calls.at(-1), ['end', true]); s.canvas.ownerDocument.hidden = false;
  s.send('pointerdown'); s.windowHandlers.get('resize')(); assert.deepEqual(calls.at(-1), ['end', true]);
  const p = s.prevented(); s.send('wheel', { deltaY: 100 }); assert.equal(s.prevented(), p);
  s.send('wheel', { deltaY: 100, ctrlKey: true }); assert.ok(zooms.at(-1) > 1);
  s.send('pointerdown'); const released = s.released.length; s.send('pointerdown', { pointerId: 2, clientX: 500 });
  assert.deepEqual(calls.at(-1), ['end', true]);
  assert.equal(s.released.length, released, 'both pointer captures survive transition to pinch');
  s.send('pointermove', { pointerId: 2, clientX: 400 }); assert.equal(zooms.at(-1), 0.5);
  s.send('pointerup'); const count = calls.length;
  s.send('pointermove', { pointerId: 2, clientX: 450 }); assert.equal(calls.length, count, 'remaining pinch finger is inert'); s.send('pointerup', { pointerId: 2 });
  s.send('keydown', { key: 'ArrowLeft' }); s.send('keydown', { key: 'ArrowRight' });
  assert.deepEqual(calls.slice(-2), [['navigate', 'backward'], ['navigate', 'forward']]);
  input.destroy(); assert.equal(s.handlers.size, 0); assert.equal(s.documentHandlers.size, 0); assert.equal(s.windowHandlers.size, 0);
});

test('reader drives the native paper solver reversibly and cancellation restores the control', () => {
  const world = new World(loadDocument(base), { meshEdge: 18, substeps: 8, seed: 1, mechanismRate: 240 });
  const s = surface(), holding = [];
  let value = 0, pickSheet = 1;
  const pose = { yaw: 0, pitch: 1, target: [0, 0, 0] };
  const camera = { ...pose, ray: () => ({ origin: [0, 300, 0], dir: [0, -1, 0] }), zoom() {}, reset() {} };
  // Picking is tested by the native engine suite; isolate leaf admission here.
  const selectable = { pick: () => ({ sheet: pickSheet }) };
  const input = attachLeafReader({ canvas: s.canvas, camera }, {
    leaf: readingLeaf(base), getWorld: () => selectable, getControl: () => value,
    setControl: (_id, angle) => { value = angle; world.setControl('turn', angle); },
    onStart() {}, onHolding: (v) => holding.push(v), onChange() {},
  });
  const step = () => { for (let i = 0; i < 84; i++) { world.step(1 / 60); assert.equal(world.stats().finite, true); } };
  const meanX = () => { let sum = 0, n = 0; for (let v = 0; v < world.mesh.nV; v++) if (world.mesh.vSheet[v] === 1) { sum += world.positions[v * 3]; n++; } return sum / n; };
  s.send('pointerdown'); s.send('pointermove', { clientX: 100 }); s.send('pointerup', { clientX: 100 });
  assert.equal(value, 180); step(); assert.ok(meanX() < -50, 'real paper lands on the left');
  s.send('pointerdown', { clientX: 100 }); s.send('pointermove', { clientX: 650 }); s.send('pointerup', { clientX: 650 });
  assert.equal(value, 0); step(); assert.ok(meanX() > 50, 'real paper returns to the right');
  s.send('pointerdown'); s.send('pointermove', { clientX: 350 }); s.send('pointercancel'); assert.equal(value, 0);
  pickSheet = 0; s.send('pointerdown'); s.send('pointermove', { clientX: 100 }); s.send('pointerup'); assert.equal(value, 0, 'backing cannot turn a leaf');
  assert.deepEqual({ yaw: camera.yaw, pitch: camera.pitch, target: camera.target }, pose);
  assert.deepEqual(holding, [true, false, true, false, true, false]);
  input.destroy();
});
