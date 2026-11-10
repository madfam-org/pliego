# Independent membrane constitutive audit

Status: reproducible synthetic accuracy failure, not a material-model acceptance.
The [clean run, repeat and strict comparison](evidence/paper-2026-11-10/README.md#independent-membrane-tensor-audit)
use source `f145538f8200563ff110439f006605882050d2ba`. All 36 uncapped,
symmetric-compression cases fail the declared 1% tensor gates despite passing
oracle, measurement, strain-extraction and exact-repeat checks. This changes no
runtime law, stock values, defaults or booklet interaction.

`physicalMembrane: true` removes the stiffness cap on scalar edge springs. It
does not implement a coupled orthotropic triangle membrane. An axial-strip
response, converged force residual or bit-exact JS/Wasm replay cannot establish
correct Poisson coupling and shear. This audit measures those missing components
independently of solver and backend performance.

## Declared synthetic reference

The pure-standard-library Python CST reference consumes only immutable mesh
coordinates/connectivity, prescribed displacements, thickness and declared
engineering constants. It imports no engine material functions, spring weights,
mesher, solver or integrator. Triangle shape gradients produce linearized strain;
strain rotates into material axes and stress rotates back before assembling
energy and its nodal gradient. The implementation is independently derived.

The convention is engineering strain `[exx, eyy, gamma=2exy]`, with synthetic
`E1=5.5e9`, `E2=2.5e9` microN/mm² (numerically Pa), `t=.1 mm`,
`G12=.387*sqrt(E1*E2)`, **nu12=.293**, and `nu21=nu12*E2/E1`.
The reciprocal plane-stress compliance is
`S=[[1/E1,-nu12/E1,0],[-nu12/E1,1/E2,0],[0,0,1/G12]]`; `Q=inverse(S)`.
Energy is `U=.5*t*A*eᵀQe` in material axes. Engineering shear requires
`U=.5*t*A*G12*gamma²` under material-frame pure shear.
[Bleyer's author-maintained formulation](https://bleyerj.github.io/comet-fenicsx/tours/linear_problems/isotropic_orthotropic_elasticity/isotropic_orthotropic_elasticity.html)
supports the compliance, reciprocal Poisson relation, shear convention and frame
rotation. [Abaqus' plane-stress documentation](https://docs.software.vt.edu/abaqusv2026/English/SIMACAEMATRefMap/simamat-c-linearelastic.htm)
independently specifies G12 and requires positive material stiffness. No Abaqus
or FEniCS reproduction or external FE runtime is claimed.

| Material-frame entry | Target (GPa) |
|---|---:|
| Q11 | 5.723338 |
| Q22 | 2.601517 |
| Q12 | .762245 |
| Q66 | 1.435034 |
| Q16, Q26 | 0 |

This is a declared synthetic constitutive target, not measured stock data. The
current directional membrane compliance uses `-2*nu/E1`, consistent with nu12.
Stock provenance instead names nu as `sqrt(nu12*nu21)`, and the bending fallback
uses `D12=nu*sqrt(D11*D22)`. Those meanings differ for anisotropic E1/E2. The audit
records this ambiguity rather than changing the schema, stock convention or
material law to improve a score.

## Predicted scalar-spring restriction

This derivation follows the current engine energy. For an unstressed edge of
length L and unit direction `(nx,ny)`, a small symmetric affine strain produces
`deltaL=L*(nx²*exx+ny²*eyy+nx*ny*gamma)`. With equal tension/compression stiffness,
its quadratic energy contributes `k*L²/(A*t) * v*vᵀ` to the effective tensor,
where `v=[nx²,ny²,nx*ny]`. Consequently **C12=C66**: both sum the same weighted
`nx²*ny²` terms. This holds in any coordinate rotation, regardless of scalar
weights, edge directions, cap or refinement, in the stress-free affine limit.

A general orthotropic plane-stress Q independently specifies Q12 and G12. Here
Q12/Q66=.531168, so this scalar central-force class cannot reproduce the full
chosen target. Refinement or a lower execution abstraction cannot remove that
restriction. Layout and quadrature errors are additional questions, measured
separately below.

## Measurement and independent validity checks

The all-node prescribed-pose audit uses a 40×40 mm flat patch, three authored
triangular patterns (forward diagonals, alternating diagonals and deterministic
interior perturbations), 4×4/8×8/16×16 cells and grain angles 0/30/45/90 degrees.
Every face is authored explicitly, and `meshEdge=100 mm` prevents new lattice
vertices. Actual native coordinates, connectivity, orientation, face ownership
and counts are verified; topology/rest-pose hashes remain fixed across grain
and policy. Grain is counterclockwise from sheet +u; `(u,v)` maps to world
`(u,0,-v)`. Output gradient is dU/d(u,v); physical internal force is its negative.

The three policies are uncapped/compression=1, uncapped/compression=.05, and
capped/compression=1: **108 engine cases**. The shipping combined cap+.05 policy
is not measured by this matrix. The asymmetric .05 policy retains separate signed
energies and has no extracted unique zero-strain tensor. Solver compression
curvature/hysteresis is distinct from the actual compressed energy branch.

Each case retains 18 signed strain modes at `h=1e-4,5e-5,2.5e-5`, plus zero
poses: **5832 nonzero engine observations**. There is no World.step, substep,
elapsed simulation time, contact, gravity, ground, plasticity, driver or join.
Prediction equals each observed pose, making inertia zero. Temporarily zeroing
membrane stiffness proves non-membrane implicit energy is zero. The actual
implicit objective agrees with the stats energy; the actual gradient has separate
finite-difference tests. These are prescribed energy/reaction observations,
**not a solved boundary-value patch test**. [Sandia's patch-test definition](https://www.sandia.gov/files/sierra/SM_Theory_5_30/main/element_basics.html)
requires a boundary-value problem with a constant-strain solution.

For each of 36 unique mesh/grain combinations, Python evaluates 19 nominal
affine cases at h0 (zero plus 18 signed modes) and independently evaluates all
54 actual applied binary64 displacement vectors: **2628 CST evaluations**.
No finer-amplitude reference scaling is used. Nominal energy and independently
integrated boundary traction must pass the unchanged 1e-10 analytic tolerance
before engine accuracy is judged. Coordinate addition/subtraction can make actual
applied fields slightly nonaffine; actual-versus-nominal drift is recorded rather
than treated as an oracle inconsistency. Engine and reference receive the same actual
rounded displacement input at every amplitude.

The reference self-test passes 144 arbitrary affine/mesh/orientation combinations,
18 coordinate finite differences, material/rigid/shear/CLI checks and 20 rejected
invalid inputs. Full nominal-affine maximum relative errors are 9.47e-16 in energy
and 7.18e-15 in boundary gradient. Actual-versus-nominal drift reaches 4.89e-12 in
energy and 5.28e-10 in gradient; it is separate from that strict oracle gate.
Maximum actual stats/objective energy discrepancy is 5.08e-15 relative, beneath
the separate scaled 1e-12 roundoff-agreement guard. Neither the oracle tolerance
nor the 1% engineering thresholds was loosened.

Symmetric-policy tensors use signed central energy differences divided by A*t.
Diagonal differences divide by h²; mixed plus/minus differences divide by 4h².
Both consecutive h-halving intervals pass relative tensor and entry-scaled drift
checks: maxima 8.46e-10 and 6.97e-10 against 1e-4. The central-force invariant uses
`abs(C12-C66)/norm(C_measured)`, with maximum 3.62e-11 against 1e-4. Source and
runtime/input fingerprints remain fixed; the repeat checker removes only
`recordedAt` and requires every other report field to agree exactly.

## Accuracy failures retained

| Policy (36 cases each) | Relative tensor Frobenius error | Per-case worst signed energy error |
|---|---:|---:|
| Uncapped, compression=1 | 14.08–29.78% | 46.08–60.89% |
| Uncapped, compression=.05 | No unique zero-strain tensor | 95.36–98.02% |
| Capped, compression=1 | 97.88–98.52% | 99.06–99.23% |

Tensor error is the ordinary Frobenius norm of the full **engineering-Voigt matrix
in global axes**, divided by the corresponding target norm; this matrix norm is
not rotation invariant. Entry error divides by `sqrt(Qii*Qjj)`, including for
zero off-diagonal targets. Every symmetric case fails both 1% tensor gates, and
every case fails its maximum-signed-energy 1% gate. Twelve individual uncapped
symmetric observations happen to pass; they do not establish the full tensor.
The cap control's large stiffness error and the asymmetric compression policy
remain distinct from the uncapped symmetric constitutive failure.

At cells16, grain0 and h=2.5e-5, the uncapped symmetric tensors show:

| Mesh | C11 | C22 | C12 | C66 | C16 | C26 | Tensor error |
|---|---:|---:|---:|---:|---:|---:|---:|
| Forward | 4.693770 | 2.443770 | .568770 | .568770 | .568770 | .568770 | 27.38% |
| Alternating | 4.693770 | 2.443770 | .568770 | .568770 | ≈0 | ≈0 | 21.14% |
| Perturbed | 4.646877 | 2.432052 | .590876 | .590876 | −.003994 | .001751 | 21.41% |

Entries are GPa. The forward layout creates extension/shear coupling where the
grain0 target has none. Alternating diagonals cancel aggregate C16/C26 but leave
C66 about 60.37% below target; the scalar C12=C66 restriction remains. Positive
measured eigenvalues do not establish constitutive accuracy.

All 24 last-level mesh-refinement comparisons fail the .5% limit, with changes
of 6.88–8.74%. Eighteen of 24 finest-mesh topology comparisons fail the 1% limit;
changes span .78–26.37%. Thus **42/48 comparisons fail**. The source weights each
triangle's boundary-edge contribution three times its per-adjacent-triangle
interior-edge contribution. Boundary density changes under refinement, providing
a concrete contributing mechanism, but no reweighting ablation here uniquely
attributes the full measured discrepancy. Scalar reweighting would still retain
C12=C66.

Local forces reveal another distinction. The largest uncapped-symmetric interior
gradient L2/reference-gradient norm is .6442 on a perturbed mesh. In that case
maximum engine interior-node gradient is 19469.8 microN versus 7.30e-6 microN for
the same rounded input in the reference. Regular layouts can have nearly zero
interior residual while retaining wrong boundary reactions and tensor response.
This is discretization imbalance under prescribed poses, not a failed dynamic
solve. No time-integration error is present in this audit.

## Reproduction and next gate

From clean pinned source, write reports outside the checkout:

```sh
python3 packages/engine/bench/membrane-reference.py --self-test
node --test packages/engine/test/membrane-patch.test.js packages/engine/test/membrane-tensor.test.js
node packages/engine/bench/membrane-audit.mjs --out /tmp/pliego-membrane-run.json
node packages/engine/bench/membrane-audit.mjs --out /tmp/pliego-membrane-repeat.json
node packages/engine/bench/compare-membrane-audit.mjs /tmp/pliego-membrane-run.json /tmp/pliego-membrane-repeat.json --out /tmp/pliego-membrane-comparison.json
```

The [evidence record](evidence/paper-2026-11-10/README.md#independent-membrane-tensor-audit)
retains both complete reports. Development dirty reports are not accepted evidence. Passing validity and exact
repeat makes this failure reproducible; it does not make the material model pass.

A research-only coupled per-triangle orthotropic membrane law is the next bounded
model experiment, with an explicit material convention, independent energy/
gradient/curvature checks and the same tensor audit. An independently solved
non-affine boundary problem, controlled timestep/iteration convergence, physical
stock measurements and booklet/device interaction remain owed before a default
or stable catalogue physics change. Backend performance and the 8 ms target
remain separate gates.
