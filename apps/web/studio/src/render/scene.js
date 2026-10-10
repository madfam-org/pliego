// @ts-check
// Renderer-independent scene helpers: bounds of the render mesh, the shadow light matrix,
// per-vertex normals when an engine omits them, and the theme colours shared by both renderers.

import { mat4, vec3, hexToLinear } from './math.js';
import { printedFromDocument } from './printed.js';

/** Unit direction toward the key light (upper left, slightly in front). */
export const LIGHT_DIR = vec3.normalize([-0.45, 1.0, 0.38]);

/**
 * @param {ArrayLike<number>} pos xyz
 * @returns {{center: number[], radius: number, min: number[], max: number[]}}
 */
export function computeBounds(pos) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (!Number.isFinite(min[0])) return { center: [0, 0, 0], radius: 100, min: [0, 0, 0], max: [0, 0, 0] };
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  return { center, radius, min, max };
}

/** Orthographic light view-projection enclosing the bounding sphere (and the ground under it). */
export function lightViewProj(bounds, out = new Float32Array(16)) {
  const c = [bounds.center[0], Math.max(bounds.center[1], 0) / 2, bounds.center[2]];
  const r = bounds.radius * 1.25 + 5;
  const eye = vec3.add(c, vec3.scale(LIGHT_DIR, r * 3));
  const view = mat4.lookAt(eye, c, Math.abs(LIGHT_DIR[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]);
  const proj = mat4.ortho(-r, r, -r, r, r * 0.5, r * 5.5);
  return mat4.multiply(proj, view, out);
}

/**
 * Area-weighted vertex normals (fallback when render().normals is absent or all zero).
 * @param {ArrayLike<number>} pos @param {ArrayLike<number>} idx @param {Float32Array} out
 */
export function computeNormals(pos, idx, out) {
  out.fill(0);
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { out[i] += nx; out[i + 1] += ny; out[i + 2] += nz; }
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= l; out[i + 1] /= l; out[i + 2] /= l;
  }
  return out;
}

/** True when a normals array is missing or entirely zero. */
export function normalsMissing(n, count) {
  if (!n || n.length < count) return true;
  for (let i = 0; i < Math.min(n.length, 300); i++) if (n[i] !== 0) return false;
  return true;
}

/**
 * Theme colours (linear RGB) read from CSS custom properties on the canvas, so light/dark mode
 * and the page palette stay in one place.
 * @param {HTMLElement} el
 */
export function readTheme(el) {
  const cs = globalThis.getComputedStyle ? getComputedStyle(el) : null;
  const get = (name, fallback) => (cs && cs.getPropertyValue(name).trim()) || fallback;
  return {
    clear: hexToLinear(get('--viewer-bg', '#f3eee4')),
    table: hexToLinear(get('--viewer-table', '#e6dfd1')),
    sky: hexToLinear(get('--viewer-sky', '#fbf8f2')),
    ground: hexToLinear(get('--viewer-ground', '#cfc6b4')),
  };
}

/**
 * Normalises the sheet list a renderer needs from a sheet document: colours, `art` per side,
 * size and grain, plus the printed content (`printed.js`): the sheet-local bounding box the render
 * UVs span, placed artwork per side (with its clip polygon) and annotations.
 * @param {any} json
 */
export function sheetsFromDocument(json) {
  return (json['pliego:sheets'] || []).map((sh, s) => {
    const { bbox, artwork, annotations } = printedFromDocument(json, s);
    return {
      id: sh.id,
      front: sh.front?.color || '#f4efe6',
      back: sh.back?.color || sh.front?.color || '#f4efe6',
      artFront: sh.front?.art || null,
      artBack: sh.back?.art || null,
      size: [Math.max(1, bbox.x1 - bbox.x0), Math.max(1, bbox.y1 - bbox.y0)],
      grainDeg: typeof sh.grain_deg === 'number' ? sh.grain_deg : 90,
      bbox,
      artwork,
      annotations,
    };
  });
}
