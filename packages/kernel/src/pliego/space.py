"""Small 3-D helpers (world frame: mm, Y up) shared by document building and kinematics."""

from __future__ import annotations

import math
from collections.abc import Sequence

Vec3 = tuple[float, float, float]
Quat = tuple[float, float, float, float]  # [x, y, z, w]
Mat3 = tuple[Vec3, Vec3, Vec3]


def add(a: Sequence[float], b: Sequence[float]) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Sequence[float], b: Sequence[float]) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def scale(a: Sequence[float], k: float) -> Vec3:
    return (a[0] * k, a[1] * k, a[2] * k)


def dot(a: Sequence[float], b: Sequence[float]) -> float:
    return math.fsum((a[0] * b[0], a[1] * b[1], a[2] * b[2]))


def cross(a: Sequence[float], b: Sequence[float]) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a: Sequence[float]) -> float:
    return math.sqrt(dot(a, a))


def unit(a: Sequence[float]) -> Vec3:
    n = norm(a)
    if n < 1e-15:
        raise ValueError("cannot normalise a zero 3-D vector")
    return (a[0] / n, a[1] / n, a[2] / n)


def dist(a: Sequence[float], b: Sequence[float]) -> float:
    return norm(sub(a, b))


def unplaced(u: float, v: float) -> Vec3:
    """Sheet-local (u, v) → un-placed world point (u, 0, −v) (spec §1)."""
    return (u, 0.0, -v)


def quat_rotate(q: Sequence[float], p: Sequence[float]) -> Vec3:
    """Rotate p by the unit quaternion q = [x, y, z, w]."""
    x, y, z, w = q
    n = math.sqrt(x * x + y * y + z * z + w * w)
    if n < 1e-15:
        raise ValueError("zero quaternion")
    x, y, z, w = x / n, y / n, z / n, w / n
    t = (2 * (y * p[2] - z * p[1]), 2 * (z * p[0] - x * p[2]), 2 * (x * p[1] - y * p[0]))
    return (p[0] + w * t[0] + (y * t[2] - z * t[1]),
            p[1] + w * t[1] + (z * t[0] - x * t[2]),
            p[2] + w * t[2] + (x * t[1] - y * t[0]))


def quat_axis_angle(axis: Sequence[float], angle_deg: float) -> Quat:
    a = unit(axis)
    h = math.radians(angle_deg) / 2.0
    s = math.sin(h)
    return (a[0] * s, a[1] * s, a[2] * s, math.cos(h))


def axis_rotation(axis: Sequence[float], angle_rad: float) -> Mat3:
    """Rotation matrix about a unit axis (Rodrigues), right-handed."""
    x, y, z = unit(axis)
    c, s = math.cos(angle_rad), math.sin(angle_rad)
    C = 1.0 - c
    return ((c + x * x * C, x * y * C - z * s, x * z * C + y * s),
            (y * x * C + z * s, c + y * y * C, y * z * C - x * s),
            (z * x * C - y * s, z * y * C + x * s, c + z * z * C))


def mat_vec(m: Mat3, v: Sequence[float]) -> Vec3:
    return (m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2])


def mat_mul(a: Mat3, b: Mat3) -> Mat3:
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3))
                 for i in range(3))  # type: ignore[return-value]


IDENTITY3: Mat3 = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
