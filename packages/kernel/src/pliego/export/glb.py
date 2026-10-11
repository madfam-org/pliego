"""glTF 2.0 binary (GLB) export of a sheet document's 3-D state (stdlib: struct + json).

The state is, in order of preference: an explicit ``state`` (V × 3 world coordinates, mm), the
named frame (default ``initial``, spec §6), or the flat sheets mapped by spec §1 — sheet-local
``(u, v)`` → ``(u, 0, −v)`` then each sheet's ``placement`` (quaternion, then translation).

Each sheet becomes one mesh with two single-sided primitives: the **front** (counter-clockwise in
the layout frame, so its normal points along the sheet's +normal) in the sheet's front colour,
and the **back** (reversed winding, negated normals) in its back colour. With back-face culling the
two coincident surfaces render as one two-coloured sheet. Faces are flat-shaded (vertices are
duplicated per face) so creases stay crisp; non-convex faces are ear-clipped in the layout frame.

glTF distances are metres: positions are scaled by ``unit_scale`` (default 0.001, mm → m); the
scale is recorded in ``asset.extras["pliego:unit_scale"]``. Optional morph targets (``morph``:
frame titles or V × 3 states) carry POSITION deltas for a kinematic fold program.

``animate=True`` makes the file play in any glTF viewer: the fold program and every mechanism sweep
are sampled with the studio preview's pose (``glb_motion``), each keyframe becomes a morph target
(POSITION and NORMAL deltas, per face corner, so faces stay rigid), and each clip is a glTF
animation (``fold-program``, ``control:<id>``) of the mesh weights with LINEAR interpolation between
one-hot keyframes, which blends exactly from one keyframe to the next. The base state (all weights
0) is the static export's state. A document with nothing to animate exports as the static file. The
morph data is bounded (``MAX_TARGETS``, ``MORPH_BUDGET``): over it, steps are sampled once each,
then the sweeps are dropped, then the animation is skipped; ``asset.extras["pliego:animation"]``
says which.
"""

from __future__ import annotations

import json
import math
import struct
from typing import Any

from .plan import as_document

Vec3 = tuple[float, float, float]
FLOAT, UINT = 5126, 5125
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963
GLB_MAGIC, GLB_VERSION = 0x46546C67, 2
CHUNK_JSON, CHUNK_BIN = 0x4E4F534A, 0x004E4942
MAX_TARGETS = 256
MORPH_BUDGET = 16 << 20   # bytes of morph target data (positions + normals, both sides)


def _srgb_to_linear(hex_color: str) -> list[float]:
    out = []
    for k in (1, 3, 5):
        c = int(hex_color[k:k + 2], 16) / 255.0
        lin = c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
        out.append(round(lin, 6))
    return out + [1.0]


def _rotate(q: list[float], p: Vec3) -> Vec3:
    x, y, z, w = q
    px, py, pz = p
    # v' = v + 2w(q×v) + 2 q×(q×v)
    cx, cy, cz = y * pz - z * py, z * px - x * pz, x * py - y * px
    cx2, cy2, cz2 = y * cz - z * cy, z * cx - x * cz, x * cy - y * cx
    return (px + 2 * (w * cx + cx2), py + 2 * (w * cy + cy2), pz + 2 * (w * cz + cz2))


def flat_state(d: dict[str, Any]) -> list[Vec3]:
    """World coordinates of the flat, placed sheets (spec §1 frame map)."""
    sheets = d.get("pliego:sheets") or [{"offset": [0, 0]}]
    vsheet = d.get("pliego:vertices_sheet") or [0] * len(d["vertices_coords"])
    out: list[Vec3] = []
    for (x, y, *_), s in zip(d["vertices_coords"], vsheet, strict=True):
        sheet = sheets[s]
        ox, oy = sheet.get("offset", [0, 0])
        place = sheet.get("placement") or {"origin": [0, 0, 0], "rotation": [0, 0, 0, 1]}
        r = _rotate(place["rotation"], (x - ox, 0.0, -(y - oy)))
        o = place["origin"]
        out.append((r[0] + o[0], r[1] + o[1], r[2] + o[2]))
    return out


def frame_state(d: dict[str, Any], title: str) -> list[Vec3] | None:
    for frame in d.get("file_frames") or []:
        if frame.get("frame_title") == title:
            return [tuple(map(float, p)) for p in frame["vertices_coords"]]  # type: ignore[misc]
    return None


def _ear_clip(pts: list[tuple[float, float]]) -> list[tuple[int, int, int]]:
    """Ear-clip a simple counter-clockwise polygon; deterministic (first ear in index order)."""
    idx = list(range(len(pts)))
    tris: list[tuple[int, int, int]] = []

    def cross(o: int, a: int, b: int) -> float:
        return ((pts[a][0] - pts[o][0]) * (pts[b][1] - pts[o][1])
                - (pts[a][1] - pts[o][1]) * (pts[b][0] - pts[o][0]))

    def inside(p: int, a: int, b: int, c: int) -> bool:
        return cross(a, b, p) > 1e-12 and cross(b, c, p) > 1e-12 and cross(c, a, p) > 1e-12

    while len(idx) > 3:
        n = len(idx)
        for k in range(n):
            a, b, c = idx[k - 1], idx[k], idx[(k + 1) % n]
            if cross(a, b, c) <= 1e-12:
                continue
            if any(inside(p, a, b, c) for p in idx if p not in (a, b, c)):
                continue
            tris.append((a, b, c))
            idx.pop(k)
            break
        else:  # degenerate remainder (collinear run): fan it
            tris.extend((idx[0], idx[m], idx[m + 1]) for m in range(1, len(idx) - 1))
            return tris
    tris.append((idx[0], idx[1], idx[2]))
    return tris


def _newell(p: list[Vec3]) -> Vec3:
    nx = ny = nz = 0.0
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    ln = math.sqrt(nx * nx + ny * ny + nz * nz)
    return (0.0, 1.0, 0.0) if ln == 0 else (nx / ln, ny / ln, nz / ln)


def _f32(x: float) -> float:
    return struct.unpack("<f", struct.pack("<f", x))[0]


class _Bin:
    def __init__(self) -> None:
        self.data = bytearray()
        self.views: list[dict[str, Any]] = []
        self.accessors: list[dict[str, Any]] = []

    def add(self, fmt: str, values: list, comp: int, typ: str, count: int, target: int | None,
            minmax: bool = False) -> int:
        while len(self.data) % 4:
            self.data.append(0)
        raw = struct.pack(f"<{len(values)}{fmt}", *values)
        view: dict[str, Any] = {"buffer": 0, "byteOffset": len(self.data), "byteLength": len(raw)}
        if target is not None:  # animation data is not vertex data: no buffer target
            view["target"] = target
        self.views.append(view)
        self.data += raw
        acc: dict[str, Any] = {"bufferView": len(self.views) - 1, "componentType": comp,
                               "count": count, "type": typ}
        if minmax:
            width = 3 if typ == "VEC3" else 1
            cols = [[_f32(v) for v in values[k::width]] for k in range(width)]
            acc["min"] = [min(c) for c in cols]
            acc["max"] = [max(c) for c in cols]
        self.accessors.append(acc)
        return len(self.accessors) - 1


def _animation(d: dict[str, Any], n_corners: int, n_prims: int):
    """(per-face corner targets, target names, clips, extras) for ``animate=True``."""
    from . import glb_motion

    # per target: both sides' POSITION + NORMAL deltas (float32 × 3 per corner), plus the JSON of
    # two accessors and two buffer views per primitive and a target name per mesh
    per_target = 2 * n_corners * 24 + n_prims * 2 * 320 + n_prims * 20
    limit = max(0, min(MAX_TARGETS, MORPH_BUDGET // max(1, per_target)))
    reduced = False
    for detail, sweeps in ((2, True), (1, True), (0, False)):
        clips = glb_motion.clips(d, detail=detail, sweeps=sweeps)
        keys = {tuple(sorted(c.items())) for _n, ks in clips for _t, c in ks}
        if len(keys) <= limit:
            break
        reduced = True
    else:
        return [], [], [], {"skipped": f"more than {limit} keyframes fit the morph budget"}
    if not clips:
        return [], [], [], None
    pose = glb_motion.PreviewPose(d)
    index: dict[tuple, int] = {}
    targets, names, out_clips = [], [], []
    for name, ks in clips:
        frames = []
        for t, controls in ks:
            key = tuple(sorted(controls.items()))
            if key not in index:
                index[key] = len(targets)
                targets.append(pose.corners(controls))
                names.append(f"{name}@{t:.3f}")
            frames.append((t, index[key]))
        out_clips.append((name, frames))
    extras = {"clips": [n for n, _ in out_clips], "targets": len(targets),
              "pose": "studio preview (engine-stub)", "reduced": reduced}
    return targets, names, out_clips, extras


def to_glb(doc: Any, frame: str = "initial", state: list | None = None,
           morph: list | None = None, unit_scale: float = 0.001, animate: bool = False) -> bytes:
    """Render a 3-D state of a sheet document to GLB bytes (two-sided sheets, flat shading);
    ``animate`` adds the fold program and mechanism sweeps as morph-target animations."""
    d = as_document(doc)
    if animate and (state is not None or morph):
        raise ValueError("animate builds its own morph targets; pass neither state nor morph")
    base = [tuple(map(float, p)) for p in state] if state is not None else (
        frame_state(d, frame) or flat_state(d))
    targets = [frame_state(d, m) if isinstance(m, str) else [tuple(map(float, p)) for p in m]
               for m in (morph or [])]
    if any(t is None for t in targets):
        raise ValueError("morph frame not found in file_frames")
    n_vert = len(d["vertices_coords"])
    for s in [base, *targets]:
        if len(s) != n_vert:  # type: ignore[arg-type]
            raise ValueError("3-D state length does not match vertices_coords")
    # every state per face corner: a vertex state is the same point for each face that uses it,
    # an animation keyframe poses each (rigid) face on its own
    faces_all = d["faces_vertices"]
    base_c = [[base[v] for v in f] for f in faces_all]
    targets_c = [[[t[v] for v in f] for f in faces_all] for t in targets]  # type: ignore[index]
    names: list[str] = []
    clips: list = []
    anim_extras = None
    if animate:
        n_prims = 2 * len({s for s in (d.get("pliego:faces_sheet") or [0] * len(faces_all))})
        targets_c, names, clips, anim_extras = _animation(d, sum(map(len, faces_all)), n_prims)
    layout = [(float(x), float(y)) for x, y, *_ in d["vertices_coords"]]
    sheets = d.get("pliego:sheets") or [{"id": "sheet-0", "front": {"color": "#f6f3ec"},
                                         "back": {"color": "#f6f3ec"}}]
    fsheet = d.get("pliego:faces_sheet") or [0] * len(d["faces_vertices"])
    binbuf = _Bin()
    materials, meshes, nodes = [], [], []
    for si, sheet in enumerate(sheets):
        faces = [fi for fi, s in enumerate(fsheet) if s == si]
        if not faces:
            continue
        prims = []
        for side in ("front", "back"):
            color = (sheet.get(side) or {}).get("color", "#f6f3ec")
            materials.append({"name": f"{sheet['id']}-{side}", "doubleSided": False,
                              "pbrMetallicRoughness": {"baseColorFactor": _srgb_to_linear(color),
                                                       "metallicFactor": 0.0,
                                                       "roughnessFactor": 0.9}})
            sign = 1.0 if side == "front" else -1.0
            pos: list[float] = []
            nrm: list[float] = []
            ind: list[int] = []
            deltas: list[list[float]] = [[] for _ in targets_c]
            ndeltas: list[list[float]] = [[] for _ in targets_c]
            for fi in faces:
                face = faces_all[fi]
                start = len(pos) // 3
                for k3, p in enumerate(base_c[fi]):
                    pos.extend(c * unit_scale for c in p)
                    for t, tgt in enumerate(targets_c):
                        deltas[t].extend((tgt[fi][k3][k] - p[k]) * unit_scale for k in range(3))
                n = _newell(base_c[fi])
                nrm.extend([sign * n[0], sign * n[1], sign * n[2]] * len(face))
                if names:  # animation keyframes also rotate the normals
                    for t, tgt in enumerate(targets_c):
                        tn = _newell(tgt[fi])
                        ndeltas[t].extend([sign * (tn[k] - n[k]) for k in range(3)] * len(face))
                for a, b, c in _ear_clip([layout[v] for v in face]):
                    ind.extend((start + a, start + b, start + c) if sign > 0
                               else (start + a, start + c, start + b))
            count = len(pos) // 3
            prim: dict[str, Any] = {
                "attributes": {
                    "POSITION": binbuf.add("f", pos, FLOAT, "VEC3", count, ARRAY_BUFFER, True),
                    "NORMAL": binbuf.add("f", nrm, FLOAT, "VEC3", count, ARRAY_BUFFER),
                },
                "indices": binbuf.add("I", ind, UINT, "SCALAR", len(ind), ELEMENT_ARRAY_BUFFER),
                "material": len(materials) - 1,
                "mode": 4,
            }
            if targets_c:
                prim["targets"] = []
                for t, dl in enumerate(deltas):
                    tgt_attrs = {"POSITION": binbuf.add("f", dl, FLOAT, "VEC3", count,
                                                        ARRAY_BUFFER, True)}
                    if names:
                        tgt_attrs["NORMAL"] = binbuf.add("f", ndeltas[t], FLOAT, "VEC3", count,
                                                         ARRAY_BUFFER)
                    prim["targets"].append(tgt_attrs)
            prims.append(prim)
        mesh: dict[str, Any] = {"name": sheet["id"], "primitives": prims}
        if targets_c:
            mesh["weights"] = [0.0] * len(targets_c)
        if names:
            mesh["extras"] = {"targetNames": names}
        meshes.append(mesh)
        nodes.append({"name": sheet["id"], "mesh": len(meshes) - 1})
    animations = []
    for name, frames in clips:
        times = [t for t, _k in frames]
        weights: list[float] = []
        for _t, k in frames:
            weights.extend(1.0 if j == k else 0.0 for j in range(len(targets_c)))
        sampler = {"input": binbuf.add("f", times, FLOAT, "SCALAR", len(times), None, True),
                   "output": binbuf.add("f", weights, FLOAT, "SCALAR", len(weights), None),
                   "interpolation": "LINEAR"}
        animations.append({"name": name, "samplers": [sampler],
                           "channels": [{"sampler": 0, "target": {"node": n, "path": "weights"}}
                                        for n in range(len(nodes))]})
    while len(binbuf.data) % 4:
        binbuf.data.append(0)
    extras: dict[str, Any] = {"pliego:unit_scale": unit_scale}
    if anim_extras is not None:
        extras["pliego:animation"] = anim_extras
    gltf = {
        "asset": {"version": "2.0", "generator": "pliego-kernel export/glb", "extras": extras},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": binbuf.accessors,
        "bufferViews": binbuf.views,
        "buffers": [{"byteLength": len(binbuf.data)}],
    }
    if animations:
        gltf["animations"] = animations
    js = json.dumps(gltf, separators=(",", ":"), ensure_ascii=True).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(binbuf.data)
    return (struct.pack("<III", GLB_MAGIC, GLB_VERSION, total)
            + struct.pack("<II", len(js), CHUNK_JSON) + js
            + struct.pack("<II", len(binbuf.data), CHUNK_BIN) + bytes(binbuf.data))
