"""Spec §8 rules 7–9 (references, fold program, initial frame) for `document_verify`."""

from __future__ import annotations

import math
from typing import Any

from .geometry import Vec2, point_in_polygon
from .space import dist


def _sheet_tools(d: dict, coords: list):
    ids = {s.get("id"): i for i, s in enumerate(d["pliego:sheets"])}
    rings: dict[int, list[list[Vec2]]] = {}
    for f, s in zip(d["faces_vertices"], d["pliego:faces_sheet"], strict=True):
        rings.setdefault(s, []).append([coords[v] for v in f])

    def offset(si: int) -> Vec2:
        off = d["pliego:sheets"][si].get("offset") or [0, 0]
        return Vec2(float(off[0]), float(off[1]))

    def inside(si: int, local: Any) -> bool:
        if not (isinstance(local, list) and len(local) == 2
                and all(isinstance(c, int | float) for c in local)):
            return False
        o = offset(si)
        p = Vec2(local[0] + o.x, local[1] + o.y)
        return any(point_in_polygon(p, r) >= 0 for r in rings.get(si, []))

    return ids, inside, offset


def _rule7_refs(d: dict, coords: list, out) -> None:
    ids, inside, _ = _sheet_tools(d, coords)
    mechs = {m.get("id"): m for m in d.get("pliego:mechanisms") or [] if isinstance(m, dict)}
    ctrls = {c.get("id"): c for c in d.get("pliego:controls") or [] if isinstance(c, dict)}
    for group, what in (("pliego:joins", "join"), ("pliego:mechanisms", "mechanism"),
                        ("pliego:controls", "control")):
        gids = [x.get("id") for x in d.get(group) or [] if isinstance(x, dict)]
        dup = sorted({x for x in gids if gids.count(x) > 1}, key=str)
        if dup:
            out.err(7, "duplicate_id", f"duplicate {what} ids {dup}")

    def sheet_of(ref: Any, where: str) -> int | None:
        sid = ref.get("sheet") if isinstance(ref, dict) else None
        if sid not in ids:
            out.err(7, "sheet_reference", f"{where}: sheet {sid!r} does not exist")
            return None
        return ids[sid]

    def point(ref: Any, key: str, where: str) -> None:
        si = sheet_of(ref, where)
        if si is not None and not inside(si, ref.get(key)):
            out.err(7, "point_outside", f"{where}: point {ref.get(key)!r} is not inside sheet "
                    f"{ref.get('sheet')!r}")

    def mech_ref(name: Any, kind: str, where: str) -> None:
        m = mechs.get(name)
        if m is None or m.get("type") != kind:
            out.err(7, "mechanism_reference", f"{where}: {name!r} is not a '{kind}' mechanism")

    for j in d.get("pliego:joins") or []:
        jid, t = j.get("id"), j.get("type")
        where = f"join {jid!r}"
        if t == "glue":
            si = sheet_of(j.get("a"), where)
            region = (j.get("a") or {}).get("region") or []
            if len(region) < 3:
                out.err(7, "glue_region", f"{where}: region needs ≥ 3 points")
            if si is not None:
                for p in region:
                    if not inside(si, p):
                        out.err(7, "glue_region", f"{where}: region point {p!r} lies outside "
                                f"sheet {j['a'].get('sheet')!r}")
            sb = sheet_of(j.get("b"), where)
            mp = j.get("map")
            if not (isinstance(mp, list) and len(mp) == 6):
                out.err(7, "glue_map", f"{where}: map must have 6 numbers")
            elif sb is not None:
                for p in region:
                    q = [mp[0] * p[0] + mp[1] * p[1] + mp[4], mp[2] * p[0] + mp[3] * p[1] + mp[5]]
                    if not inside(sb, q):
                        out.warn(7, "glue_target_outside", f"{where}: mapped point {q!r} lies "
                                 f"outside sheet {j['b'].get('sheet')!r}")
                        break
            if j.get("side") not in ("front", "back"):
                out.err(7, "glue_side", f"{where}: side must be front or back")
        elif t == "pivot":
            point(j.get("a"), "at", where)
            point(j.get("b"), "at", where)
        elif t == "string":
            point(j.get("a"), "at", where)
            b = j.get("b") or {}
            if "world" in b:
                if not _vec3(b.get("world")):
                    out.err(7, "world_point", f"{where}: b.world must be a 3-D point")
            else:
                point(b, "at", where)
            if not (isinstance(j.get("length"), int | float) and j["length"] > 0):
                out.err(7, "string_length", f"{where}: length must be positive")
        elif t == "pin":
            a = j.get("a") or {}
            if "along" in a:
                si = sheet_of(a, where)
                for p in a.get("along") or []:
                    if si is not None and not inside(si, p):
                        out.err(7, "point_outside", f"{where}: along point {p!r} outside sheet")
            else:
                point(a, "at", where)
            if j.get("world") is not None and not _vec3(j.get("world")):
                out.err(7, "world_point", f"{where}: world must be a 3-D point or null")
            if "mechanism" in j:
                mech_ref(j["mechanism"], "translate", where)
        elif t == "slider":
            point(j.get("a"), "at", where)
            tr = j.get("track") or {}
            si = sheet_of(tr, where)
            for key in ("from", "to"):
                if si is not None and not inside(si, tr.get(key)):
                    out.err(7, "point_outside", f"{where}: track {key} {tr.get(key)!r} outside")
            if "mechanism" in j:
                mech_ref(j["mechanism"], "slide", where)
        else:
            out.err(7, "join_type", f"{where}: unknown type {t!r}")

    for m in d.get("pliego:mechanisms") or []:
        mid, t = m.get("id"), m.get("type")
        where = f"mechanism {mid!r}"
        key = {"hinge": "angle_control", "slide": "control", "rotate": "control",
               "leaf": "control", "translate": "control"}.get(t)
        if key is None:
            out.err(7, "mechanism_type", f"{where}: unknown type {t!r}")
            continue
        if m.get(key) not in ctrls:
            out.err(7, "control_reference", f"{where}: control {m.get(key)!r} is not declared")
        for sid in m.get("sheets_moving") or []:
            if sid not in ids:
                out.err(7, "sheet_reference", f"{where}: moving sheet {sid!r} does not exist")
        if t == "hinge":
            ax = m.get("axis") or {}
            if not (_vec3(ax.get("origin")) and _vec3(ax.get("direction"))
                    and math.hypot(*ax["direction"]) > 0):
                out.err(7, "hinge_axis", f"{where}: axis needs origin and non-zero direction")
        elif t == "rotate":
            point(m.get("center"), "at", where)
        elif t == "leaf":
            si = sheet_of(m, where)
            for p in m.get("spine") or []:
                if si is not None and not inside(si, p):
                    out.err(7, "point_outside", f"{where}: spine point {p!r} outside the sheet")
        elif t == "translate":
            if not (_vec3(m.get("direction")) and math.hypot(*m["direction"]) > 0):
                out.err(7, "translate_direction", f"{where}: direction must be non-zero 3-D")
        if t in ("slide", "translate") and not (isinstance(m.get("travel"), int | float)
                                                and m["travel"] > 0):
            out.err(7, "travel", f"{where}: travel must be positive")

    for i, s in enumerate(d["pliego:sheets"]):
        kin = s.get("kinematic")
        if isinstance(kin, dict) and kin.get("mechanism") not in mechs:
            out.err(7, "mechanism_reference", f"sheet {s.get('id')!r}: kinematic mechanism "
                    f"{kin.get('mechanism')!r} does not exist", sheet=i)

    for c in d.get("pliego:controls") or []:
        where = f"control {c.get('id')!r}"
        if c.get("kind") not in ("angle", "distance", "sequence", "wind", "toggle"):
            out.err(7, "control_kind", f"{where}: unknown kind {c.get('kind')!r}")
        lo, hi, dv = c.get("min"), c.get("max"), c.get("default")
        if isinstance(dv, int | float) and not isinstance(dv, bool):
            if (isinstance(lo, int | float) and dv < lo) or (isinstance(hi, int | float)
                                                             and dv > hi):
                out.err(7, "control_default", f"{where}: default {dv} outside [{lo}, {hi}]")
    if d.get("pliego:sequence") and not any(c.get("kind") == "sequence" for c in ctrls.values()):
        out.err(7, "sequence_control", "a fold program exists but no 'sequence' control is "
                "declared")


def _rule7_print(d: dict, coords: list, out) -> None:
    """Spec §5.8: annotations resolve and lie on their sheet; pages are well formed, do not
    overlap, and every sheet lies inside a page's printable area (a warning otherwise)."""
    ids, inside, _ = _sheet_tools(d, coords)
    notes = d.get("pliego:annotations")
    if notes is not None and not isinstance(notes, list):
        out.err(7, "annotations", "pliego:annotations must be a list")
        notes = []
    for k, a in enumerate(notes or []):
        where = f"annotation {k}"
        if not isinstance(a, dict) or a.get("sheet") not in ids:
            sid = a.get("sheet") if isinstance(a, dict) else a
            out.err(7, "sheet_reference", f"{where}: sheet {sid!r} does not exist")
            continue
        if not inside(ids[a["sheet"]], a.get("at")):
            out.err(7, "point_outside", f"{where}: point {a.get('at')!r} is not inside sheet "
                    f"{a['sheet']!r}")
        text = a.get("text")
        if not (isinstance(text, str) and 1 <= len(text) <= 32 and text.isprintable()):
            out.err(7, "annotation_text", f"{where}: text must be 1–32 printable characters")
        size, ang = a.get("size"), a.get("angle", 0)
        if not (isinstance(size, int | float) and 0.5 <= size <= 50):
            out.err(7, "annotation_size", f"{where}: size {size!r} outside [0.5, 50] mm")
        if not (isinstance(ang, int | float) and math.isfinite(ang)):
            out.err(7, "annotation_angle", f"{where}: angle must be a finite number")
    pages = d.get("pliego:pages")
    if pages is None:
        return
    try:
        w, h = (float(x) for x in pages["size"])
        margin = float(pages.get("margin", 0))
        rects = [(p["id"], float(p["origin"][0]), float(p["origin"][1])) for p in pages["pages"]]
    except (KeyError, TypeError, ValueError, IndexError):
        out.err(7, "pages", "pliego:pages needs size [w, h], margin and pages[{id, origin}]")
        return
    if not (w > 0 and h > 0 and 0 <= margin < min(w, h) / 2 and rects):
        out.err(7, "pages", "pliego:pages: size > 0, 0 ≤ margin < half the page, ≥ 1 page")
        return
    pids = [r[0] for r in rects]
    if len(set(pids)) != len(pids):
        out.err(7, "duplicate_id", f"duplicate page ids {sorted(set(pids), key=str)}")
    for i, (a, ax, ay) in enumerate(rects):
        for b, bx, by in rects[i + 1:]:
            if ax < bx + w - 1e-9 and bx < ax + w - 1e-9 and ay < by + h - 1e-9 \
                    and by < ay + h - 1e-9:
                out.err(7, "pages_overlap", f"pages {a!r} and {b!r} overlap")
    vs = d["pliego:vertices_sheet"]
    for si, sheet in enumerate(d["pliego:sheets"]):
        pts = [coords[v] for v in range(len(coords)) if vs[v] == si and coords[v] is not None]
        if not pts:
            continue
        x0, y0 = min(p.x for p in pts), min(p.y for p in pts)
        x1, y1 = max(p.x for p in pts), max(p.y for p in pts)
        if not any(px + margin - 1e-6 <= x0 and x1 <= px + w - margin + 1e-6
                   and py + margin - 1e-6 <= y0 and y1 <= py + h - margin + 1e-6
                   for _pid, px, py in rects):
            out.warn(7, "sheet_off_page", f"sheet {sheet.get('id')!r} is not inside any "
                     "page's printable area", sheet=si)


def _vec3(v: Any) -> bool:
    return (isinstance(v, list) and len(v) == 3
            and all(isinstance(c, int | float) and math.isfinite(c) for c in v))


def _rule8_sequence(d: dict, out) -> None:
    seq = d.get("pliego:sequence")
    if not seq:
        return
    asg = d["edges_assignment"]
    ne = len(asg)
    steps = seq.get("steps") or []
    if seq.get("mode") not in ("physical", "kinematic"):
        out.err(8, "sequence_mode", f"sequence mode {seq.get('mode')!r} is not physical/kinematic")
    if not steps:
        out.err(8, "sequence_empty", "the fold program has no steps")
    sids = [s.get("id") for s in steps]
    dup = sorted({x for x in sids if sids.count(x) > 1}, key=str)
    if dup:
        out.err(8, "duplicate_id", f"duplicate step ids {dup}")
    for st in steps:
        where = f"step {st.get('id')!r}"
        for t in st.get("targets") or []:
            if not (isinstance(t, list) and len(t) == 2 and isinstance(t[0], int)
                    and 0 <= t[0] < ne):
                out.err(8, "target_reference", f"{where}: target {t!r} is not a valid edge")
                continue
            if asg[t[0]] not in ("M", "V", "F"):
                out.err(8, "target_assignment", f"{where}: edge {t[0]} is '{asg[t[0]]}', not "
                        "M/V/F", edge=t[0])
            if not (isinstance(t[1], int | float) and -180 <= t[1] <= 180):
                out.err(8, "target_angle", f"{where}: angle {t[1]!r} outside [−180, 180]",
                        edge=t[0])
        for r in st.get("release") or []:
            if not (isinstance(r, int) and 0 <= r < ne):
                out.err(8, "release_reference", f"{where}: release {r!r} is not a valid edge")
        dur = st.get("duration_ms")
        if not (isinstance(dur, int) and 100 <= dur <= 60000):
            out.err(8, "duration", f"{where}: duration_ms {dur!r} outside [100, 60000]")


def _rule9_initial(d: dict, coords: list, out) -> None:
    frames = d.get("file_frames") or []
    initial = next((f for f in frames if isinstance(f, dict)
                    and f.get("frame_title") == "initial"), None)
    placed = any(any(abs(c) > 1e-12 for c in ((s.get("placement") or {}).get("origin") or []))
                 or any(abs(c) > 1e-12 for c in ((s.get("placement") or {}).get("rotation")
                                                 or [0, 0, 0, 1])[:3])
                 for s in d["pliego:sheets"])
    if initial is None:
        if d.get("pliego:joins") or placed:
            out.err(9, "initial_missing", "joins or placements exist but there is no 'initial' "
                    "frame")
        return
    for f in frames:
        title = f.get("frame_title")
        level = out.err if title == "initial" else out.warn
        vc = f.get("vertices_coords")
        if not (isinstance(vc, list) and len(vc) == len(coords) and all(_vec3(p) for p in vc)):
            level(9, "frame_coords", f"frame {title!r}: vertices_coords must be {len(coords)} "
                  "3-D points")
            continue
        worst, worst_e = 0.0, -1
        for i, (a, b) in enumerate(d["edges_vertices"]):
            l2 = coords[a].distance(coords[b])
            if l2 <= 1e-9:
                continue
            rel = abs(dist(vc[a], vc[b]) - l2) / l2
            if rel > worst:
                worst, worst_e = rel, i
        if worst > 1e-3:
            level(9, "not_developable", f"frame {title!r}: edge {worst_e} length changes by "
                  f"{worst * 100:.3f}% (> 0.1%)", edge=worst_e)
        if title == "initial":
            _glue_welds(d, coords, vc, out)


def _glue_welds(d: dict, coords: list, vc: list, out) -> None:
    ids = {s.get("id"): i for i, s in enumerate(d["pliego:sheets"])}
    stocks = d.get("pliego:stocks") or {}

    def world(si: int, local: list[float]) -> list[float] | None:
        off = d["pliego:sheets"][si].get("offset") or [0, 0]
        p = Vec2(local[0] + off[0], local[1] + off[1])
        for f, s in zip(d["faces_vertices"], d["pliego:faces_sheet"], strict=True):
            if s != si or point_in_polygon(p, [coords[v] for v in f]) < 0:
                continue
            return _affine(p, [coords[v] for v in f], [vc[v] for v in f])
        return None

    for j in d.get("pliego:joins") or []:
        if j.get("type") != "glue":
            continue
        a, b = (j.get("a") or {}).get("sheet"), (j.get("b") or {}).get("sheet")
        if a not in ids or b not in ids or not isinstance(j.get("map"), list):
            continue
        sa, sb = ids[a], ids[b]
        tol = max(_ct(stocks, d["pliego:sheets"][sa]), _ct(stocks, d["pliego:sheets"][sb]))
        mp = j["map"]
        for p in j["a"].get("region") or []:
            q = [mp[0] * p[0] + mp[1] * p[1] + mp[4], mp[2] * p[0] + mp[3] * p[1] + mp[5]]
            wa, wb = world(sa, p), world(sb, q)
            if wa is None or wb is None:
                continue  # already reported by rule 7
            gap = dist(wa, wb)
            if gap > tol + 1e-9:
                out.err(9, "glue_weld", f"join {j.get('id')!r}: point {p} is {gap:.4f} mm from "
                        f"its weld (> collision_thickness {tol})")
                break


def _ct(stocks: dict, sheet: dict) -> float:
    try:
        return float(stocks[sheet["stock"]]["derived"]["collision_thickness"])
    except (KeyError, TypeError, ValueError):
        return 0.0


def _affine(p: Vec2, ring2: list[Vec2], ring3: list[list[float]]) -> list[float]:
    """Map a 2-D point of a planar face into 3-D using its first non-collinear vertex triple."""
    a = ring2[0]
    for k in range(1, len(ring2) - 1):
        b, c = ring2[k], ring2[k + 1]
        det = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
        if abs(det) > 1e-9:
            s = ((p.x - a.x) * (c.y - a.y) - (p.y - a.y) * (c.x - a.x)) / det
            t = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / det
            A, B, C = ring3[0], ring3[k], ring3[k + 1]
            return [A[i] + s * (B[i] - A[i]) + t * (C[i] - A[i]) for i in range(3)]
    return list(ring3[0])
