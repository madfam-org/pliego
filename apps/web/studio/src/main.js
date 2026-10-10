// @ts-check
// Pliego Studio — wiring: catalog → document → engine World → renderer, panels, share URL, i18n.

import { createI18n, LANG_EVENT } from '../../shared/i18n.js';
import { STUDIO_STRINGS } from './strings.js';
import { loadCatalog, fetchDocument, regenerate, exportFile, downloadBlob, loadEngine } from './data.js';
import { parseShare, buildShare, coerceParams } from './share.js';
import { buildDiagram, highlightStep, serializeDiagram, createOverlay, legendKinds, LINE_STYLE } from './diagram.js';
import { renderCatalog, renderParams, renderControls, renderSteps, renderExports, stepIndex } from './panels.js';
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
  engine: /** @type {{mod: any, kind: 'engine'|'stub', reason: string} | null} */ (null),
  renderer: /** @type {import('./render/index.js').Renderer | null} */ (null),
  input: /** @type {{destroy(): void} | null} */ (null),
  catalog: /** @type {{source: 'api'|'demo', items: any[]} | null} */ (null),
  item: /** @type {any} */ (null),
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
  for (const m of j['pliego:mechanisms'] || []) {
    if ((m.control || m.angle_control) !== id) continue;
    if (m.type === 'slide') return true;
    if (joins.some((jn) => jn.mechanism === m.id)) return true;   // driven pins / sliders
    const moving = new Set(m.sheets_moving || []);
    if (joins.some((jn) => (jn.type === 'glue' || jn.type === 'pivot' || jn.type === 'string') && jn.a && jn.b &&
      moving.has(jn.a.sheet) !== moving.has(jn.b.sheet || ''))) return true;
  }
  return false;
}

// ---------- rendering of panels ----------
function renderAll() {
  const items = state.catalog ? state.catalog.items : [];
  $('catalog-source').textContent = state.catalog ? i18n.t(state.catalog.source === 'api' ? 'catalog.source.api' : 'catalog.source.demo') : '';
  renderCatalog($('catalog-list'), items, state.item && state.item.slug, i18n, (slug) => selectItem(slug, null));
  if (!state.item) return;
  $('object-title').textContent = i18n.loc(state.item.title);
  document.title = `${i18n.loc(state.item.title)} — ${i18n.t('app.title')}`;
  renderParams($('params-form'), $('params-note'), state.item.parameters, state.params, state.catalog?.source === 'api', i18n, onParam);
  renderExports($('exports'), $('export-note'), state.item.exports, state.catalog?.source === 'api', i18n, onExport, onLocalSvg);
  if (state.json) buildDiagramView();
  if (state.controls) state.controls.relabel();
  if (state.json) state.updateSteps = renderSteps($('steps'), $('steps-card'), state.json, i18n, (v) => setPrimary(v, true));
  syncSteps();
  renderStatusStatic();
}

function renderStatusStatic() {
  $('st-engine').textContent = state.engine ? i18n.t(state.engine.kind === 'engine' ? 'status.engine.real' : 'status.engine.stub') : '';
  $('st-engine').title = state.engine ? state.engine.reason : '';
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
  if (state.diagram) highlightStep(state.diagram, state.json, id ? stepIndex(v, state.json['pliego:sequence'].steps.length) : -1);
}

function updateShare() {
  if (!state.item) return;
  const base = `${location.origin}${location.pathname}`;
  const url = buildShare(base, { slug: state.item.slug, params: state.params, view: state.view, keep: new URLSearchParams(location.search) });
  $('share-url').value = url;
  try { history.replaceState(null, '', url); } catch { /* sandboxed */ }
}

// ---------- controls / playback ----------
function onControl(id, value) {
  if (!state.world) return;
  try { state.world.setControl(id, value); } catch (e) { fail('error.engine', e); }
  syncSteps();
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

// ---------- parameters, exports ----------
async function onParam(id, value) {
  state.params = { ...state.params, [id]: value };
  updateShare();
  if (state.catalog?.source !== 'api') return;
  status(i18n.t('params.regenerating'));
  try {
    const json = await regenerate(state.item.slug, state.params);
    await useDocument(json);
    status('');
  } catch (e) {
    status(i18n.t('params.failed', { error: e instanceof Error ? e.message : String(e) }));
  }
}

async function onExport(format) {
  const name = `${state.item.slug}.${format}`;
  status(i18n.t('export.started', { name }));
  try { downloadBlob(await exportFile(state.item.slug, state.params, format), name); }
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

async function useDocument(json) {
  state.json = json;
  state.failed = false;
  notice('');
  setPlaying(false);
  state.world = null;
  state.overlay = null;
  try {
    const doc = state.engine.mod.loadDocument(json);
    state.world = new state.engine.mod.World(doc, { seed: 1 });
  } catch (e) {
    fail(state.world ? 'error.engine' : 'error.document', e);
  }
  state.controls = renderControls($('controls'), json, i18n, { needsEngine, onChange: onControl });
  if (state.world) {
    for (const c of json['pliego:controls'] || []) {
      if (!needsEngine(c.id)) { try { state.world.setControl(c.id, c.default); } catch (e) { fail('error.engine', e); } }
    }
    state.overlay = createOverlay(json, state.world);
    if (state.renderer) state.renderer.setSheets(sheetsFromDocument(json), state.item.document || location.href);
  }
  const ovBtn = $('btn-overlay');
  const ovOk = !!(state.overlay && state.overlay.available());
  ovBtn.disabled = !ovOk;
  if (!ovOk) { state.overlayOn = false; ovBtn.setAttribute('aria-pressed', 'false'); }
  state.fitted = false;
  renderAll();
  if (!state.renderer || !state.world) setView('2d', false);
}

async function selectItem(slug, rawParams) {
  const item = state.catalog.items.find((it) => it.slug === slug) || state.catalog.items[0];
  if (!item) return;
  state.item = item;
  state.params = coerceParams(item.parameters, rawParams || {});
  renderAll();
  try {
    const custom = rawParams && Object.keys(rawParams).length ? state.params : null;
    await useDocument(await fetchDocument(item, state.catalog.source, custom));
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
      return true;
    },
    onGrabMove(ndc) {
      if (!state.grabbing || !state.world) return;
      const ray = r.camera.ray(ndc[0], ndc[1]);
      const p = rayPlane(ray.origin, ray.dir, state.grabbing.plane, state.grabbing.normal);
      if (p) state.world.moveGrab(p);
    },
    onGrabEnd() { if (state.world) state.world.release(); state.grabbing = null; },
  });
}

let last = 0, acc = 0, frames = 0, fpsT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = last ? Math.min(0.25, (now - last) / 1000) : STEP;
  last = now;
  const world = state.world;
  if (!world || state.failed) return;
  try {
    if (state.playing) advancePlayback(dt);
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 4) { world.step(STEP); acc -= STEP; n++; }
    if (n === 4) acc = 0;   // never spiral: drop time rather than run variable steps
    if (state.view === '3d' && state.renderer) {
      const r = world.render();
      const ov = state.overlayOn && state.overlay ? state.overlay.build() : null;
      const bounds = state.renderer.draw(r, ov);
      if (!state.fitted && bounds) { state.renderer.camera.fit(bounds.center, bounds.radius); state.fitted = true; }
    }
  } catch (e) {
    fail('error.engine', e);
    return;
  }
  frames++;
  if (now - fpsT > 500) {
    state.fps = (frames * 1000) / (now - fpsT || 1);
    frames = 0; fpsT = now;
    const s = world.stats ? world.stats() : null;
    $('st-fps').textContent = i18n.t('status.fps', { fps: Math.round(state.fps) });
    $('st-strain').textContent = s ? i18n.t('status.strain', { value: ((s.maxStrain || 0) * 100).toFixed(2) }) : '';
    $('st-contacts').textContent = s ? i18n.t('status.contacts', { n: s.contacts || 0 }) : '';
  }
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
  $('btn-reset').addEventListener('click', () => state.renderer && state.renderer.camera.reset());
  $('btn-grab').addEventListener('click', () => { state.grabMode = !state.grabMode; $('btn-grab').setAttribute('aria-pressed', String(state.grabMode)); $('viewer').classList.toggle('grab', state.grabMode); });
  $('btn-overlay').addEventListener('click', () => { state.overlayOn = !state.overlayOn; $('btn-overlay').setAttribute('aria-pressed', String(state.overlayOn)); });
  $('btn-copy').addEventListener('click', async () => {
    const input = $('share-url');
    try { await navigator.clipboard.writeText(input.value); status(i18n.t('share.copied')); }
    catch { input.select(); status(i18n.t('share.copyFailed')); }
  });
  const scheme = globalThis.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  if (scheme) scheme.addEventListener('change', () => state.renderer && state.renderer.refreshTheme());
  if (reducedMotion && reducedMotion.matches) document.documentElement.classList.add('reduced-motion');
}

async function init() {
  i18n.apply();
  document.documentElement.classList.remove('i18n-pending');
  wireStatic();
  state.engine = await loadEngine(state.share.engine);
  const canvas = $('view-canvas');
  state.renderer = createRenderer(canvas, { prefer: rendererOverride(state.share.renderer), onWarn: (m) => console.warn(m) });
  if (!state.renderer) notice(i18n.t('viewer.none'));
  else if (state.renderer.kind === 'canvas2d' && rendererOverride(state.share.renderer) !== 'canvas2d') notice(i18n.t('viewer.canvas2d'));
  const noticeText = $('viewer-notice').textContent;
  setupInput();
  renderStatusStatic();
  try {
    state.catalog = await loadCatalog(location.href);
  } catch (e) {
    $('catalog-source').textContent = i18n.t('catalog.error');
    fail('error.document', e);
    return;
  }
  await selectItem(state.share.slug || state.catalog.items[0]?.slug, state.share.params);
  if (!$('viewer-notice').textContent && noticeText) notice(noticeText);
  setView(state.share.view, false);
  requestAnimationFrame(frame);
}

init();
