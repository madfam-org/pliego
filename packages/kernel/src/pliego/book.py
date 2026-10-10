"""Book structures: leaf, codex, accordion / leporello, screenfold codex, tunnel book, carousel.

Each generator returns an :class:`Assembly`. Pages that turn use the spec's ``leaf`` mechanism
(0 = lying right, 180 = turned left; the engine bends the paper physically) with one angle control
per leaf and a ``pin`` along the spine. Folded strips (leporello, screenfold) carry their fold
program; the tunnel book and carousel start in their open, displayed state with an initial frame
computed here so that every glue weld holds exactly.
"""

from __future__ import annotations

import math
from collections.abc import Callable

from .assembly import (
    Assembly,
    Sequence_,
    Step,
    angle_control,
    glue,
    pin,
    sequence_control,
    string,
)
from .assembly import (
    leaf as leaf_mechanism,
)
from .sheet import Placement, Sheet

Vec3 = tuple[float, float, float]
TURN_LABEL = {"en": "Turn the page", "es": "Pasar la página", "fr": "Tourner la page",
              "pt": "Virar a página"}
LEAF_GAP_MM = 0.12          # stacking pitch of codex leaves (≥ collision thickness of copy-80)
DRESDEN_CODEX_SOURCE = "https://en.wikipedia.org/wiki/Dresden_Codex"


def _check(**values: float) -> None:
    for name, value in values.items():
        if not (isinstance(value, int | float) and math.isfinite(value) and value > 0):
            raise ValueError(f"{name} must be a positive number, got {value!r}")


def _count(name: str, value: int, hi: int) -> None:
    if not isinstance(value, int) or not 1 <= value <= hi:
        raise ValueError(f"{name} must be an integer in [1, {hi}], got {value!r}")


def _rect(w: float, h: float) -> list[tuple[float, float]]:
    return [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]


def _turning_leaf(sid: str, label: dict, width: float, height: float, stock: str,
                  control_id: str, y: float = 0.0) -> tuple[Sheet, dict, dict, dict]:
    sheet = Sheet(sid, _rect(width, height), stock=stock, grain_deg=90.0, label=label,
                  placement=Placement(origin=(0.0, y, 0.0)) if y else None)
    spine = ((0.0, 0.0), (0.0, height))
    mech = leaf_mechanism(f"{sid}-turn", sheet, spine, control_id)
    ctrl = angle_control(control_id, TURN_LABEL, default=0.0)
    return sheet, mech, ctrl, pin(f"{sid}-spine", along=(sheet, spine))


def leaf(width: float = 148.0, height: float = 210.0, stock: str = "copy-80") -> Assembly:
    """One page hinged at its spine — the simplest object in the commons (A5 by default)."""
    _check(width=width, height=height)
    sheet, mech, ctrl, spine_pin = _turning_leaf(
        "leaf", {"en": "Leaf", "es": "Hoja", "fr": "Feuillet", "pt": "Folha"}, width, height,
        stock, "turn")
    return Assembly([sheet], joins=[spine_pin], mechanisms=[mech], controls=[ctrl],
                    title="Leaf", meta={"cartridge": "leaf",
                                        "params": {"width": width, "height": height}})


def codex(leaves: int = 8, width: float = 148.0, height: float = 210.0,
          stock: str = "copy-80") -> Assembly:
    """A codex of N leaves stacked on a common spine; leaf 1 lies on top. One page-turn control
    per leaf (``turn-1`` … ``turn-N``)."""
    _count("leaves", leaves, 64)
    _check(width=width, height=height)
    sheets, mechs, ctrls, joins = [], [], [], []
    for k in range(1, leaves + 1):
        s, m, c, j = _turning_leaf(
            f"leaf-{k}", {"en": f"Leaf {k}", "es": f"Hoja {k}", "fr": f"Feuillet {k}",
                          "pt": f"Folha {k}"}, width, height, stock, f"turn-{k}",
            y=(leaves - k) * LEAF_GAP_MM)
        sheets.append(s)
        mechs.append(m)
        ctrls.append(c)
        joins.append(j)
    return Assembly(sheets, joins=joins, mechanisms=mechs, controls=ctrls, title="Codex",
                    meta={"cartridge": "codex", "params": {"leaves": leaves, "width": width,
                                                            "height": height}})


def leporello(panels: int = 8, width: float = 100.0, height: float = 150.0,
              stock: str = "cardstock-160", sheet_id: str = "leporello",
              label: dict | None = None, title: str = "Leporello",
              meta: dict | None = None) -> Assembly:
    """Accordion book (leporello): one strip of ``panels`` panels, creases alternating valley /
    mountain, folded to a closed stack by its fold program (rigid, flat-foldable)."""
    _count("panels", panels, 120)
    _check(width=width, height=height)
    sheet = Sheet(sheet_id, _rect(panels * width, height), stock=stock, grain_deg=90.0,
                  label=label or {"en": "Leporello", "es": "Libro acordeón",
                                  "fr": "Leporello", "pt": "Livro sanfona"})
    marks = [sheet.crease((k * width, 0), (k * width, height),
                          "valley" if k % 2 else "mountain", 180.0, treatment="score")
             for k in range(1, panels)]
    if not marks:
        raise ValueError("a leporello needs at least two panels")
    step = Step("close", {"en": "Close the book", "es": "Cierra el libro",
                          "fr": "Fermer le livre", "pt": "Fechar o livro"},
                [(m, None) for m in marks], duration_ms=4000)
    return Assembly([sheet], controls=[sequence_control()],
                    sequence=Sequence_([step], mode="kinematic"), title=title,
                    meta=meta or {"cartridge": sheet_id, "params": {"panels": panels,
                                                                    "width": width,
                                                                    "height": height}})


def screenfold_codex(leaves: int = 39, leaf_width: float = 90.0, height: float = 200.0,
                     stock: str = "amate") -> Assembly:
    """Mesoamerican screenfold codex: an amate strip folded accordion-style. The defaults follow
    the Dresden Codex as described in the cited source (about 20 cm high, 39 leaves, about
    3.6–3.7 m unfolded)."""
    return leporello(leaves, leaf_width, height, stock, "screenfold-codex",
                     {"en": "Screenfold codex", "es": "Códice biombo",
                      "fr": "Codex en paravent", "pt": "Códice em biombo"},
                     "Screenfold codex",
                     {"cartridge": "screenfold-codex",
                      "params": {"leaves": leaves, "leaf_width": leaf_width, "height": height,
                                 "proportions_source": DRESDEN_CODEX_SOURCE}})


# ── tunnel book ──────────────────────────────────────────────────────────────


def tunnel_book(frames: int = 3, width: float = 120.0, height: float = 90.0,
                depth: float = 30.0, tab: float = 10.0, margin: float = 15.0) -> Assembly:
    """Tunnel book: two accordion side walls and ``frames`` layered frames (windows cut in all
    but the back scene). Each frame's side tabs fold back 90° and are glued to the walls' inner
    faces; the initial frame is the fully extended tunnel and the fold program collapses the
    walls (per gap: valley, mountain, valley)."""
    _count("frames", frames, 12)
    _check(width=width, height=height, depth=depth, tab=tab, margin=margin)
    if tab >= depth or 2 * margin >= min(width, height):
        raise ValueError("need tab < depth and windows larger than zero")
    length = (frames - 1) * depth + tab
    walls = {
        "wall-left": ({"en": "Left wall", "es": "Pared izquierda", "fr": "Paroi gauche",
                       "pt": "Parede esquerda"}, lambda u: u),
        "wall-right": ({"en": "Right wall", "es": "Pared derecha", "fr": "Paroi droite",
                        "pt": "Parede direita"}, lambda u: length - u),
    }
    sheets: list[Sheet] = []
    collapse = []
    for sid, (label, wall_u) in walls.items():
        w = Sheet(sid, _rect(length, height), stock="cardstock-160", grain_deg=90.0,
                  label=label)
        for k in range(frames - 1):
            a, b = k * depth + tab, (k + 1) * depth
            for pos, kind, ang in ((a, "valley", 90.0), ((a + b) / 2, "mountain", 180.0),
                                   (b, "valley", 90.0)):
                u = wall_u(pos)
                collapse.append(w.crease((u, 0), (u, height), kind, ang, treatment="score"))
        sheets.append(w)
    joins = []
    for k in range(frames):
        f = Sheet(f"frame-{k + 1}", _rect(width + 2 * tab, height), stock="cardstock-250",
                  grain_deg=90.0, label={"en": f"Frame {k + 1}", "es": f"Marco {k + 1}",
                                         "fr": f"Cadre {k + 1}", "pt": f"Moldura {k + 1}"})
        f.crease((tab, 0), (tab, height), "mountain", 90.0, treatment="score")
        f.crease((tab + width, 0), (tab + width, height), "mountain", 90.0, treatment="score")
        if k < frames - 1:
            f.hole(_window(tab + margin, margin, width - 2 * margin, height - 2 * margin))
        i = 0.5
        reg_l = [(i, i), (tab - i, i), (tab - i, height - i), (i, height - i)]
        x0 = tab + width
        reg_r = [(x0 + i, i), (x0 + tab - i, i), (x0 + tab - i, height - i), (x0 + i, height - i)]
        joins.append(glue(f"frame-{k + 1}-left", f, reg_l, "wall-left",
                          (-1, 0, 0, 1, k * depth + tab, 0), "front"))
        joins.append(glue(f"frame-{k + 1}-right", f, reg_r, "wall-right",
                          (-1, 0, 0, 1, length - k * depth + tab + width, 0), "front"))
        sheets.append(f)

    half = width / 2

    def initial(sid: str, uv: tuple[float, float]) -> Vec3:
        u, v = uv
        if sid == "wall-left":
            return (-half, v, -u)
        if sid == "wall-right":
            return (half, v, -length + u)
        k = int(sid.rsplit("-", 1)[1]) - 1
        z = -k * depth
        if u <= tab:
            return (-half, v, z - (tab - u))
        if u >= tab + width:
            return (half, v, z - (u - tab - width))
        return (u - tab - half, v, z)

    step = Step("collapse", {"en": "Collapse the tunnel", "es": "Pliega el túnel",
                             "fr": "Replier le tunnel", "pt": "Recolher o túnel"},
                [(m, None) for m in collapse], duration_ms=3000)
    return Assembly(sheets, joins=joins, controls=[sequence_control()],
                    sequence=Sequence_([step]), initial=initial, title="Tunnel book",
                    meta={"cartridge": "tunnel-book",
                          "params": {"frames": frames, "width": width, "height": height,
                                     "depth": depth}})


def _window(x: float, y: float, w: float, h: float) -> list[tuple[float, float]]:
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


# ── carousel ─────────────────────────────────────────────────────────────────


def carousel(leaves: int = 6, width: float = 100.0, height: float = 140.0,
             stock: str = "cardstock-250") -> Assembly:
    """Carousel (star) book opened 360°: N leaves radiate from a vertical spine, each pinned
    along it; ribbons (string joins) tie the two covers' fore-edges at top and bottom."""
    _count("leaves", leaves, 24)
    if leaves < 3:
        raise ValueError("a carousel needs at least 3 leaves")
    _check(width=width, height=height)
    sheets, joins = [], []
    angles = [360.0 * k / leaves for k in range(leaves)]
    for k in range(leaves):
        s = Sheet(f"leaf-{k + 1}", _rect(width, height), stock=stock, grain_deg=90.0,
                  label={"en": f"Leaf {k + 1}", "es": f"Hoja {k + 1}", "fr": f"Feuillet {k + 1}",
                         "pt": f"Folha {k + 1}"})
        sheets.append(s)
        joins.append(pin(f"leaf-{k + 1}-spine", along=(s, ((0.0, 0.0), (0.0, height)))))

    def place(k: int) -> Callable[[float, float], Vec3]:
        t = math.radians(angles[k])
        return lambda u, v: (u * math.cos(t), v, -u * math.sin(t))

    poses = [place(k) for k in range(leaves)]
    first, last = sheets[0], sheets[-1]
    for name, y in (("top", height - 10.0), ("bottom", 10.0)):
        a, b = poses[0](width - 5.0, y), poses[-1](width - 5.0, y)
        joins.append(string(f"ribbon-{name}", (first, (width - 5.0, y)),
                            (last, (width - 5.0, y)), math.dist(a, b)))
    return Assembly(sheets, joins=joins,
                    initial=lambda sid, uv: poses[int(sid.rsplit("-", 1)[1]) - 1](*uv),
                    title="Carousel book",
                    meta={"cartridge": "carousel", "params": {"leaves": leaves, "width": width,
                                                              "height": height}})


GENERATORS: dict[str, Callable[..., Assembly]] = {
    "leaf": leaf, "codex": codex, "leporello": leporello, "screenfold-codex": screenfold_codex,
    "tunnel-book": tunnel_book, "carousel": carousel,
}
