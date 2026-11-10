# Scalar binary64 contact-index backend

Status: opt-in prototype, `contactBroadPhase: 'wasm'`. Default remains
`'reference'`; `'bvh'` retains the JavaScript implementation. This ports the refit
and traversal kernel of the existing candidate BVH, not the force/material model.
There is no implicit fallback. Geometry, stocks, art and fabrication remain
unchanged. Full physics, performance and browser/device gates require evidence.

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
node packages/engine/bench/broadphase-pairs.mjs --only bvh --warmup 32 --out /tmp/js-components.json
node packages/engine/bench/broadphase-pairs.mjs --only wasm --warmup 32 --out /tmp/wasm-components.json
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
or force tolerance is relaxed. Full sequences and replay remain pending here.


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
Browser results are pending at this implementation checkpoint.
