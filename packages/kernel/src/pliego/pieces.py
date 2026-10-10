"""Removable pieces, sheet stacks and tear-away (sheet-document spec §5.8, rules §8.11–§8.12).

A **piece** is one separable region of a sheet: a maximal group of faces connected across edges
that do not separate material. Separating edges are the outline (`B`), cuts and tear-off
perforations (`C`, treatment `cut` / `perforation`) and kiss cuts (`F` + `halfcut`). A piece is
marked `keep` (part of the object) or `excess` (meant to come away). A fold-program step's
`remove` list takes excess pieces out of the model, top to bottom in a reveal block.

A **stack** is an ordered pile of congruent sheets (bottom → top) whose mid-planes are `pitch_mm`
apart along the sheets' common normal; each document sheet may stand for `represents` identical
physical sheets (a coarse preview of a 500-sheet block), so `pitch_mm = represents × caliper`.

Builders return authoring dicts; `Assembly.build()` resolves each piece's faces (from a point
inside it, or from sheet-local face indices) and writes ``pliego:pieces`` / ``pliego:stacks``.
"""

from __future__ import annotations

import math
from collections.abc import Sequence as Seq
from typing import Any

from .geometry import PointLike, Vec2, as_vec, point_in_polygon
from .sheet import Sheet, check_slug, i18n

ROLES = ("keep", "excess")
BONDS = ("none", "keep", "all")
BINDING_KINDS = ("padding",)
PITCH_TOL_MM = 1e-5      # emitted coordinates sit on a 1e-6 mm grid
PITCH_REL_TOL = 1e-6


def separates(assignment: str, treatment: str) -> bool:
    """True when an edge separates material: outline, cut / tear-off perforation, kiss cut."""
    return assignment in ("B", "C") or (assignment == "F" and treatment == "halfcut")


def _sid(ref: Sheet | str) -> str:
    return ref.id if isinstance(ref, Sheet) else check_slug(ref, "sheet reference")


def piece(id: str, sheet: Sheet | str, *, at: PointLike | None = None,
          faces: Seq[int] | None = None, role: str = "excess",
          label: str | dict | None = None, pull: Seq[float] | None = None) -> dict:
    """A removable piece of `sheet`: give a sheet-local point `at` inside it, or the sheet-local
    face indices `faces` of its arrangement. `role` is keep | excess. `pull` (optional, world) is
    the direction a hand draws the piece away when it is removed (default: the sheet's front
    normal — lifted off the top)."""
    if (at is None) == (faces is None):
        raise ValueError(f"piece '{id}': give exactly one of at=(u, v) or faces=[…]")
    if role not in ROLES:
        raise ValueError(f"piece '{id}': role must be one of {ROLES}")
    p: dict[str, Any] = {"id": check_slug(id, "piece id"), "sheet": _sid(sheet), "role": role}
    if at is not None:
        v = as_vec(at)
        p["at"] = [v.x, v.y]
    else:
        idx = [int(f) for f in faces or []]
        if not idx or any(f < 0 for f in idx):
            raise ValueError(f"piece '{id}': faces must be non-empty sheet-local indices")
        p["faces_local"] = idx
    if label is not None:
        p["label"] = i18n(label, id)
    if pull is not None:
        d = [float(c) for c in pull]
        if len(d) != 3 or not all(math.isfinite(c) for c in d) or math.hypot(*d) < 1e-12:
            raise ValueError(f"piece '{id}': pull must be a non-zero 3-D vector")
        p["pull"] = d
    return p


def stack(id: str, sheets: Seq[Sheet | str], pitch_mm: float, *, represents: int = 1,
          bond: str = "keep", binding: tuple[PointLike, PointLike] | None = None,
          binding_kind: str = "padding") -> dict:
    """An ordered stack of sheets, bottom → top, `pitch_mm` apart (mid-plane to mid-plane).

    `represents`: physical sheets each document sheet stands for (1 for fabrication).
    `bond`: none (contact and friction only) | keep (keep pieces and uncut faces bonded to the
    sheet below where they overlap — selective adhesive, as in laminated-object manufacturing) |
    all (a fully bonded laminate). `binding`: a sheet-local segment where the stack is padded
    (the glued spine of a memo block); pieces touching it are held by the padding."""
    ids = [_sid(s) for s in sheets]
    if len(ids) < 2:
        raise ValueError(f"stack '{id}': needs at least two sheets")
    if len(set(ids)) != len(ids):
        raise ValueError(f"stack '{id}': a sheet appears twice")
    if not (math.isfinite(pitch_mm) and pitch_mm > 0):
        raise ValueError(f"stack '{id}': pitch_mm must be > 0")
    if isinstance(represents, bool) or not isinstance(represents, int) or represents < 1:
        raise ValueError(f"stack '{id}': represents must be an integer ≥ 1")
    if bond not in BONDS:
        raise ValueError(f"stack '{id}': bond must be one of {BONDS}")
    s: dict[str, Any] = {"id": check_slug(id, "stack id"), "sheets": ids,
                         "pitch_mm": float(pitch_mm), "represents": represents, "bond": bond}
    if binding is not None:
        if binding_kind not in BINDING_KINDS:
            raise ValueError(f"stack '{id}': binding kind must be one of {BINDING_KINDS}")
        a, b = as_vec(binding[0]), as_vec(binding[1])
        if a.distance(b) <= 1e-9:
            raise ValueError(f"stack '{id}': binding needs two distinct points")
        s["binding"] = {"kind": binding_kind, "edge": [[a.x, a.y], [b.x, b.y]]}
    return s


# ── separable regions ────────────────────────────────────────────────────────


def regions(faces: Seq[Seq[int]], edge_attrs: dict[frozenset, tuple[str, str]]
            ) -> list[list[int]]:
    """Groups of faces connected across non-separating edges (authored face order kept).

    `edge_attrs` maps each edge's vertex pair to (assignment, treatment)."""
    parent = list(range(len(faces)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    owner: dict[frozenset, int] = {}
    for fi, f in enumerate(faces):
        for k in range(len(f)):
            side = frozenset((f[k], f[(k + 1) % len(f)]))
            attrs = edge_attrs.get(side)
            if attrs is None or separates(*attrs):
                continue
            g = owner.setdefault(side, fi)
            if g != fi:
                ra, rg = find(fi), find(g)
                if ra != rg:
                    parent[max(ra, rg)] = min(ra, rg)
    groups: dict[int, list[int]] = {}
    for i in range(len(faces)):
        groups.setdefault(find(i), []).append(i)
    return [groups[k] for k in sorted(groups)]


def arrangement_regions(arr) -> list[list[int]]:
    """Separable regions of one sheet's arrangement (sheet-local face indices)."""
    attrs = {frozenset(e): (a, t) for e, a, t in zip(arr.edges, arr.assignment, arr.treatment,
                                                     strict=True)}
    return regions(arr.faces, attrs)


def interior_point(ring: Seq[Vec2]) -> Vec2:
    """A point strictly inside a simple polygon: the centroid of one of its ears."""
    n = len(ring)
    area2 = sum(ring[i].x * ring[(i + 1) % n].y - ring[(i + 1) % n].x * ring[i].y
                for i in range(n))
    sign = 1.0 if area2 > 0 else -1.0
    for i in range(n):
        a, b, c = ring[i - 1], ring[i], ring[(i + 1) % n]
        cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
        if cross * sign <= 1e-12:
            continue
        tri = [a, b, c]
        if any(point_in_polygon(p, tri) >= 0 for j, p in enumerate(ring)
               if j not in (i - 1 if i else n - 1, i, (i + 1) % n)):
            continue
        g = Vec2((a.x + b.x + c.x) / 3.0, (a.y + b.y + c.y) / 3.0)
        if point_in_polygon(g, ring) == 1:
            return g
    raise ValueError("polygon has no ear (degenerate)")


def resolve_pieces(pieces: Seq[dict], sheets: Seq[Sheet], arrs: Seq[Any],
                   face_base: Seq[int]) -> list[dict]:
    """Authoring dicts → ``pliego:pieces`` entries with global face indices."""
    index = {s.id: i for i, s in enumerate(sheets)}
    cache: dict[int, list[list[int]]] = {}
    out = []
    for p in pieces:
        si = index.get(p["sheet"])
        if si is None:
            raise ValueError(f"piece '{p['id']}': sheet '{p['sheet']}' is not in the assembly")
        arr = arrs[si]
        if "faces_local" in p:
            local = list(p["faces_local"])
            if any(f >= len(arr.faces) for f in local):
                raise ValueError(f"piece '{p['id']}': face index out of range for sheet "
                                 f"'{p['sheet']}'")
        else:
            at = Vec2(*p["at"])
            verts = arr.vertices
            hit = next((fi for fi, f in enumerate(arr.faces)
                        if point_in_polygon(at, [verts[v] for v in f]) == 1), None)
            if hit is None:
                raise ValueError(f"piece '{p['id']}': point {p['at']} is not strictly inside a "
                                 f"face of sheet '{p['sheet']}'")
            regs = cache.setdefault(si, arrangement_regions(arr))
            local = next(r for r in regs if hit in r)
        entry: dict[str, Any] = {"id": p["id"], "sheet": p["sheet"], "role": p["role"],
                                 "faces": [face_base[si] + f for f in local]}
        for key in ("label", "pull"):
            if key in p:
                entry[key] = p[key]
        out.append(entry)
    ids = [e["id"] for e in out]
    dup = sorted({x for x in ids if ids.count(x) > 1})
    if dup:
        raise ValueError(f"duplicate piece ids {dup}")
    return out


# ── spec §8.11 (pieces and removal) and §8.12 (stacks) for `document_verify` ─────


def _slug(v: Any) -> bool:
    from .sheet import SLUG

    return isinstance(v, str) and bool(SLUG.match(v)) and len(v) <= 80


def _vec3(v: Any) -> bool:
    return (isinstance(v, list) and len(v) == 3 and all(
        isinstance(c, int | float) and not isinstance(c, bool) and math.isfinite(c) for c in v))


def rule11_pieces(d: dict, out) -> None:
    """Pieces resolve, sit on their sheet, are whole separable regions and do not overlap;
    every step `remove` names an excess piece, once across the program."""
    pieces = d.get("pliego:pieces")
    steps = (d.get("pliego:sequence") or {}).get("steps") or []
    removals = [(st.get("id"), r) for st in steps if isinstance(st, dict)
                for r in (st.get("remove") or [])]
    if pieces is None:
        for sid, r in removals:
            out.err(11, "piece_reference", f"step {sid!r}: removes {r!r} but the document "
                    "declares no pliego:pieces")
        return
    if not isinstance(pieces, list):
        out.err(11, "pieces_type", "pliego:pieces must be an array")
        return
    sheets = {s.get("id"): i for i, s in enumerate(d["pliego:sheets"])}
    fsheet, nf = d["pliego:faces_sheet"], len(d["faces_vertices"])
    attrs = {frozenset(e): (a, t) for e, a, t in zip(
        d["edges_vertices"], d["edges_assignment"],
        d.get("pliego:edges_treatment") or ["none"] * len(d["edges_vertices"]), strict=True)}
    region_of: dict[int, int] = {}
    for k, reg in enumerate(regions(d["faces_vertices"], attrs)):
        for f in reg:
            region_of[f] = k
    region_size: dict[int, int] = {}
    for k in region_of.values():
        region_size[k] = region_size.get(k, 0) + 1
    owner: dict[int, str] = {}
    table: dict[str, dict] = {}
    for p in pieces:
        pid = p.get("id") if isinstance(p, dict) else None
        where = f"piece {pid!r}"
        if not isinstance(p, dict) or not _slug(pid):
            out.err(11, "piece_id", f"{where}: id must be a kebab-case slug")
            continue
        if pid in table:
            out.err(11, "duplicate_id", f"duplicate piece id {pid!r}")
            continue
        table[pid] = p
        if p.get("role") not in ROLES:
            out.err(11, "piece_role", f"{where}: role {p.get('role')!r} is not keep/excess")
        si = sheets.get(p.get("sheet"))
        if si is None:
            out.err(11, "sheet_reference", f"{where}: sheet {p.get('sheet')!r} does not exist")
            continue
        faces = p.get("faces")
        if not (isinstance(faces, list) and faces and all(
                isinstance(f, int) and not isinstance(f, bool) and 0 <= f < nf for f in faces)):
            out.err(11, "piece_faces", f"{where}: faces must be a non-empty list of face indices")
            continue
        off = [f for f in faces if fsheet[f] != si]
        if off:
            out.err(11, "piece_sheet", f"{where}: faces {off[:5]} are not on sheet "
                    f"{p.get('sheet')!r}")
            continue
        for f in faces:
            if f in owner:
                out.err(11, "piece_overlap", f"{where}: face {f} already belongs to piece "
                        f"{owner[f]!r}", face=f)
            owner[f] = pid
        regs = {region_of[f] for f in faces}
        if len(regs) != 1 or len(set(faces)) != region_size[next(iter(regs))]:
            out.err(11, "piece_region", f"{where}: its faces are not exactly one separable region "
                    "(a group of faces bounded by outline, cut, perforation or kiss-cut edges)")
        if "pull" in p and not (_vec3(p["pull"]) and math.hypot(*p["pull"]) > 0):
            out.err(11, "piece_pull", f"{where}: pull must be a non-zero 3-D vector")
    removed: dict[str, str] = {}
    for sid, r in removals:
        where = f"step {sid!r}"
        p = table.get(r) if isinstance(r, str) else None
        if p is None:
            out.err(11, "piece_reference", f"{where}: removes {r!r}, which is not a piece")
        elif p.get("role") != "excess":
            out.err(11, "remove_keep", f"{where}: removes {r!r}, a '{p.get('role')}' piece "
                    "(only excess pieces come away)")
        elif r in removed:
            out.err(11, "remove_twice", f"{where}: {r!r} was already removed in step "
                    f"{removed[r]!r}")
        else:
            removed[r] = sid


def _rot_y(q: list[float]) -> tuple[float, float, float]:
    x, y, z, w = q
    return (2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w))


def rule12_stacks(d: dict, inside, out) -> None:
    """Stacks name existing sheets once each; congruent placements `pitch_mm` apart along the
    common normal; pitch = represents × caliper; the binding edge lies on every sheet."""
    stacks = d.get("pliego:stacks")
    if stacks is None:
        return
    if not isinstance(stacks, list):
        out.err(12, "stacks_type", "pliego:stacks must be an array")
        return
    sheets = d["pliego:sheets"]
    ids = {s.get("id"): i for i, s in enumerate(sheets)}
    stocks = d.get("pliego:stocks") or {}
    seen_ids: set = set()
    member: dict[str, str] = {}
    for st in stacks:
        sid = st.get("id") if isinstance(st, dict) else None
        where = f"stack {sid!r}"
        if not isinstance(st, dict) or not _slug(sid) or sid in seen_ids:
            out.err(12, "stack_id", f"{where}: id must be a unique kebab-case slug")
            continue
        seen_ids.add(sid)
        names = st.get("sheets")
        if not (isinstance(names, list) and len(names) >= 2):
            out.err(12, "stack_sheets", f"{where}: needs at least two sheets")
            continue
        idx = []
        for n in names:
            if n not in ids:
                out.err(12, "sheet_reference", f"{where}: sheet {n!r} does not exist")
            elif n in member:
                out.err(12, "stack_member", f"{where}: sheet {n!r} is already in stack "
                        f"{member[n]!r}")
            else:
                member[n] = sid
                idx.append(ids[n])
        pitch, rep = st.get("pitch_mm"), st.get("represents", 1)
        if not (isinstance(pitch, int | float) and math.isfinite(pitch) and pitch > 0):
            out.err(12, "stack_pitch", f"{where}: pitch_mm must be > 0")
            continue
        if isinstance(rep, bool) or not isinstance(rep, int) or rep < 1:
            out.err(12, "stack_represents", f"{where}: represents must be an integer ≥ 1")
            continue
        if st.get("bond", "keep") not in BONDS:
            out.err(12, "stack_bond", f"{where}: bond {st.get('bond')!r} is not one of {BONDS}")
        if len(idx) != len(names):
            continue
        for i in idx:
            cal = (stocks.get(sheets[i].get("stock")) or {}).get("caliper_mm")
            if isinstance(cal, int | float) and abs(rep * cal - pitch) > max(
                    PITCH_TOL_MM, PITCH_REL_TOL * pitch):
                out.err(12, "stack_pitch", f"{where}: pitch_mm {pitch} ≠ represents {rep} × "
                        f"caliper {cal} of sheet {sheets[i].get('id')!r}")
                break
        _stack_placements(st, [sheets[i] for i in idx], float(pitch), where, out)
        b = st.get("binding")
        if b is not None:
            edge = b.get("edge") if isinstance(b, dict) else None
            if not isinstance(b, dict) or b.get("kind") not in BINDING_KINDS or not (
                    isinstance(edge, list) and len(edge) == 2):
                out.err(12, "stack_binding", f"{where}: binding needs kind 'padding' and a "
                        "two-point edge")
                continue
            for i in idx:
                if not all(inside(i, p) for p in edge):
                    out.err(12, "stack_binding", f"{where}: binding edge {edge} is not on sheet "
                            f"{sheets[i].get('id')!r}")
                    break


def _stack_placements(st: dict, members: list[dict], pitch: float, where: str, out) -> None:
    def pl(s: dict) -> tuple[list[float], list[float]]:
        p = s.get("placement") or {}
        return list(p.get("origin") or [0, 0, 0]), list(p.get("rotation") or [0, 0, 0, 1])

    o0, q0 = pl(members[0])
    n = _rot_y(q0)
    for k in range(1, len(members)):
        o, q = pl(members[k])
        if max(abs(a - b) for a, b in zip(q, q0, strict=True)) > 1e-9:
            out.err(12, "stack_placement", f"{where}: sheet {members[k].get('id')!r} is not "
                    "parallel to the bottom sheet (rotations differ)")
            return
        want = [o0[i] + k * pitch * n[i] for i in range(3)]
        gap = math.dist(o, want)
        if gap > PITCH_TOL_MM * (1 + k):
            out.err(12, "stack_placement", f"{where}: sheet {members[k].get('id')!r} sits "
                    f"{gap:.6f} mm from {k} × pitch along the stack normal")
            return
