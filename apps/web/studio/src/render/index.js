// @ts-check
// Renderer factory: WebGL2 by default, Canvas2D 3-D fallback when WebGL2 is unavailable (or when
// `?renderer=canvas2d` forces it for testing), and `null` when even Canvas2D fails — the studio then
// shows the SVG crease-pattern diagram with a message.

import { createWebGLRenderer, hasWebGL2 } from './webgl.js';
import { createCanvas2DRenderer } from './canvas2d.js';

/**
 * @typedef {object} Renderer
 * @property {'webgl2'|'canvas2d'} kind
 * @property {import('./camera.js').OrbitCamera} camera
 * @property {HTMLCanvasElement} canvas
 * @property {(sheets: any[], baseUrl?: string) => void} setSheets
 * @property {() => void} refreshTheme
 * @property {() => void} resize
 * @property {(r: any, overlay: {positions: Float32Array, colors: Float32Array} | null) => any} draw
 * @property {() => void} destroy
 */

/** @param {string|null} v @returns {'webgl2'|'canvas2d'|null} */
export function rendererOverride(v) {
  return v === 'canvas2d' || v === 'webgl2' ? v : null;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{prefer?: 'webgl2'|'canvas2d'|null, onWarn?: (msg: string) => void}} [opts]
 * @returns {Renderer | null}
 */
export function createRenderer(canvas, opts = {}) {
  const warn = opts.onWarn || (() => {});
  if (opts.prefer !== 'canvas2d' && hasWebGL2(canvas)) {
    try {
      return createWebGLRenderer(canvas, { onWarn: warn });
    } catch (e) {
      warn(`WebGL2 renderer failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  // A canvas that handed out a webgl2 context cannot give a 2-D one; swap in a fresh element.
  let target = canvas;
  try {
    if (!canvas.getContext('2d')) {
      target = /** @type {HTMLCanvasElement} */ (canvas.cloneNode(false));
      canvas.replaceWith(target);
    }
    return createCanvas2DRenderer(target);
  } catch (e) {
    warn(`Canvas2D renderer failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
