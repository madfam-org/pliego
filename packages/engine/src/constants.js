// @ts-check
/**
 * Calibration and numerical constants of the engine. Each calibrated value names the test that
 * fixed it. Engine units: mm, g, s (force g·mm/s² = µN, energy g·mm²/s² = nJ), radians inside.
 */

/** Gravity, mm/s² (−Y in the world frame). */
export const GRAVITY = 9810;

/**
 * Panel bending discretisation constant: k_b = C_B · D_eff(φ) · |e|² / (A₁ + A₂).
 * Theory for an equilateral lattice with the dihedral lever (h₀+h₁)/3 gives 2 (Grinspun's "6"
 * uses A_e = (A₁+A₂)/3). Calibrated by test `E1-peirce` (MD overhang 172 mm, copy paper 80 g/m²);
 * CD is then checked without recalibration.
 */
export const C_B = 1.8962;

/** Default hand factor: a folding hand is this many times stiffer than the crease. Test `crease-drive`. */
export const HAND_FACTOR = 50;

/** Panel-hinge plastic yield, degrees (paper takes a permanent curl only past this). Test `crease-unfold` (panels stay elastic). */
export const PANEL_YIELD_DEG = 60;

/** Membrane strain limit enforced by the post-solve pass (0.5 %). Test `inextensible`. */
export const STRAIN_LIMIT = 0.005;

/** Air density, g/mm³ (1.2 kg/m³). */
export const RHO_AIR = 1.2e-6;

/** Normal drag coefficient of a flat plate. */
export const DRAG_CD = 1.2;

/** Baseline velocity damping, 1/s (exp(−c·Δt) per substep, substep-count independent). */
export const DAMPING = 1.0;

/** Numerical floor of the contact distance, mm. */
export const MIN_CONTACT = 0.05;

/** Stiffness of welds/pivots/sliders in the implicit block, as a multiple of the stiffest membrane spring. */
export const HARD_FACTOR = 100;

/** Default user-grab stiffness, g/s² (soft: about one finger). */
export const GRAB_STIFFNESS = 2.0e4;

/**
 * Refactor the implicit-step matrix when any membrane edge has rotated more than this since the
 * last factorisation (radians). The gradient is always exact, so the equilibrium never depends on
 * this value — only how closely the dynamics follow a full Newton step. Test `E12-substeps`.
 */
export const REFACTOR_ANGLE = 0.05;

/** Defaults for World options. */
export const DEFAULT_SUBSTEPS = 20;
export const DEFAULT_SEED = 1;

/** Fraction of the target edge length below which a lattice point is dropped near a boundary. */
export const LATTICE_MARGIN = 0.55;
