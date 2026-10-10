// @ts-check
/**
 * Closed forms used as fast paths and test oracles (engine.md §4).
 *
 * Degree-4 flat-foldable vertex — Foschi, Hull & Ku 2022 (arXiv:2206.12691), Theorem 1: sector
 * angles α₁ ≤ α₂ < α₃ = π − α₁, α₄ = π − α₂ (α_i between creases i and i+1, counter-clockwise).
 *   mode 1: ρ₁ = ρ₃, ρ₂ = −ρ₄, tan(ρ₂/2) = −[cos((α₁+α₂)/2)/cos((α₁−α₂)/2)]·tan(ρ₁/2)
 *   mode 2: ρ₁ = −ρ₃, ρ₂ = ρ₄, tan(ρ₁/2) = [sin((α₁−α₂)/2)/sin((α₁+α₂)/2)]·tan(ρ₂/2)
 *
 * Miura-ori — Schenk & Guest 2013 (PNAS 110:3276): parallelogram sides a, b, acute angle γ, facet
 * angle θ to the base plane: H = a sinθ sinγ, S = b cosθ tanγ/√(1+cos²θ tan²γ),
 * L = a√(1 − sin²θ sin²γ), V = b/√(1 + cos²θ tan²γ), and ν_SL = −cos²θ·tan²γ.
 *
 * V-fold pop-up: the card halves and the piece halves form a spherical four-bar at the gutter point,
 * i.e. a flat-foldable degree-4 vertex with sectors (α, α, π−α, π−α) (glue-line angle α from the
 * gutter); mode 1 gives the piece's centre fold ρ₂ = −ρ_gutter and the glue folds
 * tan(ρ₁/2) = −tan(ρ₂/2)/cos α.
 *
 * Parallel (box) fold: a planar four-bar; with opposite links equal it is a parallelogram that lies
 * flat at both extremes, otherwise it locks.
 */

/** @param {number} a1 @param {number} a2 radians */
export function degree4Multipliers(a1, a2) {
  return {
    mode1: -Math.cos((a1 + a2) / 2) / Math.cos((a1 - a2) / 2),
    mode2: Math.sin((a1 - a2) / 2) / Math.sin((a1 + a2) / 2),
  };
}

/**
 * Fold angles of a flat-foldable degree-4 vertex. Mode 1 is driven by ρ₁, mode 2 by ρ₂ (radians).
 * @param {number} a1 @param {number} a2 @param {1|2} mode @param {number} drive
 * @returns {[number, number, number, number]}
 */
export function degree4(a1, a2, mode, drive) {
  const { mode1, mode2 } = degree4Multipliers(a1, a2);
  if (mode === 1) {
    const r1 = drive, r2 = 2 * Math.atan(mode1 * Math.tan(r1 / 2));
    return [r1, r2, r1, -r2];
  }
  const r2 = drive, r1 = 2 * Math.atan(mode2 * Math.tan(r2 / 2));
  return [r1, r2, -r1, r2];
}

/** Miura-ori unit-cell dimensions (Schenk & Guest 2013). @param {number} a @param {number} b @param {number} gamma @param {number} theta */
export function miuraDims(a, b, gamma, theta) {
  const st = Math.sin(theta), ct = Math.cos(theta), sg = Math.sin(gamma), tg = Math.tan(gamma);
  const q = Math.sqrt(1 + ct * ct * tg * tg);
  return { H: a * st * sg, S: (b * ct * tg) / q, L: a * Math.sqrt(1 - st * st * sg * sg), V: b / q };
}

/** In-plane Poisson ratio ν_SL = −cos²θ·tan²γ. @param {number} gamma @param {number} theta */
export function miuraPoisson(gamma, theta) {
  return -(Math.cos(theta) ** 2) * Math.tan(gamma) ** 2;
}

/**
 * Miura fold angles for facet angle θ: the zig-zag creases (ρ_z) and the straight creases (ρ_s).
 * From the degree-4 mode-1 relation with sectors (γ, γ, π−γ, π−γ) and the facet geometry:
 * the straight crease dihedral is π − 2·ψ where sin ψ = sinθ·sinγ… solved here numerically-free:
 * cos(ρ_s) and ρ_z follow from the unit cell (returns radians, valley-positive for ρ_s).
 * @param {number} gamma @param {number} theta
 */
export function miuraFoldAngles(gamma, theta) {
  // the straight (collinear) creases: two facets meeting along a straight crease, each tilted θ to
  // the base plane in the cross section → dihedral fold angle 2θ.
  const rs = 2 * theta;
  // zig-zag creases from mode 1 of the vertex (ρ_s plays ρ₂, the zig-zags ρ₁ = ρ₃)
  const m = -Math.cos(gamma); // degree4Multipliers(γ, γ).mode1
  const rz = 2 * Math.atan(Math.tan(rs / 2) / m);
  return { straight: rs, zigzag: rz };
}

/**
 * V-fold piece angles for card gutter fold angle ρ_g (0 = open flat, π = closed), glue angle α.
 * @param {number} alpha @param {number} rhoGutter
 */
export function vfold(alpha, rhoGutter) {
  const r2 = -rhoGutter; // piece centre fold
  const r1 = 2 * Math.atan(-Math.tan(r2 / 2) / Math.cos(alpha)); // glue-line folds
  return { centre: r2, glue: r1 };
}

/**
 * Planar four-bar closure for a parallel fold. Links: ground g (gutter side), crank a (rotates with
 * the card half by φ), coupler c, rocker b. Returns the rocker angle or null when the loop cannot close
 * (a lock). Angles in radians, lengths in mm.
 * @param {number} g @param {number} a @param {number} c @param {number} b @param {number} phi
 */
export function fourBar(g, a, c, b, phi) {
  // crank tip P = (a cosφ, a sinφ) from ground pivot O=(0,0); rocker pivot Q=(g,0)
  const px = a * Math.cos(phi), py = a * Math.sin(phi);
  const dx = px - g, dy = py;
  const d = Math.hypot(dx, dy);
  if (d > b + c + 1e-12 || d < Math.abs(b - c) - 1e-12) return null;
  const cosA = Math.max(-1, Math.min(1, (b * b + d * d - c * c) / (2 * b * d)));
  return Math.atan2(dy, dx) + Math.acos(cosA);
}
