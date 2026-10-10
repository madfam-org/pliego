"""Corrugation geometry (pliego.corrugate): profiles, fluted strips, cross-sections."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

import pliego
from pliego import board, corrugate, kinematics

MATERIALS = Path(__file__).resolve().parents[3] / "materials"


def _construction(slug: str) -> dict:
    card = json.loads((MATERIALS / slug / "stock.json").read_text(encoding="utf-8"))
    return card["construction"]


@pytest.mark.parametrize("flute", sorted(board.FLUTES))
def test_trapezoid_take_up_equals_sinusoid(flute):
    w = corrugate.wall(flute, 130.0)
    pts = corrugate.profile(w, 3, "trapezoid")
    length = math.fsum(math.dist(p, q) for p, q in zip(pts, pts[1:], strict=False))
    assert length / (3 * w.pitch) == pytest.approx(w.take_up, rel=1e-9)
    sine = corrugate.profile(w, 3, "sine", samples=400)
    s_len = math.fsum(math.dist(p, q) for p, q in zip(sine, sine[1:], strict=False))
    assert s_len / (3 * w.pitch) == pytest.approx(w.take_up, rel=1e-4)
    assert max(z for _, z in pts) == pytest.approx(w.amplitude)
    assert min(z for _, z in sine) == pytest.approx(-w.amplitude, rel=1e-3)


def test_unknown_flute_and_bad_medium_fail():
    with pytest.raises(board.BoardError):
        corrugate.wall("Z")
    with pytest.raises(board.BoardError):
        corrugate.wall("F", 900.0)


def test_fluted_strip_folds_to_board_length_and_height():
    fs = corrugate.fluted_strip("medium", "B", 6, 30.0)
    arr = fs.sheet.build()
    angles = {}
    for m, a in zip(fs.marks, fs.angles, strict=True):
        for e in m.edges():
            angles[e] = a
    pose = kinematics.pose_arrangement(arr, angles, pliego.P(0.1, 15.0))
    xs = [p[0] for p in pose]
    ys = [p[1] for p in pose]
    assert max(xs) - min(xs) == pytest.approx(fs.board_length, abs=1e-5)
    assert max(ys) - min(ys) == pytest.approx(2 * fs.wall.amplitude, abs=1e-5)
    assert max(ys) == pytest.approx(0.0, abs=1e-5)      # the root land stays on top, level
    assert fs.flat_length / fs.board_length == pytest.approx(fs.wall.take_up, rel=1e-9)
    assert sorted({round(abs(a), 9) for a in fs.angles}) == [round(fs.wall.flank_deg, 9)]
    # folded() follows the same centre line
    assert fs.folded(fs.flat_length) == pytest.approx((fs.board_length, 0.0), abs=1e-9)


def test_fluted_strip_kinematic_program_runs():
    fs = corrugate.fluted_strip("medium", "E", 4, 20.0)
    step = pliego.Step("corrugate", "Corrugate", list(zip(fs.marks, fs.angles, strict=True)))
    seq = pliego.Sequence.kinematic_path(fs.sheet, [step], substeps=4)
    assert seq.report["max_residual_rad"] == 0.0 or seq.report["max_residual_rad"] < 1e-9
    doc = pliego.Assembly([fs.sheet], sequence=seq).build(stocks=None)
    assert not [i for i in doc.verify() if i["level"] == "error"]


@pytest.mark.parametrize("slug, walls", [("corrugated-c-flute", 1),
                                         ("corrugated-bc-double-wall", 2),
                                         ("corrugated-aac-triple-wall", 3)])
def test_section_voids_fill_the_gaps(slug, walls):
    c = _construction(slug)
    length, caliper, voids = corrugate.section_voids(c, 8)
    slabs = corrugate.stack(c)
    assert caliper == pytest.approx(slabs[-1].z1)
    assert len([s for s in slabs if s.role == "medium"]) == walls
    for v in voids:
        assert all(0 < x < length for x, _ in v)
    # void area ≈ gap area − medium area, less the end half-voids
    area = math.fsum(abs(pliego.polygon_area([pliego.P(x, z) for x, z in v])) for v in voids)
    um = 190.0 if slug == "corrugated-aac-triple-wall" else 170.0
    full = 0.0
    for s in slabs:
        if s.role == "medium":
            w = corrugate.wall(s.flute, um)
            full += length * (w.height - w.medium_mm * w.take_up)
    assert 0.6 * full < area < full


def test_section_sheet_verifies_scaled():
    sheet = corrugate.section_sheet("section", _construction("corrugated-b-flute"), 5, scale=5)
    doc = pliego.Assembly([sheet]).build()
    assert not [i for i in doc.verify() if i["level"] == "error"]
    assert len(sheet.holes) >= 8
