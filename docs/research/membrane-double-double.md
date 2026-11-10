# Two-word membrane and objective evaluation

Research candidate, 2026-11-10, following the retained
[increment-search failure](membrane-increment-search.md). Strict force, time,
physical material and fixed-booklet/device acceptance remain separate and open.
This experiment does not claim an optimal abstraction or exhausted simulation research.

## Isolated diagnostic repair

The retained 32-probe full 80/100-digit output comparison failed on seven
`runtime.realSumOfStoredRuntimeTermsNJ` values. The versioned
`exact-rational-dot-plus-remainders/2` repair evaluates that field's original
meaning: exact stored-gradient dot actual rounded displacement, plus stored
membrane/inertia remainders, followed by one binary64 rounding. It does not
substitute the already-rounded recorded slope or change an objective/Armijo gate.

Independent exact-rational tests cover ties-to-even, cancellation, mixed signs,
overflow-cancelling products, subnormal results and signed zero. Re-evaluation
of the original captured inputs changes only diagnostic sums and declared method/
verifier metadata; all original objective/error/Armijo values remain unchanged.
Complete 80/100 comparisons now agree after excluding only declared precision.
Five old sums that agreed at both precisions were also incorrectly rounded and
are corrected. Original proofs and their failed equality gate remain preserved.
This is an oracle diagnostic correction, not another physics run or solve acceptance.

## Named runtime candidate and unchanged law

`membraneArithmetic:'double-double'` selects two-word evaluation. Omission and
explicit `binary64` retain the old option, configuration, snapshot/stat shape
and arithmetic. World selection requires the existing explicit orthotropic
research law and `lineSearchArithmetic:'membrane-inertia-increment'`, so the
same all-free exact-Y=0/no-external-force/no-contact runtime domain is enforced.
Independent element tests can examine arbitrary 3D covariance without widening
that World domain.

The stored alpha 1/2, beta1/2, material Q, reference UV, triangle connectivity,
volume, physical masses and timestep are unchanged. Tangents remain the real
stored-coefficient difference-form polynomial. Its node0 derivative is the
coherent real negative sum of node1/node2 coefficients. No rest force, prestress
or reference metric is subtracted to manufacture equilibrium. Independent
UV/material meaning is measured separately; rounded reference coefficients
need not make those meanings identical at native rest.

TwoDiff coordinate low words survive tangent, Green strain (including subtraction
of one), stress, nodal gradient, energy and GN evaluation. Global nodal gradients
are accumulated in two words before the public binary64 output. The exact stress
curvature remains separate from the PSD GN search operator. Sparse assembly and
matrix-free products share this arithmetic and native free-DOF mapping.
Flat typed-array work buffers permit independent observer shadows; no nested
mutable precision scratch is shared with the solver.

The selected search also carries TwoDiff endpoint changes through slope,
membrane remainder and inertia remainder. The inertia coefficient is the exact
native stored binary64 value M*(1/(h*h)), with the original intermediate rounding.
It is not replaced by high-precision real M/h². The World predictor, velocity,
authoritative absolute positions and native full inertia-gradient arithmetic
are unchanged. The two-word scalar terms are combined before the reported
binary64 increment; high/low diagnostic words remain visible.

This is a declared evaluation-chain comparison, not causal isolation of only
base-gradient changes. Armijo c1=1e-4, maximum 20 halvings, iteration/PCG budgets,
zero-step decisions and literal endpoint force thresholds remain unchanged.
Approximate two-word evaluation and final public gradient/native inertia rounding
still do not certify real descent or representable equilibrium.

## Arithmetic domain and identity

[Ogita, Rump and Oishi (2005), sections 3–5](https://www.tuhh.de/ti3/paper/rump/OgRuOi05.pdf)
provide the TwoSum and split TwoProduct foundation using ordinary working-
precision operations. The implementation uses fixed operation order and no FMA
or alternate precision fallback. Each nonzero multiplication argument, including
cross-word arguments, must lie in [2^-450,2^450]. Split components lie on at least
a 2^-502 lattice, so nonzero internal split products are at least 2^-1004 and stay
normal; maximum products and splitter operations remain finite. Unsupported
ranges fail explicitly without flushing low words. Two-word polynomial arithmetic
remains rounded; the primitive identity does not imply universal correct rounding.
Historical paper timings do not measure Pliego or close its 8 ms target.

Configuration binds name/version, product-exponent bound, coherent derivative
and TwoDiff displacement convention in the existing snapshot membrane signature.
Restore checks current option/work/config arithmetic identity before any state
or factor writes, independently of the destination pose being replaced.

## Predeclared numerical and trajectory checks

At retained event 49 (level 4/I4/predictor start, iteration 963), require projected
slope error no greater than 1e-27 nJ against the independent stored-coefficient
truth with unchanged native inertia. Reproduce the native baseline gradient
bit-exactly first. The old alpha 1 proposal has positive real potential change;
the new search must reject that first proposal, with any eventual accepted
smaller endpoint independently judged. This frozen witness does not establish
all-trajectory solve convergence.

The same 24 native modal trajectories retain A=.004 mm, physical material/mass,
refinements 1/2/4/8, budgets 1/4/16, both starts and common physical horizon. Compare
source-identical binary64 and two-word evaluation under the same increment
search. Require strict candidate repeat and observer/no-observer parity; compare
unchanged native states, references and budgets, while retaining changed initial
energy/gradient/metric evaluations as outcomes. Keep every numeric force failure.

The literal criterion remains

    max_coordinate |gU + M/h²*(x-xt)| <= max(1e-7 microN,1e-10 F0),
    F0=A*omega²*max_i(nativeMass_i*norm(phi_i)).

No ULP allowance, material rescaling, hidden Newton repetition or ideal trajectory
injection supplies a passing solve. Complete time acceptance also needs amplitude/
budget isolation, expected error trend and broader geometry coverage. Bending,
crease/join/hand/contact/friction support, measured stocks, richer coordinate
representations, alternative formulations/backends and fixed-booklet/device
acceptance remain part of the active campaign.

## Clean-source outcome and remaining limits

Source [`e96c592`](https://github.com/madfam-org/pliego/commit/e96c592ea6d56c47dfbddaaaa447d2c9655b6223)
completes both 24-trajectory captures, a strict candidate repeat and observer
ablation. [Complete lossless captures and independent proofs](evidence/membrane-double-double-2026-11-10/README.md)
retain every failed step. The fresh binary64 report matches the prior 6cd
increment-search capture exactly after excluding only source/recording metadata;
a separate complete constitutive run preserves all 108 historical spring controls.

| Evaluation | Force failures /7110 | Trajectories solved throughout /24 |
|---|---:|---:|
| Binary64 increment search |6973 |0 |
| Two-word evaluation chain |6956 |0 |

There are 49 newly passing steps and 32 lost prior passes: a net gain of 17.
Only the coarsest refinement changes its count (337→320 failures of 474); every
poststep at refinements 2/4/8 still fails. All 49770 observed DD Newton events
are accounted for: 13332 computed accepted updates and 36438 precision-limited
zero steps. This does not establish trajectory convergence. Maximum normalized
discrete full-state error remains about 0.043004%; whole continuous-time accuracy
is unaccepted. These are untimed experiments, with no new interaction certificate.

Independent fixed-pose evaluation binds 85 archived poses in both modes,
170 actual native evaluations with no stepping/solving. Raw repeat bytes agree.
All 42502 parsed 80/100-digit proof leaves agree after excluding only the declared
precision field; 29240 LE binary64 entries and native inertia/addition associations
are independently verified. Stored-polynomial energy, elastic-gradient and full
incremental-gradient component errors improve at all 85 poses:

| Maximum absolute error over 85 poses |Binary64 |Two-word |
|---|---:|---:|
| Elastic energy, nJ |3.92882e-9 |4.08772e-13 |
| Elastic gradient component, microN |2.19610e-6 |4.61901e-11 |
| Full incremental gradient component, microN |2.19644e-6 |9.19009e-9 |

Native inertia is unchanged; its maximum error against real stored M/h² remains
5.59347e-9 microN. The frozen 49 stored-law slope error is 1.61013e-29 nJ against
the predeclared 1e-27 target, versus 1.07850e-24 before. The old real-increase
proposal backtracks. These evaluation gates do not accept a World trajectory.
Independent UV/material projected-slope error improves at 59 poses, is unchanged
at 16 zero-direction poses and worsens at 10: that meaning remains distinct.

All 104 retained DD event roles deduplicate to 86 event IDs (59 accepted,
27 precision-limited). Direct before/after energies at 80/100 digits agree over
all 5334 parsed leaves, with 10148 lossless inputs checked. Among ONLY those
59 retained accepted events, no stored-polynomial real Armijo failure is found.
Two UV/material real increases of 4.1974630190980565e-25 nJ occur at the same
physical state in two event IDs (level 2, budgets 4/16, predictor start,
substepsRun 78). This is not a descent audit over all 13332 computed acceptances,
and the changed sampled trajectories are not a matched frequency comparison
with the old 69-event sample.

The 32 native-rest DD probes have 16 computed acceptances and 16 rejections.
All 16 accepted endpoints pass the stored-polynomial real Armijo check, while
all 16 increase the UV/material potential at native rest. Complete 80/100 proofs
agree over 1986 leaves. This preserves the rounded-reference/model distinction;
more accurate evaluation does not silently redefine physical rest geometry.

All 16 source CI checks pass, including 259 engine/123 web tests, 49 checked sources
and 102 package files (49 source/49 type files, 663907 bytes unpacked and 206498 packed).
Repository validation is separate from the unaccepted physics gates above.
The next precision comparison must address authoritative coordinate representation
and reference meaning while retaining these failures, literal force thresholds,
physical inputs and the broader material/contact/booklet/device campaign.
