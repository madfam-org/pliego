// Engine contract (docs/strategy/engine.md §5): the shape the studio relies on.
// Always runs against the stub; also runs against the real engine when PLIEGO_ENGINE_DIR (or
// apps/web/.engine-tmp/packages/engine/src) holds an index.js exporting World + loadDocument.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as stub from '../studio/src/engine-stub.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = join(WEB, 'studio', 'demo');
const docs = readdirSync(DEMO).filter((f) => f.endsWith('.fold')).map((f) => [f, JSON.parse(readFileSync(join(DEMO, f), 'utf8'))]);

const engines = [['stub', stub]];
const realDir = process.env.PLIEGO_ENGINE_DIR || join(WEB, '.engine-tmp', 'packages', 'engine', 'src');
if (existsSync(join(realDir, 'index.js'))) {
  const mod = await import(pathToFileURL(join(realDir, 'index.js')).href);
  if (typeof mod.World === 'function' && typeof mod.loadDocument === 'function') engines.push(['engine', mod]);
  else console.log(`engine-contract: ${realDir}/index.js has no World/loadDocument yet — real engine skipped`);
} else {
  console.log(`engine-contract: no real engine at ${realDir} — stub only`);
}

function script(world, d) {
  for (const c of d['pliego:controls'] || []) {
    const v = c.kind === 'toggle' ? true : (c.max ?? 1) * 0.5 + (c.min ?? 0) * 0.5;
    try { world.setControl(c.id, v); } catch (e) { throw new Error(`setControl(${c.id}) threw: ${e.message}`); }
  }
  for (let i = 0; i < 30; i++) world.step(1 / 60);
}

for (const [kind, E] of engines) {
  for (const [name, d] of docs) {
    test(`${kind}: ${name} satisfies the render contract`, () => {
      const world = new E.World(E.loadDocument(d), { seed: 1 });
      const r = world.render();
      for (const k of ['positions', 'normals', 'uvs', 'sheetIds', 'indices']) assert.ok(r[k] && typeof r[k].length === 'number', `render().${k}`);
      const n = r.positions.length / 3;
      assert.ok(Number.isInteger(n) && n >= 3);
      assert.equal(r.normals.length, n * 3);
      assert.equal(r.uvs.length, n * 2);
      assert.equal(r.sheetIds.length, n);
      assert.equal(r.indices.length % 3, 0);
      let maxIdx = 0; for (const i of r.indices) maxIdx = Math.max(maxIdx, i);
      assert.ok(maxIdx < n, 'index out of range');
      for (const s of r.sheetIds) assert.ok(s >= 0 && s < d['pliego:sheets'].length);
      for (const p of r.positions) assert.ok(Number.isFinite(p));
      assert.ok(world.positions && world.positions.length % 3 === 0, 'world.positions');
      script(world, d);
      const r2 = world.render();
      for (const p of r2.positions) assert.ok(Number.isFinite(p), 'NaN after stepping');
      const s = world.stats();
      assert.equal(typeof s.maxStrain, 'number');
      assert.equal(typeof s.contacts, 'number');
      assert.equal(typeof s.substepsRun, 'number');
      for (const fn of ['grab', 'moveGrab', 'release', 'pick', 'snapshot', 'restore', 'setControl', 'step']) assert.equal(typeof world[fn], 'function', fn);
      const hit = world.pick([0, 2000, 0.5], [0, -1, 0]);
      if (hit) { for (const k of ['vertex', 'triangle', 'point', 'sheet']) assert.ok(k in hit, `pick().${k}`); }
    });

    test(`${kind}: ${name} replays deterministically`, () => {
      const run = () => { const w = new E.World(E.loadDocument(d), { seed: 1 }); script(w, d); return Buffer.from(Float64Array.from(w.positions).buffer); };
      assert.equal(Buffer.compare(run(), run()), 0);
    });
  }

  test(`${kind}: loadDocument fails closed on a broken document`, () => {
    const bad = JSON.parse(JSON.stringify(docs[0][1]));
    bad.edges_vertices[0] = [0, 99999];
    assert.throws(() => E.loadDocument(bad));
  });
}

// ---------- stub behaviour (what the studio shows without the engine) ----------
const byName = Object.fromEntries(docs);
const maxY = (w) => { const p = w.render().positions; let m = -Infinity; for (let i = 1; i < p.length; i += 3) m = Math.max(m, p[i]); return m; };
const minX = (w) => { const p = w.render().positions; let m = Infinity; for (let i = 0; i < p.length; i += 3) m = Math.min(m, p[i]); return m; };

test('stub: a valley fold lifts the moving half toward the front (+Y)', () => {
  const d = byName['pliego-half-fold.fold'];
  const w = new stub.World(stub.loadDocument(d));
  assert.ok(maxY(w) < 1e-6);
  w.setControl('fold', 1); w.step(1 / 60);                  // end of step 1: 90° valley
  assert.ok(Math.abs(maxY(w) - 100) < 1e-6, `half stands 100 mm tall (got ${maxY(w)})`);
  w.setControl('fold', 2); w.step(1 / 60);                  // folded flat: 180° (drawn at FLAT_MAX)
  assert.ok(maxY(w) > 0 && maxY(w) < 1, `folded half lies a hair above the left half (got ${maxY(w)})`);
  assert.ok(Math.abs(minX(w) - -100) < 0.01, 'folded half lies on top of the left half');
});

test('stub: released creases keep a plastic memory (fold, open, let go)', () => {
  const maxX = (w) => { const p = w.render().positions; let m = -Infinity; for (let i = 0; i < p.length; i += 3) m = Math.max(m, p[i]); return m; };
  const program = (steps) => {
    const d = JSON.parse(JSON.stringify(byName['pliego-half-fold.fold']));
    d['pliego:sequence'].steps = steps.map(([targets, release], k) => ({ id: `s${k}`, label: { en: `s${k}` }, duration_ms: 1000, targets, release, note: null }));
    d['pliego:controls'][0].max = steps.length;
    const w = new stub.World(stub.loadDocument(d));
    w.setControl('fold', steps.length); w.step(1 / 60);
    return w;
  };
  const sin = (deg) => Math.sin(deg * Math.PI / 180), cos = (deg) => Math.cos(deg * Math.PI / 180);
  const TOL = 1e-4;   // render positions are Float32
  // folded flat and let go: springs back by the yield angle (35° for kami) and rests at 145°
  const a = program([[[[6, 180]], []], [[], [6]]]);
  assert.ok(Math.abs(maxY(a) - 100 * sin(145)) < TOL, `rests at 145° (maxY ${maxY(a)})`);
  // folded flat, opened out by hand, let go: the crease keeps a 35° tent instead of lying flat
  const b = program([[[[6, 180]], []], [[[6, 0]], []], [[], [6]]]);
  assert.ok(Math.abs(maxY(b) - 100 * sin(35)) < TOL && Math.abs(maxX(b) - 100 * cos(35)) < TOL, `tents at 35° (maxY ${maxY(b)})`);
  // within the yield angle nothing sets: a 30° fold let go returns flat
  const c = program([[[[6, 30]], []], [[], [6]]]);
  assert.ok(Math.abs(maxY(c)) < TOL, `returns flat (maxY ${maxY(c)})`);
});

test('stub: the leaf turns from right (0°) to left (180°)', () => {
  const d = byName['page-turn.fold'];
  const w = new stub.World(stub.loadDocument(d));
  assert.ok(minX(w) >= -140 - 1e-6);
  w.setControl('turn', 90); w.step(1 / 60);
  assert.ok(maxY(w) > 130, 'leaf stands up at 90°');
  w.setControl('turn', 180); w.step(1 / 60);
  const p = w.render().positions, ids = w.render().sheetIds;
  let leafMaxX = -Infinity; for (let i = 0; i < ids.length; i++) if (ids[i] === 1) leafMaxX = Math.max(leafMaxX, p[i * 3]);
  assert.ok(leafMaxX < 1e-6, `turned leaf lies left of the spine (max x ${leafMaxX})`);
});

test('stub: V-fold initial frame is reproduced and the hinge moves the right board', () => {
  const d = byName['v-fold-popup.fold'];
  const w = new stub.World(stub.loadDocument(d));
  const I = d.file_frames[0].vertices_coords;
  let err = 0; I.forEach((p, v) => { for (let k = 0; k < 3; k++) err = Math.max(err, Math.abs(p[k] - w.positions[v * 3 + k])); });
  assert.ok(err < 1e-5, `initial frame error ${err}`);
  w.setControl('open', 90); w.step(1 / 60);
  const right = d['pliego:vertices_sheet'].map((s, v) => [s, v]).filter(([s]) => s === 1).map(([, v]) => v);
  const xs = right.map((v) => w.positions[v * 3]), ys = right.map((v) => w.positions[v * 3 + 1]);
  assert.ok(Math.max(...xs.map(Math.abs)) < 1e-6, 'right board is vertical at open = 90°');
  assert.ok(Math.max(...ys) > 99, 'and stands up');
});

test('stub: translate mechanism moves its sheets by control/max × travel', () => {
  const d = JSON.parse(JSON.stringify(byName['page-turn.fold']));
  d['pliego:mechanisms'].push({ id: 'pull', type: 'translate', control: 'pull', direction: [1, 0, 0], travel: 40, sheets_moving: ['spread'] });
  d['pliego:controls'].push({ id: 'pull', kind: 'distance', label: { en: 'Pull' }, min: 0, max: 20, default: 0, unit: 'mm' });
  const w = new stub.World(stub.loadDocument(d));
  const x0 = w.positions[0];
  w.setControl('pull', 10); w.step(1 / 60);
  assert.ok(Math.abs(w.positions[0] - x0 - 20) < 1e-9);
});
