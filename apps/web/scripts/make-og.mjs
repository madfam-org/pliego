#!/usr/bin/env node
// Writes apps/web/assets/img/og.png (1200×630): a sheet folded in the middle — a ruled cream half and
// a terracotta half on a dashed blue valley crease, a soft table shadow. Pure Node (zlib PNG encoder), deterministic.
//   node apps/web/scripts/make-og.mjs [--check]

import { deflateSync, crc32 } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1200, H = 630, SS = 3;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'img', 'og.png');
const img = new Float64Array(W * H * 3);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG = hex('#f6f1e7');
for (let i = 0; i < W * H; i++) img.set(BG, i * 3);

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Fill a polygon with colour (or colour function) at alpha, 3×3 supersampled. */
function fill(poly, color, alpha = 1, ss = SS) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let cov = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) if (inside(poly, x + (sx + 0.5) / ss, y + (sy + 0.5) / ss)) cov++;
    if (!cov) continue;
    const a = (cov / (ss * ss)) * alpha, c = typeof color === 'function' ? color(x, y) : color, k = (y * W + x) * 3;
    for (let ch = 0; ch < 3; ch++) img[k + ch] = img[k + ch] * (1 - a) + c[ch] * a;
  }
}

// Soft shadow: stacked translucent ellipses.
for (let r = 0; r < 14; r++) {
  const rx = 470 - r * 14, ry = 70 - r * 4, cx = 640, cy = 520;
  const pts = Array.from({ length: 64 }, (_, i) => [cx + rx * Math.cos((i / 64) * 2 * Math.PI), cy + ry * Math.sin((i / 64) * 2 * Math.PI)]);
  fill(pts, [90, 60, 30], 0.025, 1);
}
// Left half lying on the table, right half lifted (a valley fold at ~110°).
const A = [330, 455], B = [620, 520], C = [700, 215], D = [430, 175];          // left half
const E = [620, 520], F = [760, 380], G = [845, 70], Hh = [700, 215];            // right half (lifted)
const shade = (base, k) => base.map((v) => Math.round(v * k));
fill([A, B, C, D], (x, y) => shade(hex('#fbf7ef'), 0.96 + 0.04 * ((x - 330) / 400)));
fill([E, F, G, Hh], (x, y) => shade(hex('#c8553d'), 0.92 + 0.1 * ((y - 70) / 450)));
fill([[E[0] + 4, E[1]], [Hh[0] + 4, Hh[1]], [Hh[0] + 40, Hh[1] + 20], [E[0] + 30, E[1] - 8]], [60, 30, 15], 0.08);
// Printed rules on the left half.
for (let i = 1; i < 9; i++) {
  const t = i / 9;
  const p = [A[0] + (D[0] - A[0]) * t, A[1] + (D[1] - A[1]) * t], q = [B[0] + (C[0] - B[0]) * t, B[1] + (C[1] - B[1]) * t];
  const p2 = [p[0] + (q[0] - p[0]) * 0.12, p[1] + (q[1] - p[1]) * 0.12], q2 = [p[0] + (q[0] - p[0]) * 0.88, p[1] + (q[1] - p[1]) * 0.88];
  fill([p2, q2, [q2[0], q2[1] + 1.6], [p2[0], p2[1] + 1.6]], hex('#d8ccb6'));
}
// Dashed valley crease along B–C.
for (let s = 0; s < 1; s += 0.06) {
  const e = Math.min(1, s + 0.035);
  const p = [B[0] + (C[0] - B[0]) * s, B[1] + (C[1] - B[1]) * s], q = [B[0] + (C[0] - B[0]) * e, B[1] + (C[1] - B[1]) * e];
  fill([[p[0] - 2, p[1]], [q[0] - 2, q[1]], [q[0] + 2, q[1]], [p[0] + 2, p[1]]], hex('#2a5d9a'));
}

// ---------- PNG encode ----------
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W * 3; x++) raw[y * (W * 3 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(img[y * W * 3 + x])));
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);

if (process.argv.includes('--check')) {
  const same = existsSync(OUT) && Buffer.compare(readFileSync(OUT), png) === 0;
  console.log(`make-og: bytes=${png.length} drift=${same ? 0 : 1}`);
  if (!same) process.exit(1);
} else {
  writeFileSync(OUT, png);
  console.log(`make-og: wrote ${OUT} bytes=${png.length}`);
}
