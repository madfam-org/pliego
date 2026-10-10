// @ts-check
// Printed content on sheet faces (spec §5.1 `front.art`/`back.art`, §5.11 `pliego:artwork`,
// §5.12 `pliego:annotations`), renderer-independent and DOM-free so node tests cover it:
//
//   - the art URL policy (images only: same-origin relative paths, data:image/svg+xml and
//     data:image/png;base64; everything else is refused),
//   - what a renderer needs per sheet (`printedFromDocument`, used by `sheetsFromDocument`),
//   - the sheet-local mm → layer pixel mapping (the same mapping as the render UVs: per sheet,
//     over the sheet's local bounding box; UV (0, 0) is its lower-left corner),
//   - the draw plan of one sheet side (art, then placed artwork, then annotations) and the
//     executor that replays it on any CanvasRenderingContext2D-like object,
//   - mesh helpers the Canvas 2D fallback uses to pin annotation texts on the folded paper.
//
// Back mirroring: the paper shader samples the back layer at u' = 1 − u, so the back layer is
// drawn in the "back view" frame (sheet-local x mirrored about the bounding box). Back art and
// back artwork are right-reading when the back is seen; their footprints stay where the document
// puts them in sheet-local mm (a back artwork rotated by θ in sheet-local mm is drawn rotated by
// −θ in the back view, which is the same footprint seen through the paper).

/** Largest layer edge (px) and the memory budget of the whole art texture array (RGBA8). */
export const ART_MAX_PX = 2048;
export const ART_MIN_PX = 256;
export const ART_BUDGET_BYTES = 64 * 1024 * 1024;
/** Longest data: URI accepted (characters); larger embedded images should be files. */
export const DATA_URI_MAX = 4 * 1024 * 1024;
/** Annotation glyphs are drawn with a 64 px font scaled so its cap height is `size` mm. */
export const TEXT_EM_PX = 64;
export const CAP_HEIGHT_EM = 0.7;
export const INK = '#27231e';

const DATA_SVG = /^data:image\/svg\+xml(?:;(?:charset=[a-z0-9._-]+|utf8))?(;base64)?,/i;
const DATA_PNG = /^data:image\/png;base64,[a-z0-9+/=\s]*$/i;
const BASE64_BODY = /^[a-z0-9+/=\s]*$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Art URL policy. Returns the URL to load as an image, or `null` (the caller skips the entry).
 * Accepted: relative paths resolved against `baseUrl` that stay on its origin, and
 * `data:image/svg+xml` (URL-encoded or base64) and `data:image/png;base64` URIs. Refused: any
 * other scheme (`javascript:`, `http(s):`, `blob:`, `file:` …), other data types, protocol-relative
 * URLs, and anything that resolves off the base origin. Never logs.
 * @param {unknown} src @param {string} baseUrl absolute URL of the document
 * @returns {string|null}
 */
export function artUrl(src, baseUrl) {
  if (typeof src !== 'string') return null;
  const s = src.trim();
  if (!s) return null;
  if (/^data:/i.test(s)) {
    if (s.length > DATA_URI_MAX) return null;
    const svg = DATA_SVG.exec(s);
    if (svg) return !svg[1] || BASE64_BODY.test(s.slice(svg[0].length)) ? s : null;
    return DATA_PNG.test(s) ? s : null;
  }
  if (SCHEME.test(s) || /^[\\/]{2}/.test(s)) return null;
  let base, url;
  try {
    base = new URL(baseUrl);
    url = new URL(s, base);
  } catch {
    return null;
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') return null;
  if (url.protocol !== base.protocol || url.host !== base.host) return null;
  return url.href;
}

// --- affine maps in the CanvasRenderingContext2D.setTransform order [a, b, c, d, e, f]:
//     x' = a·x + c·y + e, y' = b·x + d·y + f

/** @typedef {number[]} Affine */

/** m ∘ n (apply n first). @param {Affine} m @param {Affine} n @returns {Affine} */
export function affineMul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** @param {Affine} m @param {number[]} p @returns {number[]} */
export function affineApply(m, p) {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

const translate = (x, y) => [1, 0, 0, 1, x, y];
const scale = (x, y) => [x, 0, 0, y, 0, 0];
/** Counter-clockwise rotation in a y-up frame. */
const rotate = (rad) => [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];

/** @typedef {{x0: number, y0: number, x1: number, y1: number}} Box */

const boxW = (b) => (b.x1 - b.x0) || 1;
const boxH = (b) => (b.y1 - b.y0) || 1;

/**
 * Sheet-local mm → layer pixels for one side of a square `sizePx` layer (canvas y down).
 * Front: x0 → 0, x1 → size, y1 → 0 (top row), y0 → size. Back: x mirrored (x1 → 0, x0 → size),
 * matching the shader's u' = 1 − u for the back face.
 * @param {Box} box sheet-local bounding box @param {'front'|'back'} side @param {number} sizePx
 * @returns {Affine}
 */
export function sideTransform(box, side, sizePx) {
  const sx = sizePx / boxW(box), sy = sizePx / boxH(box);
  return side === 'back'
    ? [-sx, 0, 0, -sy, box.x1 * sx, box.y1 * sy]
    : [sx, 0, 0, -sy, -box.x0 * sx, box.y1 * sy];
}

/** Square layer edge for `layers` layers within the GPU limit and the memory budget (power of 2). */
export function artLayerSize(layers, maxTexture = ART_MAX_PX, budget = ART_BUDGET_BYTES) {
  const cap = Math.max(1, Math.min(ART_MAX_PX, maxTexture || ART_MAX_PX));
  let size = 1;
  while (size * 2 <= cap) size *= 2;
  while (size > ART_MIN_PX && Math.max(1, layers) * size * size * 4 > budget) size /= 2;
  return size;
}

// --- document → per-sheet printed content

const finite2 = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const poly = (p) => (Array.isArray(p) && p.length >= 3 && p.every(finite2) ? p.map((q) => [q[0], q[1]]) : null);

/**
 * @typedef {{asset: string, at: number[], size: number[], rotationDeg: number, clip: number[][]|null}} PlacedArt
 * @typedef {{text: string, at: number[], angleDeg: number, size: number}} Annotation
 * @typedef {{bbox: Box, artwork: {front: PlacedArt[], back: PlacedArt[]}, annotations: Annotation[]}} Printed
 */

/** Clip polygon of an artwork (sheet-local mm), or null for `none`/unknown panels. */
function clipPolygon(json, sheetId, a) {
  if (a.clip !== 'panel' && a.clip !== 'bleed') return null;
  for (const dl of json['pliego:dielines'] || []) {
    if (!dl || dl.sheet !== sheetId) continue;
    const p = (dl.panels || []).find((q) => q && q.name === a.panel);
    if (!p) continue;
    const ring = a.clip === 'bleed' ? poly(p.bleed) || poly(p.polygon) : poly(p.polygon);
    if (ring) return ring;
  }
  return null;
}

/**
 * Printed content of sheet `s` (index into `pliego:sheets`): its local bounding box (layout
 * bounding box of its vertices − `offset`), placed artwork per side and annotations, in document
 * order. Malformed entries are skipped (the kernel's verifier is where documents fail closed).
 * @param {any} json @param {number} s
 * @returns {Printed}
 */
export function printedFromDocument(json, s) {
  const sh = (json['pliego:sheets'] || [])[s] || {};
  const vs = json['pliego:vertices_sheet'] || [];
  const off = finite2(sh.offset) ? sh.offset : [0, 0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  (json.vertices_coords || []).forEach((p, i) => {
    if ((vs[i] ?? 0) !== s) return;
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  });
  const bbox = Number.isFinite(x0)
    ? { x0: x0 - off[0], y0: y0 - off[1], x1: x1 - off[0], y1: y1 - off[1] }
    : { x0: 0, y0: 0, x1: 1, y1: 1 };
  /** @type {{front: PlacedArt[], back: PlacedArt[]}} */
  const artwork = { front: [], back: [] };
  for (const a of json['pliego:artwork'] || []) {
    if (!a || a.sheet !== sh.id || typeof a.asset !== 'string' || !finite2(a.at) || !finite2(a.size)) continue;
    if (!(a.size[0] > 0 && a.size[1] > 0)) continue;
    const side = a.side === 'back' ? 'back' : 'front';
    artwork[side].push({
      asset: a.asset, at: [a.at[0], a.at[1]], size: [a.size[0], a.size[1]],
      rotationDeg: Number.isFinite(a.rotation_deg) ? a.rotation_deg : 0,
      clip: clipPolygon(json, sh.id, a),
    });
  }
  /** @type {Annotation[]} */
  const annotations = [];
  for (const n of json['pliego:annotations'] || []) {
    if (!n || n.sheet !== sh.id || !finite2(n.at) || typeof n.text !== 'string' || !n.text.trim()) continue;
    annotations.push({
      text: n.text.slice(0, 64), at: [n.at[0], n.at[1]],
      angleDeg: Number.isFinite(n.angle) ? n.angle : 0,
      size: Math.min(50, Math.max(0.5, Number.isFinite(n.size) ? n.size : 3)),
    });
  }
  return { bbox, artwork, annotations };
}

/**
 * @typedef {{artFront?: string|null, artBack?: string|null, bbox: Box,
 *            artwork?: {front: PlacedArt[], back: PlacedArt[]}, annotations?: Annotation[]}} PrintedSheet
 */

/** True when a sheet side has anything printed on it (so it needs an art layer). */
export function hasPrinted(/** @type {PrintedSheet} */ sheet, /** @type {'front'|'back'} */ side) {
  const art = side === 'back' ? sheet.artBack : sheet.artFront;
  return !!art || !!(sheet.artwork && sheet.artwork[side] && sheet.artwork[side].length)
    || (side === 'front' && !!(sheet.annotations && sheet.annotations.length));
}

/**
 * @typedef {{kind: 'art', src: string, transform: Affine, w: number, h: number, clip: null}} ArtOp
 * @typedef {{kind: 'image', src: string, transform: Affine, w: number, h: number, clip: number[][]|null}} ImageOp
 * @typedef {{kind: 'text', text: string, transform: Affine, font: string, color: string, baseline: number}} TextOp
 * @typedef {ArtOp|ImageOp|TextOp} DrawOp
 */

/**
 * Draw plan of one sheet: per side, the ops in paint order — the side's `art` over the whole
 * layer, then its placed artwork (document order), then (front only) the annotations. Image ops
 * draw the image into [0, w] × [0, h] under `transform` (layer px); `clip` is a layer-px polygon.
 * Image sources go through `artUrl`; refused ones are listed in `rejected` and left out.
 * @param {PrintedSheet} sheet @param {number} sizePx @param {string} baseUrl
 * @returns {{front: DrawOp[], back: DrawOp[], rejected: string[]}}
 */
export function planSheet(sheet, sizePx, baseUrl) {
  /** @type {string[]} */
  const rejected = [];
  const box = sheet.bbox;
  const mirror = [-1, 0, 0, 1, box.x0 + box.x1, 0];       // sheet-local → back view
  const front = sideTransform(box, 'front', sizePx);
  const url = (src) => {
    const u = artUrl(src, baseUrl);
    if (!u) rejected.push(String(src).slice(0, 80));
    return u;
  };
  /** @param {'front'|'back'} side @returns {DrawOp[]} */
  const plan = (side) => {
    /** @type {DrawOp[]} */
    const ops = [];
    const art = side === 'back' ? sheet.artBack : sheet.artFront;
    if (art) {
      const src = url(art);
      if (src) ops.push({ kind: 'art', src, transform: [1, 0, 0, 1, 0, 0], w: sizePx, h: sizePx, clip: null });
    }
    const toPx = side === 'back' ? affineMul(front, mirror) : front;
    for (const a of (sheet.artwork && sheet.artwork[side]) || []) {
      const src = url(a.asset);
      if (!src) continue;
      const [w, h] = a.size;
      let c = [a.at[0] + w / 2, a.at[1] + h / 2];
      let rad = (a.rotationDeg * Math.PI) / 180;
      if (side === 'back') { c = affineApply(mirror, c); rad = -rad; }
      // image frame (y down, mm) → footprint (y up, centred) → rotated about its centre → px
      const m = [translate(c[0], c[1]), rotate(rad), translate(-w / 2, -h / 2), [1, 0, 0, -1, 0, h]]
        .reduce((acc, t) => affineMul(acc, t), front);
      ops.push({ kind: 'image', src, transform: m, w, h, clip: a.clip ? a.clip.map((p) => affineApply(toPx, p)) : null });
    }
    if (side === 'front') {
      for (const n of sheet.annotations || []) {
        const k = n.size / CAP_HEIGHT_EM / TEXT_EM_PX;   // mm per glyph unit
        const m = [translate(n.at[0], n.at[1]), rotate((n.angleDeg * Math.PI) / 180), scale(k, -k)]
          .reduce((acc, t) => affineMul(acc, t), front);
        ops.push({ kind: 'text', text: n.text, transform: m, font: `${TEXT_EM_PX}px sans-serif`, color: INK, baseline: (TEXT_EM_PX * CAP_HEIGHT_EM) / 2 });
      }
    }
    return ops;
  };
  return { front: plan('front'), back: plan('back'), rejected };
}

/**
 * Replays a side's plan on a 2-D context: clears the layer to transparent (the paper colour
 * shows through), draws the loaded images (`images`: resolved URL → drawable; missing ones are
 * skipped until they load) and the texts. Returns the number of ops drawn.
 * @param {any} ctx CanvasRenderingContext2D-like @param {DrawOp[]} ops
 * @param {Map<string, any>} images @param {number} sizePx
 */
export function drawLayer(ctx, ops, images, sizePx) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, sizePx, sizePx);
  let drawn = 0;
  for (const op of ops) {
    if (op.kind === 'text') {
      ctx.save();
      ctx.setTransform(...op.transform);
      ctx.font = op.font;
      ctx.fillStyle = op.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(op.text, 0, op.baseline);
      ctx.restore();
      drawn++;
      continue;
    }
    const img = images.get(op.src);
    if (!img) continue;
    ctx.save();
    if (op.clip) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      op.clip.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.clip();
    }
    ctx.setTransform(...op.transform);
    ctx.drawImage(img, 0, 0, op.w, op.h);
    ctx.restore();
    drawn++;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return drawn;
}

// --- mesh helpers (Canvas 2D fallback: annotation texts pinned on the folded paper)

/**
 * Barycentric weights of render-UV point (u, v) in triangle `tri` (may lie outside: the weights
 * then extrapolate the triangle's affine map). Null for a degenerate UV triangle.
 * @param {ArrayLike<number>} uvs @param {ArrayLike<number>} indices @param {number} tri
 * @param {number} u @param {number} v @returns {number[]|null}
 */
export function baryWeights(uvs, indices, tri, u, v) {
  const a = indices[tri * 3] * 2, b = indices[tri * 3 + 1] * 2, c = indices[tri * 3 + 2] * 2;
  const x1 = uvs[b] - uvs[a], y1 = uvs[b + 1] - uvs[a + 1], x2 = uvs[c] - uvs[a], y2 = uvs[c + 1] - uvs[a + 1];
  const det = x1 * y2 - x2 * y1;
  if (Math.abs(det) < 1e-14) return null;
  const px = u - uvs[a], py = v - uvs[a + 1];
  const wb = (px * y2 - x2 * py) / det, wc = (x1 * py - px * y1) / det;
  return [1 - wb - wc, wb, wc];
}

/**
 * The render triangle of sheet `sheet` whose UV triangle contains (u, v), or -1.
 * @param {ArrayLike<number>} uvs @param {ArrayLike<number>} sheetIds @param {ArrayLike<number>} indices
 * @param {number} sheet @param {number} u @param {number} v
 */
export function locateUv(uvs, sheetIds, indices, sheet, u, v) {
  const eps = 1e-7;
  for (let t = 0; t * 3 + 2 < indices.length; t++) {
    if (Math.round(sheetIds[indices[t * 3]]) !== sheet) continue;
    const w = baryWeights(uvs, indices, t, u, v);
    if (w && w[0] >= -eps && w[1] >= -eps && w[2] >= -eps) return t;
  }
  return -1;
}

/** Sheet-local mm → render UV through the sheet's local bounding box. @param {Box} box @param {number[]} p */
export function localToUv(box, p) {
  return [(p[0] - box.x0) / boxW(box), (p[1] - box.y0) / boxH(box)];
}
