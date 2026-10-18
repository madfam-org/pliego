// @ts-check
// Canvas2D 3-D fallback renderer for browsers without WebGL2. Draws the same world.render() mesh
// with the same OrbitCamera: per-triangle projection, back-face aware two-sided colours, flat
// Lambert shading (with paper translucency), painter's-algorithm depth sort, planar projected
// shadows on the ground plane, and the optional crease overlay. Same interface as webgl.js. Not
// drawn here: the darkened paper edges and pressed creases (`overlay.faint`, which needs a depth
// test this painter's algorithm has no cheap equivalent for) and the soft table shadow.
// Printed content degrades: `art` and placed artwork are not drawn (flat paper colours only);
// annotation texts are pinned on the folded paper (painted right after their triangle, only when
// it shows its front), mapped through the triangle's affine UV → screen map.

import { OrbitCamera } from './camera.js';
import { hexToLinear } from './math.js';
import { computeBounds, readTheme, LIGHT_DIR } from './scene.js';
import { baryWeights, locateUv, localToUv, CAP_HEIGHT_EM, INK, TEXT_EM_PX } from './printed.js';
import { backingSize, coarsePointer } from '../frame-loop.js';

const CAP_UNITS = TEXT_EM_PX * CAP_HEIGHT_EM;

const toCss = (lin, k = 1) => {
  const c = lin.map((v) => Math.round(255 * Math.min(1, Math.max(0, v * k)) ** (1 / 2.2)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
};

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {import('./index.js').Renderer}
 */
export function createCanvas2DRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas2D unavailable');
  const camera = new OrbitCamera();
  const coarse = coarsePointer();
  let theme = readTheme(canvas);
  let sheets = [];
  let destroyed = false;
  // Reused scratch, grown on demand.
  let sx = new Float32Array(0), sy = new Float32Array(0), sw = new Float32Array(0), depth = new Float32Array(0);
  let order = new Uint32Array(0);
  // Annotations: specs from setSheets (UVs of the text centre and of its baseline/cap-height
  // ends), located on the render mesh once per topology (keyed by the indices array).
  /** @type {{sheet: number, text: string, uv: number[][]}[]} */
  let annSpecs = [];
  /** @type {Map<number, {text: string, w: number[][]}[]>} */
  let annByTri = new Map();
  let annMesh = null;

  function locateAnnotations(r) {
    annByTri = new Map();
    for (const a of annSpecs) {
      const t = locateUv(r.uvs, r.sheetIds, r.indices, a.sheet, a.uv[0][0], a.uv[0][1]);
      if (t < 0) continue;
      const w = a.uv.map((p) => baryWeights(r.uvs, r.indices, t, p[0], p[1]));
      if (w.some((x) => !x)) continue;
      const list = annByTri.get(t) || [];
      list.push({ text: a.text, w: /** @type {number[][]} */ (w) });
      annByTri.set(t, list);
    }
    annMesh = r.indices;
  }

  function grow(nv, nt) {
    if (sx.length < nv) { sx = new Float32Array(nv); sy = new Float32Array(nv); sw = new Float32Array(nv); }
    if (depth.length < nt) { depth = new Float32Array(nt); order = new Uint32Array(nt); }
  }

  const renderer = {
    kind: 'canvas2d',
    camera,
    canvas,

    setSheets(list) {
      sheets = list.map((s) => ({ front: hexToLinear(s.front), back: hexToLinear(s.back) }));
      annSpecs = [];
      list.forEach((s, i) => {
        if (!s.bbox) return;
        for (const n of s.annotations || []) {
          const r = (n.angleDeg * Math.PI) / 180, k = n.size;
          const pts = [n.at, [n.at[0] + Math.cos(r) * k, n.at[1] + Math.sin(r) * k], [n.at[0] - Math.sin(r) * k, n.at[1] + Math.cos(r) * k]];
          annSpecs.push({ sheet: i, text: n.text, uv: pts.map((p) => localToUv(s.bbox, p)) });
        }
      });
      annMesh = null;
      annByTri = new Map();
    },

    refreshTheme() { theme = readTheme(canvas); },

    resize() {
      // Pixel ratio capped (1.5 on touch devices) and a pixel budget: see frame-loop.js.
      const [w, h] = backingSize(canvas.clientWidth, canvas.clientHeight, globalThis.devicePixelRatio || 1, coarse);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    },

    draw(r, overlay) {
      if (destroyed) return;
      renderer.resize();
      const W = canvas.width, H = canvas.height;
      const P = r.positions, I = r.indices, S = r.sheetIds;
      const nv = P.length / 3, nt = I.length / 3;
      grow(nv, nt);
      const bounds = computeBounds(P);
      camera.update(W / H);
      const m = camera.viewProj;
      for (let i = 0; i < nv; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const w = m[3] * x + m[7] * y + m[11] * z + m[15];
        sw[i] = w;
        const iw = w > 1e-6 ? 1 / w : 0;
        sx[i] = ((m[0] * x + m[4] * y + m[8] * z + m[12]) * iw * 0.5 + 0.5) * W;
        sy[i] = (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw * 0.5) * H;
      }

      // Background and ground (a soft disc under the scene, fading into the background).
      ctx.fillStyle = toCss(theme.clear);
      ctx.fillRect(0, 0, W, H);
      const gc = [bounds.center[0], 0, bounds.center[2]];
      const R = bounds.radius * 2.2 + 60;
      const ground = [];
      for (let k = 0; k < 40; k++) {
        const a = (k / 40) * Math.PI * 2;
        const x = gc[0] + Math.cos(a) * R, z = gc[2] + Math.sin(a) * R;
        const w = m[3] * x + m[11] * z + m[15];
        if (w <= 1e-6) continue;
        ground.push([((m[0] * x + m[8] * z + m[12]) / w * 0.5 + 0.5) * W, (0.5 - (m[1] * x + m[9] * z + m[13]) / w * 0.5) * H]);
      }
      if (ground.length > 2) {
        ctx.beginPath();
        ground.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = toCss(theme.table);
        ctx.fill();
      }

      // Planar shadows: project every triangle onto y = 0 along the light; one fill = union.
      const L = LIGHT_DIR;
      ctx.beginPath();
      for (let t = 0; t < nt; t++) {
        let ok = true;
        const pts = [];
        for (let k = 0; k < 3; k++) {
          const v = I[t * 3 + k] * 3, y = P[v + 1];
          if (y < -0.5) { ok = false; break; }
          const x = P[v] - (L[0] / L[1]) * y, z = P[v + 2] - (L[2] / L[1]) * y;
          const w = m[3] * x + m[11] * z + m[15];
          if (w <= 1e-6) { ok = false; break; }
          pts.push(((m[0] * x + m[8] * z + m[12]) / w * 0.5 + 0.5) * W, (0.5 - (m[1] * x + m[9] * z + m[13]) / w * 0.5) * H);
        }
        if (!ok) continue;
        ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]); ctx.lineTo(pts[4], pts[5]); ctx.closePath();
      }
      ctx.fillStyle = 'rgba(40, 30, 20, 0.16)';
      ctx.fill('nonzero');

      // Painter's sort: farthest first (view-space depth ≈ clip w).
      let n = 0;
      for (let t = 0; t < nt; t++) {
        const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
        if (sw[a] <= 1e-6 || sw[b] <= 1e-6 || sw[c] <= 1e-6) continue;   // crosses the near plane
        depth[t] = sw[a] + sw[b] + sw[c];
        order[n++] = t;
      }
      const ord = order.subarray(0, n);
      ord.sort((p, q) => depth[q] - depth[p]);

      if (annSpecs.length && annMesh !== I) locateAnnotations(r);
      const project = (w, a3, b3, c3) => {
        const x = w[0] * P[a3] + w[1] * P[b3] + w[2] * P[c3];
        const y = w[0] * P[a3 + 1] + w[1] * P[b3 + 1] + w[2] * P[c3 + 1];
        const z = w[0] * P[a3 + 2] + w[1] * P[b3 + 2] + w[2] * P[c3 + 2];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (cw <= 1e-6) return null;
        return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw * 0.5 + 0.5) * W, (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw * 0.5) * H];
      };
      const drawTexts = (list, a3, b3, c3) => {
        for (const n of list) {
          const p0 = project(n.w[0], a3, b3, c3), pu = project(n.w[1], a3, b3, c3), pv = project(n.w[2], a3, b3, c3);
          if (!p0 || !pu || !pv || Math.hypot(pv[0] - p0[0], pv[1] - p0[1]) < 3) continue;   // illegible
          ctx.save();
          ctx.setTransform((pu[0] - p0[0]) / CAP_UNITS, (pu[1] - p0[1]) / CAP_UNITS, -(pv[0] - p0[0]) / CAP_UNITS, -(pv[1] - p0[1]) / CAP_UNITS, p0[0], p0[1]);
          ctx.font = `${TEXT_EM_PX}px sans-serif`;
          ctx.fillStyle = INK;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(n.text, 0, CAP_UNITS / 2);
          ctx.restore();
        }
      };

      const eye = camera.eye();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.6;
      for (let k = 0; k < n; k++) {
        const t = ord[k];
        const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
        // Screen winding (y down): negative area = CCW on screen = front facing.
        const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]);
        const isFront = area < 0;
        const a3 = a * 3, b3 = b * 3, c3 = c * 3;
        const ux = P[b3] - P[a3], uy = P[b3 + 1] - P[a3 + 1], uz = P[b3 + 2] - P[a3 + 2];
        const vx = P[c3] - P[a3], vy = P[c3 + 1] - P[a3 + 1], vz = P[c3 + 2] - P[a3 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        // Orient the normal toward the viewer (the visible side).
        const toEye = (eye[0] - P[a3]) * nx + (eye[1] - P[a3 + 1]) * ny + (eye[2] - P[a3 + 2]) * nz;
        if (toEye < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const ndl = nx * L[0] + ny * L[1] + nz * L[2];
        const shade = 0.5 + 0.55 * Math.max(ndl, 0) + 0.2 * Math.max(-ndl, 0) + 0.08 * (ny * 0.5 + 0.5);
        const sh = sheets[S[a]] || { front: [0.9, 0.86, 0.8], back: [0.75, 0.7, 0.6] };
        const col = toCss(isFront ? sh.front : sh.back, shade);
        ctx.beginPath();
        ctx.moveTo(sx[a], sy[a]); ctx.lineTo(sx[b], sy[b]); ctx.lineTo(sx[c], sy[c]); ctx.closePath();
        ctx.fillStyle = col;
        ctx.strokeStyle = col;      // hairline in the fill colour hides anti-aliasing seams
        ctx.fill();
        ctx.stroke();
        if (isFront && annByTri.size) {
          const list = annByTri.get(t);
          if (list) drawTexts(list, a3, b3, c3);
        }
      }

      if (overlay && !overlay.faint && overlay.positions.length) {
        const O = overlay.positions, C = overlay.colors;
        ctx.lineWidth = Math.max(1, (globalThis.devicePixelRatio || 1) * 1.1);
        for (let i = 0; i + 5 < O.length; i += 6) {
          const pr = [];
          for (let k = 0; k < 2; k++) {
            const x = O[i + k * 3], y = O[i + k * 3 + 1], z = O[i + k * 3 + 2];
            const w = m[3] * x + m[7] * y + m[11] * z + m[15];
            if (w <= 1e-6) break;
            pr.push(((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * W, (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * H);
          }
          if (pr.length < 4) continue;
          ctx.strokeStyle = toCss([C[i], C[i + 1], C[i + 2]]);
          ctx.beginPath(); ctx.moveTo(pr[0], pr[1]); ctx.lineTo(pr[2], pr[3]); ctx.stroke();
        }
      }
      return bounds;
    },

    destroy() { destroyed = true; },
  };
  return renderer;
}
