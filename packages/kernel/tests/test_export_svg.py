"""SVG exporter: golden bytes, layers, palettes, determinism."""

from __future__ import annotations

import json
import os
import random
import xml.dom.minidom
from pathlib import Path

import pytest

from pliego.export.svg import PALETTES, to_svg

GOLDEN = Path(__file__).parent / "golden_export"


def sample() -> dict:
    return json.loads((GOLDEN / "sample.fold.json").read_text(encoding="utf-8"))


def golden(name: str, data: bytes) -> None:
    path = GOLDEN / name
    if os.environ.get("PLIEGO_UPDATE_GOLDEN") == "1":
        path.write_bytes(data)
    assert path.read_bytes() == data, f"{name} differs from golden (PLIEGO_UPDATE_GOLDEN=1)"


@pytest.mark.parametrize("palette", sorted(PALETTES))
def test_golden(palette):
    golden(f"sample.{palette}.svg", to_svg(sample(), palette).encode("utf-8"))


def test_layers_units_and_styles():
    svg = to_svg(sample())
    dom = xml.dom.minidom.parseString(svg)
    root = dom.documentElement
    assert root.getAttribute("width").endswith("mm")
    w = float(root.getAttribute("width")[:-2])
    assert root.getAttribute("viewBox") == f"0 0 {root.getAttribute('width')[:-2]} " \
        f"{root.getAttribute('height')[:-2]}" and w > 120
    ids = [g.getAttribute("id") for g in root.getElementsByTagName("g")]
    assert ids == ["art", "glue", "score", "perforation", "mountain", "valley", "cut",
                   "registration", "label"]
    groups = {g.getAttribute("id"): g for g in root.getElementsByTagName("g")}
    assert groups["valley"].getAttribute("stroke-dasharray") == "3 1.5"
    assert groups["mountain"].getAttribute("stroke-dasharray") == "6 1.5 1 1.5"
    assert len(groups["perforation"].getElementsByTagName("line")) == 5   # 20 mm / 4 mm pitch
    assert groups["glue"].getAttribute("fill") == "url(#glue-hatch)"


def test_laser_palettes_are_solid_and_distinct():
    for name in ("lightburn", "cricut"):
        root = xml.dom.minidom.parseString(to_svg(sample(), name)).documentElement
        strokes = {}
        for g in root.getElementsByTagName("g"):
            assert not g.getAttribute("stroke-dasharray")
            if g.getAttribute("stroke"):
                strokes[g.getAttribute("id")] = g.getAttribute("stroke")
        line_types = ("cut", "mountain", "valley", "score", "perforation")
        assert len({strokes[k] for k in line_types}) == len(line_types)


def test_unknown_palette_fails_closed():
    with pytest.raises(ValueError):
        to_svg(sample(), "neon")


def test_deterministic_under_input_noise():
    base = to_svg(sample())
    rng = random.Random(7)
    for _ in range(3):
        d = sample()
        d["vertices_coords"] = [[x + rng.uniform(-1e-9, 1e-9), y + rng.uniform(-1e-9, 1e-9)]
                                for x, y in d["vertices_coords"]]
        assert to_svg(d) == base
