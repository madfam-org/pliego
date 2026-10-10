"""What the studio preview draws for a fold state (`pliego.preview`).

The studio's preview engine (``apps/web/studio/src/engine-stub.js``) poses a single sheet as a
face tree: breadth-first from face 0 through every hinge edge (M, V, F, U, J), each child face
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


class PreviewTree:
    """The preview's face tree of one built sheet (`pliego.Arrangement`)."""

    def __init__(self, arr):
        self.arr = arr
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
            queue = deque([0])
            seen[0] = True
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
            drawn[0] = intended[0]
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
        """Largest distance between the images of a vertex shared by two adjacent faces."""
        worst = 0.0
        u = self.unplaced
        for e, fs in enumerate(self.edge_faces):
            if len(fs) < 2:
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
