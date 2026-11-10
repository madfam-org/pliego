# Research orthotropic triangle membrane

Status: opt-in implementation checkpoint. Targeted element/operator/replay tests,
independent oracle self-tests, types and package checks pass. Clean-source full
matrix/repeat results and default booklet parity remain pending at this checkpoint.
No new-law development-run number is accepted evidence here. This is not a stable
catalogue physics release, an 8 ms result or measured-paper calibration.

The [accepted scalar-spring audit](membrane-constitutive-audit.md) retains the
uncapped tensor failure and C12=C66 restriction. The new law is a separately named
coupled triangle experiment; historical scalar-spring controls and reader defaults
remain available. A different constitutive model should change physical response,
so same-model replay and independent accuracy checks replace any expectation that
new-law trajectories equal old-law trajectories.

## Explicit constructor contract

For a supported single-sheet document, select the research law explicitly:

```js
const world = new World(document, {
  membraneModel: 'orthotropic-stvk',
  physicalMembrane: true,
  membraneCompression: 1,
  membranePoissonConvention: 'nu12',
  membraneNu12: [0.293], // explicit synthetic nu12 for each sheet, in sheet order
  membraneCurvature: 'gauss-newton',
  membraneProjection: 'none',
  lineSearch: true,
  plasticity: false,
  contact: false,
  ground: false,
  gravity: false,
});
```

The example's Poisson value is synthetic. Supply one explicit nu12 per sheet;
the engine does not reinterpret the stock nu field. The stock/bending geometric-
mean Poisson convention remains a separate unresolved issue. Positive finite
E1/E2/G12/thickness and reciprocal positive-definite Q are required. No scalar
stiffness cap or legacy .05 edge compression rule is silently applied to the new
coupled energy. The old `consistentMembraneCurvature` option must be omitted;
the research curvature is explicitly named instead. Unused research metadata on
an edge-spring world and incompatible research options are rejected.

Supported initial documents contain one or more individually planar, uncreased
sheets, possibly at different 3D rigid orientations. Authored crease/set angles,
perforations, joins, controls, mechanisms, kinematic sheets, plasticity and hand
drives are outside this initial domain. Elastic deformation can subsequently be
three dimensional; this is not permission to claim validated bending or folded
booklet behavior. Contact/ground require the coupled barrier path; positional
contact projections are not an alternative. Tests cover small ground-support and
sheet-contact cases under the supported paths, not general convergence.

## Energy, derivatives and solver integration

The material reference is authored sheet UV, with grain measured counterclockwise
from +u. A 3×2 deformation gradient F maps the reference tangents into world space.
Green strain is E=(FᵀF−I)/2. In material axes, engineering strain is
`e=[E11,E22,2E12]`, and energy is `.5*A*t*eᵀQe`, where Q is the declared reciprocal
plane-stress matrix. Q12 is independent of Q66; the scalar-spring restriction is
absent from this formulation. No physical parameter is rescaled to obtain it.

Energy and force gradient are exact derivatives of this declared StVK energy.
The exact element Hessian includes a geometric stress term and can be indefinite
under compression. It is independently checked by finite differences. Runtime
assembly and matrix-free multiplication explicitly use the PSD Gauss–Newton
approximation JᵀQJ; they do not pretend that approximation is the exact Hessian.
Mass/dt² remains additive. Sparse slot/transposition and fixed-DOF tests compare
assembled elastic/current-local operators against matrix-free products.

The selected model is used by the actual implicit objective, gradient, PCG,
direct-local coupled operator and `stats().energy.stretch`. The edge-spring
membrane is not counted a second time. Research stats include principal stretches,
area ratios, model/convention and separately labeled legacy edge strain values.
The legacy post-elastic projection pass is omitted under the explicitly required
`membraneProjection:'none'`; no strain/inversion barrier replaces it in this phase.
Factor directions remain geometric, while triangle operators evaluate the current
pose. Snapshot identity covers model, UV/connectivity, material and Poisson
convention; incompatible restoration rejects before mutating state. Targeted
ordinary and active-contact World tests replay positions, velocities and diagnostics.

Reference triangles must be CCW and pass a scale-aware conditioning threshold.
Current finite area ratio must exceed 1e-12; invalid trial energy is Infinity so
line search can backtrack, while invalid derivative requests fail visibly. No
fixed-normal-sign test is used: a legitimate 180-degree rotation remains valid.
These endpoint checks do not prove that an interpolation/search path avoided
collapse. StVK has no built-in strain barrier and is not a credible arbitrary
large-compression material law. Its intended first scope is small material strain
with potentially large rigid rotations.

## Independent verification and pending acceptance

`orthotropic-reference.py` uses a separate standard-library matrix formulation:
F=Ds*Dm⁻¹, material-frame Green strain, second Piola stress and P=F*S before
assembling nodal gradients. It imports no engine or prior linear-CST oracle.
Its self-tests cover analytical affine Green energy/Piola boundary reactions,
non-affine 3D finite differences with step halving, finite rigid-motion covariance,
force/moment balance, scaling, small-strain linear limits and invalid domains.
The Python and JS reference/current conditioning domains are declared separately;
ordinary supported-input agreement does not establish identical rejection boundaries.

The new audit keeps the full scalar controls and unchanged independent linear-CST
1% tensor/energy, strain-halving, mesh and topology thresholds. Actual rounded
positions are independently evaluated by the finite-Green oracle at every
amplitude. Near-rest metric-subtraction roundoff has a separate predeclared 1e-7
energy/gradient agreement threshold; it does not replace the physical 1% gates.
Finite-rotation checks retain their dimensional normalization/floors. The clean
full matrix, strict same-source repeat, reviewed old-control migration and fresh
default booklet parity must be retained before quantitative acceptance is added.

```sh
python3 packages/engine/bench/orthotropic-reference.py --self-test
node --test packages/engine/test/orthotropic-element.test.js packages/engine/test/orthotropic-world.test.js
node packages/engine/bench/orthotropic-audit.mjs --out /tmp/pliego-orthotropic-run.json
node packages/engine/bench/orthotropic-audit.mjs --out /tmp/pliego-orthotropic-repeat.json
node packages/engine/bench/compare-orthotropic-audit.mjs /tmp/pliego-orthotropic-run.json /tmp/pliego-orthotropic-repeat.json --out /tmp/pliego-orthotropic-comparison.json
```

A prescribed-pose constitutive pass would still leave an independently solved
non-affine FE boundary problem, controlled time/iteration convergence, membrane
locking/bending, crease/join/hand support, contact/strain limits, measured stocks
and new-model booklet/device acceptance open. It cannot certify full-shell
accuracy, fastest abstraction or exhausted research.

## Primary sources and attribution limits

[FEBio's theory manual](https://febiosoftware.github.io/febio-docs/theory/chapter5/5.2-compressible-materials/#orthotropic-elasticity)
provides objective Green-strain StVK/orthotropic model context and cautions against
large material strains. [Bleyer's plane-stress formulation](https://bleyerj.github.io/comet-fenicsx/tours/linear_problems/isotropic_orthotropic_elasticity/isotropic_orthotropic_elasticity.html)
supports reciprocal Poisson constants, engineering shear and frame transformation.
The native element and independent reference formulas are derived here; neither
is a reproduced FEBio shell or a calibrated paper model.

[C-IPC §3–4 and §6.1](https://ipc-sim.github.io/C-IPC/file/paper_small.pdf) combines
orthotropic StVK or other membrane models with bending and separate constitutive
strain limits, and investigates membrane locking. Sharing a membrane model does
not transfer its contact, strain-limit or injectivity guarantees to Pliego.
No third-party implementation was copied.
