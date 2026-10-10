"""Fold programs from layer operations (`pliego.foldprogram`) and the preview replica
(`pliego.preview`)."""

from __future__ import annotations

import flat_models as fm
import pytest

import pliego
from pliego.flatstate import FlatStateError
from pliego.foldprogram import FoldProgram
from pliego.kinematics import pose_arrangement
from pliego.preview import PreviewTree

S = 150.0
SQUARE = [(0, 0), (S, 0), (S, S), (0, S)]


def doc_of(built):
    asm = pliego.Assembly([built.sheet], controls=[pliego.sequence_control()],
                          sequence=built.sequence, targets={"flat-folded": built.target()})
    return asm.build(cartridge="test", mode="default")


def test_simple_folds_are_exact_in_the_preview():
    fp = FoldProgram(SQUARE, stock="kami")
    fp.fold("diagonal", "Diagonal", ((S, 0), (0, S)), "valley", at=(10, 10))
    fp.fold("half", "Half", ((S / 2, S / 2), (S, S)), "valley", at=(S * 0.9, S * 0.6))
    fp.crease_and_unfold("pre", "Precrease", ((40, S), (40, S - 40)), "valley",
                         at=(30, S - 12), layers=2)
    b = fp.build()
    assert b.report["exact_steps"] == b.report["operations"] == 4
    assert [s.id for s in b.sequence.steps] == ["diagonal", "half", "pre", "pre-open"]
    assert b.sequence.mode == "physical"
    doc = doc_of(b)
    assert [i for i in doc.verify() if i["level"] == "error"] == []
    # the last step leaves every crease at its flat-folded angle
    assert set(b.pose_angles.values()) <= {0.0, 180.0, -180.0}
    assert b.pose_angles == b.final_angles


def test_squash_and_petal_steps_stay_rigid():
    fp, _ = fm.bird_base()
    b = fp.build()
    rows = {r["id"]: r for r in b.report["rows"]}
    for sid in ("squash-front", "squash-back", "petal-f", "petal-b"):
        assert rows[sid]["tear_mm"] < 1e-3
        assert rows[sid]["mid_tear_mm"] < 0.5          # samples refined until the blend holds
        assert rows[sid]["deviation_mm"] < 1e-3
    assert [i for i in doc_of(b).verify() if i["level"] == "error"] == []


def test_crane_program_reports_the_reverse_fold_approximation():
    fp, _ = fm.crane(wings="spread")
    b = fp.build()
    rows = {r["id"]: r for r in b.report["rows"]}
    for sid in ("neck", "tail", "head"):
        assert rows[sid]["kind"] == "reverse"
        assert rows[sid]["samples"] >= 8
    others = [r for r in b.report["rows"] if r["kind"] != "reverse"]
    assert all(r["tear_mm"] < 1e-3 for r in others)
    # the spread wings are a 3-D pose: two creases end well off flat
    off = [a for a in b.pose_angles.values() if 1.0 < abs(a) < 179.0]
    assert len(off) >= 2
    assert [i for i in doc_of(b).verify() if i["level"] == "error"] == []


def test_hinge_needs_an_existing_crease():
    fp = FoldProgram(SQUARE)
    fp.fold("diagonal", "Diagonal", ((S, 0), (0, S)), "valley", at=(10, 10))
    with pytest.raises(FlatStateError, match="existing creases"):
        fp.hinge("lift", "Lift", ((S, S / 3), (0, S / 3)), 45, at=(S * 0.8, S * 0.8))


def test_flat_operations_after_a_hinge_fail():
    fp = FoldProgram(SQUARE)
    fp.fold("diagonal", "Diagonal", ((S, 0), (0, S)), "valley", at=(10, 10))
    fp.hinge("open", "Open", ((S, 0), (0, S)), -90, at=(S * 0.8, S * 0.8), layers=1)
    with pytest.raises(FlatStateError, match="before hinge"):
        fp.fold("again", "Again", ((0, 0), (S, S)), "valley", at=(S * 0.9, S * 0.5))


def test_preview_tree_matches_the_kernel_face_tree_on_consistent_angles():
    fp, _ = fm.bird_base()
    b = fp.build()
    tree = PreviewTree(b.arr)
    poses = tree.pose(b.final_angles)
    assert tree.tear(poses) < 1e-3
    ref = pose_arrangement(b.arr, b.final_angles)
    for fi, cyc in enumerate(b.arr.faces):
        for v in cyc:
            p = poses[fi]
            got = tuple(sum(p[0][r][c] * tree.unplaced[v][c] for c in range(3)) + p[1][r]
                        for r in range(3))
            assert got == pytest.approx(ref[v], abs=1e-3)
