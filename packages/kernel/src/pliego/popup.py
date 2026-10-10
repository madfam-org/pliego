"""Paper-engineering generators: V-fold, parallel (box) fold, floating layer, tent, step and the
90° origamic-architecture cut-fold — each an :class:`Assembly` on a base spread.

**Base spread.** Two kinematic boards (``page-left``, ``page-right``, sheet-local ``W × H``) with
the gutter along world −Z through the origin. A ``hinge`` mechanism ``spread`` (axis −Z, rest
180°) driven by the ``open`` angle control rotates the right page by ``open − 180``; the left page
references the same mechanism but is not in ``sheets_moving`` (the fixed side). In the
cross-section (world x, y) the pages run along ``eL = (−1, 0)`` and ``eR(φ) = (−cos φ, sin φ)``.

**Kinematics (Tier R, closed form, rsE E9/E10).** Parallel folds, tents and floating layers are
four-bar linkages G–A–F–B in the cross-section: A and B are the glue lines (distances p, q from
the support corner G), F is the piece fold, solved as a circle intersection on the far side of AB
from G; a missing intersection is a **lock** (the piece would tear). Equal opposite links
(``s1 = q``, ``s2 = p``) make a parallelogram, flat at 0° and 180°. The V-fold is a degree-4
vertex on the gutter: with glue lines at α from the gutter and piece half-angle β, the fold line
is ``f = (cos β / cos δ)·m + √(1 − cos²β / cos²δ)·n`` (δ = half the angle between the glue lines,
m their bisector, n the normal on the inner side); β < δ is a lock, β = α is flat at both extremes.

The initial frame is that kinematic pose at the default ``open`` value, so every glue weld holds
exactly. Cut-folds start flat (``open`` = 180°): a ``C`` edge shares its vertices in the sheet
document, so a frame cannot separate a slit's two sides (reported as a contract gap).
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field

from .assembly import Assembly, angle_control, glue, hinge
from .sheet import Sheet

V2 = tuple[float, float]
Vec3 = tuple[float, float, float]
Pose = dict[str, Callable[[float, float], Vec3]]

PAGE_STOCK, PIECE_STOCK, OA_STOCK = "cardstock-300", "cardstock-250", "cardstock-160"
GLUE_INSET_MM = 0.5
OPEN_LABEL = {"en": "Open", "es": "Abrir", "fr": "Ouvrir", "pt": "Abrir"}
PAGE_LABELS = {
    "page-left": {"en": "Left page", "es": "Página izquierda", "fr": "Page de gauche",
                  "pt": "Página esquerda"},
    "page-right": {"en": "Right page", "es": "Página derecha", "fr": "Page de droite",
                   "pt": "Página direita"},
}


def _add(a: V2, b: V2, k: float = 1.0) -> V2:
    return (a[0] + k * b[0], a[1] + k * b[1])


def _sub(a: V2, b: V2) -> V2:
    return (a[0] - b[0], a[1] - b[1])


def _unit(a: V2) -> V2:
    n = math.hypot(*a)
    return (a[0] / n, a[1] / n)


def _cross2(a: V2, b: V2) -> float:
    return a[0] * b[1] - a[1] * b[0]


def _angle(a: V2, b: V2) -> float:
    return math.degrees(math.atan2(abs(_cross2(a, b)), a[0] * b[0] + a[1] * b[1]))


def page_dirs(phi: float) -> tuple[V2, V2]:
    """Cross-section directions of the left and right pages at opening angle φ (degrees)."""
    r = math.radians(phi)
    return (-1.0, 0.0), (-math.cos(r), math.sin(r))


def _inner(e_l: V2, e_r: V2) -> V2:
    s = _add(e_l, e_r)
    if math.hypot(*s) > 1e-9:
        return _unit(s)
    return (-e_r[1], e_r[0])


# ── result type ──────────────────────────────────────────────────────────────


@dataclass
class PopUp:
    """A generated pop-up: its assembly, its kinematic pose function and closure checks."""

    name: str
    sheets: list[Sheet]
    joins: list[dict]
    pose: Callable[[float], Pose | None]
    default_open: float = 90.0
    width: float = 150.0
    height: float = 200.0
    meta: dict = field(default_factory=dict)

    def assembly(self) -> Assembly:
        pose = self.pose(self.default_open)
        if pose is None:
            raise ValueError(f"{self.name}: locked at the default opening {self.default_open}°")
        mech = hinge("spread", (0.0, 0.0, 0.0), (0.0, 0.0, -1.0), "open", ["page-right"],
                     rest=180.0)
        ctrl = angle_control("open", OPEN_LABEL, default=self.default_open)
        return Assembly(self.sheets, joins=self.joins, mechanisms=[mech], controls=[ctrl],
                        initial=lambda sid, uv: pose[sid](*uv), title=self.name,
                        meta={"cartridge": self.sheets[-1].id, "params": dict(self.meta)})

    def document(self, stocks: dict | None = None):
        return self.assembly().build(stocks=stocks)

    def closure(self, step: float = 1.0, tol: float = 1e-6) -> dict:
        """Closure report: flat at 0° and 180°, and the openings where the mechanism locks."""
        locked = []
        phi = 0.0
        while phi <= 180.0 + 1e-9:
            if self.pose(phi) is None:
                locked.append(round(phi, 6))
            phi += step
        flat = {}
        for extreme in (0.0, 180.0):
            pose = self.pose(extreme)
            if pose is None:
                flat[extreme] = False
                continue
            worst = 0.0
            for s in self.sheets:
                if s.kinematic is not None:
                    continue
                for v in s.build().vertices:
                    worst = max(worst, abs(pose[s.id](v.x, v.y)[1]))
            flat[extreme] = worst <= tol
        return {"flat_at_0": flat[0.0], "flat_at_180": flat[180.0], "locked_at": locked,
                "ok": flat[0.0] and flat[180.0] and not locked}


def _pages(width: float, height: float, stock: str) -> tuple[Sheet, Sheet]:
    from .sheet import Placement

    left = Sheet("page-left", [(0, 0), (width, 0), (width, height), (0, height)], stock=stock,
                 label=PAGE_LABELS["page-left"], kinematic="spread",
                 placement=Placement(origin=(-width, 0.0, 0.0)))
    right = Sheet("page-right", [(0, 0), (width, 0), (width, height), (0, height)],
                  stock=stock, label=PAGE_LABELS["page-right"], kinematic="spread")
    return left, right


def _page_pose(width: float, phi: float) -> Pose:
    _e_l, e_r = page_dirs(phi)
    return {
        "page-left": lambda u, v: (u - width, 0.0, -v),
        "page-right": lambda u, v: (u * e_r[0], u * e_r[1], -v),
    }


# ── four-bar pieces (parallel / box fold, tent, floating layer) ──────────────


@dataclass
class _Support:
    """A support corner G with a left and a right support surface (pages or piece panels)."""

    corner: Callable[[float], V2]
    left: tuple[str, float, float, float]    # (sheet id, local u at G, du per mm away, v offset)
    right: tuple[str, float, float, float]


@dataclass
class _Bar:
    sheet: Sheet
    support: _Support
    p: float
    q: float
    s1: float
    s2: float
    tab: float
    v0: float      # world gutter coordinate of local v = 0

    def solve(self, phi: float) -> tuple[V2, V2, V2, V2, V2] | None:
        e_l, e_r = page_dirs(phi)
        g = self.support.corner(phi)
        a, b = _add(g, e_l, self.p), _add(g, e_r, self.q)
        ab = _sub(b, a)
        d = math.hypot(*ab)
        if d < 1e-9:
            if abs(self.s1 - self.s2) > 1e-9:
                return None
            return a, _add(a, e_l, self.s1), b, e_l, e_r
        x = (d * d + self.s1 ** 2 - self.s2 ** 2) / (2 * d)
        h2 = self.s1 ** 2 - x * x
        if h2 < -1e-9 * max(1.0, self.s1 ** 2):
            return None
        h = math.sqrt(max(0.0, h2))
        u = _unit(ab)
        n = (-u[1], u[0])
        side = _cross2(ab, _sub(g, a))
        if abs(side) < 1e-12:
            side = -(n[0] * _inner(e_l, e_r)[0] + n[1] * _inner(e_l, e_r)[1])
        sign = -1.0 if side > 0 else 1.0          # opposite side of AB from G
        f = _add(_add(a, u, x), n, sign * h)
        return a, f, b, e_l, e_r

    def world(self, phi: float) -> Callable[[float, float], Vec3] | None:
        sol = self.solve(phi)
        if sol is None:
            return None
        a, f, b, e_l, e_r = sol
        t, s1, s2 = self.tab, self.s1, self.s2
        d_af, d_fb = _unit(_sub(f, a)), _unit(_sub(b, f))

        def at(u: float, v: float) -> Vec3:
            if u <= t:
                x = _add(a, e_l, t - u)
            elif u <= t + s1:
                x = _add(a, d_af, u - t)
            elif u <= t + s1 + s2:
                x = _add(f, d_fb, u - t - s1)
            else:
                x = _add(b, e_r, u - t - s1 - s2)
            return (x[0], x[1], -(self.v0 + v))
        return at

    def fold_angles(self, phi: float) -> tuple[float, float, float]:
        sol = self.solve(phi)
        if sol is None:
            raise ValueError("locked")
        a, f, b, e_l, e_r = sol
        return (180.0 - _angle(e_l, _sub(f, a)), 180.0 - _angle(_sub(a, f), _sub(b, f)),
                180.0 - _angle(e_r, _sub(f, b)))

    def joins(self, prefix: str, width: float) -> list[dict]:
        t, i = self.tab, GLUE_INSET_MM
        ub = t + self.s1 + self.s2
        out = []
        for side, (sid, u_g, du, voff), lo, hi, dist0 in (
            ("left", self.support.left, i, t - i, self.p + t),
            ("right", self.support.right, ub + i, ub + t - i, self.q - ub),
        ):
            region = [(lo, i), (hi, i), (hi, width - i), (lo, width - i)]
            if side == "left":   # distance from G = p + t − u  →  u_s = u_g + du·(p + t − u)
                m = (-du, 0.0, 0.0, 1.0, u_g + du * dist0, self.v0 - voff)
            else:                # distance from G = q + u − ub
                m = (du, 0.0, 0.0, 1.0, u_g + du * dist0, self.v0 - voff)
            out.append(glue(f"{prefix}-{side}", self.sheet, region, sid, m, "front"))
        return out


def _bar_sheet(sheet_id: str, label: dict, t: float, s1: float, s2: float, width: float,
               angles: tuple[float, float, float], stock: str) -> Sheet:
    total = 2 * t + s1 + s2
    s = Sheet(sheet_id, [(0, 0), (total, 0), (total, width), (0, width)], stock=stock,
              grain_deg=90.0, label=label)
    s.crease((t, 0), (t, width), "valley", angles[0], treatment="score")
    s.crease((t + s1, 0), (t + s1, width), "mountain", angles[1], treatment="score")
    s.crease((t + s1 + s2, 0), (t + s1 + s2, width), "valley", angles[2], treatment="score")
    return s


def _check(**values: float) -> None:
    for name, value in values.items():
        if not (isinstance(value, int | float) and math.isfinite(value) and value > 0):
            raise ValueError(f"{name} must be a positive number, got {value!r}")


def _spread_support(width: float) -> _Support:
    return _Support(lambda _phi: (0.0, 0.0), ("page-left", width, -1.0, 0.0),
                    ("page-right", 0.0, 1.0, 0.0))


def _four_bar(name: str, label: dict, sheet_id: str, p: float, q: float, s1: float, s2: float,
              piece_width: float, at: float, tab: float, width: float, height: float,
              default_open: float, meta: dict) -> PopUp:
    _check(p=p, q=q, s1=s1, s2=s2, piece_width=piece_width, tab=tab, width=width,
           height=height)
    if p + tab > width or q + tab > width or at < 0 or at + piece_width > height:
        raise ValueError(f"{name}: the piece does not fit the {width} × {height} mm page")
    left, right = _pages(width, height, PAGE_STOCK)
    probe = _Bar(None, _spread_support(width), p, q, s1, s2, tab, at)  # type: ignore[arg-type]
    if probe.solve(default_open) is None:
        raise ValueError(f"{name}: locked at the default opening {default_open}°")
    sheet = _bar_sheet(sheet_id, label, tab, s1, s2, piece_width,
                       probe.fold_angles(default_open), PIECE_STOCK)
    bar = _Bar(sheet, probe.support, p, q, s1, s2, tab, at)

    def pose(phi: float) -> Pose | None:
        at_fn = bar.world(phi)
        if at_fn is None:
            return None
        return {**_page_pose(width, phi), sheet_id: at_fn}

    return PopUp(name, [left, right, sheet], bar.joins(sheet_id, piece_width), pose,
                 default_open, width, height, meta)


def parallel_fold(p: float = 40.0, q: float = 50.0, piece_width: float = 60.0,
                  at: float = 70.0, tab: float = 12.0, width: float = 150.0,
                  height: float = 200.0, s1: float | None = None, s2: float | None = None,
                  default_open: float = 90.0) -> PopUp:
    """Parallel (box) fold: a strip glued at p on the left page and q on the right page; panel
    lengths default to the parallelogram (s1 = q, s2 = p), flat at 0° and 180°."""
    s1 = q if s1 is None else s1
    s2 = p if s2 is None else s2
    return _four_bar("Parallel fold", {"en": "Parallel-fold piece", "es": "Pieza de pliegue "
                     "paralelo", "fr": "Pièce à pli parallèle", "pt": "Peça de dobra paralela"},
                     "parallel-fold", p, q, s1, s2, piece_width, at, tab, width, height,
                     default_open, {"p": p, "q": q, "s1": s1, "s2": s2,
                                    "piece_width": piece_width, "at": at})


def tent(p: float = 35.0, s: float = 50.0, piece_width: float = 70.0, at: float = 60.0,
         tab: float = 12.0, width: float = 150.0, height: float = 200.0,
         default_open: float = 90.0) -> PopUp:
    """Tent: a strip glued at equal distances p on both pages with its fold (apex) between —
    a kite four-bar. It folds flat when closed and stands at 180° when s > p (by design: a
    180° mechanism, so ``closure()`` reports ``flat_at_180 = False``)."""
    return _four_bar("Tent", {"en": "Tent piece", "es": "Pieza en tienda", "fr": "Pièce en "
                     "tente", "pt": "Peça em tenda"}, "tent", p, p, s, s, piece_width, at, tab,
                     width, height, default_open, {"p": p, "s": s, "piece_width": piece_width,
                                                   "at": at})


def floating_layer(p: float = 50.0, q: float = 40.0, p2: float = 25.0, q2: float = 30.0,
                   piece_width: float = 70.0, layer_width: float = 50.0, at: float = 60.0,
                   tab: float = 10.0, width: float = 150.0, height: float = 200.0,
                   default_open: float = 90.0) -> PopUp:
    """Floating layer: a parallel fold (the support) plus a second parallel fold glued onto the
    support's front panel and the right page — it floats in front of the support at a level,
    driven by the same opening (nested parallelograms, flat at 0° and 180°)."""
    base = parallel_fold(p, q, piece_width, at, tab, width, height, default_open=default_open)
    sup_sheet = base.sheets[-1]
    if p2 + tab > p or q + q2 + tab > width:
        raise ValueError("floating layer: p2 + tab must fit the support panel (≤ p) and "
                         "q + q2 + tab the page")
    at2 = at + (piece_width - layer_width) / 2
    sup_bar = _Bar(sup_sheet, _spread_support(width), p, q, q, p, tab, at)
    u_b1 = tab + q + p
    support2 = _Support(lambda phi: _add((0.0, 0.0), page_dirs(phi)[1], q),
                        (sup_sheet.id, u_b1, -1.0, at), ("page-right", q, 1.0, 0.0))
    probe = _Bar(None, support2, p2, q2, q2, p2, tab, at2)  # type: ignore[arg-type]
    layer = _bar_sheet("floating-layer", {"en": "Floating layer", "es": "Capa flotante",
                                          "fr": "Couche flottante", "pt": "Camada flutuante"},
                       tab, q2, p2, layer_width, probe.fold_angles(default_open), PIECE_STOCK)
    bar2 = _Bar(layer, support2, p2, q2, q2, p2, tab, at2)

    def pose(phi: float) -> Pose | None:
        f1, f2 = sup_bar.world(phi), bar2.world(phi)
        if f1 is None or f2 is None:
            return None
        return {**_page_pose(width, phi), sup_sheet.id: f1, layer.id: f2}

    return PopUp("Floating layer", base.sheets + [layer],
                 base.joins + bar2.joins(layer.id, layer_width), pose, default_open, width,
                 height, {"p": p, "q": q, "p2": p2, "q2": q2, "at": at})


# ── V-fold ───────────────────────────────────────────────────────────────────


def v_fold(alpha: float = 40.0, beta: float | None = None, glue_len: float = 50.0,
           apex: float = 80.0, at: float = 40.0, tab: float = 10.0, width: float = 150.0,
           height: float = 200.0, default_open: float = 90.0) -> PopUp:
    """V-fold: a kite (fold line on the gutter) glued along lines at α from the gutter on each
    page; β is the piece half-angle (default α: flat at both extremes; β > α stands at 180°)."""
    beta = alpha if beta is None else beta
    _check(alpha=alpha, beta=beta, glue_len=glue_len, apex=apex, tab=tab)
    if not (alpha < 80 and beta < 80):
        raise ValueError("alpha and beta must be below 80°")
    rb, ra = math.radians(beta), math.radians(alpha)
    if apex <= glue_len * math.cos(rb) + 1.0:
        raise ValueError("apex must exceed glue_len·cos β (convex kite)")
    if at + max(apex, glue_len * math.cos(ra)) > height or glue_len * math.sin(ra) + tab > width:
        raise ValueError("V-fold does not fit the page")
    ox = glue_len * math.sin(rb) + tab + 1.0
    oy = tab + 1.0
    o = (ox, oy)
    d_l, d_r = (-math.sin(rb), math.cos(rb)), (math.sin(rb), math.cos(rb))
    n_l, n_r = (-math.cos(rb), -math.sin(rb)), (math.cos(rb), -math.sin(rb))
    a_l, a_r = _add(o, d_l, glue_len), _add(o, d_r, glue_len)
    top = (ox, oy + apex)
    outline = [_add(o, n_r, tab), _add(a_r, n_r, tab), a_r, top, a_l, _add(a_l, n_l, tab),
               _add(o, n_l, tab), o]
    left, right = _pages(width, height, PAGE_STOCK)

    def frame(phi: float):
        e_l, e_r = page_dirs(phi)
        gl = (math.sin(ra) * e_l[0], math.sin(ra) * e_l[1], -math.cos(ra))
        gr = (math.sin(ra) * e_r[0], math.sin(ra) * e_r[1], -math.cos(ra))
        cos_2d = max(-1.0, min(1.0, sum(x * y for x, y in zip(gl, gr, strict=True))))
        delta = math.acos(cos_2d) / 2
        m = _unit3((gl[0] + gr[0], gl[1] + gr[1], gl[2] + gr[2]))
        inner = _inner(e_l, e_r)
        nrm = _cross3(gl, gr)
        if math.sqrt(sum(c * c for c in nrm)) < 1e-12:      # closed: in-plane perpendicular
            nrm = _cross3(gl, (0.0, 1.0, 0.0))
        nrm = _unit3(nrm)
        if nrm[0] * inner[0] + nrm[1] * inner[1] < 0:
            nrm = (-nrm[0], -nrm[1], -nrm[2])
        ratio = math.cos(rb) / math.cos(delta)
        if ratio > 1 + 1e-12:
            return None
        s = math.sqrt(max(0.0, 1 - ratio * ratio))
        f = tuple(ratio * m[k] + s * nrm[k] for k in range(3))
        return gl, gr, f

    def pose(phi: float) -> Pose | None:
        fr = frame(phi)
        if fr is None:
            return None
        gl, gr, f = fr
        pages = _page_pose(width, phi)
        o3: Vec3 = (0.0, 0.0, -at)
        rot_l, rot_r = alpha - beta, beta - alpha

        def piece(u: float, v: float) -> Vec3:
            rel = (u - ox, v - oy)
            if _cross2(d_l, rel) > 1e-12 and _cross2(rel, d_r) < 0 and rel[0] < 0:
                return pages["page-left"](*_rot_to(rel, rot_l, (width, at)))
            if _cross2(rel, d_r) > 1e-12 and rel[0] > 0:
                return pages["page-right"](*_rot_to(rel, rot_r, (0.0, at)))
            if rel[0] <= 0:      # left half: rel = a·d_l + b·(0, 1)
                a = -rel[0] / math.sin(rb)
                b = rel[1] - a * math.cos(rb)
                base = gl
            else:
                a = rel[0] / math.sin(rb)
                b = rel[1] - a * math.cos(rb)
                base = gr
            return tuple(o3[k] + a * base[k] + b * f[k] for k in range(3))  # type: ignore[return-value]

        return {**pages, "v-fold": piece}

    probe = pose(default_open)
    if probe is None:
        raise ValueError(f"V-fold locked at the default opening {default_open}°")
    fr = frame(default_open)
    gl, gr, f = fr  # type: ignore[misc]
    centre = _fold3(gl, gr, f)
    glue_angle = _glue_angle(gl, f)
    sheet = Sheet("v-fold", outline, stock=PIECE_STOCK, grain_deg=90.0,
                  label={"en": "V-fold piece", "es": "Pieza en V", "fr": "Pièce en V",
                         "pt": "Peça em V"})
    sheet.crease(o, top, "mountain", centre, treatment="score")
    sheet.crease(o, a_l, "valley", glue_angle, treatment="score")
    sheet.crease(o, a_r, "valley", glue_angle, treatment="score")
    i = GLUE_INSET_MM
    joins = []
    for side, a_pt, d, n, rot, page_o, page in (
            ("left", a_l, d_l, n_l, ra - rb, (width, at), "page-left"),
            ("right", a_r, d_r, n_r, rb - ra, (0.0, at), "page-right")):
        region = [_add(_add(o, d, i * 3), n, i), _add(_add(a_pt, d, -i), n, i),
                  _add(_add(a_pt, d, -i), n, tab - i), _add(_add(o, d, i * 3), n, tab - i)]
        if side == "left":
            region = region[::-1]
        c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        tx = page_o[0] - (c * ox - s * oy)
        ty = page_o[1] - (s * ox + c * oy)
        joins.append(glue(f"v-fold-{side}", sheet, region, page, (c, -s, s, c, tx, ty), "front"))
    return PopUp("V-fold", [left, right, sheet], joins, pose, default_open, width, height,
                 {"alpha": alpha, "beta": beta, "glue_len": glue_len, "apex": apex, "at": at})


def _rot_to(rel: V2, rot_deg: float, origin: V2) -> V2:
    c, s = math.cos(math.radians(rot_deg)), math.sin(math.radians(rot_deg))
    return (origin[0] + c * rel[0] - s * rel[1], origin[1] + s * rel[0] + c * rel[1])


def _cross3(a, b) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _unit3(a) -> Vec3:
    n = math.sqrt(sum(c * c for c in a))
    return (a[0] / n, a[1] / n, a[2] / n)


def _fold3(gl, gr, f) -> float:
    n1, n2 = _unit3(_cross3(gl, f)), _unit3(_cross3(f, gr))
    return math.degrees(math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(n1, n2,
                                                                              strict=True))))))


def _glue_angle(gl, f) -> float:
    """Fold angle at a glue line: between the page's front normal (+Y for the left page) and the
    front normal f × gl of the kite half that rises from it."""
    half_n = _unit3(_cross3(f, gl))
    return math.degrees(math.acos(max(-1.0, min(1.0, half_n[1]))))


# ── origamic architecture (cut-fold) and step fold ───────────────────────────


def oa_cut_fold(blocks: tuple[tuple[float, float, float, float], ...] = ((70.0, 130.0, 40.0,
                                                                         50.0),),
                width: float = 150.0, height: float = 200.0, name: str = "Cut-fold",
                sheet_id: str = "cut-fold") -> PopUp:
    """90° origamic-architecture cut-fold: one sheet over both pages; each block
    ``(v_from, v_to, p, q)`` is a strip between two slits that pops out as a parallelogram
    (depth p on the left page, height q on the right page). The sheet is glued onto the boards
    away from the blocks; it starts flat (``open`` = 180°, see the module docstring)."""
    if not blocks:
        raise ValueError("cut-fold needs at least one block")
    _check(width=width, height=height)
    ordered = sorted(blocks)
    prev = 0.0
    for v_a, v_b, p, q in ordered:
        _check(p=p, q=q)
        if not (prev < v_a < v_b < height) or p >= width - 15 or q >= width - 15:
            raise ValueError(f"block {(v_a, v_b, p, q)} overlaps or does not fit the sheet")
        prev = v_b
    w = width
    sheet = Sheet(sheet_id, [(0, 0), (2 * w, 0), (2 * w, height), (0, height)], stock=OA_STOCK,
                  grain_deg=90.0, label={"en": "Cut-fold sheet", "es": "Hoja de corte y "
                                         "pliegue", "fr": "Feuille coupée-pliée",
                                         "pt": "Folha de corte e dobra"})
    gaps, prev = [], 0.0
    for v_a, v_b, p, q in ordered:
        gaps.append((prev, v_a))
        prev = v_b
        sheet.cut([(w - p, v_a), (w + q, v_a)])
        sheet.cut([(w - p, v_b), (w + q, v_b)])
        sheet.crease((w - p, v_a), (w - p, v_b), "valley", 90.0, treatment="score")
        sheet.crease((w - p + q, v_a), (w - p + q, v_b), "mountain", 90.0, treatment="score")
        sheet.crease((w + q, v_a), (w + q, v_b), "valley", 90.0, treatment="score")
    gaps.append((prev, height))
    for v_a, v_b in gaps:
        sheet.crease((w, v_a), (w, v_b), "valley", 90.0, treatment="score")
    left, right = _pages(w, height, PAGE_STOCK)
    m = 5.0
    lo = min(w - p for _a, _b, p, _q in ordered) - m
    hi = max(w + q for _a, _b, _p, q in ordered) + m
    joins = [glue(f"{sheet_id}-left", sheet, [(m, m), (lo, m), (lo, height - m), (m, height - m)],
                  "page-left", (1, 0, 0, 1, 0, 0), "front"),
             glue(f"{sheet_id}-right", sheet, [(hi, m), (2 * w - m, m), (2 * w - m, height - m),
                                               (hi, height - m)], "page-right",
                  (1, 0, 0, 1, -w, 0), "front")]

    def pose(phi: float) -> Pose | None:
        pages = _page_pose(w, phi)
        e_l, e_r = page_dirs(phi)

        def at(u: float, v: float) -> Vec3:
            for v_a, v_b, p, q in ordered:
                if v_a <= v <= v_b and w - p <= u <= w + q:
                    a = _add((0.0, 0.0), e_l, p)
                    f = _add(a, e_r, q)
                    x = _add(a, e_r, u - (w - p)) if u <= w - p + q else _add(
                        f, e_l, -(u - (w - p + q)))
                    return (x[0], x[1], -v)
            return pages["page-left"](u, v) if u <= w else pages["page-right"](u - w, v)

        return {**pages, sheet_id: at}

    return PopUp(name, [left, right, sheet], joins, pose, 180.0, w, height,
                 {"blocks": [list(b) for b in ordered]})


def step_fold(steps: int = 2, depth: float = 25.0, rise: float = 25.0, block: float = 40.0,
              width: float = 150.0, height: float = 200.0) -> PopUp:
    """Step fold: a staircase of cut-fold blocks side by side along the gutter, block k with
    depth k·depth and height k·rise (each its own parallelogram, all driven by the opening)."""
    if not isinstance(steps, int) or not 1 <= steps <= 6:
        raise ValueError("steps must be an integer in [1, 6]")
    margin = (height - steps * block) / (steps + 1)
    if margin < 5:
        raise ValueError("blocks do not fit the page height")
    blocks = tuple((margin + k * (block + margin), margin + k * (block + margin) + block,
                    depth * (k + 1), rise * (k + 1)) for k in range(steps))
    return oa_cut_fold(blocks, width, height, name="Step fold", sheet_id="step-fold")


GENERATORS: dict[str, Callable[..., PopUp]] = {
    "v-fold": v_fold, "parallel-fold": parallel_fold, "floating-layer": floating_layer,
    "step-fold": step_fold, "tent": tent, "cut-fold": oa_cut_fold,
}
