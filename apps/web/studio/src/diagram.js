// @ts-check
// The 2-D crease-pattern diagram (SVG) and the 3-D crease overlay segments.
// Line conventions: mountain dash-dot, valley dashed, cuts solid, scores dotted, perforations
// short dashes, outline solid ink; `J` join edges are never drawn. Styling is carried by SVG
// presentation attributes (CSP-safe, and the exported file is self-contained); the page
// stylesheet may override colours for dark mode through the `line-*` classes.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** @typedef {'outline'|'cut'|'mountain'|'valley'|'score'|'perforation'|'flat'|null} LineKind */

export const LINE_STYLE = {
  outline: { stroke: '#2b2620', width: 1.4, dash: null },
  cut: { stroke: '#b3261e', width: 1.6, dash: null },
  mountain: { stroke: '#a3472a', width: 1.3, dash: '10 3 2 3' },
  valley: { stroke: '#2a5d9a', width: 1.3, dash: '6 4' },
  score: { stroke: '#6b5e4b', width: 1.2, dash: '1.5 3' },
  perforation: { stroke: '#6b5e4b', width: 1.2, dash: '3 5' },
  flat: { stroke: '#9a8f7d', width: 0.9, dash: '1 4' },
};

/** Linear-ish RGB triples for the 3-D overlay. */
const OVERLAY_RGB = {
  cut: [0.62, 0.08, 0.06], mountain: [0.5, 0.12, 0.05], valley: [0.05, 0.17, 0.45],
  score: [0.25, 0.2, 0.14], perforation: [0.25, 0.2, 0.14], flat: [0.35, 0.3, 0.25],
};

/**
 * @param {string} assignment FOLD assignment
 * @param {string} treatment pliego:edges_treatment
 * @returns {LineKind}
 */
export function lineKind(assignment, treatment) {
  if (assignment === 'J') return null;
  if (assignment === 'B') return 'outline';
  if (assignment === 'C' || treatment === 'cut') return 'cut';
  if (treatment === 'perforation') return 'perforation';
  if (treatment === 'score') return 'score';
  if (assignment === 'M') return 'mountain';
  if (assignment === 'V') return 'valley';
  if (assignment === 'F' || assignment === 'U') return treatment === 'none' ? null : 'flat';
  return null;
}

const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  return n;
};

/** Layout bounding box of the whole document. */
export function layoutBounds(json) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of json.vertices_coords) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/**
 * Build the SVG diagram. Layout is y-up; SVG is y-down, so y is mirrored.
 * @param {any} json sheet document
 * @param {{title: string, sheetFill?: (i: number) => string}} opts
 * @returns {SVGSVGElement}
 */
export function buildDiagram(json, opts) {
  const b = layoutBounds(json);
  const pad = Math.max(b.w, b.h) * 0.04 + 4;
  const svg = /** @type {SVGSVGElement} */ (el('svg', {
    xmlns: SVG_NS, viewBox: `${b.x0 - pad} ${-b.y1 - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`,
    role: 'img', class: 'diagram-svg', width: `${Math.round(b.w + 2 * pad)}mm`, height: `${Math.round(b.h + 2 * pad)}mm`,
  }));
  const title = el('title');
  title.textContent = opts.title;
  svg.appendChild(title);
  const V = json.vertices_coords;
  // Sheets: faces filled with the sheet's front colour.
  const faces = el('g', { class: 'faces' });
  json.faces_vertices.forEach((f, i) => {
    const s = json['pliego:faces_sheet'][i];
    const fill = (opts.sheetFill && opts.sheetFill(s)) || json['pliego:sheets'][s]?.front?.color || '#f4efe6';
    faces.appendChild(el('polygon', { points: f.map((v) => `${V[v][0]},${-V[v][1]}`).join(' '), fill, stroke: 'none', class: 'face' }));
  });
  svg.appendChild(faces);
  const lines = el('g', { class: 'lines', fill: 'none', 'stroke-linecap': 'round' });
  json.edges_vertices.forEach(([a, c], e) => {
    const kind = lineKind(json.edges_assignment[e], json['pliego:edges_treatment'][e]);
    if (!kind) return;
    const st = LINE_STYLE[kind];
    lines.appendChild(el('line', {
      x1: V[a][0], y1: -V[a][1], x2: V[c][0], y2: -V[c][1],
      stroke: st.stroke, 'stroke-width': st.width, 'stroke-dasharray': st.dash,
      'vector-effect': 'non-scaling-stroke', class: `line line-${kind}`, 'data-edge': e,
    }));
  });
  svg.appendChild(lines);
  return svg;
}

/** The step each diagram shows highlighted: playback asks every frame, the walk runs on a change. */
const shownStep = new WeakMap();

/** Mark the edges a sequence step drives (index = step, or −1 for none). */
export function highlightStep(svg, json, stepIndex) {
  if (shownStep.get(svg) === stepIndex) return;
  shownStep.set(svg, stepIndex);
  const step = json['pliego:sequence']?.steps?.[stepIndex];
  const active = new Set(step ? [...step.targets.map((t) => t[0]), ...(step.release || [])] : []);
  for (const line of svg.querySelectorAll('line[data-edge]')) {
    line.classList.toggle('active', active.has(Number(line.getAttribute('data-edge'))));
  }
}

/** Standalone SVG text for download (presentation attributes only). */
export function serializeDiagram(svg) {
  const clone = /** @type {SVGSVGElement} */ (svg.cloneNode(true));
  clone.removeAttribute('class');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}\n`;
}

/** Legend entries (kind → i18n key) for the line types present in a document. */
export function legendKinds(json) {
  const seen = new Set();
  json.edges_vertices.forEach((_, e) => { const k = lineKind(json.edges_assignment[e], json['pliego:edges_treatment'][e]); if (k && k !== 'flat') seen.add(k); });
  return ['outline', 'mountain', 'valley', 'cut', 'score', 'perforation'].filter((k) => seen.has(k));
}

/**
 * Overlay segments in 3-D from per-document-vertex positions. Works when the engine's `positions`
 * are indexed like the document vertices (the stub); returns null otherwise so the caller can
 * disable the overlay instead of drawing wrong lines.
 * @param {any} json @param {{positions: ArrayLike<number>}} world
 */
export function createOverlay(json, world) {
  const V = json.vertices_coords.length;
  const edges = [];
  json.edges_vertices.forEach(([a, b], e) => {
    const kind = lineKind(json.edges_assignment[e], json['pliego:edges_treatment'][e]);
    if (kind && kind !== 'outline') edges.push([a, b, OVERLAY_RGB[kind], e]);
  });
  if (!edges.length) return null;
  const positions = new Float32Array(edges.length * 6), colors = new Float32Array(edges.length * 6);
  edges.forEach(([, , rgb], i) => { colors.set(rgb, i * 6); colors.set(rgb, i * 6 + 3); });
  return {
    available: () => !!world.positions && world.positions.length === V * 3,
    build() {
      const P = world.positions;
      if (!P || P.length !== V * 3) return null;
      const gone = world.hiddenEdges;   // edges of removed pieces (spec §5.8) collapse to a point
      edges.forEach(([a, b, , e], i) => {
        const q = gone && gone[e] ? a : b;
        positions[i * 6] = P[a * 3]; positions[i * 6 + 1] = P[a * 3 + 1]; positions[i * 6 + 2] = P[a * 3 + 2];
        positions[i * 6 + 3] = P[q * 3]; positions[i * 6 + 4] = P[q * 3 + 1]; positions[i * 6 + 5] = P[q * 3 + 2];
      });
      return { positions, colors };
    },
  };
}

/** Segment kinds of the paper engine's creaseLines() (render.js in @pliego/engine). */
const ENGINE_LINE_KINDS = /** @type {const} */ (['mountain', 'valley', 'score', 'perforation', 'cut']);

/**
 * The crease overlay from a paper-engine World: its creaseLines() polylines (simulation vertices,
 * presented like render()), coloured like the stub overlay. Null when the world has no creases.
 * @param {any} world
 */
export function createEngineOverlay(world) {
  if (!world || typeof world.creaseLines !== 'function') return null;
  const first = world.creaseLines();
  if (!first || !first.count) return null;
  const colors = new Float32Array(first.count * 6);
  for (let i = 0; i < first.count; i++) {
    const rgb = OVERLAY_RGB[ENGINE_LINE_KINDS[first.kinds[i]] || 'flat'];
    colors.set(rgb, i * 6); colors.set(rgb, i * 6 + 3);
  }
  return {
    available: () => true,
    build() {
      const L = world.creaseLines();
      return L && L.positions && L.positions.length === colors.length ? { positions: L.positions, colors } : null;
    },
  };
}
