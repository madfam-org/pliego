"""Papercut validation, motif primitives and symmetry generators.

`analyze(sheet, min_feature_mm)` checks that the kept material is connected (islands reported),
that every material bridge is at least `min_feature_mm` wide (the stock card's
``fabrication.min_feature_mm``) and that no removed sliver is narrower than the cutter minimum.
Motifs return CCW polygons (sheet mm); symmetry generators replicate polygons (n-fold wedge,
mirror, accordion repeat). Traditional motifs (papel picado — San Salvador Huixcolotla, Puebla —,
jianzhi, wycinanki, …) are cultural heritage: cartridges cite their tradition and sources.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .arrangement import Arrangement
from .geometry import (
    EPS,
    Line,
    PointLike,
    Vec2,
    as_vec,
    dist_point_segment,
    point_in_polygon,
    polygon_area,
    regular_polygon,
    segment_intersection,
)
from .sheet import Sheet


@dataclass
class PapercutReport:
    components: int
    min_bridge_mm: float | None
    min_gap_mm: float | None
    kept_area_mm2: float
    issues: list[dict] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any(i["level"] == "error" for i in self.issues)


def components(arr: Arrangement) -> list[list[int]]:
    """Groups of faces connected across non-cut, non-boundary edges."""
    half: dict[tuple[int, int], int] = {}
    for fi, f in enumerate(arr.faces):
        for k in range(len(f)):
            half[(f[k], f[(k + 1) % len(f)])] = fi
    eidx = {frozenset(e): i for i, e in enumerate(arr.edges)}
    parent = list(range(len(arr.faces)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for (a, b), fi in half.items():
        g = half.get((b, a))
        if g is None or arr.assignment[eidx[frozenset((a, b))]] in ("B", "C"):
            continue
        ra, rg = find(fi), find(g)
        if ra != rg:
            parent[max(ra, rg)] = min(ra, rg)
    groups: dict[int, list[int]] = {}
    for i in range(len(arr.faces)):
        groups.setdefault(find(i), []).append(i)
    return [groups[k] for k in sorted(groups)]


def _seg_dist(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2) -> tuple[float, Vec2, Vec2]:
    if segment_intersection(a0, a1, b0, b1, 0.0) is not None:
        return (0.0, a0, a0)
    cands = []
    for p, q0, q1 in ((a0, b0, b1), (a1, b0, b1)):
        cands.append((dist_point_segment(p, q0, q1), p, _foot(p, q0, q1)))
    for p, q0, q1 in ((b0, a0, a1), (b1, a0, a1)):
        cands.append((dist_point_segment(p, q0, q1), _foot(p, q0, q1), p))
    return min(cands, key=lambda t: t[0])


def _foot(p: Vec2, a: Vec2, b: Vec2) -> Vec2:
    ab = b - a
    dd = ab.dot(ab)
    if dd < EPS * EPS:
        return a
    t = max(0.0, min(1.0, (p - a).dot(ab) / dd))
    return a.lerp(b, t)


def analyze(sheet: Sheet, min_feature_mm: float = 1.0, cutter_min_mm: float | None = None,
            search_mm: float | None = None) -> PapercutReport:
    """Connectivity, narrowest bridge and narrowest removed sliver of a cut sheet."""
    arr = sheet.build()
    verts = arr.vertices
    comps = components(arr)
    issues: list[dict] = []
    if len(comps) > 1:
        sizes = sorted((math.fsum(polygon_area([verts[v] for v in arr.faces[f]]) for f in c), i)
                       for i, c in enumerate(comps))
        issues.append({"level": "error", "kind": "islands",
                       "detail": f"kept material falls apart into {len(comps)} pieces; smallest "
                       f"{sizes[0][0]:.2f} mm²"})
    cutter = min_feature_mm if cutter_min_mm is None else cutter_min_mm
    reach = search_mm if search_mm is not None else max(10.0, 5.0 * max(min_feature_mm, cutter))
    segs = [(verts[a], verts[b]) for (a, b), asg in zip(arr.edges, arr.assignment, strict=True)
            if asg in ("B", "C")]
    vid = [(a, b) for (a, b), asg in zip(arr.edges, arr.assignment, strict=True)
           if asg in ("B", "C")]
    order = sorted(range(len(segs)), key=lambda i: (min(segs[i][0].x, segs[i][1].x), i))
    lo_x = [min(a.x, b.x) for a, b in segs]
    lo_y = [min(a.y, b.y) for a, b in segs]
    hi_y = [max(a.y, b.y) for a, b in segs]
    near = _BoundaryGraph(verts, vid)
    min_bridge: float | None = None
    min_gap: float | None = None
    for oi, i in enumerate(order):
        a0, a1 = segs[i]
        hi_x = max(a0.x, a1.x) + reach
        ylo, yhi = lo_y[i] - reach, hi_y[i] + reach
        va, vb = vid[i]
        for j in order[oi + 1:]:
            if lo_x[j] > hi_x:
                break
            if lo_y[j] > yhi or hi_y[j] < ylo:
                continue  # farther than `reach` in y: d > reach, skipped below anyway
            if va in vid[j] or vb in vid[j]:
                continue
            b0, b1 = segs[j]
            d, p, q = _seg_dist(a0, a1, b0, b1)
            if d > reach or d <= EPS:
                continue
            if near.path(vid[i], vid[j], 2.0 * d) <= 2.0 * d:
                continue  # same boundary curve folding back on itself, not a neck
            mid = p.lerp(q, 0.5)
            if sheet.region_contains(mid):
                if min_bridge is None or d < min_bridge:
                    min_bridge = d
            elif min_gap is None or d < min_gap:
                min_gap = d
    if min_bridge is not None and min_bridge < min_feature_mm - 1e-9:
        issues.append({"level": "error", "kind": "bridge_too_thin",
                       "detail": f"narrowest material bridge {min_bridge:.3f} mm < "
                       f"min_feature {min_feature_mm} mm"})
    if min_gap is not None and min_gap < cutter - 1e-9:
        issues.append({"level": "warning", "kind": "sliver",
                       "detail": f"narrowest removed sliver {min_gap:.3f} mm < cutter minimum "
                       f"{cutter} mm"})
    kept = math.fsum(polygon_area([verts[v] for v in f]) for f in arr.faces)
    return PapercutReport(len(comps), min_bridge, min_gap, kept, issues)


class _BoundaryGraph:
    """Shortest path lengths along cut/boundary edges (bounded Dijkstra)."""

    def __init__(self, verts: list[Vec2], edges: list[tuple[int, int]]):
        self.verts = verts
        self.adj: dict[int, list[tuple[int, float]]] = {}
        for a, b in edges:
            w = verts[a].distance(verts[b])
            self.adj.setdefault(a, []).append((b, w))
            self.adj.setdefault(b, []).append((a, w))

    def _from(self, src: int, cutoff: float) -> dict[int, float]:
        import heapq

        best = {src: 0.0}
        heap = [(0.0, src)]
        while heap:
            d, v = heapq.heappop(heap)
            if d > best.get(v, math.inf) or d > cutoff:
                continue
            for w, wt in self.adj.get(v, []):
                nd = d + wt
                if nd < best.get(w, math.inf) and nd <= cutoff:
                    best[w] = nd
                    heapq.heappush(heap, (nd, w))
        return best

    def path(self, e1: tuple[int, int], e2: tuple[int, int], cutoff: float) -> float:
        out = math.inf
        for s in e1:
            reach = self._from(s, cutoff)
            for t in e2:
                out = min(out, reach.get(t, math.inf))
        return out


# ── motifs ───────────────────────────────────────────────────────────────────


def petal(center: PointLike, length: float, width: float, angle_deg: float = 90.0,
          segments: int = 16) -> list[Vec2]:
    """A pointed-oval petal from `center` outward along `angle_deg` (two circular arcs)."""
    c = as_vec(center)
    pts = []
    for i in range(segments + 1):
        t = i / segments
        pts.append(Vec2(length * t, width / 2 * math.sin(math.pi * t)))
    for i in range(segments - 1, 0, -1):
        t = i / segments
        pts.append(Vec2(length * t, -width / 2 * math.sin(math.pi * t)))
    ring = [p.rotated(angle_deg) + c for p in pts]
    return ring if polygon_area(ring) > 0 else ring[::-1]


def disc(center: PointLike, radius: float, segments: int = 32) -> list[Vec2]:
    return regular_polygon(segments, radius, center, start_deg=0.0)


def diamond(center: PointLike, width: float, height: float) -> list[Vec2]:
    c = as_vec(center)
    return [Vec2(c.x, c.y - height / 2), Vec2(c.x + width / 2, c.y), Vec2(c.x, c.y + height / 2),
            Vec2(c.x - width / 2, c.y)]


def scallop_border(a: PointLike, b: PointLike, depth: float, count: int,
                   segments: int = 8) -> list[Vec2]:
    """A polyline from a to b of `count` semicircular-ish scallops bulging left by `depth`."""
    p, q = as_vec(a), as_vec(b)
    d = q - p
    n = d.perp().normalized()
    pts = [p]
    for k in range(count):
        for i in range(1, segments + 1):
            t = (k + i / segments) / count
            pts.append(p + d * t + n * (depth * math.sin(math.pi * i / segments)))
    return pts


def zigzag_border(a: PointLike, b: PointLike, depth: float, count: int) -> list[Vec2]:
    """A polyline from a to b with `count` teeth of height `depth` (to the left)."""
    p, q = as_vec(a), as_vec(b)
    d = q - p
    n = d.perp().normalized()
    pts = [p]
    for k in range(count):
        pts.append(p + d * ((k + 0.5) / count) + n * depth)
        pts.append(p + d * ((k + 1) / count))
    return pts


def lattice(origin: PointLike, rows: int, cols: int, pitch: float, hole: float) -> list[list[Vec2]]:
    """A grid of square holes (`hole` mm wide) on a `pitch` mm grid, bridges = pitch − hole."""
    if hole >= pitch:
        raise ValueError("lattice hole must be smaller than its pitch")
    o = as_vec(origin)
    out = []
    for r in range(rows):
        for c in range(cols):
            x, y = o.x + c * pitch + (pitch - hole) / 2, o.y + r * pitch + (pitch - hole) / 2
            out.append([Vec2(x, y), Vec2(x + hole, y), Vec2(x + hole, y + hole),
                        Vec2(x, y + hole)])
    return out


# ── symmetry generators ──────────────────────────────────────────────────────


def wedge(polygon: list[PointLike], n: int, center: PointLike = (0.0, 0.0)) -> list[list[Vec2]]:
    """n-fold rotational copies (cyclic group Cn) about `center`."""
    if n < 1:
        raise ValueError("wedge needs n ≥ 1")
    c = as_vec(center)
    ring = [as_vec(p) for p in polygon]
    return [[p.rotated(360.0 * k / n, c) for p in ring] for k in range(n)]


def mirror(polygon: list[PointLike], line: Line | tuple[PointLike, PointLike]) -> list[Vec2]:
    """Mirror image across a line, re-oriented counter-clockwise."""
    ln = line if isinstance(line, Line) else Line(line[0], line[1])
    ring = [ln.reflect(p) for p in polygon]
    return ring if polygon_area(ring) > 0 else ring[::-1]


def dihedral(polygon: list[PointLike], n: int, center: PointLike = (0.0, 0.0),
             axis_deg: float = 0.0) -> list[list[Vec2]]:
    """Dihedral group Dn copies: n rotations of the motif and of its mirror image."""
    c = as_vec(center)
    axis = Line(c, c + Vec2(math.cos(math.radians(axis_deg)), math.sin(math.radians(axis_deg))))
    base = [as_vec(p) for p in polygon]
    return wedge(base, n, c) + wedge(mirror(base, axis), n, c)


def accordion(polygon: list[PointLike], dx: float, count: int, dy: float = 0.0
              ) -> list[list[Vec2]]:
    """Translated repeats (an accordion-folded strip cut once)."""
    ring = [as_vec(p) for p in polygon]
    return [[Vec2(p.x + k * dx, p.y + k * dy) for p in ring] for k in range(count)]


def cut_holes(sheet: Sheet, polygons: list[list[Vec2]]) -> Sheet:
    """Punch every polygon as a hole (each must lie strictly inside and not overlap)."""
    for poly in polygons:
        sheet.hole(poly)
    return sheet


def inside_all(sheet: Sheet, polygons: list[list[Vec2]]) -> bool:
    return all(point_in_polygon(p, sheet.outline) == 1  # type: ignore[arg-type]
               for poly in polygons for p in poly)
