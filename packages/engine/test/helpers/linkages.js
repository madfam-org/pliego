// @ts-check
/**
 * Keyed-mechanism fixtures (spec §5.20), authored here: a crank-rocker four-bar whose rocker and
 * coupler follow the crank control through keyed `rotate` mechanisms (the coupler rides the
 * crank), and an eccentric plate cam with a translating follower keyed to the cam angle. Plan
 * coordinates (x, y) are sheet-local on the base, world (x, h, −y); every link lies flat.
 */
import { DocBuilder } from './docbuilder.js';

const D = Math.PI / 180;

/** Planar four-bar positions: ground A = (0, 0), D = (G, 0); returns pins B, C at crank angle θ (deg). */
export function fourBarPose(theta, { G = 80, a = 24, b = 76, c = 56 } = {}) {
  const B = [a * Math.cos(theta * D), a * Math.sin(theta * D)];
  // C: circle(B, b) ∩ circle(D, c), the branch above the ground line (open configuration)
  const dx = G - B[0], dy = -B[1], d = Math.hypot(dx, dy);
  const t = (b * b - c * c + d * d) / (2 * d), hgt = Math.sqrt(Math.max(0, b * b - t * t));
  const ux = dx / d, uy = dy / d;
  const C = [B[0] + t * ux - hgt * uy, B[1] + t * uy + hgt * ux];
  return { B, C };
}

const heading = (/** @type {number[]} */ p, /** @type {number[]} */ q) => Math.atan2(q[1] - p[1], q[0] - p[0]) / D;
/** Unwrap a heading sequence into a continuous one. @param {number[]} hs */
function unwrapDeg(hs) { const out = [hs[0]]; for (let i = 1; i < hs.length; i++) { let d = hs[i] - hs[i - 1]; d -= 360 * Math.round(d / 360); out.push(out[i - 1] + d); } return out; }

/**
 * Four-bar on a fixed base board. Links are 2r-wide strips with their pins at local (r, r) and
 * (r + L, r). `keyed`: rocker and coupler are kinematic (keyed rotates, the coupler riding the
 * crank); otherwise only the crank moves (the unkeyed baseline: coupler and rocker stay put).
 * @param {{keyed?: boolean, step?: number, theta0?: number}} [o]
 */
export function fourBar({ keyed = true, step = 5, theta0 = 60 } = {}) {
  const G = 80, a = 24, bl = 76, cl = 56, r = 4;
  const b = new DocBuilder('four-bar (keyed)');
  const base = b.rect({ id: 'base', width: 160, height: 120, kinematic: { mechanism: 'turn-crank' } });
  const ox = 40, oy = 40; // ground pin A on the base
  const { B: B0, C: C0 } = fourBarPose(theta0);
  /** placement of a link whose pins (r, r) → p and (r + L, r) → q, at level y */
  const place = (/** @type {number[]} */ p, /** @type {number[]} */ q, /** @type {number} */ y) => {
    const psi = heading(p, q) * D, c = Math.cos(psi), s = Math.sin(psi);
    const px = p[0] + ox - (r * c - r * s), py = p[1] + oy - (r * s + r * c);
    return { origin: [px, y, -py], rotation: [0, Math.sin(psi / 2), 0, Math.cos(psi / 2)] };
  };
  const link = (/** @type {string} */ id, /** @type {number} */ L, /** @type {number[]} */ p, /** @type {number[]} */ q, /** @type {number} */ y, /** @type {string|null} */ mech) =>
    b.rect({ id, width: L + 2 * r, height: 2 * r, stock: 'cardstock-250', placement: place(p, q, y), kinematic: mech ? { mechanism: mech } : null });
  const crank = link('crank', a, [0, 0], B0, 0.4, 'turn-crank');
  const coupler = link('coupler', bl, B0, C0, 1.2, keyed ? 'turn-coupler' : null);
  const rocker = link('rocker', cl, [G, 0], C0, 0.8, keyed ? 'turn-rocker' : null);
  b.control({ id: 'crank', kind: 'angle', min: 0, max: 360, default: 0, unit: 'deg' });
  b.mechanisms.push({ id: 'turn-crank', type: 'rotate', center: { sheet: 'base', at: [ox, oy] }, control: 'crank', sheets_moving: ['crank'] });
  const vs = [], cpl = [], rck = [];
  for (let v = 0; v <= 360; v += step) {
    const { B, C } = fourBarPose(theta0 + v);
    vs.push(v); cpl.push(heading(B, C)); rck.push(heading([G, 0], C));
  }
  const cu = unwrapDeg(cpl), ru = unwrapDeg(rck);
  if (keyed) {
    // coupler: total rotation = crank v + own α(v) about its crank pin, carried by the crank.
    // α runs from 0 to −360 over a turn, so the table keeps its closing key at 360 (spec §5.20:
    // the wrap from −360 back to 0 is a whole turn, invisible in a rotation)
    b.mechanisms.push({ id: 'turn-coupler', type: 'rotate', center: { sheet: 'crank', at: [r + a, r] }, control: 'crank', sheets_moving: ['coupler'],
      ride: 'turn-crank', period: 360, keys: vs.map((v, i) => [v, +(cu[i] - cu[0] - v).toFixed(9)]) });
    b.mechanisms.push({ id: 'turn-rocker', type: 'rotate', center: { sheet: 'base', at: [ox + G, oy] }, control: 'crank', sheets_moving: ['rocker'],
      period: 360, keys: vs.slice(0, -1).map((v, i) => [v, +(ru[i] - ru[0]).toFixed(9)]) });
  }
  for (const [id, pa, pb] of [['brad-a', ['crank', [r, r]], ['base', [ox, oy]]], ['brad-b', ['crank', [r + a, r]], ['coupler', [r, r]]],
    ['brad-c', ['coupler', [r + bl, r]], ['rocker', [r + cl, r]]], ['brad-d', ['rocker', [r, r]], ['base', [ox + G, oy]]]]) {
    b.joins.push({ id, type: 'pivot', a: { sheet: pa[0], at: pa[1] }, b: { sheet: pb[0], at: pb[1] } });
  }
  void base; void crank; void coupler; void rocker;
  return { doc: b.build(), pins: { couplerC: ['coupler', [r + bl, r]], rockerC: ['rocker', [r + cl, r]], crankB: ['crank', [r + a, r]], couplerB: ['coupler', [r, r]] }, theta0, G, ox, oy };
}

/**
 * Eccentric plate cam (disc of radius R turning about a point e from its centre) and a flat-foot
 * follower translating along +x in the plan. `keyed`: the follower's travel follows the cam's
 * reach x(θ) = e·cos θ + R exactly at the keys; otherwise it moves linearly with the control.
 * @param {{keyed?: boolean, step?: number, e?: number, R?: number}} [o]
 */
export function eccentricCam({ keyed = true, step = 5, e = 10, R = 30 } = {}) {
  const b = new DocBuilder('eccentric cam (keyed)');
  b.rect({ id: 'base', width: 200, height: 120, kinematic: { mechanism: 'turn-cam' } });
  const cx = 60, cy = 60; // cam pivot on the base
  // cam disc: a 48-gon of radius R centred at (R, R) in its own sheet, placed with its centre
  // e to the +x of the pivot (the reach along +x is then e·cos θ + R from the pivot)
  const s = b.sheet({ id: 'cam', width: 2 * R, height: 2 * R, stock: 'cardstock-250', kinematic: { mechanism: 'turn-cam' },
    placement: { origin: [cx + e - R, 0.4, -(cy - R)], rotation: [0, 0, 0, 1] } });
  const ring = [];
  for (let k = 0; k < 48; k++) ring.push(b.vertex(s, R + R * Math.cos((2 * Math.PI * k) / 48), R + R * Math.sin((2 * Math.PI * k) / 48)));
  b.face(ring);
  // follower: a 40 × 10 strip whose foot (local (0, 5)) touches the cam's reach at θ = 0
  const foot0 = cx + e + R;
  b.rect({ id: 'follower', width: 40, height: 10, stock: 'cardstock-250', kinematic: { mechanism: 'lift' }, placement: { origin: [foot0, 0.8, -(cy - 5)], rotation: [0, 0, 0, 1] } });
  b.control({ id: 'crank', kind: 'angle', min: 0, max: 720, default: 0, unit: 'deg' });
  b.mechanisms.push({ id: 'turn-cam', type: 'rotate', center: { sheet: 'base', at: [cx, cy] }, control: 'crank', sheets_moving: ['cam'] });
  const travel = 2 * e;
  if (keyed) {
    const keys = [];
    for (let v = 0; v < 360; v += step) keys.push([v, +(e * Math.cos(v * D) - e).toFixed(9)]);
    b.mechanisms.push({ id: 'lift', type: 'translate', control: 'crank', direction: [1, 0, 0], travel, period: 360, keys, sheets_moving: ['follower'] });
  } else {
    b.mechanisms.push({ id: 'lift', type: 'translate', control: 'crank', direction: [-1, 0, 0], travel, sheets_moving: ['follower'] });
  }
  return { doc: b.build(), e, R, cx, cy, camCentre: ['cam', [R, R]], foot: ['follower', [0, 5]] };
}
