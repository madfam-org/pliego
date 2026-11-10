# AVBD research review and native experiment contract

Research candidate, not implemented in Pliego. Reviewed the authors' main
derivation (§3.1–3.7), implementation (§4, Algorithm 1) and closing limitations;
visually checked page 6. Performance tables and cited convergence proofs have
not been independently reproduced. Source:
[Giles, Diaz, Yuksel, Augmented Vertex Block Descent, SIGGRAPH 2025](https://graphics.cs.utah.edu/research/projects/avbd/Augmented_VBD-SIGGRAPH25.pdf).
Acquired PDF SHA256: `7957d116b9130cfb0aa5a48ab7cd0d74a64ad79f75c99acd291bdece2be3f2d6`.

The method combines local primal updates with dual updates for hard constraints.
For finite-stiffness forces it ramps a temporary stiffness toward the target,
without the hard-constraint multiplier. Bound handling clamps force multipliers
and rescales the local curvature. Friction uses normal/tangential contact forces
and a Coulomb cone. Warm starting decays stiffness and multipliers; prior hard
constraint error is partially regularized. Their implementation uses discrete
collision detection, persistent contact data and coloring. Local propagation
remains iteration-limited; backward Euler dissipates energy at larger steps.
These mechanisms are more than a different linear solver for Pliego's current
fixed potential. Their bounded-iteration contact method does not establish our
finite-caliper swept-feasibility gate.

## Proposed Pliego experiments

The following are our test requirements, not published AVBD guarantees:

| Experiment | Independent gate |
|---|---|
| Two soft springs in series, varying stiffness ratios | Compare extension and each spring force against the analytical target coefficients, not the ramped temporary coefficients. Retain transient error and iteration counts. |
| Axial strip and cantilever with native stock | Measure residual using the final physical stiffness even when the local optimization uses smaller intermediate values. Keep capped/uncapped material comparisons separate. |
| Point mass against triangle and native sheet against ground | Compare the scalar equilibrium and weight/support balance. Report complementarity, thickness deficit and momentum injected by correcting prior error separately. |
| Static incline and sliding sheet | Compare stick/slip thresholds and force direction to analytical Coulomb references, then independently measure real paper coefficients. No guessed coefficient qualifies as calibration. |
| Native booklet in both directions | Preserve the fixed booklet, pre-promotion trajectory hashes, full eight-turn protocol, peak strain, thickness and moving-step residual gates. A completed logical turn alone cannot pass. |
| Parallel/contact state replay | Stable contact identities, deterministic coloring and multiplier/stiffness snapshots must reproduce active-contact trajectories. Reordered reductions need their own parity policy. |

A feasibility-preserving variant would need swept bounds for every accepted local
or colored update, including contact pairs introduced during a sweep. Reusing a
frame-start contact list without conservative motion coverage is not sufficient.
That requirement must be costed rather than omitted from an equal-error timing
comparison. A sequential Float64 native-element prototype should precede a
backend port, so model errors and scheduling costs can be distinguished.

The authors' browser demo is useful implementation evidence for their method;
it does not settle native paper topology, finite caliper, measured orthotropy or
deterministic Pliego replay. The candidate remains open.
