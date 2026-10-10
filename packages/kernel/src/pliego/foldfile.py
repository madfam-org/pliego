"""FOLD 1.2 import / export.

`load()` accepts a sheet document or a plain FOLD file (Origami Simulator, ORIPA exports,
flat-folder, …). A plain file is completed with the defaults of spec §7: one sheet ``sheet-0``,
stock ``kami``, grain 90°, treatment ``crease`` for M/V, ``cut`` for C, ``none`` otherwise,
identity placement and a ``sequence`` control with one step driving every M/V edge to its
``edges_foldAngle``. Missing faces are recomputed by the kernel's arrangement (vertices are then
renumbered canonically). `dump()` writes everything — ``pliego:`` fields are legal FOLD custom
fields, nothing is stripped.
"""

from __future__ import annotations

import json
from typing import Any

from .arrangement import SegmentInput, build_arrangement
from .document import KERNEL_ID, Document
from .document_build import _emit_tree, resolve_stock
from .geometry import Vec2, polygon_area

DEFAULT_SHEET = "sheet-0"
DEFAULT_STOCK = "kami"
TREATMENT_FOR = {"M": "crease", "V": "crease", "C": "cut"}


class FoldImportError(ValueError):
    """The FOLD file cannot be completed into a sheet document."""


def _fold_angle(asg: str, given: Any) -> float:
    if isinstance(given, int | float) and not isinstance(given, bool):
        return float(given) if asg in ("M", "V") else 0.0
    return {"M": -180.0, "V": 180.0}.get(asg, 0.0)


def _boundary_cycle(coords: list[Vec2], edges: list[list[int]], asg: list[str]) -> list[int]:
    nbr: dict[int, list[int]] = {}
    for (a, b), x in zip(edges, asg, strict=True):
        if x == "B":
            nbr.setdefault(a, []).append(b)
            nbr.setdefault(b, []).append(a)
    if not nbr or any(len(v) != 2 for v in nbr.values()):
        raise FoldImportError("plain FOLD without faces needs one closed boundary (B) loop")
    start = min(nbr)
    cyc, prev, cur = [start], None, start
    while True:
        nxt = [w for w in sorted(nbr[cur]) if w != prev]
        prev, cur = cur, nxt[0]
        if cur == start:
            break
        cyc.append(cur)
    if len(cyc) != len(nbr):
        raise FoldImportError("boundary edges form more than one loop")
    return cyc


def _recompute(coords: list[Vec2], edges: list[list[int]], asg: list[str], ang: list[float]):
    cyc = _boundary_cycle(coords, edges, asg)
    outline = [coords[i] for i in cyc]
    if polygon_area(outline) < 0:
        outline.reverse()
    segs = [SegmentInput(coords[a], coords[b], x, f, TREATMENT_FOR.get(x, "none"), None)
            for (a, b), x, f in zip(edges, asg, ang, strict=True) if x not in ("B", "J")]
    arr = build_arrangement(outline, [], segs)
    return arr


def load(source: str | bytes | dict, stocks: dict[str, dict] | None = None) -> Document:
    """Load a sheet document or complete a plain FOLD 1.x file with spec §7 defaults."""
    data = json.loads(source) if isinstance(source, str | bytes) else dict(source)
    if not isinstance(data, dict):
        raise FoldImportError("a FOLD file is a JSON object")
    if "pliego:version" in data:
        return Document(data)
    for k in ("vertices_coords", "edges_vertices"):
        if k not in data:
            raise FoldImportError(f"FOLD file lacks '{k}'")
    coords = [Vec2(float(c[0]), float(c[1])) for c in data["vertices_coords"]]
    edges = [list(map(int, e)) for e in data["edges_vertices"]]
    asg = list(data.get("edges_assignment") or ["U"] * len(edges))
    given = data.get("edges_foldAngle") or [None] * len(edges)
    ang = [_fold_angle(a, g) for a, g in zip(asg, given, strict=True)]
    faces = data.get("faces_vertices")
    if faces:
        faces = [list(map(int, f)) for f in faces]
        faces = [f if polygon_area([coords[i] for i in f]) >= 0 else list(reversed(f))
                 for f in faces]
        trt = [TREATMENT_FOR.get(a, "none") for a in asg]
    else:
        arr = _recompute(coords, edges, asg, ang)
        coords = arr.vertices
        edges = [list(e) for e in arr.edges]
        asg, ang, trt = list(arr.assignment), list(arr.fold_angle), list(arr.treatment)
        faces = arr.faces
    lo_x = min(p.x for p in coords)
    lo_y = min(p.y for p in coords)
    stock = resolve_stock(DEFAULT_STOCK, stocks)
    nv, ne, nf = len(coords), len(edges), len(faces)
    mv = [e for e in range(ne) if asg[e] in ("M", "V")]
    doc: dict[str, Any] = {k: v for k, v in data.items()
                           if k not in ("vertices_coords", "edges_vertices", "edges_assignment",
                                        "edges_foldAngle", "faces_vertices", "faces_edges",
                                        "edges_faces", "vertices_vertices", "vertices_faces")}
    doc.update({
        "file_spec": 1.2,
        "file_creator": data.get("file_creator") or KERNEL_ID,
        "file_classes": ["singleModel"],
        "frame_classes": ["creasePattern"],
        "frame_attributes": ["2D", "cuts" if "C" in asg else "noCuts", "noJoins"],
        "frame_unit": "mm",
        "vertices_coords": [[p.x, p.y] for p in coords],
        "edges_vertices": edges,
        "edges_assignment": asg,
        "edges_foldAngle": ang,
        "faces_vertices": faces,
        "pliego:version": 1,
        "pliego:vertices_sheet": [0] * nv,
        "pliego:edges_sheet": [0] * ne,
        "pliego:faces_sheet": [0] * nf,
        "pliego:edges_treatment": trt,
        "pliego:sheets": [{
            "id": DEFAULT_SHEET, "label": {"en": "Sheet 0", "es": "Hoja 0", "fr": "Feuille 0",
                                           "pt": "Folha 0"},
            "stock": DEFAULT_STOCK, "grain_deg": 90, "offset": [lo_x, lo_y],
            "placement": {"origin": [0, 0, 0], "rotation": [0, 0, 0, 1]},
            "front": {"color": "#f4efe6", "art": None}, "back": {"color": "#f4efe6", "art": None},
            "kinematic": None}],
        "pliego:stocks": {DEFAULT_STOCK: stock},
        "pliego:meta": {"kernel": KERNEL_ID, "digest": None},
    })
    if mv:
        doc["pliego:controls"] = [{"id": "sequence", "kind": "sequence",
                                   "label": {"en": "Fold", "es": "Doblar", "fr": "Plier",
                                             "pt": "Dobrar"},
                                   "min": 0, "max": 1, "default": 0, "unit": "step"}]
        doc["pliego:sequence"] = {"mode": "physical", "steps": [{
            "id": "fold", "label": {"en": "Fold", "es": "Doblar", "fr": "Plier", "pt": "Dobrar"},
            "duration_ms": 2000, "targets": [[e, ang[e]] for e in mv], "release": [],
            "note": None}]}
    if data.get("frame_unit") not in (None, "mm"):
        doc["file_description"] = (f"imported from frame_unit {data.get('frame_unit')!r}; "
                                   "coordinates taken as mm")
    return Document(_emit_tree(doc)).stamp()


def dump(doc: Document, pretty: bool = True) -> str:
    """Write a `.fold` file (canonical keys; nothing stripped)."""
    return doc.to_json(pretty=pretty)


def to_plain_fold(doc: Document) -> dict:
    """The FOLD-only view (drops ``pliego:`` keys) for tools that reject custom fields."""
    return {k: v for k, v in doc.data.items() if not k.startswith("pliego:")}
