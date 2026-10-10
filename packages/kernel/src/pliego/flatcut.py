"""Cuts through chosen layers of a flat-folded state (`pliego.flatcut`).

`cut(state, (p0, p1), at=, layers=, faces=, sheet_points=)` cuts the folded paper along the
segment p0–p1 (folded frame) — through every layer it crosses, or through chosen layers — and
returns a checked `pliego.flatops.Move` whose state carries the cut as **slits** on the flat sheet:
each cut layer's part of the segment, mapped back through that layer's placement (the pre-image
mapping `pliego.foldcut` uses for whole regions, here for one segment per layer).

A slit is an edge whose two faces are not joined: no crease, no placement or layer constraint
across it, no flap selection through it; `FlatState.unfold()` writes it as a cut (`C`). A face is
split along the slit's whole line so faces stay convex; where the slit ends inside the face the
rest of that line is a **seam** — the faces stay joined flat there and the flat sheet has no line
— until a later move folds it (then it is a crease like any other).

Today a slit's two sides share their end vertices on the flat sheet (`Sheet.cut`); once the sheet
splits cut vertices along slits, poses that open a slit (a trim tab turned, a slot opened) are
exact in every frame, not only in the fold program's face-tree steps.
"""

from __future__ import annotations

import math
from collections.abc import Iterable

from .flatcheck import require_valid
from .flatops import Move, _cut_face, _inherit, _repair, _stack_at, flood
from .flatstate import (
    TOL,
    Face,
    FlatState,
    FlatStateError,
    PointPool,
    Pt,
    as_line,
    pt,
    side,
    xf_apply,
    xf_invert,
)

CUT_MIN_MM = 1e-3   # a layer is cut only where the segment runs inside it longer than this


def _span(img: list[Pt], p: Pt, d: Pt) -> tuple[float, float] | None:
    """Parameters (along the line p + t·d) where the line runs strictly inside a convex CCW
    polygon, or None."""
    lo, hi = -math.inf, math.inf
    n = len(img)
    for i in range(n):
        a, b = img[i], img[(i + 1) % n]
        ex, ey = b[0] - a[0], b[1] - a[1]
        el = math.hypot(ex, ey)
        if el < 1e-12:
            continue
        s0 = (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / el        # inside > 0
        ds = (ex * d[1] - ey * d[0]) / el
        if abs(ds) < 1e-12:
            if s0 <= TOL:
                return None
            continue
        t = -s0 / ds
        if ds > 0:
            lo = max(lo, t)
        else:
            hi = min(hi, t)
    return (lo, hi) if hi - lo > CUT_MIN_MM else None


def cut(state: FlatState, segment, *, at=None, layers: int | None = None,
        faces: Iterable[int] | None = None, sheet_points: Iterable | None = None,
        from_: str = "top") -> Move:
    """Cut along the folded segment p0–p1 through every layer it crosses, or through the layers
    picked at `at` (a folded point on the segment; default its midpoint) — the top (`from_="top"`)
    or bottom `layers` there, or the layers of the faces / sheet points given — and the same
    layers wherever they continue flat along the segment. The paper does not move."""
    what = "cut"
    a0, a1 = pt(segment[0]), pt(segment[1])
    p, d = as_line((a0, a1))
    length = math.hypot(a1[0] - a0[0], a1[1] - a0[1])
    crossed: dict[int, tuple[float, float, float, float]] = {}
    for f in range(len(state.faces)):
        sp = _span(state.image(f), p, d)
        if sp is None:
            continue
        t0, t1 = max(sp[0], 0.0), min(sp[1], length)
        if t1 - t0 > CUT_MIN_MM:
            crossed[f] = (t0, t1, sp[0], sp[1])
    if not crossed:
        raise FlatStateError(f"{what}: the segment crosses no paper")
    picked = set(crossed)
    if layers is not None or faces is not None or sheet_points is not None:
        if faces is not None:
            seeds = set(faces) & picked
        elif sheet_points is not None:
            seeds = {state.face_at(q) for q in sheet_points}
        else:
            q = pt(at) if at is not None else ((a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2)
            if abs(side(p, d, q)) > 1e-6:
                raise FlatStateError(f"{what}: the selection point is not on the segment")
            stack = _stack_at(state, q, picked)
            if not 1 <= int(layers) <= len(stack):
                raise FlatStateError(f"{what}: {layers} layers asked, {len(stack)} at the point")
            seeds = set(stack[-int(layers):] if from_ == "top" else stack[:int(layers)])
        if not seeds or not seeds <= picked:
            raise FlatStateError(f"{what}: a selected layer is not crossed by the segment")
        picked = flood(state, seeds, picked.__contains__,
                       lambda f, x, y: state.crease_angle(f, state.half_edges()[(y, x)]) != 0.0)
    pool = PointPool(state.points)
    new_faces: list[Face] = []
    parent: list[int] = []
    ends: list[int] = []
    cuts: list[tuple[Pt, Pt]] = []
    seams: list[tuple[Pt, Pt]] = []
    for f, face in enumerate(state.faces):
        halves = _cut_face(state, f, p, d, pool, True) if f in picked else None
        if halves is None:
            new_faces.append(face)
            parent.append(f)
            continue
        t0, t1, c0, c1 = crossed[f]
        inv = xf_invert(face.xf)

        def at_t(t: float, inv=inv) -> Pt:
            return xf_apply(inv, (p[0] + t * d[0], p[1] + t * d[1]))
        s0, s1 = at_t(t0), at_t(t1)
        cuts.append((s0, s1))
        if t0 > c0 + TOL:
            ends.append(pool.add(s0))
            seams.append((at_t(c0), s0))
        if t1 < c1 - TOL:
            ends.append(pool.add(s1))
            seams.append((s1, at_t(c1)))
        for cyc in halves:
            new_faces.append(Face(cyc, face.xf))
            parent.append(f)
    out = state.derive(points=pool.points, faces=_repair(new_faces, pool.points, ends), order={},
                       cuts=state.cuts + tuple(cuts), seams=state.seams + tuple(seams))
    out = _inherit(out, state, parent, what)
    require_valid(out, what)
    return Move("cut", state, out, parent, lambda t: {}, [1.0],
                {"segment": (a0, a1), "faces": sorted(picked), "slits": cuts, "seams": seams})


__all__ = ["cut"]
