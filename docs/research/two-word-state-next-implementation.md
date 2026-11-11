# Next implementation: a two-word displacement state

2026-11-11. Design only. Prerequisite for force gate G2 on folded states and page turns in the
[catalogue acceptance bar](catalogue-paper-acceptance.md); found while admitting creases
([crease design](crease-domain-next-implementation.md), PR #77).

## The floor

The reference-displacement state stores the latent displacement u as one binary64 word per
coordinate. Once u is large, Newton corrections smaller than one ulp of u round to zero
("precision-limited zero steps") and the latent force residual stops at about
stiffness x ulp(|u|). Measured on the folded card (crease relaxation, 32 Newton iterations,
6 substeps, same shape at three sizes):

| Card | max \|u\| | ulp(u) | Latent residual floor | Floor / ulp |
|---|---:|---:|---:|---:|
| 10 mm | 5.4 mm | 8.9e-16 mm | 2.5e-7 microN | 2.8e8 microN/mm |
| 40 mm | 21.7 mm | 3.6e-15 mm | 1.0e-6 microN | 2.9e8 microN/mm |
| 160 mm | 87 mm | 1.4e-14 mm | 6.2e-6 microN | 4.4e8 microN/mm |

The floor tracks ulp(|u|) at a near-constant ratio, the membrane stiffness. tau is
max(1e-7, 1e-10·F0) microN, so the floor already fails at a 10 mm card. A page turn swings
u to hundreds of millimetres (about 2e-5 microN at 420 mm). The flat bending capture never
met it (|u| about 0.004 mm). More Newton iterations do not help.

## Recommended design: two words per displacement coordinate

The latent position becomes X0 + u + uLo, with uLo the second word, exactly as the membrane
already evaluates it: in reference-displacement coordinates the UV membrane builds each
displacement as the two-word value `[u, 0]` (`uv-reference.js`, `referenceKinematics`).

- **Opt-in.** `stateRepresentation: 'double-double'` (state identity version 2). Omitting it
  keeps today's binary64 trajectories byte for byte, so every closed capture stays replayable.
- **Storage.** Low-word arrays beside `_u`, `_us`, `_ut`, owned by the reference state and
  bound in snapshots. Callers pass latent views `{ hi, lo }`; no properties on typed arrays.
- **Newton update.** Trials become old + alpha·d in two-word arithmetic, so corrections below
  ulp(u) accumulate in uLo instead of rounding away. Directions stay binary64.
- **Predictor and velocity.** ut = u + h·v in two words; v = round((u − us)/h) stays binary64.
- **Public projection.** x = round(X0 + u + uLo), one rounding of the exact two-word sum.
- **Expected effect.** The representation floor falls by about 2^-53; the residual is then set
  by the force evaluation itself (two-word membrane, binary64 bending gradient), measured to be
  near 1e-14 microN in the bending capture's oracle.

The alternative, re-anchoring the origin near the current pose each step, still needs the
membrane's displacement from X0 as a two-word sum, so it is the same change with more
bookkeeping.

## Call-site inventory

| Area | Files | Change |
|---|---|---|
| State, predictor, velocity, projection, initial conversion, snapshots, residuals | `reference-state.js` (21 uses of the state arrays) | own the low words; two-word predictor and projection; bind in snapshots and the identity |
| Membrane kinematics | `uv-reference.js`, `orthotropic-membrane.js`, `membrane-curvature.js` | take `[u, uLo]` instead of `[u, 0]` |
| Bending geometry | `reference-bending.js` | add the low words to the exact pose and step differences |
| Search | `increment-search.js`, `energy-search.js` | two-word trials, objective and inertia terms |
| Gradient, assembly, solves | `implicit.js`, `pcg.js`, `newton.js`, `exact-newton.js` | consume latent views; operators may stay at the rounded pose (state why) |
| World, options | `world.js` | admission of the option; snapshot plumbing |
| Bench and oracles | `bench/*-state-*` | bind the low words; oracles sum X0 + u + uLo exactly |

## Milestones and tests

1. **Engine, opt-in.** Tests: the folded card's latent residual falls below 1e-9 microN at all
   three sizes; precision-limited zero steps disappear until the force evaluation limit;
   omitting the option replays the 21 planar scenarios and the bending capture's rows byte for
   byte; snapshots bind and restore the low words and refuse across representations.
2. **Capture tooling** binds the low words; the oracles use exact X0 + u + uLo.
3. **Folded-card crease capture** (crease milestone 2) on the two-word state.

## Risks

Many call sites with bit-exact invariants; review each against the planar replay. Two-word
trials add arithmetic per Newton trial (the membrane is already two-word, so the increase is
modest; measure it). Snapshot format changes are guarded by the identity version.
