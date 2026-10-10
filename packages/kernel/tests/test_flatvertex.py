"""Vertex moves (`pliego.flatvertex`): collapses of a precreased vertex — the waterbomb and
preliminary bases, the jumping frog's head — and the fortune teller's 3-D vertex poses
(`tests/flat_models.py`)."""

from __future__ import annotations

import math

import flat_models as fm
import pytest

import pliego
from pliego import flatfold, flatvertex
from pliego.flatcheck import check
from pliego.flatstate import FlatStateError

S = 150.0


def creased_square(lines):
    fp = pliego.FoldProgram([(0, 0), (S, 0), (S, S), (0, S)])
    for k, (line, kw) in enumerate(lines):
        fp.crease_and_unfold(f"c{k}", "c", line, "valley", **kw)
    return fp


def test_waterbomb_base_by_one_collapse():
    fp = fm.waterbomb_base(S)
    st = fp.state
    assert check(st) == []
    assert st.bbox() == pytest.approx((0.0, 0.0, S, S / 2))           # point up on the edge
    seg = {tuple(round(c, 6) for p in s for c in p): a for s, a in st.crease_segments()}
    assert seg[(0.0, 0.0, S, S)] == 180.0 and seg[(0.0, S, S, 0.0)] == 180.0   # diagonals V
    assert seg[(0.0, S / 2, S, S / 2)] == -180.0                                # midline M
    b = fp.build()
    row = next(r for r in b.report["rows"] if r["id"] == "collapse")
    assert row["kind"] == "collapse"
    assert row["tear_mm"] < 1e-6 and row["deviation_mm"] < 1e-6     # rigid at every sample
    assert row["mid_tear_mm"] < 0.5                                  # samples refined
    assert [i for i in fm_doc(b).verify() if i["level"] == "error"] == []


def test_the_collapse_path_is_the_symmetric_projected_chord():
    fp = creased_square([(((0, S), (S, 0)), {}), (((0, 0), (S, S)), {"at": (1, S - 6)}),
                         (((-1, S / 2), (S + 1, S / 2)), {})])
    st = fp.state
    star = flatvertex.star(st, (S / 2, S / 2))
    dirs = [round(math.degrees(math.atan2(d[1], d[0]))) for d in star.dirs]
    assert dirs == [-135, -45, 0, 45, 135, 180]
    m = flatvertex.collapse(st, (S / 2, S / 2), {0: "mountain", 180: "mountain", 45: "valley",
                                                 135: "valley", -45: "valley", -135: "valley"})
    assert m.info["path"]["dof"] == 3                          # degree 6: n − 3
    path = flatvertex.VertexPath(star, star.angles, m.info["target"],
                                 {w: st.faces[w].xf for w in star.wedges})
    for t in (0.1, 0.37, 0.5, 0.83):
        a = dict(zip(dirs, path.angles(t), strict=True))
        assert a[45] == pytest.approx(a[135], abs=1e-6)        # mirror symmetric
        assert a[-45] == pytest.approx(a[-135], abs=1e-6)
        assert a[0] == pytest.approx(a[180], abs=1e-6)
        rv = flatvertex._log_vee(flatvertex._loop(path.world, [math.radians(x) for x in
                                                               path.angles(t)])[0])
        assert max(abs(x) for x in rv) < 1e-10                  # closed between samples too


def test_preliminary_base_by_collapse_matches_the_folded_one():
    a = fm.preliminary_by_collapse(S).state
    b = fm.preliminary(S).state
    assert check(a) == []

    def cp(st):
        return sorted((tuple(round(c, 4) for p in s for c in p), ang)
                      for s, ang in st.crease_segments())
    assert cp(a) == cp(b)


def test_jumping_frog_head_collapse_and_body():
    fp, g = fm.jumping_frog()
    st = fp.state
    assert check(st) == []
    reports, issues = flatfold.check(st.unfold("frog").build())
    assert not [i for i in issues if i["level"] == "error"]
    b = fp.build()
    head = next(r for r in b.report["rows"] if r["id"] == "head")
    assert head["tear_mm"] < 1e-6 and head["deviation_mm"] < 1e-6
    assert all(r["tear_mm"] < 1e-6 for r in b.report["rows"])


def test_fortune_teller_vertex_poses():
    fp = fm.fortune_teller()
    b = fp.build()
    rows = {r["id"]: r for r in b.report["rows"]}
    for sid in ("shape", "open-ns", "close-ns"):
        assert rows[sid]["kind"] == "vertex-pose"
        assert rows[sid]["tear_mm"] < 1e-6 and rows[sid]["deviation_mm"] < 1e-6
    # closed: the midlines flat-folded, the diagonals at 90°; the four points meet
    star = flatvertex.star(fp.state, (100.0, 100.0))
    vp = fp.recs[-1].hinge["vertex"]
    end = dict(zip([round(math.degrees(math.atan2(d[1], d[0]))) % 360 for d in star.dirs],
                   vp.angles(1.0), strict=True))
    assert all(abs(end[az]) == pytest.approx(180.0) for az in (0, 90, 180, 270))
    assert all(end[az] == pytest.approx(90.0) for az in (45, 135, 225, 315))
    assert [i for i in fm_doc(b).verify() if i["level"] == "error"] == []


def test_collapse_rejects_what_does_not_fold_flat():
    fp = creased_square([(((0, S), (S, 0)), {}), (((0, 0), (S, S)), {"at": (1, S - 6)})])
    st = fp.state
    with pytest.raises(FlatStateError, match="Kawasaki"):
        flatvertex.collapse(st, (S / 2, S / 2), {45: "valley"})
    with pytest.raises(FlatStateError):
        flatvertex.collapse(st, (S / 2, S / 2), {45: "valley", 135: "valley", -45: "valley",
                                                 -135: "valley"})      # Maekawa: 4 − 0
    with pytest.raises(FlatStateError, match="no vertex"):
        flatvertex.collapse(st, (10.0, 20.0), {45: "valley"})
    with pytest.raises(FlatStateError, match="no crease"):
        flatvertex.collapse(st, (S / 2, S / 2), {30: "valley"})


def fm_doc(b):
    asm = pliego.Assembly([b.sheet], controls=[pliego.sequence_control()], sequence=b.sequence)
    return asm.build(cartridge="test", mode="default")
