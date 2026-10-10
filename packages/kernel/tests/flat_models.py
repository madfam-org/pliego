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


def frog_base(s: float = 150.0):
    """Preliminary base → squash all four flaps (turning a page between the two on each side) →
    petal-fold all four faces: the lifted point is the bottom of each face's top layer (an edge
    midpoint of the square), and each kite line runs from it to the face's edges."""
    fp = preliminary(s)
    o, b, lft, rgt = corners(fp)
    for tag in ("f", "b"):
        fp.squash(f"squash-r-{tag}", "squash", (o, b), at=(rgt[0] - 12, rgt[1]), layers=1)
        fp.fold(f"page-{tag}", "page", (b, o), "valley", at=(o[0] - 4, o[1] - 30), layers=2)
        fp.squash(f"squash-l-{tag}", "squash", (o, b), at=(lft[0] + 12, lft[1]), layers=1)
        fp.turn_over()
    st = fp.state
    x0, y0, x1, y1 = st.bbox()
    o, b = st.vertex_near(((x0 + x1) / 2, y1)), st.vertex_near(((x0 + x1) / 2, y0))
    t = st.vertex_near((o[0], (o[1] + b[1]) / 2 - (o[1] - b[1]) * 0.21), 1.0)
    r2 = 1 / math.sqrt(2)
    kl = meet(t, (-r2, r2), o, (x0 - o[0], t[1] - o[1]))
    kr = meet(t, (r2, r2), o, (x1 - o[0], t[1] - o[1]))
    seed = (o[0] + 3, (kl[1] + t[1]) / 2)
    fp.petal("petal-1", "petal", (kl, kr), t, at=seed)
    fp.turn_over()
    fp.petal("petal-2", "petal", (kl, kr), t, at=seed)
    fp.fold("page-3", "page", (o, b), "valley", at=(o[0] + 6, t[1] + 10), layers=3)
    fp.petal("petal-3", "petal", (kl, kr), t, at=seed)
    fp.fold("page-4", "page", (o, b), "valley", at=(o[0] - 6, t[1] + 10), layers=7)
    fp.petal("petal-4", "petal", (kl, kr), t, at=seed)
    return fp, (o, b, kl, kr, t)


def canard_plane(trim: float = 10.0, dihedral: float = 6.0, W: float = 210.0, H: float = 297.0):
    """The canard paper airplane (an original MADFAM design in the commons, folded by traditional
    dart-family moves): fold in half and open, roll the nose once, fold in half, cut a slit through
    both layers between the foreplane and the main wing, cut two short slits into each trailing
    edge (the elevator tabs) and crease the tab hinges, fold the wings and then the foreplanes
    down, then open the plane in 3-D: fuselage spread, wings to their dihedral, tabs trimmed."""
    c = W / 2.0
    k = 0.10 * W
    depth = 0.06 * H
    top = H - depth
    fp = FoldProgram([(0, 0), (W, 0), (W, H), (0, H)])
    fp.fold("fold-in-half", "fold in half", ((c, -10.0), (c, H + 10.0)), "valley")
    fp.unfold_last("unfold")
    fp.fold("nose", "nose", ((-10.0, top), (W + 10.0, top)), "valley")
    fp.fold("fold-half", "fold half", ((c, -10.0), (c, H + 10.0)), "valley")
    y_slit, kc = 0.62 * top, k + 0.42 * (c - k)
    fp.cut("slit", "slit", ((W + 10.0, y_slit), (c + k, y_slit)))
    x2 = W - 6.0
    x1, e = max(c + k + 4.0, x2 - 0.22 * (c - k)), 0.05 * H
    xm = (x1 + x2) / 2.0
    fp.cut("elevator-slit-1", "elevator slits", ((x1, -10.0), (x1, e)))
    fp.cut("elevator-slit-2", "elevator slits", ((x2, -10.0), (x2, e)))
    fp.crease("tab-hinges", "tab hinges", ((x2 + 5.0, e), (x1 - 5.0, e)), "valley",
              sheet_points=[(xm, e / 2.0), (2 * c - xm, e / 2.0)])
    seed_r = (c + k + 3.0, 1.5)
    wing = ((c + k, H + 10.0), (c + k, -10.0))
    fp.fold("wing-r", "wings", wing, "mountain", sheet_points=[seed_r])
    fp.fold("wing-l", "wings", wing, "valley", sheet_points=[(2 * c - seed_r[0], seed_r[1])])
    cs = (W - 2.0, (y_slit + top) / 2.0)
    fore = ((c + kc, H + 10.0), (c + kc, -10.0))
    fp.fold("fore-r", "foreplanes", fore, "mountain", sheet_points=[cs])
    fp.fold("fore-l", "foreplanes", fore, "valley", sheet_points=[(2 * c - cs[0], cs[1])])
    # 3-D: the top half (the sheet's left half) lifts about the keel, then each wing and
    # foreplane opens to its dihedral, then the tabs turn by the trim
    spread = 16.0
    keel = ((c, -10.0), (c, H + 10.0))
    fp.hinge("open-fuselage", "open", keel, spread, at=(c + k / 2, H / 3), layers=1)
    wing_fold = 90.0 - spread / 2.0 - dihedral
    out = 180.0 - wing_fold
    low = (c + k - (W - c - k) / 2, y_slit / 2)
    fore_at = (c + kc - (W - c - kc) / 2, (y_slit + top) / 2)
    fp.hinges("open-wings", "dihedral", [
        {"line": wing, "turn": -out, "at": low, "layers": 1},
        {"line": wing, "turn": out, "at": low, "layers": 1, "from_": "bottom"},
        {"line": fore, "turn": -out, "at": fore_at, "layers": 1},
        {"line": fore, "turn": out, "at": fore_at, "layers": 1, "from_": "bottom"}])
    tab = ((x1 - 5.0, e), (x2 + 5.0, e))
    tab_at = (2 * (c + k) - xm, e / 2.0)
    fp.hinges("trim", "trim", [
        {"line": tab, "turn": trim, "at": tab_at, "layers": 1},
        {"line": tab, "turn": -trim, "at": tab_at, "layers": 1, "from_": "bottom"}])
    return fp, {"c": c, "k": k, "y_slit": y_slit, "x1": x1, "x2": x2, "e": e, "kc": kc}


def waterbomb_base(s: float = 150.0) -> FoldProgram:
    """Crease both diagonals (valley) and the horizontal midline (mountain), then collapse the
    degree-6 vertex at the centre at once: sides in, top down behind — the waterbomb base,
    point up, standing on the square's bottom edge."""
    h = s / 2
    fp = FoldProgram([(0, 0), (s, 0), (s, s), (0, s)])
    fp.crease_and_unfold("diagonal-1", "diagonal", ((0, s), (s, 0)), "valley")
    fp.crease_and_unfold("diagonal-2", "diagonal", ((0, 0), (s, s)), "valley", at=(1, s - 6))
    fp.crease_and_unfold("midline", "midline", ((-1, h), (s + 1, h)), "mountain")
    fp.collapse("collapse", "collapse", (h, h), {0: "mountain", 180: "mountain", 45: "valley",
                                                  135: "valley", 225: "valley", 315: "valley"})
    return fp


def preliminary_by_collapse(s: float = 150.0) -> FoldProgram:
    """The preliminary base as one collapse of a square creased along both diagonals and both
    midlines: midlines valley, the diagonal through the open corners mountain, the other diagonal
    left flat inside (Maekawa: 4 − 2 = 2)."""
    h = s / 2
    fp = FoldProgram([(0, 0), (s, 0), (s, s), (0, s)])
    fp.crease_and_unfold("diagonal-1", "diagonal", ((0, s), (s, 0)), "valley")
    fp.crease_and_unfold("diagonal-2", "diagonal", ((0, 0), (s, s)), "valley", at=(1, s - 6))
    fp.crease_and_unfold("midline-1", "midline", ((-1, h), (s + 1, h)), "valley")
    fp.crease_and_unfold("midline-2", "midline", ((h, -1), (h, s + 1)), "valley", at=(1, 1))
    fp.collapse("collapse", "collapse", (h, h), {0: "valley", 90: "valley", 180: "valley",
                                                  270: "valley", 45: "mountain",
                                                  225: "mountain", 135: "flat", 315: "flat"})
    return fp


def jumping_frog(card=(76.2, 127.0), spring: float = 35.0):
    """The traditional index-card frog: an X and a horizontal crease at the top, the head
    collapsed as one degree-6 vertex (a waterbomb half-base), the front legs up, the long sides
    to the middle, the bottom up and back down in half (the spring pleat); then the pleat opens
    in 3-D so the frog sits on its spring, and is pressed."""
    w, hgt = card
    o = (w / 2.0, hgt - w / 2.0)
    yb = hgt - w
    fp = FoldProgram([(0, 0), (w, 0), (w, hgt), (0, hgt)])
    fp.crease_and_unfold("corner-right", "corner", ((0.0, hgt), (w, yb)), "valley")
    fp.crease_and_unfold("corner-left", "corner", ((0.0, yb), (w, hgt)), "valley",
                         at=(1.0, hgt - 6.0))
    fp.crease_and_unfold("fold-back", "fold back", ((-10.0, o[1]), (w + 10.0, o[1])), "mountain")
    fp.collapse("head", "head", o, {0: "mountain", 180: "mountain", 45: "valley", 135: "valley",
                                    225: "valley", 315: "valley"})
    m = (w / 4.0, yb + w / 4.0)
    fp.fold("front-leg-l", "front legs", ((m[0] + 40.0, m[1] - 40.0), (m[0] - 40.0, m[1] + 40.0)),
            "valley", sheet_points=[(6.0, hgt - 2.0)])
    m = (3.0 * w / 4.0, yb + w / 4.0)
    fp.fold("front-leg-r", "front legs", ((m[0] + 40.0, m[1] + 40.0), (m[0] - 40.0, m[1] - 40.0)),
            "valley", sheet_points=[(w - 6.0, hgt - 2.0)])
    fp.fold("side-l", "sides", ((w / 4.0, -10.0), (w / 4.0, hgt + 10.0)), "valley",
            sheet_points=[(2.0, 2.0)])
    fp.fold("side-r", "sides", ((3.0 * w / 4.0, hgt + 10.0), (3.0 * w / 4.0, -10.0)), "valley",
            sheet_points=[(w - 2.0, 2.0)])
    fp.fold("bottom-up", "bottom up", ((w + 10.0, yb / 2.0), (-10.0, yb / 2.0)), "valley",
            sheet_points=[(w / 2.0, 1.0)])
    fp.fold("pleat", "pleat", ((-10.0, 3.0 * yb / 4.0), (w + 10.0, 3.0 * yb / 4.0)), "valley",
            sheet_points=[(w / 2.0, 1.0)])
    return fp, {"o": o, "yb": yb}


def fortune_teller(s: float = 200.0):
    """Two blintzes (the second turned over), four creases through every layer, then the toy's
    degree-8 vertex in 3-D: shaped so the four points meet, opened one way, closed, opened the
    other way — rigid vertex poses along the projected chord between those key poses."""
    from pliego.motion import vertex_folds

    h, q, big = s / 2.0, s / 4.0, 3.0 * s / 4.0
    fp = FoldProgram([(0, 0), (s, 0), (s, s), (0, s)])
    for k, (p0, p1) in enumerate((((h, 0.0), (0.0, h)), ((s, h), (h, 0.0)), ((h, s), (s, h)),
                                  ((0.0, h), (h, s)))):
        fp.fold(f"blintz-{k}", "blintz", (p0, p1), "valley")
    for k, (p0, p1) in enumerate((((big, q), (q, q)), ((big, big), (big, q)),
                                  ((q, big), (big, big)), ((q, q), (q, big)))):
        fp.fold(f"blintz-again-{k}", "blintz again", (p0, p1), "mountain")
    for sid, p0, p1 in (("mid-ns", (h, -1.0), (h, s + 1.0)), ("mid-ew", (s + 1.0, h), (-1.0, h)),
                        ("diag-1", (s, 0.0), (0.0, s)), ("diag-2", (0.0, 0.0), (s, s))):
        fp.crease_and_unfold(sid, sid, (p0, p1), "valley")
    up = (0.0, -1.0, 0.0)

    def ray(az, polar):
        a, p = math.radians(az), math.radians(polar)
        return (math.sin(p) * math.cos(a), math.cos(p) * up[1], -math.sin(p) * math.sin(a))

    def shaped(alpha):
        sa, ca, c45 = math.sqrt(0.5) * math.sin(math.radians(alpha)), \
            math.cos(math.radians(alpha)), math.sqrt(0.5)
        beta = math.degrees(math.atan2(sa, ca) + math.acos(min(1.0, c45 / math.hypot(sa, ca))))
        return {az: ray(az, alpha if az % 90 else beta) for az in range(0, 360, 45)}

    def opened(tau):
        t, c45 = math.radians(tau), math.sqrt(0.5)
        be = math.degrees(math.acos(c45 / math.cos(t)))
        r = {0: ray(0.0, be), 90: ray(90.0, tau + 45.0), 180: ray(180.0, be),
             270: ray(270.0, tau + 45.0)}
        for az in (45, 135, 225, 315):
            north = 1.0 if az < 180 else -1.0
            r[az] = (0.0, math.cos(t) * up[1], -north * math.sin(t))
        return r

    st = fp.state
    from pliego.flatvertex import star
    stv = star(st, (h, h))
    order = [round(math.degrees(math.atan2(d[1], d[0]))) % 360 for d in stv.dirs]
    prev = [None]

    def angles_of(rays):
        out = vertex_folds([rays[az] for az in order], prev[0])
        prev[0] = out
        return {az: a for az, a in zip(order, out, strict=True)}
    angles_of(shaped(1.0))              # the signs the toy approaches its closed pose with
    fp.vertex_pose("shape", "shape", (h, h), angles_of(shaped(0.0)), substeps=6)
    fp.vertex_pose("open-ns", "open", (h, h), angles_of(opened(24.0)), substeps=3)
    fp.vertex_pose("close-ns", "close", (h, h), angles_of(shaped(0.0)), substeps=3)
    return fp


def newspaper_hat(w: float = 380.0, h: float = 580.0) -> FoldProgram:
    """The traditional newspaper hat (as in the commons' paper-hat): fold the sheet in half top
    down, crease the centre line, fold the two top corners down to it, fold each brim strip up
    twice (the front one up, the back one up behind)."""
    hc, w2 = h / 2.0, w / 2.0
    b = hc - w2
    fp = FoldProgram([(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)])
    fp.fold("fold-down", "fold down", ((-1.0, hc), (w + 1.0, hc)), "valley")
    fp.crease_and_unfold("crease", "crease", ((w2, -1.0), (w2, hc + 1.0)), "valley")
    fp.fold("corners", "corners", ((-10.0, b - 10.0), (w2 + 10.0, hc + 10.0)), "valley")
    fp.fold("corners-2", "corners", ((w2 - 10.0, hc + 10.0), (w + 10.0, b - 10.0)), "valley")
    for kind, seed, side in (("valley", (w2 + 7.0, h - 2.0), "front"),
                             ("mountain", (w2 + 7.0, 2.0), "back")):
        fp.fold(f"brim-{side}", "brim", ((w + 1.0, b / 2.0), (-1.0, b / 2.0)), kind,
                sheet_points=[seed])
        fp.fold(f"brim-{side}-2", "brim", ((w + 1.0, b), (-1.0, b)), kind, sheet_points=[seed])
    return fp
