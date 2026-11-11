# Panel bending: fixed-24 capture results (catalogue bar G1, step 1)

2026-11-11. Capture source `6d55f8c85416ae69014d060cdfdefdf3eccd4598`, run under the
[predeclared protocol](bending-capture-protocol.md). Lossless evidence:
[`evidence/bending-capture-2026-11-11/`](evidence/bending-capture-2026-11-11/README.md)
(manifest SHA-256 `df4b2d74001367dca9803d6d5ff7b097b425c8c41755d385f6ecda02158737ca`).

**Bottom line.** The accurate path now steps paper that bends out of plane, and every
reading matches the predeclared expectation:

- **Latent force gate.** Budgets 4 and 16 pass at all 4800 judged steps; the worst latent
  residual is 3.3e-11 microN, about 3000 times below tau = 1e-7 microN. Budget 1 fails at
  2299 of 2400 steps: one Newton step cannot absorb the second-order membrane coupling.
- **Public force gate.** Fails at all 7200 steps, at the rounding floor of public
  positions (about 3e-6 microN).
- **Linear bending comparator.** The out-of-plane field follows backward Euler on the
  represented law within the planar study's limits on all 24 rows, budget 1 included.
  Against the continuous solution it converges at first order in the timestep.
- **Integrity.** Strict repeat and observer parity are identical over every leaf; all 24
  restore continuations replay exactly; the 80/100-digit oracle agrees with every sampled
  native gate verdict; the frozen Newton reviewer finds no wrong accept.

**No force, time, material, booklet or device acceptance follows.** G1 also needs the
spine crease, contact and the hand drive.

## Fixture and arm

The cells2 patch (40 x 40 mm, 8 flat panel hinges) starts in its lowest discrete bending
mode, omega = 342.859 rad/s (54.57 Hz), at A = 0.004 mm with zero velocity. The mode comes
from an independent stdlib reference that rebuilds the flat-state stiffness exactly from
plate kinematics and the documented law. Plan: S0 = 72, N0 = 80, levels 1/2/4/8, Newton
budgets 1/4/16, both starts: 7200 judged steps, 50400 declared Newton iterations.
F0 = 11.62 microN, so tau sits on its 1e-7 microN floor. One arm: exact membrane curvature,
the half-tau absolute PCG stop, Gauss–Newton bending, the step-scaled angle change.

## Force gates

| Newton budget | Judged steps | Latent failures | Public failures | Worst latent residual (microN) |
|---|---:|---:|---:|---:|
| 1 | 2400 | 2299 | 2400 | 1.08 |
| 4 | 2400 | 0 | 2400 | 3.3e-11 |
| 16 | 2400 | 0 | 2400 | 8.3e-12 |
| **All** | **7200** | **2299** | **7200** | |

Budget 1 by level and start (latent failures; worst latent residual in microN):

| Level | Predictor start | Previous-pose start |
|---|---|---|
| 1 | 80/80; 7.7e-3 | 80/80; 1.08 |
| 2 | 159/160; 4.9e-4 | 160/160; 0.29 |
| 4 | 308/320; 5.0e-5 | 320/320; 0.074 |
| 8 | 552/640; 1.7e-5 | 640/640; 0.019 |

From the previous-pose start the remainder falls by about 4 per halving of the timestep
(second order); from the predictor it is far smaller but still above tau at every level.
This differs from the planar study, where the same arm cleared budget 1 at levels 4 and 8:
there the limit was the linear solve, here it is the nonlinear membrane coupling of an
out-of-plane deflection.

At budgets 4 and 16 the public residual is 2.9e-6 to 3.2e-6 microN at every step, about
30 times tau: X0+u rounded to binary64 near 40 mm. A latent pass never replaces a public
failure.

## Linear bending comparator

Gated scope: out-of-plane field and velocity, and bending plus out-of-plane kinetic energy,
against the independent nine-mode reference propagated from the actual initial field
(limits: backward Euler 0.001 / 0.001 / 0.005; continuous 0.01 / 0.01 / 0.05, phase 0.01
cycles). Values are the worst over each level's six rows; budgets and starts agree to the
digits shown.

| Level | BE field | BE velocity | BE energy | Continuous field | Continuous energy | Phase (cycles) |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 3.5e-4 | 4.8e-4 | 4.2e-5 | 0.221 | 0.395 | 2.1e-3 |
| 2 | 4.3e-4 | 6.2e-4 | 4.9e-5 | 0.118 | 0.223 | 4.9e-4 |
| 4 | 4.7e-4 | 7.1e-4 | 5.4e-5 | 0.061 | 0.118 | 9.0e-5 |
| 8 | 5.1e-4 | 7.7e-4 | 5.6e-5 | 0.031 | 0.061 | 1.1e-5 |

- **Backward Euler: passes on all 24 rows**, in both the latent and public views. The
  remaining difference is the amplitude's own nonlinearity: in development it fell as A²
  (2.2e-4, 1.4e-5, 8.8e-7 at A = 0.004, 0.001, 0.00025 mm).
- **Continuous: fails field and energy on every row**, as backward Euler's numerical damping
  predicts (40% of the energy lost per period at level 1), and converges at first order:
  field 0.221, 0.118, 0.061, 0.031. Phase stays within 0.01 cycles at every level.
- **Full field, reported and not gated.** Coupling energy (membrane plus in-plane kinetic)
  6.6e-3 of the modal energy on every row; in-plane velocity relative to the mode 2.5e-3,
  5.1e-3, 1.0e-2 and 1.9e-2 at levels 1 to 8. This is the second-order membrane coupling
  the protocol recorded before freezing.

Paired controls: budget 4 against 16 differ by at most 4.0e-13 of the state scale (8 of 8
pass the 1e-4 isolation limit); budget 1 against 4 differ by 1.6e-8 to 1.2e-5 but cannot pass
because budget 1 fails the force gate. Adjacent levels at common times differ by 0.104,
0.057 and 0.030 (first order), with actual clock drift at most 1.8e-16 s.

## Integrity and independent checks

- **Strict repeat**: identical over 9,031,868 leaves except `recordedAt`.
- **Observer parity**: identical over 5,626,344 leaves except the named observer fields.
- **Restore continuations**: 24 of 24 replay the final step bit for bit.
- **Validation**: every one of the 7224 observations re-validated independently (bindings,
  live World, independent bending recomputation, omitted-work bound).
- **Oracle** (446 sampled completed endpoints across all 24 rows): 80- and 100-digit proofs
  identical over 252,073 leaves. Worst represented errors: bending energy 5.4e-17 nJ,
  membrane energy 3.4e-18 nJ, elastic gradient and bending gradient components 1.8e-14
  microN, native-coefficient residual components 1.75e-14 microN; all within the
  predeclared limits (1e-12 nJ, 1e-9 microN). Truth and native verdicts agree on every
  sample (136 latent and 446 public truth failures, the same as native).
- **Selected Newton review** (frozen before the capture): 83 unique selected events (66
  accepted, 17 rejected). No wrong accept under the recorded, captured-gradient or
  exact-gradient slope with either inertia law; no rejected event that passes; no
  uncertain verdict. Bending decides the Armijo verdict in 22 events. The engine's recorded
  bending difference, linear part and remainder are within 1.3e-15 of their own magnitude
  (at most 1.9e-18 nJ).
- **Source**: clean capture worktree at the commit; all 16 CI checks passed on it; the
  planar oracle files the bending oracle imports are byte-identical to the closed capture's.

## Findings recorded, not changed

- **Rounding noise in recorded bending terms on tiny steps.** On iterations near roundoff the
  engine's per-hinge linear terms cancel across hinges, so its recorded bending difference
  is noise relative to the true change (in development, 1.4e-47 recorded against a true
  4.1e-56). It stays far inside the search's reported precision scale here; a thinner Armijo
  margin could be affected. Recorded with the step-scaled angle change (PR #75) as the same
  class as the binary64 gradient.
- **Hinge angle memory.** `setInitialReferencePose` leaves the hinge angle memory at the
  constructor's flat angles, and that memory is updated from the public pose while it
  continues latent angles. Harmless here (branch margins near pi); a large initial fold
  would need the first fixed.
- **Budget-16 rows iterate at roundoff.** After convergence the remaining iterations run full
  backtracking searches and are rejected as precision-limited; this is most of the run time.

## Cost

Research processing, not engine performance: candidate 30 min, repeat 40 min, plain 32 min;
probes 3 s; each oracle precision 47 s; selected Newton review 22 s.

## What this means and what is next

The accurate path integrates out-of-plane bending on the represented panel law as backward
Euler predicts, with converged latent forces whenever Newton gets at least four iterations.
For the catalogue (recorded page turns, ruling R0), the next G1 steps are:

1. The spine crease (nonzero rest angles and crease stiffness) on the accurate path.
2. Paper contact (separation, no crossings) on the accurate path.
3. The hand drive.
4. A catalogue page-turn fixture for G2 (force) and G3 (time), with offline recordings.

Budget 1 cannot meet the force gate in bending; offline recordings can afford several Newton
iterations per step, so this does not block R0.
