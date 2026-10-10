"""DCEL face tracing and J-edge bridging for ``arrangement`` (split out for the file-size gate).

Faces are traced with the face on the left of each half-edge. Counter-clockwise cycles bound
faces; clockwise / zero-area cycles are inner boundaries (holes, islands, floating lines) and are
bridged to their containing face with ``J`` edges. Faces that are not simple (dangling lines,
pinch vertices) are split with ``J`` edges from the offending vertex. The loop repeats until
every material face is a simple CCW polygon; Euler's formula is then checked (fail loud).

Batching (kernel 0.2): one pass bridges *every* inner boundary, each with **two** J edges — the
nearest visible bridge from its lowest vertex and a second one from the hole vertex farthest from
the first bridge, to a different target — so a hole splits its face into two simple faces at
once instead of leaving a pinch for a later pass. New bridges are visibility-checked against the
bridges already chosen in the pass, so they never cross. Opposite bridges also avoid the thin
J-bounded slivers that two adjacent bridges create; `verify()` additionally floors face area per
J-joined region (J edges are artificial). A sheet with 40 holes now needs ~3 passes, not ~80.
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
    """No edge properly crosses pq and no vertex lies on it (exact; bounding-box prefilter —
    a segment or vertex outside pq's box can neither cross it nor lie on it)."""
    x0, x1 = (p[0], q[0]) if p[0] <= q[0] else (q[0], p[0])
    y0, y1 = (p[1], q[1]) if p[1] <= q[1] else (q[1], p[1])
    for a, b in keys:
        if (a[0] < x0 and b[0] < x0) or (a[0] > x1 and b[0] > x1) \
                or (a[1] < y0 and b[1] < y0) or (a[1] > y1 and b[1] > y1):
            continue
        if segments_cross(p, q, a, b):
            return False
    for v in verts:
        if x0 <= v[0] <= x1 and y0 <= v[1] <= y1 and v != p and v != q and on_segment(v, p, q):
            return False
    return True


def _choose(start: IPoint, targets: list[IPoint], keys: list[Key], verts: set[IPoint],
            inside, prefer: tuple[float, float] | None = None,
            avoid: frozenset[IPoint] = frozenset()) -> IPoint | None:
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

    for t in sorted({t for t in targets if t != start and t not in avoid}, key=score):
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
        new_edges: list[Key] = []
        work = list(keys)      # visibility sees the bridges already chosen in this pass
        # (a) inner boundaries lying inside a material face → two bridges each
        hosts: list[list[IPoint] | None] = []
        for cyc in inner:
            probe = min(cyc)
            containers = [c for c in outer if probe not in c and _pip(probe, c)]
            hosts.append(min(containers, key=lambda c: (polygon_area2(c), min(c)))
                         if containers else None)
        new_edges += _bridge_pass(inner, hosts, material, work, verts)
        # (b) non-simple material faces → split from a tip or a repeated vertex
        new_edge: Key | None = None
        if not new_edges:
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
        if new_edge is not None:
            new_edges.append(new_edge)
        if not new_edges:
            return _canonical(edges, material, len(outer) - len(material), warnings,
                              Arrangement, ArrangementError)
        for e in new_edges:
            edges[e] = {"attrs": (priority("J", "none"), 0.0, 0.0, "J", "none"),
                        "tags": set(), "left": None}
    raise ArrangementError("J-edge bridging did not converge")


def _bridge_pass(inner: list[list[IPoint]], hosts: list, material: list[list[IPoint]],
                 work: list[Key], verts: set[IPoint]) -> list[Key]:
    """Bridge every inner boundary of a material face (two J edges each), in one pass.

    A hole may attach only to its host face's boundary or to holes already attached in this
    pass, never to a pending one: holes cannot bridge to each other twice (no J-only triangles)
    and each attachment really merges a component. A hole with no visible target yet waits for
    the next round of the pass; a pass that attaches nothing fails loud."""
    from .arrangement import ArrangementError

    pending = [(cyc, host) for cyc, host in zip(inner, hosts, strict=True)
               if host is not None and any(host is m for m in material)]
    attached: dict[int, list[IPoint]] = {}
    out: list[Key] = []
    while pending:
        waiting = []
        for cyc, host in pending:
            probe = min(cyc)
            others = [o for o, h in zip(inner, hosts, strict=True) if h is host and o is not cyc]

            def inside(m, host=host, holes_=(cyc, *others)):
                if not _pip(m, host):
                    return False
                return not any(polygon_area2(o) != 0 and _pip(m, o) for o in holes_)

            targets = list(host) + attached.get(id(host), [])
            used = frozenset(v for k in out for v in k)
            t = _choose(probe, targets, work, verts, inside, avoid=used) \
                or _choose(probe, targets, work, verts, inside)
            if t is None:
                waiting.append((cyc, host))
                continue
            first = (probe, t) if probe < t else (t, probe)
            out.append(first)
            work.append(first)
            second = _second_bridge(cyc, probe, t, targets, work, verts, inside,
                                    used | {t, probe})
            if second is not None:
                out.append(second)
                work.append(second)
            attached.setdefault(id(host), []).extend(cyc)
        if len(waiting) == len(pending):
            raise ArrangementError(
                f"cannot bridge inner boundary at {_mm(min(waiting[0][0]))}")
        pending = waiting
    return out


def _second_bridge(cyc: list[IPoint], probe: IPoint, t: IPoint, targets: list[IPoint],
                   work: list[Key], verts: set[IPoint], inside,
                   prefer_avoid: frozenset[IPoint]) -> Key | None:
    """A second bridge from the inner boundary, starting at its vertices farthest from the
    first bridge's start, to a target other than the first one — preferring targets no bridge
    of this pass ends at (shared endpoints make thin triangles); None when none is visible."""
    starts = sorted({v for v in cyc if v != probe},
                    key=lambda v: (-((v[0] - probe[0]) ** 2 + (v[1] - probe[1]) ** 2), v))
    for avoid in (prefer_avoid, frozenset((t, probe))):
        for s in starts:
            if s in prefer_avoid and avoid is prefer_avoid:
                continue
            u = _choose(s, targets, work, verts, inside, avoid=avoid)
            if u is not None:
                return (s, u) if s < u else (u, s)
    return None


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
