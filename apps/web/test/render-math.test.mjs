// Renderer math: mat4 / quat / camera / scene helpers (no WebGL needed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mat4, quat, vec3, hexToLinear, DEG } from '../studio/src/render/math.js';
import { OrbitCamera, rayPlane } from '../studio/src/render/camera.js';
import { computeBounds, computeNormals, lightViewProj, normalsMissing } from '../studio/src/render/scene.js';

const near = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;
const vnear = (a, b, eps = 1e-5) => a.every((x, i) => near(x, b[i], eps));

test('mat4 multiply / invert', () => {
  const I = mat4.create();
  const P = mat4.perspective(50 * DEG, 1.5, 0.5, 900);
  const V = mat4.lookAt([120, 80, 200], [0, 10, 0], [0, 1, 0]);
  const M = mat4.multiply(P, V);
  assert.ok(vnear(Array.from(mat4.multiply(I, M)), Array.from(M)));
  const inv = mat4.invert(M);
  assert.ok(inv);
  assert.ok(vnear(Array.from(mat4.multiply(M, inv)), Array.from(I), 1e-4));
  assert.equal(mat4.invert(new Float32Array(16)), null);
  // multiply must be safe when out aliases an input
  const A = mat4.lookAt([1, 2, 3], [0, 0, 0], [0, 1, 0]);
  const expected = Array.from(mat4.multiply(P, A));
  assert.ok(vnear(Array.from(mat4.multiply(P, A, A)), expected));
});

test('perspective maps near/far planes to NDC −1/+1', () => {
  const P = mat4.perspective(60 * DEG, 1, 2, 100);
  assert.ok(near(mat4.transformPoint(P, [0, 0, -2])[2], -1, 1e-5));
  assert.ok(near(mat4.transformPoint(P, [0, 0, -100])[2], 1, 1e-4));
});

test('lookAt puts the eye at the origin, target on −Z', () => {
  const eye = [30, 40, 50], target = [5, -2, 7];
  const V = mat4.lookAt(eye, target, [0, 1, 0]);
  assert.ok(vnear(mat4.transformPoint(V, eye), [0, 0, 0], 1e-4));
  const t = mat4.transformPoint(V, target);
  assert.ok(near(t[0], 0, 1e-4) && near(t[1], 0, 1e-4) && t[2] < 0);
  assert.ok(near(-t[2], vec3.length(vec3.sub(eye, target)), 1e-3));
});

test('ortho maps the box corners to the NDC cube', () => {
  const O = mat4.ortho(-10, 10, -5, 5, 1, 21);
  assert.ok(vnear(mat4.transformPoint(O, [-10, -5, -1]), [-1, -1, -1]));
  assert.ok(vnear(mat4.transformPoint(O, [10, 5, -21]), [1, 1, 1]));
});

test('quat rotate agrees with toMat4 and composes like matrices', () => {
  const q = quat.normalize(quat.fromAxisAngle(vec3.normalize([1, 2, 3]), 0.9));
  const v = [0.3, -1.2, 2.5];
  assert.ok(vnear(quat.rotate(q, v), mat4.transformPoint(quat.toMat4(q), v)));
  const q90 = quat.fromAxisAngle([0, 0, 1], 90 * DEG);
  assert.ok(vnear(quat.rotate(q90, [1, 0, 0]), [0, 1, 0]));            // right-hand rule
  const a = quat.fromAxisAngle([0, 1, 0], 0.4), b = quat.fromAxisAngle([1, 0, 0], 0.7);
  const ab = quat.multiply(a, b);
  assert.ok(vnear(quat.rotate(ab, v), quat.rotate(a, quat.rotate(b, v))));
  assert.ok(vnear(quat.slerp(a, b, 0), a) && vnear(quat.slerp(a, b, 1), b));
  assert.ok(vnear(quat.rotate(quat.conjugate(q), quat.rotate(q, v)), v));
});

test('orbit camera: eye distance, clamped pitch, ray through centre hits the target', () => {
  const c = new OrbitCamera();
  c.fit([10, 20, 30], 100);
  c.update(16 / 9);
  assert.ok(near(vec3.length(vec3.sub(c.eye(), c.target)), c.distance, 1e-6));
  const r = c.ray(0, 0);
  const toTarget = vec3.normalize(vec3.sub(c.target, r.origin));
  assert.ok(vnear(r.dir, toTarget, 1e-4));
  c.orbit(0, 10);
  assert.ok(c.pitch <= 89 * DEG + 1e-9);
  const d0 = c.distance; c.zoom(0.5); assert.ok(near(c.distance, Math.max(d0 * 0.5, c.minDistance)));
  c.reset();
  assert.ok(near(c.distance, d0));
  const t0 = [...c.target]; c.update(1); c.pan(0.1, 0); assert.ok(!vnear(c.target, t0));
});

test('rayPlane intersects and rejects parallel / behind', () => {
  assert.deepEqual(rayPlane([0, 10, 0], [0, -1, 0], [0, 0, 0], [0, 1, 0]), [0, 0, 0]);
  assert.equal(rayPlane([0, 10, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]), null);
  assert.equal(rayPlane([0, 10, 0], [0, 1, 0], [0, 0, 0], [0, 1, 0]), null);
});

test('scene helpers: bounds, normals, light matrix', () => {
  const pos = new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, -10]);
  const b = computeBounds(pos);
  assert.ok(vnear(b.center, [5, 0, -5]));
  const n = computeNormals(pos, [0, 1, 2], new Float32Array(9));
  assert.ok(vnear(Array.from(n.subarray(0, 3)), [0, 1, 0]));                 // CCW in layout → +Y front
  assert.ok(normalsMissing(new Float32Array(9), 9) && !normalsMissing(n, 9));
  const L = lightViewProj(b);
  const p = mat4.transformPoint(L, b.center);
  assert.ok(p.every((x) => x > -1 && x < 1), 'scene centre inside the light frustum');
  assert.ok(vnear(hexToLinear('#ffffff'), [1, 1, 1]) && vnear(hexToLinear('#000000'), [0, 0, 0]));
});
