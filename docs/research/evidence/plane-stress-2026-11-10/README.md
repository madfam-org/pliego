# Solved plane-stress membrane evidence — 2026-11-10

Clean implementation/measurement source:
[`9bbeb9f`](https://github.com/madfam-org/pliego/commit/9bbeb9faaacbf1fc48c11ba17c3dca422a3997f6).
The [method](../../nonaffine-membrane-bvp.md) defines the independent reference,
actual runtime statics, globalization controls and separate acceptance gates.
All eight captures and six comparisons complete; failures remain in the evidence.

The fourfold load window passes this bounded synthetic static protocol. The
original smaller-load base16 protocol retains 20 convergence failures. No result
here accepts physical stock, controlled time integration, bending/locking,
new-model booklet interaction, actual devices or an 8 ms physics budget.
Stable objective increments change only the bench static search; World timestep
Armijo and shipping reader defaults remain unchanged.

## Protocol and source closure

A 40×40 mm reference rectangle has both displacement components clamped at every
left-edge node and reference dead traction T=eta*E1 on the right. Each segment
endpoint receives t*T*L/2; top/bottom are traction free. Aligned Poisson-compatible
roller controls are separately labeled. Native authored geometry remains fixed
across grain0/30/45/90 and forward/alternating/perturbed triangle layouts.
Every load starts from zero, without oracle initialization or continuation.

Synthetic E1=5.5e9,E2=2.5e9 microN/mm²,t=.1 mm,G12=.387sqrt(E1*E2), explicit
nu12=.293 and reciprocal nu21 are unchanged. The independent stdlib linear-CST
reference assembles/solves its own system. Runtime statics use actual selected-law
energy, exact gradient and GN blocks restricted to planar DOFs before solving;
no mass, bending work, regularization, gravity/contact or time step is introduced.
The stock/bending Poisson ambiguity remains unresolved.

Base eta=[1e-4,5e-5,2.5e-5]; fourfold eta=[4e-4,2e-4,1e-4]. The latter is a
separate numerical-resolution/finite-strain window, not a replacement for base
failures. The residual formula and accuracy limits stay fixed; the realized
absolute residual bound follows its declared nodal-load scale.

Reports record Node v20.19.5, Python 3.13.7, x64/darwin, with 46 runtime source-file,
ten bench/tool and 73 JS test-file fingerprints. Test-file count is distinct from
executed tests. All 16 CI checks pass at this source, including 193 engine and 123
web tests, 46-source type/declaration checks and the 96-file package check.
Material/options, native UV/connectivity, exact load/constraint vectors, fixture
builder, oracle requests/results and factor inputs retain SHA256 provenance.

## Complete captures and comparisons

| Protocol | Report / exact repeat | Strict repeat proof |
|---|---|---|
| Base through cells8, raw total potential | [run](base8-total.json) / [repeat](base8-total-repeat.json) | [proof](base8-total-comparison.json) |
| Base through cells8, stable increment | [run](base8-stable.json) / [repeat](base8-stable-repeat.json) | [proof](base8-stable-comparison.json) |
| Base through cells16, stable increment | [run](base16-stable.json) / [repeat](base16-stable-repeat.json) | [proof](base16-stable-comparison.json) |
| Fourfold through cells16, stable increment | [run](fourfold16-stable.json) / [repeat](fourfold16-stable-repeat.json) | [proof](fourfold16-stable-comparison.json) |

Every repeat compares the whole report except recordedAt, including failed gates,
solutions, reference fields and all solver traces. The [method comparison](base8-method-comparison.json)
binds common source/runtime/native inputs/material/forces/constraints/budgets and
thresholds while allowing only the globalization selector and its outcomes to
differ. The [load-window comparison](base16-load-comparison.json) verifies the
named factor-four input/reference scaling while retaining both windows' outcomes.
All six proofs are rerun against these archived bytes and pass. The independent
[FE reference self-test](reference-self-test.json) passes eight test cases;
the [precision helper self-test](precision-self-test.json) passes six.

## Archival integrity

The [manifest](archive-manifest.json) retains original and archived SHA256/byte
counts for all eight full reports. The [normalization tool](compact-plane-stress-evidence.mjs)
uses Node JSON.parse/stringify without indentation, asserts deep equality of
every value and preserves array/key order. No case, trace or failed gate is
removed. Original 202122726 bytes become 81603062 archived bytes; this is a
representation change, not a reduced dataset. Manifest SHA256 is
`354b5b581f20cfd920c05877cf15480f3d6c65197932110628d133d802d62dd0`.

| Published report | Archived SHA256 |
|---|---|
| `base8-total.json` | `7391dac3972a08e7fb2d2e4d0e222d461fa3f8ef1f842cc91b4531f6b55c2f68` |
| `base8-total-repeat.json` | `8d7c36e076195cef4c5b38440ab3129a5c69bfe5f68507755e603faf0210a752` |
| `base8-stable.json` | `a92dbb95bdf87438b79dc09dd25dc305221cac07f87f9948b2df5da2da186552` |
| `base8-stable-repeat.json` | `5b1820299384f47015117fb1c3fa15f367fca14e9ff64153d13cf054e6ac98e0` |
| `base16-stable.json` | `f92dc92696ddf9424889e069fb8a41a52b6db2a6c8ffefe90f95ed8aea96b68f` |
| `base16-stable-repeat.json` | `6903a514e3cb7dbb84c039c8b33b5438f7210b5c9aec9b82c6052b8b2fc47a24` |
| `fourfold16-stable.json` | `1731eb464dce238751bbf09d9e7ccf72fb2bda2ba5993241dffa283015e55e75` |
| `fourfold16-stable-repeat.json` | `bc6cb7e7c2dc554d85bf46839a78fb0126c477eac990689aa68b5a752fb3d4d3` |

Comparator and diagnostic artifacts retain their producer hashes and archived
input hashes. Original capture hashes remain in the manifest; they are not
substituted for compact-file hashes. The normalization producer is separately
fingerprinted from the captured runtime. No local/private paths are published.

## Results: separate windows and separate gates

| Study | Geometries / loads | Converged | Iteration-limit | Search-rejected | Numerical classification |
|---|---:|---:|---:|---:|---|
| Raw base8 | 54 /162 |100 |58 |4 | Runtime nonconvergence |
| Stable base8 |54 /162 |162 |0 |0 | Discretization not converged |
| Stable base16 |72 /216 |196 |13 |7 | Runtime nonconvergence |
| Stable fourfold16 |72 /216 |216 |0 |0 | Bounded synthetic static BVP pass |

All reference and independent measurement checks pass in every study. Measurement
validity permits faithfully retained nonconvergence; it cannot turn that status
into a solver pass. Raw base8 takes 80867 backtracks; stable base8 and fourfold16
converge in three or four iterations without backtracking. These iteration/search
counts are not dynamic performance or input-to-paint measurements.

Stable base8 passes exact residual, global balance, scope, same-mesh and
eta-separation gates. It passes 34/36 mesh comparisons: 16/18 refinement and all 18
topology comparisons. The failed forward 4→8 clamp fields at grain0/90 change
1.2857%/1.1694% in runtime and 1.2859%/1.1696% in the independent reference,
above 1%. Energy/mean-extension changes there are below .18%. Matching a discrete
reference therefore does not establish mesh convergence.

Base16 preserves all 20 convergence failures at cells16: 34/54 refined loads
converge, while cells2/4/8 remain 162/162. Sixteen finest-load solves fail; four
additional failures occur at the middle amplitude. Finest same-mesh and
eta-separation gates pass for 56/72 geometries. Only three refined comparisons
are valid passes; 33 are invalid for acceptance because finest solves did not
converge. They are not 33 measured discretization-limit breaches. Global force/
moment and non-affine scope pass, separately from failed local free residual.
The largest residual/threshold ratio is 2.36257; no force gate is weakened.

## Bounded fourfold16 result

All 216 loads pass exact residual, measurement, scope and balance gates; all 72
finest-load field/maximum-node/energy/reaction comparisons pass 1%. The maximum
errors are .050020% area-L2, .060720% maximum-node, .044001% elastic energy and
.021716% full constrained reaction vector. Last-halving normalized displacement/
energy changes are .049924%/.043963%, below .1%; reaction scaling is diagnostic.

All 36 mesh comparisons pass: 18 refinement and 18 topology. Maximum 8→16 sampled
field changes are .523075% runtime/.523366% reference; topology maxima are
.225670%/.225829%. Mean extension and energy changes also satisfy 1%. Clamp
best-affine residual stays above .02099; compatible controls remain separate.
Maximum recorded principal stretch is 1.001064, a small-strain observation rather
than an enforced strain barrier or calibrated-paper limit.

The factor-four proof checks 177555 prescribed input/reference quantities. Loads,
linear displacement and reactions scale by four, independent reference energy/
work by sixteen; unchanged K/normalized metadata and all solver/accuracy policy
constants remain bound. Nonlinear runtime outcomes need not scale. The passing
window neither erases the base16 failures nor proves convergence at arbitrarily
small load or finer mesh.

## Precision evidence and its limits

[80-digit](base16-precision.json) and [100-digit](base16-precision-100.json)
fixed-pose evaluations select the retained cells16/forward/grain0 clamp at
eta 2.5e-5. The [precision comparison](base16-precision-comparison.json) requires
all parsed fields except decimalDigits to agree, including provenance; it passes.
Both inputs name the compacted base16 SHA256 from the manifest, not its original
pretty-file hash. Captured runtime coefficients are positively cyclic-matched to
native authored triangles, and the actual binary64 position reconstruction is
verified and hashed.

Runtime free residual 8.12135e-6 microN and independent exact-UV/material and
stored-coefficient residuals≈8.32626e-6 all exceed 3.4375e-6. Maximum gradient
discrepancy is 4.27533e-7 microN. Better evaluation does not make the retained pose
an equilibrium. Exact-UV/material F/S/P and the stored rounded-coefficient
polynomial are different targets, not literal replay of every runtime rounding.
This selected fixed-pose test is not another solve or proof that no representable
binary64 equilibrium exists.

Separate increment tests directly subtract energy at 100 Decimal digits: nine
internal-increment cases and six tiny potential-decision cases. Actual steps,
raw/stable changes and decision margins stay inspectable. The term-scaled 64*EPS
allowance is an arithmetic diagnostic, not a rigorous interval/path certificate.
World timestep searches do not adopt the bench candidate in this milestone.

## Exact acceptance gates and remaining scope

| Gate | Declared requirement |
|---|---|
| Reference | Coverage/pivots/self-tests; exact free residual; scaled balance/work/energy <=1e-10 |
| Static residual | Free abs(g-f) <=max(1e-7 microN,1e-10*maximum nodal Euclidean load) |
| Same-mesh | Finest-load area-L2, max-node, energy and constrained-reaction errors <=1% |
| Small-strain separation | Last-halving u/eta and U/eta² changes <=.1%; reaction change separately retained |
| Scope | Clamp affine-fit residual >1e-3; aligned compatible reference <=1e-10 |
| Mesh/topology | Both runtime/reference sampled-field, energy and mean-extension changes <=1% |
| Replay | Whole report except recording time exactly equal, failures included |

Area-lumped absolute L2 and displacement RMS have separate units and explicit
eta*patch-span*1e-12 floors. Nonnested fields use a fixed 33×33 UV grid with
deterministic CCW barycentric/lowest-triangle ties and no nearest fallback.
Sampled RMS is not FE area L2; maximum-stress convergence is unclaimed.

The fourfold window passes a bounded synthetic numerical static gate. Base16
nonconvergence remains an open numerical-resolution result. Neither closes
physical calibration, controlled time integration, smooth-bending locking,
strain/path feasibility, friction/contact, crease/join/hand support, new-model
booklet, actual-device or 8 ms acceptance. The broader campaign remains active;
optimal abstraction and exhausted research are not established.
