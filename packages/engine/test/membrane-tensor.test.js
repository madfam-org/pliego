import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, extractTensor, tensorErrors, relativeDifference, symmetricEigenvalues } from '../bench/membrane-tensor.mjs';

test('membrane tensor extraction recovers a coupled engineering-shear quadratic and rejects asymmetric policy', () => {
  const target = [[7, 2, -0.7], [2, 4, 0.3], [-0.7, 0.3, 1.5]], volume = 160, h = 2.5e-5;
  const energies = { zero: 0 };
  for (const [key, direction] of MODES) {
    const e = 0.5 * volume * h * h * direction.reduce((s, v, i) => s + v * target[i].reduce((n, q, j) => n + q * direction[j], 0), 0);
    energies[key] = { positive: e, negative: e };
  }
  const measured = extractTensor(energies, volume, h);
  assert.ok(relativeDifference(measured, target) < 1e-15);
  assert.ok(tensorErrors(measured, target).maximumNormalizedEntryError < 1e-15);
  assert.throws(() => extractTensor(energies, volume, h, false), /no unique/);
  assert.deepEqual(symmetricEigenvalues([[2, 1, 0], [1, 2, 0], [0, 0, 4]]), [1, 3, 4]);
  console.log('membrane-tensor: complete anisotropic tensor, signed energy combinations and engineering shear recovered; asymmetric policy refused');
});
