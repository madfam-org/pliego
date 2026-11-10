# Next state representation candidates

2026-11-10. Research/design prepared during the frozen `d739165` study and published
after its captures and independent reviews finished. No state-representation
prototype or simulation has been implemented for this proposal. The
[reference-law results](membrane-uv-reference.md) improve frozen-pose component
accuracy while retaining 6968/7110 force failures. Better force evaluation and a
finer state/update representation are different hypotheses; those failures do
not prove that equilibrium is unrepresentable on the existing grid.

## Recommendation

The smallest useful next implementation is a separately named **binary64 reference-displacement-authoritative World**, restricted initially to the existing all-free near-reference planar UV-displacement/DD/increment-search domain. It is a changed state contract/ABI, not continued acceptance of the same absolute-x World. It must retain BOTH the original literal force gate at the actual public rounded x and a separately named latent-state force gate. A latent pass cannot close the public endpoint gate, booklet gate or device gate.

| Candidate | What it changes | Near-reference benefit and limit | Relative scope |
|---|---|---|---|
| Authoritative displacement u, one f64/component | The state grid is centered on actual X0; physical q=X0+u over the reals | Finer updates while u is small; finite rotations/translations can make u large again | Lowest bounded next ablation |
| Authoritative two-word q/v/targets or two-word u | Real state is the sum of retained high/low words | Retains increments below one-word spacing even at large absolute coordinates; evaluator/update chains must consume both words | Broader precision ablation |
| Split rigid motion plus small deformation | q=t+R*(X0+d), with a declared rotation/state/gauge contract | Keeps local deformation small during large motion; rotation conditioning, consistent inertia/tangents and rebasing require additional work | Later finite-rotation campaign |
| Same-f64 Wasm/SIMD port | Execution/backend and possibly reduction ordering | May change speed or rounding path; unchanged one-word state grid remains | Separate performance/control campaign |

This ordering is an engineering recommendation for the measured Pliego scope, not proof of optimal abstraction, best performance or globally minimal complexity.

## Why displacement is the first bounded ablation

Use the actual new UV-reference law directly on authoritative u. Do not repeatedly compute u from rounded public x, and do not evaluate elasticity at round(X0+u). Every relevant consumer must use the same physical q: selected energy/gradient/J/GN, search increments, predictor target, inertia, velocity update, solver updates and acceptance observations. The current UV reference formula is naturally compatible with H=K*u, while A=K*X0 remains fixed. Existing native mass, h, rounded coefficient C=fl(M*fl(1/fl(h*h))), material, reference law, budgets, c1 and maximum halvings stay fixed.

For scale only, binary64 spacing near40 mm is2^-47 mm, while spacing near.004 mm is2^-60 mm: an8192-times finer offset grid. This is a direct representation calculation, not a measured residual improvement or a proof that an equilibrium exists on either grid. A near-rigid180-degree turn can make displacement comparable to the sheet size; a large rigid translation can also consume that advantage.

Initialize from the actual captured baseline state, not ideal modal A*phi. In the intended first near-reference fixtures, require TwoDiff(actual initial x,X0) to have zero low word, and store that exact f64 difference as u0. Verify that real X0+u0 equals the unchanged actual native initial x. Bind native initial x/xt/M/h, zero velocity, reference coefficients and full LE hashes before stepping. If the difference cannot fit one word, refuse this first candidate or explicitly choose a different representation; do not silently round a new initial physical state. No oracle prediction or repeated ideal initialization is permitted.

The shifted predictor operates on u and v; this changes floating-point association compared with old x arithmetic and must be named. Derive the same real backward-Euler objective under the new coordinates, with the same declared native coefficient. Preserve exact representable controls where all coordinate operations agree; do not promise bit-exact old trajectories when rounding differs by construction. Initially do not rebase the reference, change X0 or add a hidden drift-removal step.

## Two residual gates, unchanged tolerance

With q=X0+u and latent target qt=X0+ut interpreted as real sums, report

    r_latent = grad_q U(q) + C*(u-ut).

Separately form the actual public views xv=round(X0+u), xtv=round(X0+ut), and report

    r_public = grad_x U(xv) + C*(xv-xtv)

using the declared original native arithmetic/evaluator convention for that public gate. Both gates use every Cartesian coordinate and the SAME original tau=max(1e-7 microN,1e-10*F0), where F0 stays fixed from the unchanged native initial mass/amplitude/mode. No ULP allowance, EPS floor, tolerance inflation or modal-only residual is added. Also have an independent high-precision observer evaluate BOTH represented physical states, distinguishing force-evaluation error from state-grid error.

Native latent residual reports retain the existing f64 subtraction/multiply/add association applied to u/ut; independent truth reports evaluate the exact represented real difference with the native rounded C, and real M/h² separately. Name these rather than conflating computed and true residuals. Keep original literal public gate fields and failed counts visible and unchanged in meaning. Add names such as authoritativeResidual/authoritativeConverged rather than repurposing the existing convergence boolean. If only latent convergence improves, the result is precisely that bounded representation result; public-view equilibrium, external interactions and release acceptance remain unclosed.

Snapshots/replay/observers must bind latent u/us/ut and v, the state-mode/version, immutable reference identity, actual native M/h and public x/xs/xt projection values/hashes. Restore mismatches and inconsistent projection/latent pairs must fail before mutation. The public typed-array x is now a view: external writes cannot be silently ignored or silently overwrite authority. For this first mode either visibly refuse unsynchronized edits or expose one explicit reset operation that updates all authoritative state/caches and records its conversion policy. Preserve exact observed/unobserved and snapshot replay tests. Do not claim mid-Newton replay unless it is actually implemented.

## Why the alternatives remain separate

Two-word state can preserve small updates at large coordinates, but a low word saved only in x is insufficient. Predictor, xs/xt, velocity, accepted/backtracked changes, objective evaluation and residual validation must carry their authoritative words consistently. Capture real sums, not an invented unrounded trajectory; initializing high=actual old value,low=0 gives a clean same-start control. Existing two-word force helpers do not by themselves establish a correct state integrator or correctly rounded arithmetic. Local normalization, exponent/refusal policy and all newly used operations need independent tests.

A rotation-plus-deformation representation addresses a different conditioning problem: near pure finite rotations, small strain can be ill-conditioned as a function of large displacement. It requires a precise physical meaning for stored rotation/translation/deformation, consistent energy and inertia under that meaning, and a gauge/rebase policy that does not change the physical state invisibly. A corotational small-strain constitutive model is not automatically the current StVK law; retain the current energy or explicitly name another law. A global sheet frame also does not solve local bending/fold rotations or contact coupling.

Wasm f64 and SIMD f64 lanes remain binary64; a128-bit vector is not a128-bit floating-point significand. A same-grid backend can produce different iterations/reductions, or support an explicitly implemented multiword representation, but does not automatically expand the set of representable one-word states. A local ULP/lattice-aware search might find a better existing state; the observed failures are not a nonexistence proof for representable equilibrium. Keep backend cost/parity and representation/accuracy campaigns separately controlled.

## First predeclared evidence, after source guards end

Start with one frozen near-reference failure witness plus an exactly representable control, then the SAME24-trajectory matrix only after arithmetic/state tests pass. Require unchanged initial physical inputs and solver budgets; direct force/energy finite differences in latent coordinates; independent physical-state energy/inertia/residual proofs; nonzero latent steps whose public view is unchanged; visible latent and public failure counts; same-mode snapshot/observer parity and cross-mode/unsynchronized-edit refusal. Preserve every gain, loss, no-op, failed solve and time-accuracy outcome. Do not run another amplitude/geometry or quietly widen support to manufacture a pass.

## Primary-source basis and review limits

- [Shakeri et al., Stable numerics for finite-strain elasticity,2024](https://arxiv.org/html/2401.13196v2), equation3 and Remark2.1: stable displacement-gradient strain evaluation does not remove the near-pure-rotation conditioning problem; the authors discuss higher/mixed precision and finite-rotation plus small-perturbation state decompositions. This supports separating the hypotheses, not a guarantee for our proposed integrator.
- [Official DOLFINx hyperelasticity demo](https://docs.fenicsproject.org/dolfinx/main/cpp/demos/demo_hyperelasticity.html): displacement is the nonlinear unknown and the residual/tangent derive from its energy. It is a formulation example, not validation of Pliego's changed public/latent state ABI or time integrator.
- [Hida,Li,Bailey, Algorithms for Quad-Double Precision Floating Point Arithmetic,2001 preprint](https://www.davidhbailey.com/dhbpapers/arith15.pdf), introduction and sections2–3: multi-component numbers represent unevaluated sums; normalization and arithmetic algorithms matter. No paper timing or blanket correct-rounding theorem is imported into our JS implementation.
- [Felippa/Haugen,2005 primary publisher abstract](https://www.sciencedirect.com/science/article/pii/S0045782504005353): the corotational framework assumes small corotated strains with unrestricted base rotations and derives forces/tangents by energy variation. Full paper retrieval was unavailable in this pass; no unread detailed dynamic algorithm is claimed reviewed.
- [Official WebAssembly numeric/vector types](https://webassembly.github.io/spec/core/syntax/types.html#number-types): f64 is IEEE double; v128 packs numeric lanes. The same-state-grid conclusion above is an inference from these representations, not a backend benchmark.

Full amplitude/time/solve isolation, material calibration, bending/buckling/creases/joins/hands/contact/friction, alternative formulations/backends, independent natural left/right booklet reading with its frame fixed, actual touch/device input-to-paint and the8msphysics gate remain open. No implementation starts during the frozen accepted pipeline, and this memo makes no optimality or exhausted-research claim.
