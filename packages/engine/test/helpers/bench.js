// @ts-check
/** Shared helpers for engine benchmarks: read-proof lines and cantilever measurement. */
import { World } from '../../src/index.js';
import { cantilever } from './docbuilder.js';

/**
 * Print and return the read-proof line `bench <id>: measured=… expected=… tol=… PASS|FAIL`.
 * @param {string} id @param {number|string} measured @param {number|string} expected @param {string} tol @param {boolean} pass @param {string} [note]
 */
export function proof(id, measured, expected, tol, pass, note = '') {
  const fmt = (/** @type {any} */ v) => (typeof v === 'number' ? (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(4) : +v.toFixed(5)) : v);
  const line = `bench ${id}: measured=${fmt(measured)} expected=${fmt(expected)} tol=${tol} ${pass ? 'PASS' : 'FAIL'}${note ? ` (${note})` : ''}`;
  console.log(line);
  return line;
}

/**
 * Simulate a self-weight cantilever to rest and return tip drop, chord angle and the world.
 * @param {{length:number, width?:number, stock?:string, alongU?:boolean, grain?:number, meshEdge?:number, substeps?:number, frames?:number, tipLoad?:number, gravityScale?:number}} o
 */
export function settleCantilever(o) {
  const platform = 12;
  const h = o.meshEdge ?? 6;
  const { doc } = cantilever({ length: o.length, width: o.width ?? 25, stock: o.stock ?? 'copy-80', alongU: o.alongU ?? false, grain: o.grain ?? 90, platform, spacing: Math.min(3, h / 2) });
  const w = new World(doc, { meshEdge: h, substeps: o.substeps ?? 20, contact: false, ground: false, damping: 8, gravity: o.tipLoad === undefined ? (o.gravityScale ?? 1) : false });
  const along = o.alongU ? 0 : 1;
  const tipV = [], rootV = [];
  for (let i = 0; i < w.mesh.nV; i++) {
    const a = w.mesh.uv[2 * i + along];
    if (Math.abs(a - (platform + o.length)) < 1e-6) tipV.push(i);
    if (Math.abs(a - platform) < 1e-6) rootV.push(i);
  }
  if (o.tipLoad !== undefined) for (const v of tipV) w.setForce(v, [0, -o.tipLoad / tipV.length, 0]);
  const frames = o.frames ?? 300;
  for (let f = 0; f < frames; f++) w.step();
  const mean = (/** @type {number[]} */ vs) => { const p = [0, 0, 0]; for (const v of vs) for (let c = 0; c < 3; c++) p[c] += w.x[3 * v + c] / vs.length; return p; };
  const tip = mean(tipV), root = mean(rootV);
  const drop = root[1] - tip[1];
  const horiz = Math.hypot(tip[0] - root[0], tip[2] - root[2]);
  return { drop, chordDeg: (Math.atan2(drop, horiz) * 180) / Math.PI, world: w, finite: w.stats().finite, maxStrain: w.stats().maxStrain };
}

/**
 * Overhang at which the tip chord droops `angle` degrees (Peirce / ASTM D1388, self-weight).
 * The mesh is kept fixed (strip of length `ref`) and gravity is scaled instead: the equilibrium
 * depends only on q/D, so an angle reached at gravity scale s means L* = ref·s^(1/3) at 1 g. This
 * avoids the jumps a re-meshed strip of varying length would add to the search.
 * @param {{stock?:string, alongU?:boolean, meshEdge?:number, substeps?:number, angle?:number, ref?:number}} o
 */
export function peirceOverhang(o) {
  const target = o.angle ?? 41.5;
  const ref = o.ref ?? 172;
  const f = (/** @type {number} */ s) => settleCantilever({ length: ref, stock: o.stock, alongU: o.alongU, meshEdge: o.meshEdge, substeps: o.substeps, gravityScale: s }).chordDeg - target;
  let s0 = 0.8, s1 = 1.2;
  let f0 = f(s0), f1 = f(s1);
  let runs = 2;
  for (let i = 0; i < 8 && Math.abs(f1) > 0.005; i++) {
    const s2 = Math.max(0.05, s1 - (f1 * (s1 - s0)) / (f1 - f0));
    s0 = s1; f0 = f1; s1 = s2; f1 = f(s1); runs++;
  }
  return { overhang: ref * Math.cbrt(s1), gravityScale: s1, residualDeg: f1, runs };
}
