"""Initial-pose rest angles (spec §5.14, hardening item 5)."""

from __future__ import annotations

import pytest

import pliego

L4 = {"en": "Base", "es": "Base", "fr": "Base", "pt": "Base"}


def test_initial_pose_sets_rest_angles(stocks):
    """Hardening item 5: creases already folded in the initial frame get that dihedral as their
    plastic rest angle (valley +, mountain −); authored rest angles win; flat creases stay 0."""
    s = pliego.Sheet("card", pliego.rectangle(150, 60), label=L4)
    gutter = s.valley((50, 0), (50, 60), angle=180)
    fold = s.mountain((100, 0), (100, 60), angle=180)
    kept = s.valley((25, 0), (25, 60), angle=180, rest=10)
    idle = s.valley((125, 0), (125, 60), angle=180)
    d = pliego.Assembly([s], initial={"card": {"angles": {gutter: 90, fold: -45, kept: 30},
                                               "root": (60, 10)}}).build(stocks=stocks)
    assert d.verify() == []
    rest = d.data["pliego:edges_restAngle"]
    for mark, want in ((gutter, 90.0), (fold, -45.0), (kept, 10.0), (idle, 0.0)):
        assert [rest[e] for e in mark.edges()] == pytest.approx([want] * len(mark.edges()))
    flat = pliego.Assembly([pliego.Sheet("p", pliego.square(10))], initial="flat").build(
        stocks=stocks)
    assert "pliego:edges_restAngle" not in flat.data
