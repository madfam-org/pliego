// Printed content on sheet faces (render/printed.js): the art URL policy, the sheet-local mm →
// layer pixel mapping (front and mirrored back), the per-side draw plan (art → artwork →
// annotations), the layer executor, the Canvas 2D mesh helpers and sheetsFromDocument's new
// fields. No DOM and no WebGL: what reaches the GPU is checked here only as data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  artUrl, sideTransform, affineApply, affineMul, artLayerSize, planSheet, drawLayer, hasPrinted,
  printedFromDocument, baryWeights, locateUv, localToUv, ART_MAX_PX, ART_BUDGET_BYTES, CAP_HEIGHT_EM, TEXT_EM_PX,
} from '../studio/src/render/printed.js';
import { sheetsFromDocument } from '../studio/src/render/scene.js';

const RENDER = join(dirname(fileURLToPath(import.meta.url)), '..', 'studio', 'src', 'render');
const BASE = 'https://studio.example.test/studio/demo/card.fold';
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const pnear = (p, q, eps = 1e-6) => near(p[0], q[0], eps) && near(p[1], q[1], eps);
const SVG_URI = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/%3E';
const SVG_B64 = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;
const PNG_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('art URL policy accepts same-origin relative paths and image data URIs', () => {
  assert.equal(artUrl('assets/brand.svg', BASE), 'https://studio.example.test/studio/demo/assets/brand.svg');
  assert.equal(artUrl('./art/front.png', BASE), 'https://studio.example.test/studio/demo/art/front.png');
  assert.equal(artUrl('/studio/x.webp', BASE), 'https://studio.example.test/studio/x.webp');
  assert.equal(artUrl('  art.png  ', BASE), 'https://studio.example.test/studio/demo/art.png');
  assert.equal(artUrl(SVG_URI, BASE), SVG_URI);
  assert.equal(artUrl(SVG_B64, BASE), SVG_B64);
  assert.equal(artUrl('data:image/svg+xml;charset=utf-8,%3Csvg/%3E', BASE), 'data:image/svg+xml;charset=utf-8,%3Csvg/%3E');
  assert.equal(artUrl(PNG_B64, BASE), PNG_B64);
  console.log('printed url-policy accepted=8');
});

test('art URL policy refuses scripts, external hosts and non-image data', () => {
  const refused = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
    'http://evil.example/a.png', 'https://evil.example/a.png', 'https://studio.example.test/studio/a.png',
    '//evil.example/a.png', '\\\\evil.example/a.png', 'blob:https://studio.example.test/1234', 'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>', 'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml-evil,<svg/>', 'data:image/svg+xmlx,<svg/>', 'data:text/html;image/svg+xml,<svg/>',
    'data:image/svg+xml;foo=text/html,<svg/>', 'data:image/svg+xml;base64,<svg onload=alert(1)>',
    'data:image/png,rawbytes', 'data:image/png;base64,<script>', 'data:image/jpeg;base64,AAAA',
    'data:application/xhtml+xml,<x/>', 'vbscript:msgbox(1)', '', '   ', null, undefined, 42, {},
  ];
  for (const src of refused) assert.equal(artUrl(src, BASE), null, `accepted ${JSON.stringify(src)}`);
  // A relative path needs an absolute http(s) base to resolve against.
  assert.equal(artUrl('a.png', 'not a url'), null);
  assert.equal(artUrl('a.png', 'data:text/html,x'), null);
  console.log(`printed url-policy refused=${refused.length + 2}`);
});

test('sheet-local mm map to layer pixels like the render UVs (front) and mirrored (back)', () => {
  const box = { x0: 0, y0: 0, x1: 100, y1: 150 };
  const F = sideTransform(box, 'front', 1000), B = sideTransform(box, 'back', 1000);
  // Front: lower-left → bottom-left pixel, upper-right → top-right (canvas y down; the shader
  // samples t = 1 − v, so row 0 is the top of the sheet).
  assert.ok(pnear(affineApply(F, [0, 0]), [0, 1000]));
  assert.ok(pnear(affineApply(F, [100, 150]), [1000, 0]));
  assert.ok(pnear(affineApply(F, [50, 75]), [500, 500]));
  // Back: mirrored in x, because the shader samples the back layer at u' = 1 − u.
  assert.ok(pnear(affineApply(B, [0, 0]), [1000, 1000]));
  assert.ok(pnear(affineApply(B, [100, 150]), [0, 0]));
  assert.ok(pnear(affineApply(B, [25, 150]), [750, 0]));
  // Same mapping as UV: pixel x / size = u (front), 1 − u (back); pixel y / size = 1 − v.
  const p = [37, 20], uv = localToUv(box, p);
  assert.ok(near(affineApply(F, p)[0] / 1000, uv[0]) && near(affineApply(F, p)[1] / 1000, 1 - uv[1]));
  assert.ok(near(affineApply(B, p)[0] / 1000, 1 - uv[0]));
  // A box that does not start at the origin.
  const off = sideTransform({ x0: -3, y0: -3, x1: 97, y1: 47 }, 'front', 200);
  assert.ok(pnear(affineApply(off, [-3, -3]), [0, 200]) && pnear(affineApply(off, [97, 47]), [200, 0]));
  assert.ok(affineMul([1, 0, 0, 1, 0, 0], F).every((v, i) => near(v, F[i])), 'identity ∘ F = F');
});

test('layer size stays within the GPU limit and the memory budget', () => {
  assert.equal(artLayerSize(2), ART_MAX_PX);
  assert.equal(artLayerSize(2, 1024), 1024);
  assert.equal(artLayerSize(2, 3000), 2048);
  for (const n of [2, 4, 8, 16, 32]) {
    const s = artLayerSize(n);
    assert.ok(n * s * s * 4 <= ART_BUDGET_BYTES, `layers=${n} size=${s}`);
    assert.equal(s & (s - 1), 0);
  }
  assert.equal(artLayerSize(32), 512);
});

/** A two-sheet document: `card` (offset 10, 0; 100 × 150 mm) with art on both sides, three placed
 *  artworks and two annotations; `plain` with nothing printed. */
function printedDocument() {
  return {
    file_spec: 1.1,
    vertices_coords: [[10, 0], [110, 0], [110, 150], [10, 150], [200, 0], [260, 0], [260, 40], [200, 40]],
    faces_vertices: [[0, 1, 2, 3], [4, 5, 6, 7]],
    'pliego:vertices_sheet': [0, 0, 0, 0, 1, 1, 1, 1],
    'pliego:sheets': [
      { id: 'card', offset: [10, 0], grain_deg: 90, front: { color: '#ffffff', art: 'art/front.svg' }, back: { color: '#eeeeee', art: PNG_B64 } },
      { id: 'plain', offset: [200, 0], front: { color: '#f4efe6', art: null }, back: { color: '#f4efe6', art: null } },
    ],
    'pliego:dielines': [{
      sheet: 'card', bleed_mm: 3,
      panels: [{ name: 'front', kind: 'panel', polygon: [[0, 0], [50, 0], [50, 75], [0, 75]], print: true, bleed: [[-3, -3], [53, -3], [53, 78], [-3, 78]] }],
    }],
    'pliego:artwork': [
      { id: 'logo', sheet: 'card', side: 'front', asset: 'assets/logo.svg', at: [10, 20], size: [30, 10], rotation_deg: 0, panel: 'front', clip: 'panel' },
      { id: 'seal', sheet: 'card', side: 'back', asset: 'assets/seal.png', at: [10, 20], size: [30, 10], rotation_deg: 90, panel: 'front', clip: 'bleed' },
      { id: 'free', sheet: 'card', side: 'front', asset: 'assets/free.svg', at: [60, 100], size: [20, 20], rotation_deg: 0, clip: 'none' },
      { id: 'evil', sheet: 'card', side: 'front', asset: 'https://evil.example/x.svg', at: [0, 0], size: [5, 5], clip: 'none' },
      { id: 'lost', sheet: 'card', side: 'front', asset: 'assets/lost.svg', at: [0, 0], size: [5, 5], panel: 'nope', clip: 'panel' },
      { id: 'other', sheet: 'plain', side: 'front', asset: 'x.svg', at: [0, 0], size: [0, 5], clip: 'none' },
    ],
    'pliego:annotations': [
      { sheet: 'card', at: [50, 140], text: 'A1', angle: 0, size: 4 },
      { sheet: 'card', at: [90, 75], text: 'B2', angle: 90, size: 2 },
      { sheet: 'plain', at: [0, 0], text: '', size: 3 },
    ],
  };
}

test('sheetsFromDocument carries the local bounding box, artwork per side and annotations', () => {
  const [card, plain] = sheetsFromDocument(printedDocument());
  assert.deepEqual(card.bbox, { x0: 0, y0: 0, x1: 100, y1: 150 });
  assert.deepEqual(card.size, [100, 150]);
  assert.equal(card.artFront, 'art/front.svg');
  assert.equal(card.artBack, PNG_B64);
  assert.deepEqual(card.artwork.front.map((a) => a.asset), ['assets/logo.svg', 'assets/free.svg', 'https://evil.example/x.svg', 'assets/lost.svg']);
  assert.deepEqual(card.artwork.back.map((a) => a.asset), ['assets/seal.png']);
  assert.deepEqual(card.artwork.front[0].clip, [[0, 0], [50, 0], [50, 75], [0, 75]], 'clip: panel → the panel polygon');
  assert.deepEqual(card.artwork.back[0].clip, [[-3, -3], [53, -3], [53, 78], [-3, 78]], 'clip: bleed → the bleed polygon');
  assert.equal(card.artwork.front[1].clip, null, 'clip: none');
  assert.equal(card.artwork.front[3].clip, null, 'unknown panel → unclipped');
  assert.equal(card.artwork.back[0].rotationDeg, 90);
  assert.deepEqual(card.annotations, [
    { text: 'A1', at: [50, 140], angleDeg: 0, size: 4 },
    { text: 'B2', at: [90, 75], angleDeg: 90, size: 2 },
  ]);
  assert.deepEqual(plain.bbox, { x0: 0, y0: 0, x1: 60, y1: 40 });
  assert.deepEqual(plain.artwork, { front: [], back: [] }, 'zero-size artwork is skipped');
  assert.deepEqual(plain.annotations, [], 'empty text is skipped');
  assert.ok(hasPrinted(card, 'front') && hasPrinted(card, 'back'));
  assert.ok(!hasPrinted(plain, 'front') && !hasPrinted(plain, 'back'));
  // Annotations alone need a front layer, never a back one.
  const annOnly = { bbox: card.bbox, annotations: card.annotations, artwork: { front: [], back: [] } };
  assert.ok(hasPrinted(annOnly, 'front') && !hasPrinted(annOnly, 'back'));
  // printedFromDocument directly, for a sheet without vertices.
  const empty = printedFromDocument({ vertices_coords: [], 'pliego:sheets': [{ id: 'x' }] }, 0);
  assert.deepEqual(empty.bbox, { x0: 0, y0: 0, x1: 1, y1: 1 });
});

test('draw plan: art, then artwork, then annotations; back mirrored; refused URLs reported', () => {
  const [card, plain] = sheetsFromDocument(printedDocument());
  const S = 1500;   // square layer over a 100 × 150 mm sheet: 15 px/mm across, 10 px/mm up (anisotropic)
  const plan = planSheet(card, S, BASE);
  assert.deepEqual(plan.front.map((o) => o.kind), ['art', 'image', 'image', 'image', 'text', 'text']);
  assert.deepEqual(plan.back.map((o) => o.kind), ['art', 'image']);
  assert.deepEqual(plan.rejected, ['https://evil.example/x.svg']);
  assert.equal(plan.front[0].src, 'https://studio.example.test/studio/demo/art/front.svg');
  assert.deepEqual(plan.front[0].transform, [1, 0, 0, 1, 0, 0]);
  assert.equal(plan.back[0].src, PNG_B64);

  // Front logo: image corners (image frame, y down) land on its footprint (sheet-local, y up).
  const F = sideTransform(card.bbox, 'front', S);
  const logo = plan.front[1];
  assert.equal(logo.src, 'https://studio.example.test/studio/demo/assets/logo.svg');
  assert.ok(pnear(affineApply(logo.transform, [0, 0]), affineApply(F, [10, 30])), 'image top-left → footprint top-left');
  assert.ok(pnear(affineApply(logo.transform, [30, 10]), affineApply(F, [40, 20])), 'image bottom-right → footprint bottom-right');
  assert.deepEqual(logo.clip, [[0, 0], [50, 0], [50, 75], [0, 75]].map((p) => affineApply(F, p)));

  // Back seal, rotated 90° about its centre: centre (25, 25) and footprint as seen through the
  // paper; the image is right-reading in the back view (top-left of the image → mirrored corner).
  const B = sideTransform(card.bbox, 'back', S);
  const seal = plan.back[1];
  assert.ok(pnear(affineApply(seal.transform, [15, 5]), affineApply(B, [25, 25])), 'centre');
  // Sheet-local footprint of a 30 × 10 box rotated 90° about (25, 25): x ∈ [20, 30], y ∈ [10, 40].
  const corners = [[0, 0], [30, 0], [30, 10], [0, 10]].map((p) => affineApply(seal.transform, p));
  const xs = corners.map((p) => p[0]).sort((a, b) => a - b), ys = corners.map((p) => p[1]).sort((a, b) => a - b);
  const lo = affineApply(B, [30, 40]), hi = affineApply(B, [20, 10]);
  assert.ok(near(xs[0], lo[0]) && near(xs[3], hi[0]) && near(ys[0], lo[1]) && near(ys[3], hi[1]), 'footprint seen through the paper');
  // The back view is sheet-local mirrored, so a 90° CCW rotation in sheet-local mm is −90° there:
  // the image's top edge runs down sheet-local x = 20 (seen from the back: down the right side).
  assert.ok(pnear(corners[0], affineApply(B, [20, 40])), 'image top-left');
  assert.ok(pnear(corners[1], affineApply(B, [20, 10])), 'image top-right');
  assert.deepEqual(seal.clip, [[-3, -3], [53, -3], [53, 78], [-3, 78]].map((p) => affineApply(B, p)));

  // Annotation A1: glyph origin → `at`, glyph +x → +u, cap height = size mm.
  const a1 = plan.front[4];
  assert.equal(a1.text, 'A1');
  assert.ok(pnear(affineApply(a1.transform, [0, 0]), affineApply(F, [50, 140])));
  const cap = TEXT_EM_PX * CAP_HEIGHT_EM;
  assert.ok(near(a1.baseline, cap / 2));
  assert.ok(pnear(affineApply(a1.transform, [cap, 0]), affineApply(F, [54, 140])), 'baseline along +u, cap = 4 mm');
  assert.ok(pnear(affineApply(a1.transform, [0, -cap]), affineApply(F, [50, 144])), 'glyph up = sheet up');
  // Annotation B2 at 90°: its baseline runs along +v.
  const b2 = plan.front[5];
  assert.ok(pnear(affineApply(b2.transform, [cap, 0]), affineApply(F, [90, 77])));

  const none = planSheet(plain, S, BASE);
  assert.deepEqual([none.front, none.back, none.rejected], [[], [], []]);
});

test('layer executor clears, skips images not yet loaded, clips and paints in plan order', () => {
  const [card] = sheetsFromDocument(printedDocument());
  const plan = planSheet(card, 512, BASE);
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_, k) => (...args) => calls.push([k, ...args]),
    set: (_, k, v) => (calls.push([`=${String(k)}`, v]), true),
  });
  const img = { tag: 'loaded' };
  const before = drawLayer(ctx, plan.front, new Map(), 512);
  assert.equal(before, 2, 'only the two texts draw before any image loads');
  assert.deepEqual(calls[1], ['clearRect', 0, 0, 512, 512], 'transparent background: the paper colour shows');
  calls.length = 0;
  const images = new Map(plan.front.filter((o) => o.kind !== 'text').map((o) => [o.src, img]));
  assert.equal(drawLayer(ctx, plan.front, images, 512), 6);
  const paint = calls.filter((c) => c[0] === 'drawImage' || c[0] === 'fillText').map((c) => (c[0] === 'fillText' ? c[1] : c[4] === 512 ? 'art' : 'image'));
  assert.deepEqual(paint, ['art', 'image', 'image', 'image', 'A1', 'B2']);
  assert.equal(calls.filter((c) => c[0] === 'clip').length, 1, 'only the panel-clipped logo clips (the lost panel draws unclipped)');
  const clipAt = calls.findIndex((c) => c[0] === 'clip'), logoAt = calls.findIndex((c, i) => i > clipAt && c[0] === 'drawImage');
  assert.ok(clipAt > 0 && logoAt > clipAt);
  assert.deepEqual(calls.at(-1), ['setTransform', 1, 0, 0, 1, 0, 0]);
});

test('mesh helpers locate a sheet-local point on the render triangles', () => {
  // Two triangles of sheet 0 over the unit UV square, one of sheet 1 on top of them.
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1];
  const sheetIds = [0, 0, 0, 0, 1, 1, 1];
  const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6];
  assert.equal(locateUv(uvs, sheetIds, indices, 0, 0.8, 0.2), 0);
  assert.equal(locateUv(uvs, sheetIds, indices, 0, 0.2, 0.8), 1);
  assert.equal(locateUv(uvs, sheetIds, indices, 1, 0.8, 0.2), 2);
  assert.equal(locateUv(uvs, sheetIds, indices, 0, 1.5, 0.5), -1);
  const w = baryWeights(uvs, indices, 0, 0.8, 0.2);
  assert.ok(w && near(w[0] + w[1] + w[2], 1));
  const back = [0, 1, 2].map((k) => w[0] * uvs[indices[0] * 2 + (k & 1)] + w[1] * uvs[indices[1] * 2 + (k & 1)] + w[2] * uvs[indices[2] * 2 + (k & 1)]);
  assert.ok(near(back[0], 0.8) && near(back[1], 0.2));
  assert.equal(baryWeights([0, 0, 1, 1, 2, 2], [0, 1, 2], 0, 0.5, 0.5), null, 'degenerate UV triangle');
  assert.deepEqual(localToUv({ x0: 0, y0: 0, x1: 100, y1: 150 }, [50, 150]), [0.5, 1]);
});

test('printed images load only as images: no fetch, no DOM insertion, no inline SVG', () => {
  const printed = readFileSync(join(RENDER, 'printed.js'), 'utf8');
  const webgl = readFileSync(join(RENDER, 'webgl.js'), 'utf8');
  for (const [name, src] of [['printed.js', printed], ['webgl.js', webgl]]) {
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${name} fetches`);
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacent|DOMParser|appendChild|createElementNS/, `${name} touches the DOM tree`);
  }
  assert.doesNotMatch(printed, /\bdocument\b\.|\bwindow\b\./, 'printed.js stays DOM-free');
  assert.match(webgl, /new Image\(\)/);
  assert.match(webgl, /planSheet\(/);
  assert.match(webgl, /img\.src = src;/, 'image sources come only from the plan (artUrl)');
});
