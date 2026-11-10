// @ts-check
// Conservative advancement from C-IPC §5.3–5.4 / Algorithm 1 (Li, Kaufman,
// Jiang 2021, https://ipc-sim.github.io/C-IPC/file/paper_small.pdf).
// Written from the distance/speed bound, not copied from a reference codebase.
// This query alone is not a coupled solver or a whole-mesh collision guarantee.
import { pointTriangleDistanceSquared, edgeEdgeDistanceSquared } from './distance.js';
import { hypot3 } from '../fastmath.js';

function gapAt(distance, positions, thickness) {
  const squared = distance(positions, 0, 1, 2, 3);
  if (!Number.isFinite(squared)) throw new Error('ACCD: distance overflow');
  const divisor = Math.sqrt(squared) + thickness;
  return divisor > 0 ? (squared - thickness * thickness) / divisor : 0;
}

export class AdditiveCCD {
  /** @param {{safety?:number, maxIterations?:number}} [opts] */
  constructor(opts = {}) {
    this.safety = opts.safety ?? 0.1; this.maxIterations = opts.maxIterations ?? 256;
    if (!(this.safety > 0 && this.safety < 1)) throw new RangeError('ACCD: safety must be between zero and one');
    if (!(Number.isInteger(this.maxIterations) && this.maxIterations > 0)) throw new RangeError('ACCD: maxIterations must be a positive integer');
    this.start = new Float64Array(12); this.delta = new Float64Array(12); this.trial = new Float64Array(12);
    this.iterations = 0; this.status = 'clear'; this.gap = 0;
  }

  /**
   * Return a conservative step in [0,maxTime] for four linearly moving vertices.
   * Inspect status: iteration/precision limits are retained as limited progress,
   * never reported as a collision-free full step. Initially infeasible inputs
   * return zero. Vertex–triangle order is [point,a,b,c], edge–edge [a,b,c,d].
   * @param {'vertex-triangle'|'edge-edge'} kind
   * @param {ArrayLike<number>} from @param {ArrayLike<number>} to
   * @param {number} a @param {number} b @param {number} c @param {number} d
   * @param {number} thickness @param {number} [maxTime]
   */
  query(kind, from, to, a, b, c, d, thickness, maxTime = 1) {
    if (kind !== 'vertex-triangle' && kind !== 'edge-edge') throw new TypeError('ACCD: unknown primitive pair');
    if (!(Number.isFinite(thickness) && thickness >= 0 && Number.isFinite(maxTime) && maxTime >= 0 && maxTime <= 1)) throw new RangeError('ACCD: invalid thickness or interval');
    const distance = kind === 'vertex-triangle' ? pointTriangleDistanceSquared : edgeEdgeDistanceSquared;
    const x = this.start, p = this.delta, trial = this.trial;
    this.iterations = 0; this.status = 'clear'; this.gap = 0;
    let scale = Math.max(1, thickness);
    for (let v = 0; v < 4; v++) {
      const id = v === 0 ? a : v === 1 ? b : v === 2 ? c : d;
      if (!(Number.isInteger(id) && id >= 0)) throw new RangeError('ACCD: invalid vertex');
      for (let k = 0; k < 3; k++) {
        const i = 3 * id + k, j = 3 * v + k;
        if (!Number.isFinite(from[i]) || !Number.isFinite(to[i])) throw new RangeError('ACCD: non-finite position or invalid vertex');
        x[j] = from[i] - from[3 * a + k]; p[j] = to[i] - from[i];
        scale = Math.max(scale, Math.abs(x[j]), Math.abs(from[i]), Math.abs(to[i]));
      }
    }
    // Common translation cannot change distances; remove it from the speed bound.
    for (let k = 0; k < 3; k++) {
      const mean = p[k] / 4 + p[k + 3] / 4 + p[k + 6] / 4 + p[k + 9] / 4;
      for (let v = 0; v < 4; v++) p[3 * v + k] -= mean;
    }
    let firstSpeed = 0, secondSpeed = 0;
    const split = kind === 'vertex-triangle' ? 1 : 2;
    for (let v = 0; v < 4; v++) {
      const speed = hypot3(p[3 * v], p[3 * v + 1], p[3 * v + 2]);
      if (v < split) firstSpeed = Math.max(firstSpeed, speed); else secondSpeed = Math.max(secondSpeed, speed);
    }
    const speedBound = firstSpeed + secondSpeed, tolerance = 64 * Number.EPSILON * scale;
    if (!Number.isFinite(speedBound)) throw new Error('ACCD: displacement overflow');
    const initialGap = gapAt(distance, x, thickness); this.gap = initialGap;
    if (initialGap <= 0) { this.status = 'initial-overlap'; return 0; }
    if (initialGap <= tolerance) { this.status = 'precision-limit'; return 0; }
    if (speedBound === 0 || maxTime === 0) return maxTime;
    const target = this.safety * initialGap;
    let time = 0, step = (1 - this.safety) * (initialGap - tolerance) / speedBound;
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      this.iterations = iteration + 1;
      if (step >= maxTime - time) return maxTime;
      const next = time + step;
      if (!(next > time)) { this.status = 'precision-limit'; return time; }
      for (let i = 0; i < 12; i++) trial[i] = x[i] + next * p[i];
      const gap = gapAt(distance, trial, thickness); this.gap = gap;
      if (gap <= tolerance) { this.status = 'precision-limit'; return time; }
      if (time > 0 && gap < target) { this.status = 'limited'; return time; }
      time = next; step = 0.9 * (gap - tolerance) / speedBound;
    }
    this.status = 'iteration-limit'; return time;
  }
}
