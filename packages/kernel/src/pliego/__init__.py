"""Pliego kernel — sheet hyperobjects: crease patterns, cuts, assemblies and fold programs.

Pure standard library. Units mm / degrees, sheet-local frames y-up, world frame Y-up.
Writes sheet documents (FOLD 1.2 + ``pliego:``; docs/spec/v1/sheet-document.md).
"""

from __future__ import annotations

from .arrangement import Arrangement, ArrangementError, SegmentInput, build_arrangement
from .assembly import (
    Assembly,
    Sequence,
    Step,
    angle_control,
    control,
    glue,
    hinge,
    leaf,
    pin,
    pivot,
    rotate,
    sequence_control,
    slide,
    slider,
    string,
    translate,
)
from .document import KERNEL_ID, KERNEL_VERSION, Document, canonical_json
from .document_build import STOCK_DERIVED_KEYS, StockUnavailable, resolve_stock
from .geometry import (
    EPS,
    Arc,
    Bezier,
    Line,
    P,
    Vec2,
    circle,
    curve_through,
    offset_ring,
    polygon_area,
    rectangle,
    regular_polygon,
    square,
)
from .sheet import Face, Mark, Placement, Sheet, Tab

__version__ = KERNEL_VERSION

__all__ = [
    "EPS", "KERNEL_ID", "KERNEL_VERSION", "STOCK_DERIVED_KEYS", "Arc", "Arrangement",
    "ArrangementError", "Assembly", "Bezier", "Document", "Face", "Line", "Mark", "P",
    "Placement", "SegmentInput", "Sequence", "Sheet", "Step", "StockUnavailable", "Tab", "Vec2",
    "angle_control", "build_arrangement", "canonical_json", "circle", "control", "curve_through",
    "glue", "hinge", "leaf", "offset_ring", "pin", "pivot", "polygon_area", "rectangle",
    "regular_polygon", "resolve_stock", "rotate", "sequence_control", "slide", "slider",
    "square", "string", "translate",
]
