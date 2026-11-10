// @ts-check
// Balanced hierarchy over existing outward primitive AABBs. Topology is built
// once; every call refits ALL bounds, stationary flags and current sort ranks.
// Queries return ranks sorted numerically, retaining reference candidate order.
export class BoundsTree {
  /** @param {number} count */
  constructor(count) {
    this.count = count; this.nodes = 0;
    const capacity = Math.max(1, 2 * count - 1);
    this.boxes = new Float64Array(6 * capacity);
    this.left = new Int32Array(capacity); this.right = new Int32Array(capacity);
    this.primitive = new Int32Array(capacity).fill(-1);
    this.inactive = new Uint8Array(capacity); this.maximumRank = new Int32Array(capacity);
    this.rank = new Int32Array(count); this.stack = new Int32Array(capacity); this.hits = new Int32Array(count);
    this.nodeTests = 0; this.rootContainmentTests = 0; this.queries = 0;
    this.order = /** @type {number[]} */([]);
    /** @type {Uint8Array} */
    this.primitiveInactive = new Uint8Array(0);
  }

  /** @param {Float64Array} boxes @param {number[]} order @param {Uint8Array} inactive */
  refit(boxes, order, inactive) {
    this.order = order; this.primitiveInactive = inactive;
    if (!this.nodes && this.count) {
      const ids = Array.from({ length: this.count }, (_, i) => i);
      const active = ids.filter(id => !inactive[id]), stationary = ids.filter(id => inactive[id]);
      // Layered sheets overlap in X/Z. Group initial stationary primitives so
      // fixed queries can prune them at one node, rather than near every leaf.
      // This affects topology only: ALL flags are still recomputed below.
      if (active.length && stationary.length) {
        this.nodes = 1;
        this.left[0] = this.partition(active, boxes); this.right[0] = this.partition(stationary, boxes);
      } else this.partition(ids, boxes);
    }
    for (let rank = 0; rank < order.length; rank++) this.rank[order[rank]] = rank;
    for (let n = this.nodes - 1; n >= 0; n--) {
      const id = this.primitive[n], target = 6 * n;
      if (id >= 0) {
        for (let k = 0; k < 6; k++) this.boxes[target + k] = boxes[6 * id + k];
        this.inactive[n] = inactive[id]; this.maximumRank[n] = this.rank[id];
      } else {
        const a = this.left[n], b = this.right[n];
        for (let k = 0; k < 3; k++) {
          this.boxes[target + k] = Math.min(this.boxes[6 * a + k], this.boxes[6 * b + k]);
          this.boxes[target + 3 + k] = Math.max(this.boxes[6 * a + 3 + k], this.boxes[6 * b + 3 + k]);
        }
        this.inactive[n] = this.inactive[a] && this.inactive[b] ? 1 : 0;
        this.maximumRank[n] = Math.max(this.maximumRank[a], this.maximumRank[b]);
      }
    }
    this.nodeTests = 0; this.rootContainmentTests = 0; this.queries = 0;
  }

  /** Initial median partition; stable primitive-ID tie break on each axis.
   * @param {number[]} ids @param {Float64Array} boxes
   */
  partition(ids, boxes) {
    const node = this.nodes++;
    if (ids.length === 1) { this.primitive[node] = ids[0]; return node; }
    let axis = 0, spread = -Infinity;
    for (let k = 0; k < 3; k++) {
      let lo = Infinity, hi = -Infinity;
      for (const id of ids) { const center = boxes[6 * id + k] / 2 + boxes[6 * id + 3 + k] / 2; lo = Math.min(lo, center); hi = Math.max(hi, center); }
      if (hi - lo > spread) { spread = hi - lo; axis = k; }
    }
    const center = id => boxes[6 * id + axis] / 2 + boxes[6 * id + 3 + axis] / 2;
    ids.sort((a, b) => center(a) - center(b) || a - b);
    const middle = Math.floor(ids.length / 2);
    this.left[node] = this.partition(ids.slice(0, middle), boxes);
    this.right[node] = this.partition(ids.slice(middle), boxes);
    return node;
  }

  /** Inclusive AABB query. Skip stationary/stationary pairs and ranks <= after.
   * @param {Float64Array} boxes @param {number} index @param {boolean|number} inactive @param {number} [after]
   * @returns {number} number of sorted ranks in this.hits, valid until next query
   */
  query(boxes, index, inactive, after = -1) {
    this.queries++;
    let size = 0, count = 0;
    if (!this.nodes || this.maximumRank[0] <= after || (inactive && this.inactive[0])) return 0;
    // An enclosing query overlaps every leaf. Emit current ranks directly,
    // avoiding a full dense traversal and sort; still apply current inactivity.
    this.rootContainmentTests++;
    let encloses = true;
    for (let k = 0; k < 3; k++) if (boxes[6 * index + k] > this.boxes[k] || boxes[6 * index + 3 + k] < this.boxes[3 + k]) { encloses = false; break; }
    if (encloses) {
      for (let rank = Math.max(0, Math.floor(after) + 1); rank < this.count; rank++) if (!(inactive && this.primitiveInactive[this.order[rank]])) this.hits[count++] = rank;
      return count;
    }
    if (this.nodes) this.stack[size++] = 0;
    while (size) {
      const n = this.stack[--size];
      if (this.maximumRank[n] <= after || (inactive && this.inactive[n])) continue;
      this.nodeTests++;
      let overlap = true;
      for (let k = 0; k < 3; k++) if (boxes[6 * index + k] > this.boxes[6 * n + 3 + k] || this.boxes[6 * n + k] > boxes[6 * index + 3 + k]) { overlap = false; break; }
      if (!overlap) continue;
      const id = this.primitive[n];
      if (id >= 0) this.hits[count++] = this.rank[id];
      else { this.stack[size++] = this.right[n]; this.stack[size++] = this.left[n]; }
    }
    if (count > 1) this.hits.subarray(0, count).sort();
    return count;
  }
}
