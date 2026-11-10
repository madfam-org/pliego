# VBD 2024: a credible same-law solver candidate with conditional descent

2026-11-10. Read-only assessment against Pliego `3d778abc179988e1c1a31b43d8048aa6a08d00b1` and its [candidate register](paper-physics-campaign.md#primary-source-candidate-register). No solver, model, benchmark or accepted-capture change was made.

**Decision:** VBD can operate on our existing orthotropic StVK objective; it does not require the standard-PD material substitution. A bounded Float64 vertex-block experiment is credible. Published numerical stability, indefinite-block updates and a fixed iteration limit do not establish Pliego's force, time, material, contact or device gates.

## Primary sources and exact review footprint

[Author project](https://graphics.cs.utah.edu/research/projects/vbd/) links the [full paper](https://graphics.cs.utah.edu/research/projects/vbd/vbd-siggraph2024.pdf) and [official Gaia repository](https://github.com/AnkaChan/Gaia). Read §3.1–3.9 (pp3–8), §4 (p8), §5's implementation/stopping description (pp8–9), §5.2/5.4 (pp9–12), Algorithm1 (p10), and §7 (pp14–15). All16 pages were extracted; pages4/15 visually inspected. Paper SHA256: `4ba65c4e49e8e8740aca491c2bf466b6eeb6f8824a152c12d1f7800828959132`.

The local update solves H_i d_i=f_i for three vertex coordinates, with f_i=−∇_i G and H_i the inertia block plus incident energy Hessian blocks. A local energy decrease equals the global decrease when other coordinates are fixed. Initial guess and inertial target are distinct. The paper permits indefinite directions, skips near-singular blocks, and offers optional local line search; reported tests omit it. It uses fixed iteration counts, coloring and buffered collision updates, while identifying stiff/high-resolution systems, large stiffness ratios and penetration as limitations. [Paper §§3,5,7.](https://graphics.cs.utah.edu/research/projects/vbd/vbd-siggraph2024.pdf)

**Official code is available, but version matters.** I pinned the latest official tree at `c229692045465a76233f9fba9197fb22bbfb3694` (2025-10-04) and a paper-era public snapshot at `1d5ff50139bbc2015cf640a96d7ecc924411e3d7` (2024-06-10). The latter is not claimed to be the exact executable used for the publication. The inspected VBD core `.cpp/.cu` files are byte-identical between those two snapshots. Later cloth sources are reviewed separately and are absent from the paper-era tree.

- [Paper-era VBDPhysics.cpp, VBDStep/VBDStepWithCollision, lines2332–2475](https://github.com/AnkaChan/Gaia/blob/1d5ff50139bbc2015cf640a96d7ecc924411e3d7/Simulator/Modules/VBD/VBDPhysics.cpp#L2332): actual inertia/material accumulation, small solve, caller-dependent force-direction fallback and optional compile-time local search. `runStepGPU` lines839–950 runs the requested iterations; convergence evaluation is diagnostic.
- [Pinned CuMatrix submodule, solve3x3_psd_stable, lines235–267](https://github.com/AnkaChan/CuMatrix/blob/bb2aaefcceee8cf294c8b98648733caa9fb6b22f/CuMatrix/MatrixOps/CuMatrix.h#L235): adjugate solve with a relative determinant test. Despite its name, this function performs no PSD projection or diagonal regularization. It writes the RHS on failure and returns false; callers determine the outcome. This differs from simply assuming the paper's singular-block skip.
- [VBD_BaseMaterial.h, lines198–260/359–366](https://github.com/AnkaChan/Gaia/blob/1d5ff50139bbc2015cf640a96d7ecc924411e3d7/Simulator/Modules/VBD/VBD_BaseMaterial.h#L198) and [forwardStep](https://github.com/AnkaChan/Gaia/blob/1d5ff50139bbc2015cf640a96d7ecc924411e3d7/Simulator/Modules/VBD/VBD_BaseMaterial.cpp#L7): inertial target and separately chosen starting position. [Types.h lines77–79](https://github.com/AnkaChan/Gaia/blob/1d5ff50139bbc2015cf640a96d7ecc924411e3d7/Simulator/Modules/Types/Types.h#L77) selects `float`; an optional double 3×3 solve does not recover precision already lost in Float32 inputs.
- [Later VBDTriMeshStVK.cpp](https://github.com/AnkaChan/Gaia/blob/c229692045465a76233f9fba9197fb22bbfb3694/Simulator/Modules/VBDCloth/VBDTriMeshStVK.cpp#L553): the visible energy uses isotropic lambda/mu; bending accumulation at913–954 uses a four-vertex Laplacian quadratic form, not our dihedral/rest-angle law. This is implementation evidence, not an equivalent orthotropic reference. No reference code was compiled or executed.

## Derivation and transfer limits for Pliego

For the current displacement ABI, keep

\[
G(u)=\tfrac12\sum_i C_i\|u_i-u_{t,i}\|^2+\sum_e U_e(u),\quad r=\operatorname{fl}(1/\operatorname{fl}(h h)),\quad C_i=\operatorname{fl}(m_i r).
\]

My inference: updating only u_i changes only its inertia and incident elements. Therefore the local/global decrease identity remains valid for our coupled Q, grain rotations and selected UV-reference StVK law. No isotropic material substitution is required. The exact block Hessian includes geometric stress terms; the existing [element implementation](../../packages/engine/src/xpbd/orthotropic-membrane.js) distinguishes exact and GN curvature. Our collapsed-triangle derivative refusals remain in force; the paper's volumetric Neo-Hookean recovery tests do not widen the admissible domain of this StVK implementation.

An invertible indefinite block is not a descent certificate. For example, my scalar model \(G(z)=(z^2-1)^2/4+cz^2/2\), 0<c<1, has G′<0 and G″<0 at sufficiently small positive z. Its Newton direction −G′/G″ is negative, so G′d>0: it is an ascent direction. This is a mathematical counterexample to an unconditional descent inference, not a measured failure of the paper or our current near-rest inputs. Backtracking along an ascent direction is not a general repair. Likewise, skipping or taking a tiny step does not certify equilibrium.

A useful explicitly named safeguarded variant uses the block

\[
B_i=C_iI+\sum_{e\ni i}V_eJ_{e,i}^TQ_eJ_{e,i},\qquad d_i=-B_i^{-1}\nabla_iG.
\]

Positive mass and Q make B_i SPD in exact arithmetic, and ∇_iGᵀd_i<0 for nonzero d_i. This changes the direction approximation, not StVK energy or target force. It is **block-GN VBD with local search**, not a reproduction of the paper's unsafeguarded full-Hessian timing results. V_e includes reference area×thickness. No stiffness ramp, artificial material softening or post-hoc tolerance change is needed.

## Stencils, starts, stopping and contact

**Color the actual energy stencils.** Our triangle stencil requires three distinct colors; a four-vertex hinge requires the entire stencil to be independent, including the opposite-vertex pair missing from a simple mesh-edge coloring. Joins, drives and dynamic contacts add conflicts. The paper's per-color auxiliary buffer avoids races for new contact couplings, but those couplings become partially Jacobi. My inference: race freedom does not restore the serial local/global descent identity for several mutually coupled vertices updated simultaneously. Validate the combined objective instead of transferring a serial proof unchanged.

**Keep ut fixed.** The paper's adaptive acceleration changes an initial guess, not its inertial target. Start a future comparison from the existing us/ut alternatives and actual captured states. In our zero-gravity domain its gravity-direction heuristic adds no needed capability and requires a zero-acceleration guard. Copy neither its Float32 arithmetic nor its inertia multiplication order into the existing native association silently.

**Re-evaluate the complete endpoint force.** Later neighbor updates make an earlier vertex's residual stale. Check all coordinates after a full sweep, at both public x and authoritative u, with original F0 and τ. Average force norm, local skip thresholds, small update or a fixed sweep count cannot replace those gates. The official diagnostic reports an average force norm; its solve loop is not our all-component certificate. Implicit time error and finite-iteration error remain separate.

**Contact is a different model question.** The paper's finite penetration penalty, lagged normals/friction derivatives and amortized CCD do not inherit our barrier/thickness requirements. It explicitly allows missed collision events to be found at the next step. Do not use that as a conservative booklet-contact guarantee. The later official cloth framework also contains newer conservative-bound logic; it must not be attributed to the original 2024 algorithm without separate review. No OGC/AVBD claim is made here.

## Smallest credible next experiment

After the frozen campaign, predeclare one no-contact Float64 native patch using unchanged orthotropic Q/UV/reference words, masses, h, actual initial x→u conversion, both starts and force tolerances. Implement only colored vertex-block updates with actual current incident-element gradients, the above GN block and strict local Armijo search on **all** affected energy terms. Disable damping, adaptive starts and Chebyshev acceleration initially. Preserve refusal/indefinite/singular/rejected-update outcomes; a faithful unsafeguarded full-Hessian variant would be a separate ablation.

First check single-vertex derivatives and local-versus-whole-objective energy changes, then serial-versus-properly-colored sweeps and complete force fields. Compare against current sparse GN/PCG at matched residual/error and separately at declared work budgets; one vertex sweep is not equal work to one global Newton iteration. Include setup, derivative evaluations, colors, local solves, backtracking and memory cost. Subsequent refinement/stiffness-ratio tests must expose slow global information propagation rather than hiding it with extra sweeps. Only then add the existing hinge energy with correct stencils, followed by contact and fixed-frame independent-booklet/device tests.

The official later cloth `evaluateVertexMeritEnergy` path sets its bending contribution to zero while its material accumulator includes bending; this narrowly inspected path is another reason to use our complete objective and independent derivative tests rather than copy a reference merit helper. It is not a claim about every Gaia code path.

**Disposition:** advance from abstract-only to full-paper plus pinned partial official-code review. VBD is a credible same-material algorithm experiment, particularly where vertex-local parallel work helps. Slow stiff-system convergence, Float64 deployment cost, local-search overhead, hinge/contact stencil handling and both native force gates remain unmeasured. No port, speed, stability-generalization, material-validation or optimality claim follows.
