"""What the studio preview draws for a fold state (`pliego.preview`).

The studio's preview engine (``apps/web/studio/src/engine-stub.js``) poses a single sheet as a
face tree: breadth-first from the sheet's root face (spec §5.16 ``presentation.root_face``, else
its first face) through every hinge edge (M, V, F, U, J), each child face
rotated about its shared edge by that edge's fold angle. Creases outside the tree are not used,
so a fold state whose angles do not close shows as a tear there. This module replicates that tree
(same traversal order, same rotation convention, no display clamp) so a fold program can measure
what the preview shows: `tear()` is the largest distance between the two images of a shared
vertex, `deviation()` the largest distance from an intended pose.
"""

from __future__ import annotations

import math
from collections import deque
from collections.abc import Mapping, Sequence

from . import flatmotion
from .space import axis_rotation, sub, unit

HINGE = frozenset("MVFUJ")
MID_TEAR_MM = 0.5    # refine a step's samples until the preview's blend tears less than this
MAX_SAMPLES = 24


class PreviewTree:
    """The preview's face tree of one built sheet (`pliego.Arrangement`), rooted at face `root`
    — the sheet's §5.16 `presentation.root_face` (on this sheet), the face the preview holds
    still; default its first face."""

    def __init__(self, arr, root: int = 0):
        self.arr = arr
        if arr.faces and not 0 <= root < len(arr.faces):
            raise ValueError(f"preview root face {root} is not a face of the sheet")
        self.root = root
        self.unplaced = [(v.x, 0.0, -v.y) for v in arr.vertices]
        key = {}
        for e, (a, b) in enumerate(arr.edges):
            key[(min(a, b), max(a, b))] = e
        self.edge_of = key
        edge_faces: list[list[int]] = [[] for _ in arr.edges]
        for fi, f in enumerate(arr.faces):
            for k in range(len(f)):
                a, b = f[k], f[(k + 1) % len(f)]
                e = key.get((min(a, b), max(a, b)))
                if e is not None:
                    edge_faces[e].append(fi)
        self.edge_faces = edge_faces
        n = len(arr.faces)
        self.parent: list[tuple[int, int, int, int] | None] = [None] * n
        self.order: list[int] = []
        seen = [False] * n
        if n:
            queue = deque([root])
            seen[root] = True
            while queue:
                f = queue.popleft()
                self.order.append(f)
                cyc = arr.faces[f]
                for k in range(len(cyc)):
                    a, b = cyc[k], cyc[(k + 1) % len(cyc)]
                    e = key.get((min(a, b), max(a, b)))
                    if e is None or arr.assignment[e] not in HINGE:
                        continue
                    for g in edge_faces[e]:
                        if g != f and not seen[g]:
                            seen[g] = True
                            self.parent[g] = (f, e, a, b)
                            queue.append(g)

    def pose(self, angles: Mapping[int, float]) -> list[flatmotion.Rigid]:
        """Rigid transform of every face for edge angles (deg), as the preview draws it."""
        out: list[flatmotion.Rigid] = [flatmotion.ID_RIGID] * len(self.arr.faces)
        u = self.unplaced
        for f in self.order:
            par = self.parent[f]
            if par is None:
                continue
            p, e, a, b = par
            ax = unit(sub(u[a], u[b]))
            r = axis_rotation(ax, math.radians(angles.get(e, 0.0)))
            out[f] = flatmotion.compose(out[p], (r, sub(u[a], _mv(r, u[a]))))
        return out

    def fit(self, intended: Sequence[flatmotion.Rigid], angles: Mapping[int, float]
            ) -> dict[int, float]:
        """Angles for the tree edges that make the preview draw each face as close as it can to
        its intended pose (least squares over the face's vertices, parent first): the exact
        dihedral wherever the intended motion is rigid there, the best hinge rotation where it is
        not (a non-rigid move). Other edges keep `angles`."""
        out = dict(angles)
        drawn: list[flatmotion.Rigid] = [flatmotion.ID_RIGID] * len(self.arr.faces)
        u = self.unplaced
        if self.order:
            drawn[self.root] = intended[self.root]
        for f in self.order:
            par = self.parent[f]
            if par is None:
                continue
            p, e, a, b = par
            ax = unit(sub(u[a], u[b]))
            inv = flatmotion.invert(drawn[p])
            num = den = 0.0
            for v in self.arr.faces[f]:
                x = sub(u[v], u[a])
                z = sub(flatmotion.apply(inv, flatmotion.apply(intended[f], u[v])), u[a])
                xp = sub(x, tuple(ax[k] * _dot(ax, x) for k in range(3)))
                zp = sub(z, tuple(ax[k] * _dot(ax, z) for k in range(3)))
                num += _dot(ax, _cross(xp, zp))
                den += _dot(xp, zp)
            th = math.degrees(math.atan2(num, den))
            if abs(abs(th) - 180.0) < 1e-4:
                th = math.copysign(180.0, angles.get(e, th) or th)
            out[e] = th
            r = axis_rotation(ax, math.radians(th))
            drawn[f] = flatmotion.compose(drawn[p], (r, sub(u[a], _mv(r, u[a]))))
        return out

    def tear(self, poses: Sequence[flatmotion.Rigid]) -> float:
        """Largest distance between the images of a vertex shared by two faces joined at an
        edge (a hinge: not across a slit, whose sides part when the paper opens there)."""
        worst = 0.0
        u = self.unplaced
        for e, fs in enumerate(self.edge_faces):
            if len(fs) < 2 or self.arr.assignment[e] not in HINGE:
                continue
            f, g = fs[0], fs[1]
            for v in self.arr.edges[e]:
                pf = flatmotion.apply(poses[f], u[v])
                pg = flatmotion.apply(poses[g], u[v])
                worst = max(worst, math.dist(pf, pg))
        return worst

    def deviation(self, poses: Sequence[flatmotion.Rigid],
                  intended: Sequence[flatmotion.Rigid]) -> float:
        """Largest distance between a vertex as posed and as intended."""
        worst = 0.0
        u = self.unplaced
        for fi, cyc in enumerate(self.arr.faces):
            for v in cyc:
                worst = max(worst, math.dist(flatmotion.apply(poses[fi], u[v]),
                                             flatmotion.apply(intended[fi], u[v])))
        return worst


def _mv(m, v):
    return (m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2])


def _dot(a, b) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


FLAT_DEG = 1e-9      # a crease this close to 0° is open: it has no sign to keep at ±180°


def _at_180(a: float) -> bool:
    return abs(abs(a) - 180.0) < 1e-4


def approach_signs(readout, poses_at, t0: float, t1: float, prev: dict, ang: dict) -> dict:
    """`prev` with a sign for every crease that reads ±180° at t1 but was open at t0: the
    sign of its angle halfway (spec §5.38) — a move from 0 to ±180° in one sample otherwise
    takes its sign from round-off."""
    flips = [e for e, a in ang.items() if _at_180(a) and abs(prev.get(e, 0.0)) < FLAT_DEG]
    if not flips:
        return prev
    half = readout(poses_at((t0 + t1) / 2.0), prev)
    return {**prev, **{e: half[e] for e in flips if abs(half[e]) > FLAT_DEG}}


def sample_step(tree, readout, poses_at, ts0, cur, end, folds, sid, end_follows_motion=False,
                keep=frozenset()):
    """Angles at the sample times, refined (midpoints inserted) wherever the preview's
    linear blend between two samples tears more than MID_TEAR_MM, up to MAX_SAMPLES. A crease
    that reaches ±180° takes the sign it approaches with (`approach_signs`, spec §5.38); with
    `end_follows_motion` (a tuck) so does the end state, whose layer order may say the other
    sign for the same pose. The creases in `keep` (tucked earlier) keep their sign while they
    stay at ±180°, whatever a later end state's layer order says."""
    from .flatstate import FlatStateError

    ts = sorted(set(ts0))
    done = None
    while True:
        prev, seq, tears, mids, devs = dict(cur), [], [], [], []
        last = cur
        t0 = 0.0
        for t in ts:
            poses = poses_at(min(t, 1.0))
            ang = readout(poses, end if (end is not None and t >= 1.0) else prev)
            if end is not None and t >= 1.0:
                bad = max((min(abs(ang[e] - end[e]), 360.0 - abs(ang[e] - end[e]))
                           for e in folds), default=0.0)
                if bad > 1e-5:
                    raise FlatStateError(f"step '{sid}': the motion does not end in the "
                                         f"folded state ({bad:.3g}° off)")
                ang = dict(end)
                if end_follows_motion:
                    seen = approach_signs(readout, poses_at, t0, min(t, 1.0), prev, ang)
                    for e, a in end.items():
                        if _at_180(a) and abs(seen.get(e, 0.0)) > FLAT_DEG \
                                and (seen[e] > 0) != (a > 0):
                            ang[e] = -a
            else:
                guide = approach_signs(readout, poses_at, t0, min(t, 1.0), prev, ang)
                if guide is not prev:
                    ang = readout(poses, guide)
                ang = tree.fit(poses, ang)
            for e in keep:      # a tucked crease at ±180° keeps the sign it was tucked with
                a, b = ang.get(e), last.get(e, 0.0)
                if a is not None and a != b and abs(abs(a) - 180.0) < 1e-6 \
                        and abs(abs(b) - 180.0) < 1e-6:
                    ang[e] = b
            full = {**last, **ang}
            drawn = tree.pose(full)
            tears.append(tree.tear(drawn))
            devs.append(tree.deviation(drawn, _rooted(poses, drawn, tree.root)))
            mids.append(tree.tear(tree.pose({e: (last[e] + full[e]) / 2.0 for e in folds})))
            seq.append(ang)
            prev, last, t0 = ang, full, min(t, 1.0)
        if done is not None and max(mids) > 0.75 * max(done[2]):
            return done           # refining does not help: a jump the blend cannot follow
        done = (seq, tears, mids, devs)
        bad_iv = [k for k, m in enumerate(mids) if m > MID_TEAR_MM and m > 2.0 * tears[k]
                  and (k == 0 or m > 2.0 * tears[k - 1])]
        if not bad_iv or len(ts) >= MAX_SAMPLES:
            return done
        t_prev = [0.0] + ts[:-1]
        ts = sorted(set(ts) | {(t_prev[k] + ts[k]) / 2.0 for k in bad_iv})[:MAX_SAMPLES]


def _rooted(intended: list, drawn: list, root: int = 0) -> list:
    """Intended poses moved so the root face sits where the preview draws it (the preview keeps
    the root face fixed; the intended motion may move it)."""
    fix = flatmotion.compose(drawn[root], flatmotion.invert(intended[root]))
    return [flatmotion.compose(fix, p) for p in intended]
