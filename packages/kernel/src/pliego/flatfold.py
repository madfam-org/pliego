"""Local flat-foldability: Maekawa, Kawasaki–Justin (exact + float), big-little-big; flat-folded
positions via the face tree; local layer order → FOLD ``faceOrders``.

Works on an `Arrangement` (one sheet). Interior vertices are those not touching a boundary or
cut edge; F (flat) edges are not folds and are ignored, U (unassigned) edges count for Kawasaki
but make Maekawa/BLB undecidable. Issues use the verify-dict shape.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .arrangement import GRID_MM, Arrangement
from .exact import kawasaki_exact, sort_ccw
from .kinematics import face_adjacency, interior_vertices, pose_arrangement

KAWASAKI_TOL_RAD = 1e-6
"""Default float Kawasaki tolerance (rad), derived from the snapping grid: a crease direction
built from grid-snapped end points (GRID_MM = 1e-6 mm) is off by at most √2·GRID_MM / L rad,
and each ray enters the alternating sector sum once, so a vertex's sum is off by at most
Σᵢ √2·GRID_MM / Lᵢ. `check()` uses that per-vertex bound (`kawasaki_tol`); 1e-6 rad is the bound
for a degree-4 vertex whose creases are ≥ 5.7 mm long, the default when lengths are unknown.
Irrational slopes (the hex twist's 105/60/75/120° sectors) snap by ~1e-8 rad and pass."""
KAWASAKI_FLOOR_RAD = 1e-9   # never tighter than float rounding of the sector sum


@dataclass
class VertexReport:
    vertex: int
    degree: int
    mountains: int
    valleys: int
    maekawa: bool | None
    kawasaki_exact: bool
    kawasaki_float: bool
    big_little_big: bool | None
    sectors_deg: list[float] = field(default_factory=list)

    @property
    def flat_foldable(self) -> bool:
        return bool((self.kawasaki_exact or self.kawasaki_float) and self.maekawa is not False
                    and self.big_little_big is not False)


def _creases_at(arr: Arrangement, v: int) -> list[tuple[tuple[int, int], int]]:
    """[(integer direction, edge)] of folding edges (M/V/U) at v, sorted CCW (exact)."""
    gx, gy = arr.grid[v]
    out = []
    for e, (a, b) in enumerate(arr.edges):
        if v not in (a, b) or arr.assignment[e] not in ("M", "V", "U"):
            continue
        w = b if a == v else a
        out.append(((arr.grid[w][0] - gx, arr.grid[w][1] - gy), e))
    order = sort_ccw([d for d, _ in out])
    by_dir = {d: e for d, e in out}
    return [(d, by_dir[d]) for d in order]


def kawasaki_tol(arr: Arrangement, v: int) -> float:
    """Per-vertex Kawasaki tolerance (rad): Σ √2·GRID_MM / Lᵢ over the folding edges at v."""
    p = arr.vertices[v]
    verts = arr.vertices
    tol = 0.0
    for e, (a, b) in enumerate(arr.edges):
        if v in (a, b) and arr.assignment[e] in ("M", "V", "U"):
            tol += math.sqrt(2.0) * GRID_MM / p.distance(verts[b if a == v else a])
    return max(KAWASAKI_FLOOR_RAD, tol)


def kawasaki_float(dirs: list[tuple[int, int]], tol: float = KAWASAKI_TOL_RAD) -> bool:
    """Alternating sector sum = π within `tol` (float); `dirs` sorted CCW."""
    if len(dirs) % 2 or len(dirs) < 2:
        return False
    ang = [math.atan2(dy, dx) for dx, dy in dirs]
    sectors = [(ang[(i + 1) % len(ang)] - ang[i]) % (2 * math.pi) for i in range(len(ang))]
    even = math.fsum(sectors[0::2])
    return abs(even - math.pi) <= tol


def vertex_report(arr: Arrangement, v: int) -> VertexReport:
    cr = _creases_at(arr, v)
    dirs = [d for d, _ in cr]
    asg = [arr.assignment[e] for _, e in cr]
    m, vv = asg.count("M"), asg.count("V")
    ang = [math.atan2(dy, dx) for dx, dy in dirs]
    sectors = [math.degrees((ang[(i + 1) % len(ang)] - ang[i]) % (2 * math.pi))
               for i in range(len(ang))] if len(ang) > 1 else []
    maekawa = None if "U" in asg else (abs(m - vv) == 2)
    blb: bool | None = None
    if "U" not in asg and len(sectors) >= 4:
        blb = True
        n = len(sectors)
        for i in range(n):
            if sectors[i] < sectors[i - 1] - 1e-9 and sectors[i] < sectors[(i + 1) % n] - 1e-9:
                # sector i lies between creases i and i+1: they must differ (one M, one V)
                if asg[i] == asg[(i + 1) % n]:
                    blb = False
    return VertexReport(v, len(cr), m, vv, maekawa,
                        kawasaki_exact(dirs) if dirs else False,
                        kawasaki_float(dirs, kawasaki_tol(arr, v)) if dirs else False, blb,
                        [round(s, 6) for s in sectors])


def check(arr: Arrangement) -> tuple[list[VertexReport], list[dict]]:
    """Reports for every interior vertex with folds, and verify-style issues."""
    reports: list[VertexReport] = []
    issues: list[dict] = []
    for v in interior_vertices(arr):
        r = vertex_report(arr, v)
        if r.degree == 0:
            continue
        reports.append(r)
        x, y = arr.vertices[v].x, arr.vertices[v].y
        at = f"vertex {v} ({x:.4f}, {y:.4f})"
        if not (r.kawasaki_exact or r.kawasaki_float):
            issues.append({"level": "error", "kind": "kawasaki", "vertex": v,
                           "detail": f"{at}: alternating sectors {r.sectors_deg} do not sum to "
                           "180°"})
        elif not r.kawasaki_exact:
            issues.append({"level": "warning", "kind": "kawasaki_inexact", "vertex": v,
                           "detail": f"{at}: Kawasaki holds within {kawasaki_tol(arr, v):.3g} "
                           "rad only (irrational or snapped slopes)"})
        if r.maekawa is False:
            issues.append({"level": "error", "kind": "maekawa", "vertex": v,
                           "detail": f"{at}: |M − V| = |{r.mountains} − {r.valleys}| ≠ 2"})
        if r.big_little_big is False:
            issues.append({"level": "error", "kind": "big_little_big", "vertex": v,
                           "detail": f"{at}: a strictly smallest sector is bounded by two "
                           "creases of the same assignment"})
    return reports, issues


def is_flat_foldable(arr: Arrangement) -> bool:
    """Local flat-foldability of every interior vertex (necessary, not sufficient, globally)."""
    reports, _ = check(arr)
    return all(r.flat_foldable for r in reports)


def flat_angles(arr: Arrangement) -> dict[int, float]:
    """Edge → ±180 for every M/V edge (the flat-folded target)."""
    return {e: (180.0 if a == "V" else -180.0) for e, a in enumerate(arr.assignment)
            if a in ("M", "V")}


def flat_folded_coords(arr: Arrangement) -> list[tuple[float, float]]:
    """2-D positions of the flat-folded state (face tree, all M/V at ±180°), sheet-local axes.

    The folded state lies in the plane y = 0 of the un-placed frame; (x, −z) are returned.
    """
    pose = pose_arrangement(arr, flat_angles(arr))
    return [(round(p[0], 9) + 0.0, round(-p[2], 9) + 0.0) for p in pose]


def face_orders_local(arr: Arrangement) -> list[list[int]]:
    """Local layer order between faces adjacent across an M/V crease (FOLD ``faceOrders``).

    After a flat fold the two faces of a crease overlap along it. For a valley the faces rotate
    toward the front, so each lies on the side of the other's normal: ``[f, g, +1]``; for a
    mountain ``[f, g, −1]``. Orders between non-adjacent faces are not inferred (a full layer
    solver is a later item); the list is sorted and de-duplicated.
    """
    orders: set[tuple[int, int, int]] = set()
    for f, nbrs in face_adjacency(arr).items():
        for g, e, _, _ in nbrs:
            a = arr.assignment[e]
            if a not in ("M", "V"):
                continue
            s = 1 if a == "V" else -1
            orders.add((f, g, s))
    return [list(o) for o in sorted(orders)]
