// Engineering-Voigt [exx, eyy, gamma=2exy] audit math; no engine constitutive law.
import assert from 'node:assert/strict';
export const MODES = [
  ['x', [1, 0, 0]], ['y', [0, 1, 0]], ['s', [0, 0, 1]],
  ['xy+', [1, 1, 0]], ['xy-', [1, -1, 0]],
  ['xs+', [1, 0, 1]], ['xs-', [1, 0, -1]],
  ['ys+', [0, 1, 1]], ['ys-', [0, 1, -1]],
];
export const norm = values => Math.hypot(...values.flat());
export const relativeDifference = (a, b) => norm(a.map((r, i) => r.map((v, j) => v - b[i][j]))) / Math.max(norm(a), norm(b), Number.MIN_VALUE);

/** Central energy tangent. Input retains BOTH signs; only symmetric compression
 * policies possess the zero-strain tensor being measured here. */
export function extractTensor(energies, volume, h, symmetricCompression = true) {
  assert.equal(symmetricCompression, true, 'asymmetric compression has no unique zero-strain tangent');
  assert.ok(volume > 0 && h > 0 && Number.isFinite(volume * h));
  const c = Array.from({ length: 3 }, () => [0, 0, 0]), z = energies.zero;
  assert.ok(Number.isFinite(z));
  for (const [name] of MODES) for (const sign of ['positive', 'negative']) assert.ok(Number.isFinite(energies[name][sign]));
  for (const [i, key] of ['x', 'y', 's'].entries()) c[i][i] = (energies[key].positive + energies[key].negative - 2 * z) / (volume * h * h);
  for (const [i, j, key] of [[0, 1, 'xy'], [0, 2, 'xs'], [1, 2, 'ys']]) {
    c[i][j] = c[j][i] = (energies[key + '+'].positive + energies[key + '+'].negative - energies[key + '-'].positive - energies[key + '-'].negative) / (4 * volume * h * h);
  }
  return c;
}

export function tensorErrors(actual, target) {
  const entryErrors = actual.map((row, i) => row.map((v, j) => Math.abs(v - target[i][j]) / Math.sqrt(target[i][i] * target[j][j])));
  return { relativeFrobenius: norm(actual.map((r, i) => r.map((v, j) => v - target[i][j]))) / norm(target),
    normalizedEntryErrors: entryErrors, maximumNormalizedEntryError: Math.max(...entryErrors.flat()),
    centralForceNormalization: 'norm(actual measured tensor)',
    centralForceC12MinusC66Normalized: Math.abs(actual[0][1] - actual[2][2]) / norm(actual),
    eigenvalues: symmetricEigenvalues(actual) };
}

/** Jacobi spectrum used for diagnostics, never to modify the measured tensor. */
export function symmetricEigenvalues(input) {
  const a = input.map(r => r.slice());
  for (let step = 0; step < 32; step++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) <= 1e-15 * Math.max(1, norm(a))) break;
    const theta = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(theta), s = Math.sin(theta);
    const pp = c * c * a[p][p] - 2 * s * c * a[p][q] + s * s * a[q][q];
    const qq = s * s * a[p][p] + 2 * s * c * a[p][q] + c * c * a[q][q];
    for (let k = 0; k < 3; k++) if (k !== p && k !== q) {
      const kp = c * a[k][p] - s * a[k][q], kq = s * a[k][p] + c * a[k][q];
      a[k][p] = a[p][k] = kp; a[k][q] = a[q][k] = kq;
    }
    a[p][p] = pp; a[q][q] = qq; a[p][q] = a[q][p] = 0;
  }
  return [a[0][0], a[1][1], a[2][2]].sort((a, b) => a - b);
}
