"""Fold angles and layer orders of a flat state on a kernel arrangement (`pliego.foldpattern`):
the bridge between a `FlatState` and the crease pattern it unfolds to. Re-exported by
`pliego.foldprogram`."""

from __future__ import annotations

import math
from collections.abc import Sequence

from .flatstate import FlatState, FlatStateError, centroid, inside_convex, overlap, xf_apply


def edge_angles(state: FlatState, arr, edges: Sequence[int] | None = None) -> dict[int, float]:
    """Fold angle of each crease edge of a kernel arrangement (a sheet built from this state's
    creases, or any finer one) in this flat state."""
    from .kinematics import face_adjacency

    m = [state.face_at(c) for c in face_points(arr)]
    ef: dict[int, tuple[int, int, int, int]] = {}
    for f, lst in face_adjacency(arr).items():
        for g, e, a, b in lst:
            if e not in ef and (edges is None or e in edges):
                ef[e] = (f, g, a, b)
    return edge_angles_mapped(state, arr, m, ef)


def face_points(arr) -> list[tuple[float, float]]:
    """A point inside every face of an arrangement: its centroid, or (a face that is not convex
    or that a slit enters) an interior point."""
    from .foldcut import interior_point
    from .geometry import Vec2, point_in_polygon

    out = []
    for f in arr.faces:
        ring = [arr.vertices[v] for v in f]
        c = centroid([(v.x, v.y) for v in ring])
        if point_in_polygon(Vec2(*c), ring) != 1:
            q = interior_point(ring)
            c = (q.x, q.y)
        out.append(c)
    return out


def edge_angles_mapped(state: FlatState, arr, m: list[int],
                       edge_faces: dict[int, tuple[int, int, int, int]]) -> dict[int, float]:
    """Fold angle of each arrangement edge (`edge_faces`: e → (f, g, a, b), f on the left of
    a→b) in a flat state, `m[f]` the state face holding face f's interior point. Where an
    arrangement face spans several state faces (joined flat across a slit's seam), each side of
    the edge is read on the state face that touches it."""
    out = {}
    for e, (f, g, a, b) in edge_faces.items():
        fa, fb = m[f], m[g]
        if state.seams:
            pa, pb = arr.vertices[a], arr.vertices[b]
            mid = ((pa.x + pb.x) / 2, (pa.y + pb.y) / 2)
            ln = math.hypot(pb.x - pa.x, pb.y - pa.y)
            nrm = (-(pb.y - pa.y) / ln, (pb.x - pa.x) / ln)      # towards f
            for k, sgn in ((0, 1.0), (1, -1.0)):
                fc = (fa, fb)[k]
                if not inside_convex(mid, state.poly(fc), -1e-4):
                    probe = (mid[0] + sgn * 1e-3 * nrm[0], mid[1] + sgn * 1e-3 * nrm[1])
                    if k == 0:
                        fa = state.face_at(probe)
                    else:
                        fb = state.face_at(probe)
        out[e] = 0.0 if fa == fb else state.crease_angle(fa, fb)
    return out


def face_orders(state: FlatState, arr) -> list[list[int]]:
    """The complete layer order of a flat state on a kernel arrangement's faces, as FOLD
    ``faceOrders`` triples [f, g, s]: s = +1 when face f lies on the side of face g's normal
    (its front), −1 behind it. Every pair of overlapping faces on different layers is listed."""
    if state.cuts or state.seams:
        return _face_orders_covered(state, arr)
    cents = [centroid([(arr.vertices[v].x, arr.vertices[v].y) for v in f]) for f in arr.faces]
    m = [state.face_at(c) for c in cents]
    out: list[list[int]] = []
    poly = []
    for i, f in enumerate(arr.faces):
        xf = state.faces[m[i]].xf
        pts = [xf_apply(xf, (arr.vertices[v].x, arr.vertices[v].y)) for v in f]
        poly.append(pts if not state.flipped(m[i]) else pts[::-1])
    for i in range(len(arr.faces)):
        for j in range(i + 1, len(arr.faces)):
            if m[i] == m[j] or not overlap(poly[i], poly[j]):
                continue
            up = state.above(m[i], m[j])
            if up is None:
                continue
            s_ij = 1 if up == (not state.flipped(m[j])) else -1
            out.append([i, j, s_ij])
    return out


def _face_orders_covered(state: FlatState, arr) -> list[list[int]]:
    """`face_orders` where arrangement faces need not be convex (slits) and may span several
    state faces (seams): each arrangement face is the union of the state faces inside it; two
    overlap where any of their state faces do, ordered as those state faces are."""
    from .geometry import Vec2, point_in_polygon

    rings = [[arr.vertices[v] for v in f] for f in arr.faces]
    cover: list[list[int]] = [[] for _ in arr.faces]
    for sf in range(len(state.faces)):
        c = Vec2(*centroid(state.poly(sf)))
        for i, ring in enumerate(rings):
            if point_in_polygon(c, ring) == 1:
                cover[i].append(sf)
                break
        else:
            raise FlatStateError(f"face_orders: state face {sf} lies in no arrangement face")
    out: list[list[int]] = []
    for i in range(len(arr.faces)):
        for j in range(i + 1, len(arr.faces)):
            for a in cover[i]:
                hit = next((b for b in cover[j] if a != b and state.above(a, b) is not None),
                           None)
                if hit is not None:
                    up = state.above(a, hit)
                    out.append([i, j, 1 if up == (not state.flipped(hit)) else -1])
                    break
    return out
