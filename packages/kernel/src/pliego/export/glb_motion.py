"""Keyframes for an animated GLB: the studio preview's rigid pose, sampled over the fold program and
the mechanism sweeps (``to_glb(doc, animate=True)``).

The pose is a port of the studio's preview engine (``apps/web/studio/src/engine-stub.js``, the
contract double every cartridge's timeline is checked against): per sheet a face tree through the
hinge edges (M, V, F, U, J) from its root face (``presentation.root_face``, else its first face);
start angles from ``pliego:edges_restAngle`` or, when an ``initial`` frame exists, the signed
dihedrals of that frame; the fold program's targets eased in step by step, with the preview's
plasticity (a crease driven past its stock's yield angle drags its rest angle along; a physical
``release`` returns to it); fully folded layers drawn at ±179.5°; the ``hinge``, ``leaf``,
``rotate`` and ``translate`` mechanisms as whole-sheet transforms (``slide`` and driven pins need
the physics engine and stay static, as in the preview); the §5.16 ``presentation.end`` transform
blended over the program; removed pieces (§5.8) lifting away and then collapsing to a point; and
the ground clamp.

Every face is rigid, so a keyframe is given per face corner (a torn, non-closing state shows as the
preview shows it, never as a stretched face). The exporter turns keyframes into morph targets and
linear weight animations; between two keyframes a viewer blends positions, so steps are sampled
finely enough (one keyframe per 30° of the largest angle change, at most ``MAX_STEP_SAMPLES``).
"""

from __future__ import annotations

import math
from collections import deque
from typing import Any

DEG = math.pi / 180.0
HINGE = frozenset("MVFUJ")
FLAT_MAX = 179.5
LIFT_END = 0.75
SAMPLE_DEG = 30.0
MAX_STEP_SAMPLES = 6
MAX_SWEEP_SAMPLES = 8

Vec3 = tuple[float, float, float]
Rigid = tuple[tuple[float, ...], Vec3]   # (row-major 3×3, translation)
IDENT: Rigid = ((1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0), (0.0, 0.0, 0.0))


def _apply(t: Rigid, p) -> Vec3:
    r, o = t
    return (r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + o[0],
            r[3] * p[0] + r[4] * p[1] + r[5] * p[2] + o[1],
            r[6] * p[0] + r[7] * p[1] + r[8] * p[2] + o[2])


def _rot(t: Rigid, p) -> Vec3:
    return _apply((t[0], (0.0, 0.0, 0.0)), p)


def _compose(a: Rigid, b: Rigid) -> Rigid:
    ra, rb = a[0], b[0]
    r = tuple(ra[i * 3] * rb[j] + ra[i * 3 + 1] * rb[3 + j] + ra[i * 3 + 2] * rb[6 + j]
              for i in range(3) for j in range(3))
    return r, _apply(a, b[1])


def _invert(t: Rigid) -> Rigid:
    r = t[0]
    rt = (r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8])
    o = _apply((rt, (0.0, 0.0, 0.0)), t[1])
    return rt, (-o[0], -o[1], -o[2])


def _sub(a, b) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _unit(a) -> Vec3:
    n = math.sqrt(_dot(a, a)) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def _axis_rot(o, d, rad: float) -> Rigid:
    c, s = math.cos(rad), math.sin(rad)
    k, (x, y, z) = 1.0 - c, d
    r = (c + x * x * k, x * y * k - z * s, x * z * k + y * s,
         y * x * k + z * s, c + y * y * k, y * z * k - x * s,
         z * x * k - y * s, z * y * k + x * s, c + z * z * k)
    ro = _apply((r, (0.0, 0.0, 0.0)), o)
    return r, (o[0] - ro[0], o[1] - ro[1], o[2] - ro[2])


def _quat_r(q) -> tuple[float, ...]:
    x, y, z, w = q
    return (1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
            2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
            2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y))


def _frame(a, b, c) -> Rigid:
    e1 = _unit(_sub(b, a))
    e3 = _unit(_cross(e1, _sub(c, a)))
    e2 = _cross(e3, e1)
    return (e1[0], e2[0], e3[0], e1[1], e2[1], e3[1], e1[2], e2[2], e3[2]), tuple(a)


def _newell(pts) -> Vec3:
    n = [0.0, 0.0, 0.0]
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        n[0] += (p[1] - q[1]) * (p[2] + q[2])
        n[1] += (p[2] - q[2]) * (p[0] + q[0])
        n[2] += (p[0] - q[0]) * (p[1] + q[1])
    return _unit(n)


def _slerp_identity(q, w: float):
    x, y, z, s = q
    if s < 0:
        x, y, z, s = -x, -y, -z, -s
    half = math.acos(min(1.0, s))
    sh = math.sin(half)
    if sh < 1e-12:
        return (0.0, 0.0, 0.0, 1.0)
    k = math.sin(w * half) / sh
    return (x * k, y * k, z * k, math.cos(w * half))


def _ease(x: float) -> float:
    return x * x * (3 - 2 * x)


class PreviewPose:
    """The preview's pose of one sheet document (a dict), as engine-stub.js computes it."""

    def __init__(self, d: dict[str, Any]) -> None:
        self.d = d
        sheets = d["pliego:sheets"]
        vsheet = d["pliego:vertices_sheet"]
        fv, ev = d["faces_vertices"], d["edges_vertices"]
        self.unplaced = []
        for p, s in zip(d["vertices_coords"], vsheet, strict=True):
            off = sheets[s].get("offset", [0, 0])
            self.unplaced.append((p[0] - off[0], 0.0, -(p[1] - off[1])))
        edge_of = {(min(a, b), max(a, b)): e for e, (a, b) in enumerate(ev)}
        edge_faces: list[list[int]] = [[] for _ in ev]
        for fi, f in enumerate(fv):
            for k, a in enumerate(f):
                e = edge_of.get((min(a, f[(k + 1) % len(f)]), max(a, f[(k + 1) % len(f)])))
                if e is not None:
                    edge_faces[e].append(fi)
        self.parent: list[tuple[int, int, int, int] | None] = [None] * len(fv)
        self.order: list[int] = []
        self.root = [self._root_face(s) for s in range(len(sheets))]
        seen = [False] * len(fv)
        assign = d["edges_assignment"]
        for root in self.root:
            if root < 0:
                continue
            queue = deque([root])
            seen[root] = True
            while queue:
                f = queue.popleft()
                self.order.append(f)
                cyc = fv[f]
                for k, a in enumerate(cyc):
                    b = cyc[(k + 1) % len(cyc)]
                    e = edge_of.get((min(a, b), max(a, b)))
                    if e is None or assign[e] not in HINGE:
                        continue
                    for g in edge_faces[e]:
                        if g != f and not seen[g]:
                            seen[g] = True
                            self.parent[g] = (f, e, a, b)
                            queue.append(g)
        self.root_pose = [(_quat_r((sh.get("placement") or {}).get("rotation", [0, 0, 0, 1])),
                           tuple((sh.get("placement") or {}).get("origin", [0, 0, 0])))
                          for sh in sheets]
        rest = d.get("pliego:edges_restAngle") or []
        self.theta0 = [float(rest[e]) if e < len(rest) and rest[e] else 0.0
                       for e in range(len(ev))]
        initial = next((f["vertices_coords"] for f in d.get("file_frames") or []
                        if f.get("frame_title") == "initial"), None)
        if initial is not None:
            self._from_initial(initial)
        self.controls_def = {c["id"]: c for c in d.get("pliego:controls") or []}
        stocks = d.get("pliego:stocks") or {}
        self.yields = [float(((stocks.get(sh.get("stock")) or {}).get("derived") or {})
                             .get("crease_yield_deg", 35.0) or 35.0) for sh in sheets]
        self.steps = (d.get("pliego:sequence") or {}).get("steps") or []
        self.physical = (d.get("pliego:sequence") or {}).get("mode") != "kinematic"
        self.seq_id = next((c for c, v in self.controls_def.items() if v.get("kind") == "sequence"),
                           None)
        self._removal(sheets, vsheet)

    def _root_face(self, s: int) -> int:
        fs = self.d["pliego:faces_sheet"]
        pr = self.d["pliego:sheets"][s].get("presentation") or {}
        f = pr.get("root_face")
        if isinstance(f, int) and not isinstance(f, bool) and 0 <= f < len(fs) and fs[f] == s:
            return f
        return fs.index(s) if s in fs else -1

    def _well_shaped(self, f: list[int]) -> list[int]:
        best, area, p = [f[0], f[1], f[2]], -1.0, self.unplaced
        for i in range(1, len(f) - 1):
            n = _cross(_sub(p[f[i]], p[f[0]]), _sub(p[f[i + 1]], p[f[0]]))
            ar = math.sqrt(_dot(n, n))
            if ar > area:
                area, best = ar, [f[0], f[i], f[i + 1]]
        return best

    def _from_initial(self, init) -> None:
        fv = self.d["faces_vertices"]
        normals = [_newell([init[v] for v in f]) for f in fv]
        for s, root in enumerate(self.root):
            if root < 0:
                continue
            k = self._well_shaped(fv[root])
            a = _frame(*[self.unplaced[v] for v in k])
            b = _frame(*[init[v] for v in k])
            self.root_pose[s] = _compose(b, _invert(a))
        design = self.d["edges_foldAngle"]
        for f in self.order:
            par = self.parent[f]
            if par is None:
                continue
            p, e, a, b = par
            axis = _unit(_sub(init[a], init[b]))
            n_p, n_c = normals[p], normals[f]
            th = math.atan2(_dot(_cross(n_p, n_c), axis), _dot(n_p, n_c)) / DEG
            flat = abs(abs(th) - 180.0) < 1e-3 and design[e]
            self.theta0[e] = math.copysign(180.0, design[e]) if flat else th

    def _removal(self, sheets, vsheet) -> None:
        fv = self.d["faces_vertices"]
        step_of = {pid: k for k, st in enumerate(self.steps) for pid in st.get("remove") or []}
        self.face_step = [-1] * len(fv)
        self.face_pull: list[Vec3 | None] = [None] * len(fv)
        for pc in self.d.get("pliego:pieces") or []:
            k = step_of.get(pc.get("id"))
            if k is None:
                continue
            for f in pc.get("faces") or []:
                self.face_step[f] = k
                self.face_pull[f] = _unit(pc["pull"]) if pc.get("pull") else None
        coords = self.d["vertices_coords"]
        diag = 0.0
        for s in range(len(sheets)):
            pts = [coords[v] for v in range(len(coords)) if vsheet[v] == s]
            if pts:
                xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                diag = max(diag, math.hypot(max(xs) - min(xs), max(ys) - min(ys)))
        self.lift = max(10.0, 0.25 * diag)

    def defaults(self) -> dict[str, float]:
        out = {}
        for cid, c in self.controls_def.items():
            v = c.get("default")
            out[cid] = (1.0 if v else 0.0) if isinstance(v, bool) else float(v or 0)
        return out

    # ── one pose ─────────────────────────────────────────────────────────────
    def angles(self, controls: dict) -> list[float]:
        theta = list(self.theta0)
        if self.steps and self.seq_id is not None:
            s = max(0.0, min(float(len(self.steps)), controls.get(self.seq_id, 0.0)))
            rest = list(self.theta0)
            esheet = self.d["pliego:edges_sheet"]
            for k, step in enumerate(self.steps):
                if k >= s:
                    break
                t = _ease(min(1.0, s - k))
                for e, target in step.get("targets") or []:
                    theta[e] = theta[e] + (target - theta[e]) * t
                    y, delta = self.yields[esheet[e]], theta[e] - rest[e]
                    if abs(delta) > y:
                        rest[e] = theta[e] - math.copysign(y, delta)
                if self.physical:
                    for e in step.get("release") or []:
                        theta[e] = theta[e] + (rest[e] - theta[e]) * t
        return [max(-FLAT_MAX, min(FLAT_MAX, x)) for x in theta]

    def _mechanisms(self, controls: dict) -> list[Rigid]:
        sheets = self.d["pliego:sheets"]
        idx = {sh["id"]: i for i, sh in enumerate(sheets)}
        m_out = [IDENT] * len(sheets)
        for m in self.d.get("pliego:mechanisms") or []:
            kind = m.get("type")
            if kind == "hinge":
                v = controls.get(m["angle_control"], m["rest"])
                t = _axis_rot(m["axis"]["origin"], _unit(m["axis"]["direction"]),
                              (v - m["rest"]) * DEG)
                for sid in m["sheets_moving"]:
                    m_out[idx[sid]] = _compose(t, m_out[idx[sid]])
            elif kind == "leaf":
                s = idx[m["sheet"]]
                off = sheets[s].get("offset", [0, 0])
                v = controls.get(m["control"], 0.0)
                (u0, v0), (u1, v1) = m["spine"]
                p0 = _apply(self.root_pose[s], (u0, 0.0, -v0))
                p1 = _apply(self.root_pose[s], (u1, 0.0, -v1))
                vsheet = self.d["pliego:vertices_sheet"]
                coords = self.d["vertices_coords"]
                pts = [p for p, vs in zip(coords, vsheet, strict=True) if vs == s]
                cx = sum(p[0] - off[0] for p in pts) / len(pts)
                cy = sum(p[1] - off[1] for p in pts) / len(pts)
                side = (u1 - u0) * (cy - v0) - (v1 - v0) * (cx - u0)
                turn = _axis_rot(p0, _unit(_sub(p1, p0)), (1 if side > 0 else -1) * v * DEG)
                m_out[s] = _compose(turn, m_out[s])
            elif kind == "rotate":
                cs = idx[m["center"]["sheet"]]
                at = m["center"]["at"]
                o = _apply(self.root_pose[cs], (at[0], 0.0, -at[1]))
                n = _unit(_rot(self.root_pose[cs], (0.0, 1.0, 0.0)))
                t = _axis_rot(o, n, controls.get(m["control"], 0.0) * DEG)
                for sid in m["sheets_moving"]:
                    m_out[idx[sid]] = _compose(t, m_out[idx[sid]])
            elif kind == "translate":
                top = (self.controls_def.get(m["control"]) or {}).get("max") or 1
                dvec = _unit(m["direction"])
                k = controls.get(m["control"], 0.0) / top * m["travel"]
                t = ((1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0),
                     (dvec[0] * k, dvec[1] * k, dvec[2] * k))
                for sid in m.get("sheets_moving") or []:
                    m_out[idx[sid]] = _compose(t, m_out[idx[sid]])
        return m_out

    def _presentation(self, sv: float) -> list[Rigid]:
        n = len(self.steps)
        w = max(0.0, min(1.0, sv / n)) if n else 0.0
        out: list[Rigid] = []
        fv = self.d["faces_vertices"]
        for s, sh in enumerate(self.d["pliego:sheets"]):
            end = (sh.get("presentation") or {}).get("end")
            if not end or not w or self.root[s] < 0:
                out.append(IDENT)
                continue
            f = fv[self.root[s]]
            pts = [_apply(self.root_pose[s], self.unplaced[v]) for v in f]
            c = tuple(sum(p[k] for p in pts) / len(pts) for k in range(3))
            r = _quat_r(_slerp_identity(end["rotation"], w))
            rc = _apply((r, (0.0, 0.0, 0.0)), c)
            out.append((r, tuple(c[k] + w * end["origin"][k] - rc[k] for k in range(3))))
        return out

    def corners(self, controls: dict) -> list[list[Vec3]]:
        """World position of every face corner (faces_vertices order) for these control values;
        a removed piece's faces collapse to their centroid."""
        theta = self.angles(controls)
        fsheet = self.d["pliego:faces_sheet"]
        fv = self.d["faces_vertices"]
        u = self.unplaced
        face_t: dict[int, Rigid] = {}
        for f in self.order:
            par = self.parent[f]
            if par is None:
                face_t[f] = self.root_pose[fsheet[f]]
                continue
            p, e, a, b = par
            hinge = _axis_rot(u[a], _unit(_sub(u[a], u[b])), theta[e] * DEG)
            face_t[f] = _compose(face_t[p], hinge)
        mech = self._mechanisms(controls)
        sv = controls.get(self.seq_id, 0.0) if self.seq_id is not None else 0.0
        pres = self._presentation(sv)
        n = len(self.steps)
        hidden = max(0, min(n, math.floor(sv - LIFT_END) + 1)) if n else 0
        out: list[list[Vec3]] = []
        visible_min = math.inf
        for fi, f in enumerate(fv):
            s = fsheet[fi]
            t = _compose(pres[s], _compose(mech[s], face_t.get(fi, self.root_pose[s])))
            k = self.face_step[fi]
            if 0 <= k < hidden:
                pts = [_apply(t, u[v]) for v in f]
                c = tuple(sum(p[i] for p in pts) / len(pts) for i in range(3))
                out.append([c] * len(f))
                continue
            if k >= 0 and k < sv < k + LIFT_END:
                lift = self.lift * _ease(min(1.0, (sv - k) / LIFT_END))
                dvec = self.face_pull[fi] or _unit(_rot(self.root_pose[s], (0.0, 1.0, 0.0)))
                t = _compose(((1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0),
                              (dvec[0] * lift, dvec[1] * lift, dvec[2] * lift)), t)
            pts = [_apply(t, u[v]) for v in f]
            visible_min = min(visible_min, *(p[1] for p in pts))
            out.append(pts)
        if visible_min < 0:  # the ground clamp: lift the whole scene onto the table (y = 0)
            out = [[(p[0], p[1] - visible_min, p[2]) for p in face] for face in out]
        return out


# ── clips ────────────────────────────────────────────────────────────────────
def _sequence_samples(pose: PreviewPose, detail: int) -> list[tuple[float, float]]:
    """(time s, sequence value) keyframes of the fold program, start excluded. ``detail`` 2: one
    keyframe per 30° of swing and a removed piece's lift; 1: one per step, a removed piece pops
    away at the end of its lift; 0: one per step."""
    out: list[tuple[float, float]] = []
    t0 = 0.0
    base = pose.defaults()
    for k, step in enumerate(pose.steps):
        dur = max(0.05, float(step.get("duration_ms") or 1000) / 1000.0)
        a0 = pose.angles({**base, pose.seq_id: float(k)})
        a1 = pose.angles({**base, pose.seq_id: float(k + 1)})
        swing = max((abs(x - y) for x, y in zip(a0, a1, strict=True)), default=0.0)
        m = min(MAX_STEP_SAMPLES, max(1, math.ceil(swing / SAMPLE_DEG))) if detail >= 2 else 1
        fracs = {j / m for j in range(1, m + 1)}
        if step.get("remove") and detail >= 1:
            fracs |= {LIFT_END - 1e-3, LIFT_END} | ({0.25, 0.5} if detail >= 2 else set())
        out += [(t0 + f * dur, k + f) for f in sorted(fracs)]
        t0 += dur
    return out


def _sweep_controls(pose: PreviewPose) -> list[str]:
    ids: list[str] = []
    for m in pose.d.get("pliego:mechanisms") or []:
        cid = m.get("angle_control") if m.get("type") == "hinge" else m.get("control")
        if m.get("type") in ("hinge", "leaf", "rotate", "translate") and cid in pose.controls_def \
                and cid not in ids:
            ids.append(cid)
    return ids


def clips(doc: dict[str, Any], detail: int = 2, sweeps: bool = True
          ) -> list[tuple[str, list[tuple[float, dict]]]]:
    """``[(name, [(time, controls), ...])]``: the fold program (``fold-program``, forward, ending
    folded) and one there-and-back sweep per mechanism control (``control:<id>``), every other
    control at its default. Empty when the document has nothing to animate. ``detail`` (2, 1, 0)
    trades keyframes for size (``_sequence_samples``; sweeps take 2 segments below 2)."""
    pose = PreviewPose(doc)
    base = pose.defaults()
    out: list[tuple[str, list[tuple[float, dict]]]] = []
    if pose.steps and pose.seq_id is not None:
        keys = [(0.0, {**base, pose.seq_id: 0.0})]
        keys += [(t, {**base, pose.seq_id: s}) for t, s in _sequence_samples(pose, detail)]
        out.append(("fold-program", keys))
    for cid in _sweep_controls(pose) if sweeps else ():
        c = pose.controls_def[cid]
        lo, hi = float(c.get("min", 0) or 0), float(c.get("max", base[cid]) or 0)
        if hi == lo:
            continue
        angle = c.get("kind") == "angle"
        m = min(MAX_SWEEP_SAMPLES, max(2, math.ceil(abs(hi - lo) / SAMPLE_DEG))) if angle else 4
        if detail < 2:
            m = 2
        span = max(1.0, abs(hi - lo) / 90.0) if angle else 2.0
        values = [lo + (hi - lo) * j / m for j in range(m + 1)]
        keys = [(span * j / m, {**base, cid: v}) for j, v in enumerate(values)]
        keys += [(span + span * j / m, {**base, cid: v}) for j, v in enumerate(values[-2::-1], 1)]
        out.append((f"control:{cid}", keys))
    return out
