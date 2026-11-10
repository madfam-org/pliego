/** Actual-engine prescribed affine membrane observations; no solve or time stepping. */
import { createHash } from 'node:crypto';
import { World } from '../src/index.js';
import { gradient } from '../src/xpbd/implicit.js';
import { implicitEnergy } from '../src/xpbd/energy-search.js';
import { DocBuilder } from '../test/helpers/docbuilder.js';

const WIDTH = 40, HEIGHT = 40, MESH_EDGE = 100;
// Observation consistency only, not a material/tensor accuracy threshold.
const STATS_AGREEMENT_TOLERANCE = 1e-12;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nativeSha = (array) => createHash('sha256').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
const requireThat = (ok, message) => { if (!ok) throw new Error(`membrane-patch: ${message}`); };

/**
 * Author every triangle explicitly so changing grain cannot change topology.
 * `perturbed` uses alternating diagonals and deterministic interior offsets of
 * at most 0.06 cell widths in either direction; the rectangular boundary stays fixed.
 */
export function makePatch({ cells = 4, pattern = 'forward', grain = 0,
  physicalMembrane = true, membraneCompression = 1 } = {}) {
  if (!Number.isInteger(cells) || cells < 1 || cells > 64) throw new RangeError('membrane-patch: cells must be an integer in [1,64]');
  if (!['forward', 'alternating', 'perturbed'].includes(pattern)) throw new RangeError('membrane-patch: unknown pattern');
  if (!Number.isFinite(grain)) throw new RangeError('membrane-patch: grain must be finite');
  if (typeof physicalMembrane !== 'boolean') throw new TypeError('membrane-patch: physicalMembrane must be boolean');
  if (!(Number.isFinite(membraneCompression) && membraneCompression > 0 && membraneCompression <= 1)) throw new RangeError('membrane-patch: compression must be in (0,1]');
  const builder = new DocBuilder('synthetic prescribed affine membrane patch', { exact: true });
  const sheet = builder.sheet({ id: 'patch', width: WIDTH, height: HEIGHT, grain });
  const vertices = [], triangles = [], interiorIndices = [];
  const spacing = WIDTH / cells, index = (i, j) => j * (cells + 1) + i;
  for (let j = 0; j <= cells; j++) for (let i = 0; i <= cells; i++) {
    const interior = i > 0 && i < cells && j > 0 && j < cells;
    const du = pattern === 'perturbed' && interior ? 0.06 * spacing * Math.sin(1.7 * i + 2.3 * j) : 0;
    const dv = pattern === 'perturbed' && interior ? 0.06 * spacing * Math.cos(2.1 * i - 1.3 * j) : 0;
    const u = WIDTH * i / cells + du, v = HEIGHT * j / cells + dv;
    vertices.push([u, v]); builder.vertex(sheet, u, v);
    if (interior) interiorIndices.push(index(i, j));
  }
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const a = index(i, j), b = index(i + 1, j), c = index(i + 1, j + 1), d = index(i, j + 1);
    const backward = pattern !== 'forward' && (i + j) % 2 === 1;
    for (const triangle of backward ? [[a, b, d], [b, c, d]] : [[a, b, c], [a, c, d]]) {
      triangles.push(triangle); builder.face(triangle);
    }
  }
  // Interior authored edges are flat panel edges, never cuts or creases.
  const incidences = new Map();
  for (const t of triangles) for (let k = 0; k < 3; k++) {
    const a = t[k], b = t[(k + 1) % 3], key = `${Math.min(a, b)},${Math.max(a, b)}`;
    incidences.set(key, (incidences.get(key) ?? 0) + 1);
  }
  for (const edge of builder.E) if (incidences.get(`${Math.min(edge.a, edge.b)},${Math.max(edge.a, edge.b)}`) === 2) builder.assign(edge.a, edge.b, 'F');
  const doc = builder.build();
  const options = { meshEdge: MESH_EDGE, physicalMembrane, membraneCompression,
    gravity: false, ground: false, contact: false, plasticity: false };
  const world = new World(doc, options), m = world.mesh;
  requireThat(m.nV === vertices.length && m.nT === triangles.length, 'authored vertex/triangle counts changed');
  requireThat(Array.from(m.docVertex).every((v, i) => v === i), 'document vertex mapping changed');
  for (let i = 0; i < vertices.length; i++) {
    const [u, v] = vertices[i];
    requireThat(m.uv[2 * i] === u && m.uv[2 * i + 1] === v, `authored coordinate ${i} changed`);
    requireThat(world.x[3 * i] === u && world.x[3 * i + 1] === 0 && world.x[3 * i + 2] === -v, `world coordinate ${i} changed`);
  }
  for (let t = 0; t < triangles.length; t++) {
    // Cyclic ordering may differ after triangulation, but orientation and exact
    // authored face ownership must survive. No missing/inserted/flipped faces.
    const expected = triangles[t], actual = Array.from(m.tris.subarray(3 * t, 3 * t + 3));
    const start = expected.indexOf(actual[0]);
    requireThat(start >= 0 && actual.every((v, k) => v === expected[(start + k) % 3]) && m.triFace[t] === t && m.triArea[t] > 0,
      `authored triangle ${t} changed or flipped`);
  }
  const area = Array.from(m.triArea).reduce((a, b) => a + b, 0);
  requireThat(Math.abs(area - WIDTH * HEIGHT) <= 1e-10 * WIDTH * HEIGHT, 'area changed');
  const derived = doc['pliego:stocks']['copy-80'].derived;
  const actualMaterial = world.materials[0];
  const material = { E1: actualMaterial.Emd, E2: actualMaterial.Ecd, nu12: actualMaterial.nu,
    G12: actualMaterial.G12, thickness: actualMaterial.t };
  const nativeByteFingerprints = { uv: nativeSha(m.uv), triangles: nativeSha(m.tris), worldPositions: nativeSha(world.x) };
  const meshSHA256 = sha({ vertices, triangles });
  return { world, doc, vertices, triangles, material, area, interiorIndices, options,
    meshSHA256, fixtureSHA256: sha(doc),
    info: { cells, pattern, grain, widthMm: WIDTH, heightMm: HEIGHT, areaMm2: area,
      nV: m.nV, nT: m.nT, nE: m.nE, nH: m.nH, meshEdgeMm: MESH_EDGE,
      materialSHA256: sha(derived), optionsSHA256: sha(options), nativeByteFingerprints,
      materialReference: material, affineOriginMm: [0, 0],
      nativeByteOrder: new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 'little' : 'big',
      coordinateConvention: 'sheet (u,v) maps to world (x,y,z)=(u,0,-v); engineering gamma=2*epsilon_uv',
      materialBasis: 'synthetic DocBuilder copy-80 estimate; nu12 declared for membrane audit, not measured stock calibration' } };
}

/** Actual applied sheet displacement after binary64 pose addition/subtraction. */
export function affineDisplacement(patch, strain) {
  if (!Array.isArray(strain) || strain.length !== 3 || !strain.every(Number.isFinite)) throw new TypeError('membrane-patch: finite [exx,eyy,gamma] required');
  const [exx, eyy, gamma] = strain;
  return patch.vertices.map(([u, v]) => [u + exx * u + gamma * v / 2 - u, v + eyy * v + gamma * u / 2 - v]);
}

/**
 * Observe the actual engine at u'=u+exx*u+gamma*v/2,
 * v'=v+eyy*v+gamma*u/2. All nodes are prescribed; this is not a
 * solved boundary-value patch test. Returned gradient is dU/d(u',v'),
 * not force (force is its negative), in microN. Energy is nJ.
 */
export function measureAffine(patch, strain) {
  if (!Array.isArray(strain) || strain.length !== 3 || !strain.every(Number.isFinite)) throw new TypeError('membrane-patch: finite [exx,eyy,gamma] required');
  const [exx, eyy, gamma] = strain, w = patch.world, m = w.mesh;
  requireThat((1 + exx) * (1 + eyy) - gamma * gamma / 4 > 0, 'affine map must preserve orientation');
  requireThat(w.framesRun === 0 && w.substepsRun === 0 && w.time === 0, 'world has been time stepped');
  requireThat(!w.contact && !w.motionGuard && !w.coupledContact && !w.edgeContact, 'contact must be absent');
  requireThat(!w.opts.gravity && !w.opts.ground && !w.opts.plasticity, 'external effects must be disabled');
  requireThat(!Array.from(w.driveOn).some(Boolean) && !Array.from(w.terms.active).some(Boolean), 'active drive/join terms');
  requireThat(!Array.from(w.userForce).some(Boolean) && !Array.from(w.fext).some(Boolean) && !Array.from(w.v).some(Boolean), 'external force or velocity present');
  const displacement = affineDisplacement(patch, strain);
  for (let i = 0; i < m.nV; i++) {
    const [u, v] = patch.vertices[i];
    w.x[3 * i] = u + displacement[i][0];
    w.x[3 * i + 1] = 0;
    w.x[3 * i + 2] = -(v + displacement[i][1]);
  }
  // Inertia is exactly zero at the evaluated pose, never inferred by sleeping.
  w.xt.set(w.x);
  const stats = w.stats(), statsEnergy = stats.energy.stretch;
  const energy = implicitEnergy(w, w.x);
  const stiffness = w.kMem.slice();
  let nonMembraneEnergy;
  try { w.kMem.fill(0); nonMembraneEnergy = implicitEnergy(w, w.x); }
  finally { w.kMem.set(stiffness); }
  requireThat(nonMembraneEnergy === 0 && stats.energy.bend === 0 && stats.energy.crease === 0, `non-membrane energy=${nonMembraneEnergy}`);
  // stats sums (0.5*k)*(d*d), while implicitEnergy sums ((0.5*k)*d)*d.
  // Their positive edge sums can accumulate more than a few ulps of difference
  // on refined meshes. Retain both raw energies and the declared scaled delta.
  const statsEnergyDelta = statsEnergy - energy;
  const statsEnergyScale = Math.max(1, Math.abs(energy), Math.abs(statsEnergy));
  const statsEnergyScaledDelta = Math.abs(statsEnergyDelta) / statsEnergyScale;
  const energyMagnitude = Math.max(Math.abs(energy), Math.abs(statsEnergy));
  const statsEnergyRelativeDelta = energyMagnitude === 0 ? 0 : Math.abs(statsEnergyDelta) / energyMagnitude;
  requireThat(Number.isFinite(energy) && statsEnergyScaledDelta <= STATS_AGREEMENT_TOLERANCE,
    `stats stretch differs from actual implicit objective: ${JSON.stringify({
      cells: patch.info.cells, pattern: patch.info.pattern, grain: patch.info.grain,
      physicalMembrane: patch.options.physicalMembrane, membraneCompression: patch.options.membraneCompression,
      strain, statsEnergy, energy, delta: statsEnergyDelta, scaledDelta: statsEnergyScaledDelta,
      scaleNJ: statsEnergyScale, tolerance: STATS_AGREEMENT_TOLERANCE })}`);
  const g = new Float64Array(w.x.length);
  gradient(w, w.x, g);
  requireThat(Array.from(g).every(Number.isFinite), 'non-finite actual engine gradient');
  const nodalGradient = [], generalizedGradient = [0, 0, 0];
  for (let i = 0; i < m.nV; i++) {
    requireThat(g[3 * i + 1] === 0, 'out-of-plane gradient in flat affine patch');
    const gu = g[3 * i], gv = -g[3 * i + 2], [u, v] = patch.vertices[i];
    nodalGradient.push([gu, gv]);
    generalizedGradient[0] += gu * u;
    generalizedGradient[1] += gv * v;
    generalizedGradient[2] += (gu * v + gv * u) / 2;
  }
  let residualSquared = 0, residualMax = 0;
  for (const i of patch.interiorIndices) {
    const magnitude = Math.hypot(...nodalGradient[i]);
    residualSquared += magnitude * magnitude; residualMax = Math.max(residualMax, magnitude);
  }
  return { strain: strain.slice(), energy, statsEnergy, statsEnergyDelta, statsEnergyRelativeDelta,
    statsEnergyScaledDelta, statsEnergyScale, statsAgreementTolerance: STATS_AGREEMENT_TOLERANCE,
    gradient: nodalGradient, nodalGradient, generalizedGradient,
    nonMembraneEnergy, steps: w.substepsRun, frames: w.framesRun, time: w.time,
    interiorResidual: { l2: Math.sqrt(residualSquared), max: residualMax, nodes: patch.interiorIndices.length },
    maxStrain: stats.maxStrain, maxCompression: stats.maxCompression };
}
