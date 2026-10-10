// @ts-check
// Share-by-URL: the object slug lives in `?slug=`, parameter values in the hash
// (`#width=200&stock=kami`), and studio-only state under reserved underscore keys (`_view=2d`).
// Pure functions so Node tests can cover them.

/**
 * @param {string} search location.search
 * @param {string} hash location.hash
 * @returns {{slug: string|null, params: Record<string, string>, view: '3d'|'2d', renderer: string|null, engine: string|null}}
 */
export function parseShare(search, hash) {
  const q = new URLSearchParams(search || '');
  const h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const params = {};
  for (const [k, v] of h) if (!k.startsWith('_')) params[k] = v;
  return {
    slug: q.get('slug'),
    params,
    view: h.get('_view') === '2d' ? '2d' : '3d',
    renderer: q.get('renderer'),
    engine: q.get('engine'),
  };
}

/**
 * @param {string} base absolute URL of the studio page (origin + path)
 * @param {{slug: string, params?: Record<string, unknown>, view?: string, keep?: URLSearchParams}} s
 */
export function buildShare(base, { slug, params = {}, view = '3d', keep }) {
  const u = new URL(base);
  const q = new URLSearchParams();
  q.set('slug', slug);
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
 * Coerce hash strings to the manifest parameter types; unknown or invalid values fall back to the
 * declared default.
 * @param {any[]} parameters manifest parameters
 * @param {Record<string, string>} raw
 */
export function coerceParams(parameters, raw) {
  const out = {};
  for (const p of parameters) {
    const v = raw[p.id];
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
