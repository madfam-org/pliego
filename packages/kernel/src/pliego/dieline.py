"""Dielines: panels and hinges → a die-cut sheet, its fold program and its ``pliego:dieline``.

A dieline is authored as **named panels** (polygons in sheet-local mm) and **hinges** between
them. :meth:`Dieline.build` derives everything else:

- the cut outline is the boundary of the union of the panels (edges shared by two panels
  cancel; T-junctions are split first), so slots and notches come from gaps between panels;
- a shared edge with a hinge becomes a fold line (``score`` treatment by default — a creasing
  rule), named after the hinge (``pliego:edges_name``); a shared edge without a hinge becomes a
  through slit (cut);
- every free outline edge is named after its panel, so interfaces can cite ``glue-flap``,
  ``tuck-flap``…;
- the ``pliego:dieline`` block (spec §5.8, lane P draft): style, inside dimensions, caliper,
  panels with their bleed and safe-area polygons, glue zones, dimension lines and the
  grain/flute arrow — the dieline export profile draws it.

**Conventions.** The sheet's front is the **print side** (the outside of the box). Box folds
are mountain folds (away from the print side), and the sheet is placed print side down
(rotated 180° about the world X axis), so panels fold *up* off the table, as a box is folded by
hand. One panel (`rest_on`) stays on the table: the studio's preview poses the face tree from the
sheet's first face, so when that face is not in the resting panel the initial frame pre-folds
the hinges on the path between them to their final angles (the program then forms the rest).

**Fold programs** are kinematic: no hinge meets another inside the sheet (flaps are separated by
slots or slits), so every dieline here is a face tree — rigidly foldable, with nothing for the
motion solver to close. Glue joins (the manufacturer's joint, glued crash-lock triangles) are
fabrication data here; welding them is the physics engine's job.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from .assembly import Step
from .geometry import Vec2, polygon_area, polygon_centroid
from .sheet import Mark, Placement, Sheet, check_slug, i18n

TOL = 1e-6                     # mm, vertex matching
PRINT_SIDE_DOWN = Placement(rotation=(1.0, 0.0, 0.0, 0.0))   # 180° about world X
PANEL_KINDS = ("panel", "flap", "dust-flap", "tuck", "lid", "glue-flap", "lock", "bottom",
               "pocket", "window-frame")
GLUE_KINDS = ("glue", "gum", "peel-and-seal", "tape", "hot-melt")

Pt = tuple[float, float]


def _key(p: Pt) -> tuple[int, int]:
    return (round(p[0] / TOL), round(p[1] / TOL))


def _ccw(poly: Sequence[Pt]) -> list[Pt]:
    pts = [(float(x), float(y)) for x, y in poly]
    area = polygon_area([Vec2(x, y) for x, y in pts])
    if abs(area) < 1e-9:
        raise ValueError("panel polygon has zero area")
    return pts if area > 0 else pts[::-1]


@dataclass
class Panel:
    name: str
    polygon: list[Pt]
    kind: str
    label: dict
    print: bool = True


@dataclass
class Hinge:
    a: str
    b: str
    angle: float               # signed fold angle at the end of the program (mountain < 0)
    name: str
    treatment: str = "score"
    driven: bool = True        # False: a fold line the erecting program leaves flat


@dataclass
class Packed:
    """A built dieline: the sheet, its hinge marks and final angles, the program steps, the
    initial pose spec, the closed target pose and the ``pliego:dieline`` block."""

    sheet: Sheet
    marks: dict[str, list[Mark]]
    final: dict[str, float]
    steps: list[Step]
    initial: dict
    closed: dict
    block: dict
    panels: dict[str, Panel] = field(default_factory=dict)

    def final_angles(self) -> dict[Mark, float]:
        return {m: self.final[h] for h, ms in self.marks.items() for m in ms}


def assemble(packs: Sequence[Packed], *, title: str | None = None, meta: dict | None = None,
             finishes: Sequence[dict] = (), artwork: Sequence[dict] = (),
             label: dict | None = None) -> Any:
    """One `Assembly` from built dielines: their sheets, one kinematic fold program (the steps
    of each dieline in turn, ids prefixed by the sheet when there are several), the initial
    poses, a ``target:closed`` frame and the ``pliego:dielines`` blocks."""
    from .assembly import Assembly, sequence_control
    from .assembly import Sequence as Seq_

    several = len(packs) > 1
    steps: list[Step] = []
    initial: dict = {}
    closed: dict = {}
    for p in packs:
        initial.update(p.initial)
        closed.update(p.closed)
        for st in p.steps:
            sid = f"{p.sheet.id}-{st.id}" if several else st.id
            steps.append(Step(sid, st.label, list(st.targets), list(st.release),
                              st.duration_ms, st.note))
    control = sequence_control(label=label or {"en": "Fold program",
                                               "es": "Secuencia de pliegues",
                                               "fr": "Séquence de pliage",
                                               "pt": "Sequência de dobras"})
    return Assembly([p.sheet for p in packs], controls=[control],
                    sequence=Seq_(steps, mode="kinematic"), initial=initial,
                    targets={"closed": closed}, title=title, meta=dict(meta or {}),
                    dielines=[p.block for p in packs], finishes=list(finishes),
                    artwork=list(artwork))


class Dieline:
    """Collect panels, hinges, glue zones and dimensions; :meth:`build` makes the sheet."""

    def __init__(self, sheet_id: str, style: str, family: str, inside: dict[str, float],
                 stock: str, caliper: float, *, label: Any = None, bleed: float = 3.0,
                 safe: float = 3.0, grain_deg: float = 90.0, front: Any = None,
                 back: Any = None) -> None:
        self.sheet_id = check_slug(sheet_id, "sheet id")
        self.style, self.family = style, family
        self.inside = {k: float(v) for k, v in inside.items()}
        self.stock, self.caliper = stock, float(caliper)
        self.label = label
        self.bleed, self.safe = float(bleed), float(safe)
        self.grain_deg = float(grain_deg)
        self.front, self.back = front, back
        self.panels: dict[str, Panel] = {}
        self.hinges: list[Hinge] = []
        self.glue: list[dict] = []
        self.dimensions: list[dict] = []
        self.holes: list[list[Pt]] = []
        self.perforations: list[tuple[Pt, Pt, str]] = []
        self.halfcuts: list[tuple[list[Pt], str]] = []
        self.program: list[tuple[str, dict, list[str], int]] = []

    # ── authoring ───────────────────────────────────────────────────────────

    def panel(self, name: str, polygon: Sequence[Pt], kind: str = "panel", label: Any = None,
              print_area: bool = True) -> str:
        check_slug(name, "panel name")
        if name in self.panels:
            raise ValueError(f"duplicate panel {name!r}")
        if kind not in PANEL_KINDS:
            raise ValueError(f"panel kind {kind!r} not in {PANEL_KINDS}")
        self.panels[name] = Panel(name, _ccw(polygon), kind, i18n(label, name), print_area)
        return name

    def rect(self, name: str, x0: float, y0: float, x1: float, y1: float, kind: str = "panel",
             label: Any = None, print_area: bool = True) -> str:
        if not (x1 - x0 > TOL and y1 - y0 > TOL):
            raise ValueError(f"panel {name!r}: empty rectangle")
        return self.panel(name, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], kind, label,
                          print_area)

    def hinge(self, a: str, b: str, angle: float = -90.0, name: str | None = None,
              treatment: str = "score", driven: bool = True) -> str:
        for p in (a, b):
            if p not in self.panels:
                raise ValueError(f"hinge: unknown panel {p!r}")
        h = Hinge(a, b, float(angle), check_slug(name or f"{a}-to-{b}", "hinge name"),
                  treatment, driven)
        self.hinges.append(h)
        return h.name

    def glue_zone(self, id: str, polygon: Sequence[Pt], kind: str = "glue",
                  on: str | None = None) -> None:
        if kind not in GLUE_KINDS:
            raise ValueError(f"glue kind {kind!r} not in {GLUE_KINDS}")
        z = {"id": check_slug(id, "glue zone id"), "kind": kind,
             "polygon": [[float(x), float(y)] for x, y in _ccw(polygon)]}
        if on is not None:
            z["panel"] = on
        self.glue.append(z)

    def dimension(self, a: Pt, b: Pt, text: str, offset: float = 8.0) -> None:
        self.dimensions.append({"from": [float(a[0]), float(a[1])],
                                "to": [float(b[0]), float(b[1])], "offset": float(offset),
                                "text": str(text)})

    def hole(self, polygon: Sequence[Pt]) -> None:
        self.holes.append([(float(x), float(y)) for x, y in polygon])

    def perforate(self, a: Pt, b: Pt, name: str) -> None:
        self.perforations.append((a, b, check_slug(name, "perforation name")))

    def halfcut(self, points: Sequence[Pt], name: str) -> None:
        self.halfcuts.append(([(float(x), float(y)) for x, y in points],
                              check_slug(name, "half-cut name")))

    def step(self, id: str, label: dict, hinges: Sequence[str], duration_ms: int = 1200) -> None:
        self.program.append((check_slug(id, "step id"), label, list(hinges), duration_ms))

    # ── geometry ────────────────────────────────────────────────────────────

    def _split_edges(self) -> list[tuple[str, Pt, Pt]]:
        """Every panel edge, split at every other panel vertex lying inside it."""
        verts = {_key(p): p for pn in self.panels.values() for p in pn.polygon}
        out = []
        for pn in self.panels.values():
            ring = pn.polygon
            for i, a in enumerate(ring):
                b = ring[(i + 1) % len(ring)]
                dx, dy = b[0] - a[0], b[1] - a[1]
                ln2 = dx * dx + dy * dy
                cuts = []
                for v in verts.values():
                    t = ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / ln2
                    if TOL < t * math.sqrt(ln2) < math.sqrt(ln2) - TOL:
                        off = abs((v[0] - a[0]) * dy - (v[1] - a[1]) * dx) / math.sqrt(ln2)
                        if off < TOL:
                            cuts.append((t, v))
                pts = [a] + [v for _, v in sorted(cuts)] + [b]
                out += [(pn.name, p, q) for p, q in zip(pts, pts[1:], strict=False)]
        return out

    def _outline_and_shared(self) -> tuple[list[Pt], dict[frozenset, list[tuple[Pt, Pt]]],
                                           list[tuple[str, Pt, Pt]]]:
        edges = self._split_edges()
        directed: dict[tuple, tuple[str, Pt, Pt]] = {}
        for name, p, q in edges:
            k = (_key(p), _key(q))
            if k in directed:
                raise ValueError(f"panels {directed[k][0]!r} and {name!r} overlap along an edge")
            directed[k] = (name, p, q)
        shared: dict[frozenset, list[tuple[Pt, Pt]]] = {}
        free: list[tuple[str, Pt, Pt]] = []
        for (ka, kb), (name, p, q) in directed.items():
            twin = directed.get((kb, ka))
            if twin is None:
                free.append((name, p, q))
            elif ka < kb:
                shared.setdefault(frozenset((name, twin[0])), []).append((p, q))
        nxt = {_key(p): (p, q) for _, p, q in free}
        if len(nxt) != len(free):
            raise ValueError("the panels' union is not a single simple outline (pinch point)")
        loops, seen = [], set()
        for _, p0, _q in free:
            if _key(p0) in seen:
                continue
            loop, cur = [], p0
            while _key(cur) not in seen:
                seen.add(_key(cur))
                loop.append(cur)
                cur = nxt[_key(cur)][1]
            loops.append(_drop_collinear(loop))
        areas = [polygon_area([Vec2(x, y) for x, y in lp]) for lp in loops]
        outer = max(range(len(loops)), key=lambda i: areas[i])
        if sum(1 for a in areas if a > 0) != 1:
            raise ValueError("the panels' union is not one connected piece")
        self._union_holes = [lp for i, lp in enumerate(loops) if i != outer]
        return loops[outer], shared, free

    def build(self, rest_on: str) -> Packed:
        if rest_on not in self.panels:
            raise ValueError(f"rest_on: unknown panel {rest_on!r}")
        outline, shared, free = self._outline_and_shared()
        sheet = Sheet(self.sheet_id, outline, stock=self.stock, grain_deg=self.grain_deg,
                      label=self.label, front=self.front, back=self.back,
                      placement=PRINT_SIDE_DOWN)
        for h in self._union_holes + self.holes:
            sheet.hole(h)
        marks: dict[str, list[Mark]] = {}
        final: dict[str, float] = {}
        hinged = set()
        for h in self.hinges:
            pair = frozenset((h.a, h.b))
            segs = shared.get(pair)
            if not segs:
                raise ValueError(f"hinge {h.name!r}: panels {h.a!r} and {h.b!r} share no edge")
            hinged.add(pair)
            kind = "mountain" if h.angle < 0 else "valley"
            marks[h.name] = [sheet.crease(p, q, kind, abs(h.angle), h.treatment, name=h.name)
                             for p, q in _merge_segments(segs)]
            final[h.name] = h.angle if h.driven else 0.0
        for pair, segs in shared.items():
            if pair not in hinged:
                a, b = sorted(pair)
                for p, q in _merge_segments(segs):
                    sheet.cut([p, q], name=f"slit-{a}"[:80])
        for a, b, name in self.perforations:
            sheet.perforate(a, b, "flat", name=name)
        for pts, name in self.halfcuts:
            sheet.halfcut(pts, name=name)
        named = set()
        for pname, p, q in free:
            sheet.label_edge(pname, p, q)
            named.add(pname)
        steps = self._steps(marks, final)
        arr = sheet.build()
        rest_pt = _interior_point(self.panels[rest_on].polygon, self._union_holes + self.holes)
        prefold = self._prefold(sheet, arr, marks, final, rest_pt)
        initial = {self.sheet_id: {"angles": prefold, "root": rest_pt}}
        closed = {self.sheet_id: {"angles": {m: final[h] for h, ms in marks.items()
                                             for m in ms}, "root": rest_pt}}
        return Packed(sheet, marks, final, steps, initial, closed, self._block(), self.panels)

    def _steps(self, marks: dict[str, list[Mark]], final: dict[str, float]) -> list[Step]:
        out, done = [], set()
        for sid, label, hinges, ms in self.program:
            targets = []
            for h in hinges:
                if h not in marks:
                    raise ValueError(f"step {sid!r}: unknown hinge {h!r}")
                targets += [(m, final[h]) for m in marks[h]]
                done.add(h)
            out.append(Step(sid, label, targets, duration_ms=ms))
        driven = {h.name for h in self.hinges if h.driven}
        missing = [h for h in marks if h not in done and h in driven]
        if self.program and missing:
            raise ValueError(f"the fold program never folds hinges {missing}")
        return out

    def _prefold(self, sheet: Sheet, arr: Any, marks: dict[str, list[Mark]],
                 final: dict[str, float], rest: Pt) -> dict[Mark, float]:
        """Final angles of the hinges on the face-tree path from the sheet's first face (the
        preview's root) to the resting panel; {} when the first face lies in that panel."""
        from .kinematics import face_adjacency, root_face

        target = root_face(arr, Vec2(*rest))
        if target == 0:
            return {}
        edge_mark: dict[int, Mark] = {}
        for ms in marks.values():
            for m in ms:
                for e in m.edges():
                    edge_mark[e] = m
        adj = {f: [(g, e) for g, e, _a, _b in nb] for f, nb in face_adjacency(arr).items()}
        prev: dict[int, tuple[int, int] | None] = {0: None}
        queue = [0]
        while queue:
            f = queue.pop(0)
            for g, e in adj.get(f, []):
                if g not in prev:
                    prev[g] = (f, e)
                    queue.append(g)
        if target not in prev:
            raise ValueError("rest_on panel is not connected to the sheet's first face")
        out: dict[Mark, float] = {}
        f = target
        while prev[f] is not None:
            g, e = prev[f]                       # type: ignore[misc]
            if e in edge_mark:
                m = edge_mark[e]
                out[m] = next(final[h] for h, ms in marks.items() if m in ms)
            f = g
        return out

    def _block(self) -> dict:
        panels = []
        for p in self.panels.values():
            entry: dict[str, Any] = {"name": p.name, "kind": p.kind, "label": dict(p.label),
                                     "polygon": [[x, y] for x, y in p.polygon],
                                     "print": p.print}
            if p.print:
                entry["safe"] = _offset(p.polygon, -self.safe)
                entry["bleed"] = _offset(p.polygon, self.bleed, self._cut_edges(p))
            panels.append(entry)
        return {"style": self.style, "family": self.family, "sheet": self.sheet_id,
                "inside": dict(self.inside), "caliper_mm": self.caliper,
                "bleed_mm": self.bleed, "safe_mm": self.safe, "panels": panels,
                "glue": [dict(g) for g in self.glue], "dimensions": list(self.dimensions),
                "grain": self._grain()}

    def _cut_edges(self, p: Panel) -> list[bool]:
        """Per edge of a panel: True when the edge is (at least partly) a free cut edge."""
        free = {(_key(a), _key(b)) for name, a, b in self._split_edges_free() if name == p.name}
        out = []
        ring = p.polygon
        for i, a in enumerate(ring):
            b = ring[(i + 1) % len(ring)]
            out.append(any(_on_segment(fa, a, b) and _on_segment(fb, a, b) for fa, fb in free))
        return out

    def _split_edges_free(self) -> list[tuple[str, Pt, Pt]]:
        if not hasattr(self, "_free_cache"):
            self._free_cache = self._outline_and_shared()[2]
        return self._free_cache

    def _grain(self) -> dict:
        xs = [x for p in self.panels.values() for x, _ in p.polygon]
        ys = [y for p in self.panels.values() for _, y in p.polygon]
        kind = "flute" if self.family == "corrugated" else "grain"
        # flutes run across the machine direction: the flute axis is grain + 90°
        angle = (self.grain_deg + 90.0) % 360.0 if kind == "flute" else self.grain_deg
        return {"kind": kind, "angle_deg": angle,
                "at": [min(xs) + 0.5 * (max(xs) - min(xs)), min(ys) - 12.0]}


def _on_segment(k: tuple[int, int], a: Pt, b: Pt) -> bool:
    p = (k[0] * TOL, k[1] * TOL)
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy)
    if abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / ln > 10 * TOL:
        return False
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (ln * ln)
    return -1e-9 <= t <= 1 + 1e-9


def mitre_offset(poly: Sequence[Pt], dists: Sequence[float]) -> list[Pt]:
    """Offset a CCW ring with per-edge distances (positive = outward, negative = inward),
    mitred at every vertex (parallel neighbours keep the shifted vertex). Exact for convex
    panels; check deep concave corners by eye."""
    n = len(poly)
    lines = []
    for i in range(n):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % n]
        ln = math.hypot(bx - ax, by - ay)
        nx, ny = (by - ay) / ln, -(bx - ax) / ln            # outward normal of a CCW ring
        lines.append(((ax + nx * dists[i], ay + ny * dists[i]), (bx - ax, by - ay)))
    out = []
    for i in range(n):
        (p, r), (q, s_) = lines[i - 1], lines[i]
        den = r[0] * s_[1] - r[1] * s_[0]
        if abs(den) < 1e-12:
            out.append(q)
            continue
        t = ((q[0] - p[0]) * s_[1] - (q[1] - p[1]) * s_[0]) / den
        out.append((p[0] + t * r[0], p[1] + t * r[1]))
    return out


def _offset(poly: list[Pt], d: float, which: list[bool] | None = None) -> list[list[float]]:
    dists = [d if (which is None or which[i]) else 0.0 for i in range(len(poly))]
    return [[round(x, 6), round(y, 6)] for x, y in mitre_offset(_ccw(poly), dists)]


def _interior_point(poly: list[Pt], holes: Sequence[Sequence[Pt]] = ()) -> Pt:
    """A point well inside a (convex-ish) panel and outside every hole: the centroid, else an
    edge midpoint moved 1 mm inward."""
    from .geometry import point_in_polygon

    c = polygon_centroid([Vec2(x, y) for x, y in poly])
    cands = [(c.x, c.y)]
    n = len(poly)
    for i, a in enumerate(poly):
        b = poly[(i + 1) % n]
        ln = math.hypot(b[0] - a[0], b[1] - a[1])
        if ln > 2.0:
            cands.append(((a[0] + b[0]) / 2 - (b[1] - a[1]) / ln, (a[1] + b[1]) / 2
                          + (b[0] - a[0]) / ln))
    ring = [Vec2(x, y) for x, y in poly]
    for q in cands:
        v = Vec2(*q)
        if point_in_polygon(v, ring) == 1 and all(
                point_in_polygon(v, [Vec2(x, y) for x, y in h]) == -1 for h in holes):
            return q
    raise ValueError("no interior point found for the resting panel")


def _drop_collinear(loop: list[Pt]) -> list[Pt]:
    out = []
    n = len(loop)
    for i, p in enumerate(loop):
        a, b = loop[i - 1], loop[(i + 1) % n]
        cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])
        if abs(cross) > 1e-9:
            out.append(p)
    return out


def _merge_segments(segs: list[tuple[Pt, Pt]]) -> list[tuple[Pt, Pt]]:
    """Join collinear touching sub-segments of one shared edge into maximal segments."""
    pending = [(p, q) for p, q in segs]
    out: list[tuple[Pt, Pt]] = []
    while pending:
        p, q = pending.pop(0)
        grown = True
        while grown:
            grown = False
            for k, (a, b) in enumerate(pending):
                for s, t in ((a, b), (b, a)):
                    if _key(s) == _key(q) and _collinear(p, q, t):
                        q = t
                    elif _key(t) == _key(p) and _collinear(s, p, q):
                        p = s
                    else:
                        continue
                    pending.pop(k)
                    grown = True
                    break
                if grown:
                    break
        out.append((p, q))
    return out


def _collinear(a: Pt, b: Pt, c: Pt) -> bool:
    return abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-9
