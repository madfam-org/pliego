"""Tiled PDF exporter: golden bytes, structure (xref), tiling cover, line styles."""

from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path

import pytest

from pliego.export.pdf import PAGE_SIZES_MM, to_pdf
from pliego.export.plan import build_plan

GOLDEN = Path(__file__).parent / "golden_export"


def sample() -> dict:
    return json.loads((GOLDEN / "sample.fold.json").read_text(encoding="utf-8"))


def test_golden():
    data = to_pdf(sample(), "a4")
    path = GOLDEN / "sample.a4.pdf"
    if os.environ.get("PLIEGO_UPDATE_GOLDEN") == "1":
        path.write_bytes(data)
    assert path.read_bytes() == data


@pytest.mark.parametrize("page", sorted(PAGE_SIZES_MM))
def test_structure_and_tiles_cover_canvas(page):
    data = to_pdf(sample(), page)
    assert data.startswith(b"%PDF-1.4\n") and data.endswith(b"%%EOF\n")
    xref = int(re.search(rb"startxref\n(\d+)\n", data).group(1))
    assert data[xref:xref + 4] == b"xref"
    offsets = [int(m) for m in re.findall(rb"(\d{10}) 00000 n ", data)]
    for k, off in enumerate(offsets, start=1):
        assert data[off:].startswith(f"{k} 0 obj".encode())
    pages = int(re.search(rb"/Count (\d+)", data).group(1))
    w, h = PAGE_SIZES_MM[page]
    _x, _y, cw, ch = build_plan(sample()).canvas()
    tiles = math.ceil(cw / (w - 20)) * math.ceil(ch / (h - 20))
    assert pages == 1 + tiles
    labels = re.findall(rb"\((?:[^()]*) (R\d+C\d+) of", data)
    assert len(labels) == tiles


def test_diagram_line_styles():
    data = to_pdf(sample(), "a3")
    assert b"0.75 0.22 0.17 RG 0.50 w [17.01 4.25 2.83 4.25] 0 d" in data   # mountain dash-dot
    assert b"0.18 0.44 0.85 RG 0.50 w [8.50 4.25] 0 d" in data              # valley dashed
    assert b" re W n" in data and b" f\n" in data                           # clip + reg square


def test_unknown_page_fails_closed():
    with pytest.raises(ValueError):
        to_pdf(sample(), "b5")
