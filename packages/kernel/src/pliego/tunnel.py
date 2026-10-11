"""Pleated tunnel book: two accordion walls that carry the frames as box pleats.

A classic tunnel book glues separate frames into the valleys of two accordion walls; the frames
then follow the walls only through the glue. Here each wall strip folds half of every frame out
of itself — in to the middle, across a narrow pleat strip, back out to the wall — so the two
walls carry the whole scene and the opening is one rigid fold program: every crease angle is
affine in the walls' half-angle φ. The two half-frames of a frame meet at the seam (x = 0); a
window may run across it. Re-exported by `pliego.book`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .assembly import glue
from .sheet import Mark, Sheet


def _rect(w: float, h: float) -> list[tuple[float, float]]:
    return [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]


def _check(**values: float) -> None:
    for name, value in values.items():
        if not (isinstance(value, int | float) and math.isfinite(value) and value > 0):
            raise ValueError(f"{name} must be a positive number, got {value!r}")


def _count(name: str, value: int, hi: int) -> None:
    if not isinstance(value, int) or not 1 <= value <= hi:
        raise ValueError(f"{name} must be an integer in [1, {hi}], got {value!r}")


V2 = tuple[float, float]


@dataclass
class PleatedTunnel:
    """A tunnel book from three sheets (`pleated_tunnel`): ``back`` (the back scene, its side
    tabs folded forward), ``wall-left`` and ``wall-right``. Each wall strip runs from the back:
    a foot glued to the back's tab, then per frame an accordion V (two panels of length
    ``depth``, the peak outward) and a box pleat — half a frame going in to the seam, a strip
    ``pleat`` mm wide, half a frame coming back — so frame k is two double half-frames meeting
    at the middle. Frames are numbered from the front (0 = the cover).

    World frame: the back scene in the plane z = 0 facing +z (the viewer), y up, the tunnel
    between x = ±width/2. Every crease angle is affine in the walls' half-angle φ (0 = walls
    straight, the frames ``2·depth`` apart; 90 = shut), so a linear blend between two states is
    the exact state between them."""

    sheets: list[Sheet]
    joins: list[dict]
    frames: int
    width: float
    height: float
    depth: float
    foot: float
    pleat: float
    marks: dict[str, list[tuple[Mark, int]]]   # sheet id → (mark, segment index of its end)
    lengths: list[float]                        # segment lengths along a wall strip

    def directions(self, side: int, phi: float) -> list[V2]:
        """Segment directions (x, z) of a wall (side −1 left, +1 right) at half-angle φ."""
        s, c = math.sin(math.radians(phi)), math.cos(math.radians(phi))
        d: list[V2] = [(0.0, 1.0)]
        for _ in range(self.frames):
            d += [(side * s, c), (-side * s, c), (-side * 1.0, 0.0), (0.0, 1.0), (side * 1.0, 0.0)]
        return d

    def spacing(self, phi: float) -> float:
        """Frame pitch at φ (front layer to front layer)."""
        return 2.0 * self.depth * math.cos(math.radians(phi)) + self.pleat

    def angles(self, phi: float) -> dict[Mark, float]:
        """{mark: deg} of both walls at half-angle φ (the back's tabs are not driven)."""
        out: dict[Mark, float] = {}
        for sid, side in (("wall-left", -1), ("wall-right", 1)):
            d = self.directions(side, phi)
            for m, i in self.marks[sid]:
                a, b = d[i], d[i + 1]
                out[m] = math.degrees(math.atan2(a[0] * b[1] - a[1] * b[0],
                                                 a[0] * b[0] + a[1] * b[1]))
        return out

    def world(self, sid: str, u: float, v: float, phi: float) -> tuple[float, float, float]:
        """World point of sheet-local (u, v) at half-angle φ."""
        hw = self.width / 2.0
        if sid == "back":
            t = self.foot
            if u <= t:
                return (-hw, v, t - u)
            if u >= t + self.width:
                return (hw, v, u - t - self.width)
            return (u - t - hw, v, 0.0)
        side = -1 if sid == "wall-left" else 1
        x, z = side * hw, 0.0
        acc = 0.0
        for (dx, dz), ln in zip(self.directions(side, phi), self.lengths, strict=True):
            if u <= acc + ln + 1e-12:
                t = u - acc
                return (x + dx * t, v, z + dz * t)
            x, z, acc = x + dx * ln, z + dz * ln, acc + ln
        raise ValueError(f"u = {u} is past the end of {sid}")

    def initial(self, phi: float):
        """An initial-frame callable (sheet id, (u, v)) → world, at half-angle φ."""
        return lambda sid, uv: self.world(sid, uv[0], uv[1], phi)

    def frame_u(self, k: int) -> tuple[float, float]:
        """Strip u where frame k (0 = the cover) leaves the wall (its rear half-frame starts)
        and where it returns to it (its front half-frame ends)."""
        if not 0 <= k < self.frames:
            raise ValueError(f"frame {k} is not in [0, {self.frames})")
        g = self.frames - 1 - k
        u = self.foot + g * (2 * self.depth + self.width + self.pleat) + 2 * self.depth
        return u, u + self.width + self.pleat

    def pose_error(self, phi: float) -> float:
        """Largest distance (mm) between the face-tree pose of every wall vertex (crease angles
        from `angles`) and `world` — 0 up to rounding when the angle law is right."""
        from .geometry import P
        from .kinematics import face_transforms, root_face

        ang = self.angles(phi)
        worst = 0.0
        for sheet in self.sheets[1:]:
            arr = sheet.build()
            eang = {e: a for m, a in ang.items() if m.sheet is sheet for e in m.edges()}
            root = root_face(arr, P(self.foot / 2.0, self.height / 2.0))
            tr = face_transforms(arr, eang, root)
            # the foot's rigid map: unplaced (u, 0, −v) → world
            o = self.world(sheet.id, 0.0, 0.0, phi)
            ex = _sub3(self.world(sheet.id, 1.0, 0.0, phi), o)
            ey = (0.0, 1.0, 0.0)
            ez = _cross3(ex, ey)
            for fi, f in enumerate(arr.faces):
                rot, t = tr[fi]  # type: ignore[misc]
                for vi in f:
                    q = arr.vertices[vi]
                    p = (q.x, 0.0, -q.y)
                    loc = [sum(rot[i][j] * p[j] for j in range(3)) + t[i] for i in range(3)]
                    w = tuple(o[k] + ex[k] * loc[0] - ey[k] * loc[2] + ez[k] * loc[1]
                              for k in range(3))
                    worst = max(worst, math.dist(w, self.world(sheet.id, q.x, q.y, phi)))
        return worst


def _sub3(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross3(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _split_seam(poly: list[V2]) -> tuple[list[V2] | None, list[V2] | None]:
    """Clip a polygon at x = 0 into its left (x < 0) and right (x ≥ 0) parts; a polygon may
    cross the seam at most once each way."""
    left = [p[0] < 0.0 for p in poly]
    n = len(poly)
    crossings = sum(left[i] != left[(i + 1) % n] for i in range(n))
    if crossings > 2:
        raise ValueError("pleated_tunnel: a window crosses the seam (x = 0) more than once")
    if crossings == 0:
        return (poly, None) if left[0] else (None, poly)
    lo: list[V2] = []
    hi: list[V2] = []
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        (lo if left[i] else hi).append(a)
        if left[i] != left[(i + 1) % n]:
            t = (0.0 - a[0]) / (b[0] - a[0])
            m = (0.0, a[1] + t * (b[1] - a[1]))
            lo.append(m)
            hi.append(m)
    return lo, [p for k, p in enumerate(hi) if k == 0 or math.dist(p, hi[k - 1]) > 1e-9]


def _area2(poly: list[V2]) -> float:
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0]
               * poly[i][1] for i in range(len(poly)))


def _pleat_holes(part: list[V2], u_rear: float, u_front: float, hw: float) -> list[list[V2]]:
    """Holes in the flat strip for the left-half part of a window (x ≤ 0, frame coords): the
    rear layer maps x → u_rear + x + hw, the front layer (a mirror) x → u_front − x; a part on
    the seam becomes one hole running across the pleat strip."""
    if _area2(part) < 0:
        part = part[::-1]
    on = [abs(p[0]) <= 1e-9 for p in part]
    seam = [i for i in range(len(part)) if on[i] and on[(i + 1) % len(part)]]
    if not seam:
        rear = [(u_rear + x + hw, y) for x, y in part]
        front = [(u_front - x, y) for x, y in part][::-1]
        return [rear, front]
    k = seam[0]
    ring = part[k + 1:] + part[:k + 1]          # q0 … qk with qk → q0 on the seam
    return [[(u_rear + x + hw, y) for x, y in ring] + [(u_front - x, y) for x, y in ring[::-1]]]


def pleated_tunnel(frames: int = 4, width: float = 120.0, height: float = 90.0,
                   depth: float = 18.0, *, foot: float = 12.0, pleat: float = 1.0,
                   open_phi: float = 30.0, windows: list[list[list[V2]]] | None = None,
                   stock: str = "cardstock-160", back_stock: str | None = None,
                   min_feature: float = 1.5, margin: float = 4.0,
                   colors: tuple[str | None, str | None] = (None, None),
                   treatment: str = "score") -> PleatedTunnel:
    """Build a `PleatedTunnel` whose creases carry their design angles at ``open_phi``.
    ``windows[k]`` lists frame k's window polygons (frame coords: x ∈ [−width/2, width/2] seen
    from the front, y ∈ [0, height]); each must keep ``margin`` from the frame's edges and cross
    the seam x = 0 at most once. Every cut wall is checked with `papercut.analyze` against
    ``min_feature`` (fail loud). ``colors`` = (walls, back)."""
    from .papercut import analyze

    _count("frames", frames, 12)
    _check(width=width, height=height, depth=depth, foot=foot, pleat=pleat, margin=margin)
    if not 0.0 < open_phi < 90.0:
        raise ValueError("pleated_tunnel: open_phi must be in (0, 90)")
    windows = windows if windows is not None else [[] for _ in range(frames)]
    if len(windows) != frames:
        raise ValueError(f"pleated_tunnel: windows needs one list per frame ({frames})")
    hw = width / 2.0
    lengths = [foot] + [depth, depth, hw, pleat, hw] * frames
    total = math.fsum(lengths)
    back = Sheet("back", _rect(width + 2 * foot, height), stock=back_stock or stock,
                 grain_deg=90.0, front=colors[1], back=colors[1],
                 label={"en": "Back scene", "es": "Escena del fondo", "fr": "Scène du fond",
                        "pt": "Cena do fundo"})
    for u in (foot, foot + width):
        back.crease((u, 0), (u, height), "valley", 90.0, treatment=treatment, name="back-tab")
    back.label_edge("back-zone", (0, 0), (0, height))
    back.label_edge("back-zone", (width + 2 * foot, 0), (width + 2 * foot, height))
    tunnel = PleatedTunnel([back], [], frames, width, height, depth, foot, pleat, {}, lengths)
    roles = ("wall-peak", "wall-fold", "pleat", "pleat", "wall-fold")
    walls = (("wall-left", -1, {"en": "Left wall and half-frames", "es": "Pared izquierda y "
              "medios marcos", "fr": "Paroi gauche et demi-cadres",
              "pt": "Parede esquerda e meias molduras"}),
             ("wall-right", 1, {"en": "Right wall and half-frames", "es": "Pared derecha y "
              "medios marcos", "fr": "Paroi droite et demi-cadres",
              "pt": "Parede direita e meias molduras"}))
    for sid, side, label in walls:
        wall = Sheet(sid, _rect(total, height), stock=stock, grain_deg=90.0, label=label,
                     front=colors[0], back=colors[0])
        d = tunnel.directions(side, open_phi)
        tunnel.marks[sid] = []
        acc = 0.0
        for i, ln in enumerate(lengths[:-1]):
            acc += ln
            a, b = d[i], d[i + 1]
            turn = math.degrees(math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]))
            m = wall.crease((acc, 0), (acc, height), "valley" if turn > 0 else "mountain",
                            abs(turn), treatment=treatment,
                            name="wall-fold" if i == 0 else roles[(i - 1) % 5])
            tunnel.marks[sid].append((m, i))
        for k in range(frames):
            u1, _ = tunnel.frame_u(k)
            for poly in windows[k]:
                pts = [(float(x), float(y)) for x, y in poly]
                if any(not (-hw + margin <= x <= hw - margin and margin <= y <= height - margin)
                       for x, y in pts):
                    raise ValueError(f"pleated_tunnel: a window of frame {k} comes within "
                                     f"{margin:g} mm of the frame's edge")
                part, _rest = _split_seam(pts if side < 0 else [(-x, y) for x, y in pts])
                if part is not None:
                    for ring in _pleat_holes(part, u1, u1 + hw + pleat, hw):
                        wall.hole(ring)
        u0, _ = tunnel.frame_u(0)
        wall.label_edge("cover-edge", (u0 + hw + pleat, height), (u0 + width + pleat, height))
        if wall.holes:
            rep = analyze(wall, min_feature_mm=min_feature)
            if not rep.ok:
                raise ValueError(f"pleated_tunnel: {sid} fails the papercut check: "
                                 + "; ".join(i["detail"] for i in rep.issues
                                             if i["level"] == "error"))
        tunnel.sheets.append(wall)
    ins = 0.5
    region = [(ins, ins), (foot - ins, ins), (foot - ins, height - ins), (ins, height - ins)]
    tunnel.joins += [
        glue("wall-left-foot", tunnel.sheets[1], region, back, (-1.0, 0.0, 0.0, 1.0, foot, 0.0),
             "back"),
        glue("wall-right-foot", tunnel.sheets[2], region, back,
             (1.0, 0.0, 0.0, 1.0, foot + width, 0.0), "back"),
    ]
    return tunnel
