"""Tier R motion solver: rigid folding paths on the loop-closure manifold (rsE §a2).

State: the fold angle ρ of every foldable crease (M/V/U, plus any F line a caller names). Each
interior vertex closes its loop of faces: with the creases met counter-clockwise and dᵢ their flat
world directions, ``F_v = R(d₁, ρ₁)·R(d₂, ρ₂)⋯R(d_k, ρ_k) = I`` — the same sign convention as
`pliego.kinematics.face_transforms` (valley > 0 lifts toward the front, +Y). The residual is
``r_v = vee(log F_v)`` (rad) and its Jacobian column for crease i is ℓᵢ, the crease's current
direction in the vertex frame (Σ ρ̇ᵢ ℓᵢ = 0).

`solve()` moves the driven creases linearly from `start` to `drive` in `steps` substeps. Each
substep predicts the free creases by the minimum-norm solution of the linearised closure (the
null-space projection of the drive), then corrects with damped least squares (Levenberg–
Marquardt on ``(CᵀC + λ²I)⁻¹Cᵀr``: λ starts at 1e-3 — the singular values of C are O(1) since
its columns are unit vectors — and shrinks ×10 per accepted step down to 1e-12, so the update
stays bounded at the flat singularity, where C loses rank, and is Gauss–Newton elsewhere).

Planar (flat or flat-folded) vertices are bifurcations: every ℓᵢ lies in one plane, the linear
constraint no longer fixes the direction of motion, and several rigid branches cross. There the
tangent cone is solved exactly to second order — the in-plane linear constraint plus, per planar
vertex, ``n·½Σ_{i<j} vᵢvⱼ (ℓᵢ×ℓⱼ) = 0`` (Baker–Campbell–Hausdorff) — each branch is followed by
Newton, and the branch is chosen by the drive's sign: the folding sense σ = sign(Δρ_drive) ·
(drive crease's M/V sign) and the branch whose free creases fold most consistently with σ times
their own M/V signs wins (ties: the least motion). Loops around holes are not constrained.

Acceptance: Newton aims for 1e-13 rad; a state is accepted below max(1e-10 rad, the worst
vertex's snapping floor Σᵢ √2·GRID_MM / Lᵢ). A vertex whose grid-snapped directions miss exact
flat-foldability by ε cannot close better than ~2ε at its flat-folded state, so that floor is the
honest limit there; elsewhere the residual is reported as reached (``max_residual_rad``).
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from . import linalg
from .arrangement import GRID_MM
from .flatmotion import mat_mul3
from .space import IDENTITY3, Mat3, Vec3, axis_rotation, cross, mat_vec, unit

NEWTON_TOL_RAD = 1e-13     # Newton stops below this max |r_v|
ACCEPT_TOL_RAD = 1e-10     # a state is on the closure manifold below this (or the snap floor)
PLANAR_TOL = 1e-9          # |ℓᵢ·n| below this at every crease: a planar (singular) vertex
LAMBDA0 = 1e-3
LAMBDA_MIN = 1e-12
LAMBDA_MAX = 1e8
MAX_ITER = 200
ANGLE_SLACK_DEG = 1e-6     # |ρ| may exceed 180° by this much (rounding) before it is an error
SIGN = {"V": 1, "M": -1}


class KinematicsError(ValueError):
    """The requested motion is not a rigid folding motion (fail loud)."""


class KinematicPath(list):
    """The states of a solved path: one ``{edge: degrees}`` dict per substep (start excluded).

    Attributes: ``edges`` (the crease variables), ``dof`` (rigid DOF m − rank C at the path's
    middle state), ``free_dof`` (freedom left once the drive and fixed creases are imposed: 0 =
    the drive determines the motion), ``max_residual_rad`` (worst vertex loop residual over the
    path) and ``branch_steps`` (substeps that started on a bifurcation and chose a branch).
    ``dof`` and ``free_dof`` are computed on first read: the rank of the closure Jacobian is
    an SVD of the whole pattern, which a caller that only follows the path does not need."""

    edges: list[int]
    max_residual_rad: float
    branch_steps: list[int]

    def __init__(self, states: Iterable[dict[int, float]], **info: Any):
        super().__init__(states)
        self.__dict__.update(info)

    def _ranks(self) -> None:
        sysm, mid_state, free = self.__dict__.pop("_rank_at")
        n = len(sysm.edges)
        _, ells = _residual(sysm, mid_state)
        self.__dict__["dof"] = n - _rank(_jacobian(sysm, ells, list(range(n))), n)
        self.__dict__["free_dof"] = len(free) - _rank(_jacobian(sysm, ells, free), len(free))

    @property
    def dof(self) -> int:
        if "dof" not in self.__dict__:
            self._ranks()
        return self.__dict__["dof"]

    @property
    def free_dof(self) -> int:
        if "free_dof" not in self.__dict__:
            self._ranks()
        return self.__dict__["free_dof"]


@dataclass
class _Loop:
    vertex: int
    cols: list[int]
    dirs: list[Vec3]


@dataclass
class _System:
    edges: list[int]
    col: dict[int, int]
    sign: list[int]
    loops: list[_Loop] = field(default_factory=list)
    accept: float = ACCEPT_TOL_RAD   # max(ACCEPT_TOL_RAD, the worst vertex's snapping floor)


# ── building the closure system ──────────────────────────────────────────────


def _arrays(obj: Any) -> tuple[list, list, list, Any]:
    """(coords, edges, assignment, sheet-or-None) of an Arrangement, Sheet or Document."""
    from .arrangement import Arrangement
    from .document import Document
    from .sheet import Sheet

    if isinstance(obj, Document):
        d = obj.data
        return ([tuple(c[:2]) for c in d["vertices_coords"]],
                [tuple(e) for e in d["edges_vertices"]], list(d["edges_assignment"]), None)
    sheet = obj if isinstance(obj, Sheet) else None
    arr = obj.build() if sheet is not None else obj
    if not isinstance(arr, Arrangement):
        raise TypeError(f"expected an Arrangement, Sheet or Document, got {type(obj).__name__}")
    return [(v.x, v.y) for v in arr.vertices], list(arr.edges), list(arr.assignment), sheet


def _expand(keys: Mapping | Iterable, sheet: Any) -> dict[int, Any]:
    """Edge-index keys; a `Mark` key expands to all of its edges (Sheet systems only)."""
    from .sheet import Mark

    items = keys.items() if isinstance(keys, Mapping) else ((k, None) for k in keys)
    out: dict[int, Any] = {}
    for k, val in items:
        if isinstance(k, Mark):
            if sheet is None or k.sheet is not sheet:
                raise KinematicsError("a Mark key needs the Sheet it belongs to as the system")
            for e in k.edges():
                out[e] = val
        elif isinstance(k, int) and not isinstance(k, bool):
            out[k] = val
        else:
            raise KinematicsError(f"crease key {k!r} must be an edge index or a Mark")
    return out


def _system(obj: Any, named: Iterable[int]) -> _System:
    coords, edges, asg, _ = _arrays(obj)
    named = set(named)
    for e in sorted(named):
        if not 0 <= e < len(edges):
            raise KinematicsError(f"edge {e} is out of range (0…{len(edges) - 1})")
        if asg[e] in ("B", "C", "J"):
            raise KinematicsError(f"edge {e} is a {asg[e]} edge, not a crease")
    var = sorted({e for e, a in enumerate(asg) if a in ("M", "V", "U")} | named)
    sysm = _System(var, {e: i for i, e in enumerate(var)}, [SIGN.get(asg[e], 0) for e in var])
    star: dict[int, list[int]] = {}
    for e, (a, b) in enumerate(edges):
        star.setdefault(a, []).append(e)
        star.setdefault(b, []).append(e)
    for v in sorted(star):
        inc = star[v]
        if any(asg[e] in ("B", "C") for e in inc):
            continue
        rays = []
        floor = 0.0
        for e in inc:
            if e not in sysm.col:
                continue
            a, b = edges[e]
            w = b if a == v else a
            dx, dy = coords[w][0] - coords[v][0], coords[w][1] - coords[v][1]
            rays.append((math.atan2(dy, dx), e, unit((dx, 0.0, -dy))))
            floor += math.sqrt(2.0) * GRID_MM / math.hypot(dx, dy)
        sysm.accept = max(sysm.accept, floor)
        if rays:
            rays.sort(key=lambda t: (t[0], t[1]))
            sysm.loops.append(_Loop(v, [sysm.col[e] for _, e, _ in rays], [d for _, _, d in rays]))
    return sysm


# ── residuals and Jacobian ───────────────────────────────────────────────────


def log_vee(r: Mat3) -> Vec3:
    """Rotation vector (axis·angle, rad) of a rotation matrix."""
    w = (r[2][1] - r[1][2], r[0][2] - r[2][0], r[1][0] - r[0][1])
    c = max(-1.0, min(1.0, (r[0][0] + r[1][1] + r[2][2] - 1.0) / 2.0))
    s = math.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]) / 2.0
    theta = math.atan2(s, c)
    if theta < 1e-8:
        return (w[0] / 2.0, w[1] / 2.0, w[2] / 2.0)
    if math.pi - theta > 1e-6:
        k = theta / (2.0 * s)
        return (w[0] * k, w[1] * k, w[2] * k)
    axis = [math.sqrt(max(0.0, (r[i][i] - c) / (1.0 - c))) for i in range(3)]
    big = max(range(3), key=lambda i: axis[i])
    for i in range(3):
        if i != big:
            axis[i] = math.copysign(axis[i], r[big][i] + r[i][big])
    if w[big] < 0:
        axis = [-a for a in axis]
    return (axis[0] * theta, axis[1] * theta, axis[2] * theta)


def _loop_state(loop: _Loop, rho: Sequence[float]) -> tuple[Vec3, list[Vec3]]:
    p = IDENTITY3
    ell = []
    for c, d in zip(loop.cols, loop.dirs, strict=True):
        ell.append(mat_vec(p, d))
        p = mat_mul3(p, axis_rotation(d, rho[c]))
    return log_vee(p), ell


def _residual(sysm: _System, rho: Sequence[float]) -> tuple[list[float], list[list[Vec3]]]:
    r: list[float] = []
    ells = []
    for loop in sysm.loops:
        rv, ell = _loop_state(loop, rho)
        r.extend(rv)
        ells.append(ell)
    return r, ells


def _jacobian(sysm: _System, ells: list[list[Vec3]], cols: Sequence[int]) -> list[list[float]]:
    where = {c: j for j, c in enumerate(cols)}
    rows = []
    for loop, ell in zip(sysm.loops, ells, strict=True):
        block = [[0.0] * len(cols) for _ in range(3)]
        for c, li in zip(loop.cols, ell, strict=True):
            j = where.get(c)
            if j is not None:
                for k in range(3):
                    block[k][j] += li[k]
        rows.extend(block)
    return rows


def _maxabs(xs: Sequence[float]) -> float:
    return max((abs(x) for x in xs), default=0.0)


Chord = tuple[list[int], list[float], list[float], float]  # (cols, unit weights, origin, s)


def _full_residual(sysm: _System, rho: Sequence[float], chord: Chord | None
                   ) -> tuple[list[float], list[list[Vec3]]]:
    r, ells = _residual(sysm, rho)
    if chord is not None:
        cols, w, origin, target = chord
        r.append(math.fsum(wi * (rho[c] - o) for c, wi, o in zip(cols, w, origin, strict=True))
                 - target)
    return r, ells


def _newton(sysm: _System, rho: list[float], free: Sequence[int],
            chord: Chord | None = None) -> tuple[list[float], float]:
    """Levenberg–Marquardt on the free creases; returns (state, max |r|). `chord` adds the
    pseudo-arclength row ⟨w, ρ − ρ₀⟩ = s (progress along the start → target chord)."""
    rho = list(rho)
    r, ells = _full_residual(sysm, rho, chord)
    err = math.fsum(x * x for x in r)
    lam = LAMBDA0
    for _ in range(MAX_ITER):
        if _maxabs(r) < NEWTON_TOL_RAD or not free:
            break
        c = _jacobian(sysm, ells, free)
        if chord is not None:
            where = {col: j for j, col in enumerate(free)}
            row = [0.0] * len(free)
            for col, wi in zip(chord[0], chord[1], strict=True):
                if col in where:
                    row[where[col]] = wi
            c.append(row)
        try:
            step = linalg.damped_solve(c, r, len(free), lam)
        except ValueError:
            lam *= 10.0
            continue
        trial = list(rho)
        for j, col in enumerate(free):
            trial[col] -= step[j]
        r2, ells2 = _full_residual(sysm, trial, chord)
        err2 = math.fsum(x * x for x in r2)
        if err2 < err:
            rho, r, ells, err = trial, r2, ells2, err2
            lam = max(lam / 10.0, LAMBDA_MIN)
        else:
            lam *= 10.0
            if lam > LAMBDA_MAX:
                break
    return rho, _maxabs(r)


# ── branches at planar vertices ──────────────────────────────────────────────


def _planar_normal(ell: list[Vec3]) -> Vec3 | None:
    best, n = 0.0, None
    for i in range(len(ell)):
        for j in range(i + 1, len(ell)):
            x = cross(ell[i], ell[j])
            m = math.sqrt(x[0] * x[0] + x[1] * x[1] + x[2] * x[2])
            if m > best:
                best, n = m, x
    if n is None or best < 1e-6:
        return None
    n = unit(n)
    if all(abs(li[0] * n[0] + li[1] * n[1] + li[2] * n[2]) < PLANAR_TOL for li in ell):
        return n
    return None


def _quadratics(sysm: _System, ells: list[list[Vec3]], moving: set[int]
                ) -> list[list[tuple[int, int, float]]]:
    """Second-order closure n·½Σ_{i<j} vᵢvⱼ(ℓᵢ×ℓⱼ) of every planar vertex with a moving crease,
    as sparse quadratic forms [(col i, col j, coefficient)]."""
    out = []
    for loop, ell in zip(sysm.loops, ells, strict=True):
        if len(ell) < 2 or not moving & set(loop.cols):
            continue
        n = _planar_normal(ell)
        if n is None:
            continue
        terms = []
        for i in range(len(ell)):
            for j in range(i + 1, len(ell)):
                x = cross(ell[i], ell[j])
                coef = 0.5 * (x[0] * n[0] + x[1] * n[1] + x[2] * n[2])
                if abs(coef) > 1e-15:
                    terms.append((loop.cols[i], loop.cols[j], coef))
        out.append(terms)
    return out


def _qval(q: list[tuple[int, int, float]], v: Sequence[float]) -> float:
    return math.fsum(c * v[i] * v[j] for i, j, c in q)


def _qgrad(q: list[tuple[int, int, float]], v: Sequence[float], n: int) -> list[float]:
    g = [0.0] * n
    for i, j, c in q:
        g[i] += c * v[j]
        g[j] += c * v[i]
    return g


def _cone(qs, base: list[float], basis: list[list[float]], scale: float,
          assign: list[float]) -> list[list[float]]:
    """Tangent directions v = base + Σ tⱼ basisⱼ with every planar quadratic zero."""
    m, n = len(basis), len(base)

    def full(t: Sequence[float]) -> list[float]:
        return [base[i] + math.fsum(t[j] * basis[j][i] for j in range(m)) for i in range(n)]

    tol = 1e-10 * scale * scale
    if m == 0:
        return [base]
    starts: list[list[float]] = [[0.0] * m]
    starts.append([math.fsum(basis[j][i] * (assign[i] - base[i]) for i in range(n))
                   for j in range(m)])
    for j in range(m):
        for sgn in (1.0, -1.0):
            t = [0.0] * m
            t[j] = sgn * scale
            starts.append(t)
    found: list[list[float]] = []
    if m == 1:
        q0 = max(qs, key=lambda q: abs(_qval(q, full([1.0]))) + abs(_qval(q, full([-1.0]))))
        c0 = _qval(q0, full([0.0]))
        a = (_qval(q0, full([1.0])) + _qval(q0, full([-1.0]))) / 2.0 - c0
        b = (_qval(q0, full([1.0])) - _qval(q0, full([-1.0]))) / 2.0
        roots: list[float] = []
        if abs(a) > 1e-14 * max(1.0, abs(b)):
            disc = b * b - 4.0 * a * c0
            if disc >= 0.0:
                sq = math.sqrt(disc)
                roots = [(-b - sq) / (2.0 * a), (-b + sq) / (2.0 * a)]
        elif abs(b) > 1e-15:
            roots = [-c0 / b]
        for t in roots:
            v = full([t])
            if all(abs(_qval(q, v)) <= tol for q in qs):
                found.append(v)
        return found or [full([-b / (2.0 * a)]) if abs(a) > 1e-14 else base]
    for t0 in starts:
        t = list(t0)
        for _ in range(60):
            v = full(t)
            res = [_qval(q, v) for q in qs]
            if _maxabs(res) <= tol:
                found.append(v)
                break
            jac = [[math.fsum(g[i] * basis[j][i] for i in range(n)) for j in range(m)]
                   for g in (_qgrad(q, v, n) for q in qs)]
            pieces = linalg.pinv_split(jac, m)
            if not pieces[0]:
                break
            dt = linalg.min_norm_solve(pieces, [-x for x in res])
            t = [a + b for a, b in zip(t, dt, strict=True)]
    return found or [base]


# ── the solver ───────────────────────────────────────────────────────────────


def solve(system: Any, start: Mapping, drive: Mapping, fixed: Iterable = (), steps: int = 16,
          *, along: str = "drive") -> KinematicPath:
    """Rigid folding path: drive creases move from `start` to `drive` (degrees) in `steps`
    substeps; `fixed` creases hold their start angle; every other crease follows by loop
    closure. `system` is an `Arrangement`, a `Sheet` (keys may be its `Mark`s) or a
    `Document` (global edge indices). Unlisted creases start at 0.

    ``along="drive"`` (default) moves the driven creases linearly — the classic Tier R drive.
    ``along="chord"`` is pseudo-arclength continuation toward a known end state: the driven
    creases are free too, and substep k is the closed state whose projection on the chord
    start → target (in angle space, over the driven creases) is k/steps of it. Progress is then
    spread evenly over the creases even where one of them races (a collapse ending flat-folded),
    and the path must arrive at the targets (`Sequence.kinematic_path` uses it).

    Raises `KinematicsError` when the start does not close or the drive leaves the rigid
    configuration space. Returns a `KinematicPath` (list of ``{edge: deg}``)."""
    if steps < 1:
        raise KinematicsError("steps must be ≥ 1")
    _, _, _, sheet = _arrays(system)
    st, dr = _expand(start, sheet), _expand(drive, sheet)
    fx = set(_expand(fixed, sheet))
    if along not in ("drive", "chord"):
        raise KinematicsError(f"along must be 'drive' or 'chord', not {along!r}")
    if not dr:
        raise KinematicsError("drive names no crease")
    if fx & set(dr):
        raise KinematicsError(f"edges {sorted(fx & set(dr))} are both driven and fixed")
    sysm = _system(system, set(st) | set(dr) | fx)
    n = len(sysm.edges)
    rho0 = [math.radians(float(st.get(e, 0.0))) for e in sysm.edges]
    dcols = [sysm.col[e] for e in sorted(dr)]
    target = [math.radians(float(dr[e])) for e in sorted(dr)]
    fcols = {sysm.col[e] for e in fx}
    free = [c for c in range(n) if c not in fcols and c not in set(dcols)]
    rho, res0 = _newton(sysm, rho0, free)
    if res0 > sysm.accept:
        raise KinematicsError(f"the start state does not close (residual {res0:.3g} rad)")
    rho0 = rho
    lead = max(range(len(dcols)), key=lambda i: (abs(target[i] - rho0[dcols[i]]), -i))
    sense = (1 if target[lead] >= rho0[dcols[lead]] else -1) * (sysm.sign[dcols[lead]] or 1)
    states, branch_steps, worst = [], [], 0.0
    mid_state = rho0
    span = math.sqrt(math.fsum((t - rho0[c]) ** 2 for c, t in zip(dcols, target, strict=True)))
    weights = [(t - rho0[c]) / span if span else 0.0 for c, t in zip(dcols, target, strict=True)]
    for k in range(1, steps + 1):
        f = k / steps
        t_d = [rho0[c] + (t - rho0[c]) * f for c, t in zip(dcols, target, strict=True)]
        if along == "chord" and span > 0.0:
            chord = (dcols, weights, [rho0[c] for c in dcols], f * span)
            rho, res, branched = _advance(sysm, rho, [], [], free + dcols,
                                          dict(zip(dcols, t_d, strict=True)), sense, chord)
        else:
            rho, res, branched = _advance(sysm, rho, dcols, t_d, free, {}, sense)
        if branched:
            branch_steps.append(k)
        worst = max(worst, res)
        if k == (steps + 1) // 2:
            mid_state = rho
        out = {}
        for e, a in zip(sysm.edges, rho, strict=True):
            deg = math.degrees(a)
            if abs(deg) > 180.0 + ANGLE_SLACK_DEG:
                raise KinematicsError(f"step {k}/{steps}: edge {e} would fold to {deg:.6f}° "
                                      "(beyond ±180°, the faces would pass through each other)")
            out[e] = max(-180.0, min(180.0, deg))
        states.append(out)
    return KinematicPath(states, edges=list(sysm.edges), max_residual_rad=worst,
                         branch_steps=branch_steps, _rank_at=(sysm, mid_state, list(free)))


def _rank(c: list[list[float]], n: int) -> int:
    if not c or n == 0:
        return 0
    return len(linalg.pinv_split(c, n)[0])


def _advance(sysm: _System, rho: list[float], dcols: list[int], t_d: list[float],
             free: list[int], guide: dict[int, float], sense: int,
             chord: Chord | None = None) -> tuple[list[float], float, bool]:
    n = len(rho)
    delta = [0.0] * n
    for c, t in zip(dcols, t_d, strict=True):
        delta[c] = t - rho[c]
    for c, t in guide.items():
        delta[c] = t - rho[c]
    guided = [c for c in free if c in guide]
    unknown = [c for c in free if c not in guide]
    _, ells = _residual(sysm, rho)
    c_all = _jacobian(sysm, ells, list(range(n)))
    b = [-math.fsum(row[c] * delta[c] for c in dcols + guided) for row in c_all]
    c_u = [[row[c] for c in unknown] for row in c_all]
    pieces = linalg.pinv_split(c_u, len(unknown)) if unknown else ([], [], [], [])
    v_u = linalg.min_norm_solve(pieces, b) if unknown else []
    base = list(delta)
    for c, x in zip(unknown, v_u, strict=True):
        base[c] = x
    cands = [base]
    moving = set(dcols) | set(free)
    qs = _quadratics(sysm, ells, moving) if not guide else []
    if qs and unknown:
        basis = []
        for nb in pieces[3]:
            vec = [0.0] * n
            for c, x in zip(unknown, nb, strict=True):
                vec[c] = x
            basis.append(vec)
        scale = max(_maxabs([delta[c] for c in dcols]), 1e-12)
        assign = list(delta)
        for c in unknown:
            assign[c] = sense * sysm.sign[c] * scale
        cands = _cone(qs, base, basis, scale, assign) + [base]
    sols: list[tuple[list[float], float]] = []
    for v in cands:
        guess = [r + d for r, d in zip(rho, v, strict=True)]
        sol, res = _newton(sysm, guess, free, chord)
        if any(abs(x) > math.pi + math.radians(ANGLE_SLACK_DEG) for x in sol):
            continue    # Newton jumped a crease past ±180° (a 2π-equivalent rotation)
        if res <= sysm.accept and not any(
                _maxabs([a - b for a, b in zip(sol, s, strict=True)]) < 1e-9 for s, _ in sols):
            sols.append((sol, res))
    if not sols:
        raise KinematicsError(
            f"the drive {[round(math.degrees(t), 6) for t in t_d]}° leaves the rigid "
            "configuration space (no closed state near the path)")
    if len(sols) == 1:
        return sols[0][0], sols[0][1], len(cands) > 1

    def score(item: tuple[int, tuple[list[float], float]]) -> tuple:
        i, (sol, _) = item
        agree = 0
        for c in free:
            d = sol[c] - rho[c]
            if abs(d) > 1e-7 and sysm.sign[c]:
                agree += 1 if (d > 0) == (sense * sysm.sign[c] > 0) else -1
        motion = math.fsum((sol[c] - rho[c]) ** 2 for c in free)
        return (-agree, motion, i)

    best = min(enumerate(sols), key=score)[1]
    return best[0], best[1], True


# ── vertex fold angles and residuals ─────────────────────────────────────────


def vertex_folds(rays: Sequence[Sequence[float]], previous: Sequence[float] | None = None,
                 sectors: Sequence[float] | None = None) -> tuple[float, ...]:
    """Signed fold angles (deg, valley > 0) at the creases of one vertex from world rays.

    `rays` are the world directions of the vertex's creases in counter-clockwise sheet order;
    face i spans rays i → i+1 and its front normal is rays[i] × rays[i+1] (flipped where the
    flat sector `sectors[i]` exceeds 180°). The fold at ray i is the signed angle from face
    i−1's normal to face i's about the ray — the convention of `face_transforms` and `solve`.
    A flat-folded crease (normals antiparallel) is ±180 by the sign of `previous[i]` (+180 when
    no previous state is given)."""
    k = len(rays)
    if k < 2:
        raise ValueError("a vertex needs at least two creases")
    normals = []
    for i in range(k):
        x = cross(rays[i], rays[(i + 1) % k])
        m = math.sqrt(x[0] * x[0] + x[1] * x[1] + x[2] * x[2])
        if m < 1e-12:
            raise ValueError(f"rays {i} and {(i + 1) % k} are parallel: the face between them "
                             "has a 0° or 180° sector (give a vertex with non-straight sectors)")
        if sectors is not None and sectors[i] > 180.0:
            m = -m
        normals.append((x[0] / m, x[1] / m, x[2] / m))
    out = []
    for i in range(k):
        a, b = normals[i - 1], normals[i]
        r = unit(rays[i])
        ab = cross(a, b)
        rho = math.degrees(math.atan2(ab[0] * r[0] + ab[1] * r[1] + ab[2] * r[2],
                                      a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
        if abs(abs(rho) - 180.0) < 1e-6:
            rho = 180.0 if previous is None or previous[i] >= 0 else -180.0
        out.append(rho)
    return tuple(out)


def vertex_residuals(system: Any, angles: Mapping) -> dict[int, float]:
    """Loop-closure residual |vee(log F_v)| (rad) of every interior vertex with creases — a
    size-independent measure (the mm residual of `closure_residual` scales with the sheet)."""
    _, _, _, sheet = _arrays(system)
    ang = _expand(angles, sheet)
    sysm = _system(system, set(ang))
    rho = [math.radians(float(ang.get(e, 0.0))) for e in sysm.edges]
    out = {}
    for loop in sysm.loops:
        rv, _ = _loop_state(loop, rho)
        out[loop.vertex] = math.sqrt(rv[0] * rv[0] + rv[1] * rv[1] + rv[2] * rv[2])
    return out
