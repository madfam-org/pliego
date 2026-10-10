"""Finish regions, brand artwork and spec §8 rule 13 (packaging blocks)."""

from __future__ import annotations

import pytest

import pliego
from pliego import dieline, dieline_cartons, press

SQUARE = [[(20.0, 100.0), (60.0, 100.0), (60.0, 140.0), (20.0, 140.0)]]


def carton():
    return dieline_cartons.carton(120, 60, 180, style="reverse-tuck")


@pytest.mark.parametrize("make, kind", [
    (lambda s: press.emboss("e", s, SQUARE, 0.5, registered=True), "emboss"),
    (lambda s: press.deboss("d", s, SQUARE), "deboss"),
    (lambda s: press.foil("f", s, SQUARE, "#d4af37", finish="holographic"), "foil"),
    (lambda s: press.varnish("v", s, SQUARE, "soft-touch"), "varnish"),
    (lambda s: press.letterpress("l", s, SQUARE, 0.2), "letterpress"),
    (lambda s: press.burn("b", s, SQUARE, 0.3, process="iron", char=0.9), "burn"),
])
def test_builders_make_valid_records(make, kind):
    f = make("card")
    assert f["kind"] == kind and press.check_finish(f) == []


@pytest.mark.parametrize("bad", [
    lambda: press.emboss("e", "card", SQUARE, 0.0),
    lambda: press.emboss("e", "card", SQUARE, 0.4, profile="spiky"),
    lambda: press.foil("f", "card", SQUARE, "gold"),
    lambda: press.varnish("v", "card", SQUARE, "shiny"),
    lambda: press.burn("b", "card", SQUARE, process="torch"),
    lambda: press.burn("b", "card", SQUARE, char=2.0),
    lambda: press.emboss("e", "card", [[(0, 0), (1, 1)]]),
    lambda: press.artwork("a", "card", "../escape.png", (0, 0), (10, 10)),
    lambda: press.artwork("a", "card", "https://x.test/a.png", (0, 0), (10, 10)),
    lambda: press.artwork("a", "card", "logo.svg", (0, 0), (0, 10)),
])
def test_builders_fail_loud(bad):
    with pytest.raises(ValueError):
        bad()


def test_plates_per_kind():
    t = 0.47
    e = press.plates(press.emboss("e", "c", SQUARE), t)
    assert [n for n, _, _ in e] == ["Emboss die (female)", "Emboss counter (male)"]
    die, counter = e[0][1][0], e[1][1][0]
    assert counter[0][0] == pytest.approx(die[0][0] + t)       # male counter inset by caliper
    d = press.plates(press.deboss("d", "c", SQUARE), t)
    assert d[1][1][0][0][0] == pytest.approx(SQUARE[0][0][0] - t)
    assert [n for n, _, _ in press.plates(press.burn("b", "c", SQUARE), t)] == [
        "Engrave (vector)", "Engrave (raster)"]
    assert [n for n, _, _ in press.plates(press.burn("b", "c", SQUARE, process="iron"), t)] == [
        "Branding iron face"]
    lines = press.hatch(SQUARE, 1.0)
    assert len(lines) == 39 and all(a[0] == 20.0 and b[0] == 60.0 for a, b in lines)


def test_rule13_accepts_good_blocks_and_rejects_bad_ones():
    pack = carton()
    good = dieline.assemble([pack], finishes=[press.foil("f", pack.sheet, SQUARE)],
                            artwork=[press.artwork("a", pack.sheet, "assets/brand.svg",
                                                   (10, 90), (60, 60), panel="front")]).build()
    assert not [i for i in good.verify() if i["level"] == "error"]
    data = good.data
    data["pliego:finishes"][0]["region"] = [[[5000.0, 0.0], [5001.0, 0.0], [5001.0, 1.0]]]
    data["pliego:artwork"][0]["sheet"] = "nope"
    data["pliego:dielines"][0]["family"] = "bag"
    kinds = [i["kind"] for i in pliego.Document(data).verify() if i["level"] == "error"]
    assert {"finish", "artwork", "dieline_family"} <= set(kinds)
    assert all(i["rule"] == 13 for i in pliego.Document(data).verify()
               if i["kind"] in ("finish", "artwork", "dieline_family"))
