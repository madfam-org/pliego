"""Book generators: valid documents, leaf mechanisms and page-turn controls, structure checks."""

from __future__ import annotations

import math

import pytest

from pliego import book as B
from pliego.tessellate import document_fold_angles


@pytest.mark.parametrize("name", sorted(B.GENERATORS))
def test_every_book_emits_a_valid_document(name):
    doc = B.GENERATORS[name]().build()
    issues = doc.verify()
    assert issues == [], doc.summary(issues)
    assert doc.to_bytes() == B.GENERATORS[name]().build().to_bytes()


def test_leaf_is_the_simplest_object():
    d = B.leaf().build().data
    assert len(d["pliego:sheets"]) == 1 and len(d["faces_vertices"]) == 1
    (mech,) = d["pliego:mechanisms"]
    assert mech["type"] == "leaf" and mech["spine"] == [[0, 0], [0, 210]]
    (ctrl,) = d["pliego:controls"]
    assert (ctrl["kind"], ctrl["min"], ctrl["max"], ctrl["default"]) == ("angle", 0, 180, 0)
    (spine,) = d["pliego:joins"]
    assert spine["type"] == "pin" and spine["world"] is None


def test_codex_has_one_turn_control_per_leaf_and_stacks_leaves():
    d = B.codex(leaves=5).build().data
    assert [c["id"] for c in d["pliego:controls"]] == [f"turn-{k}" for k in range(1, 6)]
    assert [m["control"] for m in d["pliego:mechanisms"]] == [f"turn-{k}" for k in range(1, 6)]
    ys = [s["placement"]["origin"][1] for s in d["pliego:sheets"]]
    assert ys == sorted(ys, reverse=True) and ys[-1] == 0          # leaf 1 on top
    gaps = [a - b for a, b in zip(ys, ys[1:], strict=False)]
    assert all(g >= d["pliego:stocks"]["copy-80"]["derived"]["collision_thickness"]
               for g in gaps)


def test_leporello_alternates_and_closes():
    d = B.leporello(panels=6).build().data
    folds = [(a, f) for a, f in zip(d["edges_assignment"], d["edges_foldAngle"], strict=True)
             if a in "MV"]
    assert [a for a, _ in folds] == ["V", "M", "V", "M", "V"]
    assert all(abs(f) == 180 for _, f in folds)
    assert d["pliego:sequence"]["mode"] == "kinematic"


def test_screenfold_codex_follows_the_cited_proportions():
    doc = B.screenfold_codex().build()
    d = doc.data
    assert d["pliego:sheets"][0]["stock"] == "amate"
    xs = [p[0] for p in d["vertices_coords"]]
    assert max(xs) - min(xs) == pytest.approx(3510.0)              # ≈ 3.5–3.7 m unfolded
    assert len(d["faces_vertices"]) == 39
    assert d["pliego:meta"]["params"]["proportions_source"].startswith("https://")


def test_tunnel_book_frames_stand_in_depth_order():
    doc = B.tunnel_book(frames=3).build()
    d = doc.data
    init = doc.frame("initial")["vertices_coords"]
    for k in range(3):
        sid = next(i for i, s in enumerate(d["pliego:sheets"]) if s["id"] == f"frame-{k + 1}")
        ox = d["pliego:sheets"][sid]["offset"][0]
        body = [v for v in doc.sheet_vertices(sid)
                if 10.0 <= d["vertices_coords"][v][0] - ox <= 130.0]
        assert body and {round(init[v][2], 6) for v in body} == {-30.0 * k}
    holes = sum(1 for s in d["pliego:sheets"] if s["id"].startswith("frame-"))
    assert holes == 3
    measured = document_fold_angles(doc, "initial")
    tabs = [e for e, a in measured.items() if abs(a) > 1e-6]
    assert tabs and all(measured[e] == pytest.approx(-90.0) for e in tabs)   # tabs fold back


def test_carousel_leaves_radiate_and_ribbons_are_taut():
    doc = B.carousel(leaves=6).build()
    d = doc.data
    init = doc.frame("initial")["vertices_coords"]
    for j in d["pliego:joins"]:
        if j["type"] != "string":
            continue
        assert j["length"] == pytest.approx(2 * 95.0 * math.sin(math.pi / 6), abs=1e-6)
    assert all(abs(p[0]) < 1e-9 and abs(p[2]) < 1e-9 for p in init
               if math.hypot(p[0], p[2]) < 1e-6)


def test_bad_parameters_fail_loud():
    with pytest.raises(ValueError):
        B.codex(leaves=0)
    with pytest.raises(ValueError):
        B.tunnel_book(tab=40, depth=30)
    with pytest.raises(ValueError):
        B.carousel(leaves=2)
    with pytest.raises(ValueError):
        B.leporello(panels=1)
