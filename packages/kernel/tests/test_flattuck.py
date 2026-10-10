"""Tucks (`pliego.flattuck`): a flap folded into a pocket, between two layers — the waterbomb
balloon's points into the side pockets, the paper cup's front flap, the samurai helmet's back
corner inside (`tests/flat_models.py`)."""

from __future__ import annotations

import flat_models as fm
import pytest

from pliego import flatops
from pliego.flatcheck import check
from pliego.flatstate import FlatStateError
from pliego.flattuck import tuck


def tucks(fp):
    return [r.move for r in fp.recs if r.move is not None and r.move.kind == "tuck"]


def assert_in_pocket(m):
    st = m.state
    q, n = m.info["pocket"]
    stack = st.faces_at(q)
    moving = set(m.info["moving"])
    flap = [k for k, f in enumerate(stack) if f in moving]
    assert flap, "the flap covers the pocket point"
    if m.info["direction"] == "valley":
        assert all(f not in moving for f in stack[-n:])         # (at least) n layers over it
        assert max(flap) < len(stack) - n and min(flap) > 0      # inside, not at the bottom
    else:
        assert all(f not in moving for f in stack[:n])          # (at least) n layers under it
        assert min(flap) >= n and max(flap) < len(stack) - 1
    assert m.info["crossed"]


def test_waterbomb_balloon_points_tucked_into_the_side_pockets():
    fp, _ = fm.waterbomb_balloon()
    assert check(fp.state) == []
    ms = tucks(fp)
    assert len(ms) == 4
    for m in ms:
        assert check(m.state) == []
        assert_in_pocket(m)
    b = fp.build()
    rows = [r for r in b.report["rows"] if r["kind"] == "tuck"]
    assert len(rows) == 4
    for r in rows:
        assert r["tear_mm"] < 1e-6 and r["deviation_mm"] < 1e-6       # the simple fold's path
        assert r["penetration_mm"] == 0.0 and r["pocket_crossings"] == 1


def test_a_tuck_differs_from_the_fold_on_top():
    fp, g = fm.waterbomb_balloon()
    m = tucks(fp)[0]
    before = m.before
    sel = {"sheet_points": [before.preimage((g["h"] - 1.0, g["h"] - 4.0))]}
    line = ((-1.0, g["e"]), (150.0 + 1.0, g["e"]))
    plain = flatops.fold(before, line, "valley", **sel)
    q, _ = m.info["pocket"]
    top = plain.state.faces_at(q)[-1]
    assert top in plain.info["moving"]                    # a plain valley fold lands on top
    assert m.state.faces_at(q)[-1] not in m.info["moving"]


def test_paper_cup_front_flap_and_samurai_back_corner():
    for build in (fm.paper_cup, fm.samurai_helmet):
        fp, _ = build()
        assert check(fp.state) == []
        (m,) = tucks(fp)
        assert_in_pocket(m)
        b = fp.build()
        row = next(r for r in b.report["rows"] if r["kind"] == "tuck")
        assert row["tear_mm"] < 1e-6 and row["pocket_crossings"] >= 1


def test_tuck_errors():
    fp, g = fm.waterbomb_balloon()
    m = tucks(fp)[0]
    st = m.before
    sel = {"sheet_points": [st.preimage((g["h"] - 1.0, g["h"] - 4.0))]}
    line = ((-1.0, g["e"]), (151.0, g["e"]))
    with pytest.raises(FlatStateError, match="does not land"):
        tuck(st, line, "valley", pocket=((20.0, 5.0), 1), **sel)
    with pytest.raises(FlatStateError, match="layers over the pocket"):
        tuck(st, line, "valley", pocket=(m.info["pocket"][0], 40), **sel)
