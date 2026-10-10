"""Vertex moves: every sector around one vertex moving at once (`pliego.flatvertex`).

A **vertex move** takes the paper around one vertex of a flat state — a precreased region such as
a square creased for the waterbomb or preliminary base, a stack whose layers all turn about the
same point such as a newspaper hat opened at its apex — to a new state with every sector moving
together, the way hands collapse a base:

- `star(state, center)` reads the vertex: the sheet vertex at the folded point `center` whose
  creases split the paper (its *rays*, counter-clockwise on the flat sheet), the *sector* each
  wedge between two rays carries — the wedge's face and every face joined to it without crossing
  a crease that lies on a ray's image (the stacked layers that turn with it) — and the rays'
  current fold angles;
- `collapse(state, center, folds)` folds the listed rays flat (valley / mountain, in the crease
  pattern's sense: valley folds towards the sheet's front) and leaves the others as they are.
  The new placements compose the reflections across the folded rays (Kawasaki: they close round
  the vertex); the layer order is completed by `pliego.flatcheck.solve` from the side each face
  arrives from in the 3-D motion, and checked (taco/tortilla, transitivity, Kawasaki, Maekawa).

**The 3-D path.** A degree-n single vertex has n − 3 degrees of freedom. The motion follows the
straight chord from the start angles to the target angles in angle space, projected onto the
rigid configuration space — `pliego.kinematics.solve(..., along="chord")` on the vertex's star, so
a symmetric start and target give a symmetric path; the flat (or flat-folded) start is a
bifurcation, where the solver takes the branch whose creases fold the way their targets say. Poses
between the solved samples are the blend of the two neighbouring samples projected back onto the
closure manifold (minimum-norm Newton), so every pose the fold program draws is rigid.

`VertexPath` is the reusable part: the same linkage drives 3-D vertex poses that end off flat
(`pliego.foldprogram.FoldProgram.vertex_pose`: the fortune teller shaped, opened and closed).
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from . import flatmotion
from .flatops import Move, _move, flood
from .flatstate import (
    TOL,
    Affine,
    FlatState,
    FlatStateError,
    Pt,
    embed3,
    pt,
    reflect_xf,
    xf_apply,
    xf_compose,
    xf_invert,
)
from .space import axis_rotation, mat_mul, mat_vec

PATH_STEPS = 32          # solved samples along the chord
STAR_R = 40.0            # mm: radius of the star sheet the solver works on
NEWTON_TOL = 1e-12       # rad: projection of blended angles back onto the closure manifold
RAY_DEG = 1e-6           # rays closer than this (deg) are one ray


@dataclass
class Star:
    """The linkage at one sheet vertex: `origin` (sheet point), `dirs` (unit ray directions on
    the flat sheet, counter-clockwise), `wedges[i]` the face between ray i and ray i + 1,
    `groups[i]` the faces that move with it, `angles[i]` ray i's fold angle now (deg)."""

    center: Pt
    vertex: int
    origin: Pt
    dirs: list[Pt]
    wedges: list[int]
    groups: list[set[int]]
    angles: list[float]

    def ray_index(self, key) -> int:
        """Ray by its direction on the flat sheet (degrees counter-clockwise from +x) or by a
        sheet point on it."""
        if isinstance(key, int | float):
            a = math.radians(float(key))
            u = (math.cos(a), math.sin(a))
        else:
            q = pt(key)
            dx, dy = q[0] - self.origin[0], q[1] - self.origin[1]
            ln = math.hypot(dx, dy)
            if ln < TOL:
                raise FlatStateError("a ray is named by a point off the vertex")
            u = (dx / ln, dy / ln)
        best = max(range(len(self.dirs)), key=lambda i: u[0] * self.dirs[i][0]
                   + u[1] * self.dirs[i][1])
        d = self.dirs[best]
        if u[0] * d[0] + u[1] * d[1] < math.cos(math.radians(0.01)):
            raise FlatStateError(f"no crease of the vertex runs along {key!r}")
        return best


def star(state: FlatState, center, *, sheet_point=None) -> Star:
    """The vertex linkage at the folded point `center` (see the module docstring). Where several
    sheet vertices lie at `center`, the interior one with the most creases is taken (or the one
    nearest `sheet_point`)."""
    q = pt(center)
    at: dict[int, list[int]] = {}
    for f, face in enumerate(state.faces):
        for v in face.verts:
            w = xf_apply(face.xf, state.points[v])
            if abs(w[0] - q[0]) <= 1e-5 and abs(w[1] - q[1]) <= 1e-5:
                at.setdefault(v, []).append(f)
    if not at:
        raise FlatStateError(f"vertex move: no vertex at ({q[0]:.4f}, {q[1]:.4f})")
    half = state.half_edges()
    bnd = {(a, b) for a, b, _ in state.boundary_edges()}

    def interior(v: int) -> bool:
        return not any(v in e for e in bnd)
    cands = [v for v in sorted(at) if interior(v)]
    if not cands:
        raise FlatStateError("vertex move: the vertex lies on the paper's edge or a slit")
    if sheet_point is not None:
        s = pt(sheet_point)
        v = min(cands, key=lambda c: math.dist(state.points[c], s))
    else:
        v = max(cands, key=lambda c: (len(at[c]), -c))
    o = state.points[v]
    # wedges round v, counter-clockwise on the sheet: each incident face contributes the ray of
    # its edge leaving v
    rays: list[tuple[float, Pt, int]] = []
    for f in at[v]:
        vs = state.faces[f].verts
        k = vs.index(v)
        nxt = state.points[vs[(k + 1) % len(vs)]]
        dx, dy = nxt[0] - o[0], nxt[1] - o[1]
        ln = math.hypot(dx, dy)
        rays.append((math.atan2(dy, dx), (dx / ln, dy / ln), f))
    rays.sort()
    dirs = [r[1] for r in rays]
    wedges = [r[2] for r in rays]           # the face between ray i and ray i + 1
    n = len(dirs)
    if n < 2:
        raise FlatStateError("vertex move: the vertex has fewer than two creases")
    # creases on the rays' folded images block the sector floods
    imgs = []
    for i in range(n):
        f = wedges[i]
        p0 = xf_apply(state.faces[f].xf, o)
        p1 = xf_apply(state.faces[f].xf, (o[0] + dirs[i][0], o[1] + dirs[i][1]))
        imgs.append((p0, (p1[0] - p0[0], p1[1] - p0[1])))

    def on_ray(f: int, a: int, b: int) -> bool:
        xf = state.faces[f].xf
        for p0, d in imgs:
            ok = True
            for x in (state.points[a], state.points[b]):
                w = xf_apply(xf, x)
                rx, ry = w[0] - p0[0], w[1] - p0[1]
                if abs(d[0] * ry - d[1] * rx) > 1e-5 or d[0] * rx + d[1] * ry < -1e-5:
                    ok = False
                    break
            if ok:
                return True
        return False
    groups: list[set[int]] = []
    taken: set[int] = set()
    for i in range(n):
        g = flood(state, {wedges[i]}, lambda f: True, on_ray)
        if g & taken:
            raise FlatStateError("vertex move: the rays do not separate the paper (two sectors "
                                 "are joined away from the vertex)")
        taken |= g
        groups.append(g)
    # layers stacked at the vertex but hinged only on rays (a blintzed corner whose tip sits on
    # the vertex): each such piece turns with the sector whose wedge it lies in
    span = []
    for i in range(n):
        a0 = math.atan2(imgs[i][1][1], imgs[i][1][0])
        a1 = math.atan2(imgs[(i + 1) % n][1][1], imgs[(i + 1) % n][1][0])
        flip = state.faces[wedges[i]].flipped
        span.append((a1, a0) if flip else (a0, a1))
    rest = [f for f in range(len(state.faces)) if f not in taken]
    while rest:
        g = flood(state, {rest[0]}, lambda f, taken=taken: f not in taken, on_ray)
        c = _centroid_dir(state, g, q)
        hits = [i for i, (a0, a1) in enumerate(span)
                if 1e-9 < (c - a0) % (2 * math.pi) < (a1 - a0) % (2 * math.pi) - 1e-9]
        if len(hits) != 1:
            raise FlatStateError("vertex move: a layer stacked at the vertex lies on "
                                 f"{len(hits)} sectors' wedges (pick the vertex by sheet_point)")
        groups[hits[0]] |= g
        taken |= g
        rest = [f for f in rest if f not in taken]
    angles = []
    for i in range(n):
        f, g = wedges[i - 1], wedges[i]
        if (v, _next(state, g, v)) not in half or half.get((_next(state, g, v), v)) != f:
            raise FlatStateError("vertex move: the vertex's faces do not close round it")
        angles.append(state.crease_angle(f, g))
    return Star(q, v, o, dirs, wedges, groups, angles)


def _centroid_dir(state: FlatState, faces: set[int], q: Pt) -> float:
    """Direction (rad, folded frame) from q to the centroid of the faces' images."""
    pts = [p for f in sorted(faces) for p in state.image(f)]
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    return math.atan2(cy - q[1], cx - q[0])


def _next(state: FlatState, f: int, v: int) -> int:
    vs = state.faces[f].verts
    return vs[(vs.index(v) + 1) % len(vs)]


class VertexPath:
    """A rigid path of a vertex linkage from `start` to `target` fold angles (deg, per ray of
    `star`): t ∈ [0, 1] ↦ angles, and ↦ each sector's world rigid motion (on top of its placement
    in the state the star was read from), sector `fixed` held."""

    def __init__(self, st: Star, start: Sequence[float], target: Sequence[float],
                 xf: Mapping[int, Affine], fixed: int = 0, steps: int = PATH_STEPS,
                 hold: Sequence[int] = ()):
        from .kinematics import solve
        from .sheet import Sheet

        self.star, self.fixed, self.xf = st, fixed, dict(xf)
        n = len(st.dirs)
        self.world = [(d[0], 0.0, -d[1]) for d in st.dirs]
        self.start, self.target = [float(a) for a in start], [float(a) for a in target]
        self.hold = set(hold)
        moving = [i for i in range(n) if i not in self.hold]
        if all(abs(self.target[i] - self.start[i]) <= 1e-9 for i in moving):
            raise FlatStateError("vertex move: no ray changes its angle")
        outline = sorted({round(math.atan2(d[1], d[0]), 12) for d in st.dirs}
                         | {round(-math.pi + k * math.pi / 16, 12) for k in range(32)})
        ring, last = [], None
        for a in outline:
            if last is None or a - last > 1e-6:
                ring.append((STAR_R * math.cos(a), STAR_R * math.sin(a)))
                last = a
        sheet = Sheet("star", ring)
        marks = []
        for i, d in enumerate(st.dirs):
            sgn = self.target[i] or self.start[i] or 1.0
            marks.append(sheet.crease((0.0, 0.0), (STAR_R * d[0], STAR_R * d[1]),
                                      "valley" if sgn > 0 else "mountain", 180.0))
        start_m = {marks[i]: self.start[i] for i in range(n)}
        drive = {marks[i]: self.target[i] for i in moving}
        fixed_m = [marks[i] for i in range(n) if i not in moving]
        from .motion import KinematicsError
        try:
            path = solve(sheet, start_m, drive, fixed=fixed_m, steps=steps, along="chord")
        except KinematicsError as exc:
            raise FlatStateError(f"vertex move: no rigid path to these fold angles ({exc})") \
                from exc
        edge = [m.edges()[0] for m in marks]
        m_ = len(path)
        # each sample: the point of the configuration space nearest the chord point (the
        # solver's continuation picks the branch and seeds it), so the path does not drift
        # off a symmetry the start and the target share
        self.samples = [list(self.start)]
        for k, sol in enumerate(path, 1):
            if k == m_:
                self.samples.append(list(self.target))
            else:
                self.samples.append(self._nearest(self._chord(k / m_),
                                                  [sol[edge[i]] for i in range(n)]))
        self.report = {"dof": path.dof, "branch_steps": list(path.branch_steps),
                       "max_residual_rad": path.max_residual_rad}

    def angles(self, t: float) -> list[float]:
        """Fold angles at t (exact at the solved samples, projected in between)."""
        m = len(self.samples) - 1
        x = min(max(t, 0.0), 1.0) * m
        k = min(int(math.floor(x)), m - 1)
        u = x - k
        if u < 1e-12:
            return list(self.samples[k])
        if u > 1.0 - 1e-12:
            return list(self.samples[k + 1])
        a, b = self.samples[k], self.samples[k + 1]
        return self._nearest(self._chord(t),
                             [(1.0 - u) * x0 + u * x1 for x0, x1 in zip(a, b, strict=True)])

    def _chord(self, t: float) -> list[float]:
        return [a + t * (b - a) for a, b in zip(self.start, self.target, strict=True)]

    def _nearest(self, chord: list[float], guess: list[float]) -> list[float]:
        """The closed state nearest the chord point (deg; free rays only move), from a guess on
        the right branch: x ← c + Jᵀ(JJᵀ)⁻¹(J(x − c) − r(x)), whose fixed point closes the loop
        with x − c orthogonal to the configuration space."""
        c = [math.radians(a) for a in chord]
        rho = [math.radians(a) for a in guess]
        for i in self.hold:
            rho[i] = c[i]
        free = [i for i in range(len(rho)) if i not in self.hold]
        for _ in range(100):
            f, ells = _loop(self.world, rho)
            r = _log_vee(f)
            jd = [sum(ells[i][a] * (rho[i] - c[i]) for i in free) - r[a] for a in range(3)]
            jjt = [[sum(ells[i][a] * ells[i][b] for i in free) + (1e-15 if a == b else 0.0)
                    for b in range(3)] for a in range(3)]
            y = _solve3(jjt, jd)
            new = list(rho)
            for i in free:
                new[i] = c[i] + sum(ells[i][k] * y[k] for k in range(3))
            step = max(abs(new[i] - rho[i]) for i in free)
            rho = new
            if step < 1e-14 and max(abs(x) for x in r) < NEWTON_TOL:
                break
        res = _log_vee(_loop(self.world, rho)[0])
        if max(abs(x) for x in res) > 1e-10:
            raise FlatStateError("vertex move: the chord's projection does not close "
                                 f"({max(abs(x) for x in res):.3g} rad)")
        return [math.degrees(x) for x in rho]

    def sector_rigid(self, t: float) -> list[flatmotion.Rigid]:
        """World motion of each sector at t (on top of its placement at t = 0)."""
        st = self.star
        rel = _sector_poses(self.world, [math.radians(a) for a in self.angles(t)])
        root = flatmotion.invert(rel[self.fixed])
        ox, oy = st.origin
        to_o = (((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), (ox, 0.0, -oy))
        from_o = flatmotion.invert(to_o)
        base = embed3(self.xf[st.wedges[self.fixed]])
        out = []
        for i, w in enumerate(st.wedges):
            pose = flatmotion.compose(base, flatmotion.compose(
                to_o, flatmotion.compose(flatmotion.compose(root, rel[i]), from_o)))
            out.append(flatmotion.compose(pose, flatmotion.invert(embed3(self.xf[w]))))
        return out

    def motion(self) -> flatmotion.Motion:
        groups = self.star.groups

        def at(t: float) -> dict[int, flatmotion.Rigid]:
            g = self.sector_rigid(t)
            return {f: g[i] for i, grp in enumerate(groups) for f in grp}
        return at


def _loop(world: list, rho: list[float]):
    """F = R(d₀, ρ₀)⋯R(d_{n−1}, ρ_{n−1}) and each ray's current direction ℓᵢ."""
    m = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
    ells = []
    for d, r in zip(world, rho, strict=True):
        ells.append(mat_vec(m, d))
        m = mat_mul(m, axis_rotation(d, r))
    return m, ells


def _log_vee(m):
    from .motion import log_vee
    return log_vee(m)


def _solve3(a, b):
    det = (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
           - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
           + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    out = []
    for c in range(3):
        mm = [[b[r] if k == c else a[r][k] for k in range(3)] for r in range(3)]
        out.append((mm[0][0] * (mm[1][1] * mm[2][2] - mm[1][2] * mm[2][1])
                    - mm[0][1] * (mm[1][0] * mm[2][2] - mm[1][2] * mm[2][0])
                    + mm[0][2] * (mm[1][0] * mm[2][1] - mm[1][1] * mm[2][0])) / det)
    return out


def _sector_poses(world: list, rho: list[float]) -> list[flatmotion.Rigid]:
    """Rotation of the wedge after each ray relative to the wedge before ray 0 (about the
    vertex at the origin): wedge i ↦ R(d₀, ρ₀)⋯R(dᵢ, ρᵢ)."""
    m = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
    out = []
    for d, r in zip(world, rho, strict=True):
        m = mat_mul(m, axis_rotation(d, r))
        out.append((m, (0.0, 0.0, 0.0)))
    return out


def _target(st: Star, folds: Mapping) -> list[float]:
    out = list(st.angles)
    for key, val in folds.items():
        i = st.ray_index(key)
        if isinstance(val, str):
            if val not in ("valley", "mountain", "flat"):
                raise FlatStateError(f"vertex move: fold {val!r} is not valley, mountain or flat")
            out[i] = {"valley": 180.0, "mountain": -180.0, "flat": 0.0}[val]
        else:
            out[i] = float(val)
    return out


def _flat_xf(st: Star, state: FlatState, target: list[float], fixed: int) -> list[Affine]:
    """Each sector's new placement isometry (folded frame) for a flat-folded target: crossing a
    folded ray reflects across its line on the sheet (Kawasaki: the product closes)."""
    n = len(st.dirs)
    o = st.origin
    xfs: list[Affine | None] = [None] * n
    w0 = st.wedges[fixed]
    cur = state.faces[w0].xf
    xfs[fixed] = cur
    i = fixed
    for _ in range(n):
        j = (i + 1) % n                 # crossing ray j from wedge i to wedge j
        if abs(abs(target[j]) - 180.0) < 1e-9:
            cur = xf_compose(cur, reflect_xf(o, st.dirs[j]))
        elif abs(target[j]) > 1e-9:
            raise FlatStateError("vertex move: a flat target needs every ray at 0 or ±180°")
        if j == fixed:
            if max(abs(a - b) for a, b in zip(cur, xfs[fixed], strict=True)) > 1e-7:
                raise FlatStateError("vertex move: the folded rays do not close round the "
                                     "vertex (Kawasaki fails for this assignment)")
            break
        xfs[j] = cur
        i = j
    out = []
    for k in range(n):
        new = xfs[k]
        out.append(xf_compose(new, xf_invert(state.faces[st.wedges[k]].xf)))
    return out


def collapse(state: FlatState, center, folds: Mapping, *, fixed=None, sheet_point=None,
             steps: int = PATH_STEPS) -> Move:
    """Collapse the paper round the vertex at the folded point `center`: the rays named in
    `folds` (sheet direction in degrees, or a sheet point on the ray → "valley" | "mountain" |
    "flat") fold flat at once, every other ray holds. `fixed`: a sheet point of the sector that
    stays (default: the sector holding the most faces, then the lowest wedge). See the module
    docstring."""
    what = "vertex collapse"
    st = star(state, center, sheet_point=sheet_point)
    target = _target(st, folds)
    n = len(st.dirs)
    if fixed is None:
        k0 = max(range(n), key=lambda i: (len(st.groups[i]), -i))
    else:
        f0 = state.face_at(fixed)
        k0 = next((i for i in range(n) if f0 in st.groups[i]), None)
        if k0 is None:
            raise FlatStateError(f"{what}: the fixed point is on no sector")
    held = [i for i in range(n) if not any(st.ray_index(k) == i for k in folds)]
    xfs = _flat_xf(st, state, target, k0)
    path = VertexPath(st, st.angles, target, {w: state.faces[w].xf for w in st.wedges},
                      fixed=k0, steps=steps, hold=held)
    motion = path.motion()
    group = {f: f"s{i}" for i, grp in enumerate(st.groups) for f in grp}
    xf = {f"s{i}": xfs[i] for i in range(n)}
    end = motion(1.0)
    for i, grp in enumerate(st.groups):
        f = min(grp)
        got = flatmotion.compose(end[f], embed3(state.faces[f].xf))
        want = embed3(xf_compose(xfs[i], state.faces[f].xf))
        dev = max(abs(got[0][r][c] - want[0][r][c]) for r in range(3) for c in range(3))
        dev = max(dev, max(abs(got[1][k] - want[1][k]) for k in range(3)) / 100.0)
        if dev > 1e-6:
            raise FlatStateError(f"{what}: the 3-D path does not end in the folded state "
                                 f"({dev:.3g}); the assignment is not reachable rigidly")
    new = _move(state, group, xf, lambda i, j: None, lambda i, j: 1, what, motion)
    for i in range(n):
        if i in held:
            continue
        ang = new.crease_angle(st.wedges[i - 1], st.wedges[i])
        if ang != target[i]:
            raise FlatStateError(f"{what}: ray {i} ends at {ang:+.0f}°, not {target[i]:+.0f}° "
                                 "(no layer order gives this assignment)")
    samples = [k / 8 for k in range(1, 9)]
    return Move("collapse", state, new, list(range(len(state.faces))), motion, samples,
                {"center": st.center, "vertex": st.origin, "rays": st.dirs, "start": st.angles,
                 "target": target, "fixed": k0, "path": path.report,
                 "groups": [sorted(g) for g in st.groups]})


__all__ = ["Star", "VertexPath", "collapse", "star"]
