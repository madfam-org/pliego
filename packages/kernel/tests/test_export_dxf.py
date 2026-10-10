"""DXF R12 exporter: golden bytes, header, layers, linetypes, cut order."""

from __future__ import annotations

import json
import os
from pathlib import Path

from pliego.export.dxf import LAYERS, _ascii, to_dxf

GOLDEN = Path(__file__).parent / "golden_export"


def sample() -> dict:
    return json.loads((GOLDEN / "sample.fold.json").read_text(encoding="utf-8"))


def pairs(text: str) -> list[tuple[int, str]]:
    lines = text.split("\n")
    assert lines[-1] == ""
    lines = lines[:-1]
    assert len(lines) % 2 == 0
    return [(int(lines[k]), lines[k + 1]) for k in range(0, len(lines), 2)]


def test_golden():
    data = to_dxf(sample()).encode("ascii")
    path = GOLDEN / "sample.dxf"
    if os.environ.get("PLIEGO_UPDATE_GOLDEN") == "1":
        path.write_bytes(data)
    assert path.read_bytes() == data


def test_header_layers_and_linetypes():
    p = pairs(to_dxf(sample()))
    assert p[-1] == (0, "EOF")
    text = to_dxf(sample())
    assert "$ACADVER\n1\nAC1009" in text and "$INSUNITS\n70\n4" in text
    layer_names = [p[k + 1][1] for k in range(len(p) - 1) if p[k] == (0, "LAYER")]
    assert layer_names == ["CUT", "MOUNTAIN", "VALLEY", "SCORE", "PERF", "GLUE", "TEXT"]
    assert list(LAYERS) == layer_names
    ltypes = [p[k + 1][1] for k in range(len(p) - 1) if p[k] == (0, "LTYPE")]
    assert ltypes == ["CONTINUOUS", "DASHED", "DASHDOT"]
    used = {v for c, v in p if c == 8}
    assert used == {"CUT", "MOUNTAIN", "VALLEY", "SCORE", "PERF", "GLUE", "TEXT"}


def test_inner_cuts_before_outer_outlines():
    p = pairs(to_dxf(sample()))
    cut_polys = []
    for k in range(len(p) - 1):
        if p[k] == (0, "POLYLINE") and p[k + 1] == (8, "CUT"):
            j, xs = k, []
            while p[j] != (0, "SEQEND"):
                if p[j] == (0, "VERTEX"):
                    xs.append((float(p[j + 2][1]), float(p[j + 3][1])))
                j += 1
            cut_polys.append(xs)
    assert cut_polys[0] == [(120.0, 20.0), (100.0, 20.0), (80.0, 20.0)]   # interior cut first
    assert len(cut_polys) == 4


def test_text_is_seven_bit():
    assert _ascii("Pestaña") == "Pesta\\U+00F1a"
    to_dxf(sample()).encode("ascii")
