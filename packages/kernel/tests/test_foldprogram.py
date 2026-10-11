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


def test_operating_cycle_starts_from_the_finished_model():
    fp = FoldProgram(SQUARE)
    fp.fold("diagonal", "Diagonal", ((S, 0), (0, S)), "valley", at=(10, 10))
    fp.fold("half", "Half", ((S / 2, S / 2), (S, S)), "valley", at=(S * 0.9, S * 0.6))
    flap = {"line": ((S / 2, S / 2), (S, S)), "at": (S * 0.55, S * 0.9), "layers": 1}
    fp.hinges("open", "Open", [dict(flap, turn=-120)])
    fp.hinges("beat", "Beat", [dict(flap, turn=30)])
    with pytest.raises(FlatStateError, match="share faces"):
        fp.hinges("twice", "Twice", [dict(flap, turn=5), dict(flap, turn=5)])
    b = fp.build(start_after="open")
    assert [s.id.split("-")[0] for s in b.sequence.steps] == ["beat"] * 4
    assert any(abs(abs(a) - 60.0) < 1e-6 for a in b.start_angles.values())
    asm = pliego.Assembly([b.sheet], controls=[pliego.sequence_control("beat")],
                          sequence=b.sequence, initial=b.initial("square"))
    doc = asm.build(cartridge="test", mode="cycle")
    assert [i for i in doc.verify() if i["level"] == "error"] == []
    with pytest.raises(FlatStateError, match="no step"):
        fp.build(start_after="nope")


def test_face_orders_are_complete_and_antisymmetric():
    fp, _ = fm.bird_base()
    b = fp.build()
    fo = b.face_orders()
    assert fo and all(s in (1, -1) for _, _, s in fo)
    pairs = {(f, g) for f, g, _ in fo}
    assert len(pairs) == len(fo) and not any((g, f) in pairs for f, g in pairs)
    # faces adjacent across a folded crease: the kernel's local rule (valley +1, mountain −1)
    full = {(f, g): s for f, g, s in fo}
    local = pliego.flatfold.face_orders_local(b.arr)
    checked = 0
    for f, g, s in local:
        got = full.get((f, g), full.get((g, f)))
        if got is not None:
            assert got == s
            checked += 1
    assert checked > 10


def test_crease_marks_lines_without_a_step():
    fp = FoldProgram(SQUARE)
    fp.crease("mark", "Mark", ((0, S / 2), (S, S / 2)), "valley", at=(10, 10))
    fp.fold("diagonal", "Diagonal", ((S, 0), (0, S)), "valley", at=(10, 10))
    b = fp.build()
    assert [s.id for s in b.sequence.steps] == ["diagonal"]
    kinds = sorted(m.assignment for m in b.sheet.marks)
    assert "F" in kinds and "V" in kinds


def test_document_carries_complete_face_orders(stocks):
    """Hardening item 7: `Assembly(face_orders={sheet: built})` writes the fold program's complete
    layer order as FOLD faceOrders; a sheet edited after build() is refused."""
    fp = FoldProgram(SQUARE, stock="kami")
    fp.fold("diagonal", "Diagonal", ((S, 0), (0, S)), "valley", at=(10, 10))
    fp.fold("half", "Half", ((S / 2, S / 2), (S, S)), "valley", at=(S * 0.9, S * 0.6))
    b = fp.build()
    asm = pliego.Assembly([b.sheet], controls=[pliego.sequence_control()], sequence=b.sequence,
                          face_orders={b.sheet: b})
    doc = asm.build(stocks=stocks)
    assert doc.data["faceOrders"] == sorted(b.face_orders())
    pairs = {frozenset(t[:2]) for t in doc.data["faceOrders"]}
    local = {frozenset(t[:2]) for t in pliego.flatfold.face_orders_local(b.arr)}
    assert local < pairs                  # every local pair, plus the non-adjacent layers
    assert [i for i in doc.verify() if i["level"] == "error"] == []
    doc.data["faceOrders"].append([0, 0, 1])
    assert "face_orders" in {i["kind"] for i in doc.verify() if i["level"] == "error"}
    b.sheet.valley((0, 10), (S, 10))                      # the faces no longer match
    with pytest.raises(ValueError, match="do not match"):
        pliego.Assembly([b.sheet], face_orders={b.sheet.id: b}).build(stocks=stocks)


# ── spec §5.39: a hinge flap named by sheet points or faces ──

def test_dart_fuselage_opens_with_its_corner_flap():
    from pliego import flatmotion
    from pliego.flatstate import embed3
    from pliego.foldpose import rigid_dev

    c, H = 105.0, 297.0
    keel = ((c, -10.0), (c, H + 10.0))
    half, flap = (c - 20.0, 150.0), (20.0, 230.0)     # the left half; its first corner flap
    cut = fm.dart_plane()
    st = cut.state
    at, fl, hf = st.to_folded(half), st.face_at(flap), st.face_at(half)
    cut.hinge("open", "open", keel, 16.0, at=at, layers=1)
    # the flood stops at the corner crease, which lies on the keel: the flap stays behind
    assert fl not in cut.recs[-1].hinge["specs"][0]["faces"]
    fp = fm.dart_plane()
    fp.hinge("open", "open", keel, 16.0, at=at, sheet_points=[half, flap])
    faces = fp.recs[-1].hinge["specs"][0]["faces"]
    assert fl in faces and hf in faces
    w = fp.pose.world
    rel = flatmotion.compose(flatmotion.invert(w[hf]), w[fl])
    flat = flatmotion.compose(flatmotion.invert(embed3(st.faces[hf].xf)), embed3(st.faces[fl].xf))
    assert rigid_dev(rel, flat) < 1e-9          # the flap turned with its half
    assert fp.build().report["rows"][-1]["tear_mm"] < 1e-9


def test_hinge_faces_names_the_flap_exactly():
    fp = fm.dart_plane()
    c, H = 105.0, 297.0
    keel = ((c, -10.0), (c, H + 10.0))
    st = fp.state
    left = sorted(f for f in range(len(st.faces))
                  if sum(p[0] for p in st.poly(f)) / len(st.poly(f)) < c)
    at = st.to_folded((c - 20.0, 150.0))
    with pytest.raises(FlatStateError, match="faces must name"):
        fp.hinge("open", "open", keel, 16.0, at=at, faces=[len(st.faces)])
    with pytest.raises(FlatStateError, match="joined to the rest off the line"):
        fp.hinge("open", "open", keel, 16.0, at=at, faces=left[:1])
    fp.hinge("open", "open", keel, 16.0, at=at, faces=left)
    assert fp.recs[-1].hinge["specs"][0]["faces"] == left


# ── spec §5.16: the preview replica roots where the sheet's presentation says ──

def test_program_fits_the_preview_rooted_at_root_face():
    from pliego.geometry import Vec2
    from pliego.kinematics import root_face

    def replay(b, root):
        tree, cur, worst = PreviewTree(b.arr, root), dict(b.start_angles), 0.0
        for st in b.sequence.steps:
            cur.update({r.edge: a for r, a in st.targets})
            worst = max(worst, tree.tear(tree.pose(cur)))
        return worst
    fp, _ = fm.crane(wings="spread")
    at = (140.0, 20.0)                         # a face far from face 0 (the reverse folds)
    b = fp.build(root=at)
    rf = root_face(b.arr, Vec2(*at))
    assert rf != 0 and b.sheet.presentation["root"] == Vec2(*at)
    # the report is what the preview draws holding that face still, not face 0
    assert b.report["max_tear_mm"] == pytest.approx(replay(b, rf), abs=1e-5)
    assert replay(b, 0) > 5.0 * b.report["max_tear_mm"]       # drawn from face 0: not this
    doc = doc_of(b)
    assert doc.data["pliego:sheets"][0]["presentation"]["root_face"] == rf
    assert [i for i in doc.verify() if i["level"] == "error"] == []
    with pytest.raises(ValueError, match="not a face"):
        PreviewTree(b.arr, len(b.arr.faces))
