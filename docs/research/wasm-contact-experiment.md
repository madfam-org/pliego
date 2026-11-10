# Scalar binary64 contact-index backend

Status: opt-in prototype, `contactBroadPhase: 'wasm'`. Default remains
`'reference'`; `'bvh'` retains the JavaScript implementation. This ports the refit
and traversal kernel of the existing candidate BVH, not the force/material model.
There is no implicit fallback. Geometry, stocks, art and fabrication remain
unchanged. The retained equivalent-model runs establish recorded numerical parity
and a local timing improvement; the 8 ms, material and actual-device gates remain open.

The [WebAssembly value specification](https://webassembly.github.io/spec/core/syntax/values.html#floating-point)
defines binary64 and signed zero. Its
[nondeterminism register](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md)
means that format support alone cannot establish our replay contract. This kernel
uses scalar f64 min/max and comparisons, integer traversal and no shared memory,
relaxed SIMD, floating-point reassociation or imported math functions.

JS retains deterministic topology partitioning, primitive bounds, all adjacency/
weld filters, canonical pair ordering, active-edge selection and exact-pose reuse.
Current primitive boxes, order and flags copy into fixed Wasm32 memory on every
full build. Wasm refits all nodes and traverses them with the identical inclusive
predicates, stationary/rank pruning and enclosing-root shortcut. JS sorts integer
hits outside the enclosing-root shortcut. Query coordinates cross the call
boundary as six binary64 scalars. Visit counters remain binary64 and retain the
same increment order. A cold tree includes JS topology/initial refit followed by
the Wasm refit; subsequent refits run in Wasm. These costs are not hidden.

Native views currently require a little-endian host and reject other byte orders
before allocation. Addresses/sizes and ranks are checked before unsafe access; memory cannot
grow, and NaN boxes are refused. Infinite outward bounds remain supported.
Topology/counts are immutable as in the JS tree. This supported input domain is
not a general certificate for arbitrary degenerate geometry or floating-point CCD.
The existing feasibility/filter/model limitations remain.

`bench/wasm/bounds-tree.wat` is source; `wasm-bounds-code.js` embeds the generated
binary and source/compiler/binary digests. No runtime compiler dependency is added.
The build pins the [WABT JS binding](https://github.com/AssemblyScript/wabt.js)
1.0.39 and its compiler entry-file SHA256, verifies repeated binary output and
uses no SIMD/threads. The binding is a separate publisher from core WABT.

```sh
npm install --prefix /tmp/pliego-wabt --save-exact --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org wabt@1.0.39
node packages/engine/bench/wasm/build-bounds.mjs --wabt /tmp/pliego-wabt/node_modules/wabt --check
node --test packages/engine/test/wasm-bounds.test.js packages/engine/test/swept-bvh.test.js
node packages/engine/bench/isolated-broadphase.mjs --out-dir /tmp/pliego-isolated
```

Component schema 0.6 records separate constructor/first-build cost, including the
first lazy module compilation, instance memory and data copies. Mixed-process
and single-backend modes are distinct. Timed arrays and fixed warmup counts are
retained; a short warmup or polymorphic callsites can affect JIT results. A speedup
must be assessed using fresh-process controls and complete World.step cost,
not only a hot kernel loop. Dense output and initialization regressions remain
part of acceptance.

Fresh same-source BVH/Wasm reports use `compare-paper-backends.mjs`. It normalizes
only the declared execution selector, enumerated timing fields and their 8 ms
gate; every other source/runtime/input/physics field and sampled-pose hash remains
exact. The retained JS BVH control uses a separate explicitly fingerprinted
harness migration for CLI validation/backend-selection checks. No model option
or force tolerance is relaxed. The complete eight-turn comparisons and new-source
repeats below pass those recorded parity checks.


## Source-pinned results

[Accepted reports](evidence/paper-2026-11-10/README.md#scalar-binary64-webassembly-refitquery)
retain fresh JS controls and two Wasm runs for each model. All six full sequences
use clean source `4b48ec15ab40c5a5cc6c6b9002ecb5e44a82f0a8`, Node 20.19.5,
S8/I32, 492 vertices, the same eight-turn/672-frame protocol, surface-guarded
mollification and direct-local solving. No timing-dependent fallback or simulated
time compression is enabled. The JS/Wasm comparisons preserve every recorded
non-time physics result and full sampled-trajectory hash. Repeated Wasm reports
are exact after only enumerated clocks/recorded time are removed.

| Model | JS active-step p95 (ms) | Wasm first / repeat p95 (ms) | Force misses, each run |
|---|---:|---:|---:|
| Capped | 207.253 | 185.730 / 189.179 | 0 / 5168 |
| Uncapped | 311.924 | 283.464 / 278.003 | 0 / 5200 |

These local p95 values improve about 9–11% over their fresh JS controls and remain
far above 8 ms. Runs were sequential without another local campaign/test/browser
workload, but ordinary system background activity remains. They are neither a
statistical universal-speedup claim nor an input-to-paint/device certificate.
Passing the declared 0.001 µN force tolerance validates convergence for these
models and inputs, not physical stock calibration or general contact coverage.

The runtime engine at `c05de1a63872e4d850827f69d6a786de0e9189af` differs from that
measured engine only by the little-endian host check, which rejects unsupported
native memory layouts before allocation. The kernel and physics arithmetic are
unchanged. Fresh supported-host first-turn JS/Wasm controls at that source pass
all recorded non-time parity checks against each other and their pre-guard
controls. Full eight-turn timings above are explicitly the earlier source.

The [isolated component reports](evidence/paper-2026-11-10/wasm-isolated/isolated-comparison.json)
use three fresh process pairs, alternating backend order, 32 warmup builds and
nine measured builds per scene. Ordered pairs and structural work match exactly.
The table reports the median of the three per-process wall-time medians.

| Full candidate build | JS (ms) | Wasm (ms) |
|---|---:|---:|
| Native initial energy | 0.918 | 0.754 |
| Retained native late energy | 1.486 | 1.162 |
| Retained native late sweep | 0.931 | 0.763 |
| Synthetic large prescribed sweep | 126.518 | 101.786 |
| Synthetic dense all-free | 76.884 | 85.704 |

The dense-output case regresses in all three pairs. Borrowed Wasm-memory hits,
JS sorting/filtering and data copies remain measured costs; a host-owned hit
buffer or batched interface is an untested hypothesis, not an established fix.
The late inputs are retained older unsmoothed poses, not a new full trial corpus.
Short two-build warmups produced materially different JIT timings; the accepted
comparison retains the longer fixed warmup rather than treating that preliminary
speedup as evidence. On the first scene, JS constructor/first-build costs were
0.463/20.820 ms and Wasm 1.442/17.511 ms, including lazy compilation/instantiation.
The native candidate builder allocates 524288 bytes of Wasm memory across its two
trees; with potential and guard builders instantiated, this is about 1 MiB per
World, or 2 MiB at the two-world reader-cache peak, in addition to host-side storage.
The JS report's zero Wasm-memory bytes does not mean zero JS memory use.

Paired first-turn whole-process profiles also retain exact recorded non-time
backend parity. The sanitizer preserves sample IDs/weights while stripping local
paths before public summary reduction. Attribution verifies the recorded runtime engine tree, the unchanged
kernel binary and exported function indices, and requires a sole observed Wasm
module; unknown/multiple modules are rejected. For an older runtime, provide its
archived engine source with `summarize-paper-profile.mjs --engine-source`.
Reducers are fingerprinted separately from runtime source. The reducer assumes
that the supplied raw profile belongs to the supplied run: separate input hashes
do not prove capture association or bind an arbitrary Wasm trace to the kernel.
The retained pair was captured together under this protocol; raw profiles remain
local because they contain filesystem paths.

Candidate-related sample share is 54.28% for JS and 49.00% for Wasm. The latter
includes Wasm query 9.96%, refit 5.74%, wrapper 6.34%, JS/Wasm boundary 0.67% and
JS candidate construction/filtering in `swept.js` 26.07%, plus initial-tree/code
samples. Wasm samples are not classified as free or generic runtime work.
These are V8 time-delta-weighted leaf samples including loading, construction,
JIT and diagnostics, not retired instructions or isolated step timings. They
justify reducing hit/filter/copy work; the 0.67% boundary share alone cannot
justify batching merely to remove calls. They do not establish that another
kernel port will close the 8 ms gap. Strict binary64 SIMD, batching, alternative indices,
solver/model/time-accuracy work and actual-device acceptance remain separate
experiments.

## Browser policy probe

The studio dev-server and API currently use `script-src 'self'` without a Wasm
compilation permission. Browser capability and application integration must
therefore be tested separately. The loopback-only research harness serves a
strict-policy negative test and an explicitly permitted research-policy test;
it does not change production headers. The allowed page compares both capped
and uncapped S8/I32 first turns, positions/velocities as bytes, pre-promotion
release poses and force/contact diagnostics. It reports source fingerprints
and verifies source integrity when saving results outside the checkout.

```sh
node packages/engine/bench/wasm/browser-server.mjs --port 8246 --out /tmp/wasm-browser
# Open http://127.0.0.1:8246/strict/ and /allow/ in a real browser.
```

This is a CPU backend/policy probe, not input-to-paint, rendering or real-touch
acceptance. A positive research policy is not a production-policy certificate.
The [strict-policy result](evidence/paper-2026-11-10/wasm-browser-strict.json)
records the expected compilation block. The
[permitted-policy result](evidence/paper-2026-11-10/wasm-browser-allow.json)
passes both 84-frame/672-substep capped and uncapped first turns: positions and
velocities as bytes, every recorded force/contact diagnostic and pre-promotion
release poses agree, with zero force misses. Source integrity is verified at
clean `d969fe0190e16eafac249c6a2ef521df05fa5341`; its engine bytes equal the
full-run `4b48ec1` engine. The browser was Chrome 157 on a little-endian host.
Only the research positive page permits `wasm-unsafe-eval`; studio/API policy,
default reader and production headers remain unchanged. This is evidence of
capability/parity under that research policy, not shipping availability.
