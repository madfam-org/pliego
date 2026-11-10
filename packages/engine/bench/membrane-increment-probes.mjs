// Bounded fixed-pose arithmetic witnesses. Actual EnergySearch, no timestep/solve.
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
const hash = value => createHash('sha256').update(value).digest('hex');
function source() {
  const names = [];
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), name + '/');
      else if (entry.name.endsWith('.js')) names.push(name);
    }
  };
  visit(join(root, 'packages/engine/src'), 'packages/engine/src/');
  names.push('packages/engine/bench/membrane-increment-probes.mjs', 'packages/engine/bench/membrane-increment-precision.py',
    'packages/engine/test/membrane-increment-precision.test.js', 'packages/engine/bench/plane-stress-precision.py',
    'packages/engine/bench/membrane-patch.mjs', 'packages/engine/test/helpers/docbuilder.js');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  return { git: git('rev-parse', 'HEAD'), status: git('status', '--porcelain'),
    files: names.sort().map(path => ({ path, sha256: hash(readFileSync(join(root, path))) })) };
}

export function runIncrementProbes({ allowDirty = false } = {}) {
  const beforeSource = source();
  assert.ok(allowDirty || !beforeSource.status, 'clean source required; --allow-dirty is development only');
  const cases = [];
  for (const grain of [0, 31, 45, 90]) {
    const patch = makePatch({ cells: 1, grain, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
    const w = new World(patch.doc, { ...patch.options, damping: 0, bendDamping: 0, substeps: 1000,
      lineSearchArithmetic: 'membrane-inertia-increment' });
    const before = w.X0.slice(), g = new Float64Array(w.x.length); gradient(w, before, g);
    for (const index of [0, 2]) for (const direction of [-1, 1]) for (const magnitude of [2**-40, 2**-50]) {
      w.x.set(before); w.xt.set(before); w.xs.set(before); w.v.fill(0);
      w.energySearch.begin(w); w.x[index] += direction * magnitude;
      const candidate = w.x.slice(); w.energySearch.finish(w, g);
      const last = w.energySearch.increment.last;
      assert.ok(last && Number.isInteger(last.trials) && last.trials >= 1, 'actual last trial unavailable');
      const after = last.trials === 1 ? candidate
        : Float64Array.from(before, (x, i) => x + last.alpha * (candidate[i] - x));
      if (last.decision === 'accepted') assert.deepEqual(after, w.x, 'actual accepted trial reconstruction changed');
      else assert.deepEqual(before, w.x, 'rejected actual search did not restore its start');
      const mesh = w.mesh;
      cases.push({ probe: { grain, index, direction, magnitude, decision: last.decision },
        vertices: patch.vertices, triangles: patch.triangles, material: patch.material, grain,
        referenceCoefficients: {
          triangles: Array.from({ length: mesh.nT }, (_, i) => Array.from(mesh.tris.slice(3*i, 3*i+3))),
          elements: w.orthotropicMembrane.elements.map(e => ({ alpha: Array.from(e.alpha), beta: Array.from(e.beta), Q: Array.from(e.Q), volume: e.volume })) },
        before: Array.from(before), after: Array.from(after), xt: Array.from(w.xt), mass: Array.from(w.mass), h: w.dt,
        gradient: Array.from(g), runtime: { ...last, c1: 1e-4 } });
      const captured = cases[cases.length - 1], stateFloat64LE = {}, stateSHA256 = {};
      for (const key of ['before', 'after', 'xt', 'mass', 'h', 'gradient']) {
        const values = key === 'h' ? [captured.h] : captured[key], bytes = Buffer.alloc(8 * values.length);
        values.forEach((value, i) => bytes.writeDoubleLE(value, 8 * i));
        stateFloat64LE[key] = bytes.toString('base64'); stateSHA256[key] = hash(bytes);
      }
      Object.assign(captured, { stateFloat64LE, stateSHA256 });
    }
  }
  assert.equal(cases.length, 32);
  assert.deepEqual(source(), beforeSource, 'source changed during fixed-pose probes; discard output');
  return { schema: 'pliego-membrane-increment-probes/1', source: { ...beforeSource, dirty: !!beforeSource.status, status: undefined },
    runtime: { node: process.version, arch: process.arch, platform: process.platform },
    protocol: { grains: [0, 31, 45, 90], indices: [0, 2], directions: [-1, 1], magnitudesMm: [2**-40, 2**-50],
      substeps: 1000, poses: 'native rest; xt=before; actual candidate then actual EnergySearch.finish; last evaluated endpoint reconstructed using exact source interpolation',
      scope: 'bounded fixed-pose arithmetic witnesses only; no World timestep, physical force convergence, calibration or general real-descent guarantee' }, cases };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), index = args.indexOf('--out');
  assert.ok(args.every((value, i) => value === '--allow-dirty' || value === '--out' || i === index + 1 && index >= 0), 'unknown option');
  assert.ok(index < 0 || args[index+1] && !args[index+1].startsWith('--'), '--out requires a path');
  const output = index < 0 ? null : resolve(args[index+1]);
  if (output) {
    const location = relative(root, output);
    assert.ok(location && (location.startsWith('..' + sep) || isAbsolute(location)), '--out must be outside the checkout');
  }
  const report = runIncrementProbes({ allowDirty: args.includes('--allow-dirty') });
  const bytes = JSON.stringify(report) + '\n';
  if (output) writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 }); else process.stdout.write(bytes);
  console.error('increment-probes: 32 actual fixed-pose searches; source guard exact; ' + (report.source.dirty ? 'development dirty source' : 'clean source') + '; no timestep or force convergence claim');
}
