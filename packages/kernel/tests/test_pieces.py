"""Removable pieces, stacks and tear-away (spec §5.8, rules §8.11–§8.12)."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from test_stock import schema_errors

import pliego
from pliego.pieces import arrangement_regions, interior_point, separates

SCHEMA = json.loads((Path(__file__).resolve().parents[3] / "packages" / "schemas"
                     / "sheet-document.schema.json").read_text(encoding="utf-8"))
L4 = {"en": "Tear", "es": "Desprende", "fr": "Détache", "pt": "Destaque"}


def ticket(kind: str = "perforation") -> tuple[pliego.Sheet, pliego.Assembly]:
    """A 100 × 40 card with a tear-off stub on the right (perforated, cut or kiss-cut)."""
    card = pliego.Sheet("card", pliego.rectangle(100, 40), stock="card")
    if kind == "perforation":
        card.perforate((70, 0), (70, 40), kind="cut")
    elif kind == "cut":
        card.cut([(70, 0), (70, 40)])
    else:
        card.halfcut([(70, 0), (70, 40)])
    pieces = [pliego.piece("body", card, at=(10, 10), role="keep"),
              pliego.piece("stub", card, at=(90, 10), pull=(1, 0, 0))]
    seq = pliego.Sequence([pliego.Step("tear", L4, remove=["stub"])])
    return card, pliego.Assembly([card], pieces=pieces, sequence=seq,
                                 controls=[pliego.sequence_control("tear", L4)])


def errors(doc: pliego.Document) -> list[dict]:
    return [i for i in doc.verify() if i["level"] == "error"]


@pytest.mark.parametrize("kind", ["perforation", "cut", "halfcut"])
def test_ticket_pieces_resolve_for_every_separating_edge(kind, stocks):
    _, asm = ticket(kind)
    doc = asm.build(stocks=stocks)
    assert errors(doc) == []
    pieces = doc.data["pliego:pieces"]
    assert [p["id"] for p in pieces] == ["body", "stub"]
    assert pieces[1]["pull"] == [1, 0, 0]
    assert set(pieces[0]["faces"]).isdisjoint(pieces[1]["faces"])
    assert doc.data["pliego:sequence"]["steps"][0]["remove"] == ["stub"]
    assert schema_errors(doc.data, SCHEMA, SCHEMA) == []


def test_a_crease_does_not_separate(stocks):
    card = pliego.Sheet("card", pliego.rectangle(100, 40), stock="card")
    card.valley((50, 0), (50, 40))
    regs = arrangement_regions(card.build())
    assert len(regs) == 1 and len(regs[0]) == 2
    assert separates("C", "perforation") and separates("F", "halfcut")
    assert not separates("F", "score") and not separates("J", "none")


def test_piece_point_must_be_inside(stocks):
    card, _ = ticket()
    asm = pliego.Assembly([card], pieces=[pliego.piece("p", card, at=(150, 10))])
    with pytest.raises(ValueError, match="not strictly inside"):
        asm.build(stocks=stocks)


def test_builders_fail_loud():
    with pytest.raises(ValueError, match="exactly one"):
        pliego.piece("p", "card")
    with pytest.raises(ValueError, match="role"):
        pliego.piece("p", "card", at=(1, 1), role="waste")
    with pytest.raises(ValueError, match="pull"):
        pliego.piece("p", "card", at=(1, 1), pull=(0, 0, 0))
    with pytest.raises(ValueError, match="two sheets"):
        pliego.stack("s", ["a"], 0.1)
    with pytest.raises(ValueError, match="represents"):
        pliego.stack("s", ["a", "b"], 0.1, represents=0)
    with pytest.raises(ValueError, match="bond"):
        pliego.stack("s", ["a", "b"], 0.1, bond="glue")


MUTATIONS = [
    ("piece_reference", lambda d: d["pliego:sequence"]["steps"][0]["remove"].append("ghost")),
    ("remove_keep", lambda d: d["pliego:sequence"]["steps"][0]["remove"].append("body")),
    ("remove_twice", lambda d: d["pliego:sequence"]["steps"].append(
        {**copy.deepcopy(d["pliego:sequence"]["steps"][0]), "id": "again"})),
    ("piece_region", lambda d: d["pliego:pieces"][0]["faces"].append(
        d["pliego:pieces"][1]["faces"][0]) or d["pliego:pieces"].pop()),
    ("piece_overlap", lambda d: d["pliego:pieces"].append(
        {**d["pliego:pieces"][1], "id": "stub-copy"})),
    ("piece_role", lambda d: d["pliego:pieces"][0].update(role="waste")),
    ("sheet_reference", lambda d: d["pliego:pieces"][0].update(sheet="nowhere")),
    ("piece_faces", lambda d: d["pliego:pieces"][0].update(faces=[999])),
    ("piece_pull", lambda d: d["pliego:pieces"][1].update(pull=[0, 0, 0])),
]


@pytest.mark.parametrize("kind,mutate", MUTATIONS, ids=[m[0] for m in MUTATIONS])
def test_rule11_rejects(kind, mutate, stocks):
    _, asm = ticket()
    doc = asm.build(stocks=stocks)
    d = copy.deepcopy(doc.data)
    mutate(d)
    d["pliego:meta"]["digest"] = None
    kinds = {i["kind"] for i in errors(pliego.Document(d))}
    assert kind in kinds, kinds


def test_remove_without_pieces_is_an_error(stocks):
    _, asm = ticket()
    d = copy.deepcopy(asm.build(stocks=stocks).data)
    del d["pliego:pieces"]
    d["pliego:meta"]["digest"] = None
    assert "piece_reference" in {i["kind"] for i in errors(pliego.Document(d))}


def pad(n: int = 3, pitch: float = 0.3, **kw) -> pliego.Assembly:
    sheets = [pliego.Sheet(f"s{k}", pliego.square(50), stock="card",
                           placement=pliego.Placement(origin=(0, pitch * (k + 0.5), 0)))
              for k in range(n)]
    return pliego.Assembly(sheets, stacks=[pliego.stack("pad", sheets, pitch, **kw)])


def test_stack_round_trip(stocks):
    doc = pad(binding=((0, 50), (50, 50))).build(stocks=stocks)
    assert errors(doc) == []
    st = doc.data["pliego:stacks"][0]
    assert st == {"id": "pad", "sheets": ["s0", "s1", "s2"], "pitch_mm": 0.3, "represents": 1,
                  "bond": "keep", "binding": {"kind": "padding", "edge": [[0, 50], [50, 50]]}}
    assert schema_errors(doc.data, SCHEMA, SCHEMA) == []


def test_stack_represents_scales_the_pitch(stocks):
    assert errors(pad(pitch=1.2, represents=4).build(stocks=stocks)) == []
    bad = errors(pad(pitch=1.2, represents=3).build(stocks=stocks))
    assert "stack_pitch" in {i["kind"] for i in bad}


@pytest.mark.parametrize("kind,mutate", [
    ("stack_placement", lambda d: d["pliego:sheets"][2]["placement"]["origin"].__setitem__(1, 5)),
    ("stack_placement", lambda d: d["pliego:sheets"][1]["placement"].update(
        rotation=[0, 0.7071068, 0, 0.7071068])),
    ("stack_member", lambda d: d["pliego:stacks"].append({**d["pliego:stacks"][0], "id": "b"})),
    ("sheet_reference", lambda d: d["pliego:stacks"][0]["sheets"].append("ghost")),
    ("stack_binding", lambda d: d["pliego:stacks"][0].update(
        binding={"kind": "padding", "edge": [[0, 0], [80, 0]]})),
    ("stack_bond", lambda d: d["pliego:stacks"][0].update(bond="glue")),
])
def test_rule12_rejects(kind, mutate, stocks):
    d = copy.deepcopy(pad().build(stocks=stocks).data)
    mutate(d)
    d["pliego:meta"]["digest"] = None
    assert kind in {i["kind"] for i in errors(pliego.Document(d))}


def test_interior_point_of_a_concave_ring():
    ring = [pliego.Vec2(*p) for p in [(0, 0), (10, 0), (10, 10), (8, 10), (8, 2), (2, 2),
                                      (2, 10), (0, 10)]]
    p = interior_point(ring)
    from pliego.geometry import point_in_polygon
    assert point_in_polygon(p, ring) == 1


def test_kinematic_programs_keep_removals(stocks):
    card = pliego.Sheet("card", pliego.rectangle(100, 40), stock="card")
    fold = card.valley((50, 0), (50, 40), angle=90)
    card.perforate((80, 0), (80, 40), kind="cut")
    seq = pliego.Sequence.kinematic_path(card, [pliego.Step("fold", L4, [(fold, 90)],
                                                            remove=["tab"])], substeps=2)
    assert [s.remove for s in seq.steps] == [[], ["tab"]]
    asm = pliego.Assembly([card], pieces=[pliego.piece("tab", card, at=(90, 5))], sequence=seq)
    assert errors(asm.build(stocks=stocks)) == []
