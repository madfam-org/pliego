"""3-D steps of a fold program that keep folding afterwards (`pliego.foldpose`).

`pliego.foldprogram.FoldProgram` may stand faces up (`hinge`, `vertex_pose`, `kinematic`) and
then keep folding flat inside a group of faces that stays rigid and coplanar — the masu box's
walls stand at 90°, then each flap folds 180° over its wall. The program keeps two layers:

- the **flat state** (`FlatState`): the faces and creases made so far, at the placements they had
  before the first 3-D step (later flat folds only add creases to it);
- the **3-D pose** (`Pose3`): the world rigid motion of every face, set by the 3-D steps.

A flat fold after 3-D steps (`Pose3.fold`) acts on the group of faces that lie in one plane and
are joined to a face named by `within`: the group is re-flattened into that face's folded frame
(a `FlatState` of the group alone, its layer order read from the side each face approached the
plane from in the 3-D step that brought it there, then completed and checked by
`pliego.flatcheck`), folded there with `pliego.flatops.fold` — layer order, taco / tortilla
parity, Kawasaki and Maekawa checked within the group — and carried back into 3-D. A flap of the
moving paper may turn about an existing crease at the same time (`hinge`: the masu flap's tip
landing on the floor). The fold program checks, at every sampled state of such a step and of a
`kinematic` step, that no moving face passes through paper that does not move with it
(`penetration`).

`kinematic(...)` is the multi-vertex rigid step these models need (the masu's end wall rising
while its corners fold in): the creases on the given folded-frame segments are driven or free,
every other crease holds, and `pliego.kinematics.solve` follows the rigid path on the whole
crease pattern.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence

from . import flatmotion
from .flatstate import (
    Affine,
    Face,
    FlatState,
    FlatStateError,
    Pt,
    as_line,
    centroid,
    embed3,
    on_segments,
    pt,
)
from .space import cross, dot, sub

PENETRATION_MM = 0.05    # a moving face crossing another face by more than this fails the step
COPLANAR = 1e-6          # faces whose planes agree this closely touch; they do not cross


def dihedral(rf, rg, a3, b3) -> float:
    """Fold angle (deg, valley > 0) of the edge a3 → b3 (unplaced coordinates, face f on its
    left) between faces posed by rotations rf and rg (the fold program's readout)."""
    ny = (rg[0][1], rg[1][1], rg[2][1])
    n = tuple(rf[0][i] * ny[0] + rf[1][i] * ny[1] + rf[2][i] * ny[2] for i in range(3))
    dx, dz = b3[0] - a3[0], b3[2] - a3[2]
    ln = math.hypot(dx, dz)
    return -math.degrees(math.atan2((dx * n[2] - dz * n[0]) / ln, n[1]))


def creases_on(state: FlatState, segments: Iterable) -> list[tuple[Pt, Pt]]:
    """Sheet segments of every crease (in every layer) whose folded image lies on one of the
    folded-frame segments."""
    segs = [(pt(a), pt(b)) for a, b in segments]
    out = []
    for c in state.creases():
        a, b = state.segment_image(c.f, c.a, c.b)
        if on_segments(a, b, segs, 1e-5):
            out.append((state.points[c.a], state.points[c.b]))
    return out


def edges_on(arr, segs: Sequence[tuple[Pt, Pt]]) -> list[int]:
    """Edges of an arrangement lying on one of the sheet segments (foldable edges only)."""
    out = []
    for e, (a, b) in enumerate(arr.edges):
        if arr.assignment[e] in ("B", "C", "J"):
            continue
        pa, pb = arr.vertices[a], arr.vertices[b]
        if on_segments((pa.x, pa.y), (pb.x, pb.y), segs, 1e-5):
            out.append(e)
    return out


def components(state: FlatState, cut_segs: Sequence[tuple[Pt, Pt]]) -> list[int]:
    """Component index of each face: faces joined without crossing a crease on `cut_segs`."""
    from .flatops import flood

    comp = [-1] * len(state.faces)
    k = 0
    for f in range(len(state.faces)):
        if comp[f] >= 0:
            continue
        grp = flood(state, {f}, lambda g: True, lambda g, a, b: on_segments(
            state.points[a], state.points[b], cut_segs, 1e-5))
        for g in grp:
            comp[g] = k
        k += 1
    return comp


NUDGES_DEG = (2.0, 5.0, 10.0, 20.0)   # a hinted free crease leaves a bifurcation by this
                                      # much first (the first that lets the chord path through)


def solve_step(arr, cur: dict[int, float], drive: dict[int, float], free: Iterable[int],
               steps: int, hints: dict[int, int] | None = None) -> list[dict[int, float]]:
    """Rigid path on the whole pattern: `drive` edges to their targets, `free` edges follow,
    every other crease holds (`kinematics.solve`, chord continuation). `hints` (edge → ±1): at a
    start where the rigid paths branch (a gusset that may fold in or out), those free creases
    first turn the hinted way (valley +, mountain −) by the first of NUDGES_DEG that lets the
    chord path through, the rest following."""
    from .kinematics import solve
    from .motion import KinematicsError

    free = set(free)
    fixed = [e for e in cur if e not in drive and e not in free]
    last = None
    for nud in (NUDGES_DEG if hints else (0.0,)):
        out = [dict(cur)]
        start = dict(cur)
        try:
            if hints:
                nudge = {e: cur[e] + sg * nud for e, sg in sorted(hints.items())}
                fixed_n = [e for e in cur if e not in nudge and e not in free and e not in drive]
                first = solve(arr, start, nudge, fixed=fixed_n, steps=1, along="drive")
                start = {**cur, **first[-1]}
                out.append(dict(start))
            path = solve(arr, start, drive, fixed=fixed, steps=steps, along="chord")
        except KinematicsError as exc:
            last = exc
            continue
        return out + [{**start, **s} for s in path]
    raise FlatStateError(f"kinematic step: no rigid path ({last})") from last


def poses_of(arr, angles: dict[int, float], root: int, root_pose: flatmotion.Rigid
             ) -> list[flatmotion.Rigid]:
    """World pose of every face for fold angles, the root face at `root_pose` (unplaced → world)."""
    from .kinematics import face_transforms

    tr = face_transforms(arr, angles, root)
    out = []
    for t in tr:
        if t is None:
            raise FlatStateError("kinematic step: a face is not joined to the root face")
        out.append(flatmotion.compose(root_pose, t))
    return out


def rigid_dev(a: flatmotion.Rigid, b: flatmotion.Rigid, scale: float = 100.0) -> float:
    """A size-aware difference of two rigid motions (rotation entries plus translation/scale)."""
    d = max(abs(a[0][i][j] - b[0][i][j]) for i in range(3) for j in range(3))
    return max(d, max(abs(a[1][k] - b[1][k]) for k in range(3)) / scale)


def check_penetration(arr, poses_at, start, ts, sid, fail: bool = True) -> float:
    """The worst crossing of a moving face through paper that does not move with it at the
    sampled states of a step (a step after 3-D steps fails loud beyond PENETRATION_MM; a tuck
    only reports it, `fail=False`)."""
    end = poses_at(1.0)
    moving = {f for f in range(len(arr.faces)) if rigid_dev(start[f], end[f]) > 1e-9}
    worst = 0.0
    for t in sorted(set(ts) | {0.5}):
        worst = max(worst, penetration(arr, poses_at(t), moving))
    if fail and worst > PENETRATION_MM:
        raise FlatStateError(f"step '{sid}': a moving face passes {worst:.3g} mm through "
                             "paper that does not move with it")
    return worst


def _plane(poly: list) -> tuple[tuple, float] | None:
    n = (0.0, 0.0, 0.0)
    for i in range(1, len(poly) - 1):
        c = cross(sub(poly[i], poly[0]), sub(poly[i + 1], poly[0]))
        n = (n[0] + c[0], n[1] + c[1], n[2] + c[2])
    ln = math.sqrt(dot(n, n))
    if ln < 1e-12:
        return None
    n = (n[0] / ln, n[1] / ln, n[2] / ln)
    return n, dot(n, poly[0])


def _cross_len(pa: list, pb: list) -> float:
    """Length of the part of convex polygon pa's crossing of pb's plane that lies inside pb."""
    pla, plb = _plane(pa), _plane(pb)
    if pla is None or plb is None:
        return 0.0
    (na, _), (nb, db) = pla, plb
    if abs(abs(dot(na, nb)) - 1.0) < COPLANAR:
        return 0.0
    sd = [dot(nb, p) - db for p in pa]
    if max(sd) <= 1e-9 or min(sd) >= -1e-9:
        return 0.0
    pts = []
    for i in range(len(pa)):
        j = (i + 1) % len(pa)
        if (sd[i] > 0) != (sd[j] > 0) and abs(sd[i] - sd[j]) > 1e-15:
            t = sd[i] / (sd[i] - sd[j])
            pts.append(tuple(pa[i][k] + t * (pa[j][k] - pa[i][k]) for k in range(3)))
    if len(pts) < 2:
        return 0.0
    p0, p1 = pts[0], pts[-1]
    d = sub(p1, p0)
    lo, hi = 0.0, 1.0
    n = len(pb)
    for i in range(n):
        a, b = pb[i], pb[(i + 1) % n]
        inward = cross(nb, sub(b, a))
        s0, s1 = dot(inward, sub(p0, a)), dot(inward, sub(p1, a))
        if s0 < 0 and s1 < 0:
            return 0.0
        if s0 < 0 or s1 < 0:
            t = s0 / (s0 - s1)
            if s0 < 0:
                lo = max(lo, t)
            else:
                hi = min(hi, t)
    return max(0.0, hi - lo) * math.sqrt(dot(d, d))


def penetration(arr, poses: Sequence[flatmotion.Rigid], moving: set[int]) -> float:
    """The longest crossing (mm) of a moving face through a face that does not move with it at
    one pose (faces sharing a vertex are joined, not crossing)."""
    polys = [[flatmotion.apply(poses[f], (arr.vertices[v].x, 0.0, -arr.vertices[v].y))
              for v in cyc] for f, cyc in enumerate(arr.faces)]
    boxes = [(tuple(min(p[k] for p in poly) for k in range(3)),
              tuple(max(p[k] for p in poly) for k in range(3))) for poly in polys]
    verts = [set(cyc) for cyc in arr.faces]
    worst = 0.0
    for f in sorted(moving):
        for g in range(len(arr.faces)):
            if g in moving or verts[f] & verts[g]:
                continue
            if any(boxes[f][0][k] > boxes[g][1][k] + 1e-6 or boxes[g][0][k] > boxes[f][1][k]
                   + 1e-6 for k in range(3)):
                continue
            worst = max(worst, min(_cross_len(polys[f], polys[g]), _cross_len(polys[g],
                                                                             polys[f])))
    return worst


def hinge_line(state: FlatState, line, at, layers=None, from_: str = "top",
               among: set[int] | None = None) -> dict:
    """A hinge nested in a flat move: the flap on `at`'s side of the folded line (the layers
    at `at`, all or `layers` from the top/bottom, and the paper joined to them without crossing
    the line), limited to `among`."""
    from .flatops import _on_line, _stack_at, flood
    from .flatstate import side

    p, d = as_line(line)
    q = pt(at)
    sgn = 1.0 if side(p, d, q) > 0 else -1.0
    cand = set(range(len(state.faces))) if among is None else set(among)
    stack = _stack_at(state, q, cand)
    if layers is not None:
        stack = stack[-int(layers):] if from_ == "top" else stack[:int(layers)]
    grp = flood(state, set(stack), cand.__contains__,
                lambda f, a, b: _on_line(state.faces[f].xf, state.points[a], state.points[b],
                                         p, d))
    if grp == cand:
        raise FlatStateError("nested hinge: the flap is the whole moving group")
    return {"faces": sorted(grp), "p": p, "d": d, "sense": sgn}


def _flat2(r: flatmotion.Rigid):
    """The plane isometry of a rigid motion that keeps the folded plane (inverse of `embed3`),
    or None when it tilts the plane."""
    m, t = r
    if abs(abs(m[1][1]) - 1.0) > 1e-7 or abs(t[1]) > 1e-5 or abs(m[0][1]) > 1e-7 \
            or abs(m[2][1]) > 1e-7:
        return None
    return (m[0][0], -m[0][2], -m[2][0], m[2][2], t[0], -t[2])


class Pose3:
    """The 3-D pose of a fold program's faces while it is recorded: `world[f]` maps face f's
    sheet coordinates (unplaced: (u, 0, −v)) into the world, for the faces of `state`."""

    def __init__(self, state: FlatState):
        self.state = state
        self.world = [embed3(f.xf) for f in state.faces]
        self.lifted = False
        self.history: list[tuple[FlatState, object]] = []

    def follow(self, move) -> None:
        """A flat move before any 3-D step: the pose is the flat placement."""
        if self.lifted:
            raise FlatStateError("flat moves after 3-D steps go through Pose3.fold")
        self.state = move.state
        self.world = [embed3(f.xf) for f in move.state.faces]

    def _commit(self, state: FlatState, fn) -> None:
        self.state = state
        self.world = fn(1.0)
        self.lifted = True
        self.history.append((state, fn))

    def extra(self, f: int) -> flatmotion.Rigid:
        return flatmotion.compose(self.world[f], flatmotion.invert(embed3(self.state.faces[f].xf)))

    # ── 3-D steps ──
    def hinge(self, state: FlatState, specs: list[dict]):
        """Hinge poses (`FoldProgram.hinges`): each flap turns about its line, carried by the
        faces it hinges on (they must agree)."""
        world0 = list(self.world)
        turns = []
        for spec in specs:
            grp = set(spec["faces"])
            refs = sorted({c.g if c.f in grp else c.f for c in state.creases()
                           if (c.f in grp) != (c.g in grp)})
            exs = [self.extra(r) for r in refs] or [flatmotion.ID_RIGID]
            if any(rigid_dev(e, exs[0]) > 1e-9 for e in exs):
                raise FlatStateError("hinge: the faces the flap hinges on do not move together")
            p, d = spec["p"], spec["d"]
            o = flatmotion.apply(exs[0], flatmotion.w3(p))
            o2 = flatmotion.apply(exs[0], flatmotion.w3((p[0] + d[0], p[1] + d[1])))
            turns.append((grp, o, tuple(o2[k] - o[k] for k in range(3)),
                          spec["sense"] * math.radians(spec["turn"])))

        def fn(t: float) -> list:
            out = list(world0)
            for grp, o, ax, rad in turns:
                g = flatmotion.rot_line(o, ax, rad * t)
                for f in grp:
                    out[f] = flatmotion.compose(g, world0[f])
            return out
        self._commit(state, fn)
        return fn

    def vertex(self, state: FlatState, path):
        """A vertex pose (`FoldProgram.vertex_pose`): sectors on top of their flat placements."""
        sector = {f: i for i, grp in enumerate(path.star.groups) for f in grp}
        flat = [embed3(f.xf) for f in state.faces]

        def fn(t: float) -> list:
            g = path.sector_rigid(t)
            return [flatmotion.compose(g[sector[f]], flat[f]) if f in sector else flat[f]
                    for f in range(len(state.faces))]
        self._commit(state, fn)
        return fn

    def kinematic(self, state: FlatState, drive: list, free: list, fixed, steps: int):
        """A rigid step on the whole crease pattern so far (`FoldProgram.kinematic`): t ↦ world
        poses, and the sample times that fall on solved states."""
        from .geometry import Vec2, point_in_polygon
        from .kinematics import face_adjacency, root_face

        arr = state.unfold("kinematic").build()
        rings = [[arr.vertices[v] for v in cyc] for cyc in arr.faces]
        home = []
        for f in range(len(state.faces)):
            c = Vec2(*centroid(state.poly(f)))
            home.append(next(i for i, r in enumerate(rings) if point_in_polygon(c, r) == 1))
        rep = {}
        for f, a in enumerate(home):
            rep.setdefault(a, f)
        if len(rep) != len(arr.faces):
            raise FlatStateError("kinematic: a face of the pattern holds no face of the state")
        u = [(v.x, 0.0, -v.y) for v in arr.vertices]
        cur = {}
        for f, lst in face_adjacency(arr).items():
            for g, e, a, b in lst:
                if e not in cur:
                    cur[e] = dihedral(self.world[rep[f]][0], self.world[rep[g]][0], u[a], u[b])
        dr = {}
        for segs, ang in drive:
            for e in edges_on(arr, segs):
                dr[e] = ang
        plain = [seg for seg, _ in free]
        fr = edges_on(arr, plain)
        hints = {}
        for seg, sign in free:
            if sign:
                for e in edges_on(arr, [seg]):
                    hints[e] = sign
        if not dr:
            raise FlatStateError("kinematic: the drive names no crease")
        states = solve_step(arr, cur, dr, fr, steps, hints)
        root = root_face(arr, Vec2(*pt(fixed))) if fixed is not None else 0
        root_pose = self.world[rep[root]]
        p0 = poses_of(arr, states[0], root, root_pose)
        bad = max(rigid_dev(p0[a], self.world[f]) for f, a in enumerate(home))
        if bad > 1e-6:
            raise FlatStateError(f"kinematic: the pattern's angles do not reproduce the pose "
                                 f"({bad:.3g})")
        m = len(states) - 1
        samples = sorted({i / m for i in range(1, m + 1)
                          if i == m or i == len(states) - steps - 1 or (m - i) % 4 == 0})

        def fn(t: float) -> list:
            x = min(max(t, 0.0), 1.0) * m
            i = min(int(math.floor(x)), m - 1)
            w = x - i
            ang = {e: (1 - w) * states[i][e] + w * states[i + 1][e] for e in states[i]}
            ps = poses_of(arr, ang, root, root_pose)
            return [ps[a] for a in home]
        self._commit(state, fn)
        return fn, samples

    # ── a flat fold inside a coplanar group ──
    def group(self, state: FlatState, within) -> tuple[list[int], flatmotion.Rigid, list]:
        """The faces lying in the plane of the face at the sheet point `within` and joined to it
        through faces in that plane; the map L from that face's folded frame (world embedding)
        to the world; each group face's placement in that frame."""
        from .flatops import flood

        s = state.face_at(within)
        lmap = flatmotion.compose(self.world[s], flatmotion.invert(embed3(state.faces[s].xf)))
        inv = flatmotion.invert(lmap)
        local: dict[int, Affine] = {}
        for f in range(len(state.faces)):
            a = _flat2(flatmotion.compose(inv, self.world[f]))
            if a is not None:
                local[f] = a
        grp = flood(state, {s}, local.__contains__, lambda f, a, b: False)
        g = sorted(grp)
        return g, lmap, [local[f] for f in g]

    def _hints(self, state: FlatState, g: list[int], loc: FlatState, lmap, cs) -> dict:
        """Layer-order hints for the re-flattened group: pairs that kept their relative pose since
        the flat state keep its order (seen through the group's frame); the others take the side
        they approached from late in the last 3-D step that moved them apart."""
        nloc = mat_col(lmap[0], 1)
        witness: dict[tuple[int, int], Pt] = {}
        for q, stack in cs:
            for a_, x in enumerate(stack):
                for y in stack[a_ + 1:]:
                    witness.setdefault((x, y), q)
        hints = {}
        for (i, j), q in sorted(witness.items()):
            fi, fj = g[i], g[j]
            h = None
            for st_old, fn in reversed(self.history):
                mi = st_old.face_at(centroid(state.poly(fi)))
                mj = st_old.face_at(centroid(state.poly(fj)))
                w0, w1 = fn(0.0), fn(1.0)
                rel0 = flatmotion.compose(flatmotion.invert(w0[mi]), w0[mj])
                rel1 = flatmotion.compose(flatmotion.invert(w1[mi]), w1[mj])
                if rigid_dev(rel0, rel1) < 1e-9:
                    continue
                wl = fn(0.95)
                h = _height(wl[mi], lmap, q, nloc) - _height(wl[mj], lmap, q, nloc)
                h = None if abs(h) < 1e-9 else (1 if h > 0 else -1)
                break
            if h is None:
                up = state.above(fi, fj)
                if up is not None:
                    nv = mat_col(self.extra(fi)[0], 1)
                    same = dot(nv, nloc) > 0
                    h = (1 if up == same else -1)
            hints[(i, j)] = 1 if (h or 1) > 0 else -1
        return hints

    def fold(self, state: FlatState, within, line, direction: str, nested: dict | None,
             select: dict):
        """A flat fold of the coplanar group at `within` (see the module docstring): returns the
        move on the flat state (new creases only) and t ↦ the world pose of every face."""
        from .flatcheck import cells, check, solve
        from .flatops import Move, _inherit, _repair, fold

        g, lmap, local = self.group(state, within)
        index = {f: i for i, f in enumerate(g)}
        loc = state.derive(faces=[Face(state.faces[f].verts, local[i]) for i, f in enumerate(g)],
                           order={}, partial=True)
        cs = cells(loc)
        loc = solve(loc, self._hints(state, g, loc, lmap, cs), cs)
        issues = check(loc, cs=cs)
        if issues:
            raise FlatStateError("the coplanar group has no valid layer order: "
                                 + "; ".join(i["detail"] for i in issues[:3]))
        sel = dict(select)
        if "faces" in sel:
            sel["faces"] = [index[f] for f in sel["faces"] if f in index]
        mv = fold(loc, line, direction, **sel)
        tip = None
        if nested is not None:
            spec = hinge_line(mv.info["split"], nested["line"], nested["at"],
                              nested.get("layers"), nested.get("from_", "top"),
                              set(mv.info["moving"]))
            tip = (set(spec["faces"]), flatmotion.w3(spec["p"]), flatmotion.wdir(spec["d"]),
                   spec["sense"] * math.radians(float(nested["turn"])))
        rest = [f for f in range(len(state.faces)) if f not in index]
        faces = [state.faces[f] for f in rest] + [
            Face(cyc.verts, state.faces[g[mv.parent[i]]].xf) for i, cyc in
            enumerate(mv.state.faces)]
        parent = rest + [g[mv.parent[i]] for i in range(len(mv.state.faces))]
        pts = mv.state.points
        new = state.derive(points=pts, faces=_repair(faces, pts), order={},
                           creased=mv.state.creased, partial=state.partial)
        new = _inherit(new, state, parent, "fold")
        world0 = list(self.world)
        n_rest = len(rest)
        base_loc = [embed3(mv.before.faces[mv.parent[i]].xf) for i in range(len(mv.state.faces))]

        def fn(t: float) -> list:
            gm = mv.motion(t)
            out = [world0[f] for f in rest]
            for i in range(len(mv.state.faces)):
                gi = gm.get(i, flatmotion.ID_RIGID)
                if tip is not None and i in tip[0]:
                    gi = flatmotion.compose(gi, flatmotion.rot_line(tip[1], tip[2], tip[3] * t))
                out.append(flatmotion.compose(lmap, flatmotion.compose(gi, base_loc[i])))
            return out
        move = Move("fold", state, new, parent, lambda t: {}, list(mv.samples),
                    {"line": mv.info["line"], "group": g, "local": mv.state,
                     "moving": [n_rest + i for i in mv.info["moving"]]})
        self._commit(new, fn)
        return move, fn


def mat_col(m, k: int):
    return (m[0][k], m[1][k], m[2][k])


def _height(w: flatmotion.Rigid, lmap: flatmotion.Rigid, q: Pt, n) -> float:
    """Signed offset along n of the face posed by w, where the line through the group frame's
    point q (along n) meets the face's plane."""
    o = flatmotion.apply(lmap, (q[0], 0.0, -q[1]))
    p0 = w[1]
    nf = mat_col(w[0], 1)
    den = dot(nf, n)
    if abs(den) < 1e-9:
        return dot(sub(p0, o), n)
    return dot(sub(p0, o), nf) / den


__all__ = ["PENETRATION_MM", "Pose3", "components", "creases_on", "dihedral", "edges_on",
           "hinge_line", "penetration", "poses_of", "solve_step"]
