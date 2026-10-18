// @ts-check
// Main-thread stand-in for a paper-engine World that runs in a Worker (engine-worker.js). It keeps
// the World calls the studio makes (setControl, step, render, stats, creaseLines, pick, grab,
// moveGrab, release) and turns them into ordered messages. step() never blocks: while the Worker
// is stepping, further step calls are dropped (the main-thread loop drops time the same way), and
// render() returns the newest pose that has arrived. Pose buffers are transferred both ways, so a
// running sheet allocates nothing per frame.

/** @typedef {{postMessage(msg: any, transfer?: Transferable[]): void, addEventListener(type: string, fn: (ev: any) => void): void, removeEventListener(type: string, fn: (ev: any) => void): void}} WorkerLike */

let nextGen = 1;

export class WorkerWorld {
  /**
   * Start a World for `json` in the Worker and resolve when its first pose has arrived.
   * @param {WorkerLike} worker
   * @param {{engineUrl: string, json: any, opts: any, controls: [string, any][], probe: boolean, onFrame?: () => void, onStep?: (ms: number) => void, onError?: (e: Error) => void}} o
   * @returns {Promise<WorkerWorld>}
   */
  static create(worker, o) {
    const w = new WorkerWorld(worker, o);
    return w.ready;
  }

  /** @param {WorkerLike} worker @param {any} o */
  constructor(worker, o) {
    this.worker = worker;
    this.gen = nextGen++;
    this.onFrame = o.onFrame || (() => {});
    this.onStep = o.onStep || (() => {});
    this.onError = o.onError || (() => {});
    this.pending = false;          // a step is running in the Worker
    this.probeMs = NaN;
    this.warnings = /** @type {string[]} */ ([]);
    this.lastStepMs = NaN;
    /** @type {Error | null} */ this.error = null;
    /** @type {any} */ this._r = null;
    /** @type {any} */ this._lines = null;
    /** @type {any} */ this._stats = null;
    this._wantStats = false;
    this._wantLines = false;
    /** @type {ArrayBuffer[]} */ this._spare = [];
    this._ray = { origin: [0, 0, 0], dir: [0, 0, -1] };
    this._disposed = false;
    /** @type {(w: WorkerWorld) => void} */ let resolve = () => {};
    /** @type {(e: Error) => void} */ let reject = () => {};
    this.ready = new Promise((res, rej) => { resolve = res; reject = rej; });
    this._onMessage = (/** @type {MessageEvent} */ ev) => {
      const m = ev.data;
      if (!m || m.gen !== this.gen || this._disposed) return;
      if (m.type === 'ready') {
        this.probeMs = m.probeMs;
        this.warnings = m.warnings || [];
        this._r = { positions: m.frame.positions, normals: m.frame.normals, uvs: m.uvs, sheetIds: m.sheetIds, indices: m.indices, vertexCount: m.uvs.length / 2 };
        this._lineKinds = m.lineKinds;
        this._lines = m.lineKinds ? { positions: m.frame.lines, kinds: m.lineKinds, count: m.lineKinds.length } : null;
        this._stats = m.stats;
        resolve(this);
      } else if (m.type === 'frame') {
        this.pending = false;
        this._recycle(this._r.positions, this._r.normals);
        this._r = { ...this._r, positions: m.frame.positions, normals: m.frame.normals };
        if (m.frame.lines && this._lines) { this._recycle(this._lines.positions); this._lines = { ...this._lines, positions: m.frame.lines }; }
        if (m.stats) this._stats = m.stats;
        this.lastStepMs = m.stepMs;
        this.onStep(m.stepMs);
        this.onFrame();
      } else if (m.type === 'error') {
        const e = new Error(`engine worker (${m.phase}): ${m.message}`);
        this.pending = false;
        if (m.phase === 'init') reject(e);
        else { this.error = e; this.onError(e); this.onFrame(); }
      }
    };
    this._onWorkerError = (/** @type {any} */ ev) => {
      const e = new Error(`engine worker failed: ${(ev && ev.message) || 'could not start'}`);
      this.pending = false;
      this.error = e;
      reject(e);
      this.onError(e);
    };
    worker.addEventListener('message', this._onMessage);
    worker.addEventListener('error', this._onWorkerError);
    worker.postMessage({ type: 'init', gen: this.gen, engineUrl: o.engineUrl, json: o.json, opts: o.opts, controls: o.controls, probe: !!o.probe });
  }

  /** @param {...(Float32Array | null | undefined)} arrays */
  _recycle(...arrays) {
    for (const a of arrays) if (a && a.buffer && a.buffer.byteLength) this._spare.push(/** @type {ArrayBuffer} */ (a.buffer));
  }

  _post(msg, transfer) {
    if (this.error) throw this.error;
    if (!this._disposed) this.worker.postMessage({ ...msg, gen: this.gen }, transfer);
  }

  /** @param {string} id @param {number|boolean} value */
  setControl(id, value) { this._post({ type: 'control', id, value }); }

  /**
   * Ask the Worker for one step unless one is running. Returns the steps requested (0 or 1).
   * @param {number} [dt]
   */
  step(dt = 1 / 60) {
    if (this.error) throw this.error;
    if (this.pending || this._disposed) return 0;
    this.pending = true;
    const recycle = this._spare;
    this._spare = [];
    this._post({ type: 'step', dt, stats: this._wantStats, lines: this._wantLines, recycle }, recycle);
    this._wantStats = false;
    return 1;
  }

  /** The newest pose: {positions, normals, uvs, sheetIds, indices} (indices, uvs and sheet ids never change). */
  render() { return this._r; }

  /** Crease/score/perforation/cut segments in the newest pose; asks the Worker to keep sending them. */
  creaseLines() { this._wantLines = true; return this._lines; }

  /** The newest diagnostics; a fresh set arrives with the next step. */
  stats() { this._wantStats = true; return this._stats; }

  /**
   * Ray pick against the newest render pose (the Worker picks again on its own pose when grabbing).
   * @param {number[]} o @param {number[]} d
   */
  pick(o, d) {
    this._ray = { origin: [...o], dir: [...d] };
    return pickRenderMesh(this._r, o, d);
  }

  /** Grab at the last picked ray (the Worker resolves the simulation vertex). */
  grab() { this._post({ type: 'grab', origin: this._ray.origin, dir: this._ray.dir }); }

  /** @param {number[]} point */
  moveGrab(point) { this._post({ type: 'moveGrab', point: [...point] }); }

  release() { this._post({ type: 'release' }); }

  /** Stop listening; the Worker drops this World's messages when the next document starts. */
  dispose() {
    this._disposed = true;
    this.worker.removeEventListener('message', this._onMessage);
    this.worker.removeEventListener('error', this._onWorkerError);
  }
}

/**
 * Möller–Trumbore against a render mesh; the nearest hit or null.
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>, sheetIds: ArrayLike<number>} | null} r
 * @param {number[]} o @param {number[]} d
 */
export function pickRenderMesh(r, o, d) {
  if (!r) return null;
  const P = r.positions, I = r.indices;
  let best = null, bestT = Infinity;
  for (let t = 0; t + 2 < I.length; t += 3) {
    const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist > 1e-9 && dist < bestT) {
      bestT = dist;
      best = { vertex: -1, triangle: t / 3, point: [o[0] + d[0] * dist, o[1] + d[1] * dist, o[2] + d[2] * dist], sheet: r.sheetIds[I[t]] };
    }
  }
  return best;
}

/**
 * The studio's shared engine Worker, created on first use; null where module Workers are not
 * available (the studio then steps the engine on the main thread).
 * @param {string | URL} url
 * @returns {Worker | null}
 */
let shared = /** @type {Worker | null | undefined} */ (undefined);
export function sharedEngineWorker(url) {
  if (shared !== undefined) return shared;
  try {
    shared = typeof Worker === 'function' ? new Worker(url, { type: 'module', name: 'pliego-engine' }) : null;
  } catch {
    shared = null;
  }
  return shared;
}

/**
 * The paper engine for a document in the shared Worker, with the document's control defaults
 * applied and (with `probe`) the speed probe run there. Rejects when module Workers are unavailable,
 * `off` is set (`?worker=off`), or the Worker cannot start the engine; the studio then steps the
 * engine on the main thread.
 * @param {{off?: boolean, json: any, opts: any, probe: boolean, onFrame?: () => void, onStep?: (ms: number) => void}} o
 * @returns {Promise<WorkerWorld>}
 */
export function startEngineWorker(o) {
  if (o.off) return Promise.reject(new Error('?worker=off'));
  const worker = sharedEngineWorker(new URL('./engine-worker.js', import.meta.url));
  if (!worker) return Promise.reject(new Error('module Workers are not available'));
  return WorkerWorld.create(worker, {
    engineUrl: new URL('/engine/index.js', location.href).href,
    json: o.json,
    opts: o.opts,
    controls: (o.json['pliego:controls'] || []).map((/** @type {any} */ c) => [c.id, c.default]),
    probe: o.probe,
    onFrame: o.onFrame,
    onStep: o.onStep,
  });
}

/** Forget the shared Worker after it failed, so the studio stops offering it this session. */
export function retireEngineWorker() {
  if (shared) { try { shared.terminate(); } catch { /* already gone */ } }
  shared = null;
}
