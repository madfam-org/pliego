"""Split vertices along cuts (spec §4: a `cut` separates the sheet; its vertices are split).

After face tracing every edge still has one vertex per point, so the two sides of a slit share
the slit's vertices and a zero-width slit cannot open in a 3-D frame. `split_cuts` gives each side
its own copies:

* around each vertex, the faces that touch it are grouped across the edges that do **not**
  separate material (everything except `C` edges with treatment `cut`);
* a vertex whose faces fall into k > 1 groups becomes k vertices — the group holding the lowest
  face index keeps the original id, the others get new ids appended after every existing vertex;
* a cut edge whose two sides now reach different vertices becomes two edges (the twin, with the
  same attributes and tags, is appended after every existing edge); each borders one face.

So a slit opens wherever it can: along its interior vertices and where it reaches the outline,
while an interior tip (all its faces still joined around the far side) stays one vertex. A slit
made of a single segment with both ends inside the sheet has no vertex to split and stays one
edge between two faces. A closed cut frees its island completely. Tear-off perforations (`C` +
`perforation`) stay joined: they part only when they tear (engine).

Appending keeps every existing index — documents without cuts are byte-identical — and the order
of new vertices and edges is deterministic (by original id). The Euler check is kept exact: each
opened slit that encloses a zero-area gap counts as one hole face.
"""

from __future__ import annotations

from dataclasses import replace


def _cut(arr, e: int) -> bool:
    return arr.assignment[e] == "C" and arr.treatment[e] == "cut"


def split_cuts(arr):
    """Return `arr` with vertices split along its cut edges (or `arr` itself when it has none)."""
    if not any(_cut(arr, e) for e in range(len(arr.edges))):
        return arr
    half: dict[tuple[int, int], int] = {}
    vfaces: dict[int, list[int]] = {}
    for fi, f in enumerate(arr.faces):
        for k, v in enumerate(f):
            half[(v, f[(k + 1) % len(f)])] = fi
            vfaces.setdefault(v, []).append(fi)
    eidx = {}
    for i, (a, b) in enumerate(arr.edges):
        eidx[(a, b)] = eidx[(b, a)] = i
    touched = sorted({v for e in range(len(arr.edges)) if _cut(arr, e) for v in arr.edges[e]})

    # vertex id per (vertex, face) for split vertices
    remap: dict[tuple[int, int], int] = {}
    grid = list(arr.grid)
    for v in touched:
        faces = sorted(set(vfaces.get(v, [])))
        parent = {f: f for f in faces}

        def find(f: int, parent: dict[int, int] = parent) -> int:
            while parent[f] != f:
                parent[f] = parent[parent[f]]
                f = parent[f]
            return f

        for f in faces:
            ring = arr.faces[f]
            k = ring.index(v)
            for w in (ring[(k + 1) % len(ring)], ring[k - 1]):
                if _cut(arr, eidx[(v, w)]):
                    continue
                g = half.get((w, v)) if w == ring[(k + 1) % len(ring)] else half.get((v, w))
                if g is not None:
                    ra, rb = find(f), find(g)
                    if ra != rb:
                        parent[max(ra, rb)] = min(ra, rb)
        roots = sorted({find(f) for f in faces})
        if len(roots) < 2:
            continue
        ids = {roots[0]: v}
        for r in roots[1:]:
            ids[r] = len(grid)
            grid.append(arr.grid[v])
        for f in faces:
            remap[(v, f)] = ids[find(f)]

    if len(grid) == len(arr.grid):
        return arr
    faces = [[remap.get((v, fi), v) for v in f] for fi, f in enumerate(arr.faces)]
    edges = list(arr.edges)
    extra: list[int] = []
    for i, (a, b) in enumerate(arr.edges):
        sides = sorted(fi for fi in (half.get((a, b)), half.get((b, a))) if fi is not None)
        if not sides:
            continue
        mapped = [(remap.get((a, fi), a), remap.get((b, fi), b)) for fi in sides]
        edges[i] = mapped[0]
        if len(mapped) == 2 and mapped[1] != mapped[0]:
            if not _cut(arr, i):
                raise ValueError(f"split_cuts: uncut edge {i} would split")  # cannot happen
            edges.append(mapped[1])
            extra.append(i)
    out = replace(
        arr, grid=grid, edges=edges,
        assignment=arr.assignment + [arr.assignment[i] for i in extra],
        fold_angle=arr.fold_angle + [arr.fold_angle[i] for i in extra],
        treatment=arr.treatment + [arr.treatment[i] for i in extra],
        tags=arr.tags + [arr.tags[i] for i in extra],
        faces=faces, warnings=list(arr.warnings))
    out.__dict__.pop("_vertices", None)
    # Euler: V − E + F + H + 1 = 1 + components → the opened gaps are new hole faces
    _, rhs = out.euler()
    lhs_without_h = len(out.grid) - len(out.edges) + len(out.faces) + 1
    out.hole_faces = rhs - lhs_without_h
    if out.hole_faces < arr.hole_faces:
        raise ValueError("split_cuts: splitting lost a hole face")  # fail loud, never silent
    return out
