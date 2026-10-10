// @ts-check
/**
 * Smoke-run the engine over a directory of generated cartridge documents (one sub-directory per
 * cartridge, `*.fold` inside): load, build a World, play the sequence to the end and move every
 * ranged control, then report per document: loads / steps without NaN / max stretch and compression
 * / ms per frame. Generate the documents with the kernel first, e.g.
 *   PYTHONPATH=packages/kernel/src PLIEGO_MATERIALS=materials python -m pliego.cartridge <dir> --out <out>
 * Usage: node packages/engine/test/helpers/smoke-cartridges.js <out-root> [frames=60] [filter]
 * `filter` keeps the documents whose path contains it (a plain substring, not a pattern).
 */
import fs from 'node:fs';
import path from 'node:path';
import { World, loadDocument } from '../../src/index.js';

const [root, framesArg, only] = process.argv.slice(2);
if (!root) { console.error('usage: smoke-cartridges.js <root> [frames] [filter]'); process.exit(2); }
const frames = Number(framesArg ?? 60);
const files = [];
for (const d of fs.readdirSync(root).sort()) {
  const dir = path.join(root, d);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.fold')) files.push(path.join(dir, f));
}
let ok = 0, ran = 0;
for (const f of files) {
  if (only && !f.includes(only)) continue;
  ran++;
  const name = path.relative(root, f);
  let doc;
  try { doc = loadDocument(fs.readFileSync(f, 'utf8')); } catch (e) { console.log(`smoke ${name}: loads=no ${String(/** @type {Error} */(e).message).split('\n').slice(0, 3).join(' | ')}`); continue; }
  try {
    const w = new World(doc, {});
    for (const c of doc.controls) {
      if (c.kind === 'sequence' && doc.sequence) w.setControl(c.id, doc.sequence.steps.length);
      else if (c.kind === 'wind') w.setControl(c.id, 2);
      else if (typeof c.min === 'number' && typeof c.max === 'number' && c.min !== c.max) w.setControl(c.id, c.default === c.max ? c.min + 0.5 * (c.max - c.min) : c.max);
    }
    let maxS = 0, maxC = 0, finite = true;
    const t0 = performance.now();
    for (let k = 0; k < frames && finite; k++) { w.step(); const s = w.stats(); maxS = Math.max(maxS, s.maxStrain); maxC = Math.max(maxC, s.maxCompression); finite = s.finite; }
    const ms = (performance.now() - t0) / frames;
    if (finite) ok++;
    console.log(`smoke ${name}: loads=yes V=${w.mesh.nV} steps=${finite ? 'no-NaN' : 'NaN'} maxStretch=${(maxS * 100).toFixed(3)}% maxCompression=${(maxC * 100).toFixed(2)}% ms/frame=${ms.toFixed(1)}`);
  } catch (e) { console.log(`smoke ${name}: loads=yes error=${/** @type {Error} */(e).message}`); }
}
console.log(`smoke: documents=${ran} ran-clean=${ok}`);
