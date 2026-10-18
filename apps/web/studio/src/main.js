// @ts-check
// Pliego Studio — wiring: catalog → document → engine World → renderer, panels, share URL, i18n.
// The paper engine steps in a Worker when it can (world-proxy.js; `?worker=off`: main thread); frames
// are drawn only when the pose or the view changed, and the loop sleeps when nothing moves.

import { createI18n, LANG_EVENT } from '../../shared/i18n.js';
import { STUDIO_STRINGS } from './strings.js';
import { loadCatalog, fetchDocument, regenerate, exportFile, downloadBlob, loadEngine, loadPreview, fetchObject } from './data.js';
import { engineOptions, estimateVertices, physicsFits, tooSlow } from './physics.js';
import { parseShare, buildShare, coerceParams, paramsForMode, paramStrings, hasParams } from './share.js';
import { buildDiagram, highlightStep, serializeDiagram, createOverlay, createEngineOverlay, legendKinds, LINE_STYLE } from './diagram.js';
import { createChangeTracker, keepRunning, planSteps, quietLimit } from './frame-loop.js';
import { WorkerWorld, startEngineWorker, retireEngineWorker } from './world-proxy.js';
import { probeStep } from './engine-worker.js';
import { renderCatalog, renderModes, renderParams, renderControls, renderSteps, renderExports, stepIndex } from './panels.js';
import { createRenderer, rendererOverride } from './render/index.js';
import { attachInput } from './render/input.js';
import { sheetsFromDocument } from './render/scene.js';
import { rayPlane } from './render/camera.js';

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const i18n = createI18n(STUDIO_STRINGS);
const reducedMotion = globalThis.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const STEP = 1 / 60;

const state = {
  share: parseShare(location.search, location.hash),
  engine: /** @type {{mod: any, kind: 'engine'|'stub', reason: string} | null} */ (null),   // what runs the world now
  physics: /** @type {{mod: any, kind: 'engine'|'stub', reason: string} | null} */ (null),  // the paper engine when mounted
  preview: /** @type {{mod: any, kind: 'engine'|'stub', reason: string} | null} */ (null),  // the preview (no physics)
  physicsWanted: false,   // run paper physics when it is available
  physicsForced: false,   // the viewer asked for it (toggle or ?engine=physics): never fall back for speed
  renderer: /** @type {import('./render/index.js').Renderer | null} */ (null),
  input: /** @type {{destroy(): void} | null} */ (null),
  catalog: /** @type {{source: 'api'|'demo', items: any[]} | null} */ (null),
  item: /** @type {any} */ (null),
  mode: /** @type {string|null} */ (null),
  params: /** @type {Record<string, any>} */ ({}),
  json: /** @type {any} */ (null),
  world: /** @type {any} */ (null),
  overlay: /** @type {ReturnType<typeof createOverlay>} */ (null),
  overlayOn: false,
  grabMode: false,
  grabbing: /** @type {{plane: number[], normal: number[]} | null} */ (null),
  view: /** @type {'3d'|'2d'} */ ('3d'),
  controls: /** @type {ReturnType<typeof renderControls> | null} */ (null),
  updateSteps: /** @type {(v: number) => void} */ (() => {}),
  diagram: /** @type {SVGSVGElement | null} */ (null),
  playing: false,
  playDir: 1,
  fitted: false,
  failed: false,
  fps: 0,
  where: /** @type {'worker'|'main'|null} */ (null),   // where the paper engine steps
};

function status(msg) { $('st-msg').textContent = msg || ''; }
function notice(msg) { const n = $('viewer-notice'); n.textContent = msg || ''; n.hidden = !msg; }

// ---------- physics-dependence (stub engine only) ----------
function needsEngine(id) {
  if (!state.engine || state.engine.kind !== 'stub' || !state.json) return false;
  const j = state.json;
  const c = (j['pliego:controls'] || []).find((x) => x.id === id);
  if (!c) return false;
  if (c.kind === 'wind') return true;
  const joins = j['pliego:joins'] || [];
  // every mechanism this control moves, directly or through `ride` (spec §5.18), moves its sheets
  // in the preview; a join between two of those sheets moves with them
  const mechs = j['pliego:mechanisms'] || [];
  const byId = new Map(mechs.map((m) => [m.id, m]));
  const onControl = (m, depth = 0) => (m.control || m.angle_control) === id ||
    (m.ride !== undefined && byId.has(m.ride) && depth < mechs.length && onControl(byId.get(m.ride), depth + 1));
  const driven = mechs.filter((m) => onControl(m));
  const moving = new Set(driven.flatMap((m) => m.sheets_moving || []));
  for (const m of driven) {
    if (m.type === 'slide') return true;
    if (joins.some((jn) => jn.mechanism === m.id)) return true;   // driven pins / sliders
  }
  return driven.length > 0 && joins.some((jn) => (jn.type === 'glue' || jn.type === 'pivot' || jn.type === 'string') && jn.a && jn.b &&
    moving.has(jn.a.sheet) !== moving.has(jn.b.sheet || ''));
}

// ---------- rendering of panels ----------
function renderAll() {
  const items = state.catalog ? state.catalog.items : [];
  $('catalog-source').textContent = state.catalog ? i18n.t(state.catalog.source === 'api' ? 'catalog.source.api' : 'catalog.source.demo') : '';
  renderCatalog($('catalog-list'), items, state.item && state.item.slug, i18n, (slug) => selectItem(slug, null, null));
  if (!state.item) return;
  $('object-title').textContent = i18n.loc(state.item.title);
  document.title = `${i18n.loc(state.item.title)} — ${i18n.t('app.title')}`;
  renderModes($('mode-field'), state.item.modes, state.mode, state.catalog?.source === 'api', i18n, onMode);
  renderParams($('params-form'), $('params-note'), activeParams(), state.params, state.catalog?.source === 'api', i18n, onParam);
  renderExports($('exports'), $('export-note'), state.item.exports, state.catalog?.source === 'api', i18n, onExport, onLocalSvg);
  if (state.json) buildDiagramView();
  if (state.controls) state.controls.relabel();
  if (state.json) state.updateSteps = renderSteps($('steps'), $('steps-card'), state.json, i18n, (v) => setPrimary(v, true));
  syncSteps();
  renderStatusStatic();
}

function renderStatusStatic() {
  $('st-engine').textContent = state.engine ? i18n.t(state.engine.kind === 'engine' ? 'status.engine.real' : 'status.engine.stub') : '';
  const where = state.engine && state.engine.kind === 'engine' && state.where
    ? (state.where === 'worker' ? ' · steps in a Worker (off the main thread)' : ' · steps on the main thread') : '';
  $('st-engine').title = state.engine ? state.engine.reason + where : '';
  $('st-renderer').textContent = i18n.t('status.renderer', { name: state.renderer ? (state.renderer.kind === 'webgl2' ? 'WebGL2' : 'Canvas 2D') : i18n.t('status.renderer.none') });
}

function buildDiagramView() {
  const box = $('diagram');
  const title = i18n.t('diagram.title', { title: i18n.loc(state.item.title) });
  state.diagram = buildDiagram(state.json, { title });
  const legend = document.createElement('ul');
  legend.className = 'legend';
  legend.setAttribute('aria-label', i18n.t('diagram.legend'));
  for (const kind of legendKinds(state.json)) {
    const li = document.createElement('li');
    const sw = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sw.setAttribute('viewBox', '0 0 40 10'); sw.setAttribute('aria-hidden', 'true'); sw.setAttribute('class', 'swatch');
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const st = LINE_STYLE[kind];
    for (const [k, v] of Object.entries({ x1: 2, y1: 5, x2: 38, y2: 5, stroke: st.stroke, 'stroke-width': 2, 'stroke-dasharray': st.dash || '', class: `line line-${kind}` })) ln.setAttribute(k, String(v));
    sw.append(ln);
    const span = document.createElement('span');
    span.textContent = i18n.t(`diagram.${kind}`);
    li.append(sw, span);
    legend.append(li);
  }
  box.replaceChildren(state.diagram, legend);
  syncSteps();
}

function syncSteps() {
  if (!state.json || !state.controls) return;
  const id = state.controls.sequenceId;
  const v = id ? Number(state.controls.get(id)) : 0;
  state.updateSteps(v);
  // highlightStep walks every diagram line: only when the step changes (playback runs every frame)
  const k = id ? stepIndex(v, state.json['pliego:sequence'].steps.length) : -1;
  if (state.diagram && (state.diagram !== highlighted.svg || k !== highlighted.step)) {
    highlightStep(state.diagram, state.json, k);
    highlighted.svg = state.diagram; highlighted.step = k;
  }
}
const highlighted = { svg: /** @type {SVGSVGElement | null} */ (null), step: -2 };

function updateShare() {
  if (!state.item) return;
  const base = `${location.origin}${location.pathname}`;
  const mode = (state.item.modes || []).length > 1 ? state.mode : null;
  const url = buildShare(base, { slug: state.item.slug, mode, params: state.params, view: state.view, keep: new URLSearchParams(location.search) });
  $('share-url').value = url;
  try { history.replaceState(null, '', url); } catch { /* sandboxed */ }
}

// ---------- controls / playback ----------
function onControl(id, value) {
  if (!state.world) return;
  try { state.world.setControl(id, value); } catch (e) { fail('error.engine', e); }
  syncSteps();
  wake();
}

function setPrimary(v, stop) {
  const id = state.controls && state.controls.primaryId;
  if (!id) return;
  const [lo, hi] = state.controls.range(id);
  const val = Math.min(hi, Math.max(lo, v));
  state.controls.set(id, val);
  onControl(id, val);
  if (stop) setPlaying(false);
}

function setPlaying(on) {
  const id = state.controls && state.controls.primaryId;
  state.playing = !!on && !!id;
  const btn = $('btn-play');
  btn.setAttribute('aria-pressed', String(state.playing));
  const key = state.playing ? 'play.pause' : 'play.play';
  btn.setAttribute('data-i18n-attr', `aria-label:${key};title:${key}`);
  btn.setAttribute('aria-label', i18n.t(key)); btn.title = i18n.t(key);
  if (state.playing && id) {
    const [lo, hi] = state.controls.range(id);
    const v = Number(state.controls.get(id));
    if (state.controls.sequenceId) { state.playDir = 1; if (v >= hi) setPrimary(lo, false); }
    else state.playDir = v >= hi ? -1 : v <= lo ? 1 : state.playDir;
  }
  if (state.playing) wake();
}

function advancePlayback(dt) {
  const c = state.controls;
  if (!c || !c.primaryId) { state.playing = false; return; }
  const id = c.primaryId;
  const [lo, hi] = c.range(id);
  let v = Number(c.get(id));
  if (c.sequenceId) {
    const steps = state.json['pliego:sequence'].steps;
    const k = Math.min(steps.length - 1, Math.floor(v));
    v += (dt * 1000) / Math.max(100, steps[k].duration_ms);
    if (v >= hi) { v = hi; setPlaying(false); }
  } else {
    v += state.playDir * dt * (hi - lo) / 3;
    if (v >= hi || v <= lo) { v = Math.min(hi, Math.max(lo, v)); setPlaying(false); }
  }
  setPrimary(v, false);
}

function stepButton(dir) {
  const c = state.controls;
  if (!c || !c.primaryId) return;
  const [lo, hi] = c.range(c.primaryId);
  const v = Number(c.get(c.primaryId));
  if (c.sequenceId) setPrimary(dir > 0 ? Math.floor(v + 1e-6) + 1 : Math.ceil(v - 1e-6) - 1, true);
  else setPrimary(dir > 0 ? hi : lo, true);
}

// ---------- modes, parameters, exports ----------
/** The manifest parameters that apply to the current mode. */
function activeParams() {
  return state.item ? paramsForMode(state.item.parameters, state.mode) : [];
}

async function regenerateCurrent() {
  if (state.catalog?.source !== 'api') return;
  status(i18n.t('params.regenerating'));
  try {
    const json = await regenerate(state.item.slug, state.params, state.mode);
    await useDocument(json);
    status('');
  } catch (e) {
    status(i18n.t('params.failed', { error: e instanceof Error ? e.message : String(e) }));
  }
}

async function onMode(id) {
  if (!state.item || id === state.mode) return;
  state.mode = id;
  state.params = coerceParams(activeParams(), paramStrings(state.params));
  updateShare();
  renderAll();
  await regenerateCurrent();
}

async function onParam(id, value) {
  state.params = { ...state.params, [id]: value };
  updateShare();
  await regenerateCurrent();
}

async function onExport(format) {
  const name = `${state.item.slug}.${format}`;
  status(i18n.t('export.started', { name }));
  try { downloadBlob(await exportFile(state.item.slug, state.params, format, state.mode), name); }
  catch (e) { status(i18n.t('export.failed', { error: e instanceof Error ? e.message : String(e) })); }
}

function onLocalSvg() {
  if (!state.diagram) return;
  const name = `${state.item.slug}-crease-pattern.svg`;
  downloadBlob(new Blob([serializeDiagram(state.diagram)], { type: 'image/svg+xml' }), name);
  status(i18n.t('export.started', { name }));
}

// ---------- document / world ----------
function fail(key, e) {
  const msg = e instanceof Error ? e.message : String(e);
  state.failed = true;
  notice(i18n.t(key, { error: msg }));
  console.error(e);
}

// Live speed watch: the paper engine sleeps at rest, so only awake steps (≥ 1 ms) are averaged. A
// sustained average above SLOW_STEP_MS falls back to the preview, unless physics was asked for.
const speed = { n: 0, avg: 0, fired: false };
function noteStep(ms) {
  if (!state.engine || state.engine.kind !== 'engine' || state.physicsForced || ms < 1 || speed.fired) return;
  speed.n++;
  speed.avg = speed.n === 1 ? ms : 0.85 * speed.avg + 0.15 * ms;
  if (speed.n >= 20 && tooSlow(speed.avg)) {
    speed.fired = true;
    const avg = speed.avg;
    setTimeout(async () => {
      if (!state.json) return;
      await useDocument(state.json, { preview: true });
      notice(i18n.t('physics.slow', { ms: Math.round(avg) }));
    }, 0);
  }
}

function syncPhysicsButton() {
  const btn = $('btn-physics');
  const available = !!(state.physics && state.physics.kind === 'engine');
  btn.disabled = !available;
  btn.title = available ? '' : i18n.t('physics.unavailable');
  btn.setAttribute('aria-pressed', String(!!(state.engine && state.engine.kind === 'engine')));
}

let docGen = 0;
async function useDocument(json, opts = {}) {
  const gen = ++docGen;
  state.json = json;
  state.failed = false;
  notice('');
  setPlaying(false);
  if (state.world && typeof state.world.dispose === 'function') state.world.dispose();
  state.world = null;
  state.where = null;
  state.overlay = null;
  speed.n = 0; speed.avg = 0; speed.fired = false;
  const physicsOk = !!(state.physics && state.physics.kind === 'engine');
  const fits = state.physicsForced || physicsFits(json);
  state.engine = physicsOk && state.physicsWanted && !opts.preview && fits ? state.physics : state.preview;
  const real = state.engine.kind === 'engine';
  const heavyNotice = physicsOk && state.physicsWanted && !opts.preview && !fits
    ? i18n.t('physics.heavy', { n: estimateVertices(json, engineOptions(json).meshEdge) }) : '';
  /** @type {WorkerWorld | null} */
  let remote = null;
  if (real) {
    try {
      remote = await startEngineWorker({ off: state.share.worker === 'off', json, opts: engineOptions(json), probe: !state.physicsForced, onFrame: () => { pumpRemote(); kick(); }, onStep: noteStep });
    } catch (e) {
      if (state.share.worker !== 'off') { console.warn(`Paper engine on the main thread: ${e instanceof Error ? e.message : e}`); retireEngineWorker(); }
    }
    if (gen !== docGen) { if (remote) remote.dispose(); return; }   // a newer document took over
  }
  try {
    if (remote) { state.world = remote; state.where = 'worker'; }
    else {
      const doc = state.engine.mod.loadDocument(json);
      state.world = new state.engine.mod.World(doc, real ? engineOptions(json) : { seed: 1 });
      state.where = 'main';
    }
  } catch (e) {
    fail(state.world ? 'error.engine' : 'error.document', e);
  }
  state.controls = renderControls($('controls'), json, i18n, { needsEngine, onChange: onControl });
  if (state.world) {
    // the Worker applied the defaults (and ran the probe) before its first pose
    if (!remote) {
      for (const c of json['pliego:controls'] || []) {
        if (!needsEngine(c.id)) { try { state.world.setControl(c.id, c.default); } catch (e) { fail('error.engine', e); } }
      }
    }
    if (real && !state.physicsForced) {
      let ms = NaN;
      if (remote) ms = remote.probeMs;
      else try { ms = probeStep(state.world, STEP, () => performance.now()); } catch (e) { fail('error.engine', e); }
      if (tooSlow(ms)) {
        await useDocument(json, { preview: true });
        notice(i18n.t('physics.slow', { ms: Math.round(ms) }));
        return;
      }
    }
    const docOverlay = createOverlay(json, state.world);
    state.overlay = docOverlay && docOverlay.available() ? docOverlay : createEngineOverlay(state.world);
    if (state.renderer) state.renderer.setSheets(sheetsFromDocument(json), state.item.document || location.href);
  }
  syncPhysicsButton();
  renderStatusStatic();
  if (heavyNotice && !state.failed) notice(heavyNotice);
  const ovBtn = $('btn-overlay');
  const ovOk = !!(state.overlay && state.overlay.available());
  ovBtn.disabled = !ovOk;
  if (!ovOk) { state.overlayOn = false; ovBtn.setAttribute('aria-pressed', 'false'); }
  state.fitted = false;
  tracker.reset();
  shownOverlay = null;
  quiet = 0; received = 0;
  renderAll();
  if (!state.renderer || !state.world) setView('2d', false);
  invalidate();
}

async function selectItem(slug, rawParams, rawMode) {
  const item = state.catalog.items.find((it) => it.slug === slug) || state.catalog.items[0];
  if (!item) return;
  state.item = item;
  if (state.catalog.source === 'api' && !item.detailsLoaded) {
    try {
      const details = await fetchObject(item.slug);
      item.parameters = details.parameters;
      if (details.modes.length) item.modes = details.modes;
      item.exports = details.exports;
      item.detailsLoaded = true;
    } catch (e) {
      fail('error.document', e);
    }
  }
  const modes = item.modes || [];
  state.mode = modes.some((m) => m.id === rawMode) ? rawMode : modes.length ? modes[0].id : null;
  state.params = coerceParams(activeParams(), rawParams || {});
  renderAll();
  try {
    const custom = hasParams(rawParams) ? state.params : null;
    await useDocument(await fetchDocument(item, state.catalog.source, custom, state.mode));
  } catch (e) {
    fail('error.document', e);
  }
  updateShare();
}

// ---------- view, input, loop ----------
function setView(view, share = true) {
  const canUse3d = !!state.renderer && !!state.world;
  state.view = view === '3d' && canUse3d ? '3d' : '2d';
  $('view-3d').setAttribute('aria-pressed', String(state.view === '3d'));
  $('view-2d').setAttribute('aria-pressed', String(state.view === '2d'));
  $('view-3d').disabled = !canUse3d;
  if (state.renderer) state.renderer.canvas.hidden = state.view !== '3d';
  $('diagram').hidden = state.view !== '2d';
  if (share) updateShare();
  invalidate();
}

function setupInput() {
  const r = state.renderer;
  if (!r) return;
  state.input = attachInput(r.canvas, r.camera, {
    grabMode: () => state.grabMode,
    onGrabStart(ndc) {
      if (!state.world) return false;
      if (state.world.capabilities && state.world.capabilities.grab === false) { status(i18n.t('status.grabStub')); return false; }
      const ray = r.camera.ray(ndc[0], ndc[1]);
      const hit = state.world.pick(ray.origin, ray.dir);
      if (!hit) return false;
      state.world.grab(hit.vertex, hit.point);
      state.grabbing = { plane: hit.point, normal: r.camera.forward() };
      wake();
      return true;
    },
    onGrabMove(ndc) {
      if (!state.grabbing || !state.world) return;
      const ray = r.camera.ray(ndc[0], ndc[1]);
      const p = rayPlane(ray.origin, ray.dir, state.grabbing.plane, state.grabbing.normal);
      if (p) state.world.moveGrab(p);
      wake();
    },
    onGrabEnd() { if (state.world) state.world.release(); state.grabbing = null; wake(); },
    onChange: invalidate,
  });
}

// The loop runs while something moves (playback, a grab, a pose that changed lately) or the view
// needs drawing; otherwise it sleeps until kick() (controls, input, a Worker pose, resize, theme).
const tracker = createChangeTracker();
const ovView = { positions: new Float32Array(0), colors: new Float32Array(0), faint: true };
/** @type {{positions: Float32Array, colors: Float32Array} | null} */
let shownOverlay = null;
let scheduled = false, redraw = true, quiet = 0, received = 0;
let last = 0, acc = 0, frames = 0, fpsT = 0;

function kick() {
  if (scheduled || document.hidden) return;
  scheduled = true;
  requestAnimationFrame(frame);
}

/** The view must be drawn again (camera, size, theme, overlay, printed art). */
function invalidate() { redraw = true; kick(); }

/** The world may move again (a control, a grab, playback, a new document): step it. */
function wake() { quiet = 0; pumpRemote(); kick(); }

/** A settled world (the same pose for a while, nothing driving it) is not stepped until woken. */
function settled() {
  return quiet >= quietLimit(state.engine ? state.engine.kind : 'stub') && !state.playing && !state.grabbing;
}

/** A Worker engine is stepped when its last pose lands (WorkerWorld.pump), not at the next frame. */
function pumpRemote() {
  const w = state.world;
  if (w instanceof WorkerWorld && !state.failed && !settled()) try { w.pump(STEP); } catch (e) { fail('error.engine', e); }
}

function frame(now) {
  scheduled = false;
  const dt = last ? Math.min(0.25, (now - last) / 1000) : STEP;
  last = now;
  const world = state.world;
  if (!world || state.failed) { last = 0; return; }
  let changed = false;
  try {
    if (state.playing) advancePlayback(dt);
    // The paper engine takes one fixed step per frame at most: its steps are the expensive part, and
    // catching up would only make a slow frame slower. The preview may catch up to four. A Worker
    // engine is stepped by pumpRemote, one step in flight at most.
    const remote = world instanceof WorkerWorld;
    if (remote) pumpRemote();
    else {
      const maxSteps = settled() ? 0 : state.engine && state.engine.kind === 'engine' ? 1 : 4;
      const plan = planSteps(acc, dt, STEP, maxSteps);
      acc = plan.acc;
      for (let i = 0; i < plan.n; i++) {
        const t0 = performance.now();
        world.step(STEP);
        noteStep(performance.now() - t0);
      }
    }
    const r = world.render();
    changed = tracker.changed(r);
    if (state.view === '3d' && state.renderer && (changed || redraw)) {
      if (changed || !shownOverlay) shownOverlay = state.overlay ? state.overlay.build() : null;
      let ov = null;
      if (shownOverlay) { ovView.positions = shownOverlay.positions; ovView.colors = shownOverlay.colors; ovView.faint = !state.overlayOn; ov = ovView; }
      const bounds = state.renderer.draw(r, ov, changed);
      redraw = false;
      if (!state.fitted && bounds) { state.renderer.camera.fit(bounds.center, bounds.radius); state.fitted = true; redraw = true; }
    }
  } catch (e) {
    fail('error.engine', e);
    return;
  }
  // quiet counts identical poses: per frame on the main thread, per arrived pose for a Worker
  if (!(world instanceof WorkerWorld)) quiet = changed ? 0 : quiet + 1;
  else if (world.received !== received) { received = world.received; quiet = changed ? 0 : quiet + 1; }
  frames++;
  const running = keepRunning({
    playing: state.playing, redraw: redraw && state.view === '3d', grabbing: !!state.grabbing,
    pending: world instanceof WorkerWorld && world.pending, quietFrames: quiet,
    engine: state.engine ? state.engine.kind : 'stub', hidden: document.hidden,
  });
  if (now - fpsT > 500 || !running) {
    state.fps = (frames * 1000) / (now - fpsT || 1);
    frames = 0; fpsT = now;
    const s = world.stats ? world.stats() : null;
    $('st-fps').textContent = running ? i18n.t('status.fps', { fps: Math.round(state.fps) }) : i18n.t('status.idle');
    $('st-strain').textContent = s ? i18n.t('status.strain', { value: ((s.maxStrain || 0) * 100).toFixed(2) }) : '';
    $('st-contacts').textContent = s ? i18n.t('status.contacts', { n: s.contacts || 0 }) : '';
  }
  if (running) kick();
  else { last = 0; acc = 0; if (world instanceof WorkerWorld) world.resetPacing(); }
}

function wireStatic() {
  const sel = $('lang-select');
  sel.value = i18n.lang;
  sel.addEventListener('change', () => i18n.setLang(sel.value));
  document.addEventListener(LANG_EVENT, () => { sel.value = i18n.lang; renderAll(); setPlaying(state.playing); });
  $('view-3d').addEventListener('click', () => setView('3d'));
  $('view-2d').addEventListener('click', () => setView('2d'));
  $('btn-play').addEventListener('click', () => setPlaying(!state.playing));
  $('btn-back').addEventListener('click', () => stepButton(-1));
  $('btn-forward').addEventListener('click', () => stepButton(1));
  $('btn-restart').addEventListener('click', () => { const c = state.controls; if (c && c.primaryId) setPrimary(c.range(c.primaryId)[0], true); });
  $('btn-reset').addEventListener('click', () => { if (state.renderer) { state.renderer.camera.reset(); invalidate(); } });
  $('btn-grab').addEventListener('click', () => { state.grabMode = !state.grabMode; $('btn-grab').setAttribute('aria-pressed', String(state.grabMode)); $('viewer').classList.toggle('grab', state.grabMode); });
  $('btn-overlay').addEventListener('click', () => { state.overlayOn = !state.overlayOn; $('btn-overlay').setAttribute('aria-pressed', String(state.overlayOn)); invalidate(); });
  $('btn-physics').addEventListener('click', async () => {
    const on = !(state.engine && state.engine.kind === 'engine');
    state.physicsWanted = on;
    state.physicsForced = on;   // an explicit request is honoured even when it is slow
    if (state.json) await useDocument(state.json);
  });
  $('btn-copy').addEventListener('click', async () => {
    const input = $('share-url');
    try { await navigator.clipboard.writeText(input.value); status(i18n.t('share.copied')); }
    catch { input.select(); status(i18n.t('share.copyFailed')); }
  });
  const scheme = globalThis.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  if (scheme) scheme.addEventListener('change', () => { if (state.renderer) { state.renderer.refreshTheme(); invalidate(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); });
  globalThis.addEventListener('resize', invalidate);
  if (reducedMotion && reducedMotion.matches) document.documentElement.classList.add('reduced-motion');
}

async function init() {
  i18n.apply();
  document.documentElement.classList.remove('i18n-pending');
  wireStatic();
  state.physics = await loadEngine(state.share.engine);   // the paper engine when mounted (the stub when absent or ?engine=stub)
  state.preview = state.physics.kind === 'stub' ? state.physics : await loadPreview();
  state.physicsWanted = state.physics.kind === 'engine';
  state.physicsForced = state.share.engine === 'physics';
  state.engine = state.physicsWanted ? state.physics : state.preview;
  const canvas = $('view-canvas');
  state.renderer = createRenderer(canvas, { prefer: rendererOverride(state.share.renderer), onWarn: (m) => console.warn(m), onInvalidate: invalidate });
  if (state.renderer && typeof ResizeObserver === 'function') new ResizeObserver(invalidate).observe(state.renderer.canvas);
  if (!state.renderer) notice(i18n.t('viewer.none'));
  else if (state.renderer.kind === 'canvas2d' && rendererOverride(state.share.renderer) !== 'canvas2d') notice(i18n.t('viewer.canvas2d'));
  const noticeText = $('viewer-notice').textContent;
  setupInput();
  renderStatusStatic();
  state.view = state.share.view;
  try {
    state.catalog = await loadCatalog(location.href);
  } catch (e) {
    $('catalog-source').textContent = i18n.t('catalog.error');
    fail('error.document', e);
    return;
  }
  await selectItem(state.share.slug || state.catalog.items[0]?.slug, state.share.params, state.share.mode);
  if (!$('viewer-notice').textContent && noticeText) notice(noticeText);
  setView(state.share.view, false);
  kick();
}

init();
