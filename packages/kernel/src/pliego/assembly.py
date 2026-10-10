"""`Assembly` — sheets + joins + mechanisms + controls + fold program (spec §5.3–§5.6).

Builders return plain dicts in the document's own shape (sheet references may be `Sheet` objects
or ids; they are normalised to ids). `Assembly.build()` lays the sheets out side by side, runs
each sheet's planar subdivision and writes a `Document`.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from collections.abc import Sequence as Seq
from dataclasses import dataclass, field
from typing import Any

from .geometry import PointLike, as_vec
from .sheet import Label, Mark, Sheet, check_slug, i18n

SheetRef = Sheet | str
SheetPoint = tuple[SheetRef, PointLike]
CONTROL_KINDS = ("angle", "distance", "sequence", "wind", "toggle")
LAYOUT_GAP_MM = 10.0


def _sid(ref: SheetRef) -> str:
    if isinstance(ref, Sheet):
        return ref.id
    return check_slug(ref, "sheet reference")


def _pt(p: PointLike) -> list[float]:
    v = as_vec(p)
    return [v.x, v.y]


def _v3(p: Seq[float], what: str) -> list[float]:
    if len(p) != 3 or not all(math.isfinite(float(c)) for c in p):
        raise ValueError(f"{what} must be a finite 3-D vector, got {p!r}")
    return [float(c) for c in p]


def _spoint(sp: SheetPoint) -> dict:
    sheet, at = sp
    return {"sheet": _sid(sheet), "at": _pt(at)}


# ── joins (§5.3) ─────────────────────────────────────────────────────────────


def glue(id: str, a: SheetRef, region: Seq[PointLike], b: SheetRef,
         map: Seq[float] = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0), side: str = "front") -> dict:
    """Weld `region` of sheet a onto sheet b at M·(u, v) + t (map = [a, b, c, d, tx, ty])."""
    if len(region) < 3:
        raise ValueError(f"glue '{id}': region needs at least 3 points")
    if len(map) != 6:
        raise ValueError(f"glue '{id}': map needs 6 numbers [a, b, c, d, tx, ty]")
    if side not in ("front", "back"):
        raise ValueError(f"glue '{id}': side must be front or back")
    return {"id": check_slug(id, "join id"), "type": "glue",
            "a": {"sheet": _sid(a), "region": [_pt(p) for p in region]},
            "b": {"sheet": _sid(b)}, "map": [float(x) for x in map], "side": side}


def pivot(id: str, a: SheetPoint, b: SheetPoint, hardware_ref: dict | None = None) -> dict:
    """Two sheet points coincide with free rotation (a brad / split pin)."""
    j = {"id": check_slug(id, "join id"), "type": "pivot", "a": _spoint(a), "b": _spoint(b)}
    if hardware_ref is not None:
        if hardware_ref.get("platform") != "yantra4d" or "project_slug" not in hardware_ref:
            raise ValueError(f"pivot '{id}': hardware_ref needs platform 'yantra4d' and "
                             "project_slug (bridge contract)")
        j["hardware_ref"] = dict(hardware_ref)
    return j


def string(id: str, a: SheetPoint, b: SheetPoint | Seq[float], length: float) -> dict:
    """Unilateral distance ≤ length between a sheet point and a sheet point or world point."""
    if not length > 0:
        raise ValueError(f"string '{id}': length must be positive")
    if isinstance(b, tuple) and len(b) == 2 and isinstance(b[0], Sheet | str):
        bb: dict = _spoint(b)  # type: ignore[arg-type]
    else:
        bb = {"world": _v3(b, f"string '{id}' world point")}  # type: ignore[arg-type]
    return {"id": check_slug(id, "join id"), "type": "string", "a": _spoint(a), "b": bb,
            "length": float(length)}


def pin(id: str, a: SheetPoint | None = None, *, along: tuple[SheetRef, Seq[PointLike]]
        | None = None, world: Seq[float] | None = None,
        mechanism: str | None = None) -> dict:
    """Fix a sheet point (or a segment `along`) in the world; `world=None` = where it starts.
    With `mechanism` naming a `translate` driver the pinned points move with it."""
    if (a is None) == (along is None):
        raise ValueError(f"pin '{id}': give exactly one of a=(sheet, at) or along=(sheet, [p, q])")
    if a is not None:
        aa = _spoint(a)
    else:
        sheet, seg = along  # type: ignore[misc]
        if len(seg) != 2:
            raise ValueError(f"pin '{id}': along needs two points")
        aa = {"sheet": _sid(sheet), "along": [_pt(seg[0]), _pt(seg[1])]}
    j = {"id": check_slug(id, "join id"), "type": "pin", "a": aa,
         "world": None if world is None else _v3(world, f"pin '{id}' world")}
    if mechanism is not None:
        j["mechanism"] = check_slug(mechanism, "mechanism reference")
    return j


def slider(id: str, a: SheetPoint, track: tuple[SheetRef, PointLike, PointLike],
           mechanism: str | None = None) -> dict:
    """A point constrained to a track segment; driven along it by a `slide` mechanism."""
    sheet, p, q = track
    j = {"id": check_slug(id, "join id"), "type": "slider", "a": _spoint(a),
         "track": {"sheet": _sid(sheet), "from": _pt(p), "to": _pt(q)}}
    if mechanism is not None:
        j["mechanism"] = check_slug(mechanism, "mechanism reference")
    return j


# ── mechanisms (§5.4) ────────────────────────────────────────────────────────


def hinge(id: str, origin: Seq[float], direction: Seq[float], angle_control: str,
          sheets_moving: Seq[SheetRef], rest: float = 0.0) -> dict:
    """Rigid rotation of kinematic sheets about a world axis by the control value − rest."""
    if not sheets_moving:
        raise ValueError(f"hinge '{id}': sheets_moving must not be empty")
    return {"id": check_slug(id, "mechanism id"), "type": "hinge",
            "axis": {"origin": _v3(origin, "hinge origin"),
                     "direction": _v3(direction, "hinge direction")},
            "angle_control": check_slug(angle_control, "control reference"),
            "rest": float(rest), "sheets_moving": [_sid(s) for s in sheets_moving]}


def slide(id: str, control: str, travel: float) -> dict:
    """Drives the `slider` joins that reference it from 0 to `travel` mm."""
    if not travel > 0:
        raise ValueError(f"slide '{id}': travel must be positive")
    return {"id": check_slug(id, "mechanism id"), "type": "slide",
            "control": check_slug(control, "control reference"), "travel": float(travel)}


def rotate(id: str, center: SheetPoint, control: str, sheets_moving: Seq[SheetRef]) -> dict:
    """Rotates kinematic sheets about a pivot normal (volvelles, wheels)."""
    if not sheets_moving:
        raise ValueError(f"rotate '{id}': sheets_moving must not be empty")
    return {"id": check_slug(id, "mechanism id"), "type": "rotate", "center": _spoint(center),
            "control": check_slug(control, "control reference"),
            "sheets_moving": [_sid(s) for s in sheets_moving]}


def leaf(id: str, sheet: SheetRef, spine: tuple[PointLike, PointLike], control: str) -> dict:
    """A book leaf hinged at its spine edge; the control (0…180) drives a page turn."""
    return {"id": check_slug(id, "mechanism id"), "type": "leaf", "sheet": _sid(sheet),
            "spine": [_pt(spine[0]), _pt(spine[1])],
            "control": check_slug(control, "control reference")}


def translate(id: str, control: str, direction: Seq[float], travel: float,
              sheets_moving: Seq[SheetRef] | None = None) -> dict:
    """Moves kinematic sheets and every `pin` naming it along `direction` by control/max·travel."""
    if not travel > 0:
        raise ValueError(f"translate '{id}': travel must be positive")
    d = _v3(direction, "translate direction")
    if math.hypot(*d) < 1e-12:
        raise ValueError(f"translate '{id}': direction must be non-zero")
    m = {"id": check_slug(id, "mechanism id"), "type": "translate",
         "control": check_slug(control, "control reference"), "direction": d,
         "travel": float(travel)}
    if sheets_moving:
        m["sheets_moving"] = [_sid(s) for s in sheets_moving]
    return m


# ── controls (§5.5) ──────────────────────────────────────────────────────────

SEQUENCE_LABEL = {"en": "Fold", "es": "Doblar", "fr": "Plier", "pt": "Dobrar"}


def control(id: str, kind: str, label: str | dict, default: float | bool,
            min: float | None = None, max: float | None = None, unit: str | None = None) -> dict:
    """A viewer control (angle | distance | sequence | wind | toggle)."""
    if kind not in CONTROL_KINDS:
        raise ValueError(f"control '{id}': kind must be one of {CONTROL_KINDS}")
    c: dict[str, Any] = {"id": check_slug(id, "control id"), "kind": kind,
                         "label": i18n(label, id), "default": default}
    if min is not None:
        c["min"] = float(min)
    if max is not None:
        c["max"] = float(max)
    if unit is not None:
        c["unit"] = unit
    if min is not None and max is not None and min > max:
        raise ValueError(f"control '{id}': min > max")
    return c


def angle_control(id: str, label: str | dict, default: float = 180.0, min: float = 0.0,
                  max: float = 180.0) -> dict:
    return control(id, "angle", label, default, min, max, "deg")


def sequence_control(id: str = "sequence", label: str | dict | None = None,
                     default: float = 0.0) -> dict:
    """The fold-program clock; `max` is filled with the step count at build time."""
    c = control(id, "sequence", label or SEQUENCE_LABEL, default, 0.0, None, "step")
    c["max"] = None  # resolved by Assembly.build
    return c


# ── sequence (§5.6) ──────────────────────────────────────────────────────────


@dataclass(frozen=True, eq=False)
class EdgeRef:
    """One sheet-local edge of a sheet (a single edge of a mark, by its local index) as a step
    target; resolved to the document's global edge index at build time."""

    sheet: Sheet
    edge: int

    def __hash__(self) -> int:
        return hash((id(self.sheet), self.edge))

    def __eq__(self, other: object) -> bool:
        return (isinstance(other, EdgeRef) and other.sheet is self.sheet
                and other.edge == self.edge)


Target = Mark | EdgeRef | int


@dataclass
class Step:
    """One fold-program step. Targets are (mark | global edge index, angle | None) pairs; a
    `None` angle uses the mark's own fold angle. Releases hand hinges back to the paper.
    `remove` takes excess pieces (ids or `pliego.piece` dicts) out of the model (spec §5.8)."""

    id: str
    label: str | dict
    targets: list[tuple[Target, float | None]] = field(default_factory=list)
    release: list[Target] = field(default_factory=list)
    duration_ms: int = 1500
    note: str | dict | None = None
    remove: list[str | dict] = field(default_factory=list)

    def __post_init__(self) -> None:
        check_slug(self.id, "step id")
        self.label = i18n(self.label, self.id)
        if not 100 <= int(self.duration_ms) <= 60000:
            raise ValueError(f"step '{self.id}': duration_ms must be in [100, 60000]")
        self.duration_ms = int(self.duration_ms)
        self.targets = [(t, None) if isinstance(t, Mark | EdgeRef | int) else (t[0], t[1])
                        for t in self.targets]  # type: ignore[misc]
        if self.note is not None:
            self.note = i18n(self.note, self.id)
        self.remove = [check_slug(r["id"] if isinstance(r, dict) else r, "removed piece")
                       for r in self.remove]


@dataclass
class Sequence_:
    """The fold program: `mode` physical | kinematic, ordered steps (or `fold_each()`)."""

    steps: list[Step] = field(default_factory=list)
    mode: str = "physical"
    auto: bool = False
    auto_duration_ms: int = 1500
    report: dict = field(default_factory=dict, repr=False, compare=False)

    def __post_init__(self) -> None:
        if self.mode not in ("physical", "kinematic"):
            raise ValueError("sequence mode must be physical or kinematic")
        ids = [s.id for s in self.steps]
        if len(set(ids)) != len(ids):
            raise ValueError(f"duplicate step ids in {ids}")

    @classmethod
    def fold_each(cls, mode: str = "physical", duration_ms: int = 1500) -> Sequence_:
        """One step per folding mark (M/V), in authored order across sheets."""
        return cls([], mode, auto=True, auto_duration_ms=duration_ms)

    @classmethod
    def kinematic_path(cls, system: Any, steps: Seq[Step], *, start: Any = None,
                       substeps: int | dict[str, int] = 8) -> Sequence_:
        """A `kinematic` program whose in-between states are exact rigid states.

        `steps` are key poses written as ordinary `Step`s (targets = the creases the step moves;
        spec §5.6: unlisted creases hold, `release` frees a crease). Each is expanded into
        `substeps` steps (an int, or a dict step id → count) solved with
        `pliego.kinematics.solve(..., along="chord")`: the listed creases advance evenly along
        the chord from the current state to their targets while closure holds, and must arrive
        at their targets (fail loud otherwise). The program starts from `start`
        (angles {mark | edge: deg}, or an initial-pose spec {"angles": …}) — pass the initial
        frame's angles when the assembly has one — else from flat. `system` is the `Sheet`
        (or a single-sheet `Document`). ``.report`` holds DOF and the worst residual."""
        from .program import kinematic_steps

        out, report = kinematic_steps(system, list(steps), start, substeps)
        seq = cls(out, mode="kinematic")
        seq.report = report
        return seq

    def resolve(self, sheets: Seq[Sheet]) -> list[Step]:
        if not self.auto:
            return list(self.steps)
        steps: list[Step] = []
        for sheet in sheets:
            for m in sheet.marks:
                if m.assignment not in ("M", "V") or not m.edges():
                    continue
                n = len(steps) + 1
                kind = {"V": ("Valley-fold", "Dobla en valle", "Pli vallée", "Dobra em vale"),
                        "M": ("Mountain-fold", "Dobla en monte", "Pli montagne",
                              "Dobra em montanha")}[m.assignment]
                label = m.label or {"en": f"{kind[0]} line {n}", "es": f"{kind[1]} la línea {n}",
                                    "fr": f"{kind[2]} ligne {n}", "pt": f"{kind[3]} a linha {n}"}
                steps.append(Step(f"step-{n}", label, [(m, None)],
                                  duration_ms=self.auto_duration_ms))
        return steps


Sequence = Sequence_  # public name (pliego.Sequence)


# ── assembly ─────────────────────────────────────────────────────────────────

InitialSpec = Callable[[str, tuple[float, float]], Seq[float]] | dict | str | None


@dataclass
class Assembly:
    """Sheets plus joins, mechanisms, controls, fold program and initial frame.

    `layout`: "row" (side by side left to right, 10 mm gap, bottoms aligned) or a dict
    sheet id → (x, y) layout offset. `initial`: None (computed when the spec requires it: joins,
    placements), "flat", a dict sheet id → {"angles": {mark: deg}, "root": (u, v)} (face-tree
    pose, `pliego.kinematics`), or a callable (sheet_id, (u, v)) → world (x, y, z).
    `min_feature_mm`: the smallest intended feature (spec §5.7) — written to
    ``pliego:meta.min_feature_mm``; `verify()` then floors face areas at its square.
    `pieces` / `stacks`: removable pieces and sheet stacks (`pliego.piece`, `pliego.stack`;
    spec §5.8), written to ``pliego:pieces`` / ``pliego:stacks``.
    """

    sheets: list[Sheet]
    joins: list[dict] = field(default_factory=list)
    mechanisms: list[dict] = field(default_factory=list)
    controls: list[dict] = field(default_factory=list)
    sequence: Sequence_ | None = None
    initial: InitialSpec = None
    layout: str | dict[str, PointLike] = "row"
    title: str | None = None
    meta: dict = field(default_factory=dict)
    targets: dict[str, InitialSpec] = field(default_factory=dict)
    min_feature_mm: float | None = None
    pieces: list[dict] = field(default_factory=list)
    stacks: list[dict] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.min_feature_mm is not None:
            mf = float(self.min_feature_mm)
            if not (math.isfinite(mf) and mf > 0):
                raise ValueError(f"min_feature_mm must be > 0, got {self.min_feature_mm!r}")
            self.min_feature_mm = mf
        if isinstance(self.sheets, Sheet):
            self.sheets = [self.sheets]
        self.sheets = list(self.sheets)
        if not self.sheets:
            raise ValueError("an assembly needs at least one sheet")
        ids = [s.id for s in self.sheets]
        if len(set(ids)) != len(ids):
            raise ValueError(f"duplicate sheet ids {ids}")
        for group, what in ((self.joins, "join"), (self.mechanisms, "mechanism"),
                            (self.controls, "control"), (self.pieces, "piece"),
                            (self.stacks, "stack")):
            gids = [x["id"] for x in group]
            if len(set(gids)) != len(gids):
                raise ValueError(f"duplicate {what} ids {gids}")

    def sheet(self, id: str) -> Sheet:
        for s in self.sheets:
            if s.id == id:
                return s
        raise KeyError(f"assembly has no sheet '{id}'")

    def build(self, stocks: dict[str, dict] | None = None, **meta: Any):
        """Write the sheet document (see `pliego.document_build.build_document`)."""
        from .document_build import build_document

        return build_document(self, stocks=stocks, meta_overrides=meta)


def label_text(value: Label | None) -> str:
    return "" if value is None else value.get("en", "")
