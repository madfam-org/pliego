"""Rule 7: a mechanism's control has a kind the mechanism accepts, as the engine checks it."""

from __future__ import annotations

import pliego
from pliego.document_verify_refs import MECH_CONTROL_KINDS

L4 = {"en": "Lift", "es": "Subir", "fr": "Lever", "pt": "Levantar"}


def _doc(stocks, kind: str):
    s = pliego.Sheet("p", pliego.square(40), label=L4)
    mechs = [pliego.translate("lift", "pull", (0, 1, 0), 20.0)]
    hi, unit = (1, "") if kind == "sequence" else (20, "mm")
    controls = [pliego.control("pull", kind, L4, 0, 0, hi, unit)]
    return pliego.Assembly([s], mechanisms=mechs, controls=controls, title="t").build(
        stocks=stocks, cartridge="t")


def _kind_issues(doc):
    return [i for i in doc.verify() if i["kind"] == "control_kind_for_mechanism"]


def test_kinds_match_the_engine():
    assert MECH_CONTROL_KINDS == {"hinge": ("angle",), "rotate": ("angle",), "leaf": ("angle",),
                                  "slide": ("distance", "angle"),
                                  "translate": ("distance", "angle")}


def test_translate_driven_by_a_sequence_control_fails(stocks):
    issues = _kind_issues(_doc(stocks, "sequence"))
    assert [(i["level"], i["rule"]) for i in issues] == [("error", 7)]
    assert "expected distance|angle" in issues[0]["detail"]


def test_translate_driven_by_a_distance_control_passes(stocks):
    assert _kind_issues(_doc(stocks, "distance")) == []
