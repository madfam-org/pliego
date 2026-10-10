// Demo documents: generated (no drift), structurally valid against the schema's top-level contract,
// and semantically valid per docs/spec/v1/sheet-document.md §8 (the checks a WebGL-less lane can do).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { signedArea } from '../studio/src/geom.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = join(WEB, 'studio', 'demo');
const SCHEMA_PATH = join(WEB, '..', '..', 'packages', 'schemas', 'sheet-document.schema.json');
const docs = readdirSync(DEMO).filter((f) => f.endsWith('.fold')).map((f) => [f, JSON.parse(readFileSync(join(DEMO, f), 'utf8'))]);

const ALLOWED = { none: 'BJUF', crease: 'MVF', score: 'MVF', perforation: 'MVFC', cut: 'C', halfcut: 'F' };
const DERIVED = ['areal_density', 'thickness', 'E_md', 'E_cd', 'nu', 'D_md', 'D_cd', 'crease_k', 'crease_yield_deg', 'crease_set_rate', 'score_factor', 'perf_factor', 'tear_strain', 'friction', 'collision_thickness'];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

test('demo documents are generated (make-demos --check reports no drift)', () => {
  const r = spawnSync(process.execPath, [join(WEB, 'scripts', 'make-demos.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /files=4 drift=0/);
});

test('at least three demo documents exist', () => {
  assert.ok(docs.length >= 3, `found ${docs.length}`);
  console.log(`demo-docs: documents=${docs.length}`);
});

for (const [name, d] of docs) {
  test(`${name}: top-level contract matches the schema`, () => {
    if (!existsSync(SCHEMA_PATH)) return;   // schema lives outside apps/web; skip only if absent
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    for (const k of schema.required) assert.ok(k in d, `missing ${k}`);
    for (const k of Object.keys(d)) assert.ok(k in schema.properties || /^[a-z][a-zA-Z0-9]*:/.test(k), `unexpected key ${k}`);
    const sheetReq = schema.$defs.sheet.required, ctlReq = schema.$defs.control.required;
    for (const s of d['pliego:sheets']) for (const k of sheetReq) assert.ok(k in s, `sheet ${s.id} missing ${k}`);
    for (const c of d['pliego:controls'] || []) for (const k of ctlReq) assert.ok(k in c, `control ${c.id} missing ${k}`);
    assert.equal(d.file_spec, 1.2);
    assert.equal(d['pliego:version'], 1);
  });

  test(`${name}: semantic rules (spec §8)`, () => {
    const V = d.vertices_coords.length, E = d.edges_vertices.length, F = d.faces_vertices.length;
    // 1. lengths and ranges
    for (const [k, n] of [['edges_assignment', E], ['edges_foldAngle', E], ['pliego:edges_sheet', E], ['pliego:edges_treatment', E], ['pliego:vertices_sheet', V], ['pliego:faces_sheet', F]]) assert.equal(d[k].length, n, k);
    const vs = d['pliego:vertices_sheet'];
    // 2. same sheet
    d.edges_vertices.forEach(([a, b], e) => { assert.ok(a < V && b < V); assert.equal(vs[a], d['pliego:edges_sheet'][e]); assert.equal(vs[b], d['pliego:edges_sheet'][e]); });
    // 3. faces CCW, non-degenerate, each face boundary made of declared edges
    const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
    const edgeIdx = new Map(d.edges_vertices.map(([a, b], e) => [key(a, b), e]));
    const use = new Array(E).fill(0);
    d.faces_vertices.forEach((f, i) => {
      assert.ok(signedArea(f.map((v) => d.vertices_coords[v])) >= 1, `face ${i} not CCW or < 1 mm²`);
      f.forEach((a, k) => { const e = edgeIdx.get(key(a, f[(k + 1) % f.length])); assert.ok(e !== undefined, `face ${i} edge ${a}-${f[(k + 1) % f.length]} undeclared`); use[e]++; assert.equal(vs[a], d['pliego:faces_sheet'][i]); });
    });
    // 4. assignment / treatment pairs; B borders one face, interior two; C fold angle 0
    d.edges_assignment.forEach((as, e) => {
      const tr = d['pliego:edges_treatment'][e];
      assert.ok(ALLOWED[tr] && ALLOWED[tr].includes(as), `edge ${e}: ${as}/${tr} not allowed`);
      if (as === 'B') assert.equal(use[e], 1, `B edge ${e} borders ${use[e]} faces`);
      else if (as !== 'C') assert.equal(use[e], 2, `interior edge ${e} borders ${use[e]} faces`);
      if ('BFCJU'.includes(as)) assert.equal(d.edges_foldAngle[e], 0, `edge ${e} (${as}) must have fold angle 0`);
      assert.ok(Math.abs(d.edges_foldAngle[e]) <= 180);
    });
    // 5. sheets do not overlap in the layout frame (bounding boxes, demos are rectangles/kites)
    const boxes = d['pliego:sheets'].map((_, s) => { const p = d.vertices_coords.filter((__, v) => vs[v] === s); return [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))]; });
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      assert.ok(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1], `sheets ${i} and ${j} overlap in layout`);
    }
    // 6. stocks resolve with complete derived blocks; ids are slugs
    const ids = new Set();
    for (const s of d['pliego:sheets']) {
      assert.match(s.id, SLUG); assert.ok(!ids.has(s.id)); ids.add(s.id);
      const st = d['pliego:stocks'][s.stock]; assert.ok(st, `stock ${s.stock}`);
      for (const k of DERIVED) assert.equal(typeof st.derived[k], 'number', `${s.stock}.derived.${k}`);
      for (const l of ['en', 'es', 'fr', 'pt']) assert.ok(s.label[l], `sheet ${s.id} label.${l}`);
    }
    // 7. references resolve
    const controls = new Set((d['pliego:controls'] || []).map((c) => c.id));
    const mechs = new Set((d['pliego:mechanisms'] || []).map((m) => m.id));
    for (const m of d['pliego:mechanisms'] || []) {
      const c = m.control || m.angle_control; assert.ok(controls.has(c), `mechanism ${m.id} control ${c}`);
      for (const s of [m.sheet, ...(m.sheets_moving || [])].filter(Boolean)) assert.ok(ids.has(s), `mechanism ${m.id} sheet ${s}`);
    }
    for (const s of d['pliego:sheets']) if (s.kinematic) assert.ok(mechs.has(s.kinematic.mechanism));
    for (const j of d['pliego:joins'] || []) { assert.ok(ids.has(j.a.sheet)); if (j.b && j.b.sheet) assert.ok(ids.has(j.b.sheet)); }
    // 8. sequence targets reference M/V/F edges
    for (const st of d['pliego:sequence']?.steps || []) {
      for (const [e, ang] of st.targets) { assert.ok('MVF'.includes(d.edges_assignment[e]), `step ${st.id} targets edge ${e}`); assert.ok(Math.abs(ang) <= 180); }
      for (const l of ['en', 'es', 'fr', 'pt']) assert.ok(st.label[l], `step ${st.id} label.${l}`);
    }
    if (d['pliego:sequence']) assert.ok([...controls].some((c) => d['pliego:controls'].find((x) => x.id === c).kind === 'sequence'), 'sequence needs a sequence control');
  });

  test(`${name}: initial frame is developable and satisfies glue welds (spec §8.9)`, () => {
    const init = (d.file_frames || []).find((f) => f.frame_title === 'initial');
    const needs = (d['pliego:joins'] || []).length > 0;
    if (!init) { assert.ok(!needs, 'joins require an initial frame'); return; }
    assert.equal(init.vertices_coords.length, d.vertices_coords.length);
    const L = d.vertices_coords, W = init.vertices_coords;
    let worst = 0;
    d.edges_vertices.forEach(([a, b]) => {
      const l2 = Math.hypot(L[a][0] - L[b][0], L[a][1] - L[b][1]);
      const l3 = Math.hypot(W[a][0] - W[b][0], W[a][1] - W[b][1], W[a][2] - W[b][2]);
      worst = Math.max(worst, Math.abs(l2 - l3) / l2);
    });
    assert.ok(worst < 1e-3, `edge length mismatch ${worst}`);
    const sheets = d['pliego:sheets'], idx = new Map(sheets.map((s, i) => [s.id, i]));
    for (const j of (d['pliego:joins'] || []).filter((x) => x.type === 'glue')) {
      const a = idx.get(j.a.sheet), b = sheets[idx.get(j.b.sheet)];
      const tol = d['pliego:stocks'][b.stock].derived.collision_thickness + 1e-3;
      const near = (p) => j.a.region.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 2);
      let checked = 0;
      d.vertices_coords.forEach((p, v) => {
        if (d['pliego:vertices_sheet'][v] !== a) return;
        const local = [p[0] - sheets[a].offset[0], p[1] - sheets[a].offset[1]];
        if (!near(local)) return;
        const m = j.map;
        const bl = [m[0] * local[0] + m[1] * local[1] + m[4], m[2] * local[0] + m[3] * local[1] + m[5]];
        const bw = [bl[0] + b.placement.origin[0], b.placement.origin[1], -bl[1] + b.placement.origin[2]];   // boards are unrotated in the demos
        const dist = Math.hypot(bw[0] - W[v][0], bw[1] - W[v][1], bw[2] - W[v][2]);
        assert.ok(dist <= tol, `glue ${j.id}: vertex ${v} is ${dist.toFixed(4)} mm from its weld`);
        checked++;
      });
      assert.ok(checked >= 3, `glue ${j.id}: checked only ${checked} vertices`);
    }
  });
}

test('catalog.json lists every demo document with i18n titles and valid parameters', () => {
  const cat = JSON.parse(readFileSync(join(DEMO, 'catalog.json'), 'utf8'));
  assert.ok(cat.items.length >= 3);
  for (const it of cat.items) {
    assert.match(it.slug, SLUG);
    assert.ok(existsSync(join(DEMO, it.document)), `${it.slug}: ${it.document} missing`);
    for (const l of ['en', 'es', 'fr', 'pt']) { assert.ok(it.title[l]); assert.ok(it.summary[l]); }
    for (const p of it.parameters) {
      assert.ok(['slider', 'select', 'checkbox'].includes(p.type));
      for (const l of ['en', 'es', 'fr', 'pt']) assert.ok(p.label[l], `${it.slug}.${p.id}.label.${l}`);
      if (p.type === 'slider') assert.ok(p.min <= p.default && p.default <= p.max);
      if (p.type === 'select') assert.ok(p.options.some((o) => o.value === p.default));
    }
  }
});
