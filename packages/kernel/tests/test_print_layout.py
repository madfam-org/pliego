"""Spec §5.8 print layout: sheet annotations and print pages (authoring, verify, exporters)."""

from __future__ import annotations

import pytest

import pliego
from pliego.export import to_dxf, to_pdf, to_svg


def _doc(stocks, pages=None, layout="row", note=(10.0, 10.0)):
    sheet = pliego.Sheet("card", pliego.square(40), stock="kami")
    sheet.valley((0, 20), (40, 20))
    sheet.text(note, "A7", angle=30, size=3)
    asm = pliego.Assembly([sheet], layout=layout, pages=pages)
    return asm.build(stocks=stocks)


PAGES = {"size": [100, 100], "margin": 10, "pages": [{"id": "page-1", "origin": [0, 0]}]}


def test_annotations_and_pages_round_trip_and_verify(stocks):
    doc = _doc(stocks, PAGES, {"card": (20, 20)})
    assert doc.verify() == []
    (note,) = doc.data["pliego:annotations"]
    assert note == {"sheet": "card", "at": [10.0, 10.0], "text": "A7", "angle": 30.0, "size": 3.0}
    assert doc.data["pliego:pages"] == {"size": [100.0, 100.0], "margin": 10.0,
                                        "pages": [{"id": "page-1", "origin": [0.0, 0.0]}]}


def test_documents_without_print_fields_are_unchanged(stocks):
    sheet = pliego.Sheet("card", pliego.square(40), stock="kami")
    sheet.valley((0, 20), (40, 20))
    data = pliego.Assembly([sheet]).build(stocks=stocks).data
    assert "pliego:annotations" not in data and "pliego:pages" not in data


def test_sheet_text_fails_loud():
    sheet = pliego.Sheet("card", pliego.square(40))
    with pytest.raises(ValueError, match="off the sheet"):
        sheet.text((50, 5), "1")
    with pytest.raises(ValueError, match="1–32"):
        sheet.text((5, 5), "x" * 33)
    with pytest.raises(ValueError, match="size"):
        sheet.text((5, 5), "1", size=0.1)
    with pytest.raises(ValueError):
        pliego.Assembly([sheet], pages={"size": [100, 100], "pages": []})


def test_verify_rejects_bad_annotations_and_pages(stocks):
    doc = _doc(stocks, PAGES, {"card": (20, 20)})
    d = doc.data
    d["pliego:annotations"].append({"sheet": "nope", "at": [1, 1], "text": "1", "size": 3})
    d["pliego:annotations"].append({"sheet": "card", "at": [99, 1], "text": "1", "size": 3})
    d["pliego:pages"]["pages"].append({"id": "page-2", "origin": [50, 0]})
    kinds = {i["kind"] for i in doc.verify() if i["level"] == "error"}
    assert {"sheet_reference", "point_outside", "pages_overlap"} <= kinds


def test_sheet_off_its_page_is_a_warning(stocks):
    doc = _doc(stocks, PAGES, {"card": (80, 80)})
    issues = doc.verify()
    assert [i["kind"] for i in issues] == ["sheet_off_page"]
    assert issues[0]["level"] == "warning"


def test_exporters_draw_annotations_and_pages(stocks):
    doc = _doc(stocks, PAGES, {"card": (20, 20)})
    svg = to_svg(doc)
    assert 'transform="rotate(-30 ' in svg and ">A7</text>" in svg and '<g id="pages"' in svg
    pdf = to_pdf(doc)
    assert b"/Count 1" in pdf and b"/MediaBox [0 0 283.46 283.46]" in pdf
    assert b"Tm (A7) Tj" in pdf
    dxf = to_dxf(doc)
    assert "\n50\n30.0000\n" in dxf and "\n1\nA7\n" in dxf
    tiled = to_pdf(_doc(stocks))   # no pages: the tiled overview path, as before
    assert b"overview" in tiled
