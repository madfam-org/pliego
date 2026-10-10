"""Board constructions (pliego.board): corrugated sandwich and laminate → card physics."""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path

import pytest

from pliego import board, stock

MATERIALS = Path(__file__).resolve().parents[3] / "materials"
CORRUGATED = ("corrugated-e-flute", "corrugated-b-flute", "corrugated-c-flute",
              "corrugated-f-flute", "corrugated-bc-double-wall", "corrugated-aac-triple-wall",
              "corrugated-single-face-b")


def _card(slug: str) -> dict:
    return json.loads((MATERIALS / slug / "stock.json").read_text(encoding="utf-8"))


def _layer(role, gsm=100.0, um=150.0, emd=6.0, ecd=3.0, flute=None):
    d = {"role": role, "gsm": gsm, "caliper_um": um, "E_md_gpa": emd, "E_cd_gpa": ecd,
         "status": "estimated", "basis": "test"}
    if flute:
        d["flute"] = flute
    return d


def _construction(*layers, kind="corrugated", adhesive=0.0):
    return {"kind": kind, "model": board.MODEL, "layers": list(layers),
            "adhesive_gsm_per_glueline": adhesive}


def test_take_up_limits_and_quadrature():
    assert board.take_up(5.0, 0.0) == pytest.approx(1.0, abs=1e-15)
    # small amplitude: α ≈ 1 + (ak)²/4
    ak = 0.05
    assert board.take_up(2 * math.pi, ak) == pytest.approx(1 + ak * ak / 4, rel=1e-6)
    # a large amplitude against an independent fine quadrature
    ak = 1.3
    n = 20000
    ref = sum(math.sqrt(1 + (ak * math.cos(2 * math.pi * (i + 0.5) / n)) ** 2)
              for i in range(n)) / n
    assert board.take_up(2 * math.pi, ak) == pytest.approx(ref, rel=1e-10)


def test_flute_table_pitches_and_take_up_ranges():
    pitches = {k: f.pitch for k, f in board.FLUTES.items()}
    assert pitches["A"] > pitches["C"] > pitches["B"] > pitches["E"] > pitches["F"]
    # computed take-up with a 0.17 mm medium sits inside (or just under) handbook ranges
    expect = {"A": (1.40, 1.60), "B": (1.28, 1.40), "C": (1.34, 1.50), "E": (1.18, 1.30)}
    for name, (lo, hi) in expect.items():
        f = board.FLUTES[name]
        assert lo <= board.take_up(f.pitch, (f.height - 0.17) / 2) <= hi, name


def test_symmetric_single_wall_by_hand():
    liner = _layer("liner", 125, 180, 6.5, 2.8)
    medium = _layer("medium", 112, 170, 5.0, 2.2, "C")
    m = board.evaluate(_construction(liner, medium, copy.deepcopy(liner), adhesive=5.0), 0.293)
    f = board.FLUTES["C"]
    amp = (f.height - 0.17) / 2
    alpha = board.take_up(f.pitch, amp)
    t = 0.36 + f.height
    assert m.caliper_mm == pytest.approx(t)
    assert m.gsm == pytest.approx(250 + alpha * 112 + 2 * 5.0)
    zl = (t - 0.18) / 2                      # liner centroids ± zl about the mid-plane
    plate = 1 / (1 - 0.293 ** 2)
    d_md = 2 * 6.5 * (0.18 ** 3 / 12 + 0.18 * zl * zl) * plate * 1000
    d_cd = (2 * 2.8 * (0.18 ** 3 / 12 + 0.18 * zl * zl)
            + alpha * 2.2 * 0.17 * (amp * amp / 2 + 0.17 ** 2 / 12)) * plate * 1000
    assert m.D_md_mNm == pytest.approx(d_md, rel=1e-12)
    assert m.D_cd_mNm == pytest.approx(d_cd, rel=1e-12)
    assert m.E_md_gpa == pytest.approx(2 * 6.5 * 0.18 / t)
    assert m.E_cd_gpa == pytest.approx((2 * 2.8 * 0.18 + alpha * 2.2 * 0.17) / t)


def test_single_face_rolls_one_way():
    m = board.evaluate(_construction(_layer("liner"), _layer("medium", flute="B")))
    assert m.D_cd_mNm > 100 * m.D_md_mNm      # flutes act as hinges across MD


def test_laminate_beats_homogeneous_sheet_of_same_mass():
    plies = [_layer("ply", 45, 50, 6, 3), _layer("ply", 225, 380, 2, 0.9),
             _layer("ply", 30, 40, 6, 3)]
    m = board.evaluate(_construction(*plies, kind="laminate"), 0.293)
    t = 0.47
    homogeneous = m.E_md_gpa * t ** 3 / (12 * (1 - 0.293 ** 2)) * 1000
    assert m.D_md_mNm > homogeneous


def test_unsymmetric_neutral_axis_shifts():
    thick = _layer("liner", 200, 300, 6.5, 2.8)
    thin = _layer("liner", 100, 150, 6.5, 2.8)
    m1 = board.evaluate(_construction(thick, _layer("medium", flute="B"), thin))
    m2 = board.evaluate(_construction(thin, _layer("medium", flute="B"), thick))
    assert m1.D_md_mNm == pytest.approx(m2.D_md_mNm, rel=1e-12)   # mirror image, same D


@pytest.mark.parametrize("bad, needle", [
    ({"kind": "foam"}, "kind"),
    ({"model": "other"}, "model"),
    ({"layers": []}, "layers"),
    ({"layers": [_layer("medium", flute="B")]}, "start with a liner"),
    ({"layers": [_layer("liner"), _layer("liner")]}, "alternate"),
    ({"layers": [_layer("liner"), _layer("medium", flute="Z")]}, "flute"),
    ({"layers": [_layer("liner"), _layer("medium", um=900, flute="F")]}, "below"),
    ({"layers": [_layer("liner", gsm=-1)]}, "positive"),
])
def test_validate_rejects(bad, needle):
    c = {**_construction(_layer("liner"), _layer("medium", flute="B"), _layer("liner")), **bad}
    problems = board.validate(c)
    assert problems and needle in problems[0]


@pytest.mark.parametrize("slug", CORRUGATED + ("folding-boxboard-300",))
def test_board_cards_derive_from_their_construction(slug):
    card = _card(slug)
    model = board.evaluate(card["construction"], card["physical"]["nu"]["value"])
    d = stock.derive(card)
    assert d["thickness"] == pytest.approx(model.caliper_mm, rel=1e-5)
    assert d["D_md"] == pytest.approx(model.D_md_mNm * stock.MNM, rel=1e-5)
    assert d["D_cd"] == pytest.approx(model.D_cd_mNm * stock.MNM, rel=1e-5)
    assert d["E_md"] == pytest.approx(model.E_md_gpa * stock.GPA, rel=1e-5)
    assert 50 <= card["physical"]["crease_length_scale_t"]["value"] <= 100   # scored board


def test_corrugated_md_stiffer_than_cd_and_walls_add_stiffness():
    d = {s: stock.derive(_card(s)) for s in CORRUGATED}
    for s in CORRUGATED[:-1]:
        assert d[s]["D_md"] > d[s]["D_cd"], s
    order = ("corrugated-f-flute", "corrugated-e-flute", "corrugated-b-flute",
             "corrugated-c-flute", "corrugated-bc-double-wall", "corrugated-aac-triple-wall")
    stiff = [d[s]["D_md"] for s in order]
    assert stiff == sorted(stiff)


def test_construction_mismatch_is_an_error_and_write_syncs(tmp_path, capsys):
    card = _card("corrugated-b-flute")
    card["physical"]["gsm"]["value"] = 999
    kinds = {i["kind"] for i in stock.validate(card, "corrugated-b-flute")}
    assert "construction_mismatch" in kinds
    (tmp_path / "corrugated-b-flute").mkdir()
    path = tmp_path / "corrugated-b-flute" / "stock.json"
    path.write_text(stock.dump_card(card), encoding="utf-8")
    cards, drift, problems = stock.check(tmp_path, write=True)
    assert (cards, problems) == (1, [])
    assert json.loads(path.read_text())["physical"]["gsm"]["value"] == pytest.approx(
        board.physical_values(board.evaluate(card["construction"]))["gsm"])


def test_foam_cards_are_isotropic_and_soft():
    for slug in ("eva-foam-2mm", "eva-foam-5mm", "eva-foam-hd-6mm"):
        d = stock.derive(_card(slug))
        assert d["D_md"] == d["D_cd"] and d["E_md"] < 1e7      # < 0.01 GPa
        assert d["score_factor"] == pytest.approx(0.125)       # half-depth score: (1/2)³
    thin, thick = (stock.derive(_card(s)) for s in ("eva-foam-2mm", "eva-foam-5mm"))
    assert thick["D_md"] / thin["D_md"] == pytest.approx(2.5 ** 3, rel=1e-4)   # D ∝ t³
