"""`verify()` — every semantic rule of sheet-document spec §8, as precise issue dicts.

Issue shape (Fashion Cabinet convention): ``{"level": "error"|"warning", "kind": str,
"detail": str, ...location keys}``. Fail closed: an unresolvable reference is an error, never a
silent skip. Rule numbers are recorded in ``rule``.
"""

from __future__ import annotations

import math
import re
from typing import Any

from .document import PER_EDGE, PER_FACE, PER_VERTEX, Document
from .document_build import STOCK_DERIVED_KEYS
from .geometry import (
    Vec2,
    is_simple_polygon,
    point_in_polygon,
    polygon_area,
    polygon_centroid,
    segments_touch,
)

REQUIRED = ("file_spec", "file_creator", "file_classes", "frame_classes", "frame_attributes",
            "frame_unit", "vertices_coords", "edges_vertices", "edges_assignment",
            "edges_foldAngle", "faces_vertices", "pliego:version", "pliego:vertices_sheet",
            "pliego:edges_sheet", "pliego:faces_sheet", "pliego:edges_treatment",
            "pliego:sheets", "pliego:stocks", "pliego:meta")
ALLOWED_TREATMENT = {"none": {"B", "J", "U", "F"}, "crease": {"M", "V", "F"},
                     "score": {"M", "V", "F"}, "perforation": {"M", "V", "F", "C"},
                     "cut": {"C"}, "halfcut": {"F"}}
EDGE_NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
DEFAULT_MIN_FACE_AREA_MM2 = 1.0
MECH_CONTROL_KEY = {"hinge": "angle_control", "slide": "control", "rotate": "control",
                    "leaf": "control", "translate": "control"}


META_KEYS = frozenset({"cartridge", "mode", "params", "kernel", "digest", "min_feature_mm"})


class _Issues(list):
    def err(self, rule: int, kind: str, detail: str, **loc: Any) -> None:
        self.append({"level": "error", "kind": kind, "rule": rule, "detail": detail, **loc})

    def warn(self, rule: int, kind: str, detail: str, **loc: Any) -> None:
        self.append({"level": "warning", "kind": kind, "rule": rule, "detail": detail, **loc})


def _pt(c: Any) -> Vec2 | None:
    if (isinstance(c, list) and len(c) >= 2 and all(isinstance(x, int | float)
                                                     and not isinstance(x, bool) for x in c[:2])):
        return Vec2(float(c[0]), float(c[1]))
    return None


def face_area_floor(d: dict, out: _Issues | None = None) -> float:
    """Rule 3 floor (mm²): ``pliego:meta.min_feature_mm``² when declared (> 0), else 1 mm²."""
    meta = d.get("pliego:meta")
    mf = meta.get("min_feature_mm") if isinstance(meta, dict) else None
    if mf is None:
        return DEFAULT_MIN_FACE_AREA_MM2
    if isinstance(mf, bool) or not isinstance(mf, int | float) or not math.isfinite(mf) or mf <= 0:
        if out is not None:
            out.err(3, "min_feature", f"pliego:meta.min_feature_mm {mf!r} must be a number > 0")
        return DEFAULT_MIN_FACE_AREA_MM2
    return float(mf) * float(mf)


def verify_document(doc: Document, min_face_area_mm2: float | None = None) -> list[dict]:
    d = doc.data
    out = _Issues()
    missing = [k for k in REQUIRED if k not in d]
    for k in missing:
        out.err(1, "missing_field", f"required field '{k}' is absent", field=k)
    if d.get("file_spec") not in (1.2, None):
        out.err(1, "file_spec", f"file_spec is {d.get('file_spec')!r}, expected 1.2")
    if d.get("frame_unit") not in ("mm", None):
        out.err(1, "frame_unit", f"frame_unit is {d.get('frame_unit')!r}, expected 'mm'")
    if d.get("pliego:version") not in (1, None):
        out.err(1, "version", f"pliego:version is {d.get('pliego:version')!r}, expected 1")
    if not _rule1_lengths(d, out):
        return list(out)  # indices unusable: stop before dereferencing
    coords = [_pt(c) for c in d["vertices_coords"]]
    sheets = d.get("pliego:sheets") or []
    if not sheets:
        out.err(1, "no_sheets", "document has no sheets (sheets=0 is a failure)")
        return list(out)
    _rule2_sheets(d, out)
    floor = face_area_floor(d, out) if min_face_area_mm2 is None else float(min_face_area_mm2)
    faces_ok = _rule3_faces(d, coords, out, floor)
    _rule4_edges(d, out)
    _edge_extras(d, out)
    _face_orders(d, out)
    _rule5_overlap(d, coords, out)
    _rule6_stocks(d, out)
    _rule7_refs(d, coords, out)
    _rule14_print(d, coords, out)
    _rule15_mechanism_sheets(d, out)
    rule17_presentation(d, out)
    rule18_art(d, out)
    _rule8_sequence(d, out)
    _rule11_pieces(d, out)
    _rule12_stacks(d, _sheet_tools(d, coords)[1], out)
    if faces_ok:
        _rule9_initial(d, coords, out)
    _rule13_packaging(d, coords, out)
    meta = d.get("pliego:meta") or {}
    extra = sorted(set(meta) - META_KEYS) if isinstance(meta, dict) else []
    if extra:  # rule 16 (§5.7): the schema closes pliego:meta; a warning until the commons is clean
        out.warn(16, "meta_unknown_key", f"pliego:meta has keys outside §5.7: {extra} (the "
                 "schema rejects them; put cartridge data in params or step notes)")
    if meta.get("digest") is not None and meta["digest"] != doc.digest():
        out.err(10, "digest_mismatch", f"meta.digest {meta['digest']} != {doc.digest()}")
    return list(out)


# ── rule 1: lengths and index ranges ─────────────────────────────────────────


def _rule1_lengths(d: dict, out: _Issues) -> bool:
    ok = True
    for k in ("vertices_coords", "edges_vertices", "faces_vertices", "pliego:sheets"):
        if not isinstance(d.get(k), list):
            out.err(1, "array_type", f"'{k}' must be an array", field=k)
            ok = False
    if not ok:
        return False
    nv, ne, nf = len(d["vertices_coords"]), len(d["edges_vertices"]), len(d["faces_vertices"])
    for keys, n, what in ((PER_VERTEX, nv, "vertices"), (PER_EDGE, ne, "edges"),
                          (PER_FACE, nf, "faces")):
        for k in keys:
            if k in d and (not isinstance(d[k], list) or len(d[k]) != n):
                got = len(d[k]) if isinstance(d[k], list) else type(d[k]).__name__
                out.err(1, "array_length", f"'{k}' has {got} entries, expected {n} ({what})",
                        field=k)
                ok = False
    for i, c in enumerate(d["vertices_coords"]):
        p = _pt(c)
        if p is None or not (math.isfinite(p.x) and math.isfinite(p.y)):
            out.err(1, "bad_coordinate", f"vertex {i} coordinate {c!r} is not a finite 2-D point",
                    vertex=i)
            ok = False
    for i, e in enumerate(d["edges_vertices"]):
        if not (isinstance(e, list) and len(e) == 2 and all(_idx(x, nv) for x in e)) or (
                e[0] == e[1]):
            out.err(1, "index_range", f"edge {i} vertices {e!r} out of range or degenerate",
                    edge=i)
            ok = False
    for i, f in enumerate(d["faces_vertices"]):
        if not (isinstance(f, list) and len(f) >= 3 and all(_idx(x, nv) for x in f)):
            out.err(1, "index_range", f"face {i} vertices {f!r} out of range", face=i)
            ok = False
    ns = len(d["pliego:sheets"])
    for k in ("pliego:vertices_sheet", "pliego:edges_sheet", "pliego:faces_sheet"):
        for i, s in enumerate(d.get(k) or []):
            if not _idx(s, ns):
                out.err(1, "index_range", f"'{k}'[{i}] = {s!r} is not a sheet index", field=k)
                ok = False
    if "faces_edges" in d and ok:
        ev = d["edges_vertices"]
        for i, (fvs, fes) in enumerate(zip(d["faces_vertices"], d["faces_edges"], strict=False)):
            want = {frozenset((fvs[k], fvs[(k + 1) % len(fvs)])) for k in range(len(fvs))}
            got = {frozenset(ev[e]) for e in fes if _idx(e, ne)}
            if want != got or len(fes) != len(fvs):
                out.err(1, "faces_edges", f"faces_edges[{i}] disagrees with faces_vertices",
                        face=i)
    return ok


def _idx(x: Any, n: int) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and 0 <= x < n


# ── rule 2: sheet membership ─────────────────────────────────────────────────


def _rule2_sheets(d: dict, out: _Issues) -> None:
    vs = d["pliego:vertices_sheet"]
    for i, (e, s) in enumerate(zip(d["edges_vertices"], d["pliego:edges_sheet"], strict=True)):
        if vs[e[0]] != s or vs[e[1]] != s:
            out.err(2, "sheet_mismatch", f"edge {i} (sheet {s}) joins vertices of sheets "
                    f"{vs[e[0]]}/{vs[e[1]]}", edge=i)
    for i, (f, s) in enumerate(zip(d["faces_vertices"], d["pliego:faces_sheet"], strict=True)):
        bad = sorted({vs[v] for v in f if vs[v] != s})
        if bad:
            out.err(2, "sheet_mismatch", f"face {i} (sheet {s}) uses vertices of sheets {bad}",
                    face=i)
    ids = [s.get("id") for s in d["pliego:sheets"]]
    dup = sorted({x for x in ids if ids.count(x) > 1})
    if dup:
        out.err(2, "duplicate_id", f"duplicate sheet ids {dup}")


# ── rule 3: faces simple, CCW, non-degenerate, tiling ────────────────────────


def _rule3_faces(d: dict, coords: list, out: _Issues, min_area: float) -> bool:
    ok = True
    ns = len(d["pliego:sheets"])
    face_area = [0.0] * ns
    for i, f in enumerate(d["faces_vertices"]):
        ring = [coords[v] for v in f]
        a = polygon_area(ring)
        s = d["pliego:faces_sheet"][i]
        face_area[s] += a
        if len(set(f)) != len(f) or not is_simple_polygon(ring):
            out.err(3, "face_not_simple", f"face {i} is not a simple polygon", face=i)
            ok = False
        elif a <= 0:
            out.err(3, "face_orientation", f"face {i} is clockwise or empty (area {a:.4f} mm²)",
                    face=i)
            ok = False
    if ok:
        _rule3_floor(d, coords, out, min_area)
    # tiling: every half-edge used once; boundary area equals face area
    use: dict[tuple[int, int], list[int]] = {}
    for i, f in enumerate(d["faces_vertices"]):
        for k in range(len(f)):
            use.setdefault((f[k], f[(k + 1) % len(f)]), []).append(i)
    for (a, b), fs in use.items():
        if len(fs) > 1:
            out.err(3, "face_overlap", f"half-edge {a}→{b} is used by faces {fs}", faces=fs)
            ok = False
    edge_set = {frozenset(e) for e in d["edges_vertices"]}
    for a, b in use:
        if frozenset((a, b)) not in edge_set:
            out.err(3, "face_edge_missing", f"face side {a}–{b} is not an edge")
            ok = False
    b_area = [0.0] * ns
    for e, asg in zip(d["edges_vertices"], d["edges_assignment"], strict=True):
        if asg != "B":
            continue
        a, b = e
        side = (a, b) if (a, b) in use else ((b, a) if (b, a) in use else None)
        if side is None:
            continue
        s = d["pliego:vertices_sheet"][a]
        p, q = coords[side[0]], coords[side[1]]
        b_area[s] += (p.x * q.y - q.x * p.y) / 2.0
    for s in range(ns):
        if abs(b_area[s] - face_area[s]) > 1e-3 * max(1.0, abs(face_area[s])):
            out.err(3, "tiling", f"sheet {s}: faces cover {face_area[s]:.4f} mm² but the boundary "
                    f"encloses {b_area[s]:.4f} mm² (gap or overlap)", sheet=s)
            ok = False
    return ok


def _rule3_floor(d: dict, coords: list, out: _Issues, min_area: float) -> None:
    """Area floor per *material face*: faces joined across `J` edges count as one region.

    A `J` edge is artificial (spec §2: it only splits a face so every face is simply connected),
    so the physical face is the union of the faces it separates; bridging closely spaced holes
    may leave a thin J-bounded piece that is not a feature of the design."""
    jset = {frozenset(e) for e, asg in zip(d["edges_vertices"], d["edges_assignment"],
                                           strict=True) if asg == "J"}
    faces = d["faces_vertices"]
    parent = list(range(len(faces)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    if jset:
        owner: dict[frozenset, int] = {}
        for i, f in enumerate(faces):
            for k in range(len(f)):
                side = frozenset((f[k], f[(k + 1) % len(f)]))
                if side not in jset:
                    continue
                g = owner.setdefault(side, i)
                if g != i:
                    ri, rg = find(i), find(g)
                    if ri != rg:
                        parent[max(ri, rg)] = min(ri, rg)
    area: dict[int, float] = {}
    members: dict[int, list[int]] = {}
    for i, f in enumerate(faces):
        r = find(i)
        area[r] = area.get(r, 0.0) + polygon_area([coords[v] for v in f])
        members.setdefault(r, []).append(i)
    for r in sorted(area):
        if area[r] < min_area:
            fs = members[r]
            what = f"face {fs[0]}" if len(fs) == 1 else f"faces {fs} (joined across J edges)"
            out.err(3, "face_degenerate", f"{what} area {area[r]:.6f} mm² < {min_area:g} mm²",
                    face=fs[0], faces=fs)


# ── edge names and rest angles (spec §3, optional arrays) ────────────────────


def _edge_extras(d: dict, out: _Issues) -> None:
    for i, name in enumerate(d.get("pliego:edges_name") or []):
        if name is not None and not (isinstance(name, str) and EDGE_NAME.match(name)
                                     and len(name) <= 80):
            out.err(1, "edge_name", f"edge {i} name {name!r} is not a kebab-case slug", edge=i)
    asg = d["edges_assignment"]
    for i, r in enumerate(d.get("pliego:edges_restAngle") or []):
        if isinstance(r, bool) or not isinstance(r, int | float) or not -180 <= r <= 180:
            out.err(4, "rest_angle_range", f"edge {i} rest angle {r!r} outside [−180, 180]",
                    edge=i)
        elif r != 0 and i < len(asg) and asg[i] in ("B", "C", "J"):
            out.err(4, "rest_angle_assignment", f"edge {i} ({asg[i]}) cannot carry a rest "
                    f"angle ({r})", edge=i)


# ── rule 4: assignment / treatment / fold angle / face incidence ─────────────


def _rule4_edges(d: dict, out: _Issues) -> None:
    sides: dict[frozenset, list[int]] = {}
    for i, f in enumerate(d["faces_vertices"]):
        for k in range(len(f)):
            sides.setdefault(frozenset((f[k], f[(k + 1) % len(f)])), []).append(i)
    trt = d.get("pliego:edges_treatment") or ["none"] * len(d["edges_vertices"])
    twins: dict[tuple, int] = {}
    for e, asg, t in zip(d["edges_vertices"], d["edges_assignment"], trt, strict=True):
        if asg == "C" and t == "cut" and len(sides.get(frozenset(e), [])) == 1:
            key = _coord_key(d, e)
            twins[key] = twins.get(key, 0) + 1
    for i, (e, asg, ang, t) in enumerate(zip(d["edges_vertices"], d["edges_assignment"],
                                             d["edges_foldAngle"], trt, strict=True)):
        if asg not in ("B", "M", "V", "F", "U", "C", "J"):
            out.err(4, "assignment", f"edge {i} has unknown assignment {asg!r}", edge=i)
            continue
        if t not in ALLOWED_TREATMENT:
            out.err(4, "treatment", f"edge {i} has unknown treatment {t!r}", edge=i)
        elif asg not in ALLOWED_TREATMENT[t]:
            out.err(4, "treatment_assignment", f"edge {i}: treatment '{t}' does not allow "
                    f"assignment '{asg}'", edge=i)
        if not isinstance(ang, int | float) or not -180 <= ang <= 180:
            out.err(4, "fold_angle_range", f"edge {i} fold angle {ang!r} outside [−180, 180]",
                    edge=i)
        elif asg in ("B", "F", "C", "J", "U") and ang != 0:
            out.err(4, "fold_angle_assignment", f"edge {i} ({asg}) must have fold angle 0, "
                    f"has {ang}", edge=i)
        elif (asg == "V" and ang < 0) or (asg == "M" and ang > 0):
            out.err(4, "fold_angle_sign", f"edge {i} ({asg}) fold angle {ang} has the wrong sign "
                    "(valley > 0, mountain < 0)", edge=i)
        n = len(sides.get(frozenset(e), []))
        want = 1 if asg == "B" else 2
        if asg == "C" and n == 1 and twins.get(_coord_key(d, e), 0) == 2:
            want = 1  # one side of a split cut (§4): its twin borders the other side
        if n != want:
            out.err(4, "edge_faces", f"edge {i} ({asg}) borders {n} face(s), expected {want}",
                    edge=i)


def _coord_key(d: dict, e: list[int]) -> tuple:
    """Sheet + unordered end coordinates of an edge: the two sides of a split cut share it."""
    vc = d["vertices_coords"]
    p, q = (tuple(vc[e[0]][:2]), tuple(vc[e[1]][:2]))
    return (d["pliego:vertices_sheet"][e[0]], min(p, q), max(p, q))


def _face_orders(d: dict, out: _Issues) -> None:
    """Rule 1–2 for FOLD ``faceOrders``: [f, g, s] with f ≠ g in range, on one sheet, s = ±1."""
    fo = d.get("faceOrders")
    if fo is None:
        return
    nf, fs = len(d["faces_vertices"]), d["pliego:faces_sheet"]
    if not isinstance(fo, list):
        out.err(1, "face_orders", "faceOrders must be a list of [f, g, s]")
        return
    for k, t in enumerate(fo):
        ok = (isinstance(t, list) and len(t) == 3
              and all(isinstance(x, int) and not isinstance(x, bool) for x in t))
        if not ok or not (0 <= t[0] < nf and 0 <= t[1] < nf) or t[0] == t[1] \
                or t[2] not in (-1, 1):
            out.err(1, "face_orders", f"faceOrders[{k}] = {t!r} is not [f, g, ±1] with f ≠ g "
                    "in range")
        elif fs[t[0]] != fs[t[1]]:
            out.err(2, "face_orders_sheet", f"faceOrders[{k}]: faces {t[0]} and {t[1]} lie on "
                    "different sheets")


# ── rule 5: sheets do not overlap in the layout frame ────────────────────────


def _rule5_overlap(d: dict, coords: list, out: _Issues) -> None:
    ns = len(d["pliego:sheets"])
    rings: list[list[list[Vec2]]] = [[] for _ in range(ns)]
    for f, s in zip(d["faces_vertices"], d["pliego:faces_sheet"], strict=True):
        rings[s].append([coords[v] for v in f])
    boxes = []
    for s in range(ns):
        pts = [p for r in rings[s] for p in r]
        boxes.append((min(p.x for p in pts), min(p.y for p in pts), max(p.x for p in pts),
                      max(p.y for p in pts)) if pts else None)
    for i in range(ns):
        for j in range(i + 1, ns):
            bi, bj = boxes[i], boxes[j]
            if bi is None or bj is None:
                continue
            if bi[2] <= bj[0] or bj[2] <= bi[0] or bi[3] <= bj[1] or bj[3] <= bi[1]:
                continue
            if _rings_overlap(rings[i], rings[j]):
                out.err(5, "sheet_overlap", f"sheets {i} and {j} overlap in the layout frame",
                        sheets=[i, j])


def _rings_overlap(a: list[list[Vec2]], b: list[list[Vec2]]) -> bool:
    for ra in a:
        for rb in b:
            for k in range(len(ra)):
                for m in range(len(rb)):
                    if segments_touch(ra[k], ra[(k + 1) % len(ra)], rb[m],
                                      rb[(m + 1) % len(rb)], -1e-9):
                        return True
            for p, ring in ((ra[0], rb), (rb[0], ra), (polygon_centroid(ra), rb),
                            (polygon_centroid(rb), ra)):
                if point_in_polygon(p, ring) == 1:
                    return True
    return False


# ── rule 6: stocks ───────────────────────────────────────────────────────────


def _rule6_stocks(d: dict, out: _Issues) -> None:
    stocks = d.get("pliego:stocks") or {}
    for i, s in enumerate(d["pliego:sheets"]):
        if s.get("stock") not in stocks:
            out.err(6, "stock_reference", f"sheet {s.get('id')!r} stock {s.get('stock')!r} is not "
                    "in pliego:stocks", sheet=i)
    for slug, snap in stocks.items():
        derived = (snap or {}).get("derived") if isinstance(snap, dict) else None
        if not isinstance(derived, dict):
            out.err(6, "stock_derived", f"stock {slug!r} has no derived block", stock=slug)
            continue
        miss = [k for k in STOCK_DERIVED_KEYS if not isinstance(derived.get(k), int | float)]
        if miss:
            out.err(6, "stock_derived", f"stock {slug!r} derived block lacks {miss}", stock=slug)
        bad = [k for k in STOCK_DERIVED_KEYS if isinstance(derived.get(k), int | float)
               and k not in ("crease_yield_deg", "crease_set_rate", "friction", "nu")
               and derived[k] <= 0]
        if bad:
            out.err(6, "stock_derived", f"stock {slug!r} has non-positive {bad}", stock=slug)


# rules 7–9 live in document_verify_refs (file-size gate)
from .document_verify_pack import _rule13_packaging  # noqa: E402
from .document_verify_refs import (  # noqa: E402
    _rule7_refs,
    _rule8_sequence,
    _rule9_initial,
    _rule14_print,
    _rule15_mechanism_sheets,
    _sheet_tools,
)
from .document_verify_view import rule17_presentation, rule18_art  # noqa: E402
from .pieces import rule11_pieces as _rule11_pieces  # noqa: E402
from .pieces import rule12_stacks as _rule12_stacks  # noqa: E402

__all__ = ["verify_document"]
