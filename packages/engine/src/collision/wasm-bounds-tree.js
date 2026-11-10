// @ts-check
// Experimental scalar binary64 refit/query backend. JS retains deterministic
// topology construction and integer hit sorting; all transfers remain measured.
import { BoundsTree } from './bounds-tree.js';
import { createBoundsKernel } from './wasm-bounds-code.js';

export class WasmBoundsTree extends BoundsTree {
  /** @param {number} count */
  constructor(count) {
    const a = allocate(count);
    super(count, a.storage);
    this.memory = a.memory; this.header = a.header;
    this.orderInput = a.order; this.flagsInput = a.flags; this.sourceInput = a.source;
    this.metrics = a.metrics;
    Object.defineProperties(this, {
      nodeTests: { get: () => a.metrics[0], set: v => { a.metrics[0] = v; } },
      rootContainmentTests: { get: () => a.metrics[1], set: v => { a.metrics[1] = v; } },
    });
    this.kernel = /** @type {{refit:()=>void,query:(...args:number[])=>number}} */(
      /** @type {unknown} */(createBoundsKernel(a.memory).exports));
  }

  /** Copy current source buffers; never cache by caller identity.
   * @param {Float64Array} boxes @param {number[]} order @param {Uint8Array} inactive
   */
  refit(boxes, order, inactive) {
    if (boxes.length !== 6 * this.count || order.length !== this.count || inactive.length !== this.count) throw new RangeError('Wasm contact: invalid refit size');
    for (let i = 0; i < order.length; i++) if (!Number.isInteger(order[i]) || order[i] < 0 || order[i] >= this.count) throw new RangeError('Wasm contact: invalid primitive rank');
    // Infinities from outward finite-input bounds remain conservative. NaN is
    // outside the supported box domain; do not silently cull or canonicalize it.
    for (let i = 0; i < boxes.length; i++) if (Number.isNaN(boxes[i])) throw new RangeError('Wasm contact: NaN bound');
    this.orderInput.set(order); this.flagsInput.set(inactive); this.sourceInput.set(boxes);
    this.order = order; this.primitiveInactive = inactive;
    // Partition exactly as JS on first use, including all signed-zero/ID ties.
    // Subsequent calls run only the Wasm refit. Cold cost includes both refits.
    if (!this.nodes && this.count) super.refit(boxes, order, inactive);
    this.header[0] = this.nodes;
    this.kernel.refit(); this.queries = 0;
  }

  /** Same inclusive predicates, stationary/after rules, visit counts and sorted
   * ranks as BoundsTree. Scalar boundary arguments avoid per-query buffer views.
   * @param {Float64Array} boxes @param {number} index @param {boolean|number} inactive @param {number} [after] @param {boolean} [stationaryBefore]
   */
  query(boxes, index, inactive, after = -1, stationaryBefore = false) {
    if (!Number.isInteger(index) || index < 0 || 6 * index + 6 > boxes.length) throw new RangeError('Wasm contact: invalid query index');
    const p = 6 * index;
    for (let k = 0; k < 6; k++) if (Number.isNaN(boxes[p + k])) throw new RangeError('Wasm contact: NaN query bound');
    this.queries++;
    const start = stationaryBefore ? 0 : Math.max(0, Math.floor(after) + 1);
    const begin = Number.isFinite(start) ? Math.min(this.count, start) : this.count;
    const raw = this.kernel.query(inactive ? 1 : 0, after, stationaryBefore ? 1 : 0, begin,
      boxes[p], boxes[p + 1], boxes[p + 2], boxes[p + 3], boxes[p + 4], boxes[p + 5]);
    const count = raw < 0 ? -raw - 1 : raw;
    if (raw >= 0 && count > 1) this.hits.subarray(0, count).sort();
    return count;
  }
}

/** Fixed Wasm32 layout. Reject unsafe address sizes before any large allocation.
 * No memory growth, hidden JS fallback, shared memory or function imports.
 * @param {number} count
 */
function allocate(count) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 0x3fffffff) throw new RangeError('Wasm contact: invalid primitive count');
  if (typeof WebAssembly === 'undefined') throw new Error('Wasm contact: WebAssembly unavailable');
  const capacity = Math.max(1, 2 * count - 1);
  /** @type {[string,number,number][]} */
  const fields = [['boxes', 8, 6 * capacity], ['left', 4, capacity], ['right', 4, capacity], ['primitive', 4, capacity],
    ['inactive', 1, capacity], ['anyInactive', 1, capacity], ['maximumRank', 4, capacity], ['rank', 4, count],
    ['stack', 4, capacity], ['hits', 4, count], ['order', 4, count], ['flags', 1, count], ['source', 8, 6 * count]];
  /** @type {Record<string,number>} */
  const offsets = {};
  let size = 80;
  for (const [name, width, length] of fields) { size = Math.ceil(size / width) * width; offsets[name] = size; size += width * length; }
  if (!Number.isSafeInteger(size) || size > 0xffffffff) throw new RangeError('Wasm contact: Wasm32 address capacity exceeded');
  const pages = Math.ceil(size / 65536), memory = new WebAssembly.Memory({ initial: pages, maximum: pages });
  const b = memory.buffer, header = new Uint32Array(b, 0, 16);
  header.set([0, count, offsets.boxes, offsets.left, offsets.right, offsets.primitive, offsets.inactive, offsets.anyInactive,
    offsets.maximumRank, offsets.rank, offsets.stack, offsets.hits, offsets.order, offsets.flags, offsets.source, 0]);
  return { memory, header, metrics: new Float64Array(b, 64, 2),
    order: new Int32Array(b, offsets.order, count), flags: new Uint8Array(b, offsets.flags, count), source: new Float64Array(b, offsets.source, 6 * count),
    storage: { boxes: new Float64Array(b, offsets.boxes, 6 * capacity), left: new Int32Array(b, offsets.left, capacity),
      right: new Int32Array(b, offsets.right, capacity), primitive: new Int32Array(b, offsets.primitive, capacity),
      inactive: new Uint8Array(b, offsets.inactive, capacity), anyInactive: new Uint8Array(b, offsets.anyInactive, capacity),
      maximumRank: new Int32Array(b, offsets.maximumRank, capacity), rank: new Int32Array(b, offsets.rank, count),
      stack: new Int32Array(b, offsets.stack, capacity), hits: new Int32Array(b, offsets.hits, count) } };
}
