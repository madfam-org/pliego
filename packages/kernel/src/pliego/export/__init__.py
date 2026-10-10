"""Fabrication and interchange exporters for sheet documents.

Every exporter takes a sheet document (a dict, JSON text, or an object with ``to_json()``) and
returns ``str`` or ``bytes``; outputs are byte-deterministic.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .dxf import to_dxf
from .fold import to_fold
from .glb import to_glb
from .hpgl import to_hpgl
from .pdf import to_pdf
from .svg import to_svg

# format → (exporter, file extension, media type)
EXPORTERS: dict[str, tuple[Callable[..., Any], str, str]] = {
    "svg": (to_svg, ".svg", "image/svg+xml"),
    "dxf": (to_dxf, ".dxf", "image/vnd.dxf"),
    "pdf": (to_pdf, ".pdf", "application/pdf"),
    "hpgl": (to_hpgl, ".plt", "application/vnd.hp-hpgl"),
    "glb": (to_glb, ".glb", "model/gltf-binary"),
    "fold": (to_fold, ".fold", "application/json"),
}

__all__ = ["EXPORTERS", "to_dxf", "to_fold", "to_glb", "to_hpgl", "to_pdf", "to_svg"]
