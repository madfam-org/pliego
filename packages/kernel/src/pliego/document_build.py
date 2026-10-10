"""Assembly → `Document` writer (spec v1 §2–§7). Split from `document.py` for the size gate."""

from __future__ import annotations

import copy
from typing import Any

from .arrangement import Arrangement
from .document import KERNEL_ID, Document
from .geometry import Vec2, as_vec, bbox, emit
from .sheet import Mark, Sheet
from .space import add, quat_rotate, unplaced

STOCK_DERIVED_KEYS = ("areal_density", "thickness", "E_md", "E_cd", "nu", "D_md", "D_cd",
                      "crease_k", "crease_yield_deg", "crease_set_rate", "score_factor",
                      "perf_factor", "tear_strain", "friction", "collision_thickness")


class StockUnavailable(LookupError):
    """No snapshot could be resolved for a stock id (fail loud)."""


def resolve_stock(slug: str, stocks: dict[str, dict] | None) -> dict:
    """Stock snapshot (spec §5.2) for `slug`.

    Resolution order: the `stocks` mapping passed to `build()`, then `pliego.stock.snapshot(slug)`
    (kernel-gen's stock module — the only implementation of the measurement → physics mapping).
    """
    if stocks and slug in stocks:
        return copy.deepcopy(stocks[slug])
    try:
        from . import stock as stock_mod  # type: ignore[attr-defined]
    except ImportError as exc:
        raise StockUnavailable(
            f"stock '{slug}': pass build(stocks={{'{slug}': snapshot}}) or install pliego.stock"
        ) from exc
    snap = getattr(stock_mod, "snapshot", None)
    if snap is None:
        raise StockUnavailable(f"stock '{slug}': pliego.stock has no snapshot(slug)")
    return snap(slug)


def _emit_tree(value: Any) -> Any:
    """Round every float in a JSON tree to the emit grid (ints stay ints, bools untouched)."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, int | float):
        return emit(value)
    if isinstance(value, list | tuple):
        return [_emit_tree(v) for v in value]
    if isinstance(value, dict):
        return {k: _emit_tree(v) for k, v in value.items()}
    raise TypeError(f"cannot serialise {type(value).__name__} in a document")


def layout_offsets(sheets: list[Sheet], layout: str | dict, gap: float = 10.0) -> list[Vec2]:
    """Layout-frame offsets: side by side (row) or explicit per-sheet offsets."""
    if isinstance(layout, dict):
        missing = [s.id for s in sheets if s.id not in layout]
        if missing:
            raise ValueError(f"layout has no offset for sheets {missing}")
        return [as_vec(layout[s.id]) for s in sheets]
    if layout != "row":
        raise ValueError(f"unknown layout {layout!r} (use 'row' or a dict)")
    out: list[Vec2] = []
    cursor = 0.0
    for s in sheets:
        lo, hi = bbox(s.outline)  # type: ignore[arg-type]
        out.append(Vec2(cursor - lo.x, -lo.y))
        cursor += (hi.x - lo.x) + gap
    return out


def _initial_coords(sheet: Sheet, arr: Arrangement, spec: Any) -> list[list[float]]:
    """3-D world coordinates of one sheet's vertices for the `initial` / target frames."""
    local: list[tuple[float, float, float]]
    verts = arr.vertices
    if callable(spec):
        return [list(map(float, spec(sheet.id, (v.x, v.y)))) for v in verts]
    if isinstance(spec, dict) and spec:
        from .kinematics import pose_arrangement

        angles: dict[int, float] = {}
        for key, deg in (spec.get("angles") or {}).items():
            idx = key.edges() if isinstance(key, Mark) else [int(key)]
            for e in idx:
                angles[e] = float(deg)
        root = spec.get("root")
        local = pose_arrangement(arr, angles, None if root is None else as_vec(root))
    else:
        local = [unplaced(v.x, v.y) for v in verts]
    pl = sheet.placement
    return [list(add(quat_rotate(pl.rotation, p), pl.origin)) for p in local]  # type: ignore[union-attr]


def _frame_for(assembly, arrs: list[Arrangement], spec: Any, title: str) -> dict:
    coords: list[list[float]] = []
    for sheet, arr in zip(assembly.sheets, arrs, strict=True):
        per = spec.get(sheet.id) if isinstance(spec, dict) and not _is_pose(spec) else spec
        if per == "flat":
            per = None
        coords.extend(_initial_coords(sheet, arr, per))
    return {"frame_title": title, "frame_classes": ["foldedForm"], "frame_attributes": ["3D"],
            "frame_inherit": True, "frame_parent": 0, "vertices_coords": coords}


def _is_pose(spec: dict) -> bool:
    return "angles" in spec or "root" in spec


def build_document(assembly, stocks: dict[str, dict] | None = None,
                   meta_overrides: dict | None = None) -> Document:
    """Write the canonical sheet document of an `Assembly`."""
    from .assembly import Sequence_, Step, sequence_control

    sheets: list[Sheet] = assembly.sheets
    arrs = [s.build() for s in sheets]
    offsets = layout_offsets(sheets, assembly.layout)
    vc: list[list[float]] = []
    ev: list[list[int]] = []
    ea: list[str] = []
    ef: list[float] = []
    et: list[str] = []
    fv: list[list[int]] = []
    vs: list[int] = []
    es: list[int] = []
    fs: list[int] = []
    en: list[str | None] = []
    er: list[float] = []
    edge_base: list[int] = []
    for si, (arr, off) in enumerate(zip(arrs, offsets, strict=True)):
        en.extend(sheets[si].edge_names(arr))
        er.extend(sheets[si].edge_rest_angles(arr))
        vb = len(vc)
        edge_base.append(len(ev))
        vc.extend([v.x + off.x, v.y + off.y] for v in arr.vertices)
        vs.extend([si] * len(arr.grid))
        for (a, b), asg, ang, trt in zip(arr.edges, arr.assignment, arr.fold_angle,
                                         arr.treatment, strict=True):
            ev.append([a + vb, b + vb])
            ea.append(asg)
            ef.append(ang if asg in ("M", "V") else 0.0)
            et.append(trt)
            es.append(si)
        for f in arr.faces:
            fv.append([i + vb for i in f])
            fs.append(si)

    stock_snaps = {slug: resolve_stock(slug, stocks) for slug in sorted({s.stock for s in sheets})}
    sheet_objs = []
    for s, off in zip(sheets, offsets, strict=True):
        pl = s.placement
        app = stock_snaps[s.stock].get("appearance") or {}
        sheet_objs.append({
            "id": s.id, "label": dict(s.label), "stock": s.stock,  # type: ignore[arg-type]
            "grain_deg": s.grain_deg, "offset": [off.x, off.y],
            "placement": {"origin": list(pl.origin), "rotation": list(pl.rotation)},  # type: ignore[union-attr]
            "front": s.front.to_dict(app.get("front")),  # type: ignore[union-attr]
            "back": s.back.to_dict(app.get("back")),  # type: ignore[union-attr]
            "kinematic": None if s.kinematic is None else {"mechanism": s.kinematic},
        })

    def resolve_target(t) -> list[int]:
        from .assembly import EdgeRef

        if isinstance(t, EdgeRef):
            si = next((i for i, s in enumerate(sheets) if s is t.sheet), None)
            if si is None or not 0 <= t.edge < len(arrs[si].edges):
                raise ValueError(f"edge reference {t.edge} of sheet '{t.sheet.id}' does not "
                                 "resolve in this assembly")
            return [edge_base[si] + t.edge]
        if isinstance(t, Mark):
            si = next((i for i, s in enumerate(sheets) if s is t.sheet), None)
            if si is None:
                raise ValueError(f"mark {t.index} belongs to a sheet outside this assembly")
            idx = arrs[si].edges_of_tag(t.index)
            if not idx:
                raise ValueError(f"sheet '{t.sheet.id}' mark {t.index} produced no edges")
            return [edge_base[si] + e for e in idx]
        return [int(t)]

    controls = [dict(c) for c in assembly.controls]
    data: dict[str, Any] = {
        "file_spec": 1.2,
        "file_creator": KERNEL_ID,
        "file_classes": ["singleModel" if len(sheets) == 1 else "multiModel"],
        "frame_classes": ["creasePattern"],
        "frame_attributes": ["2D", "cuts" if "C" in ea else "noCuts",
                             "joins" if assembly.joins else "noJoins"],
        "frame_unit": "mm",
        "vertices_coords": vc,
        "edges_vertices": ev,
        "edges_assignment": ea,
        "edges_foldAngle": ef,
        "faces_vertices": fv,
        "pliego:version": 1,
        "pliego:vertices_sheet": vs,
        "pliego:edges_sheet": es,
        "pliego:faces_sheet": fs,
        "pliego:edges_treatment": et,
        "pliego:sheets": sheet_objs,
        "pliego:stocks": stock_snaps,
    }
    if any(r != 0.0 for r in er):
        data["pliego:edges_restAngle"] = er
    if any(n is not None for n in en):
        data["pliego:edges_name"] = en
    if assembly.title:
        data["file_title"] = assembly.title
    if assembly.joins:
        data["pliego:joins"] = [copy.deepcopy(j) for j in assembly.joins]
    if assembly.mechanisms:
        data["pliego:mechanisms"] = [copy.deepcopy(m) for m in assembly.mechanisms]
    seq: Sequence_ | None = assembly.sequence
    if seq is not None:
        steps: list[Step] = seq.resolve(sheets)
        if not steps:
            raise ValueError("the fold program has no steps (no M/V marks for fold_each)")
        out_steps = []
        for st in steps:
            targets = []
            for t, ang in st.targets:
                for e in resolve_target(t):
                    targets.append([e, ef[e] if ang is None else float(ang)])
            out_steps.append({"id": st.id, "label": dict(st.label),  # type: ignore[arg-type]
                              "duration_ms": st.duration_ms, "targets": targets,
                              "release": [e for r in st.release for e in resolve_target(r)],
                              "note": st.note})
        data["pliego:sequence"] = {"mode": seq.mode, "steps": out_steps}
        if not any(c.get("kind") == "sequence" for c in controls):
            controls.append(sequence_control())
        for c in controls:
            if c.get("kind") == "sequence" and c.get("max") is None:
                c["max"] = float(len(out_steps))
    for c in controls:
        if c.get("max", 0) is None:
            del c["max"]
    if controls:
        data["pliego:controls"] = controls
    need_initial = (assembly.initial is not None or bool(assembly.joins)
                    or any(not s.placement.is_identity() for s in sheets))  # type: ignore[union-attr]
    frames = []
    if need_initial:
        frames.append(_frame_for(assembly, arrs, assembly.initial, "initial"))
    for name, spec in (assembly.targets or {}).items():
        frames.append(_frame_for(assembly, arrs, spec, f"target:{name}"))
    if frames:
        data["file_frames"] = frames
    for key, value in (("pliego:dielines", getattr(assembly, "dielines", None)),
                       ("pliego:finishes", getattr(assembly, "finishes", None)),
                       ("pliego:artwork", getattr(assembly, "artwork", None))):
        if value:
            data[key] = [copy.deepcopy(v) for v in value]
    meta: dict[str, Any] = {"kernel": KERNEL_ID}
    if getattr(assembly, "min_feature_mm", None) is not None:
        meta["min_feature_mm"] = float(assembly.min_feature_mm)
    meta.update({k: v for k, v in (assembly.meta or {}).items() if v is not None})
    meta.update({k: v for k, v in (meta_overrides or {}).items() if v is not None})
    meta["digest"] = None
    data["pliego:meta"] = meta
    doc = Document(_emit_tree(data))
    doc.data["file_spec"] = 1.2
    return doc.stamp()


def sequence_targets(doc: Document) -> list[tuple[int, float]]:
    """All (edge, angle) targets of a document's fold program, in step order."""
    seq = doc.data.get("pliego:sequence") or {}
    return [(int(e), float(a)) for st in seq.get("steps", []) for e, a in st.get("targets", [])]

