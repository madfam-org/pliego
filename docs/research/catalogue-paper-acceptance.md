# Close-to-real paper: acceptance bar for the catalogue page turn

2026-11-10. Proposal for owner ruling. One ruling is recorded ([R0](#rulings): the first
release plays back recorded page turns); no gate is accepted yet. It turns "close-to-real
paper physics in the catalogue" into gates that either pass or fail, so the claim can be
checked instead of judged by eye.

Scope: the page turn in Tulana's offering catalogue magazine, both editions (internal
`/dashboard/catalogue?edition=internal`, public `/catalogue`). Tulana owns the catalogue;
Pliego owns the engine and the evidence below. All gates are evaluated on the **engine
version behind what Tulana ships** (for the recorded release, the commit that made the
recordings), on the **catalogue's own page-turn workload**, not on research fixtures
alone. Until every gate passes, Tulana keeps its maturity label (madfam-org/tulana#122).

## Where things stand (2026-11-11)

- Tulana vendors Pliego at commit `1ffeba0` with the default edge-spring paper; two render
  files are patched. None of the accurate-membrane work is in it.
- The accurate law (orthotropic StVK, UV reference, displacement state, two-word
  arithmetic, exact curvature) is opt-in and admitted for a free sheet with flat panel
  bending; creases, contact and the hand drive are still refused.
  ([campaign](paper-physics-campaign.md), [exact-curvature results](exact-curvature-results.md))
- 2026-11-11: the first G1 audit is captured. A free patch in its lowest bending mode
  passes the latent force gate at every step with four or more Newton iterations, and its
  out-of-plane motion follows backward Euler on the represented law within the comparator
  limits; one Newton iteration and the public gate fail
  ([bending capture results](bending-capture-results.md)).
- In that domain, exact curvature plus a force-tolerance PCG stop makes one Newton
  step pass the latent force gate at the finer timesteps from the predictor start
  ([PCG-stop results](pcg-force-stop-results.md)); coarse steps, the previous-pose
  start and the public gate still fail.
- Local active-step p95 on booklet workloads is roughly 186–365 ms against an 8 ms
  physics target ([HONEST_STATUS](../HONEST_STATUS.md)). No phone or stylus result exists.
- Paper stocks are derived estimates, not calibrated against measured sheets.

## Gates

Each gate lists the threshold, how it is measured, and its status. Values marked
**ruling** are proposals the owner must confirm before any measurement counts.

| # | Gate | Threshold | Measured how | Today |
|---|---|---|---|---|
| G1 | **Law in the real domain** | The deployed page turn runs the accurate membrane law with panel bending, the spine crease, paper contact and the hand drive in one solve. | Admission in the engine plus the G2–G5 audits running on that path. | Not met: panel bending captured on a free patch (step 1 of 4); crease, contact and hand drive not admitted. |
| G2 | **Force** | Native latent force residual ≤ tau = max(1e-7, 1e-10·F0) at every judged step of the catalogue workload (forward, reverse, cancelled turns). Public residual always reported. **Ruling:** whether the public (rounded-position) gate must also pass, or only the latent gate with the public outcome disclosed. | Frozen fixed-trajectory audit like the state matrix, on catalogue page turns, every step retained. | Not met. |
| G3 | **Time accuracy** | Adjacent timestep refinements (levels 1/2/4/8) converge at first order on the page-turn trajectory; differences at the finest pair within the existing limits (field and velocity 1%, energy 5%, phase 0.01 cycles). | Common-time refinement study, actual clock drift retained. | Not met for booklets; open even for the planar mode. |
| G4 | **Material** | Every stock the catalogue uses is calibrated against measured sheets: bending stiffness along and across grain, tensile modulus, thickness, areal density, spine-crease stiffness. Held-out tests (cantilever deflection, page-turn sag) within **ruling: ±10%** of measurement. | Physical test protocol on real sheets, independent of the fitting data. | Not met: estimates only. Needs physical measurement. |
| G5 | **Contact and geometry** | No penetration or crossings; page separation ≥ stock caliper; peak tensile strain ≤ 1%; no non-finite or exploded state; bit-exact replay. | Existing booklet harness gates, on the catalogue workload, full run retained. | Partly met on old paths; not on the accurate path. |
| G6 | **Interaction** | **Recorded release (R0):** playback input-to-paint p95 ≤ 16.7 ms on the **ruling: named target devices** (one desktop browser, one mid-range phone, plus stylus where offered). **Live release (later):** also physics step p95 ≤ 8 ms on the same devices. Both: existing behaviour gates (fixed frame, cancel and reverse, keyboard/pointer/touch, no hidden-tab work, safe teardown). | Instrumented builds on the actual devices; physics and end-to-end measured separately. | Not met: no player and no device data. Live: about 186–365 ms locally. |
| G7 | **Release** | Pliego re-vendored into Tulana at a pinned commit with provenance (for R0: the player and the recordings); Tulana's paper tests pass; both editions verified in production (internal behind sign-in, public at `/catalogue`); the maturity label updated to exactly what passed. | Tulana PR, deploy gates, live checks of both URLs. | Not started. |

A gate passes only with retained evidence: pinned source, inputs, every failure, and an
independent check where one exists. No gate may be waived because another is close.

## Rulings

Recorded:

- **R0. Release mode** (owner, 2026-11-10). The first catalogue release plays back page
  turns computed offline by the accurate engine. Live physics in the browser is not
  required for it; it stays a later release judged by the full G6.

Needed from the owner:

1. Whether G2 requires the public force gate, or the latent gate with the public result disclosed.
2. The material tolerance in G4 (proposed ±10% on held-out deflection).
3. The target devices in G6, by model and browser (for R0, the playback devices).

## What R0 means for the gates

Proposal; it narrows where the physics runs, not what must pass.

- **G1–G5 are judged on the offline solves** that produce the recordings, at the engine
  commit that made them, on the catalogue workload. A recording made by a solve that fails
  a gate is not shipped.
- **What is shown must be what passed.** G5 (no penetration, separation ≥ caliper, strain)
  is re-checked on the positions exactly as stored and displayed, including any precision
  reduction and the positions a viewer blends between keyframes, not only on the solver's
  states.
- **Provenance travels with every recording**: engine commit, stock, workload inputs,
  timestep and a content hash. The player refuses a recording without it.
- **Interaction is limited to the recorded set.** Forward, reverse and cancelled turns are
  each recorded; input selects and scrubs a recording. The page does not respond
  physically to arbitrary hand motion, and a forward turn played backwards does not count
  as a reverse turn. The maturity label says so.
- **Carrier.** Pliego's GLB motion exporter (`packages/kernel/src/pliego/export/glb_motion.py`)
  already writes morph-target animations, but from the rigid preview pose, not the engine.
  The recorder (engine states → recording) and the player are new work in Pliego; Tulana
  vendors both with the recordings.

## Order of work

1. Done: exact curvature and the force-tolerance PCG stop in the planar domain.
2. G1 in steps, each with its own frozen audit: nonplanar states with panel bending
   ([design](bending-domain-next-implementation.md)), then the spine crease, then contact,
   then the hand drive.
3. G2 and G3 on a catalogue page-turn fixture once G1 exists.
4. For R0: the recorder and player in parallel with step 2, measured on devices once
   rulings name them. Solver speed work for a live release is off the first release's
   critical path.
5. G4 needs a physical test campaign; it cannot be done in software.
6. G7 after G1–G6 pass.

No date is attached: steps 2 and 4 are research with unknown outcome, and step 5 depends
on physical measurement.
