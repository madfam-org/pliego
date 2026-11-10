# Offset-contact derivation review

OGC remains a research candidate, not a Pliego implementation. Reviewed main
definitions §3.1–3.8, the displacement algorithms and limitations. Page 9 was
visually checked for the activation and bound equations; Algorithm 3 was
previously checked on page 12. Cited proof sources and full reference conformance
remain open. Source:
[Chen et al., Offset Geometric Contact, SIGGRAPH 2025](https://graphics.cs.utah.edu/research/projects/ogc/Offset_Geometric_Contact-SIGGRAPH2025.pdf).

The construction assigns normal-direction blocks to facet interiors, edges and
vertices. Its contact set uses block membership, including multiple contacts,
rather than every nearby triangle. The edge-only construction and parallel-edge
treatment are additional requirements. Pliego's current closest-feature radial
barriers do not implement that construction. Its finite-gap model also needs
separate caliper-aware motion bounds; a mid-surface intersection bound alone
cannot certify stock thickness.

## Activation coefficient check

For a quadratic outer branch `q(d)=k(r-d)^2/2` and inner branch
`l(d)=-a log(d)+b`, our differentiation gives:

```
q'(tau) = k(tau-r)       l'(tau) = -a/tau
a = k tau (r-tau)        // required for matching first derivatives
b = k(r-tau)^2/2 + a log(tau)
q''(tau) = k             l''(tau) = a/tau^2
tau = r/2               // then the second derivatives match too
```

The inspected PDF's Eq. 19 prints `a=tau k(tau-r)^2`, which does not satisfy
that derivative condition for general radius. This is an apparent equation
inconsistency, not evidence that the authors' implementation uses that expression.
Their [Newton implementation at f29662be](https://github.com/newton-physics/newton/blob/f29662be10f41042a5738fac7b8e9df7f97f3f06/newton/_src/solvers/vbd/particle_vbd_kernels.py#L855)
uses `a=k tau^2` with `tau=r/2`, matching the calculation above. It also extends
the logarithmic branch quadratically below a small distance. This was source
inspection, not execution of Newton or an independent reproduction of its solver.

For our proposed adapter, test energy/force/curvature across the internal stitch
for several radii and units. The outer quadratic cutoff is C1, with a one-sided
curvature jump if clamped to zero above `r`; do not apply a C2 label to every
boundary. The current Pliego log-gap barrier is a different function.

## Bounds and implementation gate

The earlier Algorithm 3 displacement truncation also needs checking against
Eq. 27/28: a normalized displacement must be scaled by the vertex's bound.
A generic clamp without its contact force construction is not OGC.

Any native comparison must independently check coverage of all moving primitive
pairs, boundary/concave cases, finite caliper, multiple layers and zero-friction
sliding. Full-gradient finite differences and force/torque balance must precede
page timing. Reference-code version, distance regularization and arithmetic type
must be retained. No claim of an OGC port, full proof review or published speedup
reproduction is made here.
