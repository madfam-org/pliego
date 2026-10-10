"""Envelopes (pliego.envelope): styles × sizes, finished size, seal zones, fold program."""

from __future__ import annotations

import pytest
from test_dieline import posed_extent

from pliego import dieline, envelope


@pytest.mark.parametrize("style", envelope.STYLES)
@pytest.mark.parametrize("size", sorted(envelope.SIZES))
def test_every_style_and_size_folds_flat_to_its_finished_size(style, size):
    pack = envelope.envelope(style, size)
    t = pack.block["caliper_mm"]
    long_, short = envelope.SIZES[size]
    w, h = {"catalog": (short, long_), "pocket": (short, long_),
            "square": (short, short)}.get(style, (long_, short))
    extent, lo = posed_extent(pack, pack.closed)
    assert extent[0] == pytest.approx(w - t, abs=1e-5)      # every flap folds inside the front
    assert extent[2] == pytest.approx(h - t, abs=1e-5)
    assert extent[1] == pytest.approx(0.0, abs=1e-6)        # flat-folded (180°)
    doc = dieline.assemble([pack]).build()
    assert not [i for i in doc.verify() if i["level"] == "error"]


def test_iso_and_us_sizes():
    assert envelope.SIZES["dl"] == (220.0, 110.0)
    assert envelope.SIZES["c5"] == (229.0, 162.0)
    assert envelope.SIZES["us-10"] == pytest.approx((241.3, 104.775))
    assert envelope.SIZES["a7"] == pytest.approx((184.15, 133.35))


@pytest.mark.parametrize("seal, kind", [("gum", "gum"), ("peel-and-seal", "peel-and-seal")])
def test_seal_zone_kind(seal, kind):
    pack = envelope.envelope("commercial", "dl", seal=seal)
    zones = {g["id"]: g["kind"] for g in pack.block["glue"]}
    assert zones["seal"] == kind and zones["side-seam-1"] == "glue"


def test_window_and_program():
    pack = envelope.envelope("window", "dl")
    assert len(pack.sheet.holes) == 1
    assert sum(1 for g in pack.block["glue"] if g["id"].startswith("window-film")) == 4
    assert [s.id for s in pack.steps] == ["side-flaps", "bottom-flap", "seal"]
    with pytest.raises(ValueError):
        envelope.envelope("bubble", "dl")
    with pytest.raises(ValueError):
        envelope.envelope("commercial", "b4")
