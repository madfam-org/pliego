// @ts-check
// Research-only objective StVK membrane. Exact energy/gradient; the runtime
// search matrix is explicitly Gauss–Newton PSD, not the exact Hessian.
import { hypot2, hypot3 } from '../fastmath.js';

const REFERENCE_QUALITY_MIN = 1e-12, CURRENT_AREA_RATIO_MIN = 1e-12;
const SLOT_NONE = -2147483648;
/** @typedef {{alpha:Float64Array,beta:Float64Array,Q:Float64Array,area:number,volume:number,referenceQuality:number}} OrthotropicElement */
/** @param {boolean} ok @param {string} message */
function demand(ok, message) { if (!ok) throw new Error(`Orthotropic membrane: ${message}`); }

/** Explicit nu12 convention; no stock-nu inference. All stresses microN/mm².
 * @param {{E1:number,E2:number,G12:number,thickness:number}} material @param {number} nu12 */
function planeStress(material, nu12) {
  const { E1, E2, G12, thickness } = material;
  demand([E1, E2, G12, thickness].every(v => Number.isFinite(v) && v > 0), 'positive finite engineering constants and thickness required');
  const nu21 = nu12 * E2 / E1, den = 1 - nu12 * nu21;
  demand(Number.isFinite(nu12) && Number.isFinite(den) && den > 0, 'nu12 must give positive-definite reciprocal plane-stress Q');
  const q = Float64Array.of(E1 / den, E2 / den, nu12 * E2 / den, G12);
  demand(Array.from(q).every(Number.isFinite), 'non-finite plane-stress Q');
  demand(q[0] > 0 && q[1] - (q[2] / q[0]) * q[2] > 0 && q[3] > 0, 'plane-stress Q is not positive definite');
  return q;
}

/** Independent element interface for derivative tests. UV must be CCW.
 * @param {ArrayLike<number>} uv six sheet coordinates [u0,v0,u1,v1,u2,v2]
 * @param {{E1:number,E2:number,G12:number,thickness:number}} material
 * @param {number} grainRadians @param {number} nu12 @returns {OrthotropicElement} */
export function createOrthotropicElement(uv, material, grainRadians, nu12) {
  demand(uv.length === 6 && Array.from(uv).every(Number.isFinite) && Number.isFinite(grainRadians), 'finite triangle UV and grain required');
  const du1 = uv[2] - uv[0], dv1 = uv[3] - uv[1], du2 = uv[4] - uv[0], dv2 = uv[5] - uv[1];
  const det = du1 * dv2 - du2 * dv1;
  const scale2 = Math.max(du1 * du1 + dv1 * dv1, du2 * du2 + dv2 * dv2,
    (du2 - du1) ** 2 + (dv2 - dv1) ** 2);
  const quality = det / scale2;
  demand(Number.isFinite(det) && det > 0 && Number.isFinite(quality) && quality > REFERENCE_QUALITY_MIN, 'degenerate, reversed or ill-conditioned reference triangle');
  const gu1 = dv2 / det, gv1 = -du2 / det, gu2 = -dv1 / det, gv2 = du1 / det;
  const c = Math.cos(grainRadians), s = Math.sin(grainRadians);
  const alpha = Float64Array.of(0, gu1 * c + gv1 * s, gu2 * c + gv2 * s);
  const beta = Float64Array.of(0, -gu1 * s + gv1 * c, -gu2 * s + gv2 * c);
  alpha[0] = -(alpha[1] + alpha[2]); beta[0] = -(beta[1] + beta[2]);
  const Q = planeStress(material, nu12), area = det / 2, volume = area * material.thickness;
  demand(Number.isFinite(volume) && volume > 0, 'invalid reference element volume');
  return { alpha, beta, Q, area, volume, referenceQuality: quality };
}

function scratch() {
  return { a: new Float64Array(3), b: new Float64Array(3), strain: new Float64Array(3),
    stress: new Float64Array(3), J: new Float64Array(27), energy: Infinity,
    areaRatio: 0, minimumStretch: 0, maximumStretch: 0 };
}
/** Pose-local kinematics; no dependence on a previous gradient or factor cache.
 * @param {OrthotropicElement} e @param {ArrayLike<number>} x @param {ArrayLike<number>} ids @param {ReturnType<typeof scratch>} k */
function kinematics(e, x, ids, k) {
  const { a, b, strain, stress, J } = k;
  for (let r = 0; r < 3; r++) {
    const x0 = x[3 * ids[0] + r], d1 = x[3 * ids[1] + r] - x0, d2 = x[3 * ids[2] + r] - x0;
    a[r] = e.alpha[1] * d1 + e.alpha[2] * d2;
    b[r] = e.beta[1] * d1 + e.beta[2] * d2;
  }
  const aa = a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
  const bb = b[0] * b[0] + b[1] * b[1] + b[2] * b[2];
  const ab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const areaRatio = hypot3(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
  // No fixed-normal test: a valid 180-degree rigid turn changes its sign.
  if (!(Number.isFinite(aa + bb + ab + areaRatio) && areaRatio > CURRENT_AREA_RATIO_MIN)) { k.energy = Infinity; return false; }
  strain[0] = (aa - 1) / 2; strain[1] = (bb - 1) / 2; strain[2] = ab;
  const q = e.Q;
  stress[0] = q[0] * strain[0] + q[2] * strain[1];
  stress[1] = q[2] * strain[0] + q[1] * strain[1]; stress[2] = q[3] * strain[2];
  k.energy = 0.5 * e.volume * (strain[0] * stress[0] + strain[1] * stress[1] + strain[2] * stress[2]);
  if (!Number.isFinite(k.energy)) { k.energy = Infinity; return false; }
  // Scale before adding: the full trace/discriminant may overflow even when
  // the largest eigenvalue itself (and the physical energy) is representable.
  const largest = aa / 2 + bb / 2 + hypot2((aa - bb) / 2, ab);
  const maximumStretch = Math.sqrt(largest), minimumStretch = areaRatio / maximumStretch;
  if (!(Number.isFinite(maximumStretch) && maximumStretch > 0 && Number.isFinite(minimumStretch) && minimumStretch > 0)) { k.energy = Infinity; return false; }
  k.areaRatio = areaRatio; k.maximumStretch = maximumStretch; k.minimumStretch = minimumStretch;
  for (let i = 0; i < 3; i++) for (let r = 0; r < 3; r++) {
    const col = 3 * i + r;
    J[col] = e.alpha[i] * a[r]; J[9 + col] = e.beta[i] * b[r];
    J[18 + col] = e.alpha[i] * b[r] + e.beta[i] * a[r];
  }
  return true;
}
/** @param {OrthotropicElement} e @param {ReturnType<typeof scratch>} k @param {number} row @param {number} col */
function gnEntry(e, k, row, col) {
  // Canonical evaluation makes diagonal 3x3 assembly blocks bit-symmetric.
  if (row > col) { const swap = row; row = col; col = swap; }
  const j = k.J, q = e.Q;
  return e.volume * (j[row] * (q[0] * j[col] + q[2] * j[9 + col])
    + j[9 + row] * (q[2] * j[col] + q[1] * j[9 + col]) + j[18 + row] * q[3] * j[18 + col]);
}
/** Exact element energy, force gradient, and exact/GN Hessians for validation.
 * Invalid trial energy is Infinity; derivative requests at invalid poses throw.
 * @param {OrthotropicElement} element @param {ArrayLike<number>} x nine world coordinates
 * @param {{exactHessian?:boolean}} [opts] */
export function evaluateOrthotropicElement(element, x, opts = {}) {
  demand(x.length === 9, 'element pose must have nine coordinates');
  const k = scratch(), ids = [0, 1, 2];
  demand(kinematics(element, x, ids, k), 'collapsed or non-finite current triangle');
  const gradient = new Float64Array(9), gaussNewton = new Float64Array(81);
  const hessian = opts.exactHessian === false ? null : new Float64Array(81);
  for (let i = 0; i < 9; i++) {
    gradient[i] = element.volume * (k.J[i] * k.stress[0] + k.J[9 + i] * k.stress[1] + k.J[18 + i] * k.stress[2]);
    for (let j = 0; j < 9; j++) {
      const gn = gnEntry(element, k, i, j); gaussNewton[9 * i + j] = gn;
      if (hessian) {
        const ni = Math.floor(i / 3), nj = Math.floor(j / 3), a = element.alpha, b = element.beta, s = k.stress;
        const geometric = i % 3 === j % 3 ? s[0] * a[ni] * a[nj] + s[1] * b[ni] * b[nj] + s[2] * (a[ni] * b[nj] + b[ni] * a[nj]) : 0;
        hessian[9 * i + j] = gn + element.volume * geometric;
      }
    }
  }
  return { energy: k.energy, gradient, hessian, gaussNewton, strain: k.strain.slice(), stress: k.stress.slice(),
    areaRatio: k.areaRatio, minimumStretch: k.minimumStretch, maximumStretch: k.maximumStretch };
}

/** Neumaier accumulation; magnitude is diagnostic, not an interval bound.
 * @param {{sum:number,correction:number,magnitude:number}} accumulator @param {number} value */
function addIncrement(accumulator, value) {
  const sum = accumulator.sum, next = sum + value;
  accumulator.correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
  accumulator.sum = next; accumulator.magnitude += Math.abs(value);
}

/** @param {number[]} values */
function compensatedIncrement(values) {
  const accumulator = { sum: 0, correction: 0, magnitude: 0 };
  for (const value of values) addIncrement(accumulator, value);
  return accumulator.sum + accumulator.correction;
}

export class OrthotropicMembrane {
  /** @param {import('../mesh.js').Mesh} mesh @param {import('../material.js').Material[]} materials
   * @param {any} doc loaded document @param {number[]} nu12PerSheet explicit research Poisson convention */
  constructor(mesh, materials, doc, nu12PerSheet) {
    demand(Array.isArray(nu12PerSheet) && nu12PerSheet.length === doc.sheets.length && materials.length === doc.sheets.length, 'explicit nu12 array must cover every sheet');
    demand(mesh.nT > 0 && mesh.tris.length === 3 * mesh.nT, 'nonempty triangle mesh required');
    this.mesh = mesh;
    /** @type {OrthotropicElement[]} */ this.elements = [];
    const materialData = materials.map(m => ({ E1: m.Emd, E2: m.Ecd, G12: m.G12, thickness: m.t }));
    const grainDegrees = doc.sheets.map((/** @type {any} */ s) => s.grainDeg);
    for (let t = 0; t < mesh.nT; t++) {
      const uv = new Float64Array(6), sheet = mesh.triSheet[t];
      demand(Number.isInteger(sheet) && sheet >= 0 && sheet < materials.length, 'triangle sheet index out of range');
      for (let i = 0; i < 3; i++) {
        const v = mesh.tris[3 * t + i];
        demand(Number.isInteger(v) && v >= 0 && v < mesh.nV, 'triangle vertex index out of range');
        uv[2 * i] = mesh.uv[2 * v]; uv[2 * i + 1] = mesh.uv[2 * v + 1];
      }
      this.elements.push(createOrthotropicElement(uv, materialData[sheet], grainDegrees[sheet] * Math.PI / 180, nu12PerSheet[sheet]));
    }
    this.configuration = { model: 'orthotropic-stvk', version: 1, curvature: 'gauss-newton', poissonConvention: 'nu12',
      nu12BySheet: nu12PerSheet.slice(), materials: materialData, grainDegrees,
      referenceUV: Array.from(mesh.uv), triangles: Array.from(mesh.tris), triangleSheets: Array.from(mesh.triSheet),
      referenceQualityMin: REFERENCE_QUALITY_MIN, currentAreaRatioMin: CURRENT_AREA_RATIO_MIN };
    this.configurationKey = JSON.stringify(this.configuration);
    this.work = scratch(); this.block = new Float64Array(9);
  }
  /** @param {ArrayLike<number>} x */
  energy(x) {
    let energy = 0;
    for (let t = 0; t < this.mesh.nT; t++) {
      if (!kinematics(this.elements[t], x, this.mesh.tris.subarray(3 * t, 3 * t + 3), this.work)) return Infinity;
      energy += this.work.energy;
    }
    return Number.isFinite(energy) ? energy : Infinity;
  }
  /** Stable increment of the declared real StVK polynomial at actual f64 poses.
   * This is not literal subtraction of two separately rounded energy() values.
   * Existing energy/gradient/GN arithmetic remains unchanged. Invalid endpoints
   * return Infinity; absoluteTermSum is a magnitude diagnostic, not an error bound.
   * @param {ArrayLike<number>} before @param {ArrayLike<number>} after */
  energyDifferenceDetails(before, after) {
    const start = scratch(), end = scratch();
    const total = { sum: 0, correction: 0, magnitude: 0 };
    const linear = { sum: 0, correction: 0, magnitude: 0 };
    const remainder = { sum: 0, correction: 0, magnitude: 0 };
    for (let t = 0; t < this.mesh.nT; t++) {
      const e = this.elements[t], ids = this.mesh.tris.subarray(3 * t, 3 * t + 3);
      if (!kinematics(e, before, ids, start) || !kinematics(e, after, ids, end)) return { difference: Infinity, absoluteTermSum: Infinity, linear: Infinity, remainder: Infinity, absoluteRemainderTermSum: Infinity, triangles: this.mesh.nT, valid: false };
      const da = [0, 0, 0], db = [0, 0, 0];
      for (let r = 0; r < 3; r++) {
        // Form actual nodal position increments first. Subtracting two rounded
        // deformation gradients would lose Newton-scale changes a second time.
        const d0 = after[3 * ids[0] + r] - before[3 * ids[0] + r];
        const d1 = after[3 * ids[1] + r] - before[3 * ids[1] + r] - d0;
        const d2 = after[3 * ids[2] + r] - before[3 * ids[2] + r] - d0;
        da[r] = e.alpha[1] * d1 + e.alpha[2] * d2;
        db[r] = e.beta[1] * d1 + e.beta[2] * d2;
      }
      const { a, b, stress } = start;
      const de = [
        compensatedIncrement([a[0]*da[0], a[1]*da[1], a[2]*da[2], 0.5*da[0]*da[0], 0.5*da[1]*da[1], 0.5*da[2]*da[2]]),
        compensatedIncrement([b[0]*db[0], b[1]*db[1], b[2]*db[2], 0.5*db[0]*db[0], 0.5*db[1]*db[1], 0.5*db[2]*db[2]]),
        compensatedIncrement([a[0]*db[0], a[1]*db[1], a[2]*db[2], b[0]*da[0], b[1]*da[1], b[2]*da[2], da[0]*db[0], da[1]*db[1], da[2]*db[2]]),
      ];
      const q = e.Q, ds = [q[0]*de[0]+q[2]*de[1], q[2]*de[0]+q[1]*de[1], q[3]*de[2]];
      for (let i = 0; i < 3; i++) {
        addIncrement(total, e.volume * de[i] * stress[i]);
        addIncrement(total, 0.5 * e.volume * de[i] * ds[i]);
        addIncrement(remainder, 0.5 * e.volume * de[i] * ds[i]);
        addIncrement(remainder, 0.5 * e.volume * stress[0] * da[i] * da[i]);
        addIncrement(remainder, 0.5 * e.volume * stress[1] * db[i] * db[i]);
        addIncrement(remainder, e.volume * stress[2] * da[i] * db[i]);
        for (let r = 0; r < 3; r++) {
          const c = 3 * i + r;
          const g = e.volume * (start.J[c] * stress[0] + start.J[9 + c] * stress[1] + start.J[18 + c] * stress[2]);
          addIncrement(linear, g * (after[3 * ids[i] + r] - before[3 * ids[i] + r]));
        }
      }
    }
    const difference = total.sum + total.correction;
    const linearValue = linear.sum + linear.correction, remainderValue = remainder.sum + remainder.correction;
    const valid = [difference, total.magnitude, linearValue, remainderValue, remainder.magnitude].every(Number.isFinite);
    return { difference: valid ? difference : Infinity, absoluteTermSum: total.magnitude,
      linear: linearValue, remainder: remainderValue, absoluteRemainderTermSum: remainder.magnitude,
      triangles: this.mesh.nT, valid };
  }
  /** @param {ArrayLike<number>} before @param {ArrayLike<number>} after */
  energyDifference(before, after) { return this.energyDifferenceDetails(before, after).difference; }
  /** Add exact elastic gradient over all vertices. @param {ArrayLike<number>} x @param {Float64Array} g */
  addGradient(x, g) {
    for (let t = 0; t < this.mesh.nT; t++) {
      const e = this.elements[t], ids = this.mesh.tris.subarray(3 * t, 3 * t + 3), k = this.work;
      demand(kinematics(e, x, ids, k), 'collapsed or non-finite current triangle');
      for (let i = 0; i < 3; i++) for (let r = 0; r < 3; r++) {
        const c = 3 * i + r, value = e.volume * (k.J[c] * k.stress[0] + k.J[9 + c] * k.stress[1] + k.J[18 + c] * k.stress[2]);
        demand(Number.isFinite(value), 'non-finite membrane gradient'); g[3 * ids[i] + r] += value;
      }
    }
  }
  /** Add PSD search blocks, not exact stress curvature.
   * @param {any} w @param {ArrayLike<number>} x @param {import('../linalg/blockchol.js').BlockCholesky} ch */
  addGaussNewtonBlocks(w, x, ch) {
    const slots = w.sys.membraneSlots;
    demand(slots instanceof Int32Array && slots.length === 3 * this.mesh.nT, 'membrane assembly slots missing');
    for (let t = 0; t < this.mesh.nT; t++) {
      const e = this.elements[t], ids = this.mesh.tris.subarray(3 * t, 3 * t + 3), k = this.work;
      demand(kinematics(e, x, ids, k), 'collapsed or non-finite current triangle');
      let pair = 0;
      for (let i = 0; i < 3; i++) for (let j = i; j < 3; j++) {
        const slot = i === j ? w.sys.diagSlot[ids[i]] : slots[3 * t + pair++];
        if (slot === SLOT_NONE) continue;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) this.block[3 * r + c] = gnEntry(e, k, 3 * i + r, 3 * j + c);
        ch.add(slot, this.block);
      }
    }
  }
  /** Add PSD operator, treating fixed input entries as zero and omitting fixed output.
   * @param {ArrayLike<number>} x @param {ArrayLike<number>} p @param {Float64Array} out @param {ArrayLike<number>} [invMass] */
  addGaussNewtonTimes(x, p, out, invMass) {
    for (let t = 0; t < this.mesh.nT; t++) {
      const e = this.elements[t], ids = this.mesh.tris.subarray(3 * t, 3 * t + 3), k = this.work;
      demand(kinematics(e, x, ids, k), 'collapsed or non-finite current triangle');
      let z0 = 0, z1 = 0, z2 = 0;
      for (let i = 0; i < 3; i++) if (!invMass || invMass[ids[i]]) for (let r = 0; r < 3; r++) {
        const c = 3 * i + r, value = p[3 * ids[i] + r]; z0 += k.J[c] * value; z1 += k.J[9 + c] * value; z2 += k.J[18 + c] * value;
      }
      const q = e.Q, s0 = q[0] * z0 + q[2] * z1, s1 = q[2] * z0 + q[1] * z1, s2 = q[3] * z2;
      for (let i = 0; i < 3; i++) if (!invMass || invMass[ids[i]]) for (let r = 0; r < 3; r++) {
        const c = 3 * i + r; out[3 * ids[i] + r] += e.volume * (k.J[c] * s0 + k.J[9 + c] * s1 + k.J[18 + c] * s2);
      }
    }
  }
  /** Current metric diagnostics, not an inversion/contact/strain-limit certificate. @param {ArrayLike<number>} x */
  diagnostics(x) {
    let invalidTriangles = 0, minimumStretch = Infinity, maximumStretch = 0, minimumAreaRatio = Infinity, maximumAreaRatio = 0;
    for (let t = 0; t < this.mesh.nT; t++) {
      if (!kinematics(this.elements[t], x, this.mesh.tris.subarray(3 * t, 3 * t + 3), this.work)) { invalidTriangles++; continue; }
      minimumStretch = Math.min(minimumStretch, this.work.minimumStretch); maximumStretch = Math.max(maximumStretch, this.work.maximumStretch);
      minimumAreaRatio = Math.min(minimumAreaRatio, this.work.areaRatio); maximumAreaRatio = Math.max(maximumAreaRatio, this.work.areaRatio);
    }
    return { model: 'orthotropic-stvk', curvature: 'gauss-newton', poissonConvention: 'nu12',
      finite: invalidTriangles === 0, invalidTriangles, triangles: this.mesh.nT,
      minimumStretch: minimumStretch === Infinity ? 0 : minimumStretch, maximumStretch,
      minimumAreaRatio: minimumAreaRatio === Infinity ? 0 : minimumAreaRatio, maximumAreaRatio,
      currentAreaRatioMin: CURRENT_AREA_RATIO_MIN };
  }
}
