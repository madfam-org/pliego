"""Spec §5.16: a sheet's presentation — preview root face and end transform (hardening item 9)."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
from test_stock import schema_errors

import pliego

SCHEMA = json.loads((Path(__file__).resolve().parents[3] / "packages" / "schemas"
                     / "sheet-document.schema.json").read_text(encoding="utf-8"))
L4 = {"en": "Card", "es": "Tarjeta", "fr": "Carte", "pt": "Cartão"}
UPRIGHT = (math.sin(math.pi / 4), 0.0, 0.0, math.cos(math.pi / 4))   # +90° about +x


def _card():
    s = pliego.Sheet("card", pliego.rectangle(100, 60), label=L4)
    fold = s.valley((50, 0), (50, 60), angle=90)
    return s, fold


def test_presentation_is_written_and_verifies(stocks):
    s, fold = _card()
    s.present(root=(75, 30), end=pliego.Placement((0.0, 30.0, 0.0), UPRIGHT))
    doc = pliego.Assembly([s], sequence=pliego.Sequence.fold_each()).build(stocks=stocks)
    pr = doc.sheets[0]["presentation"]
    ring = [doc.data["vertices_coords"][v] for v in doc.data["faces_vertices"][pr["root_face"]]]
    assert min(p[0] for p in ring) >= 50                       # the right half is the root
    assert pr["end"] == {"origin": [0, 30, 0], "rotation": [pytest.approx(UPRIGHT[0]), 0, 0,
                                                            pytest.approx(UPRIGHT[3])]}
    assert doc.verify() == []
    assert schema_errors(doc.data, SCHEMA, SCHEMA) == []
    assert s.copy("card-2").presentation == s.presentation


def test_presentation_is_checked(stocks):
    s, _ = _card()
    with pytest.raises(ValueError, match="off the sheet"):
        s.present(root=(150, 30))
    with pytest.raises(ValueError, match="unit quaternion"):
        s.present(end=pliego.Placement((0.0, 0.0, 0.0), (1.0, 1.0, 0.0, 0.0)))
    other = pliego.Sheet("other", pliego.rectangle(40, 40), label=L4)
    s.present(root=(10, 10))
    doc = pliego.Assembly([s, other]).build(stocks=stocks)
    doc.data["pliego:sheets"][0]["presentation"]["root_face"] = doc.sheet_faces(1)[0]
    doc.data["pliego:meta"]["digest"] = None
    assert {i["kind"] for i in doc.verify() if i["level"] == "error"} == {"presentation_root"}
