"""Fold-and-cut by pre-image mapping (papel picado, jianzhi, snowflakes, kirigami cards).

After simple folds (`simplefold.FoldedState`), `cut(state, regions)` removes every point of the
sheet whose folded image lies inside any region (folded frame). The region boundaries are mapped
back through every layer (clipped to that layer), added to the sheet's arrangement together with
the fold creases, and each face is classified kept/removed by mapping an interior point forward.
The kept region's boundary becomes the new outline and holes. Exact for polygonal regions (up to
the 1e-6 mm grid).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .arrangement import SegmentInput, build_arrangement
from .exact import GRID
from .geometry import (
    EPS,
    PointLike,
    Vec2,
    as_vec,
    point_in_polygon,
    polygon_area,
    polygon_centroid,
)
from .sheet import Sheet
from .simplefold import FoldedState, apply, invert


@dataclass
class FoldCutResult:
    sheet: Sheet
    removed_area: float
    kept_area: float
    islands: list[list[Vec2]] = field(default_factory=list)  # kept pieces that fell away

    @property
    def connected(self) -> bool:
        return not self.islands


def interior_point(ring: list[Vec2]) -> Vec2:
    """A point strictly inside a simple polygon (centroid, else an ear-triangle centroid)."""
    c = polygon_centroid(ring)
    if point_in_polygon(c, ring) == 1:
        return c
    n = len(ring)
    for i in range(n):
        a, b, cc = ring[i - 1], ring[i], ring[(i + 1) % n]
        if (b - a).cross(cc - b) <= 0:
            continue
        t = Vec2((a.x + b.x + cc.x) / 3, (a.y + b.y + cc.y) / 3)
        if point_in_polygon(t, ring, eps=1e-7) == 1:
            return t
    for i in range(n):  # fall back: a point just left of an edge midpoint
        a, b = ring[i], ring[(i + 1) % n]
        m = a.lerp(b, 0.5) + (b - a).perp().normalized() * 1e-4
        if point_in_polygon(m, ring, eps=1e-7) == 1:
            return m
    raise ValueError("cannot find an interior point")


def _clip_segment(p: Vec2, q: Vec2, poly: list[Vec2]) -> tuple[Vec2, Vec2] | None:
    """Cyrus–Beck clip of segment pq to a convex CCW polygon."""
    t0, t1 = 0.0, 1.0
    d = q - p
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        e = b - a
        num = e.cross(p - a)  # ≥ 0 inside (left of a→b)
        den = e.cross(d)
        if abs(den) < 1e-15:
            if num < -1e-12:
                return None
            continue
        t = -num / den
        if den > 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    if (t1 - t0) * d.length() <= EPS:
        return None
    return (p + d * t0, p + d * t1)


def cut(state: FoldedState, regions: list[list[PointLike]] | list[PointLike],
        id: str = "cut", **sheet_kwargs) -> FoldCutResult:
    """Cut `regions` (polygons in the folded frame) through every layer and unfold."""
    regs = _regions(regions)
    segs: list[SegmentInput] = []
    for a, b, asg in state.creases:
        segs.append(SegmentInput(a, b, asg, 180.0 if asg == "V" else -180.0, "crease", 0))
    for lay in state.layers:
        inv = invert(lay.xf)
        for reg in regs:
            pre = [apply(inv, p) for p in reg]
            for i in range(len(pre)):
                hit = _clip_segment(pre[i], pre[(i + 1) % len(pre)], lay.poly)
                if hit is not None:
                    segs.append(SegmentInput(hit[0], hit[1], "U", 0.0, "none", 1))
    arr = build_arrangement(list(state.outline), [], segs)
    verts = arr.vertices
    removed = set()
    kept_area = removed_area = 0.0
    for fi, f in enumerate(arr.faces):
        ring = [verts[v] for v in f]
        pt = interior_point(ring)
        img = state.to_folded(pt)
        gone = img is not None and any(point_in_polygon(img, r) == 1 for r in regs)
        if gone:
            removed.add(fi)
            removed_area += polygon_area(ring)
        else:
            kept_area += polygon_area(ring)
    if not removed:
        raise ValueError("the cut regions remove nothing from the sheet")
    if len(removed) == len(arr.faces):
        raise ValueError("the cut regions remove the whole sheet")
    cycles = _kept_boundary(arr, removed)
    outers = sorted((c for c in cycles if polygon_area(c) > 0), key=lambda c: -polygon_area(c))
    holes = [c for c in cycles if polygon_area(c) < 0]
    outline = outers[0]
    sheet = Sheet(id, outline, **sheet_kwargs)
    for h in holes:
        probe = interior_point(list(reversed(h)))
        if point_in_polygon(probe, outline) == 1:
            sheet.hole(list(reversed(h)))
    for a, b, asg in state.creases:
        sheet.crease(a, b, "valley" if asg == "V" else "mountain", 180.0)
    return FoldCutResult(sheet, removed_area, kept_area, outers[1:])


def _regions(regions) -> list[list[Vec2]]:
    if regions and not isinstance(regions[0], list | tuple) or (
            regions and isinstance(regions[0], tuple) and len(regions[0]) == 2
            and isinstance(regions[0][0], int | float)):
        regions = [regions]
    out = []
    for r in regions:
        ring = [as_vec(p) for p in r]
        if len(ring) < 3 or abs(polygon_area(ring)) < EPS * EPS:
            raise ValueError("a cut region needs at least 3 points and some area")
        out.append(ring if polygon_area(ring) > 0 else ring[::-1])
    return out


def _kept_boundary(arr, removed: set[int]) -> list[list[Vec2]]:
    """Boundary cycles of the kept faces (kept region on the left)."""
    from functools import cmp_to_key


    kept_half: set[tuple[int, int]] = set()
    for fi, f in enumerate(arr.faces):
        if fi in removed:
            continue
        for k in range(len(f)):
            kept_half.add((f[k], f[(k + 1) % len(f)]))
    bnd = sorted(h for h in kept_half if (h[1], h[0]) not in kept_half)
    out_by: dict[int, list[int]] = {}
    for a, b in bnd:
        out_by.setdefault(a, []).append(b)
    g = arr.grid
    used: set[tuple[int, int]] = set()
    cycles: list[list[Vec2]] = []
    for start in bnd:
        if start in used:
            continue
        cyc: list[int] = []
        h = start
        while h not in used:
            used.add(h)
            cyc.append(h[0])
            a, b = h
            options = [w for w in out_by.get(b, []) if (b, w) not in used]
            if not options:
                break
            if len(options) > 1:
                back = (g[a][0] - g[b][0], g[a][1] - g[b][1])

                options.sort(key=cmp_to_key(lambda u, w, b=b, back=back: _cw_cmp(
                    back, (g[u][0] - g[b][0], g[u][1] - g[b][1]),
                    (g[w][0] - g[b][0], g[w][1] - g[b][1]))))
            h = (b, options[0])
        cycles.append([Vec2(g[i][0] / GRID, g[i][1] / GRID) for i in cyc])
    return cycles


def _cw_cmp(back: tuple[int, int], u: tuple[int, int], w: tuple[int, int]) -> int:
    """Order candidate directions clockwise starting just after `back` (tightest left turn)."""
    import math

    def key(d: tuple[int, int]) -> float:
        a = math.atan2(back[1], back[0]) - math.atan2(d[1], d[0])
        return a % (2 * math.pi) or 2 * math.pi

    ku, kw = key(u), key(w)
    return -1 if ku < kw else (1 if ku > kw else 0)
