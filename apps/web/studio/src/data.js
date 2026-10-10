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
      exports: Array.isArray(it.export_formats) ? it.export_formats : DEFAULT_EXPORTS,
    }));
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
export async function fetchDocument(item, source, params) {
  if (source === 'api' && (!item.document || params)) return regenerate(item.slug, params || {});
  if (!item.document) throw new Error(`no document for ${item.slug}`);
  return fetchJson(item.document);
}

/** POST /api/v1/documents {slug, params} → sheet document. */
export function regenerate(slug, params) {
  return fetchJson(`${API}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, params }),
  });
}

/** POST /api/v1/exports {slug, params, format} → Blob. */
export async function exportFile(slug, params, format) {
  const res = await fetch(`${API}/exports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, params, format }),
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
