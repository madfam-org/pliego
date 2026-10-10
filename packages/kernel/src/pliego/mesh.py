"""`Mesh` — polygon meshes for papercraft (low-poly models), built procedurally.

A mesh is a list of 3-D vertices (mm or any unit; world frame, Y up) and a list of faces, each a
list of vertex indices **counter-clockwise seen from outside** (outward normals by the right-hand
rule). Meshes may be closed or open (boundary edges belong to one face); every edge is shared by
at most two faces, with opposite directions (a consistently oriented 2-manifold, possibly with
boundary). `Mesh.check()` enforces it and fails loud.

This is not a solid modeler (kernel.md §1: no 3-D solid kernel): there is no boolean, no volume
and no B-rep — only the polyhedral surfaces papercraft needs, built from primitives (`box`,
`icosphere`, `uv_sphere`, `lathe`, `torus`, `prism`) and local operations (`extrude`, affine
transforms, `mapped`, `merged`). `pliego.unfold.net()` unfolds a mesh into tabbed, numbered nets.

Everything is deterministic: vertices and faces come out in authored order, no randomness.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from .space import Vec3, add, cross, dot, norm, scale, sub, unit

PLANAR_TOL = 1e-6  # relative planarity tolerance (fraction of the face diameter)


class MeshError(ValueError):
    """A mesh breaks the papercraft mesh contract (fail loud)."""


def newell(pts: Sequence[Sequence[float]]) -> Vec3:
    """Newell normal of a 3-D polygon (length = 2 × area)."""
    nx = ny = nz = 0.0
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        nx += (p[1] - q[1]) * (p[2] + q[2])
        ny += (p[2] - q[2]) * (p[0] + q[0])
        nz += (p[0] - q[0]) * (p[1] + q[1])
    return (nx, ny, nz)


@dataclass
class Mesh:
    """Vertices (x, y, z) and counter-clockwise faces (outward normals)."""

    vertices: list[Vec3]
    faces: list[list[int]]

    def __post_init__(self) -> None:
        self.vertices = [(float(p[0]), float(p[1]), float(p[2])) for p in self.vertices]
        self.faces = [[int(i) for i in f] for f in self.faces]

    # ── queries ─────────────────────────────────────────────────────────────

    def face_points(self, f: int) -> list[Vec3]:
        return [self.vertices[i] for i in self.faces[f]]

    def normal(self, f: int) -> Vec3:
        return unit(newell(self.face_points(f)))

    def area(self, f: int) -> float:
        return norm(newell(self.face_points(f))) / 2.0

    def centroid(self, f: int) -> Vec3:
        pts = self.face_points(f)
        return scale((math.fsum(p[0] for p in pts), math.fsum(p[1] for p in pts),
                      math.fsum(p[2] for p in pts)), 1.0 / len(pts))

    def bounds(self) -> tuple[Vec3, Vec3]:
        xs, ys, zs = zip(*self.vertices, strict=True)
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))

    def edges(self) -> dict[tuple[int, int], list[tuple[int, int]]]:
        """Undirected edge (lo, hi) → [(face, k)] where face edge k runs faces[f][k] → [k+1]."""
        out: dict[tuple[int, int], list[tuple[int, int]]] = {}
        for fi, f in enumerate(self.faces):
            for k in range(len(f)):
                a, b = f[k], f[(k + 1) % len(f)]
                out.setdefault((min(a, b), max(a, b)), []).append((fi, k))
        return out

    def signed_volume(self) -> float:
        """Enclosed volume (> 0 when faces point outward; meaningful for closed meshes)."""
        acc = []
        for f in self.faces:
            p0 = self.vertices[f[0]]
            for k in range(1, len(f) - 1):
                acc.append(dot(p0, cross(self.vertices[f[k]], self.vertices[f[k + 1]])) / 6.0)
        return math.fsum(acc)

    def is_closed(self) -> bool:
        return all(len(v) == 2 for v in self.edges().values())

    def planarity(self, f: int) -> float:
        """Largest distance of a face vertex from the face's mean plane, over its diameter."""
        pts = self.face_points(f)
        if len(pts) == 3:
            return 0.0
        n, c = self.normal(f), self.centroid(f)
        diam = max(norm(sub(p, q)) for p in pts for q in pts) or 1.0
        return max(abs(dot(sub(p, c), n)) for p in pts) / diam

    def check(self) -> Mesh:
        """Validate the contract (indices, faces, manifold, orientation); returns self."""
        nv = len(self.vertices)
        if nv < 3 or not self.faces:
            raise MeshError("a mesh needs at least 3 vertices and one face")
        if not all(all(math.isfinite(c) for c in p) for p in self.vertices):
            raise MeshError("vertex coordinates must be finite")
        for fi, f in enumerate(self.faces):
            if len(f) < 3:
                raise MeshError(f"face {fi} has fewer than 3 vertices")
            if any(not 0 <= i < nv for i in f):
                raise MeshError(f"face {fi} references a vertex out of range")
            if len(set(f)) != len(f):
                raise MeshError(f"face {fi} repeats a vertex")
            if self.area(fi) <= 1e-12:
                raise MeshError(f"face {fi} is degenerate (zero area)")
        for (a, b), uses in self.edges().items():
            if len(uses) > 2:
                raise MeshError(f"edge {a}-{b} is shared by {len(uses)} faces (non-manifold)")
            if len(uses) == 2:
                (f, k), (g, m) = uses
                if self.faces[f][k] == self.faces[g][m]:
                    raise MeshError(f"faces {f} and {g} disagree on orientation across edge "
                                    f"{a}-{b} (faces must all be counter-clockwise from outside)")
        return self

    # ── transforms (affine maps keep planar faces planar) ──────────────────

    def mapped(self, fn: Callable[[Vec3], Sequence[float]]) -> Mesh:
        """A copy with every vertex mapped by fn (non-affine maps may bend faces: `net()`
        triangulates faces that are no longer planar)."""
        return Mesh([tuple(map(float, fn(p))) for p in self.vertices],  # type: ignore[misc]
                    [list(f) for f in self.faces])

    def scaled(self, sx: float, sy: float | None = None, sz: float | None = None) -> Mesh:
        sy = sx if sy is None else sy
        sz = sx if sz is None else sz
        flip = (sx < 0) ^ (sy < 0) ^ (sz < 0)
        out = self.mapped(lambda p: (p[0] * sx, p[1] * sy, p[2] * sz))
        if flip:  # a mirror turns faces inside out: restore counter-clockwise order
            out.faces = [list(reversed(f)) for f in out.faces]
        return out

    def moved(self, dx: float, dy: float, dz: float) -> Mesh:
        return self.mapped(lambda p: (p[0] + dx, p[1] + dy, p[2] + dz))

    def rotated(self, axis: Sequence[float], deg: float) -> Mesh:
        """Rotated by `deg` about an axis through the origin (right-hand rule)."""
        x, y, z = unit(axis)
        c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
        k = 1.0 - c
        m = ((c + x * x * k, x * y * k - z * s, x * z * k + y * s),
             (y * x * k + z * s, c + y * y * k, y * z * k - x * s),
             (z * x * k - y * s, z * y * k + x * s, c + z * z * k))
        return self.mapped(lambda p: tuple(m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2]
                                           for i in range(3)))

    def triangulated(self, faces: Sequence[int] | None = None) -> Mesh:
        """Split the given faces (default: every non-planar face) into triangles: quads along
        their shorter diagonal, larger faces by ear clipping in their mean plane."""
        todo = set(faces if faces is not None else
                   [f for f in range(len(self.faces)) if self.planarity(f) > PLANAR_TOL])
        out: list[list[int]] = []
        for fi, f in enumerate(self.faces):
            if fi not in todo or len(f) == 3:
                out.append(list(f))
            else:
                out.extend(_triangles(self, fi))
        return Mesh(list(self.vertices), out)


def merged(*meshes: Mesh) -> Mesh:
    """Disjoint meshes as one (separate components; `net()` unfolds each into its own pieces)."""
    verts: list[Vec3] = []
    faces: list[list[int]] = []
    for m in meshes:
        base = len(verts)
        verts.extend(m.vertices)
        faces.extend([i + base for i in f] for f in m.faces)
    return Mesh(verts, faces)


def _triangles(mesh: Mesh, fi: int) -> list[list[int]]:
    f = mesh.faces[fi]
    pts = mesh.face_points(fi)
    if len(f) == 4:
        d02, d13 = norm(sub(pts[0], pts[2])), norm(sub(pts[1], pts[3]))
        if d02 <= d13 + 1e-12:
            return [[f[0], f[1], f[2]], [f[0], f[2], f[3]]]
        return [[f[1], f[2], f[3]], [f[1], f[3], f[0]]]
    n = mesh.normal(fi)
    e1 = unit(sub(pts[1], pts[0]))
    e2 = cross(n, e1)
    flat = [(dot(sub(p, pts[0]), e1), dot(sub(p, pts[0]), e2)) for p in pts]
    return [[f[i] for i in tri] for tri in ear_clip(flat)]


def ear_clip(poly: Sequence[tuple[float, float]]) -> list[tuple[int, int, int]]:
    """Triangulate a simple counter-clockwise 2-D polygon (indices); deterministic ear order."""
    idx = list(range(len(poly)))
    tris: list[tuple[int, int, int]] = []

    def cross2(o, a, b) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    guard = 0
    while len(idx) > 3:
        guard += 1
        if guard > 10 * len(poly) ** 2:
            raise MeshError("ear clipping failed (the polygon is not simple)")
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = poly[i0], poly[i1], poly[i2]
            if cross2(a, b, c) <= 1e-12:
                continue
            if any(cross2(a, b, poly[j]) >= -1e-12 and cross2(b, c, poly[j]) >= -1e-12
                   and cross2(c, a, poly[j]) >= -1e-12
                   for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append((i0, i1, i2))
            idx.pop(k)
            break
        else:
            raise MeshError("ear clipping found no ear (the polygon is not simple)")
    tris.append((idx[0], idx[1], idx[2]))
    return tris


# ── primitives (all Y up, centred on the origin unless said otherwise) ───────


def box(w: float = 1.0, h: float = 1.0, d: float = 1.0) -> Mesh:
    """A rectangular box w (x) × h (y) × d (z), centred on the origin."""
    x, y, z = w / 2.0, h / 2.0, d / 2.0
    v = [(-x, -y, -z), (x, -y, -z), (x, -y, z), (-x, -y, z),
         (-x, y, -z), (x, y, -z), (x, y, z), (-x, y, z)]
    f = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
    return Mesh(v, f).check()


def icosahedron(radius: float = 1.0) -> Mesh:
    t = (1.0 + math.sqrt(5.0)) / 2.0
    raw = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t),
           (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    v = [scale(unit(p), radius) for p in raw]
    f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
         [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
         [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    return Mesh(v, f).check()


def icosphere(subdivisions: int = 1, radius: float = 1.0) -> Mesh:
    """Geodesic sphere: an icosahedron with each triangle split in four `subdivisions` times,
    new vertices pushed onto the sphere (20 · 4ⁿ triangles)."""
    if not 0 <= subdivisions <= 3:
        raise MeshError("icosphere subdivisions must be 0–3 (20 to 1280 faces)")
    m = icosahedron(radius)
    verts, faces = list(m.vertices), m.faces
    for _ in range(subdivisions):
        mid: dict[tuple[int, int], int] = {}
        nf = []
        for a, b, c in faces:
            ab, bc, ca = (_midpoint(verts, mid, x, y, radius) for x, y in ((a, b), (b, c), (c, a)))
            nf += [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
        faces = nf
    return Mesh(verts, faces).check()


def _midpoint(verts: list[Vec3], mid: dict, a: int, b: int, radius: float) -> int:
    key = (min(a, b), max(a, b))
    if key not in mid:
        verts.append(scale(unit(scale(add(verts[a], verts[b]), 0.5)), radius))
        mid[key] = len(verts) - 1
    return mid[key]


def lathe(profile: Sequence[tuple[float, float]], segments: int = 8, *, cap_bottom: bool = True,
          cap_top: bool = True, closed: bool = False, phase_deg: float = 0.0) -> Mesh:
    """Surface of revolution about the Y axis. `profile` is [(radius, y), …] from bottom to top
    (radius ≥ 0; a radius of 0 is a pole). `closed=True` treats the profile as a loop (a
    torus-like ring, listed counter-clockwise in the (r, y) half-plane). End caps close an open
    profile whose end radius is not 0. Quads between rings are planar trapezoids."""
    if segments < 3:
        raise MeshError("a lathe needs at least 3 segments")
    prof = [(float(r), float(y)) for r, y in profile]
    if len(prof) < 2 or any(r < 0 for r, _ in prof):
        raise MeshError("a lathe profile needs ≥ 2 points with radius ≥ 0")
    if closed and any(r <= 0 for r, _ in prof):
        raise MeshError("a closed lathe profile must stay off the axis (radius > 0)")
    verts: list[Vec3] = []
    rings: list[list[int]] = []
    for r, y in prof:
        if r <= 1e-12:
            verts.append((0.0, y, 0.0))
            rings.append([len(verts) - 1] * segments)
            continue
        ring = []
        for s in range(segments):
            a = math.radians(phase_deg) + 2 * math.pi * s / segments
            verts.append((r * math.cos(a), y, -r * math.sin(a)))
            ring.append(len(verts) - 1)
        rings.append(ring)
    faces: list[list[int]] = []
    n = len(rings) if closed else len(rings) - 1
    for i in range(n):
        lo, hi = rings[i], rings[(i + 1) % len(rings)]
        for s in range(segments):
            t = (s + 1) % segments
            quad = [lo[s], lo[t], hi[t], hi[s]]
            ring_face = [q for k, q in enumerate(quad) if q != quad[k - 1]]
            if len(ring_face) >= 3:
                faces.append(ring_face)
    if not closed:
        if cap_bottom and prof[0][0] > 1e-12:
            faces.append(list(reversed(rings[0])))
        if cap_top and prof[-1][0] > 1e-12:
            faces.append(list(rings[-1]))
    return Mesh(verts, faces).check()


def uv_sphere(segments: int = 8, rings: int = 4, radius: float = 1.0) -> Mesh:
    """Latitude–longitude sphere (poles, `rings` bands, quads between rings)."""
    prof = [(radius * math.sin(math.pi * k / rings), -radius * math.cos(math.pi * k / rings))
            for k in range(rings + 1)]
    prof[0], prof[-1] = (0.0, -radius), (0.0, radius)
    return lathe(prof, segments)


def torus(major: float = 1.0, minor: float = 0.35, segments: int = 12, sides: int = 6) -> Mesh:
    """A ring torus about the Y axis: `segments` around the ring, `sides` around the tube."""
    if not 0 < minor < major:
        raise MeshError("a torus needs 0 < minor < major")
    prof = [(major + minor * math.cos(2 * math.pi * k / sides + math.pi / sides),
             minor * math.sin(2 * math.pi * k / sides + math.pi / sides)) for k in range(sides)]
    return lathe(prof, segments, closed=True)


def prism(polygon: Sequence[tuple[float, float]], depth: float) -> Mesh:
    """A 2-D polygon in the XY plane (a side profile, counter-clockwise, simple) extruded along
    Z from −depth/2 to +depth/2. The two profile faces may be non-convex."""
    poly = [(float(x), float(y)) for x, y in polygon]
    area = math.fsum(poly[i][0] * poly[(i + 1) % len(poly)][1]
                     - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    if area < 0:
        poly.reverse()
    n = len(poly)
    z = depth / 2.0
    verts = [(x, y, z) for x, y in poly] + [(x, y, -z) for x, y in poly]
    faces = [list(range(n)), [n + i for i in reversed(range(n))]]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, n + i, n + j, j])
    return Mesh(verts, faces).check()


def extrude(mesh: Mesh, face: int, distance: float, shrink: float = 1.0) -> Mesh:
    """Extrude one face along its normal by `distance`, scaling its far copy about its centroid
    by `shrink` (0 makes a pyramid with one apex). The side walls are planar trapezoids (or
    triangles); the result stays a consistently oriented manifold."""
    if not 0 <= shrink <= 4:
        raise MeshError("extrude shrink must be in [0, 4]")
    f = mesh.faces[face]
    n, c = mesh.normal(face), mesh.centroid(face)
    tip = add(c, scale(n, distance))
    verts = list(mesh.vertices)
    faces = [list(g) for k, g in enumerate(mesh.faces) if k != face]
    if shrink <= 1e-12:
        verts.append(tip)
        apex = len(verts) - 1
        for k in range(len(f)):
            faces.append([f[k], f[(k + 1) % len(f)], apex])
        return Mesh(verts, faces).check()
    top = []
    for i in f:
        verts.append(add(tip, scale(sub(mesh.vertices[i], c), shrink)))
        top.append(len(verts) - 1)
    for k in range(len(f)):
        k2 = (k + 1) % len(f)
        faces.append([f[k], f[k2], top[k2], top[k]])
    faces.append(top)
    return Mesh(verts, faces).check()
