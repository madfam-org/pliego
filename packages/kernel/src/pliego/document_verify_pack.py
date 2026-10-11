"""Spec §8 rule 13 (lane P draft): packaging blocks — dielines, finishes, artwork.

Every block names a sheet that exists; dieline panels, glue zones and finish regions are finite
polygons lying on their sheet (within the sheet's local bounding box, grown by the bleed for
bleed outlines); finish and artwork records pass :mod:`pliego.press`'s checks.
"""

from __future__ import annotations

import math
from typing import Any

GLUE_KINDS = ("glue", "gum", "peel-and-seal", "tape", "hot-melt")
FAMILIES = ("corrugated", "folding-carton", "envelope", "rigid", "board")
BOX_SLACK_MM = 1e-3


def _poly_ok(poly: Any) -> bool:
    return isinstance(poly, list) and len(poly) >= 3 and all(
        isinstance(q, list) and len(q) == 2 and all(
            isinstance(c, (int, float)) and not isinstance(c, bool) and math.isfinite(c)
            for c in q) for q in poly)


def _sheet_boxes(d: dict, coords: list) -> dict[str, tuple[float, float, float, float]]:
    sheets = d.get("pliego:sheets") or []
    vs = d.get("pliego:vertices_sheet") or []
    boxes: dict[str, list[float]] = {}
    for v, p in enumerate(coords):
        if p is None or v >= len(vs) or not 0 <= vs[v] < len(sheets):
            continue
        s = sheets[vs[v]]
        ox, oy = (s.get("offset") or [0, 0])[:2]
        u, w = p.x - ox, p.y - oy
        b = boxes.setdefault(s["id"], [u, w, u, w])
        b[0], b[1], b[2], b[3] = min(b[0], u), min(b[1], w), max(b[2], u), max(b[3], w)
    return {k: (b[0], b[1], b[2], b[3]) for k, b in boxes.items()}


def _inside(poly: list, box: tuple[float, float, float, float], grow: float) -> bool:
    x0, y0, x1, y1 = box
    g = grow + BOX_SLACK_MM
    return all(x0 - g <= u <= x1 + g and y0 - g <= v <= y1 + g for u, v in poly)


def _rule13_packaging(d: dict, coords: list, out: Any) -> None:
    from .press import check_artwork, check_finish

    blocks = {k: d.get(k) for k in ("pliego:dielines", "pliego:finishes", "pliego:artwork")}
    if not any(blocks.values()):
        return
    boxes = _sheet_boxes(d, coords)
    for key, value in blocks.items():
        if value is not None and not isinstance(value, list):
            out.err(13, "packaging", f"{key} must be a list")
            blocks[key] = []
    for k, dl in enumerate(blocks["pliego:dielines"] or []):
        where = f"pliego:dielines[{k}]"
        if not isinstance(dl, dict) or dl.get("sheet") not in boxes:
            out.err(13, "dieline_sheet", f"{where}: sheet does not resolve")
            continue
        box = boxes[dl["sheet"]]
        if dl.get("family") not in FAMILIES:
            out.err(13, "dieline_family", f"{where}: family {dl.get('family')!r}")
        bleed = dl.get("bleed_mm", 0)
        for name in ("bleed_mm", "safe_mm", "caliper_mm"):
            v = dl.get(name)
            if not isinstance(v, (int, float)) or v < 0:
                out.err(13, "dieline_number", f"{where}: {name} must be ≥ 0")
        for i, pn in enumerate(dl.get("panels") or []):
            for part, grow in (("polygon", 0.0), ("safe", 0.0), ("bleed", float(bleed or 0))):
                if part not in pn:
                    continue
                if not _poly_ok(pn[part]) or not _inside(pn[part], box, grow):
                    out.err(13, "dieline_panel",
                            f"{where}.panels[{i}] ({pn.get('name')}): {part} is not on the sheet")
        for i, g in enumerate(dl.get("glue") or []):
            if g.get("kind") not in GLUE_KINDS or not _poly_ok(g.get("polygon")) \
                    or not _inside(g["polygon"], box, 0.0):
                out.err(13, "dieline_glue", f"{where}.glue[{i}]: bad kind or polygon off sheet")
    for k, f in enumerate(blocks["pliego:finishes"] or []):
        where = f"pliego:finishes[{k}]"
        problems = check_finish(f)
        if isinstance(f, dict) and f.get("sheet") not in boxes:
            problems.append("sheet does not resolve")
        elif not problems and not all(_inside(p, boxes[f["sheet"]], 0.0) for p in f["region"]):
            problems.append("region is not on the sheet")
        for pr in problems:
            out.err(13, "finish", f"{where}: {pr}")
    for k, a in enumerate(blocks["pliego:artwork"] or []):
        problems = check_artwork(a)
        if isinstance(a, dict) and a.get("sheet") not in boxes:
            problems.append("sheet does not resolve")
        for pr in problems:
            out.err(13, "artwork", f"pliego:artwork[{k}]: {pr}")


def rule30_circuit(d: dict, out: Any) -> None:
    """Rule 30 (§5.30): the paper circuit the trace finishes draw, by `pliego.press.circuit`,
    with every fold switch open and then closed (a document does not say which state is meant;
    a short or a reversed LED in either is a fault). Traces that rule 13 refuses are left to
    rule 13. An issue found in both states is reported once."""
    from .press import check_finish, circuit

    fins = d.get("pliego:finishes")
    traces = [f for f in fins if isinstance(f, dict) and f.get("kind") == "trace"] \
        if isinstance(fins, list) else []
    if not traces or any(check_finish(f) for f in traces):
        return
    switches = sorted({pd["part"] for f in traces for pd in f.get("pads") or []
                       if pd.get("pin") == "contact"})
    seen = set()
    for closed in ([], switches) if switches else ([],):
        for i in circuit(traces, closed)["issues"]:
            key = (i["level"], i["kind"], i["detail"])
            if key in seen:
                continue
            seen.add(key)
            state = " (fold switches closed)" if closed else ""
            (out.err if i["level"] == "error" else out.warn)(
                30, i["kind"], f"circuit{state}: {i['detail']}")
