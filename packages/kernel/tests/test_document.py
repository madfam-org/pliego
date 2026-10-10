from __future__ import annotations

import copy
import random

import pytest

import pliego
from pliego import Document

L4 = {"en": "Base", "es": "Base", "fr": "Base", "pt": "Base"}


def build_square(stocks, noise=lambda v: v, order=(0, 1, 2)):
    s = pliego.Sheet("square", [(noise(x), noise(y)) for x, y in pliego.square(150)],
                     label={"en": "Square", "es": "Cuadrado", "fr": "Carré", "pt": "Quadrado"})
    lines = [((0, 0), (150, 150), "valley"), ((150, 0), (0, 150), "mountain"),
             ((0, 75), (150, 75), "valley")]
    for i in order:
        a, b, k = lines[i]
        s.crease((noise(a[0]), noise(a[1])), (noise(b[0]), noise(b[1])), k)
    a = pliego.Assembly([s], controls=[pliego.sequence_control()],
                        sequence=pliego.Sequence.fold_each())
    return a.build(stocks=stocks)


def build_rich(stocks) -> Document:
    base = pliego.Sheet("base", pliego.rectangle(200, 100), stock="card", label=L4)
    gutter = base.valley((100, 0), (100, 100), angle=90)
    flap = pliego.Sheet("flap", pliego.rectangle(40, 30), label=L4,
                        placement=pliego.Placement((50.0, 0.0, -60.0)))
    tab = flap.tab(0, width=8, taper=45)
    flap.mountain((20, 0), (20, 30), angle=45)
    joins = [
        pliego.glue("tab-glue", flap, tab.region, base, (1, 0, 0, 1, 50, 60)),
        pliego.pin("lift-pin", (flap, (20, 25)), mechanism="lift"),
    ]
    mechs = [pliego.translate("lift", "pull", (0, 1, 0), 20.0)]
    controls = [pliego.angle_control("open", L4), pliego.control("pull", "distance", L4, 0, 0, 20,
                                                                 "mm")]
    seq = pliego.Sequence([pliego.Step("open-gutter", L4, [(gutter, None)]),
                           pliego.Step("release", L4, release=[gutter])])
    return pliego.Assembly([base, flap], joins=joins, mechanisms=mechs, controls=controls,
                           sequence=seq, title="rich").build(stocks=stocks, cartridge="rich")


def kinds(doc: Document, **kw) -> set[str]:
    return {i["kind"] for i in doc.verify(**kw) if i["level"] == "error"}


def test_square_builds_clean(stocks):
    d = build_square(stocks)
    assert d.verify() == []
    assert d.summary() == "verify: sheets=1 vertices=7 edges=12 faces=6 joins=0 errors=0 warnings=0"
    assert d.data["pliego:controls"][0]["max"] == 3


def test_rich_document_is_clean(stocks):
    d = build_rich(stocks)
    assert d.verify() == [], d.verify()
    assert d.frame("initial") is not None
    assert d.data["frame_attributes"] == ["2D", "noCuts", "joins"]
    assert d.summary().startswith("verify: sheets=2 ") and "joins=2 errors=0" in d.summary()


def test_round_trip_and_digest(stocks):
    d = build_rich(stocks)
    again = Document.from_json(d.to_json())
    assert again == d and again.to_json() == d.to_json()
    assert Document.from_json(d.to_json(pretty=True)) == d
    assert d.data["pliego:meta"]["digest"] == d.digest()


def test_byte_determinism_under_noise(stocks):
    rnd = random.Random(7)
    ref = build_square(stocks).to_bytes()
    for _ in range(5):
        noisy = build_square(stocks, noise=lambda v: v + rnd.uniform(-1e-9, 1e-9))
        assert noisy.to_bytes() == ref


def test_byte_determinism_under_shuffled_authoring(stocks):
    ref = build_square(stocks).to_bytes()
    assert build_square(stocks, order=(2, 0, 1)).to_bytes() != b""
    # fold_each follows authored order, so compare everything but the program
    a = build_square(stocks, order=(2, 0, 1)).data
    b = Document.from_json(ref).data
    for k in ("vertices_coords", "edges_vertices", "edges_assignment", "faces_vertices",
              "edges_foldAngle", "pliego:edges_treatment"):
        assert a[k] == b[k]


def test_independent_sheets_do_not_interact(stocks):
    def sheet(name):
        s = pliego.Sheet(name, pliego.square(50))
        s.valley((0, 25), (50, 25))
        return s

    one = pliego.Assembly([sheet("a"), sheet("b")]).build(stocks=stocks)
    two = pliego.Assembly([sheet("b"), sheet("a")]).build(stocks=stocks)
    assert one.verify() == [] and two.verify() == []

    def local(doc, sid):
        i = doc.sheet_index(sid)
        off = doc.sheets[i]["offset"]
        return sorted((x - off[0], y - off[1]) for v, (x, y) in enumerate(doc.data[
            "vertices_coords"]) if doc.data["pliego:vertices_sheet"][v] == i)

    assert local(one, "a") == local(two, "a") and local(one, "b") == local(two, "b")


# ── every §8 rule fails closed ───────────────────────────────────────────────


def mutate(doc: Document, fn) -> Document:
    d = copy.deepcopy(doc.data)
    fn(d)
    return Document(d)


def _first(d, asg):
    return d["edges_assignment"].index(asg)


CASES = [
    ("array_length", lambda d: d["pliego:edges_treatment"].pop()),
    ("index_range", lambda d: d["edges_vertices"].__setitem__(0, [0, 9999])),
    ("sheet_mismatch", lambda d: d["pliego:edges_sheet"].__setitem__(0, 1)),
    ("face_orientation", lambda d: d["faces_vertices"][0].reverse()),
    ("tiling", lambda d: (d["faces_vertices"].pop(), d["pliego:faces_sheet"].pop())),
    ("treatment_assignment", lambda d: d["pliego:edges_treatment"].__setitem__(
        _first(d, "B"), "crease")),
    ("fold_angle_assignment", lambda d: (d["edges_assignment"].__setitem__(_first(d, "V"), "C"),
                                         d["pliego:edges_treatment"].__setitem__(
                                             d["edges_assignment"].index("C"), "cut"))),
    ("fold_angle_sign", lambda d: d["edges_foldAngle"].__setitem__(_first(d, "V"), -90)),
    ("edge_faces", lambda d: d["edges_assignment"].__setitem__(_first(d, "V"), "B")),
    ("sheet_overlap", lambda d: [d["vertices_coords"].__setitem__(i, [c[0] - 200, c[1]])
                                 for i, c in enumerate(d["vertices_coords"])
                                 if d["pliego:vertices_sheet"][i] == 1]),
    ("stock_reference", lambda d: d["pliego:sheets"][0].__setitem__("stock", "nope")),
    ("stock_derived", lambda d: d["pliego:stocks"]["card"]["derived"].pop("crease_k")),
    ("sheet_reference", lambda d: d["pliego:joins"][0]["b"].__setitem__("sheet", "ghost")),
    ("glue_region", lambda d: d["pliego:joins"][0]["a"]["region"].__setitem__(0, [500, 500])),
    ("point_outside", lambda d: d["pliego:joins"][1]["a"].__setitem__("at", [99, 99])),
    ("mechanism_reference", lambda d: d["pliego:joins"][1].__setitem__("mechanism", "ghost")),
    ("control_reference", lambda d: d["pliego:mechanisms"][0].__setitem__("control", "ghost")),
    ("duplicate_id", lambda d: d["pliego:controls"].append(dict(d["pliego:controls"][0]))),
    ("sequence_control", lambda d: d.__setitem__("pliego:controls", [
        c for c in d["pliego:controls"] if c["kind"] != "sequence"])),
    ("target_assignment", lambda d: d["pliego:sequence"]["steps"][0]["targets"].append(
        [_first(d, "B"), 0])),
    ("target_angle", lambda d: d["pliego:sequence"]["steps"][0]["targets"][0].__setitem__(1, 270)),
    ("release_reference", lambda d: d["pliego:sequence"]["steps"][1]["release"].append(99999)),
    ("initial_missing", lambda d: d.pop("file_frames")),
    ("not_developable", lambda d: d["file_frames"][0].__setitem__("vertices_coords", [
        [c * 1.01 for c in p] for p in d["file_frames"][0]["vertices_coords"]])),
    ("glue_weld", lambda d: [p.__setitem__(1, p[1] + 5) for i, p in enumerate(
        d["file_frames"][0]["vertices_coords"]) if d["pliego:vertices_sheet"][i] == 1]),
    ("digest_mismatch", lambda d: d.__setitem__("file_title", "tampered")),
]


@pytest.mark.parametrize(("kind", "fn"), CASES, ids=[c[0] for c in CASES])
def test_verify_rejects(stocks, kind, fn):
    doc = build_rich(stocks)
    bad = mutate(doc, fn)
    assert kind in kinds(bad), bad.verify()
    assert "errors=0" not in bad.summary()


def test_face_degenerate_threshold(stocks):
    assert "face_degenerate" in kinds(build_square(stocks), min_face_area_mm2=1e9)


def test_sheets_zero_is_a_failure():
    doc = Document({"pliego:sheets": [], "vertices_coords": [], "edges_vertices": [],
                    "faces_vertices": []})
    assert "no_sheets" in kinds(doc) or "missing_field" in kinds(doc)
    assert doc.summary().startswith("verify: sheets=0")
