# Native paper reading input

Last Updated: 2026-11-09

> Boundary: public-safe interaction contract. Operational release evidence stays
> in the private ops repository; follow [the public repository boundary](../PUBLIC_REPO_BOUNDARY.md).

The studio has an explicit fixed-camera paper interaction for a native single
leaf or an independent multi-leaf codex. It connects pointer/touch travel to the existing leaf mechanism's angle
control and uses the owning Pliego solver to bend and settle the paper. The
default studio interaction remains inspection with orbit/pan controls.

## Try locally

From a checkout with Node 20 or newer, run:

```sh
node apps/web/dev-server.mjs --port 8742
```

Open
`http://127.0.0.1:8742/studio/?slug=page-turn&interaction=paper&engine=physics`.
The local static server loads the existing hand-authored `page-turn.fold` demo
and the checkout's native engine; it does not need the API or a service account.
The share link preserves the interaction and engine selection. The optional
`worker=off` query exercises the main-thread engine path.

The generated native eight-page book is at
`http://127.0.0.1:8742/studio/?slug=booklet-reading&interaction=paper&engine=physics`.
Its four leaves and copy-80 stock snapshot come from `pliego.book.codex`, with
original synthetic page-number art. Regenerate/check both native campaign fixtures
with `PYTHONPATH=packages/kernel/src .venv/bin/python scripts/qa/make_paper_fixtures.py [--check]`.

- Start a primary pointer or touch drag on the leaf. Drag left to increase the
  native turn angle toward 180 degrees, or right toward zero. Background and
  backing-sheet drags do nothing.
- Release past the midpoint to settle at the far endpoint; release earlier to
  return. The native rate-limited soft hand band supplies bend and springback;
  the single-leaf adapter normalizes horizontal input to the viewport. Codex input
  projects the pointer onto the native book plane and maps its horizontal position
  to the turn arc, so the threshold follows the visible page and zoom.
- Escape, pointer cancellation, lost capture, blur, a hidden document, resize or
  a second pointer restores the control held at gesture start. Destruction also
  releases captures and removes input/visibility/resize listeners.
- ArrowRight turns to 180 degrees and ArrowLeft to zero on the focused canvas.
  Ordinary wheel scrolling passes through. Pinch, modifier-wheel and +/− zoom;
  no reading-mode drag or arrow key orbits or pans the camera.

In a codex, only the exposed right page or last turned left page can be selected.
The previous/next buttons and arrow keys visit spreads 1, 2–3, 4–5, 6–7, 8 in
order and reverse that order. Release is serialized; restart visits the preceding
leaves sequentially. The camera frames the entire open book once, and stays fixed
as pages move. Book reading currently runs the native engine on the main thread.

Single-leaf sliders continue to reflect the control the gesture drives. Codex
reading hides independent construction sliders and uses the reading transport.
Input is rebound when a document or engine changes, so no
gesture is carried into another object. Worker steps pause while the document
is hidden and resume through the existing visible-frame scheduling path.

## Supported scope

Single-leaf admission requires one unkeyed native `leaf` mechanism, a resolvable
sheet ID and its `angle` control with the documented 0–180 degree range. Codex
admission requires 2–32 independent rectangular leaves, matching dimensions,
aligned spines, native initial poses and spine pins, with zero-default leaf controls.
This excludes imposed signatures and construction programs. The real
paper engine must be active. Unsupported constructions, keyed mechanisms, missing engine
and the rigid preview retain their construction controls and show an unavailable
message; paper input never silently falls back to camera orbit or claims elastic
physics for a rigid preview.

The bounded codex model uses one flexible native leaf and fixed resting sheets,
with at most two solver worlds cached. After 1.4 seconds of release simulation,
the leaf is promoted to a flat resting block. Idle blocks do no solver work.
Plasticity is disabled for this elastic reading model. The pre-promotion release
pose/statistics remain available to the benchmark; the flat endpoint is **not**
evidence of a physically converged stack. The fore-edge hand band, full stack
contact, arbitrary-location grabbing and target-phone performance remain subjects
of the [physics campaign](../research/paper-physics-campaign.md).

This is not a catalogue publisher or commercial integration. The [archive companion](archive-companion.md)
still shows its native nest/staple/shut construction sequence; its logical
reading pages do not become independently turning physical leaves. Reading poses
do not modify native source geometry, imposition, stock snapshots or fabrication exports.

## Verification

```sh
node --test apps/web/test/reading-input.test.mjs
node --test apps/web/test/book-reader.test.mjs
node --test apps/web/test/*.test.mjs
python3 scripts/qa/verify_compliance.py
python3 scripts/qa/verify_deploy_paths.py
```

The targeted tests exercise admission, input teardown/cancellation, pinch
capture, keyboard, share state and forward/backward movement with the actual
native solver. Browser acceptance on 2026-11-09 used the local studio's Worker
engine: forward and backward drags reached 180 and zero, a short drag returned,
background drags were inert, arrow keys turned the leaf, and the preview boundary
was explicit. These checks do not establish whole-corpus stability, real-device
touch performance, fabrication quality or a deployed release. Production changes
still require the normal dispatched build and runtime acceptance.

Codex tests additionally cover four forward/four backward physical turns, cancelled
partial turns, queued navigation, resting-page immobility, endpoint blocks,
bounded cache eviction/restore, native source/art preservation, zero idle stepping
and elapsed simulation time. Numerical and browser evidence are recorded separately
in the campaign; a passing interaction test cannot close material/contact validation.
Browser codex acceptance also verified spread order through a readable back cover,
page-relative forward/reverse drags at 390 px, fixed framing, inert background,
idle pause and EN/ES state. The viewport check used pointer input, not a real touch
device. See the [source-pinned results](../research/evidence/paper-2026-11-09/README.md).
