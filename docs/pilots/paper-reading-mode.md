# Native paper reading input

Last Updated: 2026-11-09

> Boundary: public-safe interaction contract. Operational release evidence stays
> in the private ops repository; follow [the public repository boundary](../PUBLIC_REPO_BOUNDARY.md).

The studio has an explicit fixed-camera paper interaction for a single native
leaf. It connects pointer/touch travel to the existing leaf mechanism's angle
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

- Start a primary pointer or touch drag on the leaf. Drag left to increase the
  native turn angle toward 180 degrees, or right toward zero. Background and
  backing-sheet drags do nothing.
- Release past the midpoint to settle at the far endpoint; release earlier to
  return. The native rate-limited soft hand band supplies bend and springback;
  horizontal input is normalized to the viewport, not interpreted as millimetres.
- Escape, pointer cancellation, lost capture, blur, a hidden document, resize or
  a second pointer restores the control held at gesture start. Destruction also
  releases captures and removes input/visibility/resize listeners.
- ArrowRight turns to 180 degrees and ArrowLeft to zero on the focused canvas.
  Ordinary wheel scrolling passes through. Pinch, modifier-wheel and +/− zoom;
  no reading-mode drag or arrow key orbits or pans the camera.

The slider and construction controls continue to reflect the same control that
the gesture drives. Input is rebound when a document or engine changes, so no
gesture is carried into another object. Worker steps pause while the document
is hidden and resume through the existing visible-frame scheduling path.

## Supported scope

Admission requires exactly one unkeyed native `leaf` mechanism, a resolvable
sheet ID and its `angle` control with the documented 0–180 degree range. The real
paper engine must be active. Multiple leaves, keyed mechanisms, missing engine
and the rigid preview retain their construction controls and show an unavailable
message; paper input never silently falls back to camera orbit or claims elastic
physics for a rigid preview.

This is a single-leaf interaction, not a bound multi-page reader, catalogue
publisher or commercial integration. The [archive companion](archive-companion.md)
still shows its native nest/staple/shut construction sequence; its logical
reading pages do not become independently turning physical leaves. No document
geometry, imposition, fabrication export or physics constants are changed.

## Verification

```sh
node --test apps/web/test/reading-input.test.mjs
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
