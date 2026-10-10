"""Spec §5.17 / rule 18: printed art is a relative path or a sanitised image data URI
(hardening item 10)."""

from __future__ import annotations

import base64
import urllib.parse

import pytest

import pliego
from pliego.document_verify_view import MAX_ART_BYTES, check_art

L4 = {"en": "Card", "es": "Tarjeta", "fr": "Carte", "pt": "Cartão"}
SVG = ("<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' "
       "viewBox='0 0 10 10'><defs><linearGradient id='g'/></defs>"
       "<rect width='10' height='10' fill='url(#g)'/><use href='#g'/></svg>")
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\0" * 32).decode()


def svg_uri(svg: str, b64: bool = False) -> str:
    if b64:
        return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()
    return "data:image/svg+xml;charset=utf-8," + urllib.parse.quote(svg)


@pytest.mark.parametrize("src", [None, "art/front.svg", "front.png", svg_uri(SVG),
                                 svg_uri(SVG, b64=True), "data:image/png;base64," + PNG])
def test_accepts_paths_and_clean_image_data(src):
    assert check_art(src) is None


@pytest.mark.parametrize(("src", "why"), [
    ("https://example.org/a.svg", "relative path"),
    ("/etc/a.svg", "relative path"),
    ("../other/a.svg", "relative path"),
    ("javascript:alert(1)", "relative path"),
    ("data:text/html,<b>x</b>", "data:image/svg+xml or data:image/png"),
    ("data:image/png,raw", "base64"),
    ("data:image/png;base64,AAAA", "not a PNG"),
    ("data:image/png;base64,***", "does not decode"),
    (svg_uri("<svg><script>alert(1)</script></svg>"), "<script>"),
    (svg_uri("<svg onload='alert(1)'/>"), "event-handler"),
    (svg_uri("<svg><foreignObject/></svg>"), "foreignObject"),
    (svg_uri("<svg><a href='javascript:x()'/></svg>"), "javascript"),
    (svg_uri("<svg><image href='https://example.org/x.png'/></svg>"), "outside itself"),
    (svg_uri("<svg><use xlink:href='other.svg#a'/></svg>"), "outside itself"),
    (svg_uri("<svg><rect style='fill:url(https://example.org/p)'/></svg>"), "outside itself"),
    (svg_uri("<!DOCTYPE svg [<!ENTITY x 'y'>]><svg/>"), "DOCTYPE"),
    (svg_uri("<html/>"), "no <svg>"),
    ("data:image/svg+xml;base64," + base64.b64encode(b"<svg>" + b" " * MAX_ART_BYTES).decode(),
     "limit"),
])
def test_refuses_unsafe_or_external_art(src, why):
    assert why in (check_art(src) or "")


def test_authoring_and_verify_enforce_it(stocks):
    s = pliego.Sheet("card", pliego.rectangle(60, 40), label=L4,
                     front={"color": "#ffffff", "art": svg_uri(SVG)})
    with pytest.raises(ValueError, match="script"):
        s.art(back=svg_uri("<svg><script/></svg>"))
    with pytest.raises(ValueError, match="relative path"):
        pliego.Sheet("bad", pliego.rectangle(10, 10), front={"color": "#ffffff",
                                                              "art": "http://x/y.png"})
    doc = pliego.Assembly([s]).build(stocks=stocks)
    assert doc.verify() == []
    doc.data["pliego:sheets"][0]["back"]["art"] = svg_uri("<svg onclick='x()'/>")
    doc.data["pliego:meta"]["digest"] = None
    assert [(i["rule"], i["kind"]) for i in doc.verify() if i["level"] == "error"] == \
        [(18, "art_source")]
