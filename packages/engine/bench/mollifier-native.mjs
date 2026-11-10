// Adapter for independent compiled-reference comparison, not a physics benchmark.
import { readFileSync } from 'node:fs';
import { edgeEdgeMollifier } from '../src/collision/edge-mollifier.js';
const cases = JSON.parse(readFileSync(0, 'utf8')), ids = new Int32Array([0, 1, 2, 3]);
const values = new Float64Array(3), gradient = new Float64Array(12), J = new Float64Array(36);
const result = cases.map(({ points, threshold }) => {
  edgeEdgeMollifier(points.flat(), ids, threshold, values, gradient, J);
  return { multiplier: values[0], gradient: Array.from(gradient) };
});
process.stdout.write(JSON.stringify(result) + '\n');
console.error(`native-mollifier-adapter: cases=${cases.length}; scalar and Cartesian gradient evaluated`);
