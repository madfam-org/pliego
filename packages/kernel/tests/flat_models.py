"""Traditional sequences folded with `pliego.flatops` for the layer-engine tests.

Every point is computed from the current state (`FlatState.vertex_near` snaps to exact vertex
images), so the lines meet existing creases exactly. Coordinates: a square of side `s`, folded
frame y-up; the preliminary base is turned so the sheet's centre is its top point and the open
corners point down.
"""

from __future__ import annotations

import math

from pliego.foldprogram import FoldProgram


def meet(p, d, q, e):
    den = d[0] * e[1] - d[1] * e[0]
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
    return (p[0] + t * d[0], p[1] + t * d[1])


def reflect(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy)
    dx, dy = dx / ln, dy / ln
    t = (p[0] - a[0]) * dx + (p[1] - a[1]) * dy
    f = (a[0] + t * dx, a[1] + t * dy)
    return (2 * f[0] - p[0], 2 * f[1] - p[1])


def corners(fp):
    """Top, bottom, left and right points of a diamond-shaped state (exact vertices)."""
    x0, y0, x1, y1 = fp.state.bbox()
    near = fp.state.vertex_near
    return (near(((x0 + x1) / 2, y1)), near(((x0 + x1) / 2, y0)),
            near((x0, (y0 + y1) / 2)), near((x1, (y0 + y1) / 2)))


def preliminary(s: float = 150.0) -> FoldProgram:
    """Square → diagonal fold → fold in half → squash → turn over → squash: the preliminary
    base, open end down."""
    h = s / 2
    fp = FoldProgram([(0, 0), (s, 0), (s, s), (0, s)])
    fp.fold("diagonal", "diagonal", ((s, 0), (0, s)), "valley", at=(10, 10))
    fp.fold("half", "half", ((h, h), (s, s)), "valley", at=(s * 0.9, s * 0.6))
    fp.squash("squash-front", "squash", ((h, h), (s, s)), at=(h * 0.9, s * 0.85))
    fp.turn_over()
    fp.squash("squash-back", "squash", ((h, h), (0, s)), at=(h * 1.3, s * 0.93))
    fp.rotate(135.0, (h, h))
    return fp


def kite_points(fp):
    """Corners of the diamond and the kite points K: the lower edges folded to the centre line
    meet the upper edges there."""
    o, b, lft, rgt = corners(fp)
    lo = math.atan2(rgt[1] - b[1], rgt[0] - b[0])
    bis = (lo + math.pi / 2) / 2
    dr = (math.cos(bis), math.sin(bis))
    dl = (-dr[0], dr[1])
    kr = meet(b, dr, o, (rgt[0] - o[0], rgt[1] - o[1]))
    kl = meet(b, dl, o, (lft[0] - o[0], lft[1] - o[1]))
    return o, b, lft, rgt, kl, kr


def petal_side(fp, tag: str, pts, top: bool = True, layers: int = 2) -> None:
    """Kite folds through the front flap, the top folded down (optional), all opened, then the
    petal fold."""
    o, b, lft, rgt, kl, kr = pts
    fp.fold(f"kite-r-{tag}", "kite", (b, kr), "valley", at=(rgt[0] - 8, rgt[1]), layers=layers)
    fp.fold(f"kite-l-{tag}", "kite", (kl, b), "valley", at=(lft[0] + 8, lft[1]), layers=layers)
    if top:
        fp.fold(f"top-{tag}", "top", (kl, kr), "valley", at=(o[0] + 3, o[1] - 8), layers=1)
        fp.unfold_last(f"open-top-{tag}")
    for name, k, c in (("kl", kl, lft), ("kr", kr, rgt)):
        cr = reflect(c, b, k)
        seed = ((b[0] + k[0] + cr[0]) / 3, (b[1] + k[1] + cr[1]) / 3)
        line = (k, b) if name == "kl" else (b, k)
        fp.fold(f"open-{name}-{tag}", "open", line, "valley", at=seed, layers=layers)
    fp.petal(f"petal-{tag}", "petal", (kl, kr), b)


def bird_base(s: float = 150.0) -> tuple[FoldProgram, tuple]:
    fp = preliminary(s)
    pts = kite_points(fp)
    petal_side(fp, "f", pts)
    fp.turn_over()
    petal_side(fp, "b", pts, top=False)
    return fp, pts


def crane(s: float = 150.0, rise: float = 60.0, wings: str = "down"):
    """Bird base → narrow front and back → inside-reverse the neck and the tail → reverse the
    head → wings down (optionally spread as a 3-D hinge pose)."""
    fp, (o, b, lft, rgt, kl, kr) = bird_base(s)
    half, hw = (kl[0] + kr[0]) / 2, (kr[0] - kl[0]) / 2
    a = math.radians(90 - 11.25)

    def narrow(tag):
        fp.fold(f"narrow-r-{tag}", "narrow", (b, (b[0] + math.cos(a), b[1] + math.sin(a))),
                "valley", at=(half + 0.6 * hw, b[1] + 60), layers=1)
        fp.fold(f"narrow-l-{tag}", "narrow", ((b[0] - math.cos(a), b[1] + math.sin(a)), b),
                "valley", at=(half - 0.6 * hw, b[1] + 60), layers=1)
    narrow("f")
    fp.turn_over()
    narrow("b")
    hy = kl[1]
    y1 = b[1] + 0.62 * (hy - b[1])
    th = math.radians((90 - rise) / 2)
    p = (b[0], y1)
    w = lambda y: (y - b[1]) * math.tan(math.radians(11.25))  # noqa: E731 - leg half-width
    fp.reverse_fold("neck", "neck", (p, (p[0] + math.cos(th), p[1] + math.sin(th))),
                    at=(b[0] - 0.5 * w(b[1] + 20), b[1] + 20))
    fp.reverse_fold("tail", "tail", (p, (p[0] - math.cos(th), p[1] + math.sin(th))),
                    at=(b[0] + 0.5 * w(b[1] + 20), b[1] + 20))
    psi = math.radians(180 - rise)
    ln = y1 - b[1]
    u = (math.cos(psi), math.sin(psi))
    tip = (p[0] + ln * u[0], p[1] + ln * u[1])
    dh = 0.22 * ln
    hp = (tip[0] - dh * u[0], tip[1] - dh * u[1])
    nl = (-u[1], u[0])
    thh = psi + math.radians(55)
    seed = (tip[0] - 0.5 * dh * u[0] + 0.05 * dh * nl[0],
            tip[1] - 0.5 * dh * u[1] + 0.05 * dh * nl[1])
    fp.reverse_fold("head", "head", (hp, (hp[0] + math.cos(thh), hp[1] + math.sin(thh))),
                    at=seed)
    # the wings fold down where the narrowing creases meet the petals' kite edges
    top = (b[0], 2 * hy - b[1])
    y_pt = fp.state.vertex_near(meet(b, (math.cos(a), math.sin(a)), kr,
                                     (top[0] - kr[0], top[1] - kr[1])), 0.5)
    wing = ((2 * b[0] - y_pt[0], y_pt[1]), y_pt)
    seed = (b[0] + 3, (y_pt[1] + top[1]) / 2)
    fp.fold("wing-f", "wing", wing, "valley", at=seed, layers=1)
    fp.fold("wing-b", "wing", wing, "mountain", at=seed, layers=1)
    if wings == "spread":
        low = (b[0] + 3, y_pt[1] - 10)
        fp.hinge("spread-f", "spread", wing, -90, at=low, layers=1)
        fp.hinge("spread-b", "spread", wing, 90, at=low, layers=1, from_="bottom")
    return fp, (o, b, kl, kr, y_pt)
