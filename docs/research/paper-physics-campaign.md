# Paper physics campaign

Started 2026-11-09. Status: active; research and implementation are **not exhausted**.
Scope: Pliego only. Owner selected both interactive reading and engineering accuracy,
with separate acceptance gates. No merge, deployment or whole-engine GA is implied.

## What would count as exhausted

An operational stopping rule, not a claim of mathematical optimality: every credible
candidate below must have a reproducible experiment, a measured comparison, or a
documented reason it cannot satisfy this product's requirements. Material validation,
contact failures, target-device performance and corpus regressions must have evidence.
Unread references, an attractive demo, passing CI, and a lower-level implementation
language do not close a candidate. New evidence can reopen any decision.

## Current implementation and actual gaps

Read `xpbd/world.js`, `implicit.js`, `pcg.js`, `contact.js`, `edgecontact.js`,
`linalg/blockchol.js` and [engine strategy](../strategy/engine.md). The native engine
is a JavaScript Float64, triangular membrane/hinge model: implicit Gauss–Newton,
sparse block Cholesky, matrix-free PCG with a stale co-rotated preconditioner, then
position-level contact/strain projections. A Worker changes scheduling, not the
solver's arithmetic cost. Rigid preview, render subdivision and physical integration
are different operations.

The default membrane stiffness is capped (`MEMBRANE_CAP_LENGTH`), so a stock's
input modulus is not always its simulated in-plane modulus. The campaign now
implements `physicalMembrane: true` to bypass that cap for membrane edges and
perforation strength. It is an experimental comparison, not an accuracy guarantee
or a default-reader change. Benchmark reports include the retained MD/CD stiffness
fractions; low stretch alone cannot validate a capped constitutive model.

An optional `lineSearch: true` now checks GN/PCG proposals against the actual
implicit objective with bounded Armijo backtracking. Its directional derivative
agrees with the solver gradient (finite-difference test), and snapshot/restore
preserves both positions and search diagnostics. It does not constrain prediction
or the later projections. In particular, it did **not** fix the large-load axial
counterexample with one Newton iteration; this result is retained, not relabelled
as success. The candidate must be judged with convergence and timestep tests.

No shipping WASM SIMD or WebGPU compute solver was found. The existing research
memo's proposed GPU architecture is not implementation evidence. Important open
physics includes contact coupled to elasticity, production general edge–edge contact/CCD,
orthotropic constitutive convergence, material calibration, in-plane plasticity,
time-dependent crease relaxation and laminate membrane–bending coupling.

A subsequent [coupled normal-contact candidate](coupled-contact-experiment.md)
adds feasible nonlinear iterates, normal barrier forces, matrix-free contact
curvature and per-iteration CCD/energy search. Analytical element equilibrium,
native force balance and combined-objective derivatives are checked. Its
previous-pose initialization is separately exposed as a legacy-solver ablation:
the S8 axial improvement is reproducible with contact disabled, so it must not
be credited to barrier forces. Friction, strain/fold constraints, initial table
touching, real prescribed motion, contact weighting and general convergence
remain open. Both options remain off by default.

The latest sampled nightly at main `77025d0` recorded 154 stable / 95 unstable
documents of 249 (85 stretched, 10 exploded), with truncated/time-compressed runs.
See [honest status](../HONEST_STATUS.md) for its exact scope and source. A green
informational nightly does not mean the stability gate passed.

## Primary-source candidate register

These are research candidates, not claims that their published guarantees transfer
to Pliego. No third-party implementation was copied into this change. Project-page
review is distinguished from a full derivation/implementation review.

| Candidate and primary source | Relevant evidence | Pliego experiment / state |
|---|---|---|
| [Wolf, Cornillère, Sorkine-Hornung 2021: book simulation](https://igl.ethz.ch/projects/book-simulation/) | Full paper acquired; §3–5 and limitations reviewed, p9 visually checked. DOG quad page, planar page-block midlines, constrained implicit Newton/SparseLU, soft isometry. Reported average maximal edge stretch 11%, RMSE 1.8%; rendering adjusts lengths. Self-collision and friction omitted. | Native active-leaf/fixed-rest reader is **not** their developable solver. The paper remains an interaction candidate, not our engineering-accuracy reference. Free-location holding, DOG dynamics, moving page blocks and equivalent-model WASM comparison remain open. |
| [Rabinovich, Hoffmann, Sorkine-Hornung 2018: discrete geodesic nets](https://igl.ethz.ch/projects/developable/) | Local angle constraints on quad meshes represent developability and discrete isometry. Primary abstract/project reviewed. | Not implemented. Need dynamic formulation, singularity/crease handling and interpolation to native source topology. Measure angle defect and stretch rather than visual plausibility. |
| [Macklin et al. 2016: XPBD](https://doi.org/10.1145/2994258.2994272) and [2019: Small Steps](https://matthias-research.github.io/pages/publications/smallsteps.pdf) | Compliance scaling; many small steps can improve error/damping at similar work. Small Steps equations and collision-amortization section reviewed. | Compare S=8/I=1, S=4/I=2, S=16/I=1 in the **existing hybrid solver**. This does not substitute for a pure local XPBD implementation or establish equal-error performance. Broad phase per frame requires conservative motion coverage; simply skipping detection is inadmissible. |
| [Bouaziz et al. 2014: Projective Dynamics](https://www.projectivedynamics.org/) | Local/global optimization with specially chosen potentials and reusable global structure. Primary abstract/paper introduction reviewed. | Not implemented. Benchmark factor reuse, nonlinear residual and crease/contact compatibility against current sparse GN/PCG. Changing the energy model requires material gates. |
| [Chen et al. 2024: Vertex Block Descent](https://graphics.cs.utah.edu/research/projects/vbd/) | Vertex-local energy descent, graph coloring, convergence to implicit Euler in the studied models. Primary project/paper introduction reviewed. | Not implemented. Candidate for CPU/GPU local 3×3 solves. Test stiffness ratios, bending stencils and pins; published elastic-body results are not a validated paper model. |
| [Giles, Diaz, Yuksel 2025: Augmented VBD](https://graphics.cs.utah.edu/research/projects/avbd/) | Main §3.1–3.7, §4/Algorithm 1 and closing limitations reviewed; p6 visually checked. | [Native experiment contract](avbd-review.md); not implemented. Target-material residuals must remain independent of temporary ramped stiffness, regularized hard constraints and finite iteration drift. |
| [Li, Kaufman, Jiang 2021: C-IPC](https://ipc-sim.github.io/C-IPC/) | Coupled strain barriers, finite thickness, friction and additive CCD. Paper §5.1–5.4 / Algorithm 1 reviewed; reference code identified. | Closest-feature/ACCD components and an opt-in [coupled normal-force experiment](coupled-contact-experiment.md) exist. The global endpoint filter fails native turn progress. Normal-force derivative/equilibrium tests pass, but the new gap-based model is not C-IPC: strain barriers, friction, weighting, mollification and a full independent reference remain open. No intersection-free engine claim. |
| [Chen et al. 2025: Offset Geometric Contact](https://graphics.cs.utah.edu/research/projects/ogc/) | Main §3.1–3.8, Algorithms 1/3 and limitations reviewed; pages9/12 visually checked. Block membership and force construction accompany the bounds. | [Derivation/code review](offset-contact-review.md) records an apparent activation-coefficient discrepancy and the reference-code distinction. No OGC port, cited-proof reproduction or finite-caliper guarantee. |
| [Wen et al. 2026: dimension-reduced developable dynamics](https://www.sciencedirect.com/science/article/pii/S0022509626000931) | Primary abstract describes reduction to rod dynamics with developable/curve-fold constraints. Abstract only reviewed. | Not implemented; establish applicability to rectangular pages, arbitrary grabs and contact before any speed claim. |
| [Yamazaki 2026: SOCP–PBD](https://link.springer.com/article/10.1007/s00371-026-04760-z) | Primary abstract identifies anchored-cloth slack/stretch and a cone-programming correction. Abstract only reviewed. | Newly identified, not implemented. Compare feasibility, sparse solve cost and preservation of paper bending/material behavior. |
| [Wen et al. 2026: variational r-adaptive cloth](https://arxiv.org/html/2608.17833v1) | Main formulation/quality/solver §3–5 reviewed; supplemental derivatives and reproduction open. | Not implemented. Preserve native UV/art, cut/crease anchors and mass. Measure fixed-budget error; approximate cached derivatives need fresh target-force checks before declaring convergence. |
| [Sung et al. 2026: curvature-driven collision culling](https://www.mdpi.com/2227-7390/14/9/1504) | Curvature criterion and boundary/mesh limitations reviewed; reported GPU experiments not reproduced. | A curvature threshold alone is rejected as our safety certificate: flat leaves can collide at zero curvature. A conservative spatial index must retain all eligible swept pairs. This does not evaluate every stage of their implementation. |
| [Liesegang et al. 2026: paperboard forming](https://link.springer.com/article/10.1007/s00170-026-17694-6) | Abstract and selected FE/calibration passages reviewed; full model/validation not reproduced. | Calibration reference to investigate, not stock data for our reader. Process-specific model fitting cannot substitute for held-out booklet-paper measurements. |

Backend experiments are a separate axis: baseline optimized JavaScript; WASM scalar
and SIMD; WebGPU compute with measured transfers/dispatch cost. A backend port must
use an equivalent model, resolution, tolerance and workload. Record availability on
target browsers, initialization, memory, power where measurable, frame p50/p95/p99,
and input latency. GPU Float32 and parallel reduction order also need a declared
determinism policy; they cannot silently inherit bit-exact CPU replay claims.

The current [WGSL scalar-type specification](https://www.w3.org/TR/WGSL/#scalar-types)
provides concrete floating types f32/f16. AbstractFloat's binary64 constant rules
do not provide an f64 storage/compute type. A direct Float64-preserving WebGPU
port is therefore not a baseline-language substitution. Float32/emulation and
WASM f64/SIMD remain separate experiments, including transfer and dispatch cost.

The [local contact ablation](evidence/paper-2026-11-09/README.md#consistent-curvature-and-direct-local-contact)
now completes a coupled eight-turn protocol with low tensile strain and zero
partial resting-block deficit. Force convergence and timing still fail. The
linear solver alone does not explain nonlinear convergence; compression curvature
and near-parallel contact behavior matter. Recorded profiles put over 91% of
sampled time in swept candidate scanning. Next work must address conservative
indexing and contact smoothness, alongside independent material/model gates.

## Separate gates

**Interaction:** booklet frame/camera fixed throughout dragging; only exposed leaves
selectable; sequential front/back identity and order; cancellation and reverse turns;
keyboard, pointer and real touch; readable front/back art; no hidden-tab work; resize,
engine switch and teardown safe. Measure complete input-to-paint and physics separately.
The engine's 8 ms physics target is not a 60 Hz end-to-end certificate. No real phone
or stylus result is recorded yet.

**Numerical:** no errors/non-finite/exploded state; measured peak strain and compression,
thickness separation, penetration/crossings, pin/join residual, angle defect and energy
behavior. The booklet harness reports both 1% and aspirational 0.1% tensile-strain gates.
Neither is material validation. Existing cantilever, grain, substep, mesh-convergence,
crease, contact and deterministic replay tests remain required; physical stock curves
and held-out measurements remain owed.

**Release:** pinned source and fixture hashes, seed/options/runtime, repeatable workloads,
full eligible corpus counts and failures retained. No automatic preview fallback or
time compression in candidate comparisons. One exploratory local timing run cannot
prove fastest implementation, sustained frame rate or production readiness.

## Reproducible implementation evidence

Generate and verify trusted native fixtures (no external art):

```sh
PYTHONPATH=packages/kernel/src .venv/bin/python scripts/qa/make_paper_fixtures.py --check
node --test apps/web/test/book-reader.test.mjs
node --test packages/engine/test/contact-feature.test.js
node packages/engine/bench/paper-campaign.mjs --out /tmp/paper-campaign.json
node packages/engine/bench/axial-pull.mjs --out /tmp/axial-pull.json
```

The harness compares all leaves flexible against the bounded reader on the same
90 × 128 mm, four-leaf native codex, eight turns, 84 frames per turn, seed 1.
It compares three substep/iteration settings plus the uncapped membrane experiment,
and independently audits active vertices against flat resting blocks. This partial
thickness audit is not edge–edge CCD or a triangle-intersection proof.
It records failures and stops a case when its numerical gate fails. Exit zero means
the harness completed, not all candidates passed. `--engine /absolute/index.js
--engine-label <source>` allows a separately captured engine baseline; record that
engine's source identity alongside the report. Timing must run without competing tests.

Initial diagnosis: unmodified engine can fail on the first turn at frame 45 with
`BlockCholesky: matrix not positive definite at block 0`. The matrix already contains
NaN after contact-driven coordinates explode; Cholesky is not the initiating failure.
A trace isolated a face query outside a triangle (negative barycentrics about −0.001)
at a pinned corner: 0.219 mm residual, effective inverse mass 0.000244, and 161 mm
predicted wing movement. The retained patch rejects negative-weight face contacts
for **fixed queries**, preserving the existing movable-query tolerance. It fixes
the first-turn failure in the measured sequence, but later all-flexible turns still
fail strain gates. Full strict-face rejection and current-normal trials were not
adopted: both altered the existing slit-interlock strain comparison adversely.
A trial cap of
one contact thickness per correction did not establish a better model and was not
adopted. Existing interlocking-slit regression must also pass before accepting a
general contact change. Do not weaken that test to make the patch green.

The reading model retains source layout, sheet/stock IDs, front/back art and native
leaf controls. Only its explicit reading pose fixes resting sheets; native fabrication
documents/exports remain unchanged. At most two solver worlds are cached, with endpoint
snapshots for revisiting leaves. Release uses elapsed simulation time, not the
number of render calls. At 1.4 seconds the active leaf is explicitly promoted to a
flat page block, and idle stepping stops. Original dynamic release poses and
statistics are retained for the benchmark rather than replaced by endpoint evidence.
This avoids the unreadable overlapping layers observed in the first browser trial;
it does not solve physical stack contact. The archive companion's imposed saddle-stitch source is not
silently reinterpreted as independent fabrication leaves.

Codex pointer input is projected onto the native book plane, then mapped to the
turn arc relative to the held page radius. This replaced a viewport-width threshold
that required too much travel on the 390 px layout. Native-pick tests cover forward,
reverse and cancel at 390/1280 px with different camera scales; no camera orbit/pan
is invoked. This changes the interaction mapping, not the fore-edge hand model.

## Next unresolved experiments

The [first committed measurements](evidence/paper-2026-11-09/README.md) retain
both supported baseline failures and current candidate failures. Five active-leaf
configurations complete reading below 1% stretch, but none passes the independent
thickness or 8 ms physics gate. The contact correction also regresses the baseline
S=16 reader's partial thickness result. In the separate axial test, sufficiently
small uncapped steps approach the analytical bar reference; line search alone
does not fix the under-converged update. The machine-readable reports pin the
source and disclose their timing/accuracy scope.

1. Finish the contact-feature correction without regressing slits; rerun the corpus
   with exact before/after coverage and preserved failures.
   The [continuous-contact experiment](continuous-contact-experiment.md) now
   reproduces tunneling and rejects a global-filter candidate on actual turn
   progress, strain and cost. This does not close coupled contact research.
2. Finish booklet browser/device acceptance, arbitrary-location hand coupling and
   derived companion page mapping with immutable fabrication provenance.
3. Build an offline C-IPC/FEA reference and measured stock fixtures; quantify stiffness
   capping, grain response, crease hysteresis and mesh/time convergence.
4. Implement and compare local XPBD, developable/rod and VBD/AVBD candidates on those
   same gates, then evaluate backend ports for the strongest candidates.
5. Close the register only with evidence-backed decisions. Current status stays active.
