// @ts-check
// Share-by-URL: the object slug (and, for objects with several modes, the mode) lives in the query
// (`?slug=…&mode=…`), parameter values in the hash (`#width=200&stock=kami`), and studio-only state
// under reserved underscore keys (`_view=2d`). Pure functions so Node tests can cover them.
// URL input stays in URLSearchParams: no object property is ever named by a user-supplied key
// (no prototype pollution, no shadowed builtins). Only manifest parameter ids are read out of it.

/**
 * @param {string} search location.search
 * @param {string} hash location.hash
 * @returns {{slug: string|null, mode: string|null, params: URLSearchParams, view: '3d'|'2d', renderer: string|null, engine: string|null}}
 */
export function parseShare(search, hash) {
  const q = new URLSearchParams(search || '');
  const h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const params = new URLSearchParams();
  for (const [k, v] of h) if (!k.startsWith('_')) params.append(k, v);
  return {
    slug: q.get('slug'),
    mode: q.get('mode'),
    params,
    view: h.get('_view') === '2d' ? '2d' : '3d',
    renderer: q.get('renderer'),
    engine: q.get('engine'),
  };
}

/**
 * @param {string} base absolute URL of the studio page (origin + path)
 * @param {{slug: string, mode?: string|null, params?: Record<string, unknown>, view?: string, keep?: URLSearchParams}} s
 */
export function buildShare(base, { slug, mode = null, params = {}, view = '3d', keep }) {
  const u = new URL(base);
  const q = new URLSearchParams();
  q.set('slug', slug);
  if (mode) q.set('mode', mode);
  if (keep) for (const k of ['renderer', 'engine', 'lang']) { const v = keep.get(k); if (v) q.set(k, v); }
  u.search = q.toString();
  const h = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) h.set(k, String(v));
  if (view === '2d') h.set('_view', '2d');
  const hs = h.toString();
  u.hash = hs ? hs : '';
  return u.href;
}

/**
 * The parameters that apply to a mode: a manifest parameter may list the `modes` it belongs to;
 * without that list it applies to every mode. The API rejects a parameter sent for another mode.
 * @param {any[]} parameters manifest parameters
 * @param {string|null} mode
 */
export function paramsForMode(parameters, mode) {
  return (parameters || []).filter((p) => !Array.isArray(p.modes) || (mode !== null && p.modes.includes(mode)));
}

/**
 * Typed parameter values back to the strings `coerceParams` reads, as a share hash carries them.
 * @param {Record<string, unknown>} values
 */
export function paramStrings(values) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(values || {})) if (v !== undefined && v !== null) out.set(k, String(v));
  return out;
}

/** True when a raw parameter source (URLSearchParams or plain object) carries any value. */
export function hasParams(raw) {
  if (!raw) return false;
  return raw instanceof URLSearchParams ? [...raw.keys()].length > 0 : Object.keys(raw).length > 0;
}

/**
 * Coerce hash strings to the manifest parameter types; unknown or invalid values fall back to the
 * declared default. Only manifest ids are read, so stray hash keys are ignored.
 * @param {any[]} parameters manifest parameters
 * @param {URLSearchParams | Record<string, string>} raw
 */
export function coerceParams(parameters, raw) {
  const get = (id) => (raw instanceof URLSearchParams ? (raw.has(id) ? raw.get(id) : undefined) : raw[id]);
  const out = {};
  for (const p of parameters) {
    const v = get(p.id);
    if (p.type === 'slider') {
      const n = Number(v);
      out[p.id] = v !== undefined && Number.isFinite(n) ? Math.min(p.max ?? n, Math.max(p.min ?? n, n)) : p.default;
    } else if (p.type === 'checkbox') {
      out[p.id] = v === undefined ? !!p.default : v === 'true' || v === '1';
    } else if (p.type === 'select') {
      const ok = (p.options || []).some((o) => String(o.value) === v);
      out[p.id] = ok ? v : p.default;
    } else {
      out[p.id] = v !== undefined ? v : p.default;
    }
  }
  return out;
}
