// Emit deterministic component queries for an independent native reference.
// No material/solver validation or performance claim follows from agreement.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mulberry32 } from '../src/geom.js';
import { pointTriangleDistanceSquared, edgeEdgeDistanceSquared } from '../src/collision/distance.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const random = mulberry32(734);
const cases = [];
function add(id, kind, coordinates) {
  const x = new Float64Array(coordinates), distance = kind === 'vertex-triangle' ? pointTriangleDistanceSquared : edgeEdgeDistanceSquared;
  const weights = new Float64Array(4), squared = distance(x, 0, 1, 2, 3, weights);
  let scaleSquared = 0;
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    let length = 0; for (let k = 0; k < 3; k++) length += (x[3 * a + k] - x[3 * b + k]) ** 2;
    scaleSquared = Math.max(scaleSquared, length);
  }
  cases.push({ id, kind, coordinates: [...x], squared, weights: [...weights], scaleSquared });
}
for (let n = 0; n < 2000; n++) {
  const kind = n % 2 ? 'vertex-triangle' : 'edge-edge';
  const x = Array.from({ length: 12 }, () => 200 * random() - 100);
  add(`random-${n}`, kind, x);
  if (n < 100) for (const scale of [1e-6, 1e6]) add(`scaled-${n}-${scale}`, kind, x.map(v => v * scale));
}
for (const delta of [1e-4, 1e-8, 1e-12, 1e-16]) {
  add(`near-parallel-crossing-${delta}`, 'edge-edge', [0, 0, 0, 1, 0, 0, 0.1, -delta / 2, 0, 1.1, delta / 2, 0]);
  add(`near-parallel-separated-${delta}`, 'edge-edge', [0, 0, 0, 1, 0, 0, 0.1, -delta / 2, 0.05, 1.1, delta / 2, 0.05]);
  add(`sliver-${delta}`, 'vertex-triangle', [0.5, 0.05, delta / 4, 0, 0, 0, 1, 0, 0, 1, 0, delta]);
}
add('pinned-corner-extension', 'vertex-triangle', [-0.0001, 0.05, -0.0001, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
add('collapsed-triangle', 'vertex-triangle', [0, 0.5, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0]);
add('point-triangle', 'vertex-triangle', [0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
add('collapsed-edges', 'edge-edge', [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0]);
const report = {
  schema: 'pliego-contact-distance-input/0.1', seed: 734,
  source: { git: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    generatorSHA256: hash(readFileSync(new URL(import.meta.url))),
    distanceSHA256: hash(readFileSync(new URL('../src/collision/distance.js', import.meta.url))),
    randomSHA256: hash(readFileSync(new URL('../src/geom.js', import.meta.url))), node: process.version },
  cases,
};
const out = JSON.stringify(report) + '\n', i = process.argv.indexOf('--out');
if (i >= 0) writeFileSync(process.argv[i + 1], out); else process.stdout.write(out);
console.error(`contact-distance-input: cases=${cases.length}, random=2000, scaled=200, features=16`);
