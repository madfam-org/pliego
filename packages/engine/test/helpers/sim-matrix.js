// @ts-check
/**
 * Simulation matrix: load one sheet document into the real engine with the studio's interactive
 * options and drive it the way the studio does, then report whether it loads, how fast it steps,
 * how far it stretches, whether it stays finite and sane, and whether the studio would fall back to
 * the preview. The CLI that runs it over a corpus is `scripts/qa/sim-matrix.mjs`; the CI smoke is
 * `test/sim-smoke.test.js`.
 *
 * Driving (all in one World, like a viewer):
 *  1. every control at its default, then the studio's probe (`probeStep` in studio main.js: one
 *     step, then the faster of two timed steps);
 *  2. the sequence control, if any, set to its end. The engine paces it at one step per
 *     `duration_ms`; a program longer than the drive window is time-compressed to fit it
 *     (`seqScale` records the factor, 1 = real time). Then the settle window;
 *  3. every other control, one after another: angle and distance controls swept linearly from the
 *     default to the far end of their range over the drive window, toggles flipped, wind ramped to
 *     its midpoint and back to 0. Then the settle window each.
 *
 * Every step is timed alone around `world.step()`, on the CPU clock by default (see `cpuMs`) and on
 * the wall clock; steps taken while the world was asleep are not timed. The studio's probe and live
 * speed watch are replayed on the same samples.
 */
import * as ENGINE from '../../src/index.js';
import { engineOptions, estimateVertices, physicsFits, tooSlow, SLOW_STEP_MS } from '../../../../apps/web/studio/src/physics.js';

export const STEP = 1 / 60;
/**
 * Step cost clock. `cpu` (the default in Node) is this process's CPU time, which a busy machine
 * does not inflate the way it inflates wall time; it needs one document per process (the CLI forks).
 * `wall` is `performance.now()`, what a viewer feels on an idle machine.
 */
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
/** Default drive window per control (frames at 60 Hz). */
export const DRIVE_FRAMES = 300;
/** Default settle window after each control (frames). */
export const SETTLE_FRAMES = 60;
/** Stretch above this (strain) is a failure: twice the engine's documented 0.5 % guarantee. */
export const STRETCH_FAIL = 0.01;
/** A vertex this far outside the sane box (mm) counts as an explosion. */
export const BOX_SLACK_MM = 1;
/** A free (simulated) vertex below the ground plane by more than this (mm) has fallen through it. Driven
 * vertices (kinematic sheets, boards, pins, fold programs) are not held by the ground; `minYFixed` reports them. */
export const GROUND_SLACK_MM = 2;
/** Maximum vertex speed (mm/s) at the end of the last settle window above which the pose is jittering. */
export const JITTER_MM_S = 200;

/** The studio's live speed watch (main.js `noteStep`): an EMA over awake steps of at least 1 ms. */
class SpeedWatch {
  constructor() { this.n = 0; this.avg = 0; this.fired = false; this.firedAvg = NaN; }
  /** @param {number} ms */
  note(ms) {
    if (this.fired || ms < 1) return;
    this.n++;
    this.avg = this.n === 1 ? ms : 0.85 * this.avg + 0.15 * ms;
    if (this.n >= 20 && tooSlow(this.avg)) { this.fired = true; this.firedAvg = this.avg; }
  }
}

/** @param {number[]} xs @param {number} p */
function quantile(xs, p) {
  if (!xs.length) return NaN;
  const s = Float64Array.from(xs).sort();
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
}

/** @param {Float64Array} x */
function bbox(x) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < x.length; i += 3) for (let k = 0; k < 3; k++) { const v = x[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  return { lo, hi };
}

/** Largest sheet diagonal in the layout (mm), from the simulation mesh's sheet coordinates. @param {any} mesh @param {number} nS */
function maxSheetDiagonal(mesh, nS) {
  const lo = new Array(2 * nS).fill(Infinity), hi = new Array(2 * nS).fill(-Infinity);
  for (let v = 0; v < mesh.nV; v++) {
    const s = mesh.vSheet[v];
    for (let k = 0; k < 2; k++) { const u = mesh.uv[2 * v + k]; if (u < lo[2 * s + k]) lo[2 * s + k] = u; if (u > hi[2 * s + k]) hi[2 * s + k] = u; }
  }
  let d = 0;
  for (let s = 0; s < nS; s++) if (hi[2 * s] >= lo[2 * s]) d = Math.max(d, Math.hypot(hi[2 * s] - lo[2 * s], hi[2 * s + 1] - lo[2 * s + 1]));
  return d;
}

/** Rule ids of a DocumentError ("rule 3", "rule 9 / §6", …), deduplicated, in order. @param {string[]} problems */
export function ruleIds(problems) {
  const out = [];
  for (const p of problems) {
    const m = /^(rule [0-9]+(?: \/ §[0-9.]+)?)/.exec(p);
    const id = m ? m[1] : p.replace(/\[[0-9]+\]/g, '[]').replace(/[0-9]+(\.[0-9]+)?/g, '#').slice(0, 60);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Features of the document that the triage groups by. @param {any} j */
export function features(j) {
  const count = (/** @type {any[]} */ xs, /** @type {string} */ key) => {
    /** @type {Record<string, number>} */ const c = {};
    for (const x of xs || []) c[x[key]] = (c[x[key]] || 0) + 1;
    return Object.entries(c).sort().map(([k, n]) => `${k}:${n}`).join(' ');
  };
  const treat = j['pliego:edges_treatment'] || [];
  return {
    sheets: (j['pliego:sheets'] || []).length,
    docVertices: (j.vertices_coords || []).length,
    faces: (j.faces_vertices || []).length,
    cuts: treat.filter((/** @type {string} */ t) => t === 'cut').length,
    perforations: treat.filter((/** @type {string} */ t) => t === 'perforation').length,
    seqMode: j['pliego:sequence'] ? j['pliego:sequence'].mode : '',
    seqSteps: j['pliego:sequence'] ? j['pliego:sequence'].steps.length : 0,
    controls: count(j['pliego:controls'], 'kind'),
    mechanisms: count(j['pliego:mechanisms'], 'type'),
    joins: count(j['pliego:joins'], 'type'),
    kinematicSheets: (j['pliego:sheets'] || []).filter((/** @type {any} */ s) => s.kinematic).length,
  };
}

/**
 * The drive schedule: a list of phases `{control, frames, at(frame) → value | null}`.
 * @param {any} doc loaded document @param {number} drive @param {number} settle
 */
function schedule(doc, drive, settle) {
  /** @type {{id: string, kind: string, from: any, to: any, frames: number, value: (f: number) => number|boolean|null}[]} */
  const phases = [];
  const ctrls = doc.controls;
  const seq = ctrls.find((/** @type {any} */ c) => c.kind === 'sequence');
  if (seq && doc.sequence) {
    const n = doc.sequence.steps.length;
    phases.push({ id: seq.id, kind: 'sequence', from: seq.default ?? 0, to: n, frames: drive + settle, value: (f) => (f === 0 ? n : null) });
  }
  for (const c of ctrls) {
    if (c === seq) continue;
    if (c.kind === 'toggle') {
      const to = !c.default;
      phases.push({ id: c.id, kind: c.kind, from: !!c.default, to, frames: drive + settle, value: (f) => (f === 0 ? to : null) });
    } else if (c.kind === 'wind') {
      const mid = 0.5 * ((c.min ?? 0) + (c.max ?? 10));
      phases.push({ id: c.id, kind: c.kind, from: 0, to: mid, frames: drive + settle, value: (f) => (f < drive / 2 ? mid * (2 * f / drive) : f < drive ? mid * (2 - 2 * f / drive) : 0) });
    } else if (typeof c.min === 'number' && typeof c.max === 'number' && c.max !== c.min) {
      const d = typeof c.default === 'number' ? c.default : c.min;
      const to = Math.abs(c.max - d) >= Math.abs(c.min - d) ? c.max : c.min;
      phases.push({ id: c.id, kind: c.kind, from: d, to, frames: drive + settle, value: (f) => (f <= drive ? d + (to - d) * Math.min(1, f / drive) : null) });
    }
  }
  return phases;
}

/**
 * Simulate one document. Never throws: every failure becomes a field of the record.
 * @param {any} json parsed sheet document
 * @param {{drive?: number, settle?: number, budgetMs?: number, compress?: boolean, clock?: 'cpu'|'wall'}} [o]
 * @param {{World: any, loadDocument: (j: any) => any}} [E] the engine module (default: this package's)
 */
export function simulateDocument(json, o = {}, E = ENGINE) {
  const { World, loadDocument } = E;
  const drive = o.drive ?? DRIVE_FRAMES, settle = o.settle ?? SETTLE_FRAMES;
  const budgetMs = o.budgetMs ?? 60000;
  const clock = o.clock ?? (typeof process !== 'undefined' && process.cpuUsage ? 'cpu' : 'wall');
  const now = clock === 'cpu' ? cpuMs : () => performance.now();
  const opts = engineOptions(json);
  const rec = /** @type {Record<string, any>} */ ({
    ...features(json), meshEdge: opts.meshEdge, substeps: opts.substeps, estVertices: estimateVertices(json, opts.meshEdge),
    fits: physicsFits(json), loads: false, rejected: false, rules: '', error: '', simVertices: 0, triangles: 0,
    clock, probeMs: NaN, probeWallMs: NaN, wallMean: NaN, wallP95: NaN, stepsTimed: 0, stepsRun: 0, msMean: NaN, msP95: NaN, msMax: NaN, factorPerStep: NaN, pcgMean: NaN,
    maxStretch: 0, stretchP95: NaN, endStretch: NaN, peakAt: '', maxCompression: 0, finite: true, firstNonFinite: '', exploded: false, outsideMm: 0, belowGround: false,
    minY: NaN, minYFixed: NaN, endSpeed: NaN, asleepAtEnd: false, seqScale: 1, truncated: false, speedWatchFired: false, speedWatchMs: NaN,
    contactsMax: 0, tornWelds: 0, phases: '',
  });
  let doc;
  try { doc = loadDocument(json); } catch (e) {
    const err = /** @type {any} */ (e);
    rec.rejected = err && err.name === 'DocumentError';
    rec.rules = rec.rejected ? ruleIds(err.problems).join('; ') : '';
    rec.error = String(err && err.message || err).split('\n').slice(0, 3).join(' | ').slice(0, 300);
    return finish(rec);
  }
  /** @type {any} */
  let w;
  try {
    w = new World(doc, opts);
  } catch (e) {
    rec.error = `world: ${String(/** @type {any} */ (e)?.message ?? e).split('\n')[0].slice(0, 280)}`;
    return finish(rec);
  }
  rec.loads = true;
  rec.simVertices = w.mesh.nV;
  rec.triangles = w.mesh.nT;
  const x0 = Float64Array.from(w.positions);
  const b0 = bbox(x0);
  const reach = maxSheetDiagonal(w.mesh, doc.sheets.length);
  const box = {
    lo: [b0.lo[0] - reach, Math.min(0, b0.lo[1]) - reach, b0.lo[2] - reach],
    hi: [b0.hi[0] + reach, b0.hi[1] + reach, b0.hi[2] + reach],
  };
  const times = /** @type {number[]} */ ([]);
  const walls = /** @type {number[]} */ ([]);
  const strains = /** @type {number[]} */ ([]);
  const watch = new SpeedWatch();
  let pcgSum = 0, pcgN = 0, spent = 0;
  const f0 = w.stats().factorizations;
  const track = (/** @type {string} */ where) => {
    const s = w.stats();
    if (s.maxStrain > rec.maxStretch) { rec.maxStretch = s.maxStrain; rec.peakAt = where; }
    strains.push(s.maxStrain);
    if (s.maxCompression > rec.maxCompression) rec.maxCompression = s.maxCompression;
    if (s.contacts > rec.contactsMax) rec.contactsMax = s.contacts;
    pcgSum += s.pcgIterations; pcgN++;
    if (!s.finite && rec.finite) { rec.finite = false; rec.firstNonFinite = where; }
    return s;
  };
  const timedStep = (/** @type {string} */ where) => {
    const asleep = w.stats().asleep;
    const c0 = now(), t0 = performance.now();
    w.step(STEP);
    const wall = performance.now() - t0, ms = now() - c0;
    rec.stepsRun++;
    spent += ms;
    if (!asleep) { times.push(ms); walls.push(wall); watch.note(ms); }
    return track(where);
  };
  try {
    for (const c of doc.controls) w.setControl(c.id, c.default);
    // the studio's probe
    w.step(STEP); rec.stepsRun++;
    let best = Infinity, bestWall = Infinity;
    for (let i = 0; i < 2; i++) {
      const c0 = now(), t0 = performance.now();
      w.step(STEP);
      bestWall = Math.min(bestWall, performance.now() - t0); best = Math.min(best, now() - c0); rec.stepsRun++;
    }
    rec.probeMs = best;
    rec.probeWallMs = bestWall;
    track('probe');
    const phases = schedule(doc, drive, settle);
    // a sequence longer than the drive window is compressed to fit it
    if (doc.sequence && phases.length && phases[0].kind === 'sequence') {
      const total = doc.sequence.steps.reduce((/** @type {number} */ a, /** @type {any} */ s) => a + s.duration_ms, 0) / 1000;
      const window = drive * STEP;
      if (o.compress !== false && total > window) {
        rec.seqScale = total / window;
        for (const s of doc.sequence.steps) s.duration_ms = s.duration_ms / rec.seqScale;
      }
    }
    const names = [];
    outer: for (const ph of phases) {
      names.push(`${ph.id}(${ph.kind}:${fmtV(ph.from)}→${fmtV(ph.to)})`);
      for (let f = 0; f < ph.frames; f++) {
        const v = ph.value(f);
        if (v !== null) w.setControl(ph.id, v);
        timedStep(`${ph.id}@${f}`);
        if (!rec.finite) break outer;
        if (spent > budgetMs) { rec.truncated = true; break outer; }
      }
    }
    if (!phases.length) {
      // nothing to drive: let it settle under gravity for one window
      names.push('none(settle)');
      for (let f = 0; f < settle && rec.finite; f++) timedStep(`settle@${f}`);
    }
    rec.phases = names.join(' ');
  } catch (e) {
    rec.error = `step: ${String(/** @type {any} */ (e)?.message ?? e).split('\n')[0].slice(0, 280)}`;
  }
  const s = w.stats();
  rec.asleepAtEnd = s.asleep;
  rec.endStretch = s.finite ? s.maxStrain : NaN;
  rec.stretchP95 = quantile(strains, 0.95);
  rec.tornWelds = s.tornWelds ?? 0;
  rec.stepsTimed = times.length;
  rec.msMean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : NaN;
  rec.msP95 = quantile(times, 0.95);
  rec.msMax = times.length ? Math.max(...times) : NaN;
  rec.wallMean = walls.length ? walls.reduce((a, b) => a + b, 0) / walls.length : NaN;
  rec.wallP95 = quantile(walls, 0.95);
  rec.factorPerStep = rec.stepsRun ? (s.factorizations - f0) / rec.stepsRun : NaN;
  rec.pcgMean = pcgN ? pcgSum / pcgN : NaN;
  rec.speedWatchFired = watch.fired;
  rec.speedWatchMs = watch.firedAvg;
  if (rec.finite) {
    const x = w.positions, v = w.v;
    let out = 0, minY = Infinity, minYFixed = Infinity, vmax = 0;
    for (let i = 0; i < x.length; i += 3) {
      for (let k = 0; k < 3; k++) out = Math.max(out, box.lo[k] - x[i + k], x[i + k] - box.hi[k]);
      if (w.invMass[i / 3] > 0) {
        if (x[i + 1] < minY) minY = x[i + 1];
        vmax = Math.max(vmax, Math.hypot(v[i], v[i + 1], v[i + 2]));
      } else if (x[i + 1] < minYFixed) minYFixed = x[i + 1];
    }
    rec.outsideMm = Math.max(0, out);
    rec.exploded = out > BOX_SLACK_MM;
    rec.minY = minY;
    rec.minYFixed = minYFixed;
    rec.belowGround = minY < -GROUND_SLACK_MM;
    rec.endSpeed = s.asleep ? 0 : vmax;
  }
  return finish(rec);
}

/** @param {any} v */
function fmtV(v) { return typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v); }

/** Classification and the studio's fallback decision. @param {Record<string, any>} rec */
function finish(rec) {
  const ran = rec.loads && !rec.error;
  rec.stretched = ran && rec.finite && rec.maxStretch > STRETCH_FAIL;
  rec.jitter = ran && rec.finite && !rec.exploded && rec.endSpeed > JITTER_MM_S;
  rec.stable = ran && rec.finite && !rec.exploded && !rec.belowGround && !rec.stretched && !rec.jitter;
  rec.interactive = rec.loads && Number.isFinite(rec.msMean) && rec.msMean < SLOW_STEP_MS;
  rec.fallback = !rec.loads ? '' : !rec.fits ? 'heavy' : tooSlow(rec.probeMs) ? 'probe' : rec.speedWatchFired ? 'speed' : '';
  rec.status = rec.rejected ? 'rejected' : !rec.loads ? 'world-error' : rec.error ? 'step-error' : !rec.finite ? 'non-finite'
    : rec.exploded ? 'exploded' : rec.belowGround ? 'below-ground' : rec.stretched ? 'stretched' : rec.jitter ? 'jitter' : 'stable';
  return rec;
}
