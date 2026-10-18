// Studio render path: what a frame costs. A fake WebGL2 context counts uploads, shadow passes and
// mesh-sized allocations per frame; the frame-loop helpers decide when to draw and when to sleep;
// the Worker host and its main-thread proxy replay the paper engine bit-identically with pooled,
// transferred pose buffers; paper edges come from the topology once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebGLRenderer } from '../studio/src/render/webgl.js';
import { MAX_SHEETS } from '../studio/src/render/shaders.js';
import { hexToLinear } from '../studio/src/render/math.js';
import { outlineEdges } from '../studio/src/render/edges.js';
import { backingSize, createChangeTracker, keepRunning, planSteps, DPR_CAP_COARSE, PIXEL_BUDGET_FINE, QUIET_FRAMES_ENGINE } from '../studio/src/frame-loop.js';
import { createEngineHost, probeStep } from '../studio/src/engine-worker.js';
import { WorkerWorld, pickRenderMesh } from '../studio/src/world-proxy.js';
import { createEngineOverlay, highlightStep } from '../studio/src/diagram.js';
import { engineOptions } from '../studio/src/physics.js';
import * as stub from '../studio/src/engine-stub.js';
import * as engine from '../../../packages/engine/src/index.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = (name) => JSON.parse(readFileSync(join(WEB, 'studio', 'demo', name), 'utf8'));

// ---------- a fake WebGL2 context that records calls ----------
function fakeGl() {
  const calls = [];
  let fbo = null;
  const fns = {
    getShaderParameter: () => true,
    getProgramParameter: (_p, pname) => (pname === 'ACTIVE_UNIFORMS' ? 0 : true),
    getParameter: () => 4096,
    getUniformLocation: () => ({}),
    bindFramebuffer: (_t, f) => { fbo = f; },
  };
  const gl = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (/^[A-Z0-9_]+$/.test(prop)) return prop;   // constants are their own names
      return (...args) => {
        calls.push({ name: prop, args, shadow: fbo !== null });
        return fns[prop] ? fns[prop](...args) : {};
      };
    },
  });
  return { gl, calls };
}

function fakeRenderer() {
  const { gl, calls } = fakeGl();
  const canvas = { clientWidth: 800, clientHeight: 600, width: 0, height: 0, getContext: () => gl };
  const r = createWebGLRenderer(/** @type {any} */ (canvas));
  return { r, calls, canvas };
}

/** Counts Float32Array constructions (including Float32Array.from) of at least `min` elements. */
function countF32(min, fn) {
  const F = globalThis.Float32Array;
  let n = 0;
  globalThis.Float32Array = new Proxy(F, {
    construct(t, args, nt) {
      const a = Reflect.construct(t, args, nt);
      if (a.length >= min && !(args[0] instanceof ArrayBuffer)) n++;   // a view over a buffer is not an allocation
      return a;
    },
  });
  try { fn(); } finally { globalThis.Float32Array = F; }
  return n;
}

const uploads = (calls) => calls.filter((c) => c.name === 'bufferSubData' || c.name === 'bufferData');

test('a frame where only the camera moved uploads nothing and re-uses the shadow map', () => {
  const world = new stub.World(stub.loadDocument(demo('v-fold-popup.fold')), { seed: 1 });
  world.setControl('open', 90);
  const mesh = world.render();
  const { r, calls } = fakeRenderer();
  r.draw(mesh, null, true);
  assert.equal(r.stats.meshUploads, 1);
  assert.equal(r.stats.shadowPasses, 1);
  calls.length = 0;
  r.camera.orbit(0.3, 0.1);
  r.draw(mesh, null, false);
  assert.deepEqual(uploads(calls).map((c) => c.name), [], 'no buffer upload when the pose did not change');
  assert.equal(calls.filter((c) => c.shadow && c.name === 'drawElements').length, 0, 'no shadow pass');
  assert.equal(r.stats.meshUploads, 1);
  assert.equal(r.stats.shadowPasses, 1);
  assert.ok(calls.some((c) => c.name === 'drawElements' && c.args[0] === 'TRIANGLES'), 'the paper is still drawn');
});

test('a moving pose refreshes positions and normals in place: no reallocation, no mesh-sized allocation', () => {
  const world = new stub.World(stub.loadDocument(demo('v-fold-popup.fold')), { seed: 1 });
  const { r, calls } = fakeRenderer();
  world.setControl('open', 10);
  r.draw(world.render(), null, true);
  const nv = world.render().positions.length / 3;
  let allocs = 0;
  for (let k = 0; k < 20; k++) {
    world.setControl('open', 20 + k * 5);
    world.step(1 / 60);
    const mesh = world.render();
    calls.length = 0;
    allocs += countF32(nv, () => r.draw(mesh, null, true));
    const up = uploads(calls);
    assert.equal(up.filter((c) => c.name === 'bufferData').length, 0, 'buffers are allocated once per mesh size');
    assert.equal(up.filter((c) => c.args[2].length >= nv * 3).length, 2, 'positions and normals only (UVs, sheet ids and indices keep their topology)');
    assert.equal(up.filter((c) => c.args[2].length < nv).length, 1, 'and the ground quad');
    assert.equal(calls.filter((c) => c.shadow && c.name === 'drawElements').length, 1, 'one shadow pass');
    assert.equal(calls.filter((c) => !c.shadow && c.name === 'drawElements' && c.args[0] === 'TRIANGLES').length, 1, 'one draw call for all the paper');
  }
  assert.equal(allocs, 0, 'no mesh-sized Float32Array per frame');
  assert.equal(r.stats.meshUploads, 21);
});

test('every sheet up to MAX_SHEETS gets its own colours (an ofrenda has 20 sheets)', () => {
  assert.ok(MAX_SHEETS >= 32);
  const { r, calls } = fakeRenderer();
  const sheets = Array.from({ length: 20 }, (_, i) => ({ front: `#${(0x102030 + i * 0x050403).toString(16)}`, back: '#ffffff', size: [100, 100], grainDeg: 90, artwork: [], annotations: [] }));
  r.setSheets(sheets);
  const world = new stub.World(stub.loadDocument(demo('pliego-half-fold.fold')), { seed: 1 });
  r.draw(world.render(), null, true);
  const front = calls.filter((c) => c.name === 'uniform3fv' && c.args[1].length === MAX_SHEETS * 3)[0].args[1];
  const want = hexToLinear(sheets[17].front);
  assert.deepEqual(Array.from(front.subarray(17 * 3, 18 * 3)).map((x) => +x.toFixed(5)), want.map((x) => +Math.fround(x).toFixed(5)));
});

test('paper edges: the outline of a sheet split along a fold, without the fold seam', () => {
  // a unit square as two triangles that do not share render vertices along the diagonal (the
  // renderer splits vertices at hinges), same sheet, same UVs at the shared corners
  const uvs = [0, 0, 1, 0, 1, 1, /* second triangle */ 0, 0, 1, 1, 0, 1];
  const sheet = [0, 0, 0, 0, 0, 0];
  const idx = [0, 1, 2, 3, 4, 5];
  const e = outlineEdges(uvs, sheet, idx);
  assert.equal(e.length / 2, 4, 'four outline edges');
  const key = (a, b) => [uvs[2 * a], uvs[2 * a + 1], uvs[2 * b], uvs[2 * b + 1]].join(',');
  const keys = [];
  for (let i = 0; i < e.length; i += 2) keys.push(key(e[i], e[i + 1]));
  assert.ok(!keys.includes('1,1,0,0') && !keys.includes('0,0,1,1'), 'the diagonal is a fold, not an edge');
  // a second sheet at the same UVs is a separate piece of paper
  assert.equal(outlineEdges([...uvs, ...uvs], [...sheet, 1, 1, 1, 1, 1, 1], [...idx, ...idx.map((i) => i + 6)]).length / 2, 8);
});

test('backing store: pixel ratio capped on touch devices and by a pixel budget', () => {
  assert.deepEqual(backingSize(400, 300, 3, true), [400 * DPR_CAP_COARSE, 300 * DPR_CAP_COARSE]);
  assert.deepEqual(backingSize(400, 300, 3, false), [800, 600]);
  assert.deepEqual(backingSize(400, 300, 1, true), [400, 300]);
  const [w, h] = backingSize(2400, 1400, 2, false);
  assert.ok(w * h <= PIXEL_BUDGET_FINE * 1.01 && w / h > 1.7 && w / h < 1.73);
  assert.deepEqual(backingSize(0, 0, 2, false), [1, 1]);
});

test('fixed steps: coarsened 60 Hz timestamps still give one step per frame', () => {
  let acc = 0, steps = 0;
  for (let i = 0; i < 120; i++) {
    const p = planSteps(acc, (i % 2 ? 16.7 : 16.6) / 1000, 1 / 60, 1);
    acc = p.acc; steps += p.n;
  }
  // 120 frames averaging 16.65 ms are 119.9 steps of sim time; the old rule (step once the frame
  // reached a whole 16.667 ms, then drop the rest) took one step every other frame here
  assert.ok(steps >= 119, `steps ${steps}`);
  // a slow frame drops its backlog instead of running extra steps later
  const slow = planSteps(0, 0.2, 1 / 60, 1);
  assert.equal(slow.n, 1);
  assert.ok(slow.acc <= 0);
  assert.equal(planSteps(0, 0.2, 1 / 60, 4).n, 4);
  // a Worker step in flight: nothing now, one step when it has arrived
  const busy = planSteps(0, 0.05, 1 / 60, 0);
  assert.equal(busy.n, 0);
  assert.equal(planSteps(busy.acc, 1 / 60, 1 / 60, 1).n, 1);
});

test('change tracking and when the loop sleeps', () => {
  const t = createChangeTracker();
  const P = new Float32Array([0, 0, 0, 1, 0, 0]), I = new Uint32Array([0, 1, 0]);
  assert.equal(t.changed({ positions: P, indices: I }), true);
  assert.equal(t.changed({ positions: P, indices: I }), false);
  P[4] = 1e-6;
  assert.equal(t.changed({ positions: P, indices: I }), true);
  assert.equal(t.changed({ positions: P, indices: I.subarray(0, 3) }), true, 'new topology');
  t.reset();
  assert.equal(t.changed({ positions: P, indices: I }), true);
  const base = { playing: false, redraw: false, grabbing: false, pending: false, quietFrames: 0, engine: /** @type {const} */ ('stub'), hidden: false };
  assert.equal(keepRunning({ ...base, quietFrames: 2 }), false, 'the preview sleeps two frames after it stops moving');
  assert.equal(keepRunning({ ...base, engine: 'engine', quietFrames: QUIET_FRAMES_ENGINE - 1 }), true);
  assert.equal(keepRunning({ ...base, engine: 'engine', quietFrames: QUIET_FRAMES_ENGINE }), false);
  assert.equal(keepRunning({ ...base, quietFrames: 99, playing: true }), true);
  assert.equal(keepRunning({ ...base, quietFrames: 0, pending: true }), false, 'a Worker step in flight kicks the loop when it lands: no polling');
  assert.equal(keepRunning({ ...base, pending: true, redraw: true }), true);
  assert.equal(keepRunning({ ...base, playing: true, hidden: true }), false, 'a hidden tab never asks for frames');
});

// ---------- the engine in a Worker ----------
/** A Worker stand-in: messages are structured-cloned with their transfer lists, asynchronously. */
function fakeWorker() {
  const listeners = { message: new Set(), error: new Set() };
  const host = createEngineHost((msg, transfer) => {
    const data = structuredClone(msg, { transfer: transfer || [] });
    setImmediate(() => { for (const fn of listeners.message) fn({ data }); });
  }, async () => engine);
  let queue = Promise.resolve();
  return {
    postMessage(msg, transfer) {
      const data = structuredClone(msg, { transfer: transfer || [] });
      queue = queue.then(() => host.handle(data));
    },
    addEventListener(type, fn) { listeners[type].add(fn); },
    removeEventListener(type, fn) { listeners[type].delete(fn); },
  };
}

const settle = (w) => new Promise((res) => { const tick = () => (w.pending ? setImmediate(tick) : res()); tick(); });

test('the engine in a Worker replays bit-identically to the main thread, with pooled pose buffers', async () => {
  const json = demo('pliego-half-fold.fold');
  const opts = engineOptions(json);
  const controls = (json['pliego:controls'] || []).map((c) => [c.id, c.default]);
  // main thread
  const local = new engine.World(engine.loadDocument(json), opts);
  for (const [id, v] of controls) local.setControl(id, v);
  probeStep(local, 1 / 60, () => 0);
  // Worker
  const remote = await WorkerWorld.create(fakeWorker(), { engineUrl: 'unused', json, opts, controls, probe: true });
  assert.ok(Number.isFinite(remote.probeMs));
  assert.deepEqual(Array.from(remote.render().positions), Array.from(local.render().positions), 'same pose after the probe');
  for (let k = 0; k < 40; k++) {
    if (k === 5) { local.setControl('fold', 1); remote.setControl('fold', 1); }
    local.step(1 / 60);
    assert.equal(remote.step(1 / 60), 1);
    assert.equal(remote.step(1 / 60), 0, 'one step in flight at most');
    remote.creaseLines();
    await settle(remote);
  }
  assert.deepEqual(Array.from(remote.render().positions), Array.from(local.render().positions), 'bit-identical after 40 steps and a control change');
  assert.deepEqual(Array.from(remote.render().normals), Array.from(local.render().normals));
  assert.ok(remote.stats().maxStrain >= 0);
  const lines = remote.creaseLines();
  assert.deepEqual(Array.from(lines.positions), Array.from(local.creaseLines().positions));
  remote.dispose();
});

test('the Worker host re-uses returned buffers instead of allocating a pose per step', async () => {
  const json = demo('pliego-half-fold.fold');
  const posted = [];
  const host = createEngineHost((m) => posted.push(m), async () => engine);
  await host.handle({ type: 'init', gen: 7, engineUrl: '', json, opts: engineOptions(json), controls: [['fold', 1]], probe: false });
  assert.equal(posted[0].type, 'ready');
  const n = posted[0].frame.positions.length;
  let recycle = [posted[0].frame.positions.buffer, posted[0].frame.normals.buffer, posted[0].frame.lines.buffer];
  let allocs = 0;
  for (let k = 0; k < 10; k++) {
    allocs += await (async () => {
      const F = globalThis.Float32Array; let c = 0;
      globalThis.Float32Array = new Proxy(F, { construct(t, a, nt) { const x = Reflect.construct(t, a, nt); if (x.length >= n && !(a[0] instanceof ArrayBuffer)) c++; return x; } });
      try { await host.handle({ type: 'step', gen: 7, dt: 1 / 60, stats: false, lines: true, recycle }); } finally { globalThis.Float32Array = F; }
      return c;
    })();
    const f = posted[posted.length - 1].frame;
    recycle = [f.positions.buffer, f.normals.buffer, f.lines.buffer];
  }
  assert.equal(allocs, 0, 'every pose buffer came back from the pool');
  await host.handle({ type: 'step', gen: 6, dt: 1 / 60, stats: false, lines: false, recycle: [] });
  assert.equal(posted[posted.length - 1].type, 'frame');
  assert.equal(posted.length, 11, 'a message for an older document is dropped');
});

test('a Worker that cannot start the engine rejects, so the studio falls back to the main thread', async () => {
  const listeners = new Set();
  const host = createEngineHost((m) => setImmediate(() => listeners.forEach((fn) => fn({ data: m }))), async () => { throw new Error('blocked by CSP'); });
  const worker = { postMessage: (m) => host.handle(m), addEventListener: (_t, fn) => listeners.add(fn), removeEventListener: (_t, fn) => listeners.delete(fn) };
  await assert.rejects(WorkerWorld.create(worker, { engineUrl: '', json: demo('pliego-half-fold.fold'), opts: {}, controls: [], probe: false }), /blocked by CSP/);
});

test('the crease overlay works with the paper engine (creaseLines), and picking hits the render mesh', () => {
  const json = demo('v-fold-popup.fold');
  const world = new engine.World(engine.loadDocument(json), engineOptions(json));
  const ov = createEngineOverlay(world);
  assert.ok(ov && ov.available());
  const built = ov.build();
  assert.ok(built.positions.length > 0 && built.positions.length === built.colors.length);
  const r = world.render();
  const b = { x: 0, z: 0, n: 0 };
  for (let i = 0; i < r.positions.length; i += 3) { b.x += r.positions[i]; b.z += r.positions[i + 2]; b.n++; }
  const hit = pickRenderMesh(r, [b.x / b.n, 500, b.z / b.n], [0, -1, 0]);
  assert.ok(hit && hit.point[1] < 500);
  assert.equal(createEngineOverlay(new stub.World(stub.loadDocument(json), { seed: 1 })), null, 'the stub keeps its document overlay');
});

test('a Worker engine is paced at real time when fast and stepped back to back when slow', async () => {
  const json = demo('pliego-half-fold.fold');
  const w = await WorkerWorld.create(fakeWorker(), { engineUrl: '', json, opts: engineOptions(json), controls: [['fold', 1]], probe: false });
  assert.equal(w.pump(1 / 60, 1000), 1, 'the first pump steps');
  assert.equal(w.pump(1 / 60, 1001), 0, 'never two steps in flight');
  await settle(w);
  assert.equal(w.pump(1 / 60, 1005), 0, 'a fast step waits for the next 1/60 s');
  assert.equal(w.pump(1 / 60, 1017), 1);
  await settle(w);
  assert.equal(w.pump(1 / 60, 1400), 1, 'a slow step is followed at once');
  await settle(w);
  w.resetPacing();
  assert.equal(w.pump(1 / 60, 9000), 1, 'after an idle pause the clock restarts');
  await settle(w);
  w.dispose();
});

test('drawing never reads layout once the observer handed the canvas size over', () => {
  const { gl } = fakeGl();
  let reads = 0;
  const canvas = { width: 0, height: 0, getContext: () => gl, get clientWidth() { reads++; return 640; }, get clientHeight() { reads++; return 480; } };
  const r = createWebGLRenderer(/** @type {any} */ (canvas));
  const world = new stub.World(stub.loadDocument(demo('pliego-half-fold.fold')), { seed: 1 });
  r.resize(500, 400);
  reads = 0;
  for (let k = 0; k < 5; k++) r.draw(world.render(), null, k === 0);
  assert.equal(reads, 0);
  assert.deepEqual([canvas.width, canvas.height], [500, 400], 'Node has no devicePixelRatio: 1');
});

test('playback re-highlights the crease diagram only when the step changes', () => {
  let walks = 0;
  const svg = { querySelectorAll: () => { walks++; return []; } };
  const json = demo('pliego-half-fold.fold');
  for (let f = 0; f < 60; f++) highlightStep(svg, json, f < 30 ? 0 : 1);
  assert.equal(walks, 2);
});
