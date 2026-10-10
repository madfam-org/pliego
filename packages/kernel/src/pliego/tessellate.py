"""Tessellation generators: Miura-ori, Yoshimura, Kresling, waterbomb, twists, Resch, accordion.

Every crease pattern here is generated from geometry written in this module (no third-party crease
pattern is copied). Each generator returns a :class:`Tessellation`: one :class:`pliego.Sheet` with
M/V assignments and final fold angles, the fold program, and — where one exists — the closed-form
1-DOF angle law.

**Miura-ori closed form.** Panels are parallelograms with sides ``a`` (along the straight row
lines) and ``b`` (along the zigzag columns) and acute angle ``γ``. Folding is parameterised by
``η ∈ [0, γ]``: each straight row line folds into a planar zigzag whose segments turn by ``±η``.
With ``cx = cos γ / cos η`` and ``cz² = 1 − cx²`` the folded vertices are exactly::

    X(i, j) = (i·a·cos η + (j mod 2)·b·cx,  (i mod 2)·a·sin η,  j·b·cz)

(every panel stays a congruent parallelogram, so the motion is rigid), and the fold angles are::

    cos ρ_row = (cz² − cx²·sin²η) / sin²γ           (straight lines, alternating M/V per segment)
    cos ρ_col = (cz²·cos 2η − cx²·sin²η) / sin²γ    (zigzag columns, uniform per column)

η = 0 is flat, η = γ is flat-folded (both 180°); γ = 90° degenerates to ρ_row = 0, ρ_col = 2η.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field

from .assembly import Assembly, Sequence_, Step, sequence_control
from .geometry import Vec2
from .sheet import Mark, Sheet

Vec3 = tuple[float, float, float]
Label = dict[str, str]
EPS_ANGLE = 1e-9


# ── 3-D helpers shared with popup.py / book.py ───────────────────────────────


def _sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _unit(a: Vec3) -> Vec3:
    n = math.sqrt(_dot(a, a))
    if n < 1e-15:
        raise ValueError("zero vector")
    return (a[0] / n, a[1] / n, a[2] / n)


def face_normal(points: list[Vec3]) -> Vec3:
    """Unit normal of a planar polygon by Newell's method (right-hand rule on vertex order)."""
    nx = ny = nz = 0.0
    for k, p in enumerate(points):
        q = points[(k + 1) % len(points)]
        nx += (p[1] - q[1]) * (p[2] + q[2])
        ny += (p[2] - q[2]) * (p[0] + q[0])
        nz += (p[0] - q[0]) * (p[1] + q[1])
    return _unit((nx, ny, nz))


def signed_fold_angle(n_left: Vec3, n_right: Vec3, edge: Vec3) -> float:
    """FOLD-signed fold angle (deg, valley > 0) of a crease.

    ``n_left``/``n_right`` are the front normals of the faces left/right of the directed crease
    ``edge`` in the (counter-clockwise) sheet frame.
    """
    c = max(-1.0, min(1.0, _dot(n_left, n_right)))
    mag = math.degrees(math.acos(c))
    s = _dot(_cross(n_left, n_right), _unit(edge))
    return -mag if s > 0 else mag


def document_fold_angles(doc, frame: str) -> dict[int, float]:
    """Signed fold angles of every interior M/V/F edge in a document frame (sheet-local CCW)."""
    d = doc.data if hasattr(doc, "data") else doc
    vc = next(f["vertices_coords"] for f in d["file_frames"] if f["frame_title"] == frame)
    coords = d["vertices_coords"]
    faces_of: dict[tuple[int, int], int] = {}
    for fi, f in enumerate(d["faces_vertices"]):
        for k, a in enumerate(f):
            faces_of[(a, f[(k + 1) % len(f)])] = fi
    normals = [face_normal([tuple(vc[v]) for v in f]) for f in d["faces_vertices"]]
    out: dict[int, float] = {}
    for e, (a, b) in enumerate(d["edges_vertices"]):
        if d["edges_assignment"][e] not in "MVF" or (a, b) not in faces_of or (
                b, a) not in faces_of:
            continue
        left, right = faces_of[(a, b)], faces_of[(b, a)]
        edge3 = _sub(tuple(vc[b]), tuple(vc[a]))
        if math.dist(coords[a], coords[b]) > 0:
            out[e] = signed_fold_angle(normals[left], normals[right], edge3)
    return out


# ── result type ──────────────────────────────────────────────────────────────


@dataclass
class Tessellation:
    """A generated crease pattern: the sheet, its fold program and (optionally) its angle law."""

    sheet: Sheet
    name: str
    flat_foldable: bool
    mode: str = "physical"
    law: Callable[[float], dict[str, float]] | None = None
    groups: dict[str, list[Mark]] = field(default_factory=dict)
    targets: dict[str, Callable[[str, tuple[float, float]], Vec3]] = field(default_factory=dict)
    meta: dict = field(default_factory=dict)

    def assembly(self) -> Assembly:
        marks = [m for m in self.sheet.marks if m.assignment in ("M", "V")]
        step = Step("fold", {"en": "Fold the pattern", "es": "Pliega el patrón",
                             "fr": "Plier le motif", "pt": "Dobrar o padrão"},
                    [(m, None) for m in marks], duration_ms=3000)
        return Assembly([self.sheet], controls=[sequence_control()],
                        sequence=Sequence_([step], mode=self.mode), title=self.name,
                        meta={"cartridge": self.sheet.id, "params": dict(self.meta)},
                        targets=dict(self.targets))

    def document(self, stocks: dict | None = None):
        return self.assembly().build(stocks=stocks)


def _label(en: str, es: str, fr: str, pt: str) -> Label:
    return {"en": en, "es": es, "fr": fr, "pt": pt}


def _check(**positive: float) -> None:
    for name, value in positive.items():
        if not (isinstance(value, int | float) and math.isfinite(value) and value > 0):
            raise ValueError(f"{name} must be a positive number, got {value!r}")


def _counts(**counts: int) -> None:
    for name, value in counts.items():
        if not isinstance(value, int) or value < 1 or value > 200:
            raise ValueError(f"{name} must be an integer in [1, 200], got {value!r}")


# ── Miura-ori ────────────────────────────────────────────────────────────────


def miura_fold_angles(gamma_deg: float, eta_deg: float) -> tuple[float, float]:
    """(ρ_row, ρ_col) fold-angle magnitudes in degrees at fold parameter η (module docstring)."""
    g, e = math.radians(gamma_deg), math.radians(eta_deg)
    if not 0 < gamma_deg <= 90 or not -EPS_ANGLE <= eta_deg <= gamma_deg + EPS_ANGLE:
        raise ValueError("need 0 < γ ≤ 90° and 0 ≤ η ≤ γ")
    cx = min(1.0, math.cos(g) / math.cos(e))
    cz2 = max(0.0, 1.0 - cx * cx)
    s2 = math.sin(g) ** 2
    c_row = (cz2 - cx * cx * math.sin(e) ** 2) / s2
    c_col = (cz2 * math.cos(2 * e) - cx * cx * math.sin(e) ** 2) / s2
    clamp = lambda c: max(-1.0, min(1.0, c))  # noqa: E731
    return math.degrees(math.acos(clamp(c_row))), math.degrees(math.acos(clamp(c_col)))


def miura_vertex(i: int, j: int, a: float, b: float, gamma_deg: float,
                 eta_deg: float) -> Vec3:
    """Closed-form folded position X(i, j) in the construction frame (module docstring)."""
    g, e = math.radians(gamma_deg), math.radians(eta_deg)
    cx = min(1.0, math.cos(g) / math.cos(e))
    cz = math.sqrt(max(0.0, 1.0 - cx * cx))
    return (i * a * math.cos(e) + (j % 2) * b * cx, (i % 2) * a * math.sin(e), j * b * cz)


def miura(nx: int = 6, ny: int = 6, a: float = 20.0, b: float = 20.0, gamma: float = 60.0,
          fold: float = 1.0, stock: str = "kami", sheet_id: str = "miura-ori") -> Tessellation:
    """Miura-ori: ``nx`` × ``ny`` parallelogram panels; final state at η = fold·γ (rigid, 1 DOF).

    Adds a ``target:half-folded`` frame computed from the closed form (η = γ/2).
    """
    _counts(nx=nx, ny=ny)
    _check(a=a, b=b)
    if not 0 < gamma < 90:
        raise ValueError("gamma must be in (0, 90) degrees")
    if not 0 <= fold <= 1:
        raise ValueError("fold must be in [0, 1]")
    gc, gs = math.cos(math.radians(gamma)), math.sin(math.radians(gamma))

    def flat(i: int, j: int) -> Vec2:
        return Vec2(i * a + (j % 2) * b * gc, j * b * gs)

    outline = ([flat(i, 0) for i in range(nx + 1)] + [flat(nx, j) for j in range(1, ny + 1)]
               + [flat(i, ny) for i in range(nx - 1, -1, -1)]
               + [flat(0, j) for j in range(ny - 1, 0, -1)])
    sheet = Sheet(sheet_id, outline, stock=stock, grain_deg=0.0,
                  label=_label("Miura-ori", "Miura-ori", "Miura-ori", "Miura-ori"))
    eta = fold * gamma
    rho_row, rho_col = miura_fold_angles(gamma, eta)
    col_kind = lambda i: "mountain" if i % 2 == 0 else "valley"  # noqa: E731
    flip = {"mountain": "valley", "valley": "mountain"}
    groups: dict[str, list[Mark]] = {"rows": [], "columns": []}
    for j in range(1, ny):
        for i in range(nx):
            kind = col_kind(i) if j % 2 else flip[col_kind(i)]
            groups["rows"].append(sheet.crease(flat(i, j), flat(i + 1, j), kind, rho_row))
    for i in range(1, nx):
        for j in range(ny):
            groups["columns"].append(sheet.crease(flat(i, j), flat(i, j + 1), col_kind(i),
                                                  rho_col))

    def lattice(u: float, v: float) -> tuple[int, int]:
        j = round(v / (b * gs))
        return round((u - (j % 2) * b * gc) / a), j

    def state(eta_deg: float, ysign: float) -> Callable[[str, tuple[float, float]], Vec3]:
        def at(_sid: str, uv: tuple[float, float]) -> Vec3:
            x, y, z = miura_vertex(*lattice(*uv), a, b, gamma, eta_deg)
            return (x, ysign * y, -z)
        return at

    # orient the closed form so its signed angles agree with the assignment (valley > 0)
    probe = groups["columns"][0] if groups["columns"] else None
    ysign = 1.0
    if probe is not None:
        ysign = _orient_ysign(state(gamma / 2, 1.0), probe, flat, lattice)
    tess = Tessellation(sheet, "Miura-ori", True, "kinematic",
                        law=lambda t: dict(zip(("row", "column"),
                                               miura_fold_angles(gamma, t * gamma), strict=True)),
                        groups=groups, targets={"half-folded": state(gamma / 2, ysign)},
                        meta={"nx": nx, "ny": ny, "a": a, "b": b, "gamma": gamma, "fold": fold})
    return tess


def _orient_ysign(at: Callable[[str, tuple[float, float]], Vec3], probe: Mark,
                  flat: Callable[[int, int], Vec2],
                  lattice: Callable[[float, float], tuple[int, int]]) -> float:
    """+1 if the closed form folds ``probe`` (a column crease) with its assigned sign, else −1."""
    p, q = probe.points[0], probe.points[1]
    i, j = lattice(p.x, p.y)
    left = [flat(i - 1, j), flat(i, j), flat(i, j + 1), flat(i - 1, j + 1)]
    right = [flat(i, j), flat(i + 1, j), flat(i + 1, j + 1), flat(i, j + 1)]
    n_l = face_normal([at("", (w.x, w.y)) for w in left])
    n_r = face_normal([at("", (w.x, w.y)) for w in right])
    edge = _sub(at("", (q.x, q.y)), at("", (p.x, p.y)))
    sign = signed_fold_angle(n_l, n_r, edge)
    return 1.0 if (sign > 0) == (probe.assignment == "V") else -1.0


# ── simple strips and grids ──────────────────────────────────────────────────


def accordion(panels: int = 8, width: float = 20.0, height: float = 80.0, angle: float = 180.0,
              stock: str = "copy-80", sheet_id: str = "accordion") -> Tessellation:
    """Accordion (pleat) strip: ``panels`` panels with alternating valley / mountain creases."""
    _counts(panels=panels)
    _check(width=width, height=height)
    sheet = Sheet(sheet_id, [(0, 0), (panels * width, 0), (panels * width, height),
                             (0, height)], stock=stock, grain_deg=90.0,
                  label=_label("Accordion", "Acordeón", "Accordéon", "Sanfona"))
    marks = [sheet.crease((k * width, 0), (k * width, height),
                          "valley" if k % 2 else "mountain", angle) for k in range(1, panels)]
    return Tessellation(sheet, "Accordion", True, "kinematic",
                        law=lambda t: {"pleat": 180.0 * t}, groups={"pleats": marks},
                        meta={"panels": panels, "width": width, "height": height})


def yoshimura(columns: int = 6, rows: int = 4, width: float = 30.0, height: float = 20.0,
              stock: str = "kami", sheet_id: str = "yoshimura") -> Tessellation:
    """Yoshimura (diamond) pattern: horizontal valleys, zigzag diagonal mountains (degree 6)."""
    _counts(columns=columns, rows=rows)
    _check(width=width, height=height)
    w, h = width, height
    sheet = Sheet(sheet_id, [(0, 0), (columns * w, 0), (columns * w, rows * h), (0, rows * h)],
                  stock=stock, grain_deg=90.0,
                  label=_label("Yoshimura pattern", "Patrón Yoshimura", "Motif Yoshimura",
                               "Padrão Yoshimura"))
    groups: dict[str, list[Mark]] = {"rings": [], "diagonals": []}
    for j in range(1, rows):
        groups["rings"].append(sheet.valley((0, j * h), (columns * w, j * h)))
    for j in range(rows):
        lo_off, hi_off = (0.0, 0.5) if j % 2 == 0 else (0.5, 0.0)
        lows = _row_points(columns, w, lo_off)
        highs = _row_points(columns, w, hi_off)
        for x0 in lows:
            for x1 in highs:
                if math.isclose(abs(x1 - x0), w / 2, abs_tol=1e-9):
                    groups["diagonals"].append(sheet.mountain((x0, j * h), (x1, (j + 1) * h)))
    return Tessellation(sheet, "Yoshimura", True, groups=groups,
                        meta={"columns": columns, "rows": rows, "width": w, "height": h})


def _row_points(columns: int, w: float, offset: float) -> list[float]:
    pts = [(k + offset) * w for k in range(columns + 1)]
    if offset:
        pts = [0.0] + [p for p in pts if p < columns * w] + [columns * w]
    return pts


def waterbomb(columns: int = 4, rows: int = 4, size: float = 30.0, stock: str = "kami",
              sheet_id: str = "waterbomb") -> Tessellation:
    """Waterbomb tessellation (aligned grid of waterbomb bases): every square carries both
    diagonals (mountain) and every half-square line is a valley — degree-6 vertices with
    sectors 45/45/90/45/45/90 at corners and centres."""
    _counts(columns=columns, rows=rows)
    _check(size=size)
    s = size
    sheet = Sheet(sheet_id, [(0, 0), (columns * s, 0), (columns * s, rows * s), (0, rows * s)],
                  stock=stock, grain_deg=90.0,
                  label=_label("Waterbomb tessellation", "Teselado de bomba de agua",
                               "Pavage bombe à eau", "Tesselação bomba d'água"))
    groups: dict[str, list[Mark]] = {"lines": [], "diagonals": []}
    for k in range(1, 2 * rows):
        groups["lines"].append(sheet.valley((0, k * s / 2), (columns * s, k * s / 2)))
    for j in range(rows):
        for i in range(columns):
            x0, y0 = i * s, j * s
            groups["diagonals"].append(sheet.mountain((x0, y0), (x0 + s, y0 + s)))
            groups["diagonals"].append(sheet.mountain((x0 + s, y0), (x0, y0 + s)))
    return Tessellation(sheet, "Waterbomb", True, groups=groups,
                        meta={"columns": columns, "rows": rows, "size": s})


def kresling(sides: int = 6, storeys: int = 2, width: float = 30.0, height: float = 25.0,
             shear: float = 15.0, stock: str = "kami", sheet_id: str = "kresling") -> Tessellation:
    """Kresling strip: ``sides`` sheared parallelograms per storey, each split by its long
    diagonal (valley); storey lines and short sides are mountains. Roll the strip into an
    n-gon tube to fold it. Not rigid-foldable (0 rigid DOF, bistable with panel strain), so the
    fold angles are physical drive targets, not a kinematic state."""
    _counts(sides=sides, storeys=storeys)
    _check(width=width, height=height)
    if not 0 <= shear < width:
        raise ValueError("shear must be in [0, width)")
    w, h, s = width, height, shear
    pt = lambda k, j: (k * w + j * s, j * h)  # noqa: E731
    outline = ([pt(k, 0) for k in range(sides + 1)] + [pt(sides, j) for j in range(1, storeys + 1)]
               + [pt(k, storeys) for k in range(sides - 1, -1, -1)]
               + [pt(0, j) for j in range(storeys - 1, 0, -1)])
    sheet = Sheet(sheet_id, outline, stock=stock, grain_deg=0.0,
                  label=_label("Kresling pattern", "Patrón Kresling", "Motif de Kresling",
                               "Padrão Kresling"))
    groups: dict[str, list[Mark]] = {"rings": [], "sides": [], "diagonals": []}
    for j in range(1, storeys):
        for k in range(sides):
            groups["rings"].append(sheet.mountain(pt(k, j), pt(k + 1, j), angle=60.0))
    for j in range(storeys):
        for k in range(1, sides):
            groups["sides"].append(sheet.mountain(pt(k, j), pt(k, j + 1), angle=60.0))
        for k in range(sides):
            groups["diagonals"].append(sheet.valley(pt(k, j), pt(k + 1, j + 1), angle=120.0))
    return Tessellation(sheet, "Kresling", False, groups=groups,
                        meta={"sides": sides, "storeys": storeys, "width": w, "height": h,
                              "shear": s})


def resch(columns: int = 4, rows: int = 4, size: float = 30.0, stock: str = "kami",
          sheet_id: str = "resch") -> Tessellation:
    """Resch-type triangular pattern (generated): on a triangular lattice clipped to a rhombus,
    every lattice line is a mountain (the up-triangles' edges) and every down-triangle is split
    into three 30-30-120 tuck triangles by valleys from its centroid. Not flat-foldable
    (degree-9 lattice vertices); fold angles are physical drive targets."""
    _counts(columns=columns, rows=rows)
    _check(size=size)
    s, r3 = size, math.sqrt(3.0)
    lp = lambda i, j: Vec2(i * s + j * s / 2, j * s * r3 / 2)  # noqa: E731
    sheet = Sheet(sheet_id, [lp(0, 0), lp(columns, 0), lp(columns, rows), lp(0, rows)],
                  stock=stock, grain_deg=0.0,
                  label=_label("Resch-type pattern", "Patrón tipo Resch", "Motif type Resch",
                               "Padrão tipo Resch"))
    groups: dict[str, list[Mark]] = {"lattice": [], "tucks": []}
    for j in range(1, rows):
        groups["lattice"].append(sheet.mountain(lp(0, j), lp(columns, j), angle=90.0))
    for i in range(1, columns):
        groups["lattice"].append(sheet.mountain(lp(i, 0), lp(i, rows), angle=90.0))
    for k in range(1, columns + rows):  # lines i + j = k (the third lattice direction)
        ends = [(i, k - i) for i in range(columns + 1) if 0 <= k - i <= rows]
        (i0, j0), (i1, j1) = ends[0], ends[-1]
        groups["lattice"].append(sheet.mountain(lp(i0, j0), lp(i1, j1), angle=90.0))
    for j in range(rows):
        for i in range(columns):
            a, b, c = lp(i + 1, j), lp(i + 1, j + 1), lp(i, j + 1)   # down-triangle
            g = Vec2((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3)
            for corner in (a, b, c):
                groups["tucks"].append(sheet.valley(g, corner, angle=150.0))
    return Tessellation(sheet, "Resch-type", False, groups=groups,
                        meta={"columns": columns, "rows": rows, "size": s})


# ── twists ───────────────────────────────────────────────────────────────────


def _ray_exit(p: Vec2, d: Vec2, ring: list[Vec2]) -> Vec2:
    """First exit point of the ray p + t·d from a convex ring containing p."""
    best = math.inf
    for k, a in enumerate(ring):
        b = ring[(k + 1) % len(ring)]
        e = b - a
        den = d.cross(e)
        if abs(den) < 1e-15:
            continue
        t = (a - p).cross(e) / den
        u = (a - p).cross(d) / den
        if t > 1e-9 and -1e-12 <= u <= 1 + 1e-12:
            best = min(best, t)
    if not math.isfinite(best):
        raise ValueError("pleat ray does not leave the sheet")
    return p + d * best


def _segments_cross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2) -> bool:
    d1, d2 = p2 - p1, q2 - q1
    den = d1.cross(d2)
    if abs(den) < 1e-12:
        return False
    t = (q1 - p1).cross(d2) / den
    u = (q1 - p1).cross(d1) / den
    return 1e-9 < t < 1 - 1e-9 and 1e-9 < u < 1 - 1e-9


def twist(n: int = 4, inner: float = 30.0, sheet_size: float = 150.0, alpha: float = 22.5,
          stock: str = "kami", sheet_id: str | None = None) -> Tessellation:
    """n-fold twist fold: a central regular n-gon (valleys) with one pleat per edge.

    At each polygon vertex the creases sit at 0°, 180° − 360°/n (polygon edges), 270° − 360°/n + α
    and 270° + α (pleats, relative to the edge direction), so the sectors are
    180° − 360°/n, 90° + α, 360°/n, 90° − α: Kawasaki holds for any α, Maekawa (3 V, 1 M) by
    assignment. The sheet is a square (n = 4) or a regular n-gon; crossing pleats fail loud.
    """
    if not isinstance(n, int) or not 3 <= n <= 12:
        raise ValueError("n must be an integer in [3, 12]")
    _check(inner=inner, sheet_size=sheet_size)
    if not 0 < alpha < 90:
        raise ValueError("alpha must be in (0, 90) degrees")
    r = inner / (2 * math.sin(math.pi / n))                     # circumradius of the centre
    half = sheet_size / 2
    if n == 4:
        ring = [Vec2(-half, -half), Vec2(half, -half), Vec2(half, half), Vec2(-half, half)]
    else:
        ring = [Vec2(half * math.cos(2 * math.pi * k / n), half * math.sin(2 * math.pi * k / n))
                for k in range(n)]
    centre = [Vec2(r * math.cos(2 * math.pi * k / n + math.pi / n),
                   r * math.sin(2 * math.pi * k / n + math.pi / n)) for k in range(n)]
    inradius = half if n == 4 else half * math.cos(math.pi / n)
    if r >= 0.9 * inradius:
        raise ValueError("inner polygon does not fit the sheet")
    pleats: list[tuple[Vec2, Vec2, str]] = []
    for k in range(n):
        p, q = centre[k], centre[(k + 1) % n]
        dk = (q - p).normalized()
        out = dk.rotated(-90.0 + alpha)
        pleats.append((p, _ray_exit(p, out, ring), "mountain"))
        pleats.append((q, _ray_exit(q, out, ring), "valley"))
    for x in range(len(pleats)):
        for y in range(x + 1, len(pleats)):
            if _segments_cross(pleats[x][0], pleats[x][1], pleats[y][0], pleats[y][1]):
                raise ValueError(f"pleats {x} and {y} cross inside the sheet: reduce alpha or "
                                 "the sheet size")
    shift = Vec2(half, half)
    names = {4: ("Square twist", "Torsión cuadrada", "Twist carré", "Torção quadrada"),
             6: ("Hexagonal twist", "Torsión hexagonal", "Twist hexagonal", "Torção hexagonal")}
    en, es, fr, pt = names.get(n, (f"{n}-fold twist", f"Torsión de {n} pliegues",
                                   f"Twist d'ordre {n}", f"Torção de {n} dobras"))
    sid = sheet_id or {4: "square-twist", 6: "hex-twist"}.get(n, f"twist-{n}")
    sheet = Sheet(sid, [p + shift for p in ring], stock=stock, grain_deg=90.0,
                  label=_label(en, es, fr, pt))
    groups: dict[str, list[Mark]] = {"centre": [], "pleats": []}
    for k in range(n):
        groups["centre"].append(sheet.valley(centre[k] + shift, centre[(k + 1) % n] + shift))
    for start, end, kind in pleats:
        groups["pleats"].append(sheet.crease(start + shift, end + shift, kind))
    return Tessellation(sheet, en, True, groups=groups,
                        meta={"n": n, "inner": inner, "sheet_size": sheet_size, "alpha": alpha})


def square_twist(inner: float = 30.0, sheet_size: float = 150.0, alpha: float = 22.5,
                 stock: str = "kami") -> Tessellation:
    return twist(4, inner, sheet_size, alpha, stock)


def hex_twist(inner: float = 30.0, sheet_size: float = 150.0, alpha: float = 15.0,
              stock: str = "kami") -> Tessellation:
    return twist(6, inner, sheet_size, alpha, stock)


GENERATORS: dict[str, Callable[..., Tessellation]] = {
    "miura-ori": miura, "yoshimura": yoshimura, "kresling": kresling, "waterbomb": waterbomb,
    "square-twist": square_twist, "hex-twist": hex_twist, "resch": resch, "accordion": accordion,
}
