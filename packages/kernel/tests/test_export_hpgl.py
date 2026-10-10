"""HPGL exporter: golden bytes, units, pass order (score → fold → perf → cut inner → outer)."""

from __future__ import annotations

import json
import os
from pathlib import Path

from pliego.export.hpgl import to_hpgl

GOLDEN = Path(__file__).parent / "golden_export"


def sample() -> dict:
    return json.loads((GOLDEN / "sample.fold.json").read_text(encoding="utf-8"))


def test_golden():
    data = to_hpgl(sample()).encode("ascii")
    path = GOLDEN / "sample.plt"
    if os.environ.get("PLIEGO_UPDATE_GOLDEN") == "1":
        path.write_bytes(data)
    assert path.read_bytes() == data


def test_pass_order_and_units():
    lines = to_hpgl(sample()).splitlines()
    assert lines[0] == "IN;" and lines[-1] == "PU;SP0;"
    pens = [ln for ln in lines if ln.startswith("SP") and ln != "SP0;"]
    assert pens == ["SP1;", "SP2;", "SP3;", "SP4;"]
    cut = lines[lines.index("SP4;") + 1:-1]
    assert cut[0] == "PU4800,800;PD4000,800,3200,800;"     # interior cut before outlines
    assert "PD800,0,1600,0,2400,0,2400,1600,1600,1600,800,1600,0,1600,0,0;" in cut[1]
    # 40 units per mm: the 60 mm panel spans 2400 units
    assert "2400" in cut[1]
