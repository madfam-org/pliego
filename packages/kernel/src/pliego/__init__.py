"""Pliego kernel — sheet hyperobjects: crease patterns, cuts, assemblies and fold programs.

Pure standard library. Units mm / degrees, sheet-local frames y-up, world frame Y-up.
Writes sheet documents (FOLD 1.2 + ``pliego:``; docs/spec/v1/sheet-document.md).
"""

from __future__ import annotations

import importlib as _importlib
import importlib.util as _importlib_util

# submodules double as namespaces: pliego.flatfold.check(...), pliego.kinematics.dof(...);
# pliego.cartridge is imported on demand (it is also the `python -m pliego.cartridge` CLI)
from . import (
    axioms,
    exact,
    flatfold,
    foldcut,
    foldfile,
    kinematics,
    papercut,
    simplefold,
)
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
from .foldfile import load as load_fold
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
from .params import clamp, param
from .sheet import Face, Mark, Placement, Sheet, Tab
from .simplefold import FoldedState

__version__ = KERNEL_VERSION

# kernel-gen modules (stock, generators, exporters) load lazily (PEP 562): `pliego.popup` imports
# on first access, so `python -m pliego.stock` runs without runpy's "found in sys.modules"
# warning. A module that is absent is simply not offered; an import error *inside* a present
# module still fails loud on access.
OPTIONAL_MODULES = ("stock", "tessellate", "popup", "book", "export", "mesh", "unfold")
AVAILABLE_MODULES: list[str] = [
    _n for _n in OPTIONAL_MODULES if _importlib_util.find_spec(f"{__name__}.{_n}") is not None
]


def __getattr__(name: str):
    if name in AVAILABLE_MODULES:
        module = _importlib.import_module(f".{name}", __name__)
        globals()[name] = module
        return module
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(AVAILABLE_MODULES))


__all__ = [
    "EPS", "KERNEL_ID", "KERNEL_VERSION", "STOCK_DERIVED_KEYS", "Arc", "Arrangement",
    "ArrangementError", "Assembly", "Bezier", "Document", "Face", "Line", "Mark", "P",
    "Placement", "SegmentInput", "Sequence", "Sheet", "Step", "StockUnavailable", "Tab", "Vec2",
    "angle_control", "build_arrangement", "canonical_json", "circle", "control", "curve_through",
    "glue", "hinge", "leaf", "offset_ring", "pin", "pivot", "polygon_area", "rectangle",
    "regular_polygon", "resolve_stock", "rotate", "sequence_control", "slide", "slider",
    "square", "string", "translate", "FoldedState", "load_fold", "axioms",
    "exact", "flatfold", "foldcut", "foldfile", "kinematics", "papercut", "simplefold",
    "clamp", "param",
]
