// @ts-check
/**
 * Keyed mechanisms (spec §5.18, backlog item 16b): a table maps the control value to a mechanism's
 * angle or travel, linear between keys, optionally periodic; `ride` carries one mechanism on
 * another. Each test runs the engine AND the studio's preview stub on the same document.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, loadDocument, locatePoint } from '../src/index.js';
import { keyedOutput } from '../src/keyed.js';
import * as stub from '../../../apps/web/studio/src/engine-stub.js';
import { fourBar, fourBarPose, eccentricCam } from './helpers/linkages.js';
import { proof } from './helpers/bench.js';

/** Engine world position of a sheet-local point (barycentric on the mesh). @param {World} w @param {string} sid @param {number[]} p */
function engineAt(w, sid, p) {
  const s = /** @type {number} */(w.doc.sheetIndex.get(sid));
  const r = /** @type {any} */(locatePoint(w.mesh, s, p[0], p[1]));
  return [0, 1, 2].map((c) => r.w[0] * w.x[3 * r.verts[0] + c] + r.w[1] * w.x[3 * r.verts[1] + c] + r.w[2] * w.x[3 * r.verts[2] + c]);
}

/** Stub world position of a sheet-local point: affine map from three of the sheet's document vertices (rigid pose). */
function stubAt(/** @type {any} */ w, /** @type {any} */ json, /** @type {string} */ sid, /** @type {number[]} */ p) {
  const si = json['pliego:sheets'].findIndex((/** @type {any} */ s) => s.id === sid);
  const off = json['pliego:sheets'][si].offset;
  const vs = json['pliego:vertices_sheet'].map((/** @type {number} */ s, /** @type {number} */ i) => (s === si ? i : -1)).filter((/** @type {number} */ i) => i >= 0);
  const loc = (/** @type {number} */ i) => [json.vertices_coords[i][0] - off[0], json.vertices_coords[i][1] - off[1]];
  const [a, b, c] = [vs[0], vs[1], vs[Math.floor(vs.length / 2)]];
  const A = loc(a), B = loc(b), C = loc(c);
  const ux = B[0] - A[0], uy = B[1] - A[1], vx = C[0] - A[0], vy = C[1] - A[1], det = ux * vy - uy * vx;
  const px = p[0] - A[0], py = p[1] - A[1];
  const s = (px * vy - py * vx) / det, t = (ux * py - uy * px) / det;
  const P = w.positions;
  return [0, 1, 2].map((k) => P[3 * a + k] + s * (P[3 * b + k] - P[3 * a + k]) + t * (P[3 * c + k] - P[3 * a + k]));
}

const plan = (/** @type {number[]} */ X) => [X[0], -X[2]];
const dist2 = (/** @type {number[]} */ p, /** @type {number[]} */ q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

test('keyedOutput: linear between keys, held outside, periodic wrap closes on the first key', () => {
  const m = { keys: [[0, 0], [90, 30], [180, 0]] };
  assert.equal(keyedOutput(m, 45), 15);
  assert.equal(keyedOutput(m, -10), 0);
  assert.equal(keyedOutput(m, 400), 0);
  assert.equal(keyedOutput({}, 37), 37, 'no keys: the control value itself');
  const p = { keys: [[0, 0], [90, 30], [180, 0], [270, -30]], period: 360 };
  assert.equal(keyedOutput(p, 315), -15, 'closing segment runs back to the first key');
  assert.equal(keyedOutput(p, 450), 30, 'one turn later');
  assert.equal(keyedOutput(p, -90), -30, 'negative values wrap');
});

test('keyed four-bar: the coupler stays connected to the rocker at every crank angle (engine and preview)', () => {
  const fb = fourBar({ keyed: true, step: 5 });
  const w = new World(fb.doc, { meshEdge: 6, gravity: false, mechanismRate: 1e6 });
  const sw = new stub.World(stub.loadDocument(fb.doc), { seed: 1 });
  let worstKey = 0, worstMid = 0, worstStub = 0, worstPose = 0;
  for (let v = 0; v <= 720; v += 2.5) {
    w.setControl('crank', v % 360 === 0 && v > 0 ? 360 : v % 360); w.step();
    sw.setControl('crank', v % 360); sw.step();
    const gap = dist2(plan(engineAt(w, ...fb.pins.couplerC)), plan(engineAt(w, ...fb.pins.rockerC)));
    const gapB = dist2(plan(engineAt(w, ...fb.pins.couplerB)), plan(engineAt(w, ...fb.pins.crankB)));
    if (v % 5 === 0) worstKey = Math.max(worstKey, gap, gapB); else worstMid = Math.max(worstMid, gap, gapB);
    const sg = dist2(plan(stubAt(sw, fb.doc, ...fb.pins.couplerC)), plan(stubAt(sw, fb.doc, ...fb.pins.rockerC)));
    worstStub = Math.max(worstStub, sg, dist2(plan(stubAt(sw, fb.doc, ...fb.pins.couplerB)), plan(stubAt(sw, fb.doc, ...fb.pins.crankB))));
    // the rocker pin sits where the closed-form four-bar puts C
    const { C } = fourBarPose(fb.theta0 + (v % 360));
    worstPose = Math.max(worstPose, dist2(plan(engineAt(w, ...fb.pins.rockerC)), [C[0] + fb.ox, C[1] + fb.oy]));
  }
  // baseline: the same linkage with only the crank driven separates at once
  const lin = fourBar({ keyed: false });
  const sl = new stub.World(stub.loadDocument(lin.doc), { seed: 1 });
  sl.setControl('crank', 90); sl.step();
  const unkeyed = dist2(plan(stubAt(sl, lin.doc, ...lin.pins.couplerB)), plan(stubAt(sl, lin.doc, ...lin.pins.crankB)));
  const pass = worstKey < 1e-6 && worstMid < 0.05 && worstStub < 0.05 && worstPose < 0.05;
  proof('keyed-four-bar', worstKey, 0, '<1e-6 mm at keys, <0.05 mm between 5° keys (engine and preview)', pass,
    `between keys ${worstMid.toExponential(2)} mm, preview ${worstStub.toExponential(2)} mm, rocker pin vs closed form ${worstPose.toExponential(2)} mm; unkeyed coupler leaves its crank pin by ${unkeyed.toFixed(1)} mm`);
  assert.ok(pass);
  assert.ok(unkeyed > 5, 'the unkeyed baseline separates (the test can fail)');
});

test('keyed cam follower tracks an eccentric cam over two turns (engine and preview)', () => {
  const cam = eccentricCam({ keyed: true, step: 5 });
  const w = new World(cam.doc, { meshEdge: 6, gravity: false, mechanismRate: 1e6 });
  const sw = new stub.World(stub.loadDocument(cam.doc), { seed: 1 });
  let worst = 0, worstStub = 0;
  for (let v = 0; v <= 720; v += 3) {
    w.setControl('crank', v); w.step();
    sw.setControl('crank', v); sw.step();
    // reach of the cam along +x (exact circle) vs the follower's foot
    const c = plan(engineAt(w, ...cam.camCentre)), f = plan(engineAt(w, ...cam.foot));
    worst = Math.max(worst, Math.abs(f[0] - (c[0] + cam.R)), Math.abs(f[1] - cam.cy));
    const cs = plan(stubAt(sw, cam.doc, ...cam.camCentre)), fs = plan(stubAt(sw, cam.doc, ...cam.foot));
    worstStub = Math.max(worstStub, Math.abs(fs[0] - (cs[0] + cam.R)), Math.abs(fs[1] - cam.cy));
  }
  // a linear follower on the same control loses the cam
  const lin = eccentricCam({ keyed: false });
  const sl = new stub.World(stub.loadDocument(lin.doc), { seed: 1 });
  sl.setControl('crank', 180); sl.step();
  const off = Math.abs(plan(stubAt(sl, lin.doc, ...lin.foot))[0] - (plan(stubAt(sl, lin.doc, ...lin.camCentre))[0] + lin.R));
  const tol = cam.e * (1 - Math.cos((2.5 * Math.PI) / 180)) + 1e-9; // chord error of 5° keys
  const pass = worst <= tol && worstStub <= tol;
  proof('keyed-cam-follower', worst, 0, `≤ ${tol.toExponential(2)} mm (5° keys, e = ${cam.e} mm)`, pass, `preview ${worstStub.toExponential(2)} mm; a linear follower is ${off.toFixed(1)} mm off the cam at 180°`);
  assert.ok(pass);
  assert.ok(off > 5);
});

test('rule 19: malformed keys, periods and rides fail closed', () => {
  const bad = (/** @type {(d: any) => void} */ edit) => { const d = fourBar({ keyed: true }).doc; edit(d); return () => loadDocument(d); };
  const turn = (/** @type {any} */ d, /** @type {string} */ id) => d['pliego:mechanisms'].find((/** @type {any} */ m) => m.id === id);
  assert.throws(bad((d) => { turn(d, 'turn-rocker').keys = [[0, 0]]; }), /rule 19.*≥ 2/);
  assert.throws(bad((d) => { turn(d, 'turn-rocker').keys = [[0, 0], [0, 1]]; }), /increase strictly/);
  assert.throws(bad((d) => { turn(d, 'turn-rocker').period = -1; }), /period must be > 0/);
  assert.throws(bad((d) => { turn(d, 'turn-rocker').period = 90; }), /span more than one period/);
  assert.throws(bad((d) => { turn(d, 'turn-crank').ride = 'turn-coupler'; }), /cycle/);
  assert.throws(bad((d) => { turn(d, 'turn-rocker').ride = 'nope'; }), /not a hinge, rotate or translate/);
  const cam = eccentricCam({ keyed: true }).doc;
  cam['pliego:mechanisms'][1].keys[3][1] = 50;
  assert.throws(() => loadDocument(cam), /outside \[-20, 20\]/);
});
