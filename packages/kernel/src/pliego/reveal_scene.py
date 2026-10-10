"""Scenes for `pliego.reveal`: heightfields and a small implicit/CSG vocabulary.

A scene is a scalar field `value(x, y, z)` in block millimetres (x, y on the sheet, z up from
the bottom of the block): **negative inside** the object, positive outside. Primitives are signed
distances where that is cheap (sphere, box); the others only need the right sign and a value that
varies smoothly across the surface, because the slicer interpolates the zero crossing linearly
between grid nodes. `bounds` (x0, y0, z0, x1, y1, z1) lets the slicer skip empty space; `None`
means unbounded.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

Bounds = tuple[float, float, float, float, float, float] | None


def _v3(p: Sequence[float], what: str) -> tuple[float, float, float]:
    if len(p) != 3 or not all(math.isfinite(float(c)) for c in p):
        raise ValueError(f"{what} must be a finite 3-D point, got {p!r}")
    return (float(p[0]), float(p[1]), float(p[2]))


def _pos(v: float, what: str) -> float:
    v = float(v)
    if not (math.isfinite(v) and v > 0):
        raise ValueError(f"{what} must be > 0, got {v!r}")
    return v


class Scene:
    """Base class: `value(x, y, z)` (< 0 inside) and `bounds`."""

    bounds: Bounds = None

    def value(self, x: float, y: float, z: float) -> float:  # pragma: no cover - abstract
        raise NotImplementedError

    def __or__(self, other: Scene) -> Scene:
        return union(self, other)

    def __and__(self, other: Scene) -> Scene:
        return intersect(self, other)

    def __sub__(self, other: Scene) -> Scene:
        return subtract(self, other)


class Heightfield(Scene):
    """Everything below the surface z = h(x, y) (h in mm; h ≤ 0 means no material there)."""

    def __init__(self, h: Callable[[float, float], float]):
        if not callable(h):
            raise TypeError("heightfield needs a callable h(x, y) -> mm")
        self.h = h

    def height(self, x: float, y: float) -> float:
        v = float(self.h(x, y))
        if not math.isfinite(v):
            raise ValueError(f"heightfield h({x}, {y}) is not finite")
        return v

    def value(self, x: float, y: float, z: float) -> float:
        return z - self.height(x, y)


class _Sphere(Scene):
    def __init__(self, center: Sequence[float], radius: float):
        self.c, self.r = _v3(center, "sphere center"), _pos(radius, "sphere radius")
        cx, cy, cz = self.c
        r = self.r
        self.bounds = (cx - r, cy - r, cz - r, cx + r, cy + r, cz + r)

    def value(self, x: float, y: float, z: float) -> float:
        cx, cy, cz = self.c
        return math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) - self.r


class _Box(Scene):
    def __init__(self, lo: Sequence[float], hi: Sequence[float]):
        a, b = _v3(lo, "box lo"), _v3(hi, "box hi")
        if not all(b[k] > a[k] for k in range(3)):
            raise ValueError(f"box needs hi > lo on every axis, got {lo!r}, {hi!r}")
        self.lo, self.hi = a, b
        self.bounds = (*a, *b)

    def value(self, x: float, y: float, z: float) -> float:
        lo, hi = self.lo, self.hi
        q = [max(lo[k] - p, p - hi[k]) for k, p in enumerate((x, y, z))]
        outside = math.sqrt(sum(max(c, 0.0) ** 2 for c in q))
        return outside + min(max(q), 0.0)


class _Frustum(Scene):
    """A vertical cylinder (r0 = r1) or cone frustum on the axis through (cx, cy)."""

    def __init__(self, center: Sequence[float], r0: float, r1: float, z0: float, z1: float):
        if len(center) != 2:
            raise ValueError("a cylinder/cone center is a 2-D (x, y) point")
        self.cx, self.cy = float(center[0]), float(center[1])
        self.r0, self.r1 = _pos(r0, "radius"), float(r1)
        if self.r1 < 0 or not math.isfinite(self.r1):
            raise ValueError("top radius must be ≥ 0")
        if not float(z1) > float(z0):
            raise ValueError("cylinder/cone needs z1 > z0")
        self.z0, self.z1 = float(z0), float(z1)
        r = max(self.r0, self.r1)
        self.bounds = (self.cx - r, self.cy - r, self.z0, self.cx + r, self.cy + r, self.z1)

    def value(self, x: float, y: float, z: float) -> float:
        t = min(1.0, max(0.0, (z - self.z0) / (self.z1 - self.z0)))
        r = self.r0 + (self.r1 - self.r0) * t
        return max(math.hypot(x - self.cx, y - self.cy) - r, self.z0 - z, z - self.z1)


class _Combine(Scene):
    def __init__(self, op: str, parts: Sequence[Scene]):
        if len(parts) < 2 or not all(isinstance(p, Scene) for p in parts):
            raise ValueError(f"{op} needs at least two scenes")
        self.op, self.parts = op, list(parts)
        bs = [p.bounds for p in self.parts]
        if op == "union":
            self.bounds = None if any(b is None for b in bs) else (
                min(b[0] for b in bs), min(b[1] for b in bs), min(b[2] for b in bs),
                max(b[3] for b in bs), max(b[4] for b in bs), max(b[5] for b in bs))
        elif op == "intersect":
            known = [b for b in bs if b is not None]
            self.bounds = None if not known else (
                max(b[0] for b in known), max(b[1] for b in known), max(b[2] for b in known),
                min(b[3] for b in known), min(b[4] for b in known), min(b[5] for b in known))
        else:  # subtract: the first scene's bounds
            self.bounds = bs[0]

    def _union(self, x: float, y: float, z: float) -> float:
        return _union_value(self.parts, x, y, z)

    def value(self, x: float, y: float, z: float) -> float:
        if self.op == "union":
            return self._union(x, y, z)
        if self.op == "intersect":
            return max(p.value(x, y, z) for p in self.parts)
        first = self.parts[0].value(x, y, z)
        return max(first, *(-p.value(x, y, z) for p in self.parts[1:]))


def _outside(b: Bounds, x: float, y: float, z: float) -> float:
    """How far (x, y, z) lies outside box `b` along its farthest axis — a lower bound of every
    primitive's value here (each primitive's value ≥ that distance outside its own bounds)."""
    if b is None:
        return 0.0
    return max(b[0] - x, x - b[3], b[1] - y, y - b[4], b[2] - z, z - b[5], 0.0)


def _union_value(parts: list[Scene], x: float, y: float, z: float) -> float:
    """min over parts, skipping parts whose bounds already prove they cannot be the minimum."""
    gaps = [_outside(p.bounds, x, y, z) for p in parts]
    best = math.inf
    for p, g in zip(parts, gaps, strict=True):
        if g == 0.0:
            best = min(best, p.value(x, y, z))
    for p, g in zip(parts, gaps, strict=True):
        if 0.0 < g < best:
            best = min(best, p.value(x, y, z))
    return best


# ── public constructors ──────────────────────────────────────────────────────


def heightfield(h: Callable[[float, float], float]) -> Heightfield:
    """The solid under the surface z = h(x, y) (mm): terrain, a stepped pyramid, a volcano."""
    return Heightfield(h)


def sphere(center: Sequence[float], radius: float) -> Scene:
    return _Sphere(center, radius)


def box(lo: Sequence[float], hi: Sequence[float]) -> Scene:
    """An axis-aligned box from corner `lo` to corner `hi` (x, y, z mm)."""
    return _Box(lo, hi)


def cylinder(center: Sequence[float], radius: float, z0: float, z1: float) -> Scene:
    """A vertical cylinder on the axis through (x, y) = `center`, from z0 to z1."""
    return _Frustum(center, radius, radius, z0, z1)


def cone(center: Sequence[float], r0: float, z0: float, z1: float, r1: float = 0.0) -> Scene:
    """A vertical cone (r1 = 0) or frustum: radius r0 at z0 narrowing to r1 at z1."""
    return _Frustum(center, r0, r1, z0, z1)


def union(*parts: Scene) -> Scene:
    return _Combine("union", parts)


def intersect(*parts: Scene) -> Scene:
    return _Combine("intersect", parts)


def subtract(base: Scene, *cutters: Scene) -> Scene:
    """`base` minus every cutter."""
    return _Combine("subtract", (base, *cutters))


__all__ = ["Heightfield", "Scene", "box", "cone", "cylinder", "heightfield", "intersect",
           "sphere", "subtract", "union"]
