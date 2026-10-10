"""Corrugation geometry: fluted media, liners, cross-sections and craft corrugated sheets.

Flute pitch and height come from :data:`pliego.board.FLUTES` (the same table the stock model
uses), so a drawn flute and a derived stock agree. Two medium profiles:

- ``"sine"`` — the centre line ``z = a·cos(2π(x − w/2)/λ)`` the stock model integrates;
- ``"trapezoid"`` — the **foldable** profile: flat lands of width ``w`` at the flute tips
  (where starch glues the medium to the liners) joined by straight flanks. ``w`` is solved so
  the trapezoid has exactly the sinusoid's take-up α (:func:`land_width`), so a folded strip
  uses the same length of medium per length of board as the derived stock.

Frames: the profile lies in the sheet's ``u`` direction (x), height ``z`` is the world's +Y;
the flutes run along ``v``. A fluted strip's sheet is the medium laid flat: one crease per
facet junction, mountain where the profile turns down, valley where it turns up (FOLD sign:
valley = toward the front, which faces +Y), so the first land (u = 0, the sheet's root face) stays
level and the wave hangs below it. No crease meets another, so the strip is rigidly foldable
(a face tree); the kernel's kinematic solver has no vertex to close.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from . import board
from .sheet import Mark, Sheet

LAND_TOL = 1e-12


@dataclass(frozen=True)
class Wall:
    """Geometry of one fluted medium (mm): pitch λ, flute height h, centre amplitude a,
    take-up α (sinusoid), trapezoid land width w and flank angle β (deg)."""

    flute: str
    pitch: float
    height: float
    medium_mm: float
    amplitude: float
    take_up: float
    land: float
    flank_deg: float


def _trap_take_up(pitch: float, amp: float, land: float) -> float:
    run = pitch / 2.0 - land
    return (2.0 * land + 2.0 * math.hypot(run, 2.0 * amp)) / pitch


def land_width(pitch: float, amplitude: float, take_up: float) -> float:
    """Land width w of the trapezoid whose take-up equals ``take_up`` (bisection, monotone).

    w = 0 is the triangle wave (shorter than the sinusoid), w → λ/2 vertical flanks (longer)."""
    lo, hi = 0.0, pitch / 2.0 * (1.0 - 1e-9)
    if not _trap_take_up(pitch, amplitude, lo) <= take_up <= _trap_take_up(pitch, amplitude, hi):
        raise board.BoardError(f"take-up {take_up} is outside the trapezoid range")
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if _trap_take_up(pitch, amplitude, mid) < take_up:
            lo = mid
        else:
            hi = mid
        if hi - lo < LAND_TOL:
            break
    return (lo + hi) / 2.0


def wall(flute: str, medium_um: float = 170.0) -> Wall:
    """The geometry of a wall of ``flute`` with a medium ``medium_um`` thick."""
    f = board.FLUTES.get(flute)
    if f is None:
        raise board.BoardError(f"unknown flute {flute!r} (use {sorted(board.FLUTES)})")
    t = medium_um / 1000.0
    if not 0 < t < f.height:
        raise board.BoardError(f"medium caliper must be in (0, {f.height}) mm for {flute} flute")
    amp = (f.height - t) / 2.0
    alpha = board.take_up(f.pitch, amp)
    w = land_width(f.pitch, amp, alpha)
    beta = math.degrees(math.atan2(2.0 * amp, f.pitch / 2.0 - w))
    return Wall(flute, f.pitch, f.height, t, amp, alpha, w, beta)


def profile(w: Wall, pitches: int, shape: str = "trapezoid",
            samples: int = 24) -> list[tuple[float, float]]:
    """Medium centre line over ``pitches`` flutes, starting at x = 0 with a top land (or peak).

    Trapezoid points per pitch: land start, land end, bottom land start/end (4 facets); sine:
    ``samples`` points per pitch. z is measured from the wall's mid-height."""
    if pitches < 1:
        raise ValueError("profile needs at least one pitch")
    a, lam, land = w.amplitude, w.pitch, w.land
    pts: list[tuple[float, float]] = []
    if shape == "trapezoid":
        half = lam / 2.0
        for k in range(pitches):
            x0 = k * lam
            pts += [(x0, a), (x0 + land, a), (x0 + half, -a), (x0 + half + land, -a)]
        pts.append((pitches * lam, a))
        return pts
    if shape == "sine":
        n = pitches * samples
        return [(lam * pitches * i / n,
                 a * math.cos(2.0 * math.pi * (lam * pitches * i / n - land / 2.0) / lam))
                for i in range(n + 1)]
    raise ValueError(f"unknown profile shape {shape!r} (trapezoid | sine)")


def turning_angles(points: Sequence[tuple[float, float]]) -> list[float]:
    """Signed turn (deg) at each interior point of a polyline in the x–z plane: positive turns
    up (counter-clockwise) — a valley fold for a sheet whose front faces +z."""
    out = []
    for (x0, z0), (x1, z1), (x2, z2) in zip(points, points[1:], points[2:], strict=False):
        a = math.atan2(z1 - z0, x1 - x0)
        b = math.atan2(z2 - z1, x2 - x1)
        out.append(math.degrees(math.atan2(math.sin(b - a), math.cos(b - a))))
    return out


@dataclass
class FlutedStrip:
    """A medium laid flat (``sheet``) with its creases (``marks`` / ``angles``, in u order),
    the folded centre line (``points``), its flat length and the board length it folds to."""

    sheet: Sheet
    wall: Wall
    marks: list[Mark]
    angles: list[float]
    points: list[tuple[float, float]]
    flat_length: float
    board_length: float
    knots: list[float]

    def folded(self, u: float) -> tuple[float, float]:
        """(x, z) of the folded centre line at arc length ``u`` (z = 0 at the first land)."""
        u = min(max(u, 0.0), self.flat_length)
        for k in range(len(self.points) - 1):
            if u <= self.knots[k + 1] or k == len(self.points) - 2:
                (x0, z0), (x1, z1) = self.points[k], self.points[k + 1]
                seg = self.knots[k + 1] - self.knots[k]
                t = 0.0 if seg <= 0 else (u - self.knots[k]) / seg
                return (x0 + (x1 - x0) * t, z0 + (z1 - z0) * t - self.points[0][1])
        raise AssertionError("unreachable")


def fluted_strip(sheet_id: str, flute: str, pitches: int, width: float, *,
                 medium_um: float = 170.0, stock: str = "kraft-120", label=None,
                 front=None, back=None, treatment: str = "crease",
                 name: str | None = "flute") -> FlutedStrip:
    """The medium of ``pitches`` flutes, ``width`` mm along the flutes, as a flat sheet whose
    creases fold it into the trapezoid profile (see the module docstring for the signs)."""
    w = wall(flute, medium_um)
    pts = profile(w, pitches, "trapezoid")
    knots = [0.0]
    for p, q in zip(pts, pts[1:], strict=False):
        knots.append(knots[-1] + math.dist(p, q))
    flat = knots[-1]
    sheet = Sheet(sheet_id, [(0.0, 0.0), (flat, 0.0), (flat, width), (0.0, width)],
                  stock=stock, grain_deg=0.0, label=label, front=front, back=back)
    marks, angles = [], []
    for u, turn in zip(knots[1:-1], turning_angles(pts), strict=True):
        kind = "valley" if turn > 0 else "mountain"
        marks.append(sheet.crease((u, 0.0), (u, width), kind, abs(turn), treatment,
                                  name=name))
        angles.append(turn)
    return FlutedStrip(sheet, w, marks, angles, pts, flat, pitches * w.pitch, knots)


def _offset_polyline(pts: Sequence[tuple[float, float]], d: float) -> list[tuple[float, float]]:
    """Offset an open polyline by d to its left (mitred joins)."""
    lines = []
    for (x0, z0), (x1, z1) in zip(pts, pts[1:], strict=False):
        ln = math.hypot(x1 - x0, z1 - z0)
        nx, nz = -(z1 - z0) / ln, (x1 - x0) / ln
        lines.append(((x0 + d * nx, z0 + d * nz), (x1 + d * nx, z1 + d * nz)))
    out = [lines[0][0]]
    for (p0, p1), (q0, q1) in zip(lines, lines[1:], strict=False):
        rx, rz = p1[0] - p0[0], p1[1] - p0[1]
        sx, sz = q1[0] - q0[0], q1[1] - q0[1]
        den = rx * sz - rz * sx
        if abs(den) < 1e-12:
            out.append(p1)
            continue
        t = ((q0[0] - p0[0]) * sz - (q0[1] - p0[1]) * sx) / den
        out.append((p0[0] + t * rx, p0[1] + t * rz))
    out.append(lines[-1][1])
    return out


@dataclass(frozen=True)
class SectionLayer:
    role: str                    # "liner" | "medium"
    z0: float                    # bottom of the slab (mm, board bottom = 0)
    z1: float
    flute: str | None = None


def stack(construction: dict) -> list[SectionLayer]:
    """Slabs of a corrugated construction, bottom up (liners and flute gaps)."""
    layers = board._layers(construction)  # validates
    if construction["kind"] != "corrugated":
        raise board.BoardError("stack needs a corrugated construction")
    out, z = [], 0.0
    for layer in reversed(layers):
        if layer["role"] == "medium":
            h = board.FLUTES[layer["flute"]].height
            out.append(SectionLayer("medium", z, z + h, layer["flute"]))
            z += h
        else:
            t = layer["caliper_um"] / 1000.0
            out.append(SectionLayer("liner", z, z + t))
            z += t
    return out


def section_voids(construction: dict, pitches: int) -> tuple[float, float, list[list[tuple]]]:
    """Cross-section of a corrugated construction seen along the flutes, ``pitches`` flutes of
    the bottom wall long: (length, caliper, voids). The section runs from mid top-land to mid
    top-land; each void is the quadrilateral between a liner face and the medium's offset face.
    Voids crossing the section's ends are left out (the end half-voids stay solid)."""
    slabs = stack(construction)
    layers = list(reversed(board._layers(construction)))      # bottom up, as slabs
    walls = [(slab, wall(layer["flute"], layer["caliper_um"]))
             for slab, layer in zip(slabs, layers, strict=True) if slab.role == "medium"]
    length = pitches * walls[0][1].pitch
    voids: list[list[tuple]] = []
    for slab, w in walls:
        n = max(1, math.ceil(length / w.pitch))
        pts = [(x - w.land / 2.0, z) for x, z in profile(w, n + 1, "trapezoid")]
        mid = (slab.z0 + slab.z1) / 2.0
        top = [(x, mid + z) for x, z in _offset_polyline(pts, w.medium_mm / 2.0)]
        bot = [(x, mid + z) for x, z in _offset_polyline(pts, -w.medium_mm / 2.0)]
        for k in range(n + 1):
            i = 4 * k
            if i + 4 < len(top):        # above bottom land k, under the upper liner
                voids.append([top[i + 1], top[i + 2], top[i + 3], top[i + 4]])
            if i + 6 < len(bot):        # under top land k + 1, over the lower liner
                voids.append([bot[i + 3], bot[i + 4], bot[i + 5], bot[i + 6]])
    caliper = slabs[-1].z1
    kept = [v for v in voids if all(1e-9 < x < length - 1e-9 for x, _ in v)]
    return length, caliper, kept


def section_sheet(sheet_id: str, construction: dict, pitches: int, *, scale: float = 1.0,
                  stock: str = "cardstock-300", label=None) -> Sheet:
    """A cut template of the cross-section: the board's edge-on outline with every flute void
    cut out, scaled by ``scale`` (5 = five times life size)."""
    if not scale > 0:
        raise ValueError("scale must be positive")
    length, caliper, voids = section_voids(construction, pitches)
    s = scale
    sheet = Sheet(sheet_id, [(0.0, 0.0), (length * s, 0.0), (length * s, caliper * s),
                             (0.0, caliper * s)], stock=stock, grain_deg=0.0, label=label)
    for v in voids:
        sheet.hole([(x * s, z * s) for x, z in v])
    return sheet
