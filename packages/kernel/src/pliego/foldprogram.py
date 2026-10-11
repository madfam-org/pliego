"""Fold programs from layer-ordered operations (`pliego.foldprogram`).

`FoldProgram` records operations on a `FlatState` (`pliego.flatops`) the way a diagram reads,
then `build()` returns:

- the **crease pattern**: the final state unfolded onto the flat sheet (`pliego.Sheet`) — valley
  and mountain from the final layer order, flat (`F`) for creases left open; this is the
  cartridge's geometry, every line computed;
- the **fold program** (`pliego.Sequence`, physical mode): per operation, step targets on the
  pattern's edges — exact flat angles at the end of each operation and, in between, the dihedral
  angles read off the operation's rigid-group motion (`pliego.flatmotion`);
- a **report**: per step, the worst loop-closure residual (`pliego.kinematics.closure_residual`,
  mm) at each sampled pose and at the linear midpoint between samples — what the studio preview,
  which blends angles linearly on a face tree, draws. Simple folds, squashes and petal folds are
  exact; reverse folds are not rigid and report their gap honestly.

After the last flat operation, `hinge()` turns a flap about an existing crease by any angle (a
3-D pose: wings spread, a flapping cycle). `turn_over()` and `rotate()` change only the view.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from . import flatmotion, flatops
from .flatstate import (
    TOL,
    FlatState,
    FlatStateError,
    as_line,
    centroid,
    embed3,
    pt,
    side,
)
from .foldpattern import (  # noqa: F401 - re-exported
    edge_angles,
    edge_angles_mapped,
    face_orders,
    face_points,
)
from .preview import MAX_SAMPLES, MID_TEAR_MM  # noqa: F401 - re-exported

UNFOLD = {"en": "Unfold", "es": "Desdobla", "fr": "Dépliez", "pt": "Desdobre"}
TURN = {"en": "Turn over. ", "es": "Da la vuelta. ", "fr": "Retournez. ", "pt": "Vire. "}
SAME_TOL_DEG = 1e-7
EXACT_MM = 1e-3     # a step whose preview tears less than this (grid snapping) counts as exact


def _l4(label) -> dict[str, str]:
    if isinstance(label, str):
        return {k: label for k in ("en", "es", "fr", "pt")}
    return dict(label)


@dataclass
class _Rec:
    sid: str
    label: dict
    move: flatops.Move | None      # None: a 3-D hinge step
    ms: int
    hinge: dict | None = None
    note: dict | None = None
    state: FlatState | None = None  # the flat state a 3-D step acts on
    fn: object = None               # t ↦ world pose per face (`foldpose.Pose3`)


@dataclass
class Built:
    sheet: object
    sequence: object
    report: dict
    state: FlatState
    final_angles: dict[int, float]
    pose_angles: dict[int, float]
    arr: object = None
    face_map: list[int] = field(default_factory=list)
    start_angles: dict[int, float] = field(default_factory=dict)

    def initial(self, sheet_id: str = "square") -> dict:
        """An `Assembly(initial=…)` spec for the program's starting pose (`start_angles`): the
        exact face-tree pose (opening flat-folded creases would break its loop closure)."""
        return {sheet_id: {"angles": dict(self.start_angles), "root": self.root()}}

    def target(self, pose: bool = False) -> dict:
        """A target-frame spec (`Assembly(targets=…)`): the flat-folded state (or the final
        3-D pose), folded creases opened by `open_deg` so stacked layers stay apart."""
        ang = self.pose_angles if pose else self.final_angles
        return {"angles": dict(ang), "root": self.root()}

    def face_orders(self) -> list[list[int]]:
        """The final flat state's complete layer order as FOLD ``faceOrders`` on the crease
        pattern's faces (see `face_orders`)."""
        return face_orders(self.state, self.arr)

    def root(self) -> tuple[float, float]:
        return face_points(self.arr)[0]

    def summary(self) -> str:
        r = self.report
        return (f"foldprogram: operations={r['operations']} steps={r['steps']} "
                f"faces={r['faces']} creases={r['creases']} exact={r['exact_steps']}/"
                f"{r['operations']} max_tear_mm={r['max_tear_mm']:.3g} "
                f"max_mid_tear_mm={r['max_mid_tear_mm']:.3g} "
                f"max_deviation_mm={r['max_deviation_mm']:.3g}")


class FoldProgram:
    """Record a fold program; see the module docstring. Lines and points are in the folded frame
    of the current state."""

    def __init__(self, outline, **sheet_kwargs):
        self.state = FlatState.of(outline)
        self.start = self.state
        self.recs: list[_Rec] = []
        self.sheet_kwargs = sheet_kwargs
        self._turned = False
        self._hinges = False
        from .foldpose import Pose3
        self.pose = Pose3(self.state)

    # ── view ──
    def turn_over(self) -> FoldProgram:
        self._flat_only("turn_over")
        self.state = self.state.turn_over()
        self.pose = type(self.pose)(self.state)
        self._turned = not self._turned
        return self

    def rotate(self, deg: float, center=(0.0, 0.0)) -> FoldProgram:
        self._flat_only("rotate")
        self.state = self.state.rotate(deg, center)
        self.pose = type(self.pose)(self.state)
        return self

    def _label(self, label) -> dict:
        lab = _l4(label)
        if self._turned:
            lab = {k: TURN[k] + v for k, v in lab.items()}
            self._turned = False
        return lab

    def _flat_only(self, what: str) -> None:
        if self._hinges:
            raise FlatStateError(f"{what}: flat operations must come before hinge poses")

    def _add(self, sid: str, label, move: flatops.Move, ms: int, note=None) -> FoldProgram:
        self._flat_only(sid)
        self.recs.append(_Rec(sid, self._label(label), move, ms,
                              note=None if note is None else _l4(note)))
        self.state = move.state
        self.pose.follow(move)
        return self

    def add(self, sid: str, label, move: flatops.Move, ms: int = 1500, note=None) -> FoldProgram:
        """Record a `pliego.flatops` move made on the current state (any operation, including
        ones this class has no shortcut for, e.g. `flatops.rabbit_ear`)."""
        if move.before is not self.state:
            raise FlatStateError(f"step '{sid}': the move does not start from the current state")
        return self._add(sid, label, move, ms, note)

    # ── operations ──
    def fold(self, sid: str, label, line, direction: str = "valley", ms: int = 1500,
             note=None, within=None, hinge: dict | None = None, **select) -> FoldProgram:
        """A flat fold (`pliego.flatops.fold`). After 3-D steps it folds the coplanar group
        joined to the face at the sheet point `within` (default: the first of `sheet_points`),
        re-flattened in that face's folded frame (`pliego.foldpose`); `hinge` ({line, turn, at,
        layers=None, from_="top"}, in that frame) turns a flap of the moving paper about an
        existing crease at the same time."""
        if not self.pose.lifted:
            if hinge is not None:
                raise FlatStateError(f"{sid}: a nested hinge needs an earlier 3-D step")
            return self._add(sid, label, flatops.fold(self.state, line, direction, **select),
                             ms, note)
        if within is None and select.get("sheet_points"):
            within = list(select["sheet_points"])[0]
        if within is None:
            raise FlatStateError(f"{sid}: flat operations after hinge poses fold the coplanar "
                                 "group at within= (a sheet point), or come before hinge poses")
        move, fn = self.pose.fold(self.state, within, line, direction, hinge, select)
        self.recs.append(_Rec(sid, self._label(label), move, ms,
                              note=None if note is None else _l4(note), state=move.state,
                              fn=fn))
        self.state = move.state
        return self

    def crease_and_unfold(self, sid: str, label, line, direction: str = "valley",
                          ms: int = 1200, **select) -> FoldProgram:
        m, back = flatops.crease_and_unfold(self.state, line, direction, **select)
        self._add(sid, label, m, ms)
        return self._add(f"{sid}-open", UNFOLD, back, max(100, ms * 3 // 4))

    def cut(self, sid: str, label, segment, ms: int = 1200, note=None,
            **select) -> FoldProgram:
        """Cut along a folded segment through every layer it crosses, or the chosen layers
        (`pliego.flatcut.cut`); the sheet gets slits. The step is a pause in the program (the
        paper does not move; a document's slits exist from the first frame)."""
        from .flatcut import cut
        return self._add(sid, label, cut(self.state, segment, **select), ms, note)

    def tuck(self, sid: str, label, line, direction: str = "valley", pocket=None,
             ms: int = 1800, note=None, **select) -> FoldProgram:
        """Fold a flap into a pocket (`pliego.flattuck.tuck`): `pocket` = (folded point, n
        layers that stay over it). The step reports the rigid path's crossing of the pocket's
        wall (`penetration_mm`)."""
        from .flattuck import tuck
        return self._add(sid, label, tuck(self.state, line, direction, pocket=pocket,
                                          **select), ms, note)

    def crease(self, sid: str, label, line, direction: str = "valley", ms: int = 600,
               **select) -> FoldProgram:
        """Mark creases on the selected layers without moving them (no step is emitted)."""
        return self._add(sid, label, flatops.crease(self.state, line, direction, **select), ms)

    def unfold_last(self, sid: str, label=None, ms: int = 900) -> FoldProgram:
        """Open the previous operation again (its creases stay)."""
        last = self.recs[-1].move
        if last is None:
            raise FlatStateError("unfold_last: the previous step is a hinge pose")
        return self._add(sid, label or UNFOLD, last.reversed(), ms)

    def reverse_fold(self, sid: str, label, line, at, kind: str = "inside", ms: int = 2000,
                     gap: int | None = None, note=None) -> FoldProgram:
        return self._add(sid, label, flatops.reverse_fold(self.state, line, at=at, kind=kind,
                                                          gap=gap), ms, note)

    def squash(self, sid: str, label, hinge, at, ms: int = 2000, note=None,
               **kw) -> FoldProgram:
        return self._add(sid, label, flatops.squash(self.state, hinge, at=at, **kw), ms, note)

    def petal(self, sid: str, label, hinge, tip, ms: int = 2400, at=None,
              note=None) -> FoldProgram:
        return self._add(sid, label, flatops.petal(self.state, hinge, tip, at=at), ms, note)

    def hinge(self, sid: str, label, line, turn: float, at, ms: int = 1200,
              layers: int | None = None, from_: str = "top", substeps: int = 4,
              note=None, faces=None, sheet_points=None) -> FoldProgram:
        """A 3-D pose step after the flat program: the flap on `at`'s side of the folded line —
        the layers picked at `at` (all, or `layers` from the top or from the bottom) and every
        layer connected to them without crossing the line, which must run along existing
        creases — turns by `turn` degrees about the line (positive lifts it towards the viewer).
        Hinge steps compose: later ones turn about axes carried by the faces they hinge on.

        The flood stops at every crease whose image lies on the line, so a flap folded onto
        the line (a dart's corner flap, folded to the keel) stays behind. `sheet_points` (sheet
        points; the faces there seed the flood, in place of the layers at `at`) or `faces`
        (state faces: exactly the flap) name the flap instead (spec §5.39); `at` still gives the
        side, and with it the sense of `turn`."""
        spec = {"line": line, "turn": turn, "at": at, "layers": layers, "from_": from_,
                "faces": faces, "sheet_points": sheet_points}
        return self.hinges(sid, label, [spec], ms, substeps, note)

    def hinges(self, sid: str, label, specs: list[dict], ms: int = 1200, substeps: int = 4,
               note=None) -> FoldProgram:
        """Several flaps turning at once (each spec: line, turn, at, layers=None,
        from_="top", leaf=None, sheet_points=None, faces=None; see `hinge`; `leaf` = n picks the
        n-th of the flaps that meet only along the line — the leaves of a book, counted from the
        top); the flaps must not share a face."""
        st = self.state
        out, taken = [], set()
        for spec in specs:
            p, d = as_line(spec["line"])
            q = pt(spec["at"])
            sgn = 1.0 if side(p, d, q) > 0 else -1.0
            on = {f for f in range(len(st.faces))
                  if side(p, d, centroid(st.image(f))) * sgn > 0}
            stack = flatops._stack_at(st, q, on)

            def flap(seeds, on=on, p=p, d=d):
                # the paper joined to the seeds without crossing the line's creases — it may
                # reach past the line in the folded image (a flap folded back across it); a
                # flap still joined to the rest round the line's end keeps to its side
                def blocked(face, a, b):
                    return flatops._on_line(st.faces[face].xf, st.points[a], st.points[b], p, d)
                grp = flatops.flood(st, set(seeds), lambda f: True, blocked)
                if len(grp) == len(st.faces):
                    grp = flatops.flood(st, set(seeds), on.__contains__, blocked)
                    for f in grp:
                        vals = [side(p, d, x) for x in st.image(f)]
                        if max(vals) > TOL and min(vals) < -TOL:
                            raise FlatStateError(f"hinge '{sid}': the line crosses face {f}; "
                                                 "hinge poses turn about existing creases only")
                return grp
            if spec.get("faces") is not None:
                grp = {int(f) for f in spec["faces"]}
                if not grp or not grp <= set(range(len(st.faces))):
                    raise FlatStateError(f"hinge '{sid}': faces must name faces of the state")
            elif spec.get("sheet_points") is not None:
                seeds = [st.face_at(x) for x in spec["sheet_points"]]
                if not seeds:
                    raise FlatStateError(f"hinge '{sid}': sheet_points names no point")
                grp = flap(seeds)
            elif spec.get("leaf") is not None:
                # the n-th flap from the top (bottom with from_="bottom"): the layers at `at`
                # split into flaps that meet only along the line
                order = list(reversed(stack)) if spec.get("from_", "top") == "top" else stack
                leaves, seen = [], set()
                for f in order:
                    if f not in seen:
                        g = flap([f])
                        leaves.append(g)
                        seen |= g
                n = int(spec["leaf"])
                if not 0 <= n < len(leaves):
                    raise FlatStateError(f"hinge '{sid}': leaf {n} asked, {len(leaves)} at the "
                                         "point")
                grp = leaves[n]
            else:
                layers = spec.get("layers")
                if layers is not None:
                    stack = stack[-int(layers):] if spec.get("from_", "top") == "top" \
                        else stack[:int(layers)]
                grp = flap(stack)
            for c in st.creases():
                if (c.f in grp) != (c.g in grp) and not flatops._on_line(
                        st.faces[c.f].xf, st.points[c.a], st.points[c.b], p, d):
                    raise FlatStateError(f"hinge '{sid}': the flap is joined to the rest off the "
                                         "line; hinge poses turn about existing creases only")
            if len(grp) == len(st.faces):
                raise FlatStateError(f"hinge '{sid}': the selection is the whole model")
            if grp & taken:
                raise FlatStateError(f"hinge '{sid}': two flaps share faces "
                                     f"{sorted(grp & taken)[:6]}")
            taken |= grp
            out.append({"faces": sorted(grp), "p": p, "d": d, "turn": float(spec["turn"]),
                        "sense": sgn})
        self._hinges = True
        fn = self.pose.hinge(self.state, out)
        self.recs.append(_Rec(sid, self._label(label), None, ms,
                              {"specs": out, "substeps": int(substeps)},
                              None if note is None else _l4(note), state=self.state, fn=fn))
        return self

    def kinematic(self, sid: str, label, drive, free=(), fixed=None, ms: int = 1500,
                  substeps: int = 6, note=None, frame: str = "sheet") -> FoldProgram:
        """A rigid 3-D step on the whole crease pattern so far (`pliego.foldpose`): the creases
        on the folded-frame segments of `drive` ([(segment, degrees)]) turn to those fold angles,
        the creases on the `free` segments follow (a free item may be (segment, "valley" |
        "mountain"): the way that crease leaves a start where the rigid paths branch), every
        other crease holds; `fixed`: a sheet point on a face that stays. Every layer's crease on
        a segment counts (creases through every layer turn together). `frame` says how the
        angles and hints reach each layer (spec §5.35):

        - ``"sheet"`` (default): valley > 0 in the sheet's sense on every layer — the layers of
          a model folded in half turn as mirror images (a puppet's mouth pleat);
        - ``"folded"``: valley > 0 turns the paper towards the viewer, relative to the paper that
          stays — the sheet's sense on a layer that shows its front, the opposite on a turned-over
          layer (`foldpose.layer_signs`), so every layer turns as one stack (a frog's spring
          pleat, a plane's fuselage opening, a rolled ring)."""
        from .foldpose import creases_on

        if frame not in ("sheet", "folded"):
            raise FlatStateError(f"kinematic '{sid}': frame must be 'sheet' or 'folded'")

        drive_segs = [((pt(seg[0]), pt(seg[1])), float(a)) for seg, a in drive]
        if any(not creases_on(self.state, [seg]) for seg, _ in drive_segs):
            raise FlatStateError(f"kinematic '{sid}': a drive segment lies on no crease")
        free_segs = []
        for item in free:
            seg, hint = (item[0], item[1]) if isinstance(item[1], str) else (item, None)
            free_segs.append(((pt(seg[0]), pt(seg[1])),
                              {"valley": 1, "mountain": -1, None: 0}[hint]))
        fn, samples = self.pose.kinematic(self.state, drive_segs, free_segs, fixed,
                                          4 * int(substeps), frame)
        self._hinges = True
        self.recs.append(_Rec(sid, self._label(label), None, ms,
                              {"kin": True, "substeps": int(substeps), "samples": samples},
                              None if note is None else _l4(note), state=self.state, fn=fn))
        return self

    def collapse(self, sid: str, label, center, folds, ms: int = 2400, note=None,
                 **kw) -> FoldProgram:
        """Collapse the paper round a vertex, every sector at once (`pliego.flatvertex`)."""
        from .flatvertex import collapse
        return self._add(sid, label, collapse(self.state, center, folds, **kw), ms, note)

    def vertex_pose(self, sid: str, label, center, angles, ms: int = 1500, substeps: int = 6,
                    fixed=None, note=None) -> FoldProgram:
        """A 3-D pose step after the flat program: the sectors round the vertex at `center`
        move rigidly to the fold angles `angles` ({ray: degrees}, rays named as in
        `flatvertex.collapse`; unnamed rays hold), from the previous pose of this vertex (or
        the flat state) along the projected chord (`flatvertex.VertexPath`). Vertex poses come
        before `hinge` poses."""
        from .flatvertex import pose_path

        if any((r.hinge is not None and "vertex" not in r.hinge)
               or (r.move is not None and r.fn is not None) for r in self.recs):
            raise FlatStateError(f"vertex pose '{sid}': vertex poses must come before hinges")
        prev = [r.hinge["vertex"] for r in self.recs if r.hinge and "vertex" in r.hinge]
        path = pose_path(self.state, center, angles, fixed, prev)
        self._hinges = True
        fn = self.pose.vertex(self.state, path)
        self.recs.append(_Rec(sid, self._label(label), None, ms,
                              {"vertex": path, "substeps": int(substeps)},
                              None if note is None else _l4(note), state=self.state, fn=fn))
        return self

    # ── build ──
    def build(self, id: str = "square", *, start_after: str | None = None,
              rest_memory: float | None = None) -> Built:
        """The crease pattern, the fold program and the report (see the module docstring).
        `start_after` (a step id): the program starts after that operation — the earlier moves
        only shape the starting pose (`Built.start_angles`, `Built.initial()`), e.g. a finished
        model whose program is an operating cycle, or a sheet creased beforehand. With
        `rest_memory` (deg) the creases open at the start that remember a fold get that rest
        angle, signed by their last fold (a pre-creased sheet: `pliego:edges_restAngle`)."""
        from .assembly import EdgeRef, Sequence, Step
        from .foldpose import check_penetration, exact_arrangement
        from .kinematics import face_adjacency
        from .preview import PreviewTree, sample_step

        final = self.state
        start_state = None
        if rest_memory is not None:
            if start_after is None:
                raise FlatStateError("rest_memory: a program from the flat sheet has no crease "
                                     "memory at its start (give start_after)")
            rec0 = next((r for r in self.recs if r.sid == start_after), None)
            if rec0 is None or rec0.move is None:
                raise FlatStateError(f"rest_memory: no flat step '{start_after}'")
            start_state = rec0.move.state
        sheet = final.unfold(id, rest_memory=rest_memory, memory_from=start_state,
                             **self.sheet_kwargs)
        arr = sheet.build()
        nf = len(arr.faces)
        cents = face_points(arr)
        edge_faces: dict[int, tuple[int, int, int, int]] = {}
        for f, lst in face_adjacency(arr).items():
            for g, e, a, b in lst:
                edge_faces.setdefault(e, (f, g, a, b))
        folds = sorted(edge_faces)
        tree = PreviewTree(arr)
        unpl = tree.unplaced

        def fmap(state: FlatState) -> list[int]:
            return [state.face_at(c) for c in cents]

        def flat_angles(state: FlatState, m: list[int]) -> dict[int, float]:
            return edge_angles_mapped(state, arr, m, edge_faces)

        def readout(poses: list, prev: dict[int, float]) -> dict[int, float]:
            out = {}
            for e, (f, g, a, b) in edge_faces.items():
                rf, rg = poses[f][0], poses[g][0]
                ny = (rg[0][1], rg[1][1], rg[2][1])
                n = tuple(rf[0][i] * ny[0] + rf[1][i] * ny[1] + rf[2][i] * ny[2]
                          for i in range(3))
                dx, dz = unpl[b][0] - unpl[a][0], unpl[b][2] - unpl[a][2]
                ln = math.hypot(dx, dz)
                rho = -math.degrees(math.atan2((dx * n[2] - dz * n[0]) / ln, n[1]))
                if abs(abs(rho) - 180.0) < 1e-4:
                    rho = math.copysign(180.0, prev.get(e, rho) or rho)
                out[e] = rho
            return out

        final_map = fmap(final)
        final_flat = flat_angles(final, final_map)
        cur = flat_angles(self.start, fmap(self.start))
        extra = [flatmotion.ID_RIGID] * nf          # hinge poses, on top of the final state
        steps: list = []
        rows: list[dict] = []
        worst = worst_mid = worst_dev = 0.0
        exact = 0
        emit = start_after is None
        if start_after is not None and start_after not in [r.sid for r in self.recs]:
            raise FlatStateError(f"start_after: no step '{start_after}'")
        start_angles = dict(cur)
        prev_state, prev_map = self.start, fmap(self.start)
        on_points = None
        kept: set[int] = set()
        for rec in self.recs:
            # candidate motions: t ∈ (0, 1] ↦ intended poses of the pattern's faces
            cands: list = []
            end = None
            start_poses = None
            if rec.fn is not None and (rec.move is not None or "kin" in rec.hinge):
                # a step after 3-D steps (`pliego.foldpose`): the recorded world poses
                smap = fmap(rec.state)

                def fn_poses(t: float, fn=rec.fn, smap=smap):
                    w = fn(t)
                    return [w[smap[f]] for f in range(nf)]
                cands.append(fn_poses)
                start_poses = fn_poses(0.0)
                drawn = [flatmotion.compose(extra[f], embed3(prev_state.faces[prev_map[f]].xf))
                         for f in range(nf)]
                bad = max(_dev(start_poses[f], drawn[f]) for f in range(nf))
                if bad > 1e-6:
                    raise FlatStateError(f"step '{rec.sid}': the recorded pose does not start "
                                         f"where the previous step ended ({bad:.3g})")
                end_poses = fn_poses(1.0)
                extra = [flatmotion.compose(end_poses[f], flatmotion.invert(
                    embed3(rec.state.faces[smap[f]].xf))) for f in range(nf)]
                ts0 = rec.hinge["samples"] if rec.move is None else list(rec.move.samples)
            elif rec.move is not None:
                mv = rec.move
                after_map = fmap(mv.state)
                base = [embed3(mv.before.faces[mv.parent[after_map[f]]].xf) for f in range(nf)]
                end = flat_angles(mv.state, after_map)
                for motion in mv.info.get("variants") or [mv.motion]:
                    def poses_at(t: float, motion=motion, after_map=after_map, base=base):
                        g = motion(t)
                        return [flatmotion.compose(g.get(after_map[f], flatmotion.ID_RIGID),
                                                   base[f]) for f in range(nf)]
                    cands.append(poses_at)
                ts0 = list(mv.samples)
            elif "vertex" in rec.hinge:
                vp = rec.hinge["vertex"]
                smap = fmap(rec.state)
                base = [embed3(rec.state.faces[smap[f]].xf) for f in range(nf)]
                sector = {sf: i for i, grp in enumerate(vp.star.groups) for sf in grp}

                def vertex_extra(t: float, vp=vp, sector=sector, smap=smap):
                    g = vp.sector_rigid(t)
                    return [g[sector[smap[f]]] if smap[f] in sector
                            else flatmotion.ID_RIGID for f in range(nf)]

                def poses_at(t: float, base=base, vertex_extra=vertex_extra):
                    ex = vertex_extra(t)
                    return [flatmotion.compose(ex[f], base[f]) for f in range(nf)]
                cands.append(poses_at)
                extra = vertex_extra(1.0)
                ts0 = [k / rec.hinge["substeps"] for k in range(1, rec.hinge["substeps"] + 1)]
            else:
                h = rec.hinge
                smap = fmap(rec.state)
                base = [embed3(rec.state.faces[smap[f]].xf) for f in range(nf)]
                start_extra = list(extra)
                turns = []
                for spec in h["specs"]:
                    grp = {f for f in range(nf) if smap[f] in set(spec["faces"])}
                    ref = next(f for f in range(nf) if f not in grp)
                    for f, g, _, _ in edge_faces.values():
                        if (f in grp) != (g in grp):
                            ref = g if f in grp else f
                            break
                    o = flatmotion.apply(extra[ref], flatmotion.w3(spec["p"]))
                    o2 = flatmotion.apply(extra[ref], flatmotion.w3(
                        (spec["p"][0] + spec["d"][0], spec["p"][1] + spec["d"][1])))
                    turns.append((grp, o, tuple(o2[k] - o[k] for k in range(3)),
                                  spec["sense"] * math.radians(spec["turn"])))

                def hinge_extra(t: float, turns=turns, start_extra=start_extra):
                    ex = list(start_extra)
                    for grp, o, ax, rad in turns:
                        g = flatmotion.rot_line(o, ax, rad * t)
                        for f in grp:
                            ex[f] = flatmotion.compose(g, start_extra[f])
                    return ex

                def poses_at(t: float, base=base, hinge_extra=hinge_extra):
                    ex = hinge_extra(t)
                    return [flatmotion.compose(ex[f], base[f]) for f in range(nf)]
                cands.append(poses_at)
                extra = hinge_extra(1.0)
                ts0 = [k / h["substeps"] for k in range(1, h["substeps"] + 1)]
            if rec.move is not None:
                prev_state, prev_map = rec.move.state, fmap(rec.move.state)
            elif rec.state is not None:
                prev_state, prev_map = rec.state, fmap(rec.state)
            if not emit:
                if end is not None:
                    cur = {**cur, **end}
                else:
                    poses = cands[0](1.0)
                    cur = {**cur, **tree.fit(poses, readout(poses, cur))}
                if rec.sid == start_after:
                    emit, start_angles = True, dict(cur)
                continue
            best = None
            tucked = rec.move is not None and rec.move.kind == "tuck"
            for ci, poses_at in enumerate(cands):
                res = sample_step(tree, readout, poses_at, ts0, cur, end, folds, rec.sid,
                                  end_follows_motion=tucked, keep=frozenset(kept))
                score = max(res[1] + res[2])
                if best is None or score < best[0] - 1e-9:
                    best = (score, res[0], max(res[1]), max(res[2]), max(res[3]), ci)
            _, seq, tear, mid, dev, which = best
            pen = None
            if start_poses is not None or (rec.move is not None and rec.move.kind == "tuck"):
                if on_points is None:     # faces on the state's points, as posed (§5.37)
                    on_points = exact_arrangement(arr, final)
                if start_poses is not None:
                    pen = check_penetration(on_points, cands[0], start_poses, ts0, rec.sid)
                else:
                    pen = check_penetration(on_points, cands[0], cands[0](0.0), ts0, rec.sid,
                                            fail=False)
            n = len(seq)
            last = cur
            for k, ang in enumerate(seq, 1):
                full = {**last, **ang}
                tg = [(EdgeRef(sheet, e), round(full[e], 6)) for e in folds
                      if abs(full[e] - last[e]) > SAME_TOL_DEG]
                if tg or (rec.move is not None and rec.move.kind == "cut"):
                    lab = rec.label if n == 1 else {lg: f"{tx} ({k}/{n})"
                                                    for lg, tx in rec.label.items()}
                    steps.append(Step(rec.sid if n == 1 else f"{rec.sid}-{k}", lab, tg,
                                      duration_ms=max(100, rec.ms // n),
                                      note=rec.note if k == 1 else None))
                last = full
            cur = last
            # a tuck's crease that ends at ±180° against its layer order keeps that sign while
            # it stays there (spec §5.38)
            kept = {e for e in kept if abs(abs(cur[e]) - 180.0) < 1e-6}
            if tucked and end is not None:
                kept |= {e for e in folds if abs(abs(cur[e]) - 180.0) < 1e-6
                         and cur[e] == -end[e]}
            worst, worst_mid, worst_dev = max(worst, tear), max(worst_mid, mid), max(worst_dev, dev)
            if max(tear, mid) <= EXACT_MM:
                exact += 1
            rows.append({"id": rec.sid, "kind": rec.move.kind if rec.move else (
                         "vertex-pose" if "vertex" in rec.hinge else
                         "kinematic" if "kin" in rec.hinge else "hinge"),
                         "samples": n, "tear_mm": tear, "mid_tear_mm": mid, "deviation_mm": dev,
                         "variant": which})
            if pen is not None:
                rows[-1]["penetration_mm"] = pen
            if rec.move is not None and rec.move.kind == "tuck":
                rows[-1]["pocket_crossings"] = len(rec.move.info["crossed"])
        seq_out = Sequence(steps, mode="physical")
        report = {"operations": len(self.recs), "steps": len(steps), "faces": nf,
                  "creases": len(folds), "exact_steps": exact, "max_tear_mm": worst,
                  "max_mid_tear_mm": worst_mid, "max_deviation_mm": worst_dev, "rows": rows}
        seq_out.report = report
        return Built(sheet, seq_out, report, final, final_flat, dict(cur), arr, final_map,
                     start_angles)


def _dev(a, b) -> float:
    from .foldpose import rigid_dev
    return rigid_dev(a, b)


