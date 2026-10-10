"""Kernel 0.2 authoring: edge names, rest angles, stock appearance, Sheet.copy, min_feature_mm."""

from __future__ import annotations

import pytest
from conftest import KAMI

import pliego


def _doc(*sheets, **kw):
    return pliego.Assembly(list(sheets), **kw).build(stocks={"kami": KAMI})


def test_names_on_marks_and_label_edge_emit_edges_name():
    s = pliego.Sheet("spread", pliego.rectangle(200, 100))
    gutter = s.valley((100, 0), (100, 100), angle=180, name="gutter")
    s.label_edge("fore-edge", (200, 0), (200, 100))
    s.label_edge("spine", (0, 0), (0, 100))
    doc = _doc(s)
    names = doc.data["pliego:edges_name"]
    assert len(names) == len(doc.data["edges_vertices"])
    assert [names[e] for e in gutter.edges()] == ["gutter"]
    assert names.count("fore-edge") == 1 and names.count("spine") == 1
    assert names.count(None) == len(names) - 3
    assert doc.verify() == []


def test_a_name_may_span_several_edges_and_crossings_split_it():
    s = pliego.Sheet("sq", pliego.square(100))
    s.valley((50, 0), (50, 100), name="axis")
    s.mountain((0, 50), (100, 50))                     # splits the named crease in two
    s.label_edge("bottom", (0, 0), (100, 0))           # the outline's bottom: two edges
    names = _doc(s).data["pliego:edges_name"]
    assert names.count("axis") == 2 and names.count("bottom") == 2


def test_tab_name_names_the_glue_tab_edges():
    s = pliego.Sheet("strip", pliego.rectangle(60, 40))
    tab = s.tab(((60, 0), (60, 40)), width=8, taper=45, name="tab")
    doc = _doc(s)
    names = doc.data["pliego:edges_name"]
    assert names.count("tab") == 4                     # hinge + three free outline edges
    assert [names[e] for e in tab.mark.edges()] == ["tab"]
    assert tab.name == "tab"


def test_unnamed_documents_carry_no_names_array():
    s = pliego.Sheet("plain", pliego.square(50))
    s.valley((0, 0), (50, 50))
    data = _doc(s).data
    assert "pliego:edges_name" not in data and "pliego:edges_restAngle" not in data


def test_bad_names_fail_loud():
    s = pliego.Sheet("x", pliego.square(50))
    with pytest.raises(ValueError):
        s.valley((0, 0), (50, 50), name="Bad Name")
    with pytest.raises(ValueError):
        s.label_edge("ok", (1, 1), (1, 1))
    s.valley((0, 0), (50, 50), name="diag")
    s.label_edge("other", (0, 0), (50, 50))
    with pytest.raises(ValueError, match="named both"):
        _doc(s)
    t = pliego.Sheet("y", pliego.square(50))
    t.label_edge("nowhere", (10, 10), (20, 20))
    with pytest.raises(ValueError, match="matches no edge"):
        _doc(t)


def test_verify_rejects_non_slug_names_and_bad_rest_angles():
    s = pliego.Sheet("v", pliego.square(50))
    s.valley((0, 0), (50, 50), name="diag", rest=30)
    doc = _doc(s)
    doc.data["pliego:edges_name"][0] = "Not A Slug"
    doc.data["pliego:edges_restAngle"][1] = 200
    kinds = {i["kind"] for i in doc.verify()}
    assert {"edge_name", "rest_angle_range"} <= kinds


def test_rest_angles_pre_crease_a_sheet():
    s = pliego.Sheet("pre", pliego.square(100))
    v = s.valley((0, 50), (100, 50), angle=180, rest=40)
    m = s.mountain((50, 0), (50, 50), angle=180, rest=25)
    f = s.score((50, 50), (50, 100), kind="flat", rest=-10)
    doc = _doc(s)
    rest = doc.data["pliego:edges_restAngle"]
    assert {rest[e] for e in v.edges()} == {40}
    assert [rest[e] for e in m.edges()] == [-25]       # the sign follows the kind
    assert [rest[e] for e in f.edges()] == [-10]       # flat lines take it as given
    asg = doc.data["edges_assignment"]
    assert all(r == 0 for r, a in zip(rest, asg, strict=True) if a == "B")
    assert doc.verify() == []
    with pytest.raises(ValueError):
        s.valley((0, 0), (100, 100), rest=190)
    with pytest.raises(TypeError):
        s.cut([(10, 10), (20, 20)], rest=5)  # type: ignore[call-arg]


def test_unauthored_faces_inherit_the_stock_appearance():
    snap = {**KAMI, "appearance": {"front": "#d9382b", "back": "#f6f3ec"}}
    a = pliego.Sheet("inherit", pliego.square(50))
    b = pliego.Sheet("authored", pliego.square(50), front="#112233")
    doc = pliego.Assembly([a, b]).build(stocks={"kami": snap})
    sa, sb = doc.data["pliego:sheets"]
    assert sa["front"]["color"] == "#d9382b" and sa["back"]["color"] == "#f6f3ec"
    assert sb["front"]["color"] == "#112233" and sb["back"]["color"] == "#f6f3ec"
    plain = pliego.Assembly([pliego.Sheet("p", pliego.square(10))]).build(stocks={"kami": KAMI})
    assert plain.data["pliego:sheets"][0]["front"]["color"] == pliego.sheet.DEFAULT_FACE_COLOR


def test_committed_stock_appearance_reaches_the_document():
    doc = pliego.Assembly([pliego.Sheet("k", pliego.square(40), stock="kami")]).build()
    card = pliego.stock.load_card("kami")
    s = doc.data["pliego:sheets"][0]
    assert s["front"]["color"] == card["appearance"]["front"]
    assert doc.data["pliego:stocks"]["kami"]["appearance"]["back"] == card["appearance"]["back"]
    assert doc.verify() == []


def test_sheet_copy_reuses_the_arrangement_and_rebinds_marks():
    s = pliego.Sheet("flag-1", pliego.rectangle(80, 120), front="#e8336d")
    s.hole(pliego.square(10, (20, 40)))
    m = s.valley((40, 0), (40, 30), name="axis")
    c = s.copy("flag-2")
    assert c.build() is s.build()
    assert c.marks[0].sheet is c and c.marks[0].edges() == m.edges()
    assert c.front.color == "#e8336d" and c.holes == s.holes
    doc = _doc(s, c)
    assert doc.data["pliego:edges_name"].count("axis") == 2
    assert doc.verify() == []
    c.valley((0, 60), (80, 60))                        # authoring the copy detaches it
    assert c.build() is not s.build()


def test_identical_geometry_shares_one_subdivision():
    def flag(i):
        f = pliego.Sheet(f"f-{i}", pliego.rectangle(50, 60))
        f.hole(pliego.square(8, (10, 10)))
        return f

    assert flag(1).build() is flag(2).build()


def test_min_feature_mm_sets_the_face_floor():
    def sliver(**kw):
        s = pliego.Sheet("thin", pliego.rectangle(100, 50))
        s.valley((0.6, 0), (0.6, 50), angle=90)        # a 0.6 × 50 = 30 mm² strip
        return pliego.Assembly([s], **kw).build(stocks={"kami": KAMI})

    assert sliver().verify() == []                                 # floor 1 mm²
    issues = sliver(min_feature_mm=6.0).verify()                   # floor 36 mm²
    assert [i["kind"] for i in issues] == ["face_degenerate"]
    doc = sliver(min_feature_mm=6.0)
    assert doc.data["pliego:meta"]["min_feature_mm"] == 6
    assert doc.verify(min_face_area_mm2=1.0) == []                 # explicit floor wins
    with pytest.raises(ValueError):
        pliego.Assembly([pliego.Sheet("z", pliego.square(5))], min_feature_mm=0)
    doc.data["pliego:meta"]["min_feature_mm"] = -1
    assert "min_feature" in {i["kind"] for i in doc.verify()}
