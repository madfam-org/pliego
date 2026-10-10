"""The dieline export profile (SVG, DXF, PDF): named layers, spot colours, plates, bleed."""

from __future__ import annotations

import re

import pytest

import pliego
from pliego import dieline, dieline_boxes, dieline_cartons, press
from pliego.export import to_dxf, to_pdf, to_svg
from pliego.export.dieline import resolve_profile

SQUARE = [[(20.0, 100.0), (60.0, 100.0), (60.0, 140.0), (20.0, 140.0)]]


@pytest.fixture(scope="module")
def doc():
    pack = dieline_cartons.carton(120, 60, 180, style="reverse-tuck")
    pack.sheet.perforate((10.0, 150.0), (100.0, 150.0), name="tear-line")
    fin = [press.emboss("logo", pack.sheet, SQUARE), press.foil("foil", pack.sheet, SQUARE),
           press.burn("mark", pack.sheet, [[(70, 100), (100, 100), (85, 130)]])]
    art = [press.artwork("brand", pack.sheet, "assets/brand.svg", (10, 90), (60, 60))]
    return dieline.assemble([pack], title="Carton", finishes=fin, artwork=art).build()


def test_profile_resolution(doc):
    assert resolve_profile(doc, None) == "dieline"
    plain = pliego.Assembly([pliego.Sheet("s", pliego.square(50))]).build()
    assert resolve_profile(plain, None) == "default"
    with pytest.raises(ValueError):
        resolve_profile(doc, "fancy")


def test_svg_layers_and_spots(doc):
    svg = to_svg(doc)
    labels = re.findall(r'inkscape:label="([^"]+)"', svg)
    for name in ("Cut", "Crease", "Perforation", "Glue", "Bleed", "Safe area", "Dimensions",
                 "Panel labels", "Grain/flute arrow", "Artwork", "Emboss die (female)",
                 "Emboss counter (male)", "Foil plate", "Engrave (vector)", "Engrave (raster)"):
        assert name in labels, name
    assert 'data-spot="CutContour"' in svg and 'href="assets/brand.svg"' in svg
    assert "L 120 (inside)" in svg and "GRAIN (MD)" in svg
    assert to_svg(doc) == svg                                     # byte-deterministic
    assert 'data-palette="diagram"' in to_svg(doc, profile="default")


def test_dxf_named_layers(doc):
    dxf = to_dxf(doc)
    layers = set(re.findall(r"\n0\nLAYER\n2\n([^\n]+)\n", dxf))
    assert {"CutContour", "Crease", "Perforation", "Glue", "Bleed", "Safe-area", "Foil-plate",
            "Emboss-die-female", "Engrave-raster", "Panel-labels"} <= layers
    assert all(re.fullmatch(r"[A-Za-z0-9_-]{1,31}", n) for n in layers)


def test_pdf_separations_and_layers(doc):
    pdf = to_pdf(doc)
    assert pdf.startswith(b"%PDF-1.5") and pdf.rstrip().endswith(b"%%EOF")
    assert b"/Separation /CutContour /DeviceCMYK" in pdf
    assert b"/Separation /Safe#20area" in pdf
    assert pdf.count(b"/Type /OCG") >= 10 and b"/OCProperties" in pdf
    assert pdf.count(b"/Type /Page ") == 1                       # one 1:1 page
    m = re.search(rb"/MediaBox \[0 0 ([0-9.]+) ([0-9.]+)\]", pdf)
    assert m and float(m.group(1)) > 120 * 72 / 25.4
    # xref offsets point at their objects
    xref = int(pdf.rsplit(b"startxref\n", 1)[1].split(b"\n")[0])
    offsets = [int(x[:10]) for x in pdf[xref:].split(b"\n")[3:] if x[:10].isdigit()]
    for k, off in enumerate(offsets[:5], start=1):
        assert pdf[off:].startswith(f"{k} 0 obj".encode())
    assert to_pdf(doc) == pdf


def test_bleed_only_on_cut_edges():
    pack = dieline_boxes.slotted(300, 200, 150, "corrugated-b-flute")
    from pliego.export.dieline import build
    plan = build(dieline.assemble([pack]).build())
    bleed = plan.layers["Bleed"].polylines
    assert bleed and all(len(p) == 2 for p, _ in bleed)
    # no bleed segment lies on a body fold (x = L + t between front and end-1)
    t = pack.block["caliper_mm"]
    x_fold = 300 + t
    for (a, b), _ in bleed:
        assert not (abs(a[0] - x_fold) < 1e-6 and abs(b[0] - x_fold) < 1e-6)


def test_blocks_conform_to_the_sheet_document_schema(doc):
    import json
    from pathlib import Path

    from test_stock import schema_errors

    schema = json.loads((Path(__file__).resolve().parents[3] / "packages" / "schemas"
                         / "sheet-document.schema.json").read_text(encoding="utf-8"))
    for key, ref in (("pliego:dielines", "dielineBlock"), ("pliego:finishes", "finish"),
                     ("pliego:artwork", "artwork")):
        assert doc.data[key]
        for block in doc.data[key]:
            assert schema_errors(block, schema["$defs"][ref], schema) == [], key
    assert set(schema["properties"]) >= {"pliego:dielines", "pliego:finishes", "pliego:artwork"}
