"""Papel picado panels: fold-and-cut symmetry, papercut checks, hem fold and its glue."""

from __future__ import annotations

import pytest

import pliego
from pliego import foldcut

W, H, HEM = 60.0, 80.0, 8.0
CX = W / 2


def _diamond(x, y, r):
    return [(x - r, y), (x, y - r), (x + r, y), (x, y + r)]


def test_half_fold_mirrors_the_motif_and_keeps_one_piece():
    p = foldcut.papel_picado("flag", W, H, [_diamond(CX + 12, 30, 7),
                                           [(CX - 2, 48), (CX + 6, 48), (CX + 6, 56),
                                            (CX - 2, 56)]], hem=HEM, front="#e8336d")
    holes = sorted([sorted((round(q.x, 6), round(q.y, 6)) for q in h) for h in p.sheet.holes])
    mirrored = sorted([sorted((round(W - q.x, 6), round(q.y, 6)) for q in h)
                       for h in p.sheet.holes])
    assert holes == mirrored and len(holes) == 3      # the pair and the hole across the fold
    assert p.report.components == 1 and p.report.ok
    assert p.hem is not None and p.hem.fold_angle == -180.0 and p.hem_y == H - HEM
    assert all(m.assignment != "V" for m in p.sheet.marks)          # ironed flat


def test_quarter_fold_gives_four_holes_and_the_hem_glue_holds_folded():
    p = foldcut.papel_picado("flag", W, H, [[(CX + 3, 40), (CX + 10, 40), (CX + 10, 47),
                                             (CX + 3, 47)]], hem=HEM, symmetry=2)
    assert len(p.sheet.holes) == 4
    doc = pliego.Assembly([p.sheet], joins=[p.hem_glue("flag-hem")],
                          initial={"angles": {p.hem: -180.0}, "root": (CX, 20)}).build()
    assert doc.verify() == [], doc.summary(doc.verify())


@pytest.mark.parametrize("motif, why", [
    ([[(CX + 3, 70), (CX + 10, 70), (CX + 10, 75)]], "reaches the hem"),
    ([[(2, 30), (10, 30), (10, 40)]], "outside the folded part"),
    ([[(CX - 1, 20), (W - 0.8, 20), (W - 0.8, 50), (CX - 1, 50)]], "min_feature"),
    ([[(CX - 1, 20), (W + 1, 20), (W + 1, 22), (CX - 1, 22)]], "loose piece"),
])
def test_bad_motifs_fail_loud(motif, why):
    with pytest.raises(ValueError, match=why):
        foldcut.papel_picado("flag", W, H, motif, hem=HEM)


def test_panels_are_deterministic():
    def doc():
        p = foldcut.papel_picado("flag", W, H, [_diamond(CX + 12, 30, 7)], hem=HEM)
        return pliego.Assembly([p.sheet]).build().to_bytes()
    assert doc() == doc()
