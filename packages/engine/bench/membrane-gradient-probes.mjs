// Actual selected-law fixed-pose evaluation only: no World.step/Newton/solve.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import { makePatch } from './membrane-patch.mjs';
import { World } from '../src/index.js';
import { gradient } from '../src/xpbd/implicit.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const defaultInput = join(root, 'docs/research/evidence/membrane-increment-2026-11-10/captured-trials-input.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const numericEqual = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const bytes = values => { const result = Buffer.alloc(8*values.length); values.forEach((value, i) => result.writeDoubleLE(value, 8*i)); return result; };
function source() {
  const names = [];
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.isDirectory()) visit(join(directory, entry.name), prefix+entry.name+'/');
      else if (entry.name.endsWith('.js')) names.push(prefix+entry.name);
    }
  };
  visit(join(root, 'packages/engine/src'), 'packages/engine/src/');
  names.push('packages/engine/bench/membrane-gradient-probes.mjs', 'packages/engine/bench/membrane-gradient-precision.py',
    'packages/engine/test/membrane-gradient-precision.test.js', 'packages/engine/bench/membrane-increment-precision.py',
    'packages/engine/bench/plane-stress-precision.py', 'packages/engine/bench/membrane-patch.mjs', 'packages/engine/test/helpers/docbuilder.js');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  return { git: git('rev-parse', 'HEAD'), status: git('status', '--porcelain'),
    files: names.sort().map(path => ({ path, sha256: hash(readFileSync(join(root, path))) })) };
}
function archivedState(record, n) {
  const result = {};
  for (const [key, count] of [['before', 3*n], ['after', 3*n], ['xt', 3*n], ['mass', n], ['h', 1], ['gradient', 3*n]]) {
    const values = key === 'h' ? [record.h] : record[key];
    assert.ok(Array.isArray(values) && values.length === count && values.every(finite), 'finite archived '+key+' required');
    const encoded = record.stateFloat64LE?.[key]; assert.equal(typeof encoded, 'string', 'lossless archived '+key+' required');
    const raw = Buffer.from(encoded, 'base64'); assert.equal(raw.toString('base64'), encoded, 'canonical base64 required');
    assert.equal(raw.length, 8*count); assert.equal(hash(raw), record.stateSHA256?.[key]);
    const decoded = Array.from({ length: count }, (_, i) => raw.readDoubleLE(8*i));
    assert.ok(decoded.every(finite) && numericEqual(decoded, values), 'archived numeric/LE state differs');
    result[key] = decoded;
  }
  return result;
}

export function runGradientProbes({ input = defaultInput, allowDirty = false, arithmetic = 'both' } = {}) {
  assert.ok(['both', 'binary64', 'double-double'].includes(arithmetic), 'invalid arithmetic');
  const start = source(); assert.ok(allowDirty || !start.status, 'clean source required; --allow-dirty is development only');
  const inputRaw = readFileSync(input), archived = JSON.parse(inputRaw);
  assert.ok(Array.isArray(archived.cases) && archived.cases.length === 85, 'declared85 archived poses required');
  const modes = arithmetic === 'both' ? ['binary64', 'double-double'] : [arithmetic], cases = [];
  for (const [inputIndex, record] of archived.cases.entries()) {
    const cells = Math.sqrt(record.vertices.length)-1;
    assert.ok(Number.isInteger(cells) && cells === 2 && record.grain === 0, 'initial domain is native cells2/forward/grain0');
    const patch = makePatch({ cells, pattern: 'forward', grain: record.grain, membraneModel: 'orthotropic-stvk', membraneNu12: record.material.nu12 });
    assert.deepEqual(patch.vertices, record.vertices); assert.deepEqual(patch.triangles, record.triangles); assert.deepEqual(patch.material, record.material);
    const old = archivedState(record, patch.vertices.length), h = old.h[0], substeps = Math.round(1/(60*h));
    assert.ok(Number.isSafeInteger(substeps) && substeps > 0);
    for (const mode of modes) {
      const w = new World(patch.doc, { ...patch.options, damping: 0, bendDamping: 0, substeps,
        lineSearchArithmetic: 'membrane-inertia-increment', membraneArithmetic: mode });
      const mesh = w.mesh, selected = w.orthotropicMembrane;
      assert.equal(w.dt, h); assert.ok(bytes(Array.from(w.mass)).equals(bytes(old.mass)), 'actual native mass changed');
      assert.ok(numericEqual(Array.from(mesh.uv), record.vertices.flat()));
      assert.deepEqual(Array.from(mesh.tris), record.referenceCoefficients.triangles.flat(), 'actual native cycles changed');
      selected.elements.forEach((element, i) => {
        const stored = record.referenceCoefficients.elements[i];
        for (const key of ['alpha', 'beta', 'Q']) assert.ok(numericEqual(Array.from(element[key]), stored[key]), 'stored coefficient real values changed');
        assert.equal(element.volume, stored.volume);
      });
      w.x.set(old.before); w.xt.set(old.xt); w.xs.set(old.before); w.v.fill(0);
      assert.ok(selected.diagnostics(w.x).finite && !w.fixed.some(Boolean) && !w.terms.active.some(Boolean) && !w.driveOn.some(Boolean));
      const elastic = new Float64Array(w.x.length), selectedGradient = new Float64Array(w.x.length);
      gradient(w, w.x, elastic); selected.addGradient(w.x, selectedGradient);
      assert.ok(numericEqual(Array.from(elastic), Array.from(selectedGradient)), 'non-membrane gradient entered evaluation');
      const energy = selected.energy(w.x); assert.ok(finite(energy));
      const idt2 = 1/(h*h), inertia = Array.from(w.x, (value, i) => w.mass[Math.floor(i/3)]*idt2*(value-w.xt[i]));
      const incremental = Array.from(elastic, (value, i) => value+inertia[i]);
      if (mode === 'binary64') assert.ok(numericEqual(incremental, old.gradient), 'original rounded incremental gradient replay changed');
      assert.equal(w.time, 0); assert.equal(w.substepsRun, 0); assert.equal(w.framesRun, 0); assert.equal(w.factorCount, 0);
      const value = { vertices: patch.vertices, triangles: patch.triangles, material: patch.material, grain: record.grain,
        referenceCoefficients: record.referenceCoefficients, x: Array.from(w.x), xt: Array.from(w.xt), mass: Array.from(w.mass), h,
        direction: old.after.map((x, i) => x-old.before[i]), inertiaGradient: inertia,
        runtime: { arithmetic: mode, energy, gradient: Array.from(elastic), incrementalGradient: incremental,
          law: selected.configuration.model, curvature: selected.configuration.curvature,
          poissonConvention: selected.configuration.poissonConvention, arithmeticIdentity: selected.configuration.arithmetic ?? null,
          lawConfigurationSHA256: hash(w.orthotropicMembraneSignature) },
        capture: { inputIndex, cells, pattern: 'forward', originalRuntimeDecision: record.runtime.decision,
          evaluation: 'actual selected elastic energy and full native elastic gradient; zero omitted gradient verified; native M*(1/(h*h))*(x-xt), then rounded elastic+inertia; no Newton or timestep executed' } };
      value.stateFloat64LE = {}; value.stateSHA256 = {};
      for (const key of ['x', 'gradient', 'direction', 'inertiaGradient', 'xt', 'mass', 'h', 'incrementalGradient']) {
        const array = key === 'h' ? [h] : key === 'gradient' || key === 'incrementalGradient' ? value.runtime[key] : value[key];
        const raw = bytes(array); value.stateFloat64LE[key] = raw.toString('base64'); value.stateSHA256[key] = hash(raw);
      }
      cases.push(value);
    }
  }
  assert.equal(cases.length, 85*modes.length);
  assert.equal(hash(readFileSync(input)), hash(inputRaw), 'archived input changed during evaluation');
  assert.deepEqual(source(), start, 'source changed during fixed-pose evaluation');
  return { schema: 'pliego-membrane-gradient-probes/1', source: { ...start, status: undefined, dirty: !!start.status },
    runtime: { node: process.version, arch: process.arch, platform: process.platform },
    input: { label: 'archived-85-captured-before-poses', sha256: hash(inputRaw), bytes: inputRaw.length },
    protocol: { arithmetic: modes, poses: 85, selectedLaw: 'orthotropic-stvk', nativeGeometry: '40x40mm cells2/forward/grain0',
      direction: 'actual archived endpoint-after minus before, binary64; identical supplied comparison direction for both modes',
      scope: 'fixed-pose constitutive/native-inertia evaluation only; no World.step, Newton solve, factorization, time-accuracy or force-gate acceptance' }, cases };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), outIndex = args.indexOf('--out'), inputIndex = args.indexOf('--input'), arithmeticIndex = args.indexOf('--membrane-arithmetic');
  const indices = [outIndex, inputIndex, arithmeticIndex];
  assert.ok(args.every((v, i) => ['--out', '--input', '--membrane-arithmetic', '--allow-dirty'].includes(v) || indices.some(index => index >= 0 && i === index+1)), 'unknown option');
  for (const index of indices) assert.ok(index < 0 || args[index+1] && !args[index+1].startsWith('--'), 'option requires a value');
  const output = outIndex < 0 ? null : resolve(args[outIndex+1]);
  if (output) { const location = relative(root, output); assert.ok(location && (location.startsWith('..'+sep) || isAbsolute(location)), '--out must be outside checkout'); }
  const report = runGradientProbes({ input: inputIndex < 0 ? defaultInput : resolve(args[inputIndex+1]), allowDirty: args.includes('--allow-dirty'),
    arithmetic: arithmeticIndex < 0 ? 'both' : args[arithmeticIndex+1] });
  const raw = JSON.stringify(report)+'\n';
  if (output) writeFileSync(output, raw, { flag: 'wx', mode: 0o600 }); else process.stdout.write(raw);
  console.error('gradient-probes: '+report.cases.length+' actual native fixed-pose evaluations; input/source guards exact; '+(report.source.dirty ? 'development dirty source' : 'clean source')+'; no timestep/solve');
}
