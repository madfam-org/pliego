"""Conductive trace finishes (spec §5.30), their plates and the continuity check (rule 30)."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

import pliego
from pliego import press
from pliego.geometry import Vec2, polygon_area

W = 6.0


def card_circuit(*, flip_led: bool = False, gap: float = 0.0):
    """A coin cell and an LED on a 160 × 100 card, the loop broken by a fold switch whose two
    contacts sit mirror images across the fold line x = 80 (front side)."""
    a, k = ("cathode", "anode") if flip_led else ("anode", "cathode")
    plus = press.trace("plus", "card", [(20, 20), (20, 80), (60, 80)], W, pads=[
        press.pad("cell-plus", (20, 20), 10, part="cell", pin="plus"),
        press.pad("led-a", (60, 80), 6, part="led", pin=a)])
    minus = press.trace("minus", "card", [(30, 20), (70, 20)], W, material="conductive-ink",
                        pads=[press.pad("cell-minus", (30, 20), 6, part="cell", pin="minus"),
                              press.pad("sw-1", (70, 20), 8, part="switch", pin="contact")])
    back = press.trace("return", "card", [(90 + gap, 20), (130, 20), (130, 80), (75, 80)], W,
                       pads=[press.pad("sw-2", (90 + gap, 20), 8, part="switch", pin="contact"),
                             press.pad("led-k", (75, 80), 6, part="led", pin=k)])
    return [plus, minus, back]


def test_trace_record_is_valid_and_outlined():
    t = press.trace("t", "card", [(0, 0), (40, 0), (40, 30)], 4.0, pads=[
        press.pad("end", (40, 30), 5, part="led", pin="anode")])
    assert t["kind"] == "trace" and press.check_finish(t) == []
    assert t["depth_mm"] == 0.0 and t["material"] == "copper-tape" and t["width_mm"] == 4.0
    ring = [Vec2(x, y) for x, y in t["region"][0]]
    # the stroke: length × width (a mitred corner gains outside what it loses inside) plus a
    # half-width of tape past each end
    assert abs(polygon_area(ring)) == pytest.approx(70.0 * 4.0 + 2 * 2.0 * 4.0, abs=1e-6)
    xs = [p[0] for p in t["region"][0]]
    assert min(xs) == pytest.approx(-2.0) and max(xs) == pytest.approx(42.0)
    moved = dict(t, region=[[[0.0, 0.0], [9.0, 0.0], [9.0, 9.0]]])
    assert press.check_finish(moved) == ["trace region is not its path stroked by its width"]


@pytest.mark.parametrize("bad", [
    lambda: press.trace("t", "card", [(0, 0)], 4.0),
    lambda: press.trace("t", "card", [(0, 0), (0, 0)], 4.0),
    lambda: press.trace("t", "card", [(0, 0), (10, 0)], 0.0),
    lambda: press.trace("t", "card", [(0, 0), (10, 0)], 4.0, material="silver-paint"),
    lambda: press.trace("t", "card", [(0, 0), (10, 0), (0, 1)], 4.0),        # hairpin
    lambda: press.trace("t", "card", [(0, 0), (10, 0), (10, 10), (5, -5)], 1.0),  # crosses
    lambda: press.trace("t", "card", [(0, 0), (10, 0)], 2.0,
                        pads=[press.pad("p", (5, 30), 4)]),                    # pad off the trace
    lambda: press.trace("t", "card", [(0, 0), (10, 0)], 2.0,
                        pads=[press.pad("p", (0, 0), 4), press.pad("p", (10, 0), 4)]),
    lambda: press.pad("p", (0, 0), 4, part="led", pin="gate"),
])
def test_trace_builders_fail_loud(bad):
    with pytest.raises(ValueError):
        f = bad()
        if press.check_finish(f):
            raise ValueError(press.check_finish(f))


def test_trace_plates_on_their_own_layers():
    tape, ink = card_circuit()[0], card_circuit()[1]
    names = [(n, m) for n, _, m in press.plates(tape, 0.3)]
    assert names == [("Copper tape (outline)", "outline"), ("Copper tape (centre line)", "path"),
                     ("Contact pads", "outline")]
    assert press.plates(tape, 0.3)[1][1] == [tape["path"]]
    assert [n for n, _, _ in press.plates(ink, 0.3)][:2] == [
        "Conductive ink (outline)", "Conductive ink (centre line)"]
    pads = press.plates(tape, 0.3)[2][1]
    assert pads[0] == [[15.0, 15.0], [25.0, 15.0], [25.0, 25.0], [15.0, 25.0]]


def test_open_switch_leaves_the_loop_open_and_closing_it_lights_the_led():
    traces = card_circuit()
    opened = press.circuit(traces)
    assert opened["closed"] is False and opened["lit"] == [] and opened["nets"] == 3
    assert not [i for i in opened["issues"] if i["level"] == "error"]
    shut = press.circuit(traces, closed=["switch"])
    assert shut["closed"] is True and shut["lit"] == ["led"] and shut["loop"] == ["led"]
    assert shut["nets"] == 2 and shut["issues"] == []


def test_reversed_led_short_and_series_are_reported():
    rev = press.circuit(card_circuit(flip_led=True), closed=["switch"])
    assert rev["closed"] is False and [i["kind"] for i in rev["issues"]] == ["reversed"]
    short = card_circuit() + [press.trace("bridge", "card", [(20, 25), (32, 25)], W)]
    assert [i["kind"] for i in press.circuit(short)["issues"]] == ["short"]
    # two LEDs in series: split the return trace with a second LED
    t = card_circuit()
    t[2] = press.trace("return", "card", [(90, 20), (130, 20), (130, 50)], W, pads=[
        press.pad("sw-2", (90, 20), 8, part="switch", pin="contact"),
        press.pad("led2-k", (130, 50), 6, part="led-2", pin="cathode")])
    t.append(press.trace("last", "card", [(130, 62), (130, 80), (75, 80)], W, pads=[
        press.pad("led2-a", (130, 62), 6, part="led-2", pin="anode"),
        press.pad("led-k", (75, 80), 6, part="led", pin="cathode")]))
    s = press.circuit(t, closed=["switch"])
    assert s["closed"] and s["lit"] == ["led", "led-2"] and s["loop"] == ["led", "led-2"]
    assert [i["kind"] for i in s["issues"]] == ["series_leds"]
    t[2]["pads"][1]["pin"], t[3]["pads"][0]["pin"] = "anode", "cathode"   # led-2 backwards
    s = press.circuit(t, closed=["switch"])
    assert s["closed"] is False and [i["kind"] for i in s["issues"]] == ["reversed"]


def test_parts_need_their_pins_and_one_cell():
    t = card_circuit()
    t[1]["pads"] = t[1]["pads"][1:]                   # drop the cell's minus pad
    kinds = {i["kind"] for i in press.circuit(t, closed=["switch"])["issues"]}
    assert {"part", "cell"} <= kinds
    assert [i["kind"] for i in press.circuit(card_circuit(), closed=["nope"])["issues"]] == [
        "switch"]


def test_fold_switch_closes_only_when_the_contacts_meet():
    t = card_circuit()
    line = ((80.0, 0.0), (80.0, 100.0))
    assert press.fold_switch_closes(t, "switch", line) == []
    assert press.fold_switch_closes(t, "switch", line, "mountain")       # front faces part
    assert press.fold_switch_closes(card_circuit(gap=12.0), "switch", line)
    assert press.fold_switch_closes(t, "switch", ((0.0, 50.0), (160.0, 50.0)))


def test_traces_export_on_their_layers_and_pass_rule_13():
    card = pliego.Sheet("card", [(0, 0), (160, 0), (160, 100), (0, 100)], stock="cardstock-250")
    card.valley((80, 0), (80, 100), angle=0)
    doc = pliego.Assembly([card], finishes=card_circuit(), title="Circuit card").build()
    assert not [i for i in doc.verify() if i["level"] == "error"]
    svg = pliego.export.to_svg(doc)
    for layer in ("copper-tape-outline", "copper-tape-centre-line", "conductive-ink-outline",
                  "contact-pads"):
        assert f'id="{layer}"' in svg
    assert "<polyline" in svg                          # the centre lines stay open
    dxf = pliego.export.to_dxf(doc)
    assert "Copper-tape-path" in dxf and "Contact-pads" in dxf
    assert pliego.export.to_pdf(doc).startswith(b"%PDF")
    data = json.loads(doc.to_json())
    off = json.loads(json.dumps(data))
    off["pliego:finishes"][0]["path"][0] = [5000.0, 0.0]
    off["pliego:finishes"][0]["region"] = [[[5000.0, 0.0], [5001.0, 0.0], [5001.0, 1.0]]]
    kinds = [i["kind"] for i in pliego.Document(off).verify() if i["level"] == "error"]
    assert "finish" in kinds
    # the document's own finishes give the same continuity answer
    assert press.circuit(data["pliego:finishes"], closed=["switch"])["closed"]


def test_trace_records_conform_to_the_sheet_document_schema():
    from test_stock import schema_errors

    schema = json.loads((Path(__file__).resolve().parents[3] / "packages" / "schemas"
                         / "sheet-document.schema.json").read_text(encoding="utf-8"))
    for f in card_circuit():
        assert schema_errors(json.loads(json.dumps(f)), schema["$defs"]["finish"], schema) == []
    bad = json.loads(json.dumps(card_circuit()[0]))
    bad["pads"][0]["pin"] = "gate"
    assert schema_errors(bad, schema["$defs"]["finish"], schema)


def test_stroke_is_byte_stable():
    a = press.trace("t", "card", [(0, 0), (33.3, 1e-9), (50, 20)], 3.0)
    b = press.trace("t", "card", [(0, 0), (33.3, 0.0), (50, 20)], 3.0)
    assert json.dumps(a) == json.dumps(b)
    assert all(math.isfinite(c) for p in a["region"][0] for c in p)
