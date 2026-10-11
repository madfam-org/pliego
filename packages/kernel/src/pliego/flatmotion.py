"""Step motions between flat-folded states (`pliego.flatmotion`): rigid face groups in 3-D.

Every operation of `pliego.flatops` moves its faces as rigid groups from one flat state to the
next. This module gives each operation's motion as a function t ∈ [0, 1] ↦ {face: world rigid
motion}, applied on top of the face's placement in the state before the step (world frame of the
spec: folded (x, y) ↦ (x, 0, −y), +Y towards the viewer):

- a simple fold turns one group about the fold line by ±180° — exact for any number of layers;
- a squash lifts the flap upright about its hinge, then squashes it mirror-symmetrically: four
  rigid groups meeting at the flap's corner, each state built from ray directions on the unit
  sphere (spherical-linkage construction, every sector angle kept exact);
- a petal fold turns the petal about its hinge while each side follows the spherical four-bar
  at the hinge's end (petal, side, inner layer, body);
- a reverse fold turns the flap's front and back halves about the fold line in opposite senses.
  A rigid flap whose two halves stay attached at the root cannot do this — the two rigid modes of
  the reverse-fold vertex meet only at the open, flat flap — so the halves part along the spine
  in between: an approximation whose gap `pliego.foldprogram` measures and reports.

Rigid motions are ((3×3 rows), translation) as in `pliego.kinematics`.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

from .space import (
    IDENTITY3,
    Mat3,
    Vec3,
    add,
    axis_rotation,
    cross,
    dot,
    mat_vec,
    sub,
    unit,
)

Rigid = tuple[Mat3, Vec3]
ID_RIGID: Rigid = (IDENTITY3, (0.0, 0.0, 0.0))
UP: Vec3 = (0.0, 1.0, 0.0)
Motion = Callable[[float], dict[int, Rigid]]


def mat_mul3(a: Mat3, b: Mat3) -> Mat3:
    """`space.mat_mul` without its generators, bit for bit (each entry is still the builtin
    `sum` of the same three products, in the same order): the fold programs' hot path."""
    (a00, a01, a02), (a10, a11, a12), (a20, a21, a22) = a
    (b00, b01, b02), (b10, b11, b12), (b20, b21, b22) = b
    return ((sum((a00 * b00, a01 * b10, a02 * b20)), sum((a00 * b01, a01 * b11, a02 * b21)),
             sum((a00 * b02, a01 * b12, a02 * b22))),
            (sum((a10 * b00, a11 * b10, a12 * b20)), sum((a10 * b01, a11 * b11, a12 * b21)),
             sum((a10 * b02, a11 * b12, a12 * b22))),
            (sum((a20 * b00, a21 * b10, a22 * b20)), sum((a20 * b01, a21 * b11, a22 * b21)),
             sum((a20 * b02, a21 * b12, a22 * b22))))


def compose(a: Rigid, b: Rigid) -> Rigid:
    """a ∘ b."""
    return (mat_mul3(a[0], b[0]), add(mat_vec(a[0], b[1]), a[1]))


def apply(t: Rigid, p: Sequence[float]) -> Vec3:
    return add(mat_vec(t[0], p), t[1])


def invert(t: Rigid) -> Rigid:
    r = tuple(tuple(t[0][j][i] for j in range(3)) for i in range(3))
    q = mat_vec(r, t[1])  # type: ignore[arg-type]
    return (r, (-q[0], -q[1], -q[2]))  # type: ignore[return-value]


def about(origin: Vec3, r: Mat3) -> Rigid:
    q = mat_vec(r, origin)
    return (r, (origin[0] - q[0], origin[1] - q[1], origin[2] - q[2]))


def rot_line(origin: Vec3, direction: Vec3, rad: float) -> Rigid:
    """Right-handed rotation by `rad` about the line through origin along direction."""
    return about(origin, axis_rotation(direction, rad))


def frame_map(c0: Vec3, c1: Vec3, w0: Vec3, w1: Vec3, origin: Vec3) -> Rigid:
    """The rotation about `origin` taking rays (c0, c1) to rays (w0, w1) (equal angles)."""
    def fr(a: Vec3, b: Vec3) -> Mat3:
        e1 = unit(a)
        e3 = unit(cross(a, b))
        return (e1, cross(e3, e1), e3)
    cf, wf = fr(c0, c1), fr(w0, w1)
    r = tuple(tuple(sum(wf[k][i] * cf[k][j] for k in range(3)) for j in range(3))
              for i in range(3))
    return about(origin, r)  # type: ignore[arg-type]


def w3(p: Sequence[float]) -> Vec3:
    """Folded-frame point → world point."""
    return (float(p[0]), 0.0, -float(p[1]))


def wdir(d: Sequence[float]) -> Vec3:
    return (float(d[0]), 0.0, -float(d[1]))


def lift_sign(p: Sequence[float], d: Sequence[float], q: Sequence[float]) -> float:
    """The rotation sense about the world line (p, d) that lifts the folded point q towards +Y."""
    s = d[0] * (q[1] - p[1]) - d[1] * (q[0] - p[0])
    return 1.0 if s > 0 else -1.0


def simple(moving: Sequence[int], p, d, sense: float) -> Motion:
    """One rigid group turned by sense·180°·t about the fold line (sense +1 lifts the left side)."""
    o, ax = w3(p), wdir(d)
    mv = list(moving)

    def at(t: float) -> dict[int, Rigid]:
        g = rot_line(o, ax, sense * math.pi * t)
        return {f: g for f in mv}
    return at


def reverse(front: Sequence[int], back: Sequence[int], p, d, tip_left: bool, kind: str,
            spine, probe, driver: str = "front") -> Motion:
    """Reverse fold of a flap's tip: both halves end turned 180° about the fold line (inside:
    between the flap's halves; outside: around them). A rigid flap cannot get there with its root
    closed — the two rigid modes of the reverse-fold vertex meet only at the open, flat flap — so
    every rigid path parts the paper somewhere in between:

    - driver "front" / "back": that half turns about the fold line; the other stays hinged to it
      at the spine and swings once round it (360° relative), its short edge on the fold line
      leaving its base (at most about twice the flap's width there);
    - driver "mirror": both halves turn about the fold line in opposite senses; the spine parts;
    - driver "stack": both halves turn together the front half's way (rigid, nothing parts) and
      the back half flips to its side at the very end.

    `pliego.foldprogram` measures what the studio preview draws for each and keeps the least
    torn. `probe` is a folded point on the back half (it picks the swing that opens the flap)."""
    o, ax = w3(p), wdir(d)
    so, sa = w3(spine[0]), wdir(spine[1])
    up = 1.0 if tip_left else -1.0
    sf = -up if kind == "inside" else up
    sb = -sf
    fr, bk = list(front), list(back)
    q = w3(probe)

    def pose(t: float, sg: float) -> tuple[Rigid, Rigid]:
        if driver == "stack":
            g = rot_line(o, ax, sf * math.pi * t)
            return g, g
        if driver == "mirror":
            return rot_line(o, ax, sf * math.pi * t), rot_line(o, ax, sb * math.pi * t)
        if driver == "front":
            gf = rot_line(o, ax, sf * math.pi * t)
            return gf, compose(gf, rot_line(so, sa, sg * 2.0 * math.pi * t))
        gb = rot_line(o, ax, sb * math.pi * t)
        return compose(gb, rot_line(so, sa, sg * 2.0 * math.pi * t)), gb

    # the swing sense that keeps the back half under the front half (the flap opens first)
    sg = 1.0
    gf, gb = pose(0.05, 1.0)
    if apply(gb, q)[1] > apply(gf, q)[1]:
        sg = -1.0

    def at(t: float) -> dict[int, Rigid]:
        gf, gb = pose(t, sg)
        out = {f: gf for f in fr}
        out.update({f: gb for f in bk})
        return out
    return at


def squash(groups: dict[str, Sequence[int]], corner, u_h, u_s, lift: float = 0.25) -> Motion:
    """Squash: groups `a_h`, `a_s`, `b_s`, `b_h` (top half: hinge part, spine part; bottom half:
    spine part, hinge part) meeting at `corner`; hinge ray `u_h`, spine ray `u_s` (folded frame,
    unit, the flap on the left or right of u_h). t ∈ [0, lift]: the flap stands up about the
    hinge; then the spine slides down the symmetry plane onto the hinge ray."""
    o = w3(corner)
    uh = unit(wdir(u_h))
    gam = math.acos(max(-1.0, min(1.0, u_h[0] * u_s[0] + u_h[1] * u_s[1])))
    # in-plane unit normal to the hinge, towards the flap
    nf = (-u_h[1], u_h[0])
    if nf[0] * u_s[0] + nf[1] * u_s[1] < 0:
        nf = (u_h[1], -u_h[0])
    nn = wdir(nf)
    sense = 1.0 if dot(cross(uh, nn), UP) > 0 else -1.0
    ch, sh = math.cos(gam / 2.0), math.sin(gam / 2.0)
    b0 = add(tuple(ch * x for x in uh), tuple(sh * x for x in nn))
    s0 = add(tuple(math.cos(gam) * x for x in uh), tuple(math.sin(gam) * x for x in nn))

    def comb(*terms: tuple[float, Vec3]) -> Vec3:
        out = (0.0, 0.0, 0.0)
        for k, v in terms:
            out = add(out, (k * v[0], k * v[1], k * v[2]))
        return out

    def at(t: float) -> dict[int, Rigid]:
        if t <= lift:
            g = rot_line(o, uh, sense * (math.pi / 2.0) * (t / lift))
            return {f: g for k in ("a_h", "a_s", "b_s", "b_h") for f in groups[k]}
        phi = gam * (1.0 - (t - lift) / (1.0 - lift))
        sp = comb((math.cos(phi), uh), (math.sin(phi), UP))
        y = ch * math.tan(phi / 2.0)
        z = math.sqrt(max(0.0, 1.0 - ch * ch - y * y))
        ba = comb((ch, uh), (y, UP), (-z, nn))
        bb = comb((ch, uh), (y, UP), (z, nn))
        maps = {"a_h": frame_map(uh, b0, uh, ba, o), "a_s": frame_map(b0, s0, ba, sp, o),
                "b_s": frame_map(s0, b0, sp, bb, o), "b_h": frame_map(b0, uh, bb, uh, o)}
        return {f: maps[k] for k in maps for f in groups[k]}
    return at


def tracked(solve2: Callable[[float], tuple[Vec3, Vec3] | None], start: Vec3,
            n: int = 256) -> Callable[[float], Vec3]:
    """A continuous branch t ↦ ray of a two-solution construction (`solve2(t)` gives both
    solutions, or None where they coincide/degenerate), followed from `start` at t = 0."""
    table = [start]
    cur = start
    for k in range(1, n + 1):
        sol = solve2(k / n)
        if sol is not None:
            cur = max(sol, key=lambda r: dot(r, cur))
        table.append(cur)

    def at(t: float) -> Vec3:
        ref = table[min(n, max(0, round(t * n)))]
        sol = solve2(t)
        return ref if sol is None else max(sol, key=lambda r: dot(r, ref))
    return at


def sphere_pair(a: Vec3, b: Vec3, ca: float, cb: float) -> tuple[Vec3, Vec3] | None:
    """Both unit vectors at angular cosines (ca, cb) from unit vectors a and b (None when a and b
    coincide)."""
    c = dot(a, b)
    den = 1.0 - c * c
    if den < 1e-12:
        return None
    x = (ca - c * cb) / den
    y = (cb - c * ca) / den
    n = cross(a, b)
    z = math.sqrt(max(0.0, 1.0 - (x * x + y * y + 2.0 * x * y * c)) / dot(n, n))
    base = add(tuple(x * v for v in a), tuple(y * v for v in b))
    return (add(base, tuple(z * v for v in n)), add(base, tuple(-z * v for v in n)))


def sphere_point(a: Vec3, b: Vec3, ca: float, cb: float, prefer: Vec3) -> Vec3:
    """The unit vector at angular cosines (ca, cb) from unit vectors a and b, on the side of the
    plane (a, b) that `prefer` points to (the in-plane solution when the two coincide)."""
    c = dot(a, b)
    den = 1.0 - c * c
    if den < 1e-14:
        raise ValueError("coincident rays")
    x = (ca - c * cb) / den
    y = (cb - c * ca) / den
    n = cross(a, b)
    nn = dot(n, n)
    rest = 1.0 - (x * x + y * y + 2.0 * x * y * c)
    z = math.sqrt(max(0.0, rest) / nn)
    if dot(n, prefer) < 0:
        z = -z
    return add(add(tuple(x * v for v in a), tuple(y * v for v in b)), tuple(z * v for v in n))


def petal(petal_faces: Sequence[int], sides: Sequence[dict], k1, k2) -> Motion:
    """Petal fold: the petal turns about the hinge K1–K2 (lifting); each side `{"corner": K,
    "k": kite ray, "e": edge ray, "kin": inner kite ray, "side": faces, "inner": faces}` follows
    the spherical four-bar petal–side–inner–body at its hinge end (rays folded-frame, unit)."""
    o1, o2 = w3(k1), w3(k2)
    ax = unit(sub(o2, o1))
    pf = list(petal_faces)
    sense = 1.0 if dot(cross(ax, wdir(sides[0]["k"])), UP) > 0 else -1.0
    prepared = []
    for sd in sides:
        k0, e0, kin = unit(wdir(sd["k"])), unit(wdir(sd["e"])), unit(wdir(sd["kin"]))

        def pair(t: float, k0=k0, e0=e0, kin=kin):
            cke, cek = dot(k0, e0), dot(e0, kin)
            k = mat_vec(rot_line(o1, ax, sense * math.pi * t)[0], k0)
            sol = sphere_pair(k, kin, cke, cek)
            if sol is None or t <= 0.0:
                return None
            # leave the flat start on the side the petal lifts to
            return sol if t > 1.0 / 256 else (max(sol, key=lambda r: r[1]),) * 2
        prepared.append((w3(sd["corner"]), k0, e0, kin, tracked(pair, e0),
                         list(sd["side"]), list(sd["inner"])))

    def at(t: float) -> dict[int, Rigid]:
        th = math.pi * t
        g = rot_line(o1, ax, sense * th)
        out = {f: g for f in pf}
        for o, k0, e0, kin, eray, sf, inn in prepared:
            if t <= 0.0:
                continue
            k = mat_vec(g[0], k0)
            e = eray(t)
            ms = frame_map(k0, e0, k, e, o)
            mi = frame_map(e0, kin, e, kin, o)
            out.update({f: ms for f in sf})
            out.update({f: mi for f in inn})
        return out
    return at


def rabbit(x1: Sequence[int], x2: Sequence[int], x3: Sequence[int], inc, a, dpt, b, c) -> Motion:
    """Rabbit ear: the sector A–D turns about the bisector I–A (lifting); the ear D–B and the
    sector B–C follow the spherical four-bar at the incentre I (the sector C–A stays)."""
    o = w3(inc)

    def ray(p) -> Vec3:
        return unit(sub(w3(p), o))
    ra, rd0, rb0, rc = ray(a), ray(dpt), ray(b), ray(c)
    sense = 1.0 if dot(cross(ra, rd0), UP) > 0 else -1.0
    cdb, cbc = dot(rd0, rb0), dot(rb0, rc)

    def pair(t: float):
        rd = mat_vec(rot_line(o, ra, sense * math.pi * t)[0], rd0)
        sol = sphere_pair(rd, rc, cdb, cbc)
        if sol is None or t <= 0.0:
            return None
        return sol if t > 1.0 / 256 else (max(sol, key=lambda r: r[1]),) * 2
    bray = tracked(pair, rb0)

    def at(t: float) -> dict[int, Rigid]:
        g = rot_line(o, ra, sense * math.pi * t)
        rd = mat_vec(g[0], rd0)
        rb = bray(t) if t > 0.0 else rb0
        m2 = frame_map(rd0, rb0, rd, rb, o)
        m3 = frame_map(rb0, rc, rb, rc, o)
        out = {f: g for f in x1}
        out.update({f: m2 for f in x2})
        out.update({f: m3 for f in x3})
        return out
    return at
