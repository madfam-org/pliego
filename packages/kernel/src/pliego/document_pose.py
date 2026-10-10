"""Document helpers split out of `document_build` (file-size gate).

`initial_rest_angles`: a crease already folded in the `initial` frame (a pop-up standing at its
default spread, a rolled tube, a pre-folded flap) is a set crease, so its plastic rest angle at
t = 0 (`pliego:edges_restAngle`, spec §3) is the dihedral it has in that frame — otherwise the
engine would treat the pose as elastic and spring it back toward flat at the first step.
"""

from __future__ import annotations

import math

Vec3 = tuple[float, float, float]
FOLDABLE = ("M", "V", "F", "U")


def _sub(a, b) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _unit(a) -> Vec3:
    n = math.sqrt(_dot(a, a)) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def _newell(pts: list) -> Vec3:
    n = [0.0, 0.0, 0.0]
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        n[0] += (p[1] - q[1]) * (p[2] + q[2])
        n[1] += (p[2] - q[2]) * (p[0] + q[0])
        n[2] += (p[0] - q[0]) * (p[1] + q[1])
    return _unit(n)


def dihedral(frame: list, fv: list[list[int]], f: int, g: int, a: int, b: int) -> float:
    """Signed fold angle (deg, valley > 0) across edge a→b, with face `f` on its left in the
    layout and `g` on its right, measured in a 3-D frame (the `pliego.kinematics` convention:
    a valley lifts `g` toward the front of `f`)."""
    nf = _newell([frame[v] for v in fv[f]])
    ng = _newell([frame[v] for v in fv[g]])
    axis = _unit(_sub(frame[a], frame[b]))
    return math.degrees(math.atan2(_dot(_cross(nf, ng), axis), _dot(nf, ng)))


def initial_rest_angles(fv: list[list[int]], ev: list[list[int]], ea: list[str],
                        ef: list[float], er: list[float], frame: list) -> list[float]:
    """`er` with every foldable edge that has no authored rest angle (0) set to its dihedral in
    `frame` (the `initial` frame's vertex coordinates). A crease folded flat (±180) takes its
    design sign; dihedrals under 1e-6° stay 0."""
    left: dict[tuple[int, int], int] = {}
    for fi, f in enumerate(fv):
        for k, v in enumerate(f):
            left[(v, f[(k + 1) % len(f)])] = fi
    out = list(er)
    for e, ((a, b), asg) in enumerate(zip(ev, ea, strict=True)):
        if asg not in FOLDABLE or out[e] != 0.0:
            continue
        f, g = left.get((a, b)), left.get((b, a))
        if f is None or g is None:
            continue
        th = dihedral(frame, fv, f, g, a, b)
        if abs(th) < 1e-6:
            continue
        if abs(abs(th) - 180.0) < 1e-3 and ef[e]:
            th = math.copysign(180.0, ef[e])
        out[e] = th
    return out


def resolve_face_orders(spec: dict, sheets: list, arrs: list, face_base: list[int]
                        ) -> list[list[int]]:
    """FOLD ``faceOrders`` ([f, g, s], global face indices) from `Assembly.face_orders`: sheet
    (or sheet id) → a `pliego.foldprogram.Built` (its complete flat-state layer order) or a list
    of sheet-local [f, g, s] triples. A `Built` must describe the very faces the sheet builds
    (same face rings), so later edits to the sheet cannot misplace the order (fail loud)."""
    ids = {s.id: i for i, s in enumerate(sheets)}
    out: list[list[int]] = []
    for key, value in spec.items():
        sid = key if isinstance(key, str) else getattr(key, "id", None)
        if sid not in ids:
            raise ValueError(f"face_orders: sheet {sid!r} is not in this assembly")
        si = ids[sid]
        arr = arrs[si]
        triples = value
        if hasattr(value, "face_orders") and hasattr(value, "arr"):
            src = value.arr
            if (len(src.faces) != len(arr.faces)
                    or any([src.grid[v] for v in f] != [arr.grid[v] for v in g]
                           for f, g in zip(src.faces, arr.faces, strict=True))):
                raise ValueError(f"face_orders: the fold program's faces do not match sheet "
                                 f"{sid!r} (was the sheet changed after build()?)")
            triples = value.face_orders()
        nf = len(arr.faces)
        for t in triples:
            f, g, sgn = (int(t[0]), int(t[1]), int(t[2]))
            if not (0 <= f < nf and 0 <= g < nf) or f == g or sgn not in (-1, 1):
                raise ValueError(f"face_orders: bad triple {list(t)!r} on sheet {sid!r}")
            out.append([f + face_base[si], g + face_base[si], sgn])
    return sorted(out)
