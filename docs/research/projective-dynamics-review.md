# Projective Dynamics 2014: credible candidate, different constitutive contract

2026-11-10. Read-only assessment against Pliego `3d778abc179988e1c1a31b43d8048aa6a08d00b1` and the [candidate register](paper-physics-campaign.md#primary-source-candidate-register). The running 24-trajectory campaign, its inputs, budgets and force gates are unchanged. No implementation or benchmark was performed here.

**Decision:** investigate factor reuse, but standard PD is not an exact solver substitution for our orthotropic StVK energy. A PD material experiment and a same-StVK fixed-factor direction experiment answer different questions. Neither currently has a Pliego performance or acceptance result.

## Primary evidence actually reviewed

[Bouaziz et al., full 2014 paper, coauthor-hosted PDF](https://users.cs.utah.edu/~ladislav/bouaziz14projective/bouaziz14projective.pdf): §3.1–3.3, equations 1–10 and Algorithm 1 (pp3–4); §4 (pp4–5); §5.1–5.4 (pp6–7); §6 (pp7–8); §7.3–9 (pp9–10); Appendix A, equations 22–28 (p11). Text extracted from all 11 pages; pages4/7 also rendered and visually inspected. Local PDF SHA256: `41a0e0ba0de70dfdddc59dca047130394bc7a6ae3ebca695237729ead8af23d0`.

The core objective is

\[
J(q,p)=\tfrac12(q-s)^T C(q-s)+\sum_i\tfrac{w_i}{2}\|A_iS_iq-B_ip_i\|^2+I_{\mathcal C_i}(p_i),\quad C=M/h^2.
\]

Local projection fixes q; the global minimization solves

\[
(C+\sum_iw_iS_i^TA_i^TA_iS_i)q=Cs+\sum_iw_iS_i^TA_i^TB_ip_i.
\]

Fixed operators/weights/mass/h enable factor reuse. The paper uses strain projections, a mean-curvature bending model, and soft collision planes; it identifies damping, changing constraints and complex materials as limitations. Its reported convergence is linear rather than Newton's asymptotic quadratic behavior. [Paper, §§3,5–9 and Appendix A.](https://users.cs.utah.edu/~ladislav/bouaziz14projective/bouaziz14projective.pdf)

**Code review boundary:** the authors' [ShapeOp project](https://shapeop.org/), [source downloads](https://www.shapeop.org/downloads.php) and full Doxygen source could not be fetched: DNS failure locally and HTTP502 through browsing. Official indexed [constraint tutorial](https://www.shapeop.org/ShapeOpDoc.0.1.0/tutorial_add.html) code was readable: separate `project`/`addConstraint` methods, preallocated projection scratch, weighted projections and a linear mean-centering operator. The official [C API](https://www.shapeop.org/ShapeOpDoc.0.1.0/_a_p_i_8h.html) exposes initialization and iteration-count-based solve. This is partial primary implementation evidence, **not** inspection of `Solver.cpp`, the complete triangle/bending implementations, or a compiled reference. Third-party mirrors were not used as primary evidence. Weight normalization, per-vertex mass support, dynamic updates and numerical stopping remain code-review items before a port.

## What the guarantee would and would not buy us

My inference from exact block minimization: each local/global pair makes J non-increasing, and its lower bound implies convergence of objective values. That alone does not prove a unique/global minimizer, convergence of every iterate, or a small residual after a fixed iteration count. Approximate local projection, an inexact global solve, binary64 roundoff, changing contact geometry or a changed objective need their own checks. In particular, the appendix's iterative volume projection cannot simply inherit an exact-projection assumption without verification.

The objective includes inertia: its descent is not a mechanical-energy conservation proof. It also cannot repair Pliego's difference between represented latent q and public rounded x. Both current force equations must still be measured at their actual states. We cannot trade a low PD objective or visually settled page for either existing force gate.

## A precise obstruction to exact StVK replacement

This is my derivation, not an impossibility claim made by the paper. Consider **finitely many** standard PD terms with fixed finite linear operators, fixed nonempty projection sets containing finite points, and fixed finite positive weights. Choose one feasible \(p_i^0\) per set. Then

\[
\Phi_{PD}(q)=\sum_i\min_{p_i\in\mathcal C_i}\tfrac{w_i}{2}\|A_iS_iq-B_ip_i\|^2
\le a\|q\|^2+b
\]

for finite nonnegative a,b, by evaluating each term at its fixed feasible point and using the squared-norm triangle bound. Thus its reduced real-valued material energy has at most quadratic growth.

Pliego's positive-definite plane-stress Q gives quartic growth under uniform dilation: for F=λF0 the represented Green strain scales as λ²−1, so \(U_{StVK}(λ)=k(λ^2-1)^2\), k>0. Those two real constitutive functions cannot agree globally. This does **not** exclude useful small-strain approximation, a restricted domain, infinitely many terms, nonlinear operators, state-dependent stiffness, generalized proximal/ADMM formulations, or other auxiliary-variable energies. Nor is it a theorem about a finite IEEE-number domain. It specifically rules out quietly calling the finite fixed-operator standard PD objective our unchanged StVK material.

A transparent single-axis control shows the practical difference before a solver is involved: for F=diag(s,1), our energy is \(VQ_{11}(s^2-1)^2/8\); a simple calibrated rotation-distance spring has \(VQ_{11}(s-1)^2/2\). They match the quadratic term around s=1 but differ at cubic/quartic orders. Matching this one direction also does not identify Q12, G12, grain rotation or the complete orthotropic tangent.

## Fit against the actual repository

| Current requirement/source | PD implication, inferred for Pliego |
|---|---|
| [orthotropic-membrane.js](../../packages/engine/src/xpbd/orthotropic-membrane.js): independent E1/E2/G12/nu12, material grain, exact selected StVK gradient; runtime PSD GN is explicitly an approximation | An isotropic singular-value/rotation-distance law is a new material. A reference-frame extension needs its own coupled tensor derivation; assigning MD/CD edge weights is insufficient. Keep the existing constitutive/objectivity and held-out material gates. |
| [newton.js](../../packages/engine/src/xpbd/newton.js) and [pcg.js](../../packages/engine/src/xpbd/pcg.js): sparse Cholesky already reused, co-rotated stale preconditioning, actual current GN products and fallback | The proper baseline already amortizes factorization. Compare assembly, products, substitutions, convergence and total work; do not assume PD saves one fresh factorization on every current Newton iteration. |
| [energy-search.js](../../packages/engine/src/xpbd/energy-search.js): dihedral/rest-angle energy, authored/driven fold targets and bending damping | The paper's mean-curvature magnitude energy is not this hinge law. Its rest-isometric Laplacian assumption and unsigned curvature need explicit crease, signed-fold, boundary and buckling validation. A hinge-manifold projection can define another PD penalty, but does not automatically reproduce squared dihedral energy. |
| [world.js](../../packages/engine/src/xpbd/world.js)/coupled barrier path: contact, CCD-related controls, normal barrier objective; friction remains separate | A finite-weight half-space distance is a soft penalty with finite penetration, not a thickness/CCD certificate or the current barrier. New/removed contact terms also change the factored operator unless updates are accounted for. |
| Campaign: independent reading, fixed booklet frame, public/latent force gates, time/material/device/8ms requirements | Local/global scheduling does not determine pointer semantics or validate paper. No published CPU timing can establish our device budget. Accuracy and interaction gates stay separate. |

## Smallest credible future experiment

**First isolate the solver claim with a law PD actually represents.** Use an uncapped Hookean distance-spring patch with symmetric tension/compression and no bending/contact. For edge incidence B, lengths l and positive K, local targets are \(p_e=l_e(B_eq)/\|B_eq\|\); global matrix is \(C+B^TKB\). Predeclare nondegenerate inputs and explicit refusal/tie handling at zero length. Compare PD against GN/PCG minimizing that **same spring objective**, with identical native masses/h/initial pose, fixed tolerances and an independent spring-force reference. Record residual versus work and equal-error runtime, including setup/factorization. This is an algorithm control; scalar springs do not satisfy the orthotropic paper-material gate. The current reference-displacement World only admits the research membrane domain, so a spring control cannot be presented as an already-supported state-World option.

**If preserving StVK is the immediate requirement, test a separately named fixed-SPD direction instead.** At fixed h/M choose \(H_*=C+\sum_e V_eJ_{0,e}^TQ_eJ_{0,e}\), factor it once, and propose \(d=-H_*^{-1}g\) using the actual current StVK/inertia gradient and existing acceptance search. Here J0 is the assembled rest-strain Jacobian and Ve is the reference area times thickness; use the same declared native inertia coefficients for numerical comparisons. In exact arithmetic \(g^Td=-d^TH_*d<0\) for nonzero d. This is fixed-preconditioned descent, **not a PD implementation**. The informative ablation is against current stale-Cholesky plus current-H PCG: otherwise it may only be dropping PCG products and paying with more nonlinear iterations. Keep the original budgets as reported controls; any different work/iteration policy must be a separately predeclared experiment. Nonlinear descent, independent true force, both representation gates and time error must still pass. Orthotropic coordinate coupling also precludes assuming that a general 3N operator reduces to one scalar factor reused independently for x/y/z.

Only after those controls justify it should a separately named triangle PD material face all four orthotropic small-strain load/tensor checks, finite strain/objectivity, grain rotations, mesh refinement and material calibration; bending/contact/booklet/device experiments follow separately. A tangent fit or a faster spring patch alone is insufficient.

**Disposition:** move PD from abstract-only to full-paper/partial-primary-code assessment. Exact standard-PD replacement of the current StVK law is incompatible under the stated growth assumptions; same-model fixed-factor and separately named PD-material experiments remain credible and unmeasured. Primary solver-source acquisition remains open. No port, optimum-abstraction, accuracy or speed claim is established.
