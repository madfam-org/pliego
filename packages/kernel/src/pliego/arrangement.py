"""Planar subdivision of one sheet: outline + holes + lines → vertices, edges, simple faces.

Pipeline (kernel.md §1 `arrangement.py`):

1. snap every input point to the integer grid (1e-6 mm);
2. find exact crossings between all segments, cluster vertices closer than ``EPS`` (1e-4 mm),
   split every segment at every vertex within ``EPS`` of it (T-junctions, near misses);
3. merge coincident pieces by priority (boundary > cut > crease > score > perforation > flat),
   drop interior pieces outside the sheet or inside holes;
4. trace faces on a DCEL and bridge holes / dangling lines with ``J`` edges until every face is
   a simple counter-clockwise polygon (``arrangement_dcel``), then check Euler's formula.

The output is **canonical**: vertices sorted by grid coordinates, edges by vertex pair, faces by
vertex cycle — independent of authoring order, so documents are byte-stable.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field

from .exact import GRID, IPoint, crossing_point, round_point
from .geometry import EPS, Vec2, point_in_polygon

EPS_GRID = int(round(EPS * GRID))  # 100 grid units

ASSIGNMENTS = ("B", "M", "V", "F", "U", "C", "J")
TREATMENTS = ("none", "crease", "score", "perforation", "cut", "halfcut")


class ArrangementError(ValueError):
    """Raised when a sheet cannot be subdivided into simple faces (fail loud)."""


def priority(assignment: str, treatment: str) -> int:
    """Overlap priority: boundary > cut > crease > score > perforation > flat (spec/kernel §1)."""
    if assignment == "B":
        return 100
    if assignment == "C":
        return 90 if treatment == "cut" else 85
    if assignment in ("M", "V"):
        return {"crease": 80, "score": 70, "perforation": 60}.get(treatment, 50)
    if assignment == "F":
        return {"score": 69, "perforation": 59, "halfcut": 55, "crease": 50}.get(treatment, 45)
    if assignment == "U":
        return 40
    return 10  # J


@dataclass(frozen=True)
class SegmentInput:
    """One straight input line in sheet-local mm with its design and treatment attributes."""

    a: Vec2
    b: Vec2
    assignment: str
    fold_angle: float = 0.0
    treatment: str = "crease"
    tag: int | None = None  # authoring handle (mark index); None for boundary


@dataclass
class Arrangement:
    """A sheet's planar subdivision in sheet-local mm (grid-exact)."""

    grid: list[IPoint]
    edges: list[tuple[int, int]]
    assignment: list[str]
    fold_angle: list[float]
    treatment: list[str]
    tags: list[tuple[int, ...]]
    faces: list[list[int]]
    hole_faces: int = 0
    warnings: list[dict] = field(default_factory=list)

    @property
    def vertices(self) -> list[Vec2]:
        return [Vec2(x / GRID, y / GRID) for x, y in self.grid]

    def edges_of_tag(self, tag: int) -> list[int]:
        return [i for i, t in enumerate(self.tags) if tag in t]

    def euler(self) -> tuple[int, int]:
        """(V − E + F + H + 1, 1 + components): equal for a valid planar subdivision.

        F counts material faces, H hole faces and the +1 is the unbounded face.
        """
        parent = list(range(len(self.grid)))

        def find(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        for u, v in self.edges:
            ru, rv = find(u), find(v)
            if ru != rv:
                parent[max(ru, rv)] = min(ru, rv)
        comps = len({find(i) for i in range(len(self.grid))})
        return (len(self.grid) - len(self.edges) + len(self.faces) + self.hole_faces + 1, 1 + comps)


# ── splitting ────────────────────────────────────────────────────────────────


def _cluster(points: list[IPoint]) -> dict[IPoint, IPoint]:
    """Map each point to a representative: points within EPS chain into one cluster whose
    representative is its smallest (x, y) — deterministic and order-independent."""
    pts = sorted(set(points))
    parent = {p: p for p in pts}

    def find(p: IPoint) -> IPoint:
        while parent[p] != p:
            parent[p] = parent[parent[p]]
            p = parent[p]
        return p

    xs = [p[0] for p in pts]
    eps2 = EPS_GRID * EPS_GRID
    for i, p in enumerate(pts):
        j = bisect_right(xs, p[0] + EPS_GRID)
        for q in pts[i + 1:j]:
            if (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= eps2:
                rp, rq = find(p), find(q)
                if rp != rq:
                    lo, hi = (rp, rq) if rp < rq else (rq, rp)
                    parent[hi] = lo
    return {p: find(p) for p in pts}


def _near_segment(p: IPoint, a: IPoint, b: IPoint) -> float | None:
    """Parameter t ∈ (0, 1) of p's projection when p is within EPS of the open segment ab."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    dd = dx * dx + dy * dy
    if dd == 0:
        return None
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / dd
    if t <= 0.0 or t >= 1.0:
        return None
    cross = (p[0] - a[0]) * dy - (p[1] - a[1]) * dx
    if cross * cross > EPS_GRID * EPS_GRID * dd:
        return None
    return t


def split_segments(segs: list[tuple[IPoint, IPoint]]) -> tuple[list[list[IPoint]], list[IPoint]]:
    """Split integer segments at mutual crossings and nearby vertices.

    Returns, per input segment, its chain of vertices (cluster representatives, in order), plus
    the sorted list of all vertices.
    """
    candidates: list[IPoint] = [p for s in segs for p in s]
    order = sorted(range(len(segs)), key=lambda i: (min(segs[i][0][0], segs[i][1][0]), i))
    for oi, i in enumerate(order):
        a, b = segs[i]
        max_x = max(a[0], b[0]) + EPS_GRID
        lo_y, hi_y = min(a[1], b[1]) - EPS_GRID, max(a[1], b[1]) + EPS_GRID
        for j in order[oi + 1:]:
            c, d = segs[j]
            if min(c[0], d[0]) > max_x:
                break
            if max(c[1], d[1]) < lo_y or min(c[1], d[1]) > hi_y:
                continue
            hit = crossing_point(a, b, c, d)
            if hit is not None:
                candidates.append(round_point(hit))
    rep = _cluster(candidates)
    verts = sorted(set(rep.values()))
    xs = [v[0] for v in verts]
    chains: list[list[IPoint]] = []
    for a, b in segs:
        ra, rb = rep[a], rep[b]
        lo = bisect_left(xs, min(ra[0], rb[0]) - EPS_GRID)
        hi = bisect_right(xs, max(ra[0], rb[0]) + EPS_GRID)
        y0, y1 = min(ra[1], rb[1]) - EPS_GRID, max(ra[1], rb[1]) + EPS_GRID
        inner: list[tuple[float, IPoint]] = []
        for v in verts[lo:hi]:
            if v == ra or v == rb or not (y0 <= v[1] <= y1):
                continue
            t = _near_segment(v, ra, rb)
            if t is not None:
                inner.append((t, v))
        inner.sort()
        chain = [ra] + [v for _, v in inner] + [rb]
        dedup = [chain[0]]
        for v in chain[1:]:
            if v != dedup[-1]:
                dedup.append(v)
        chains.append(dedup)
    return chains, verts


# ── building ─────────────────────────────────────────────────────────────────


def _ring_to_grid(ring: list[Vec2]) -> list[IPoint]:
    return [(int(round(p.x * GRID)), int(round(p.y * GRID))) for p in ring]


def build_arrangement(outline: list[Vec2], holes: list[list[Vec2]],
                      segments: list[SegmentInput]) -> Arrangement:
    """Build the canonical planar subdivision of one sheet (see module docstring)."""
    from .arrangement_dcel import finish_faces

    warnings: list[dict] = []
    raw: list[tuple[IPoint, IPoint, str, float, str, int | None, bool]] = []
    # (a, b, assignment, angle, treatment, tag, material_on_left)
    out_g = _ring_to_grid(outline)
    for i in range(len(out_g)):
        raw.append((out_g[i], out_g[(i + 1) % len(out_g)], "B", 0.0, "none", None, True))
    for hole in holes:
        hg = _ring_to_grid(hole)  # holes arrive clockwise: material on the left
        for i in range(len(hg)):
            raw.append((hg[i], hg[(i + 1) % len(hg)], "B", 0.0, "none", None, True))
    for s in segments:
        a, b = _ring_to_grid([s.a, s.b])
        raw.append((a, b, s.assignment, float(s.fold_angle), s.treatment, s.tag, True))

    chains, _ = split_segments([(r[0], r[1]) for r in raw])
    merged: dict[tuple[IPoint, IPoint], dict] = {}
    for r, chain in zip(raw, chains, strict=True):
        _, _, asg, ang, trt, tag, _ = r
        for p, q in zip(chain, chain[1:], strict=False):
            key = (p, q) if p < q else (q, p)
            attrs = (priority(asg, trt), abs(ang), ang, asg, trt)
            cur = merged.get(key)
            entry = {"attrs": attrs, "tags": set() if tag is None else {tag},
                     "left": (p, q) if asg == "B" else None}
            if cur is None:
                merged[key] = entry
            elif attrs > cur["attrs"]:
                if cur["attrs"][0] == attrs[0] and cur["attrs"][3] != "B":
                    warnings.append(_overlap_warning(key, cur["attrs"], attrs))
                merged[key] = entry
            elif attrs == cur["attrs"]:
                cur["tags"] |= entry["tags"]
                if cur["left"] is None:
                    cur["left"] = entry["left"]
            elif cur["attrs"][0] == attrs[0] and attrs[3] != "B":
                warnings.append(_overlap_warning(key, attrs, cur["attrs"]))

    outline_g = [Vec2(x / GRID, y / GRID) for x, y in out_g]
    holes_g = [[Vec2(x / GRID, y / GRID) for x, y in _ring_to_grid(h)] for h in holes]
    kept: dict[tuple[IPoint, IPoint], dict] = {}
    for key, entry in merged.items():
        if entry["attrs"][3] != "B":
            mid = Vec2((key[0][0] + key[1][0]) / (2 * GRID), (key[0][1] + key[1][1]) / (2 * GRID))
            if point_in_polygon(mid, outline_g) != 1:
                continue
            if any(point_in_polygon(mid, h) != -1 for h in holes_g):
                continue
        kept[key] = entry
    if not kept:
        raise ArrangementError("sheet has no edges after subdivision")

    return finish_faces(kept, warnings)


def _overlap_warning(key: tuple[IPoint, IPoint], lost: tuple, won: tuple) -> dict:
    (ax, ay), (bx, by) = key
    return {
        "level": "warning",
        "kind": "overlap_conflict",
        "detail": (f"coincident lines at ({ax / GRID:.4f}, {ay / GRID:.4f})–"
                   f"({bx / GRID:.4f}, {by / GRID:.4f}): {lost[3]}/{lost[4]} {lost[2]:g}° "
                   f"yields to {won[3]}/{won[4]} {won[2]:g}°"),
    }
