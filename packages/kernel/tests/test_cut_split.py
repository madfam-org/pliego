"""Spec §4: the vertices of a `cut` are split, so a zero-width slit can open (hardening item 3)."""

from __future__ import annotations

import pliego
from pliego.export.plan import build_plan

L4 = {"en": "Card", "es": "Tarjeta", "fr": "Carte", "pt": "Cartão"}


def _slit_card():
    """A slit from the left edge to the middle; a valley over the top-left flap ends on it."""
    s = pliego.Sheet("card", pliego.square(100), label=L4)
    slit = s.cut([(0, 50), (25, 50), (50, 50)])
    flap = s.valley((25, 50), (25, 100), angle=90)
    return s, slit, flap


def _errors(doc):
    return [i for i in doc.verify() if i["level"] == "error"]


def test_slit_vertices_split_except_the_inner_tip():
    s, slit, _ = _slit_card()
    arr = s.build()
    pts = [(round(v.x, 6), round(v.y, 6)) for v in arr.vertices]
    assert pts.count((0.0, 50.0)) == 2      # where it reaches the outline
    assert pts.count((25.0, 50.0)) == 2     # along the slit
    assert pts.count((50.0, 50.0)) == 1     # the tip inside the sheet stays one vertex
    cut = slit.edges()
    assert len(cut) == 4                    # two segments, one edge per side
    for e in cut:
        n = sum(1 for f in arr.faces for k in range(len(f))
                if {f[k], f[(k + 1) % len(f)]} == set(arr.edges[e]))
        assert n == 1                       # each side borders one face
    lhs, rhs = arr.euler()
    assert lhs == rhs


def test_slit_opens_in_a_target_frame_without_stretching(stocks):
    s, _, flap = _slit_card()
    doc = pliego.Assembly([s], targets={"open": {"angles": {flap: 90}}}).build(
        stocks=stocks)
    issues = doc.verify()
    assert not [i for i in issues if i["level"] == "error"], issues
    assert not [i for i in issues if i["kind"] == "not_developable"], issues
    frame = doc.frame("target:open")["vertices_coords"]
    ys = sorted(round(p[1], 6) for p, q in zip(frame, doc.data["vertices_coords"], strict=True)
                if (round(q[0], 6), round(q[1], 6)) == (0.0, 50.0))
    assert ys[0] == 0.0 and ys[1] > 20      # one copy stays on the table, the flap's copy lifts


def test_cut_is_drawn_once_and_is_not_a_bridge(stocks):
    s, _, _ = _slit_card()
    doc = pliego.Assembly([s]).build(stocks=stocks)
    assert _errors(doc) == []
    cuts = [st for st in build_plan(doc).strokes if st.kind == "C"]
    assert sum(len(st.points) - 1 for st in cuts) == 2   # each slit segment once
    report = pliego.papercut.analyze(s, min_feature_mm=1.0)
    assert report.ok, report.issues


def test_closed_cut_frees_its_island(stocks):
    s = pliego.Sheet("card", pliego.square(100), label=L4)
    s.cut(pliego.square(40, (30, 30)), closed=True)
    arr = s.build()
    pts = [(round(v.x, 6), round(v.y, 6)) for v in arr.vertices]
    assert pts.count((30.0, 30.0)) == 2 and pts.count((70.0, 70.0)) == 2
    assert pliego.papercut.components(arr).__len__() == 2
    assert _errors(pliego.Assembly([s]).build(stocks=stocks)) == []


def test_interior_single_segment_slit_stays_one_edge(stocks):
    s = pliego.Sheet("card", pliego.square(100), label=L4)
    slit = s.cut([(30, 50), (70, 50)])
    arr = s.build()
    assert len(slit.edges()) == 1 and len(arr.vertices) == len({(v.x, v.y) for v in arr.vertices})
    assert _errors(pliego.Assembly([s]).build(stocks=stocks)) == []


def test_verify_rejects_a_one_sided_cut_without_its_twin(stocks):
    s, slit, _ = _slit_card()
    doc = pliego.Assembly([s]).build(stocks=stocks)
    d = doc.data
    e = slit.edges()[0]
    d["edges_assignment"][e] = "C"
    twin = slit.edges()[-1]
    d["edges_vertices"][twin] = list(d["edges_vertices"][e])   # break the twin pairing
    d["pliego:meta"]["digest"] = None
    kinds = {i["kind"] for i in doc.verify() if i["level"] == "error"}
    assert "edge_faces" in kinds or "face_edge_missing" in kinds


def test_papercut_does_not_measure_a_slit_against_itself():
    """The two sides of a split slit are one cut line for papercut checks (not a 0-mm bridge,
    nor a bridge between a segment and the next-but-one segment of the other side)."""
    s = pliego.Sheet("card", pliego.square(100), label=L4)
    s.cut([(0, 50), (2, 50.6), (4, 50), (6, 50.6), (8, 50), (40, 50)])
    s.cut(pliego.circle((70, 70), 3, 24), closed=True)
    report = pliego.papercut.analyze(s, min_feature_mm=1.5)
    assert not [i for i in report.issues if i["kind"] == "bridge_too_thin"], report.issues
