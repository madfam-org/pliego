// @ts-check
// Data access for the studio: catalog (API first, demo fallback), documents, regeneration and
// exports through the Pliego API (/api/v1, same origin), and the engine loader (real engine at
// /engine/index.js, stub otherwise). Every failure is surfaced to the caller; nothing is swallowed
// except the expected "API not running" probe, which is reported as `source: 'demo'`.

export const API = '/api/v1';
export const DEFAULT_EXPORTS = ['svg', 'dxf', 'pdf', 'glb'];

/** @param {string} url @param {RequestInit} [init] */
export async function fetchJson(url, init) {
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init && init.headers) } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText || 'error'} (${url})`);
  const ct = res.headers.get('content-type') || '';
  if (!/json/.test(ct)) throw new Error(`not JSON (${url})`);
  return res.json();
}

/**
 * Accepts the demo shape ({items: [...]}) and tolerant API shapes ({projects: [...]} or an array).
 * @param {any} j
 * @param {string} base URL the relative document paths resolve against
 */
export function normalizeCatalog(j, base) {
  const arr = Array.isArray(j) ? j : (j && (j.items || j.projects || j.objects)) || [];
  return arr
    .filter((it) => it && typeof it.slug === 'string')
    .map((it) => ({
      slug: it.slug,
      title: it.title || it.name || { en: it.slug },
      summary: it.summary || it.description || null,
      document: it.document ? new URL(it.document, base).href : null,
      parameters: Array.isArray(it.parameters) ? it.parameters : [],
      modes: normalizeModes(it.modes),
      exports: Array.isArray(it.export_formats) ? it.export_formats : DEFAULT_EXPORTS,
    }));
}

/**
 * Modes arrive as ids (catalog, `modes` on the object detail) or as manifest entries
 * ({id, label, ...}); both become [{id, label}].
 * @param {any} raw
 * @returns {{id: string, label: any}[]}
 */
export function normalizeModes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => (typeof m === 'string' ? { id: m, label: null } : m && typeof m.id === 'string' ? { id: m.id, label: m.label || null } : null))
    .filter((m) => m !== null);
}

/** @returns {Promise<{source: 'api'|'demo', items: ReturnType<typeof normalizeCatalog>}>} */
export async function loadCatalog(studioBase) {
  try {
    const j = await fetchJson(`${API}/catalog`);
    return { source: 'api', items: normalizeCatalog(j, new URL(`${API}/`, studioBase).href) };
  } catch {
    const url = new URL('demo/catalog.json', studioBase).href;
    const j = await fetchJson(url);
    return { source: 'demo', items: normalizeCatalog(j, url) };
  }
}

/** Fetch the item's document; with the API, a slug without a static document is generated. */
export async function fetchDocument(item, source, params, mode) {
  if (source === 'api' && (!item.document || params)) return regenerate(item.slug, params || {}, mode);
  if (!item.document) throw new Error(`no document for ${item.slug}`);
  return fetchJson(item.document);
}

/**
 * GET /api/v1/objects/<slug> → the object's full manifest. The catalog is a summary (it reports a
 * parameter COUNT and bare mode ids); parameters, labelled modes and export formats come from here.
 * @param {string} slug
 * @returns {Promise<{parameters: any[], modes: {id: string, label: any}[], exports: string[]}>}
 */
export async function fetchObject(slug) {
  const j = await fetchJson(`${API}/objects/${encodeURIComponent(slug)}`);
  const manifest = (j && j.manifest) || {};
  const modes = normalizeModes(manifest.modes);
  return {
    parameters: Array.isArray(manifest.parameters) ? manifest.parameters : [],
    modes: modes.length ? modes : normalizeModes(j && j.modes),
    exports: Array.isArray(j && j.export_formats) ? j.export_formats : DEFAULT_EXPORTS,
  };
}

/**
 * Request body for /documents and /exports. The API requires `mode` when an object has more than
 * one; it is left out when unknown (single-mode objects resolve it themselves).
 * @param {string} slug @param {Record<string, any>} params @param {string|null|undefined} mode
 * @param {Record<string, any>} [extra]
 */
export function renderBody(slug, params, mode, extra = {}) {
  return JSON.stringify({ slug, ...(mode ? { mode } : {}), params, ...extra });
}

/** POST /api/v1/documents {slug, mode?, params} → sheet document. */
export function regenerate(slug, params, mode) {
  return fetchJson(`${API}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: renderBody(slug, params, mode),
  });
}

/** POST /api/v1/exports {slug, mode?, params, format} → Blob. */
export async function exportFile(slug, params, format, mode) {
  const res = await fetch(`${API}/exports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: renderBody(slug, params, mode, { format }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText || 'error'}`);
  return res.blob();
}

/** Trigger a browser download of a Blob (same-origin blob: URL, revoked afterwards). */
export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Load the real engine when it is mounted at /engine/ and exposes World + loadDocument;
 * otherwise the stub. `prefer === 'stub'` forces the stub (testing).
 * @returns {Promise<{mod: any, kind: 'engine'|'stub', reason: string}>}
 */
export async function loadEngine(prefer) {
  let reason = 'forced by ?engine=stub';
  if (prefer !== 'stub') {
    try {
      const mod = await import('/engine/index.js');
      if (typeof mod.World === 'function' && typeof mod.loadDocument === 'function') return { mod, kind: 'engine', reason: 'engine mounted at /engine/' };
      reason = '/engine/index.js has no World/loadDocument yet';
    } catch (e) {
      reason = `/engine/index.js not available (${e instanceof Error ? e.message : e})`;
    }
  }
  const mod = await import('./engine-stub.js');
  return { mod, kind: 'stub', reason };
}
