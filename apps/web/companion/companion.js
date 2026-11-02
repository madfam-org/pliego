// Thin local consumer of the owning Pliego preview/renderer. No geometry or guide engine here.
import { World, loadDocument } from '../studio/src/engine-stub.js';
import { createRenderer } from '../studio/src/render/index.js';
import { sheetsFromDocument } from '../studio/src/render/scene.js';
import { attachInput } from '../studio/src/render/input.js';
import { validateCompanion, safeSource, verifiedFile, verifiedBytes } from './companion-data.js';

const $ = id => document.getElementById(id);
const labels = {
  en: { local: 'Local archive companion', language: 'Language', title: 'Archive companion', scope: 'Authored eight-page paper study. Historical edition facts are separate from the unknown narrative, completion and walkthrough content.', native: 'Native paper construction', reading: 'Read the companion', construction: 'Construction state', reset: 'Reset view', note: 'The native sequence shows assembly. It does not turn reading pages independently.', previous: 'Previous', next: 'Next', states: ['Flat sheets', 'Nested sheets', 'Stapled', 'Shut booklet'], evidence: 'Source and physical-page mapping', mapping: 'Logical pages and their native sheet sides', page: 'Page', sheet: 'Sheet', side: 'Side', half: 'Half', front: 'front', back: 'back', L: 'left', R: 'right', source: 'Source record', webgl: 'Native Pliego rigid preview · WebGL2 · printed faces', fallback: 'Native Pliego rigid preview · Canvas2D · artwork unavailable; use the reading text', exports: 'The native GLB is untextured and PDF omits artwork. This local viewer uses the art-bearing native FOLD and Pliego renderer. No print-ready guide export is claimed.', error: 'The local companion could not be checked. Restart the preview with the reviewed companion directory and reload.', sourceNote: 'Authored eight-page paper format. Native geometry and construction are unchanged; safe typographic artwork was added and the derived FOLD verified. Physical fit, print proof and historical manual fidelity were not assessed.' },
  es: { local: 'Compañero de archivo local', language: 'Idioma', title: 'Compañero de archivo', scope: 'Estudio en papel de ocho páginas de diseño propio. Los datos históricos de la edición se distinguen del contenido narrativo, de avance y de guía aún desconocido.', native: 'Construcción nativa en papel', reading: 'Leer el compañero', construction: 'Estado de construcción', reset: 'Restablecer vista', note: 'La secuencia nativa muestra el armado. No pasa las páginas de lectura por separado.', previous: 'Anterior', next: 'Siguiente', states: ['Pliegos planos', 'Pliegos encajados', 'Engrapado', 'Cuadernillo cerrado'], evidence: 'Fuente y correspondencia de páginas físicas', mapping: 'Páginas lógicas y sus caras en los pliegos nativos', page: 'Página', sheet: 'Pliego', side: 'Cara', half: 'Mitad', front: 'frente', back: 'reverso', L: 'izquierda', R: 'derecha', source: 'Registro fuente', webgl: 'Vista previa rígida nativa de Pliego · WebGL2 · caras impresas', fallback: 'Vista previa rígida nativa de Pliego · Canvas2D · sin ilustración; usa el texto de lectura', exports: 'El GLB nativo no tiene texturas y el PDF omite la ilustración. Esta vista local usa el FOLD nativo con composición tipográfica y el visor de Pliego. No se ofrece una guía lista para imprimir.', error: 'No se pudo comprobar el compañero local. Reinicia la vista previa con la carpeta revisada del compañero y vuelve a cargar.', sourceNote: 'Formato en papel de ocho páginas de diseño propio. Se conservan la geometría y la construcción nativas; se añadió composición tipográfica segura y se verificó el FOLD derivado. No se evaluaron ajuste físico, prueba de impresión ni fidelidad al manual histórico.' }
};
let lang = new URLSearchParams(location.search).get('lang') === 'es' ? 'es' : 'en';
let manifest, content, world, renderer, input, observer, page = 0, frame = 0, disposed = false, pageImageUrl = null, imageGeneration = 0;
const text = () => labels[lang];

function draw(fit = false) {
  if (!renderer || !world || disposed || document.hidden) return;
  renderer.resize();
  const mesh = world.render();
  const bounds = renderer.draw(mesh, null, true);
  if (fit && bounds) { renderer.camera.fit(bounds.center, bounds.radius); renderer.draw(mesh, null, false); }
}
function kick() {
  if (!frame && !disposed) frame = requestAnimationFrame(() => { frame = 0; draw(); });
}
async function pageImage() {
  const generation = ++imageGeneration;
  const bytes = await verifiedBytes(`pages/${lang}/page-${page+1}.svg`, manifest.files);
  if (generation !== imageGeneration || disposed) return;
  if (pageImageUrl) URL.revokeObjectURL(pageImageUrl);
  pageImageUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/svg+xml' }));
  const image = document.createElement('img');
  image.src = pageImageUrl; image.width = 315;
  image.height = Math.round(315 * manifest.native.resolved_parameters.page_height / manifest.native.resolved_parameters.page_width);
  image.alt = lang === 'es' ? 'Composición tipográfica propia, transcrita arriba' : 'Authored typographic page, transcribed above';
  $('page-image').replaceChildren(image);
}
function readPage() {
  const p = content.pages[page], mapping = manifest.pages[page], l = text();
  $('page-content').replaceChildren();
  const heading = document.createElement('h3'); heading.textContent = p.title[lang]; $('page-content').append(heading);
  for (const line of p.paragraphs[lang]) { const para = document.createElement('p'); para.textContent = line; $('page-content').append(para); }
  $('physical-location').textContent = `${l.page} ${page+1}/8 · ${mapping.sheet} · ${l[mapping.side]} · ${l[mapping.half]}`;
  $('page-sources').replaceChildren();
  for (const source of p.sources) { const li = document.createElement('li'), a = document.createElement('a'); a.href = safeSource(source); a.textContent = `${l.source} · ${new URL(source).hostname}`; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a); $('page-sources').append(li); }
  $('page-image-title').textContent = lang === 'es' ? 'Inspeccionar la imagen de esta página propia' : 'Inspect this authored page image';
  pageImage().catch(fail);
  $('page').value = String(page);
  $('previous').disabled = page === 0; $('next').disabled = page === 7;
}
function relabel() {
  const l = text(); document.documentElement.lang = lang; document.title = `${l.title} · Pliego`;
  for (const [id,key] of Object.entries({ 'local-label':'local', 'language-label':'language', title:'title', scope:'scope', 'native-title':'native', 'reading-title':'reading', 'construction-label':'construction', reset:'reset', 'construction-note':'note', previous:'previous', next:'next', 'evidence-title':'evidence', 'mapping-caption':'mapping', 'head-page':'page', 'head-sheet':'sheet', 'head-side':'side', 'head-half':'half', 'historical-record':'source', 'export-note':'exports', 'source-note':'sourceNote' })) $(id).textContent = l[key];
  document.querySelector('.skip').textContent = lang === 'es' ? 'Ir a la lectura' : 'Skip to reading';
  document.querySelector('.page-nav').setAttribute('aria-label', l.reading);
  document.querySelector('label[for="page"]').textContent = l.page;
  $('language').value = lang;
  [...$('construction').options].forEach((option,i) => { option.textContent = l.states[i]; });
  $('page').replaceChildren(...content.pages.map((p,i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${i+1} · ${p.title[lang]}`; return o; }));
  $('mapping').replaceChildren(...manifest.pages.map(p => { const tr = document.createElement('tr'); for (const value of [p.number,p.sheet,l[p.side],l[p.half]]) { const td = document.createElement('td'); td.textContent = String(value); tr.append(td); } return tr; }));
  $('title').textContent = `${content.edition.title} · ${l.title}`;
  $('source-note').textContent = `${l.sourceNote} ${manifest.native.resolved_parameters.page_width} × ${manifest.native.resolved_parameters.page_height} mm.`;
  if (manifest.handoff) {
    $('experience-links').hidden = false;
    $('experience-links').setAttribute('aria-label', lang === 'es' ? 'Edición relacionada' : 'Related edition');
    for (const [id,key] of [['gallery-link','gallery_url'],['reveal-link','reveal_url']]) {
      const url = new URL(safeSource(manifest.handoff[key])); url.searchParams.set('lang',lang); $(id).href = url.href;
    }
    $('gallery-link').textContent = lang === 'es' ? 'Ver esta edición en la galería' : 'View this edition in the gallery';
    $('reveal-link').textContent = lang === 'es' ? 'Abrir su reconstrucción' : 'Open its reconstruction';
  }
  readPage();
}
let nativeGeneration = 0;
async function nativeBook() {
  const generation = ++nativeGeneration, requestedLanguage = lang;
  const doc = await verifiedFile(`book-${requestedLanguage}.fold`, manifest.files);
  if (generation !== nativeGeneration || disposed) return;
  world = new World(loadDocument(doc), { seed: 1 });
  world.setControl('sequence', Number($('construction').value));
  renderer.setSheets(sheetsFromDocument(doc), new URL('/companion-data/', location.href).href);
  $('renderer-status').textContent = renderer.kind === 'webgl2' ? text().webgl : text().fallback;
  renderer.canvas.setAttribute('aria-label', text().native);
  draw(true);
}
async function boot() {
  const response = await fetch('/companion-data/companion.json');
  if (!response.ok) throw new Error('Companion manifest unavailable');
  manifest = await response.json();
  content = await verifiedFile('content.json', manifest.files);
  validateCompanion(manifest, content);
  $('workspace').hidden = false; $('evidence').hidden = false;
  $('historical-record').href = safeSource(content.edition.record_url);
  relabel();
  renderer = createRenderer($('book'), { prefer: new URLSearchParams(location.search).get('renderer') === 'canvas2d' ? 'canvas2d' : null, onInvalidate: kick });
  if (!renderer) { $('renderer-status').textContent = text().fallback; return; }
  input = attachInput(renderer.canvas, renderer.camera, { onChange: kick });
  observer = new ResizeObserver(() => draw(true)); observer.observe(renderer.canvas.parentElement);
  await nativeBook();
}
function fail() {
  if (!content) {
    document.documentElement.lang = lang;
    document.title = `${text().title} · Pliego`;
    $('local-label').textContent = text().local;
    $('language-label').textContent = text().language;
    $('language').value = lang;
    document.querySelector('.skip').textContent = lang === 'es' ? 'Ir a la lectura' : 'Skip to reading';
    $('title').textContent = text().title;
    $('scope').textContent = lang === 'es' ? 'No se cargaron los datos del compañero local.' : 'The local companion data was not loaded.';
  }
  $('error').hidden = false; $('error').textContent = text().error;
}
$('previous').addEventListener('click', () => { page = Math.max(0,page-1); readPage(); });
$('next').addEventListener('click', () => { page = Math.min(7,page+1); readPage(); });
$('page').addEventListener('change', () => { page = Number($('page').value); readPage(); });
$('construction').addEventListener('change', () => { world?.setControl('sequence', Number($('construction').value)); draw(true); });
$('reset').addEventListener('click', () => { renderer?.camera.reset(); kick(); });
$('language').addEventListener('change', async () => {
  lang = $('language').value === 'es' ? 'es' : 'en';
  if (!content) { fail(); return; }
  relabel();
  try { if (renderer) await nativeBook(); } catch { fail(); }
});
addEventListener('visibilitychange', kick);
addEventListener('pagehide', () => { disposed = true; if (pageImageUrl) URL.revokeObjectURL(pageImageUrl); cancelAnimationFrame(frame); input?.destroy(); observer?.disconnect(); renderer?.destroy(); });
boot().catch(fail);
