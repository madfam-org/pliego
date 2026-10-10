"""Cuts through chosen layers of a folded state (`pliego.flatcut`): slits on the flat sheet,
seams where a slit ends inside a face, and the canard paper airplane (`tests/flat_models.py`)."""

from __future__ import annotations

import flat_models as fm
import pytest

import pliego
from pliego import flatops
from pliego.flatcheck import check
from pliego.flatcut import cut
from pliego.flatstate import FlatState, FlatStateError

STRIP = [(0, 0), (200, 0), (200, 60), (0, 60)]


def folded_strip() -> FlatState:
    return flatops.fold(FlatState.of(STRIP), ((0, 30), (200, 30)), "valley", at=(100, 50)).state


def slits_of(sheet):
    out = []
    for m in sheet.marks:
        if m.assignment == "C":
            (a, b) = m.points[0], m.points[-1]
            out.append(tuple(sorted(((round(a.x, 6), round(a.y, 6)),
                                     (round(b.x, 6), round(b.y, 6))))))
    return sorted(out)


def test_a_cut_through_both_layers_makes_mirrored_slits():
    st = folded_strip()
    m = cut(st, ((150, -5), (150, 20)))
    assert m.kind == "cut" and check(m.state) == []
    assert len(m.info["slits"]) == 2
    assert slits_of(m.state.unfold("s")) == [((150.0, 0.0), (150.0, 20.0)),
                                            ((150.0, 40.0), (150.0, 60.0))]
    # the slit ends inside each layer: the rest of its line is a seam, not a crease
    assert len(m.state.seams) == 2
    assert all(mk.assignment != "F" for mk in m.state.unfold("s").marks)


def test_a_cut_through_the_top_layer_only():
    st = folded_strip()
    m = cut(st, ((150, -5), (150, 20)), at=(150, 10), layers=1)
    assert slits_of(m.state.unfold("s")) == [((150.0, 40.0), (150.0, 60.0))]
    m2 = cut(st, ((150, -5), (150, 20)), at=(150, 10), layers=1, from_="bottom")
    assert slits_of(m2.state.unfold("s")) == [((150.0, 0.0), (150.0, 20.0))]


def test_slit_parts_the_paper_for_later_folds():
    # a slit across the whole folded strip: the tip folds alone, the slit's two sides apart
    st = folded_strip()
    st = cut(st, ((150, -5), (150, 40))).state
    m = flatops.fold(st, ((150, 0), (150, 30)), "valley", at=(180, 15))
    assert check(m.state) == []
    assert all(c.angle != 0 or not m.state.seam_only(c.a, c.b) for c in m.state.creases())


def test_folding_along_a_seam_makes_it_a_crease():
    st = folded_strip()
    st = cut(st, ((150, -5), (150, 15))).state                  # slit, then seam up to y = 30
    m = flatops.fold(st, ((150, -10), (150, 40)), "valley", at=(180, 15))
    sheet = m.state.unfold("s")
    folds = [mk for mk in sheet.marks if mk.assignment in ("M", "V")]
    xs = {round(p.x, 6) for mk in folds for p in mk.points}
    assert 150.0 in xs                                            # the seam folded: a crease now


def test_cut_errors():
    st = folded_strip()
    with pytest.raises(FlatStateError, match="crosses no paper"):
        cut(st, ((300, 0), (300, 20)))
    with pytest.raises(FlatStateError, match="not on the segment"):
        cut(st, ((150, -5), (150, 20)), at=(160, 10), layers=1)
    with pytest.raises(FlatStateError, match="3 layers asked"):
        cut(st, ((150, -5), (150, 20)), at=(150, 10), layers=3)


def test_canard_plane_slits_tabs_and_3d_opening():
    fp, g = fm.canard_plane(trim=10.0, dihedral=6.0)
    b = fp.build()
    assert b.report["exact_steps"] == b.report["operations"]
    assert b.report["max_tear_mm"] < 1e-6 and b.report["max_mid_tear_mm"] < 1e-6
    ids = [s.id for s in b.sequence.steps]
    assert "slit" in ids and "elevator-slit-1" in ids          # the cuts are diagram steps
    c, k, ys, x1, x2, e = g["c"], g["k"], g["y_slit"], g["x1"], g["x2"], g["e"]
    r = lambda v: round(v, 6)  # noqa: E731
    want = sorted([((0.0, r(ys)), (r(c - k), r(ys))), ((r(c + k), r(ys)), (210.0, r(ys)))]
                  + [((r(x), 0.0), (r(x), r(e))) for x in (x1, x2, 2 * c - x1, 2 * c - x2)])
    assert slits_of(b.sheet) == want
    # the 3-D pose: the fuselage spread 16°, wings and foreplanes at their dihedral, tabs trimmed
    mags = sorted({round(abs(a), 6) for a in b.pose_angles.values()} - {0.0, 180.0})
    assert mags == [10.0, 76.0, 164.0]
    asm = pliego.Assembly([b.sheet], controls=[pliego.sequence_control()], sequence=b.sequence)
    doc = asm.build(cartridge="test", mode="canard")
    assert [i for i in doc.verify() if i["level"] == "error"] == []
    fo = b.face_orders()
    assert fo and all(s in (1, -1) for _, _, s in fo)
