# Honest status

> Last Updated: 2026-11-10 (paper-physics research checkpoint; other dated evidence retained)
> Boundary: public. The single truth for what works today. Keep it true when you change behaviour.

Local source addition, 2026-11-09: the studio supports an explicit fixed-camera
`interaction=paper` mode for one native leaf and an independent 2–32-leaf native
codex, with physical forward/backward dragging, return/cancel and arrow keys. The
codex reader uses one flexible leaf and fixed page blocks, promotes released
leaves to flat blocks and caps the solver cache at two worlds. This is an explicit
reading model, not a validated unconstrained stack equilibrium. It requires the real engine; the rigid
preview and unsupported documents show an unavailable message. This is not an
independent multi-page reader for the archive companion. The
[paper physics campaign](research/paper-physics-campaign.md) is active, including
a pinned-contact regression, an experimental uncapped membrane option and a
reproducible all-flexible/active-leaf benchmark. Research, physical calibration,
general contact robustness and the 8 ms physics target remain open. See
[scope and verification](pilots/paper-reading-mode.md). Not deployed by this
change; a dispatched build and running-version acceptance are still required.

The [first committed campaign results](research/evidence/paper-2026-11-09/README.md)
show five active-leaf configurations completing eight turns below 1% stretch,
but none passing the independent partial thickness audit or 8 ms physics gate.
The contact correction regresses the baseline S=16 reader's thickness result;
conventional CI passing does not close that failure. The separate axial reference
shows strong timestep sensitivity and no cure from line search alone. These are
research/interaction results, not a stable physical catalogue release.

The subsequent [continuous-contact experiment](research/continuous-contact-experiment.md)
adds opt-in swept vertex–triangle and edge–edge motion bounds and an explicit
pre-promotion turn-progress gate. Analytical tunneling tests pass. The guarded
native booklet candidates stall or fail strain before the first complete turn
and exceed the physics timing target. The default reader does not enable this
guard. Contact forces coupled to elasticity and prescribed-motion handling remain
open; this is not a C-IPC solver or a collision-free release claim.

The next opt-in [coupled normal-force candidate](research/coupled-contact-experiment.md)
adds barriers to the implicit objective, per-iteration feasibility/energy checks
and force-residual diagnostics. Analytical contact equilibrium, native ground
support and deterministic replay are tested. A separate previous-pose seed option
recovers the synthetic S8 axial-bar response even with contact disabled; the
initialization effect is not a contact-force validation result. Both options
remain disabled by default. Initial table touching, moving prescribed geometry,
coupled friction/strain limits and booklet/device performance remain open.
The [source-pinned comparison](research/evidence/paper-2026-11-09/README.md#coupled-normal-forces-and-previous-pose-initialization)
records three coupled active-leaf configurations completing the first physical
turn above 99.98% fore-edge progress, below 0.02% peak tensile strain and with
zero deficit in the partial resting-block thickness audit. Moving-substep force
convergence still fails in each, and all-flexible initial table contact is
rejected. The initialization-only reader completes eight turns but retains a
0.09846 mm thickness deficit on 0.1 mm paper. Local timing was under verified
CPU contention; it cannot close the performance gate.

The [local-solve ablation](research/evidence/paper-2026-11-09/README.md#consistent-curvature-and-direct-local-contact)
separates compression curvature from linear solving. Matching the declared
compressed force law reduces first-turn missed force-tolerance substeps from
436/672 to 13/672 with either PCG or direct solving. Direct solving alone leaves
436 misses. A direct S8/I32 candidate completes all eight turns above 99.98%
sampled endpoint progress, with 0.0192% peak tensile strain, 0.4955% compression
and zero partial resting-block deficit. Its unsmoothed variant misses tolerance on 680/5264
executed substeps and takes about 23 seconds at active-frame p95 in a diagnostic
run. It is unsuitable for interactive reading. Spatial candidate scanning dominates
the recorded CPU samples. A reconstructed late-turn objective and a parallel-edge
element expose contact smoothness/convergence work still owed. All new options
remain opt-in; this is not a stable catalogue physics release.

An opt-in [ordered refit BVH](research/bvh-broadphase-experiment.md) preserves
every recorded non-timing result and the complete eight-turn sampled-position
hash. Local diagnostic active-frame p95 drops from 23.3 to 7.9 seconds; first-turn
paired p95 drops from 1010 to 304–319 ms. Force convergence and the 8 ms target
still fail. A large-sweep component stress case is slower, so no universal speedup
or optimal backend is claimed. Default candidate traversal remains unchanged.
The [parallel-contact review](research/parallel-contact-review.md) checks smoothing
algebra against an independent compiled reference and adds a native-filter
counterexample: an eligible parallel EE pair can lack its VT energy backup.
An opt-in surface-guarded native experiment now smooths only pairs with sufficient
retained VT backups; uncovered pairs keep their original barriers. Whole-energy
derivatives, native operator agreement and replay are tested. This partial
smoothing does not close general coverage, force/material or device gates.

Exact-pose BVH candidate reuse now preserves both capped/uncapped eight-turn
trajectories, all recorded force/contact diagnostics and exact repeated reports.
The [retained measurements](research/evidence/paper-2026-11-10/README.md#exact-pose-candidate-reuse)
show uncapped active p95 of 345–365 ms and candidate work still about 56% of the
sampled process. The 8 ms target, material calibration, general contact coverage
and backend/device acceptance remain open; this is an opt-in optimization.

A rank-preserving active-edge refinement subsequently reduces native query/node
work while keeping both full trajectories, all recorded diagnostics and exact
repeated reports. Its [source-pinned evidence](research/evidence/paper-2026-11-10/README.md#rank-preserving-active-edge-traversal)
measures capped active p95 at 202–205 ms and uncapped at 300–320 ms. The slower
naive traversal and large-sweep regression are retained. Candidate work still
accounts for about 53% of sampled process self time; optimality, 8 ms reading and
measured-paper accuracy remain unproven.

An experimental [binary64 Wasm refit/query backend](research/wasm-contact-experiment.md)
is available behind `contactBroadPhase: 'wasm'`, with no runtime package dependency
or hidden JS fallback. Fresh JS/Wasm comparisons and Wasm repeats preserve both
complete eight-turn sampled trajectories and every recorded non-time physics
field, with **0/5168** capped and **0/5200** uncapped force misses. Clean `4b48ec1`
local active-step p95 is 186–189 ms capped and 278–283 ms uncapped, about 9–11%
below fresh JS controls and still above 8 ms. Dense-output component performance
regresses; initialization, memory and substantial JS candidate/filter work remain.
The later runtime change at `c05de1a` only adds a little-endian host guard;
supported-host first-turn parity passes, while full timings retain the older pin.
The current studio/API policy demonstrably blocks Wasm compilation. A separately
permitted research browser page passes capped/uncapped first-turn byte and
diagnostic parity. It changes no production policy or default reader and closes
neither material calibration nor real-device/input-to-paint acceptance.

The independent [membrane constitutive audit](research/membrane-constitutive-audit.md)
now completes and exactly repeats 108 prescribed-pose cases against a separately
implemented CST reference at clean `f145538`. **All 36 uncapped/symmetric cases
fail the 1% tensor gates**, with 14.08–29.78% relative engineering-Voigt matrix
error and up to 60.89% worst signed energy error. Oracle and extraction checks
pass; the scalar springs constrain C12=C66 where the declared orthotropic target
requires independent coupling and shear. Forty-two of 48 mesh/topology comparisons
also fail. Cap and .05-compression controls are separate; the combined shipping
cap+.05 policy is not another measured case here. The explicit synthetic nu12
convention does not resolve the stock/bending Poisson ambiguity. This zero-step
energy/reaction audit is not a solved patch or physical-stock validation. A
coupled per-triangle law is a separate model experiment; backend parity and
force convergence cannot close this scalar-spring constitutive gap. That baseline
audit changed no runtime laws, stocks or reader defaults.

An opt-in [orthotropic triangle membrane](research/orthotropic-membrane-experiment.md)
now implements a coupled Green-strain energy with an explicit per-sheet nu12
convention, exact energy/gradient and a named Gauss–Newton search matrix. It
requires uncapped symmetric membrane behavior, line search, no legacy projections
and no plasticity. Multiple initially planar sheets and small coupled-contact
cases are tested; folds, joins, hand drives and new-model booklet reading remain
outside acceptance. Element/oracle/operator and targeted World replay checks pass.
At clean `25ca58d`, all 36 new-law cases pass the unchanged 1% tensor/energy
and mesh/topology gates, with exact repeat of every non-recording field for
the new cases and 108 retained old controls. Worst finest-amplitude signed
linear-reference energy
error is .003078%; independent finite-Green agreement covers 1944 poses and
36 scaled finite-rotation cases. Old spring-law booklet controls separately
preserve all recorded physics over both eight-turn protocols, with 0/5168 capped
and 0/5200 uncapped force misses. This is not new-law booklet or shipping UI
acceptance. Stocks and reader defaults remain unchanged; broader static FE coverage,
time accuracy, locking/bending, joins/drives, measured stock, 8 ms and device
gates remain open. The synthetic pass is not a stable catalogue release.

The [solved non-affine membrane stage](research/nonaffine-membrane-bvp.md) now has
[clean source 9bb captures and exact repeats](research/evidence/plane-stress-2026-11-10/README.md).
Stable base8 converges on 162/162 loads versus 100/162 with raw total potentials,
while two refinement checks still fail. The unchanged base16 window retains 20
local-convergence failures despite valid oracle/measurement/global balance.
A separately labeled fourfold16 window converges on 216/216 and passes its
bounded static same-mesh/eta/refinement gates under unchanged materials and
threshold formulas. All failures remain retained. At that source stable search is bench-only;
baseline World timestep Armijo is unchanged. Fixed-pose 80/100-digit checks leave a retained
base failure above tolerance and prove no impossibility of another equilibrium.
Physical stock, World time accuracy, new-law booklet, devices and 8 ms remain open.

A subsequent [opt-in World membrane/inertia increment search](research/membrane-increment-search.md)
now implements actual rounded trials and separate precision-limited/no-op decisions
under an enforced all-free planar domain. Independent high-precision tests retain
near-rest computed acceptances that are real potential increases. This arithmetic
is not certified descent; endpoint force and time accuracy still require their
unchanged independent gates. It is not enabled in the booklet reader.
At clean `6cd67d0`, all 24 candidate trajectories still contain force failures:
6973/7110 failed steps versus 6975/7110 baseline, gaining 58 old failures while
losing 56 old passes. All 31867 realized-zero Newton events are visibly rejected
as precision limited. Strict trajectory repeat and transparent-observer parity
pass. Independent 80/100-digit checks expose one real potential-increase among
69 retained sampled acceptances; this count does not cover all 17903 accepted
updates. A separate 32-probe full-proof equality gate fails on seven one-ULP
diagnostic sums, with every objective/error/Armijo field agreeing. Complete
[lossless captures and preserved failures](research/evidence/membrane-increment-2026-11-10/README.md)
remain research evidence; force/time/booklet/device acceptance stays open.

The next [two-word evaluation candidate](research/membrane-double-double.md)
now carries tangent/strain/gradient and endpoint low words under a bounded
arithmetic domain, with unchanged stored coefficients and native inertia.
The retained witness's projected slope error meets its predeclared numerical
target and its old energy-increasing proposal backtracks. This bounded
evaluation result does not establish trajectory force/time convergence.
The separate diagnostic-sum oracle repair changes no objective/Armijo result;
all original failed proofs remain retained.
At clean `e96c592`, the same 24 trajectories retain 6956/7110 force failures
versus 6973/7110 binary64: 49 steps gain and 32 regress; none is solved
throughout. Strict repeat, observer parity and 108 historical controls pass.
Independent paired evaluation improves stored-polynomial gradient errors on
all 85 retained poses, with unchanged native inertia. Among 59 sampled accepted
trajectory events, stored-polynomial real Armijo failures are zero, while two
UV/material increases occur at the same physical state. Native-rest DD probes
also retain that model-meaning difference. This does not certify all accepted
updates, physical rest, a resolved time limit or booklet/device performance.
The [complete preserved evidence](research/evidence/membrane-double-double-2026-11-10/README.md)
keeps the earlier failures and the separate diagnostic-only repair.

The [actual-reference membrane study](research/membrane-uv-reference.md) now
records exact stored-rest zero and improved ideal-UV component accuracy on all
85 frozen poses, with retained energy/projected-work regressions. Actual force
failures worsen from 6956 to 6968 of 7110 steps (16 gains, 28 losses); none of
24 trajectories is solved throughout. Strict repeat, observer parity and 108
historical controls pass. Among only 64 retained accepted endpoints, independent
real Armijo failures are zero; this does not certify all 13354 accepted updates.
The [complete evidence](research/evidence/membrane-reference-2026-11-10/README.md)
preserves failures, the comparison-path recovery and a documented prototype-source
gap. Force/time, material, fixed-booklet/device and 8 ms acceptance remain open.
The next bounded hypothesis, [authoritative displacement state](research/membrane-state-precision.md),
now has an opt-in implementation with separate latent/public residual gates,
exact initial-state conversion and boundary replay/refusal checks. Its first
frozen-witness experiment [now passes the latent gate while the original public
gate remains failed](research/membrane-state-results.md). The exact control passes
both; the accepted-update-with-unchanged-whole-public-pose gate remains false.
Fresh captures retain all 32 events and new independent proofs. Missing original
temporary records, exact recovered pre-fix source and new failure reproductions
are distinguished explicitly in the recovery ledger.
The [complete 24-trajectory state matrix](research/membrane-state-modal-results.md)
now retains 2369/7110 native authoritative failures, all at Newton budget1;
budgets4/16 pass throughout all16 corresponding trajectories. Public failures
worsen from6968 to7076 (16 gains,124 losses); no trajectory passes that gate
throughout. Exact repeat, observer parity and full historical numerical replay
pass. All459 retained endpoint proofs match at80/100 digits and meet the
sampled arithmetic limits;58 sampled accepted Newton updates satisfy independent
real Armijo. Continuous-state discrepancy still reaches22.3%, and whole force/time,
physical stock, new-model booklet/device and8 ms acceptance remain open.
The [lossless archive](research/evidence/membrane-state-modal-2026-11-10/README.md)
retains every judged step and explicit private-artifact exclusions. Reader and
historical defaults remain unchanged; research and implementation are not exhausted.
The first next step, [exact membrane curvature](research/exact-curvature-next-implementation.md),
is now implemented as opt-in `membraneCurvature: 'exact-hessian'` in that same
reference-displacement domain only (milestone 1). Its membrane blocks and products
equal the element exact Hessian, finite differences and an exact-rational oracle;
a finite nonpositive pivot rebuilds the Gauss–Newton factor once, visibly, and
snapshots replay the saved effective factor. Gauss–Newton and legacy trajectories
are byte-identical to the previous engine. A 3%-compression control converges
further than Gauss–Newton after three steps; that is a mechanism check, not
acceptance. The frozen 24-trajectory comparison against the closed capture has
not run, and no force/time, material, booklet or device result follows.

The [actual-World transient audit](research/membrane-transient-audit.md) now has
[clean 93f6653 captures, strict repeat and transparent-observer parity](research/evidence/membrane-transient-2026-11-10/README.md).
All 24 smoke trajectories contain strict force failures: 6975/7110 substeps miss
the unchanged threshold, despite small discrete-BE state errors. Independent
80/100-digit checks leave two retained endpoints above tolerance. Native mass,
baseline World timestep search, stocks and reader defaults are unchanged. The lossless
archive reconstructs every original captured byte, including failures. Time,
amplitude/solve isolation, broader geometry, material, new-law booklet, devices
and 8 ms acceptance remain open. All 16 source CI checks pass, including 214 engine
and 123 web tests; that does not close the physics failures.

The [source-pinned guarded-contact measurements](research/evidence/paper-2026-11-10/README.md)
now complete and repeat all eight turns with **0/5168** substeps missing the
declared 0.001 µN force tolerance, identical sampled-position hashes and all
recorded non-timing fields. Local active-frame p95 is 287–289 ms, still above
8 ms. This successful force gate uses the capped material model; the uncapped
S8/I8 first turn still misses tolerance on 103/672 substeps. Raising its budget
to I32 now completes and repeats the full **uncapped** sequence with **0/5200**
force misses. Local active p95 varies from 504 to 784 ms. An uncapped axial
loading/unloading check agrees within 0.92% of its synthetic bar reference and
isolates zero contact forces. Physical stock calibration, faster reading,
general coverage and actual-device acceptance remain open. No stable catalogue
physics release is implied.

Latest sampled physics evidence: the [2026-11-09 nightly at `77025d0`](https://github.com/madfam-org/pliego/actions/runs/42696487948)
tested 249 documents from 136 cartridges: 154 stable, 95 unstable (85 stretched
over 1%, 10 exploded), zero rejected/world/step errors, and 76 studio preview
fallbacks. Sixteen runs were truncated by their budget. This is a sampled,
time-compressed simulation matrix, not a full-corpus or fabrication proof; its
successful workflow conclusion is informational, not a stability threshold.
The two sampled `page-turn` variants, `a4-card` and `washi`, were stable and
interactive: mean steps about 18.9 and 22.5 ms, peak stretch about 0.25% and
0.45%, with no preview fallback. This supports their tested scope, not every
stock, parameter combination or bound-book reading mechanism.

**Lifecycle: incubating, first deploy live.** One container serves the three ruled hosts: the
landing at `https://pliego.madfam.io/`, the studio at `https://pliego-app.madfam.io/studio/` and the
API at `https://pliego-api.madfam.io/` (its JSON index; the routes are under `/api/v1/`, and
`/api/v1/` itself answers 404) (each answering 200 on 2026-10-10 and again on 2026-10-18,
including `/health`). The build live since 2026-10-18 is main at 1a8a8baf (pliego#42–#45 on top of
dcb5fcb8), proven by `/health` `revision`. Production changes only when a build is dispatched;
merges do not auto-deploy, so what is described below as merged after 1a8a8baf (the E3/E4/E5
engine and studio work, pliego#46–#55) is live only after the next dispatched build.

| Area | State (kernel, API, commons and simulation re-checked 2026-10-18; the rest 2026-10-10) |
|---|---|
| Contract (`docs/spec/v1`, sheet-document schema) | v1 in force; changes go through the coordinator. Spec §5.1–§5.20 and rules 1–21 (§5.13–§5.17 and rules 15–18 from the hardening wave: split cuts, initial-state conventions, canonical serialisation for `meta.digest`, presentation, data-URI art; §5.18–§5.20 and rules 19–21 from the engine wave: keyed mechanisms and `ride`, step-activated joins, untying joins); §5.40–§5.42 and rules 40–41 (RFC 0045 phase 2 minimum): laminate stocks, `material_ref` layers read from a vendored keystone snapshot, `hardware_ref` to Yantra4D name-level. The keystone's vendored copy of the schema needs a re-vendor before `pliego-spec check sheet-document` accepts a laminate stock |
| Kernel (`packages/kernel`) | built and tested (stdlib only; `pytest packages/kernel/tests`): authoring, planar arrangement with clearance-checked hole bridging and split cuts, fold programs (Tier R motion solver, layer-ordered `FoldProgram`), generators (tessellations, pop-ups, books, papercuts, reveal blocks, boards and corrugation, dielines, envelopes, finishes, papercraft nets), exporters (SVG, DXF, PDF, HPGL, GLB, FOLD) and `verify()` for every §8 rule. The API's GLB plays the fold program and the hinge/leaf/rotate/translate sweeps as morph-target animations, posed exactly as the studio preview poses them (parity with `engine-stub.js` within 2e-5 mm; 185 of the commons' 189 modes animate; the other 4 have neither a program nor a previewable mechanism); `slide` and driven pins stay static until the physics engine lands, and a very long program is sampled more coarsely to stay under a 16 MiB morph budget. Rules 15 (mechanisms move only rigid sheets) and 16 (closed `pliego:meta`) are errors since pliego#31 (2026-10-11), and rule 7 checks that a mechanism's control kind is one the mechanism accepts; the commons at 86a74fa is clean of all three |
| Engine (`packages/engine`) | merged: XPBD paper physics in plain JavaScript (`node --test packages/engine/test`), loads and verifies documents (fail closed). Glue zones narrower than the mesh weld sample points by default since 2026-10-18 (lane E3; A3 subset 156 → 159 stable, measured before pliego#53/#54, but the glued townhouse and kusudama ball explode and the kusudama ball steps about 10× slower; `glueSamples: false` restores the old behaviour). Not yet: closed glued models resting on the table stretch under position-level ground friction (glued dodecahedron 29 %), local stiffness from finishes, tearing and peel, stack contact, `represents` multiplicity, speed targets on large physical sheets (50–300 ms per step under load; lane E4, 2026-10-18: bit-identical speed-ups, about 9 % off the median document's step and 21 % off the corpus's summed step time, see the Simulation row; the 8 ms perf-bench target is not met: 200–820 ms per folding frame). It accepts split cuts (§5.13), recomputes `meta.digest` (§5.15, rule 10), presents §5.16 in its render output, and implements keyed mechanisms, step-activated joins and untying (§5.18–§5.20). A laminate stock's free-stack bending and membrane (`D_md`, `D_cd`, `D12`, `D66`, `E_md`, `E_cd`, §5.40) are read; the curl its coupling matrix B drives is not modelled yet. Since 2026-10-18 (lane E2): bounded edge–face contact for slit lips, opt-in by the edge name `interlock…` (`tab-and-slot`), a hand that eases when its drives would stretch the paper (since lane E3, 2026-10-18, only when the guard leaves a real residual, > 1e-4 of an edge: the deckle-tear card strip regression of #40, 0.66 → 1.26 %, is back to 0.53 %; A3 subset 156 → 158 stable), and a stretch guard that keeps projecting until it settles. Since 2026-10-18 (lane E3): creases follow the grain (stiffness D(φ)/√(D11·D22) of the crease's bending direction, so folding along the grain is softer by the card's D_md/D_cd), every hinge carries bending damping (Rayleigh, loss factor 0.025 [estimated]; a released flap settles about 17 % sooner and the world sleeps), set creases start on the branch of their rest angle and plain set lines keep it (spec §5.14; provisional call 3), and a free document whose initial pose dips below the table is lifted onto it. A3 subset: 156 → 158 stable, 4 → 1 exploded (ofrenda pop-ups 11 → 0.05 %, codex gathered 1902 → 2.6 %; fastener stitch pocket now explodes). The cards' `crease_set_rate` stays unused (a hold-time model would weaken every programmed crease; no measured curve). Next physics milestones: in-plane plasticity (kirigami ligaments, `rotating-squares`), contact inside the implicit solve (contact-induced stretch) and sliver triangles. Package (2026-10-22, owner ruling): publishable as `@pliego/engine` to MADFAM's registry `npm.madfam.io` (world-readable), by the dispatch-only `publish-engine.yml`; not published until a maintainer runs it |
| Studio and landing (`apps/web`) | built: catalog (with the previews), parameters, controls, fold-program scrubber, WebGL2 and Canvas 2D 3-D views, SVG crease-pattern view, exports, share links, four languages. Exports (since 2026-10-18, lane H5; live after the next dispatched build): every format the object publishes, plus the API's bundle (the document, its cut files and `variables.json` in one ZIP) when it publishes a cut format, each saved under the API's file name (`<slug>-<mode>.<extension>`, HPGL as `.plt`; before, the studio saved `<slug>.hpgl` without the mode and offered no bundle). The kinematic preview (`engine-stub.js`) is used when no engine is mounted; it honours §5.16 presentation and keeps paper above the table. Printed art, placed artwork and annotations render in the WebGL view (seen in a headless-Chromium run on 2026-10-18: the ofrenda's papel picado and marigolds); joins and slides stay disabled in the preview; relief and sheen of finishes are not rendered. Render path since 2026-10-18 (lane E5; merged is live only after the next dispatched build): the paper engine steps in a module Worker (main-thread fallback, `?worker=off`), frames are drawn only when the pose or the view changed and the loop sleeps when nothing moves, darkened paper edges, pressed creases, a soft table shadow whose penumbra widens with height, the crease overlay with the engine too, and up to 48 sheets with their own colours (16 before: an ofrenda's last four sheets took the 16th's colours). Measured in headless Chromium on an Intel UHD 630 under heavy machine load (A/B interleaved, numbers in the PR): with physics on, the main thread is 6–130 ms a second busy instead of all of it, about one long task per run instead of 45–200, and the studio draws up to 60 frames a second instead of 2–7; at rest it draws nothing instead of 60 frames a second. Physics itself is not faster: the sheet moves at 1.7–4.8 engine steps a second for these documents on that machine, somewhat fewer than on the main thread (the same step took about 1.5× the wall time in the Worker under that load; not measured on an idle machine). The Canvas 2D fallback has no printed art, darkened edges, pressed creases or soft shadow |
| API (`apps/api`) | built and tested: one Flask app serving the landing, studio, engine modules, schemas, `llms.txt`, robots/sitemap, `/.well-known/security.txt` on every host (RFC 9116, the SECURITY.md contact; since 2026-10-18, lane H5, live after the next dispatched build; `X-Robots-Tag: noindex` also on the landing host's copy of the studio, `/studio/…`, whose canonical is the app host) and `/api/v1` (catalog, documents, exports) with a sandboxed, killable cartridge runner, CORS allowlist, rate limits and a separate Prometheus `/metrics` listener; documented in `openapi.json`, served at `/api/v1/openapi.json` (live since the 1a8a8baf build: 200, 29 KB on 2026-10-18). Catalog previews: one crease-pattern SVG per cartridge (default mode, kernel SVG exporter, diagram palette) built at image build time and served at `/projects/<slug>.svg`; the strict build in CI is the coverage check (141 of 141: `/health` reports `thumbnails` 141 and `prerendered` 2455 in production on 2026-10-18, revision 1a8a8baf; 139 and 2415 before the dcb5fcb8 build). Render cache: exact (kernel output is byte-deterministic), per-worker memory LRU plus a shared `/tmp` disk tier, byte-bounded, Prometheus hit/miss/eviction counters; a hit skips the one-render-per-worker slot; first checked, a read-only prerendered tier built into the image (every cartridge, mode and applicable preset: documents and svg/dxf/hpgl exports under the runtime key; PDF, GLB and bundles stay runtime renders), so first views of heavy cartridges answer in about 50 ms locally instead of 30–45 s (a repeat render: 15–30 ms instead of 0.3–18 s locally). Every render is a GOC-1 generator instance (`X-Generator-*` headers); `format: "bundle"` exports a deterministic zip of the document, the cut files and `variables.json`, which the keystone's checker passes. A render of a mode that leaves a mode-scoped parameter uninjected reports `complete: false`. Live since the 2026-10-18 builds (pliego#34, in dcb5fcb8 and 1a8a8baf): the catalog takes one stat walk of the commons per request (it took 140, and `GET /api/v1/catalog` answered in 4.6–4.9 s in production; 0.28–0.32 s after the dcb5fcb8 build, 0.57–0.62 s time to first byte from a home connection on 2026-10-18), `/health` reports `revision` (the git commit of the build; `null` on a local build), and render errors carry a stable `code` and a `request_id` while the runner's stderr is logged server-side only (before, a runner crash without issues sent its last stderr lines to the client) |
| Commons (`sheet-hyperobjects`, mounted at `projects/`) | `projects/` is pinned at 86a74fa (sheet-hyperobjects#32): 139 cartridges, each one hyperobject family with modes and presets, four languages and an article; 732 sheet documents over every mode and preset, all passing `pliego-spec check sheet-document` (keystone 0.15.0, 2026-10-18) |
| Simulation (`scripts/qa/sim-matrix.mjs` over the commons) | run by hand, and nightly on every third document since 2026-10-18 (`nightly.yml`, informational: no CI baseline yet, so no threshold gates it). Baseline, all 732 documents, 2026-10-11 (before pliego#29): loads 708, stable 420 (57.4 %), unstable 288, rejected 13, errors 16; interactive (under 40 ms per step) 430, falls back to the kinematic preview 331. Latest, 2026-10-18, after pliego#29, on a 207-document subset (every third document of the sorted corpus; the run stopped at its timeout on a loaded machine): stable 136 of 207 (65.7 %), unstable 71 (62 stretched, 5 exploded, 4 `BlockCholesky: matrix not positive definite`), rejected 0. A subset, so it shows the direction, not a delta; its timings were taken under heavy load. Lane E2, 2026-10-18, the full A3 subset (244 documents, every third of the sorted corpus, same corpus for both runs): before (main ef11765) stable 152, unstable 92 (82 stretched, 5 exploded, 5 step errors); after the E2 engine changes stable 156, unstable 88 (82 stretched, 5 exploded, 1 step error); 144 of the 152 documents stable before kept a bit-identical peak stretch. A full 732-document run on an idle machine is still owed. Lane E4, 2026-10-18 (pliego#47–#50: profiling and bit-identity tools, allocation-free `Math.hypot`, skipped repeat passes, contact sides without a Map): the A3 subset, main and the three engine PRs together, run side by side (CPU clock, load 30–60): interactive (under 40 ms per step) 150 → 156, every status and every step's positions unchanged (`bench/identity.mjs`), median step time × 0.91, summed step time 41.4 s → 32.7 s; heaviest documents (sim-matrix mean ms/step) kusudama washi-large 5187 → 4447, stab-binding b5-tortoise 10751 → 7287, paper doily fine-lace 2460 → 2085, kusudama ball 1296 → 1194, ofrenda 228 → 152, ofrenda two-levels 256 → 156. About a third of the documents are not stable yet, and the engine's perf bench is far from its 8 ms target (1838 vertices fold at about 820 ms per frame) |
| Offline factory archive | opt-in draft `factory-preset-archive/0.1` producer/checker in `scripts/qa/factory_preset_archive.py`: pinned native source/runtime/material closure, requested and resolved parameters, native FOLD/animated GLB/SVG plus offline integrity/replay checks. No API/UI feed or deployment; see [adapter limits](factory-preset-archive.md) |
| Exporters and printed art | the SVG export places front art; PDF, DXF and HPGL ignore printed art (export parity is open) |
| CI (`.github/workflows/ci.yml`, `image.yml`, `nightly.yml`) | `ci.yml` lanes run on every PR: guards, compliance, kernel, stocks, engine, web, API. `image.yml` (added 2026-10-18; first run on its own PR): builds the production image, no push, and boots it (`/health`, `/ready`) on every PR that can change it. `nightly.yml` (added 2026-10-18; no scheduled run yet): the 732-document corpus through `pliego-spec` (fails on any error), then the simulation matrix on every third document (informational, no threshold yet) |
| Deploy (`build-deploy.yml`, `enclii.yaml`, `infra/k8s/production`) | dispatch-only builds through Enclii; the build checks out the commons (enclii#714); first deploy done (see the lifecycle line and docs/DEPLOYMENT.md) |
| Identity (Janua client `pliego-web`) | declared in `janua.client.yaml`; not provisioned |
| AI (Selva) | inert: no AI route is served |
| Commerce | none. No tiers, no prices, no checkout |

Rulings in force: commons object licence CERN-OHL-W-2.0 and hosts `pliego.madfam.io`,
`pliego-app.madfam.io`, `pliego-api.madfam.io` (owner, 2026-10-10). Pending: CLA vs DCO, the brand,
tiers.

Deployment detail and the remaining onboarding steps: docs/DEPLOYMENT.md.
