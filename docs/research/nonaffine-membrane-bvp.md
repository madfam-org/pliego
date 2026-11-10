# Independently solved non-affine membrane boundary problem

Status: **accepted source/results pending**. This implemented research stage has
predeclared gates and retained development failures. Clean source-pinned full
run/repeat/ablation evidence is required before quantitative acceptance.

The question is whether the actual research orthotropic-StVK membrane, minimized
to a declared exact-gradient static residual, approaches an independently solved
linear plane-stress problem as load decreases. The earlier prescribed-affine
constitutive audit supplies every displacement; this experiment solves for the
unknown field and constrained reactions. It remains a synthetic **2D static BVP**,
not a timestep, buckling, physical-paper, new-law booklet or device certificate.

## Boundary problem and immutable inputs

The reference domain is a 40×40 mm rectangle. Both displacement components are
fixed exactly at every left-edge node. Uniform horizontal dead traction acts on
the entire right edge; the top and bottom are traction free. For a boundary
segment of reference length L, each endpoint receives horizontal force t*T*L/2.
This is fixed-direction reference loading, not follower pressure. Corner nodes
receive their one half-segment contribution without duplication.

Nonzero Poisson contraction conflicts with the full left clamp, producing the
intended non-affine problem. A separate aligned-grain Poisson-compatible control
fixes left-edge horizontal displacement and one lower-left vertical anchor. Its
nearly affine response is a scope control and cannot replace the full clamp.
Both fields receive an independent best-affine-fit measurement.

The synthetic material remains E1=5.5e9, E2=2.5e9 microN/mm², t=.1 mm,
G12=.387*sqrt(E1*E2), explicit nu12=.293 and nu21=nu12*E2/E1. Stock/bending
Poisson-convention ambiguity remains unresolved. No stock values, stiffness
scaling or reader defaults are changed by this experiment.

Load amplitudes eta=1e-4,5e-5,2.5e-5 set T=eta*E1. Three deterministic authored
triangle layouts and grain angles 0/30/45/90 use identical native topology across
material rotations. The initial cells2/4/8 matrix contains 54 geometries and
162 load cases, including separately labeled compatible controls. Higher
refinement is a bounded follow-up; a same-mesh pass cannot establish convergence.

A separately named `--load-window fourfold` studies eta=4e-4,2e-4,1e-4 against
the unchanged `--load-window base` values above. This measures the numerical-
resolution/finite-strain window with identical materials, accuracy thresholds
and residual-threshold formula. The realized absolute residual bound still
follows its declared nodal-load scale. Base-window failures must remain retained;
the separate window cannot overwrite or relabel them. No fourfold result is
claimed at this checkpoint.

Mesh coordinates/connectivity, material, constructor options, force vectors and
hard constrained DOFs are fingerprinted. Every load starts from zero displacement
independently. The oracle's displacement is never used as an initial guess, and
no unlabeled load continuation supplies the numerical answer.

## Independent linear plane-stress solve

`plane-stress-reference.py` is pure standard-library Python, with no engine,
other oracle, spring, StVK, runtime matrix or runtime solver imports. It computes
linear shape gradients, rotates the reciprocal engineering plane-stress Q and
assembles each triangle's stiffness t*A*BᵀQ*B in sheet displacement coordinates.
Hard zero Dirichlet DOFs are eliminated rather than approximated with penalties.

A deterministic partial-pivot LU solves the reduced system. Lowest-index ties,
pivot thresholds, factor inputs and factor hashes are explicit. One normalized
load solution is scaled for the linear eta values, while residual, energy, work
and reaction checks are evaluated independently for every scaled result. This
linear reuse is reported and is not counted as independent nonlinear solves.

Before judging runtime, require positive material/areas, complete triangle/node
and boundary coverage, exact load/clamp agreement, matrix symmetry and acceptable
pivots. Check free residual, global force/moment balance, 2U=f·u, element versus
assembled energy/gradient, zero load and linear scaling. Retain the independent
affine and analytical compatible-control self-tests as separate oracle evidence.

The weak form, reciprocal compliance and engineering shear convention follow
[Bleyer's author-maintained plane-stress formulation](https://bleyerj.github.io/comet-fenicsx/tours/linear_problems/isotropic_orthotropic_elasticity/isotropic_orthotropic_elasticity.html).
No FEniCS, Gmsh or solid-modeling dependency is introduced. [Sandia's element
patch-test discussion](https://www.sandia.gov/files/sierra/SM_Theory_5_30/main/element_basics.html)
distinguishes prescribed affine consistency from a solved boundary-value problem;
the clamp case here must retain its measured non-affinity.

## Actual runtime membrane in a planar static subspace

The JS benchmark constructs a real explicitly selected orthotropic World, then
uses its actual implicit objective, exact gradient and membrane GN block routine.
Prediction equals each observed pose, making inertia exactly zero. Suppressing
only the selected membrane verifies zero remaining objective; the full elastic
gradient must equal the selected-law gradient. Gravity, contact, joins, drives,
plasticity, damping, timesteps and sleep do not enter the solved problem.

Sheet displacement [du,dv] maps to world [du,0,-dv]. Restrict the assembled runtime
blocks **before** solving: H_uv=[[H_xx,-H_xz],[-H_zx,H_zz]]. The unregularized flat
3D membrane has zero out-of-plane static GN modes; do not add mass, epsilon normal
stiffness, bending, springs or extra pins to factor that different problem.
The benchmark's hard clamp does not implement authored runtime join support.

For Pi(u)=U_runtime(u)-f·u, each iteration uses the exact free residual g-f, a
current runtime GN matrix and a bounded Armijo search. GN is the named PSD search
approximation, not the exact finite-strain Hessian. The reduced linear direction
must pass its own residual check. Iteration exhaustion, rank failure, non-descent,
invalid trial geometry, rejected search and precision-limited steps remain visible.

Convergence requires the final exact free residual, not a fixed iteration count,
sleep state or relaxed physical stiffness. Independent acceptance validation
recomputes free DOFs, force scale/tolerance, gradient-minus-load residual,
constrained reactions, load work and the declared Armijo condition. It checks
live World positions/clamp/planarity, trace continuity and counter totals.
Finite nonconvergence may be valid diagnostics but can never become a convergence
pass. Reports retain every direction solve, slope, actual step and backtrack.
Current-position moment balance is used for nonlinear runtime reactions; the
infinitesimal oracle uses reference positions, with both conventions explicit.

## Retained numerical-globalization failure

`total-potential` remains the raw Armijo control. The candidate changes only its
numerical evaluation of the objective increment; it does not change material,
loads, constraints, starting pose, solver budget or physical accuracy thresholds.
Both modes run from the same pinned source for the accepted ablation.

Development traces exposed backtracking stagnation near equilibrium: the
predicted GN decrease can be far smaller than roundoff in separately evaluated
U-f·u. One dirty smoke witness reached 100 accepted tiny steps and iteration-limit,
with zero rejected line searches. It must not be described as “100 rejected
searches.” Final documentation must retain the accepted control's actual counts
and traces, including failures, rather than promoting this witness to acceptance.

## Stable increment of the same declared energy

For material tangents a,b and actual position change deltaX, form deltaA/deltaB
from the realized binary64 nodal changes. Subtracting two separately rounded
deformation gradients would discard the small change again. For engineering
Green strain e=[(a·a-1)/2,(b·b-1)/2,a·b], stress s=Qe and V=A*t:

```text
deltae = [a·deltaA + .5|deltaA|²,
          b·deltaB + .5|deltaB|²,
          a·deltaB + b·deltaA + deltaA·deltaB]
DeltaU = V*(s·deltae + .5*deltaeᵀQdeltae)
```

To avoid subtracting large linear internal-energy and dead-load increments,
regroup the potential change around the old residual:

```text
R = V*(.5*s1|deltaA|² + .5*s2|deltaB|²
       + s6*deltaA·deltaB + .5*deltaeᵀQdeltae)
DeltaPi = (g_old-f)·actualDeltaX + R
```

Compensated sums retain small terms. The candidate requires a nonzero realized
step and negative actual residual-dot-step; Armijo uses this actual first-order
term. Traces retain raw/stable potential changes, direct energy-minus-work,
nonlinear remainder, nominal/actual slopes and arithmetic allowances.

The identities are exact for the declared real StVK polynomial. They are not
bitwise identities between two separately rounded energy() calls. Base strain
still carries floating-point error. The term-scaled 64*EPS allowance is an
arithmetic diagnostic, not a rigorous interval bound or universal descent proof.
An apparent raw-total increase must remain inspectable rather than hidden.

The stable policy is used **only by this bench static solver**. World timestep
Armijo and its existing actual energy/gradient/GN arithmetic remain unchanged.
Adding an increment primitive does not certify a new dynamic solver or alter
shipping booklet behavior.

## Independent high-precision increment check

The element test directly subtracts before/after energy at 100 Decimal digits.
`Decimal.from_float` treats actual binary64 poses and cached alpha/beta/Q/volume
as exact constants; the oracle does not reuse the increment identity. This
isolates increment arithmetic, not material calibration or coefficient creation.
Independent UV/material F/S/P tests remain the separate element-model proof.

There are nine internal-increment cases across three grains and perturbation
sizes 1e-8/1e-10/1e-11. Six cases with h>=1e-10 also check tiny Newton-potential
change signs and decision/error margins. The smallest perturbation is not
silently counted as a verified potential-decision case. Retain actual absolute/
relative errors and minimum margins from final test proof. These selected cases
are not a theorem about arbitrary conditioning, global convergence or path safety.

## Separate gates and interpretations

| Gate | Predeclared requirement |
|---|---|
| Oracle validity | Exact free-residual threshold; scaled balance/work/energy <=1e-10; complete constraints/loads and independent self-tests |
| Runtime convergence | max free abs(g-f) <=max(1e-7 microN,1e-10*maximum nodal Euclidean load); exact clamp and world-y values |
| Same-mesh accuracy | Finest-load displacement L2, max nodal error, elastic energy and full constrained-reaction vector errors <=1% |
| Small-strain separation | Last eta-halving changes in u/eta and U/eta² <=.1%; reaction/eta change separately reported |
| Non-affine scope | Converged clamp/reference best-affine residual >1e-3; aligned reference control <=1e-10 |
| Refinement/topology | Common-grid field, energy and mean extension changes <=1%; failures retained |

Displacement L2 is area-lumped, with absolute norm in displacement*sqrt(area)
and a separately reported RMS in mm. Its denominator uses reference L2 with
the explicit tiny floor eta*patch-span*1e-12, not the full characteristic
displacement. Maximum nodal error has its own reference-maximum normalization.
Reaction comparison uses the entire constrained vector, not only its total.

The best affine fit is all-node least squares with centered/scaled coordinates
and explicit rank rejection. Its residual is a scope measurement, not a material
quality score. Nonconverged fields may retain diagnostics but cannot pass the
same-mesh numerical-accuracy gate.

Nonnested mesh fields are interpolated onto the same 33×33 UV grid. CCW
barycentric containment uses the lowest authored triangle on shared-edge ties,
with a declared roundoff band and no nearest-node outside fallback. The resulting
sampled displacement RMS is distinct from FE area L2. Reference and runtime
refinement are measured separately; matching a coarse oracle is not convergence.
Pointwise maximum-stress convergence is not claimed by this stage.

An invalid oracle invalidates comparison. Failed exact residual is numerical
nonconvergence; eta dependence is finite-strain behavior. A same-mesh small-load
mismatch after convergence points to model/assembly/boundary mapping, while
refinement sensitivity is discretization. There is no timestep error here.

## Provisional observations and acceptance still pending

Development cells2/4/8 runs complete 162 loads with convergence, same-mesh and
eta-separation gates passing under the stable policy, while two mesh comparisons
still fail. These are development observations only. They do not justify a
mesh-converged or accepted full-BVP claim. Further refinement is being evaluated
and can expose coordinate/force precision limits; no higher-resolution outcome
is asserted here. Accepted source/results remain pending.

## Reproduction and clean-source evidence

Commit the complete implementation/tests first. Run sequentially from the same
clean source, writing outside the checkout to fresh paths:

```sh
python3 packages/engine/bench/plane-stress-reference.py --self-test
node --test packages/engine/test/plane-stress-metrics.test.js
node packages/engine/bench/plane-stress-audit.mjs --max-cells 8 --load-window base --line-search total-potential --out /tmp/pliego-fe-control.json
node packages/engine/bench/plane-stress-audit.mjs --max-cells 8 --load-window base --line-search energy-difference --out /tmp/pliego-fe-run.json
node packages/engine/bench/plane-stress-audit.mjs --max-cells 8 --load-window base --line-search energy-difference --out /tmp/pliego-fe-repeat.json
node packages/engine/bench/compare-plane-stress-audit.mjs /tmp/pliego-fe-run.json /tmp/pliego-fe-repeat.json --out /tmp/pliego-fe-repeat-comparison.json
node packages/engine/bench/compare-plane-stress-audit.mjs --method-comparison /tmp/pliego-fe-control.json /tmp/pliego-fe-run.json --out /tmp/pliego-fe-method-comparison.json
```

To investigate the separate fourfold window, use fresh outputs and repeat the
same control/candidate/repeat sequence with `--load-window fourfold`:

```sh
node packages/engine/bench/plane-stress-audit.mjs --max-cells 8 --load-window fourfold --line-search energy-difference --out /tmp/pliego-fe-fourfold-run.json
```

The same-source method comparator keeps loadWindow/loadScales fixed. It must not
be used to relabel a cross-window change as only a globalization change.

The harness fingerprints runtime source, helpers, independent acceptance reducer,
comparator, oracle/self-tests, every engine JS test and the fixture builder,
alongside material/mesh/load/constraint inputs. Source hashes and clean status
must remain unchanged at exit; the report binds its actual checking tools.
A strict repeat removes only recording time and retains failed gates and traces.
The method ablation binds common inputs/tolerances while allowing solver outcomes
to differ. `--allow-dirty` is development-only and never accepted evidence.
Nonfinite failed states are explicitly labeled, not silently turned into null.

Static same-mesh agreement can close a bounded numerical gate while refinement
remains open. Controlled time integration, bending/locking, strain/path
feasibility, friction/contact, crease/join/hand coupling, measured paper,
new-model booklet and actual-device/8ms gates remain separate. Neither stable
increments nor a synthetic static solve establish an optimal abstraction or
exhausted physics research.
