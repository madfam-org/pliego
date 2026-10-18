// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { hypot2, hypot3, hypot4 } from '../src/fastmath.js';
import { mulberry32 } from '../src/geom.js';
import { proof } from './helpers/bench.js';

test('fastmath: hypot2/3/4 return Math.hypot\'s double, bit for bit', () => {
  const rnd = mulberry32(20261018);
  // magnitudes from 1e-20 to 1e20, mesh-like coordinate differences, zeros of both signs, subnormals
  const draw = () => {
    const k = rnd();
    if (k < 0.02) return 0;
    if (k < 0.03) return -0;
    if (k < 0.035) return 5e-324 * Math.floor(1 + rnd() * 1000);
    if (k < 0.5) return (rnd() - 0.5) * 40;
    return (rnd() - 0.5) * 10 ** Math.floor(rnd() * 40 - 20);
  };
  let n = 0, bad = 0;
  /** @param {number} a @param {number} b */
  const same = (a, b) => { n++; if (!Object.is(a, b)) bad++; };
  for (let i = 0; i < 200000; i++) {
    const x = draw(), y = draw(), z = draw(), w = draw();
    same(hypot2(x, y), Math.hypot(x, y));
    same(hypot3(x, y, z), Math.hypot(x, y, z));
    same(hypot4(x, y, z, w), Math.hypot(x, y, z, w));
  }
  const special = [NaN, Infinity, -Infinity, 0, -0, 1, 1e308, 5e-324];
  for (const x of special) for (const y of special) for (const z of special) {
    same(hypot2(x, y), Math.hypot(x, y));
    same(hypot3(x, y, z), Math.hypot(x, y, z));
    same(hypot4(x, y, z, 1), Math.hypot(x, y, z, 1));
  }
  proof('fastmath-hypot', bad, 0, `0 differing doubles of ${n}`, bad === 0, `Node ${process.version}`);
  assert.equal(bad, 0);
});
