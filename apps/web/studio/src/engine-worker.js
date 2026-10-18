// @ts-check
// The paper engine off the main thread: a module Worker that owns one World at a time and answers
// the studio's calls in order (setControl, step, grab), so a replay is the same as on the main
// thread (determinism contract). Each step posts the render pose back in pooled Float32Arrays that
// are transferred, not copied, and returned by the studio with its next step request. The studio
// keeps the main-thread World as a fallback (world-proxy.js). The message handler is a plain
// function so Node tests can drive it without a Worker.

/**
 * @typedef {{type: 'init', gen: number, engineUrl: string, json: any, opts: any, controls: [string, any][], probe: boolean}
 *   | {type: 'control', gen: number, id: string, value: any}
 *   | {type: 'step', gen: number, dt: number, stats: boolean, lines: boolean, recycle: ArrayBuffer[]}
 *   | {type: 'grab', gen: number, origin: number[], dir: number[]}
 *   | {type: 'moveGrab', gen: number, point: number[]}
 *   | {type: 'release', gen: number}} HostMessage
 */

/**
 * Wall time of a warmed step (ms), the studio's speed probe on either thread. The first step pays
 * for the initial factorisation, and the next ones may still be settling, so the probe returns the
 * faster of steps two and three; it advances the world by all three steps.
 * @param {any} world @param {number} dt @param {() => number} now
 */
export function probeStep(world, dt, now) {
  world.step(dt);
  let best = Infinity;
  for (let i = 0; i < 2; i++) {
    const t0 = now();
    world.step(dt);
    best = Math.min(best, now() - t0);
  }
  return best;
}

/**
 * @param {(msg: any, transfer?: Transferable[]) => void} post
 * @param {(url: string) => Promise<any>} importEngine
 * @param {() => number} [now]
 */
export function createEngineHost(post, importEngine, now = () => performance.now()) {
  /** @type {any} */ let E = null;
  /** @type {any} */ let world = null;
  let gen = -1;
  /** @type {ArrayBuffer[]} */ let pool = [];

  /** A Float32Array of `n` floats, from a returned buffer of that size when there is one. */
  function take(n) {
    const i = pool.findIndex((b) => b.byteLength === n * 4);
    return i >= 0 ? new Float32Array(pool.splice(i, 1)[0]) : new Float32Array(n);
  }

  function frameOf(r, withLines) {
    const positions = take(r.positions.length), normals = take(r.normals.length);
    positions.set(r.positions); normals.set(r.normals);
    /** @type {Transferable[]} */ const transfer = [positions.buffer, normals.buffer];
    let lines = null;
    if (withLines && typeof world.creaseLines === 'function') {
      const L = world.creaseLines();
      lines = take(L.positions.length);
      lines.set(L.positions);
      transfer.push(lines.buffer);
    }
    return { frame: { positions, normals, lines }, transfer };
  }

  const fail = (phase, e) => post({ type: 'error', gen, phase, message: e instanceof Error ? e.message : String(e) });

  /** @param {HostMessage} m */
  async function handle(m) {
    if (m.type === 'init') {
      world = null; gen = m.gen; pool = [];
      try {
        E = E || await importEngine(m.engineUrl);
        const w = new E.World(E.loadDocument(m.json), m.opts);
        for (const [id, v] of m.controls) w.setControl(id, v);
        const probeMs = m.probe ? probeStep(w, 1 / 60, now) : NaN;
        world = w;
        const r = w.render();
        const L = typeof w.creaseLines === 'function' ? w.creaseLines() : null;
        const { frame, transfer } = frameOf(r, !!L);
        const indices = r.indices instanceof Uint16Array ? Uint16Array.from(r.indices) : Uint32Array.from(r.indices);
        const uvs = Float32Array.from(r.uvs), sheetIds = Float32Array.from(r.sheetIds);
        const lineKinds = L ? Uint8Array.from(L.kinds) : null;
        transfer.push(indices.buffer, uvs.buffer, sheetIds.buffer);
        if (lineKinds) transfer.push(lineKinds.buffer);
        post({ type: 'ready', gen, probeMs, uvs, sheetIds, indices, lineKinds, warnings: [...(w.warnings || [])], frame, stats: w.stats() }, transfer);
      } catch (e) {
        fail('init', e);
      }
      return;
    }
    if (m.gen !== gen || !world) return;   // a message for a document that is gone
    try {
      if (m.type === 'control') world.setControl(m.id, m.value);
      else if (m.type === 'step') {
        for (const b of m.recycle || []) pool.push(b);
        const t0 = now();
        world.step(m.dt);
        const stepMs = now() - t0;
        const { frame, transfer } = frameOf(world.render(), m.lines);
        post({ type: 'frame', gen, stepMs, frame, stats: m.stats ? world.stats() : null }, transfer);
      } else if (m.type === 'grab') {
        const hit = world.pick(m.origin, m.dir);
        if (hit) world.grab(hit.vertex, hit.point);
        post({ type: 'grabbed', gen, ok: !!hit });
      } else if (m.type === 'moveGrab') world.moveGrab(m.point);
      else if (m.type === 'release') world.release();
    } catch (e) {
      fail(m.type, e);
    }
  }
  return { handle };
}

// Worker bootstrap (not in Node or on the main thread). Messages are handled strictly in order: an
// init awaits the engine import, and later messages queue behind it.
const scope = /** @type {any} */ (globalThis);
if (typeof scope.WorkerGlobalScope !== 'undefined' && scope instanceof scope.WorkerGlobalScope) {
  const host = createEngineHost((msg, transfer) => scope.postMessage(msg, transfer || []), (url) => import(url));
  let queue = Promise.resolve();
  scope.onmessage = (/** @type {MessageEvent} */ ev) => { queue = queue.then(() => host.handle(ev.data)); };
}
