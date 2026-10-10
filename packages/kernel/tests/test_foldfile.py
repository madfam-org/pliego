from __future__ import annotations

import json

import pliego
from pliego import foldfile

PLAIN = {
    "file_spec": 1.1,
    "file_creator": "hand-written test",
    "vertices_coords": [[0, 0], [100, 0], [100, 100], [0, 100]],
    "edges_vertices": [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
    "edges_assignment": ["B", "B", "B", "B", "V"],
    "faces_vertices": [[0, 1, 2], [0, 2, 3]],
}


def test_plain_fold_gets_section7_defaults(stocks):
    doc = foldfile.load(json.dumps(PLAIN), stocks=stocks)
    assert doc.verify() == []
    d = doc.data
    assert d["pliego:sheets"][0]["id"] == "sheet-0"
    assert d["pliego:sheets"][0]["stock"] == "kami"
    assert d["pliego:sheets"][0]["grain_deg"] == 90
    assert d["pliego:edges_treatment"] == ["none"] * 4 + ["crease"]
    assert d["edges_foldAngle"][4] == 180
    steps = d["pliego:sequence"]["steps"]
    assert len(steps) == 1 and steps[0]["targets"] == [[4, 180]]
    assert d["pliego:controls"][0]["kind"] == "sequence"


def test_plain_fold_without_faces_is_subdivided(stocks):
    plain = {k: v for k, v in PLAIN.items() if k != "faces_vertices"}
    plain["edges_vertices"] = plain["edges_vertices"] + [[1, 3]]
    plain["edges_assignment"] = plain["edges_assignment"] + ["M"]
    plain["edges_foldAngle"] = [0, 0, 0, 0, 90, -90]
    doc = foldfile.load(plain, stocks=stocks)
    assert doc.verify() == []
    assert doc.count("faces_vertices") == 4
    assert sorted(a for a in doc.data["edges_assignment"] if a in "MV") == ["M", "M", "V", "V"]


def test_sheet_document_passes_through_and_exports(stocks):
    s = pliego.Sheet("square", pliego.square(50))
    s.valley((0, 0), (50, 50))
    doc = pliego.Assembly([s]).build(stocks=stocks)
    again = foldfile.load(foldfile.dump(doc))
    assert again == doc
    plain = foldfile.to_plain_fold(doc)
    assert not any(k.startswith("pliego:") for k in plain)
    assert plain["edges_assignment"] == doc.data["edges_assignment"]
