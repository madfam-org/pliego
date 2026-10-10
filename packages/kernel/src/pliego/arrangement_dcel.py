"""DCEL face tracing and J-edge bridging for ``arrangement`` (split out for the file-size gate).

Faces are traced with the face on the left of each half-edge. Counter-clockwise cycles bound
faces; clockwise / zero-area cycles are inner boundaries (holes, islands, floating lines) and are
bridged to their containing face with ``J`` edges. Faces that are not simple (dangling lines,
pinch vertices) are split with ``J`` edges from the offending vertex. The loop repeats until
every material face is a simple CCW polygon; Euler's formula is then checked (fail loud).
"""

from __future__ import annotations

import math
from functools import cmp_to_key

from .exact import GRID, IPoint, angle_cmp, on_segment, polygon_area2, segments_cross

Key = tuple[IPoint, IPoint]


def _trace(keys: list[Key]) -> list[list[IPoint]]:
    """All half-edge cycles (face on the left), deterministic order."""
    out: dict[IPoint, list[IPoint]] = {}
    for p, q in keys:
        out.setdefault(p, []).append(q)
        out.setdefault(q, []).append(p)
    order: dict[IPoint, list[IPoint]] = {}
    pos: dict[tuple[IPoint, IPoint], int] = {}
    for v, nbrs in out.items():
        srt = sorted(nbrs, key=cmp_to_key(
            lambda a, b, v=v: angle_cmp((a[0] - v[0], a[1] - v[1]), (b[0] - v[0], b[1] - v[1]))))
        order[v] = srt
        for i, w in enumerate(srt):
            pos[(v, w)] = i
    seen: set[tuple[IPoint, IPoint]] = set()
    cycles: list[list[IPoint]] = []
    for start in sorted(pos):
        if start in seen:
            continue
        cyc: list[IPoint] = []
        h = start
        while h not in seen:
            seen.add(h)
            u, v = h
            cyc.append(u)
            lst = order[v]
            i = pos[(v, u)]
            h = (v, lst[(i - 1) % len(lst)])
        cycles.append(cyc)
    return cycles


def _pip(p: tuple[float, float], ring: list[IPoint]) -> bool:
    """Even-odd point in ring (float point, integer ring; boundary handled by callers)."""
    inside = False
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        if (a[1] > p[1]) != (b[1] > p[1]):
            x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if x > p[0]:
                inside = not inside
    return inside


def _is_material(cyc: list[IPoint], left_of: dict[Key, bool]) -> bool:
    """A CCW cycle is material unless it runs along a boundary edge against its material side."""
    n = len(cyc)
    for i in range(n):
        p, q = cyc[i], cyc[(i + 1) % n]
        key = (p, q) if p < q else (q, p)
        side = left_of.get(key)
        if side is None:
            continue
        forward = key == (p, q)
        return forward == side
    return True


def _visible(p: IPoint, q: IPoint, keys: list[Key], verts: set[IPoint]) -> bool:
    for a, b in keys:
        if segments_cross(p, q, a, b):
            return False
    for v in verts:
        if v != p and v != q and on_segment(v, p, q):
            return False
    return True


def _choose(start: IPoint, targets: list[IPoint], keys: list[Key], verts: set[IPoint],
            inside, prefer: tuple[float, float] | None = None) -> IPoint | None:
    """Nearest visible target whose connecting segment stays inside the face."""
    existing = set(keys)

    def score(t: IPoint) -> tuple:
        dx, dy = t[0] - start[0], t[1] - start[1]
        d2 = dx * dx + dy * dy
        bucket = 0
        if prefer is not None and d2 > 0:
            c = (dx * prefer[0] + dy * prefer[1]) / math.sqrt(d2)
            bucket = 0 if c >= 0.5 else (1 if c >= -0.5 else 2)
        return (bucket, d2, t)

    for t in sorted({t for t in targets if t != start}, key=score):
        key = (start, t) if start < t else (t, start)
        if key in existing:
            continue
        mid = ((start[0] + t[0]) / 2.0, (start[1] + t[1]) / 2.0)
        if not inside(mid):
            continue
        if _visible(start, t, keys, verts):
            return t
    return None


def _split_lobes(cyc: list[IPoint], keys: list[Key], verts: set[IPoint], inside) -> Key | None:
    """J edge joining the two lobes of a cycle at a repeated (pinch / bridge) vertex."""
    existing = set(keys)
    n = len(cyc)
    seen: set[IPoint] = set()
    for i, v in enumerate(cyc):
        if v in seen:
            continue
        seen.add(v)
        j = next((k for k in range(i + 1, n) if cyc[k] == v), None)
        if j is None:
            continue
        lobe_a = set(cyc[i + 1:j]) - {v}
        lobe_b = set(cyc[j + 1:] + cyc[:i]) - {v}
        pairs = sorted(((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2, min(p, q), max(p, q))
                       for p in lobe_a for q in lobe_b if p != q)
        for _, p, q in pairs:
            if (p, q) in existing:
                continue
            if inside(((p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0)) and _visible(p, q, keys, verts):
                return (p, q)
    return None


def finish_faces(kept: dict[Key, dict], warnings: list[dict]):
    """Trace faces, bridge with J edges, canonicalise; returns an ``Arrangement``."""
    from .arrangement import Arrangement, ArrangementError, priority

    edges = dict(kept)
    limit = 4 * len(edges) + 16
    for _ in range(limit):
        keys = sorted(edges)
        left_of = {k: e["left"] == k for k, e in edges.items() if e["left"] is not None}
        verts = {p for k in keys for p in k}
        cycles = _trace(keys)
        outer: list[list[IPoint]] = []
        inner: list[list[IPoint]] = []
        for cyc in cycles:
            (outer if polygon_area2(cyc) > 0 else inner).append(cyc)
        material = [c for c in outer if _is_material(c, left_of)]
        new_edge: Key | None = None
        # (a) inner boundaries lying inside a material face → bridge
        hosts: list[list[IPoint] | None] = []
        for cyc in inner:
            probe = min(cyc)
            containers = [c for c in outer if probe not in c and _pip(probe, c)]
            hosts.append(min(containers, key=lambda c: (polygon_area2(c), min(c)))
                         if containers else None)
        for cyc, host in zip(inner, hosts, strict=True):
            if host is None or host not in material:
                continue
            probe = min(cyc)
            others = [o for o, h in zip(inner, hosts, strict=True) if h is host and o is not cyc]

            def inside(m, host=host, holes_=(cyc, *others)):
                if not _pip(m, host):
                    return False
                return not any(polygon_area2(o) != 0 and _pip(m, o) for o in holes_)

            targets = list(host) + [v for o in others for v in o]
            t = _choose(probe, targets, keys, verts, inside)
            if t is None:
                raise ArrangementError(f"cannot bridge inner boundary at {_mm(probe)}")
            new_edge = (probe, t) if probe < t else (t, probe)
            break
        # (b) non-simple material faces → split from a tip or a repeated vertex
        if new_edge is None:
            for cyc in material:
                if len(set(cyc)) == len(cyc):
                    continue
                n = len(cyc)
                tips = sorted(cyc[i] for i in range(n) if cyc[i - 1] == cyc[(i + 1) % n])

                def inside_cyc(m, cyc=cyc):
                    return _pip(m, cyc)

                for s in tips:
                    i = cyc.index(s)
                    nb = cyc[i - 1]
                    dx, dy = s[0] - nb[0], s[1] - nb[1]
                    ln = math.hypot(dx, dy) or 1.0
                    t = _choose(s, cyc, keys, verts, inside_cyc, (dx / ln, dy / ln))
                    if t is not None:
                        new_edge = (s, t) if s < t else (t, s)
                        break
                if new_edge is None:
                    new_edge = _split_lobes(cyc, keys, verts, inside_cyc)
                if new_edge is None:
                    raise ArrangementError(f"cannot split non-simple face at {_mm(min(cyc))}")
                break
        if new_edge is None:
            return _canonical(edges, material, len(outer) - len(material), warnings,
                              Arrangement, ArrangementError)
        edges[new_edge] = {"attrs": (priority("J", "none"), 0.0, 0.0, "J", "none"),
                           "tags": set(), "left": None}
    raise ArrangementError("J-edge bridging did not converge")


def _mm(p: IPoint) -> str:
    return f"({p[0] / GRID:.4f}, {p[1] / GRID:.4f})"


def _canonical(edges: dict[Key, dict], material: list[list[IPoint]], holes: int,
               warnings: list[dict], arrangement_cls, error_cls):
    verts = sorted({p for k in edges for p in k})
    index = {p: i for i, p in enumerate(verts)}
    ekeys = sorted(edges, key=lambda k: (index[k[0]], index[k[1]]))
    faces = []
    for cyc in material:
        ids = [index[p] for p in cyc]
        m = ids.index(min(ids))
        faces.append(ids[m:] + ids[:m])
    faces.sort()
    arr = arrangement_cls(
        grid=verts,
        edges=[(index[a], index[b]) for a, b in ekeys],
        assignment=[edges[k]["attrs"][3] for k in ekeys],
        fold_angle=[edges[k]["attrs"][2] for k in ekeys],
        treatment=[edges[k]["attrs"][4] for k in ekeys],
        tags=[tuple(sorted(edges[k]["tags"])) for k in ekeys],
        faces=faces,
        hole_faces=holes,
        warnings=warnings,
    )
    lhs, rhs = arr.euler()
    if lhs != rhs:
        raise error_cls(f"Euler check failed: V − E + F + H = {lhs} but 1 + components = {rhs}")
    return arr
