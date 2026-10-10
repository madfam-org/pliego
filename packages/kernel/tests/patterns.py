"""Original test crease patterns (rational coordinates; no third-party designs)."""

from __future__ import annotations

import pliego


def preliminary_base(size: float = 100.0) -> pliego.Sheet:
    """Book folds valley, one diagonal mountain (centre degree 6)."""
    s = pliego.Sheet("preliminary", pliego.square(size))
    h = size / 2
    s.valley((0, h), (size, h))
    s.valley((h, 0), (h, size))
    s.mountain((0, 0), (size, size))
    return s


def waterbomb_base(size: float = 100.0) -> pliego.Sheet:
    """Both diagonals valley, one book fold mountain (centre degree 6)."""
    s = pliego.Sheet("waterbomb", pliego.square(size))
    s.valley((0, 0), (size, size))
    s.valley((size, 0), (0, size))
    s.mountain((0, size / 2), (size, size / 2))
    return s


def square_twist(shift: tuple[float, float] = (0.0, 0.0)) -> pliego.Sheet:
    """Square twist on a 100 mm sheet: central square [40, 60]², pleats with slope 2.

    `shift` moves the lower-left corner of the central square (perturbation tests).
    """
    s = pliego.Sheet("twist", pliego.square(100))
    ll = (40 + shift[0], 40 + shift[1])
    lr, ur, ul = (60, 40), (60, 60), (40, 60)
    for a, b in ((ll, lr), (lr, ur), (ur, ul), (ul, ll)):
        s.mountain(a, b)
    # pleat rays per corner (rotated copies of (−1, 2) valley, (−2, −1) mountain)
    rays = {ll: ((-1, 2), (-2, -1)), lr: ((-2, -1), (1, -2)), ur: ((1, -2), (2, 1)),
            ul: ((2, 1), (-1, 2))}
    for corner, (v, m) in rays.items():
        s.valley(corner, (corner[0] + 60 * v[0], corner[1] + 60 * v[1]))
        s.mountain(corner, (corner[0] + 60 * m[0], corner[1] + 60 * m[1]))
    return s


def miura(cols: int = 4, rows: int = 4, dx: float = 10.0, dy: float = 15.0, amp: float = 4.0,
          perturb: tuple[int, int, float] | None = None) -> pliego.Sheet:
    """Miura-ori: zigzag rows (alternating M/V rows) and straight columns.

    The sheet is the rectangle [0, cols·dx] × [0, rows·dy + amp]; zigzag row j sits at
    y = j·dy + amp·(i mod 2). `perturb=(i, j, d)` nudges one zigzag vertex by d in x.
    """
    w, h = cols * dx, rows * dy + amp
    s = pliego.Sheet("miura", pliego.rectangle(w, h))

    def pt(i: int, j: int) -> tuple[float, float]:
        x = i * dx
        if perturb and perturb[0] == i and perturb[1] == j:
            x += perturb[2]
        return (x, j * dy + amp * (i % 2))

    for j in range(1, rows):
        kind = "mountain" if j % 2 else "valley"
        for i in range(cols):
            s.crease(pt(i, j), pt(i + 1, j), kind)
    for i in range(1, cols):
        for j in range(rows):
            lo = (i * dx, 0.0) if j == 0 else pt(i, j)
            hi = (i * dx, h) if j == rows - 1 else pt(i, j + 1)
            a = (i + j) % 2 == 0
            s.crease(lo, hi, "mountain" if a else "valley")
    return s


def degree4(alphas: tuple[float, float, float, float] = (70, 80, 110, 100), radius: float = 100):
    """A single vertex at the origin with creases separating the given sector angles."""
    import math

    s = pliego.Sheet("vertex", pliego.regular_polygon(36, radius, (0, 0), 5))
    theta = 0.0
    marks = []
    for a in alphas:
        marks.append(s.crease((0, 0), (radius * 1.5 * math.cos(math.radians(theta)),
                                       radius * 1.5 * math.sin(math.radians(theta))),
                              "valley", 10))
        theta += a
    return s, marks
