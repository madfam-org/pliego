"""Tier R reference kinematics (float64, deterministic) — the arbiter for the engine's tests.

- face-tree pose of a sheet from fold angles (rigid faces, rotations composed along a BFS tree);
- loop-closure residuals (how far the faces disagree on shared vertices);
- the vertex constraint matrix ``Σ ρ̇ᵢ ℓᵢ = 0`` and DOF = m − rank(C) via a stdlib one-sided Jacobi
  SVD (rsE §a2);
- degree-4 closed forms (Foschi–Hull–Ku Thm 1) and the Miura-ori cell (Schenk & Guest 2013);
- the motion solver `solve()` and `vertex_folds()` / `vertex_residuals()` (``pliego.motion``).

Conventions: angles in degrees at the API, radians inside; un-placed world frame (u, 0, −v), so a
counter-clockwise sheet's front normal is +Y and a positive (valley) angle lifts faces toward +Y.
"""

from __future__ import annotations

import math
from collections import deque
from collections.abc import Callable, Sequence

from .arrangement import Arrangement
from .geometry import Vec2, point_in_polygon
from .space import (
    IDENTITY3,
    Mat3,
    Vec3,
    add,
    axis_rotation,
    dist,
    mat_mul,
    mat_vec,
    sub,
    unit,
    unplaced,
)

Rigid = tuple[Mat3, Vec3]  # x ↦ R·x + t


def _compose(a: Rigid, b: Rigid) -> Rigid:
    """a ∘ b."""
    ra, ta = a
    rb, tb = b
    return (mat_mul(ra, rb), add(mat_vec(ra, tb), ta))


def _apply(t: Rigid, p: Sequence[float]) -> Vec3:
    return add(mat_vec(t[0], p), t[1])


def _rot_about_line(origin: Vec3, direction: Vec3, angle_rad: float) -> Rigid:
    r = axis_rotation(direction, angle_rad)
    return (r, sub(origin, mat_vec(r, origin)))


def face_adjacency(arr: Arrangement) -> dict[int, list[tuple[int, int, int, int]]]:
    """face → [(neighbour face, edge index, a, b)] across foldable edges (not B, not C), where
    a→b is the edge's direction with the face on its left."""
    half: dict[tuple[int, int], int] = {}
    for fi, f in enumerate(arr.faces):
        for k in range(len(f)):
            half[(f[k], f[(k + 1) % len(f)])] = fi
    eidx = {frozenset(e): i for i, e in enumerate(arr.edges)}
    adj: dict[int, list[tuple[int, int, int, int]]] = {i: [] for i in range(len(arr.faces))}
    for (a, b), fi in sorted(half.items(), key=lambda kv: (kv[1], kv[0])):
        g = half.get((b, a))
        if g is None:
            continue
        e = eidx[frozenset((a, b))]
        if arr.assignment[e] in ("B", "C"):
            continue
        adj[fi].append((g, e, a, b))
    return adj


def face_transforms(arr: Arrangement, angles: dict[int, float], root: int = 0, *,
                    axis_offset: Callable[[int, float], float] | None = None
                    ) -> list[Rigid | None]:
    """Rigid transform of every face (BFS from `root`), un-placed world frame.

    `axis_offset(edge, angle_deg)` moves a crease's rotation axis off the mid-surface by that
    many mm along the flat sheet's front normal (+Y); `None` keeps every axis on the
    mid-surface (zero-thickness sheets). `pliego.thickness` uses it for board."""
    pts = [unplaced(v.x, v.y) for v in arr.vertices]
    adj = face_adjacency(arr)
    out: list[Rigid | None] = [None] * len(arr.faces)
    out[root] = (IDENTITY3, (0.0, 0.0, 0.0))
    queue = deque([root])
    while queue:
        f = queue.popleft()
        for g, e, a, b in adj[f]:
            if out[g] is not None:
                continue
            deg = angles.get(e, 0.0)
            rho = math.radians(deg)
            origin = pts[a]
            if axis_offset is not None:
                origin = add(origin, (0.0, axis_offset(e, deg), 0.0))
            # f is left of a→b; a positive (valley) angle lifts g toward +Y: rotate by −ρ
            step = _rot_about_line(origin, unit(sub(pts[b], pts[a])), -rho)
            out[g] = _compose(out[f], step)  # type: ignore[arg-type]
            queue.append(g)
    return out


def root_face(arr: Arrangement, point: Vec2 | None) -> int:
    if point is None:
        return 0
    verts = arr.vertices
    for fi, f in enumerate(arr.faces):
        if point_in_polygon(point, [verts[v] for v in f]) >= 0:
            return fi
    raise ValueError(f"root point ({point.x}, {point.y}) is not on the sheet")


def pose_arrangement(arr: Arrangement, angles: dict[int, float], root: Vec2 | None = None
                     ) -> list[Vec3]:
    """Vertex positions (un-placed world frame) of a sheet folded to `angles` (edge → deg).

    Faces not reachable from the root (separated by cuts) stay flat. Each vertex takes the
    position from the first face (BFS order) that contains it.
    """
    tr = face_transforms(arr, angles, root_face(arr, root))
    pts = [unplaced(v.x, v.y) for v in arr.vertices]
    out: list[Vec3 | None] = [None] * len(pts)
    order = sorted(range(len(arr.faces)), key=lambda i: (tr[i] is None, i))
    for fi in order:
        t = tr[fi] or (IDENTITY3, (0.0, 0.0, 0.0))
        for v in arr.faces[fi]:
            if out[v] is None:
                out[v] = _apply(t, pts[v])
    return [p if p is not None else pts[i] for i, p in enumerate(out)]


def closure_residual(arr: Arrangement, angles: dict[int, float], root: Vec2 | None = None,
                     *, relative: bool = False) -> float:
    """Loop-closure residual (mm): for every crease between two posed faces, the largest
    distance between the far face's vertices placed by its tree transform and by rotating the
    near face's transform about that crease by its angle. 0 for a consistent fold state —
    this also checks the creases the spanning tree did not cross.

    The mm value grows with the sheet (an angular error θ at a vertex moves a point at distance
    R by ≈ θ·R). `relative=True` divides by the sheet's diagonal, giving a dimensionless value
    comparable across sizes; `vertex_residuals()` gives the per-vertex residual in radians and
    `snap_angle_rad()` the angular floor set by the snapping grid — honest tolerances are a
    small multiple of it."""
    if relative:
        lo_x = min(v.x for v in arr.vertices)
        hi_x = max(v.x for v in arr.vertices)
        lo_y = min(v.y for v in arr.vertices)
        hi_y = max(v.y for v in arr.vertices)
        diag = math.hypot(hi_x - lo_x, hi_y - lo_y) or 1.0
        return closure_residual(arr, angles, root) / diag
    tr = face_transforms(arr, angles, root_face(arr, root))
    pts = [unplaced(v.x, v.y) for v in arr.vertices]
    worst = 0.0
    for f, nbrs in face_adjacency(arr).items():
        if tr[f] is None:
            continue
        for g, e, a, b in nbrs:
            if tr[g] is None:
                continue
            rho = math.radians(angles.get(e, 0.0))
            step = _rot_about_line(pts[a], unit(sub(pts[b], pts[a])), -rho)
            expect = _compose(tr[f], step)  # type: ignore[arg-type]
            for v in arr.faces[g]:
                worst = max(worst, dist(_apply(expect, pts[v]), _apply(tr[g], pts[v])))  # type: ignore[arg-type]
    return worst


def snap_angle_rad(arr: Arrangement) -> float:
    """Angular uncertainty (rad) of the shortest crease direction after grid snapping:
    √2·GRID_MM / L_min over the foldable (M/V/U) edges — 0 when there are none."""
    from .arrangement import GRID_MM

    verts = arr.vertices
    lengths = [verts[a].distance(verts[b]) for (a, b), asg in zip(arr.edges, arr.assignment,
                                                                   strict=True)
               if asg in ("M", "V", "U")]
    return math.sqrt(2.0) * GRID_MM / min(lengths) if lengths else 0.0


# ── constraints and DOF ──────────────────────────────────────────────────────


def interior_vertices(arr: Arrangement) -> list[int]:
    """Vertices not touching a boundary or cut edge."""
    edge_touch: dict[int, set[str]] = {}
    for (a, b), asg in zip(arr.edges, arr.assignment, strict=True):
        edge_touch.setdefault(a, set()).add(asg)
        edge_touch.setdefault(b, set()).add(asg)
    return [v for v in range(len(arr.grid)) if not (edge_touch.get(v, set()) & {"B", "C"})]


def constraint_matrix(arr: Arrangement, angles: dict[int, float], creases: list[int]
                      ) -> list[list[float]]:
    """Rows Σ ρ̇ᵢ ℓᵢ = 0 (3 per interior vertex) over the listed crease edges, at the posed state."""
    pose = pose_arrangement(arr, angles)
    col = {e: i for i, e in enumerate(creases)}
    rows: list[list[float]] = []
    for v in interior_vertices(arr):
        r = [[0.0] * len(creases) for _ in range(3)]
        used = False
        for e, (a, b) in enumerate(arr.edges):
            if e not in col or v not in (a, b):
                continue
            w = b if a == v else a
            ell = unit(sub(pose[w], pose[v]))
            for k in range(3):
                r[k][col[e]] = ell[k]
            used = True
        if used:
            rows.extend(r)
    return rows


def singular_values(m: list[list[float]], sweeps: int = 60) -> list[float]:
    """Singular values (descending) by one-sided Jacobi (Hestenes) — stdlib, deterministic."""
    if not m or not m[0]:
        return []
    rows, cols = len(m), len(m[0])
    a = [list(r) for r in m] if rows >= cols else [list(c) for c in zip(*m, strict=True)]
    n = len(a[0])
    cols_ = [[a[i][j] for i in range(len(a))] for j in range(n)]
    for _ in range(sweeps):
        off = 0.0
        for p in range(n - 1):
            for q in range(p + 1, n):
                x, y = cols_[p], cols_[q]
                alpha = math.fsum(t * t for t in x)
                beta = math.fsum(t * t for t in y)
                gamma = math.fsum(s * t for s, t in zip(x, y, strict=True))
                if gamma == 0.0 or alpha == 0.0 or beta == 0.0 \
                        or abs(gamma) <= 1e-15 * math.sqrt(alpha) * math.sqrt(beta):
                    continue
                off = max(off, abs(gamma) / (math.sqrt(alpha) * math.sqrt(beta)))
                zeta = (beta - alpha) / (2.0 * gamma)
                t = math.copysign(1.0, zeta) / (abs(zeta) + math.sqrt(1.0 + zeta * zeta))
                c = 1.0 / math.sqrt(1.0 + t * t)
                s = c * t
                cols_[p] = [c * u - s * w for u, w in zip(x, y, strict=True)]
                cols_[q] = [s * u + c * w for u, w in zip(x, y, strict=True)]
        if off < 1e-14:
            break
    return sorted((math.sqrt(math.fsum(t * t for t in c)) for c in cols_), reverse=True)


def rank(m: list[list[float]], rtol: float = 1e-9) -> int:
    sv = singular_values(m)
    if not sv or sv[0] == 0.0:
        return 0
    return sum(1 for s in sv if s > rtol * sv[0])


def dof(arr: Arrangement, angles: dict[int, float] | None = None) -> int:
    """Rigid-folding degrees of freedom m − rank(C) at the given (generic, non-flat) state."""
    creases = [e for e, a in enumerate(arr.assignment) if a in ("M", "V", "U")]
    c = constraint_matrix(arr, angles or {}, creases)
    return len(creases) - (rank(c) if c else 0)


# ── closed forms ─────────────────────────────────────────────────────────────


def degree4_mode1(alpha1: float, alpha2: float, rho1: float) -> tuple[float, float, float, float]:
    """Flat-foldable degree-4 vertex, sector angles (α1, α2, π−α1, π−α2) in degrees.

    Mode 1: ρ1 = ρ3, ρ2 = −ρ4, tan(ρ2/2) = −cos((α1+α2)/2)/cos((α1−α2)/2) · tan(ρ1/2).
    Returns (ρ1, ρ2, ρ3, ρ4) in degrees.
    """
    a1, a2 = math.radians(alpha1), math.radians(alpha2)
    k = -math.cos((a1 + a2) / 2) / math.cos((a1 - a2) / 2)
    r2 = math.degrees(2 * math.atan(k * math.tan(math.radians(rho1) / 2)))
    return (rho1, r2, rho1, -r2)


def degree4_mode2(alpha1: float, alpha2: float, rho2: float) -> tuple[float, float, float, float]:
    """Mode 2: ρ1 = −ρ3, ρ2 = ρ4, tan(ρ1/2) = sin((α1−α2)/2)/sin((α1+α2)/2) · tan(ρ2/2)."""
    a1, a2 = math.radians(alpha1), math.radians(alpha2)
    k = math.sin((a1 - a2) / 2) / math.sin((a1 + a2) / 2)
    r1 = math.degrees(2 * math.atan(k * math.tan(math.radians(rho2) / 2)))
    return (r1, rho2, -r1, rho2)


def miura_cell(a: float, b: float, gamma_deg: float, theta_deg: float) -> dict[str, float]:
    """Miura-ori unit cell (Schenk & Guest 2013): panel sides a, b, acute angle γ, fold θ."""
    g, t = math.radians(gamma_deg), math.radians(theta_deg)
    root = math.sqrt(1.0 + math.cos(t) ** 2 * math.tan(g) ** 2)
    return {"H": a * math.sin(t) * math.sin(g),
            "S": b * math.cos(t) * math.tan(g) / root,
            "L": a * math.sqrt(1.0 - math.sin(t) ** 2 * math.sin(g) ** 2),
            "V": b / root}


def miura_poisson(gamma_deg: float, theta_deg: float) -> float:
    """In-plane Poisson ratio ν_SL = −cos²θ · tan²γ (Schenk & Guest 2013)."""
    g, t = math.radians(gamma_deg), math.radians(theta_deg)
    return -math.cos(t) ** 2 * math.tan(g) ** 2


# ── Tier R motion (pliego.motion) ────────────────────────────────────────────

from .motion import (  # noqa: E402 - re-exported: pliego.kinematics.solve(...)
    KinematicPath,
    KinematicsError,
    solve,
    vertex_folds,
    vertex_residuals,
)

__all__ = [
    "KinematicPath", "KinematicsError", "closure_residual", "constraint_matrix", "degree4_mode1",
    "degree4_mode2", "dof", "face_adjacency", "face_transforms", "interior_vertices",
    "miura_cell", "miura_poisson", "pose_arrangement", "rank", "root_face", "singular_values",
    "snap_angle_rad", "solve", "vertex_folds", "vertex_residuals",
]
