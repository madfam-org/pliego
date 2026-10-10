"""The ``dieline`` export profile: named layers and spot colours for packaging prepress.

A sheet document that carries ``pliego:dielines`` or ``pliego:finishes`` (spec §5.8–§5.10)
exports through this profile by default (``to_svg`` / ``to_dxf`` / ``to_pdf`` with
``profile=None``); ``profile="default"`` forces the plain fabrication layers. Layers, in drawing
order, each with a spot colour (name, CMYK alternate, RGB preview, DXF ACI):

Artwork · Bleed · Safe area · Glue · Crease · Perforation · Half-cut · Cut (``CutContour``) ·
the finish plates (emboss die/counter, deboss die/counter, foil, varnish, letterpress, branding
iron, engrave vector/raster) · Dimensions · Panel labels · Grain/flute arrow.

``CutContour`` is the conventional spot name print-and-cut RIPs look for; every other name here
is a plain, descriptive spot — converters keep their own lists, so confirm names with the shop.
Spot colours are real PDF ``/Separation`` colour spaces and every layer is a PDF optional content
group (named layer). Bleed is drawn only where a printed panel meets a cut edge; the safe area is
each printed panel inset by ``safe_mm``. Coordinates: layout frame, mm.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .plan import Point, as_document, build_plan, perforation_dashes

# layer → (spot name, CMYK alternate, RGB hex, DXF layer, ACI, stroke mm)
SPOTS: dict[str, tuple[str, tuple[float, float, float, float], str, str, int, float]] = {
    "Artwork": ("Artwork frame", (0, 0, 0, 0.3), "#9a9a9a", "Artwork", 8, 0.15),
    "Bleed": ("Bleed", (0, 0, 0, 0.45), "#8c8c8c", "Bleed", 8, 0.2),
    "Safe area": ("Safe area", (0.7, 0.2, 0, 0), "#3b8fd9", "Safe-area", 5, 0.2),
    "Glue": ("Glue", (0, 0, 1, 0), "#f2d600", "Glue", 2, 0.25),
    "Crease": ("Crease", (1, 0, 0, 0), "#00a5e3", "Crease", 4, 0.3),
    "Perforation": ("Perforation", (0, 0.55, 1, 0), "#f39200", "Perforation", 30, 0.3),
    "Half-cut": ("Half-cut", (0.6, 0, 1, 0), "#7ab51d", "Half-cut", 3, 0.3),
    "Cut": ("CutContour", (0, 1, 0, 0), "#e6007e", "CutContour", 6, 0.3),
    "Emboss die (female)": ("Emboss die", (0.5, 0.9, 0, 0), "#8e3a96", "Emboss-die-female", 200,
                            0.25),
    "Emboss counter (male)": ("Emboss counter", (0.3, 0.6, 0, 0), "#b07cc6",
                              "Emboss-counter-male", 202, 0.25),
    "Deboss die (male)": ("Deboss die", (0.9, 0.7, 0, 0), "#2d4b9b", "Deboss-die-male", 170,
                          0.25),
    "Deboss counter (female)": ("Deboss counter", (0.6, 0.4, 0, 0), "#6f8cc9",
                                "Deboss-counter-female", 172, 0.25),
    "Foil plate": ("Foil", (0, 0.25, 0.9, 0.15), "#c9a227", "Foil-plate", 42, 0.25),
    "Varnish plate": ("Varnish", (0.2, 0, 0.1, 0), "#a9d8c8", "Varnish-plate", 121, 0.25),
    "Letterpress plate": ("Letterpress", (0.9, 0.6, 0, 0.5), "#1d2a44", "Letterpress-plate", 178,
                          0.25),
    "Branding iron face": ("Branding iron", (0, 0.6, 1, 0.6), "#5a2d0c", "Branding-iron", 24,
                           0.25),
    "Engrave (vector)": ("Engrave vector", (0, 0.9, 1, 0.3), "#b52a1c", "Engrave-vector", 1,
                         0.2),
    "Engrave (raster)": ("Engrave raster", (0, 0.7, 0.9, 0.5), "#6b2a12", "Engrave-raster", 14,
                         0.1),
    "Dimensions": ("Dimensions", (0, 0, 0, 1), "#1a1a1a", "Dimensions", 7, 0.15),
    "Panel labels": ("Panel labels", (0, 0, 0, 0.7), "#4d4d4d", "Panel-labels", 7, 0.0),
    "Grain/flute arrow": ("Grain arrow", (0.5, 0.5, 0, 0.3), "#5b5b8f", "Grain-arrow", 7, 0.25),
}
ORDER = tuple(SPOTS)
TEXT_MM = 3.5
ARROW_MM = 30.0


@dataclass
class Layer:
    polylines: list[tuple[tuple[Point, ...], bool]] = field(default_factory=list)
    texts: list[tuple[Point, str, float]] = field(default_factory=list)   # at, text, size
    # href, lower-left, size, rotation
    images: list[tuple[str, Point, Point, float]] = field(default_factory=list)


@dataclass
class DielinePlan:
    title: str
    layers: dict[str, Layer]
    bounds: tuple[float, float, float, float]
    notes: list[str]

    def canvas(self, pad: float = 15.0) -> tuple[float, float, float, float]:
        x0, y0, x1, y1 = self.bounds
        return (x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad)


def wants_dieline(doc: Any) -> bool:
    d = as_document(doc)
    return bool(d.get("pliego:dielines") or d.get("pliego:finishes"))


def resolve_profile(doc: Any, profile: str | None) -> str:
    if profile is None:
        return "dieline" if wants_dieline(doc) else "default"
    if profile not in ("default", "dieline"):
        raise ValueError(f"unknown export profile {profile!r} (default | dieline)")
    return profile


def _moved(a: list, b: list, pa: list, pb: list) -> bool:
    mx, my = (a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0
    dx, dy = pb[0] - pa[0], pb[1] - pa[1]
    ln = math.hypot(dx, dy) or 1.0
    return abs((mx - pa[0]) * dy - (my - pa[1]) * dx) / ln > 1e-3


def build(doc: Any) -> DielinePlan:
    """Reduce a document to dieline layers (layout frame, mm)."""
    from ..press import hatch, plates

    d = as_document(doc)
    base = build_plan(d)
    sheets = d.get("pliego:sheets") or []
    offsets = {s["id"]: tuple((s.get("offset") or [0.0, 0.0])[:2]) for s in sheets}
    layers = {name: Layer() for name in ORDER}

    def g(sheet: str, p: list | tuple) -> Point:
        ox, oy = offsets.get(sheet, (0.0, 0.0))
        return (float(p[0]) + ox, float(p[1]) + oy)

    for s in base.strokes:
        if s.layer == "cut":
            layers["Cut"].polylines.append((s.points, s.closed))
        elif s.layer in ("mountain", "valley") or (s.layer == "score" and s.kind != "halfcut"):
            layers["Crease"].polylines.append((s.points, s.closed))
        elif s.kind == "halfcut":
            layers["Half-cut"].polylines.append((s.points, s.closed))
        elif s.layer == "perforation":
            for a, b in perforation_dashes(s.points, s.closed, base.perf_factor[s.sheet]):
                layers["Perforation"].polylines.append(((a, b), False))
    for gl in base.glue:
        layers["Glue"].polylines.append((gl.points, True))
    notes = []
    calipers = {}
    for dl in d.get("pliego:dielines") or []:
        sid = dl["sheet"]
        calipers[sid] = float(dl.get("caliper_mm", 0.0))
        for pn in dl.get("panels") or []:
            poly = pn["polygon"]
            if pn.get("print") and "bleed" in pn:
                bl = pn["bleed"]
                n = len(bl)
                for i in range(n):
                    if _moved(bl[i], bl[(i + 1) % n], poly[i], poly[(i + 1) % n]):
                        layers["Bleed"].polylines.append(((g(sid, bl[i]), g(sid, bl[(i + 1) % n])),
                                                          False))
            if pn.get("print") and "safe" in pn:
                layers["Safe area"].polylines.append((tuple(g(sid, q) for q in pn["safe"]), True))
            xs, ys = [q[0] for q in poly], [q[1] for q in poly]
            label = (pn.get("label") or {}).get("en") or pn["name"]
            layers["Panel labels"].texts.append(
                (g(sid, (sum(xs) / len(xs), sum(ys) / len(ys))), label, TEXT_MM))
        for gz in dl.get("glue") or []:
            layers["Glue"].polylines.append((tuple(g(sid, q) for q in gz["polygon"]), True))
        for dim in dl.get("dimensions") or []:
            _dimension(layers["Dimensions"], g(sid, dim["from"]), g(sid, dim["to"]),
                       float(dim.get("offset", 8.0)), str(dim["text"]))
        gr = dl.get("grain")
        if gr:
            _arrow(layers["Grain/flute arrow"], g(sid, gr["at"]), float(gr["angle_deg"]),
                   "FLUTE DIRECTION" if gr.get("kind") == "flute" else "GRAIN (MD)")
        inside = dl.get("inside") or {}
        keys = [k for k in ("length", "width", "depth", "height") if k in inside]
        keys += sorted(k for k in inside if k not in keys)
        dims = " x ".join(f"{inside[k]:g}" for k in keys)
        notes.append(f"{dl.get('style', 'dieline')}: inside {dims} mm "
                     f"({' x '.join(keys)}), caliper {dl.get('caliper_mm', 0):g} mm, "
                     f"bleed {dl.get('bleed_mm', 0):g} mm, safe {dl.get('safe_mm', 0):g} mm")
    for f in d.get("pliego:finishes") or []:
        sid = f["sheet"]
        for name, polys, mode in plates(f, calipers.get(sid, _caliper(d, sid))):
            lay = layers[name]
            for poly in polys:
                lay.polylines.append((tuple(g(sid, q) for q in poly), True))
            if mode == "raster":
                for a, b in hatch(polys):
                    lay.polylines.append(((g(sid, a), g(sid, b)), False))
        notes.append(f"{f['kind']} '{f['id']}' on the {f['side']} of {sid}: depth "
                     f"{f.get('depth_mm', 0):g} mm" + (f", {f['process']}" if "process" in f
                                                       else ""))
    for a in d.get("pliego:artwork") or []:
        sid = a["sheet"]
        lo = g(sid, a["at"])
        w, h = a["size"]
        layers["Artwork"].images.append((a["asset"], lo, (w, h), float(a.get("rotation_deg", 0))))
        layers["Artwork"].polylines.append(((lo, (lo[0] + w, lo[1]), (lo[0] + w, lo[1] + h),
                                             (lo[0], lo[1] + h)), True))
    xs = [p[0] for lay in layers.values() for pl, _ in lay.polylines for p in pl]
    ys = [p[1] for lay in layers.values() for pl, _ in lay.polylines for p in pl]
    xs += [t[0][0] for lay in layers.values() for t in lay.texts]
    ys += [t[0][1] for lay in layers.values() for t in lay.texts]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    title_at = (x0, y1 + 10.0)
    for k, line in enumerate([base.title] + notes):
        layers["Dimensions"].texts.append(((title_at[0], title_at[1] + 5.0 * (len(notes) - k)),
                                           line, TEXT_MM))
    return DielinePlan(base.title, layers, (x0, y0, x1, y1 + 15.0 + 5.0 * len(notes)), notes)


def _caliper(d: dict, sid: str) -> float:
    for s in d.get("pliego:sheets") or []:
        if s["id"] == sid:
            snap = (d.get("pliego:stocks") or {}).get(s["stock"]) or {}
            return float((snap.get("derived") or {}).get("thickness", 0.1))
    return 0.1


def _dimension(lay: Layer, a: Point, b: Point, offset: float, text: str) -> None:
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / ln * offset, dx / ln * offset
    pa, pb = (a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny)
    lay.polylines += [((pa, pb), False), ((a, (pa[0] + nx * 0.2, pa[1] + ny * 0.2)), False),
                      ((b, (pb[0] + nx * 0.2, pb[1] + ny * 0.2)), False)]
    tick = 1.5
    for p in (pa, pb):
        lay.polylines.append((((p[0] - (dx + dy) / ln * tick, p[1] - (dy - dx) / ln * tick),
                               (p[0] + (dx + dy) / ln * tick, p[1] + (dy - dx) / ln * tick)),
                              False))
    lay.texts.append((((pa[0] + pb[0]) / 2.0 + nx * 0.25, (pa[1] + pb[1]) / 2.0 + ny * 0.25),
                      text, TEXT_MM))


def _arrow(lay: Layer, at: Point, angle_deg: float, text: str) -> None:
    a = math.radians(angle_deg)
    ux, uy = math.cos(a), math.sin(a)
    tail = (at[0] - ux * ARROW_MM / 2, at[1] - uy * ARROW_MM / 2)
    tip = (at[0] + ux * ARROW_MM / 2, at[1] + uy * ARROW_MM / 2)
    head = 4.0
    lay.polylines += [((tail, tip), False),
                      ((tip, (tip[0] - head * (ux - uy * 0.5), tip[1] - head * (uy + ux * 0.5))),
                       False),
                      ((tip, (tip[0] - head * (ux + uy * 0.5), tip[1] - head * (uy - ux * 0.5))),
                       False)]
    lay.texts.append(((tip[0] + 2.0, tip[1] - 1.5), text, TEXT_MM * 0.8))


# ── SVG ──────────────────────────────────────────────────────────────────────

def _esc(text: str) -> str:
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def _f(x: float) -> str:
    s = f"{x:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def to_svg(doc: Any) -> str:
    plan = build(doc)
    ox, oy, w, h = plan.canvas()

    def xy(p: Point) -> str:
        return f"{_f(p[0] - ox)},{_f(h - (p[1] - oy))}"

    body = []
    for name in ORDER:
        lay = plan.layers[name]
        if not (lay.polylines or lay.texts or lay.images):
            continue
        spot, cmyk, rgb, _dxf, _aci, width = SPOTS[name]
        lid = name.lower().replace(" ", "-").replace("/", "-").replace("(", "").replace(")", "")
        attrs = (f'id="{lid}" inkscape:groupmode="layer" inkscape:label="{_esc(name)}" '
                 f'data-spot="{_esc(spot)}" data-cmyk="{",".join(_f(c) for c in cmyk)}"')
        parts = []
        for href, lo, (iw, ih), rot in lay.images:
            cx, cy = lo[0] + iw / 2, lo[1] + ih / 2
            tr = f' transform="rotate({_f(-rot)} {xy((cx, cy)).replace(",", " ")})"' if rot else ""
            parts.append(f'<image href="{_esc(href)}" x="{_f(lo[0] - ox)}" '
                         f'y="{_f(h - (lo[1] + ih - oy))}" width="{_f(iw)}" height="{_f(ih)}" '
                         f'preserveAspectRatio="xMidYMid meet"{tr}/>')
        for pts, closed in lay.polylines:
            tag = "polygon" if closed else "polyline"
            parts.append(f'<{tag} points="{" ".join(xy(p) for p in pts)}"/>')
        for at, text, size in lay.texts:
            parts.append(f'<text x="{_f(at[0] - ox)}" y="{_f(h - (at[1] - oy))}" '
                         f'font-size="{_f(size)}" stroke="none" fill="{rgb}">{_esc(text)}</text>')
        fill = "url(#glue-hatch)" if name == "Glue" else "none"
        body.append(f'<g {attrs} fill="{fill}" stroke="{rgb}" stroke-width="{_f(width)}" '
                    f'stroke-linecap="round" stroke-linejoin="round" '
                    f'font-family="Helvetica, Arial, sans-serif">' + "".join(parts) + "</g>")
    defs = ('<defs><pattern id="glue-hatch" patternUnits="userSpaceOnUse" width="2" height="2" '
            'patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2" stroke="#f2d600" '
            'stroke-width="0.4"/></pattern></defs>')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<svg xmlns="http://www.w3.org/2000/svg" '
            'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" '
            f'width="{_f(w)}mm" height="{_f(h)}mm" viewBox="0 0 {_f(w)} {_f(h)}" '
            f'data-profile="dieline"><title>{_esc(plan.title)}</title>' + defs + "".join(body)
            + "</svg>\n")


# ── DXF ──────────────────────────────────────────────────────────────────────

def to_dxf(doc: Any) -> str:
    from .dxf import _ascii, _line, _n, _polyline, _tag

    plan = build(doc)
    x0, y0, x1, y1 = plan.bounds
    used = [n for n in ORDER if plan.layers[n].polylines or plan.layers[n].texts]
    header = (_tag(0, "SECTION") + _tag(2, "HEADER") + _tag(9, "$ACADVER") + _tag(1, "AC1009")
              + _tag(9, "$INSUNITS") + _tag(70, 4)
              + _tag(9, "$EXTMIN") + _tag(10, _n(x0)) + _tag(20, _n(y0)) + _tag(30, _n(0))
              + _tag(9, "$EXTMAX") + _tag(10, _n(x1)) + _tag(20, _n(y1)) + _tag(30, _n(0))
              + _tag(0, "ENDSEC"))
    ltype = (_tag(0, "LTYPE") + _tag(2, "CONTINUOUS") + _tag(70, 0) + _tag(3, "Solid line")
             + _tag(72, 65) + _tag(73, 0) + _tag(40, _n(0)))
    lays = "".join(_tag(0, "LAYER") + _tag(2, SPOTS[n][3]) + _tag(70, 0) + _tag(62, SPOTS[n][4])
                   + _tag(6, "CONTINUOUS") for n in used)
    tables = (_tag(0, "SECTION") + _tag(2, "TABLES")
              + _tag(0, "TABLE") + _tag(2, "LTYPE") + _tag(70, 1) + ltype + _tag(0, "ENDTAB")
              + _tag(0, "TABLE") + _tag(2, "LAYER") + _tag(70, len(used)) + lays
              + _tag(0, "ENDTAB") + _tag(0, "ENDSEC"))
    ents = _tag(0, "SECTION") + _tag(2, "ENTITIES")
    for name in used:
        layer = SPOTS[name][3]
        for pts, closed in plan.layers[name].polylines:
            if len(pts) == 2 and not closed:
                ents += _line(layer, pts[0], pts[1])
            else:
                ents += _polyline(layer, pts, closed)
        for at, text, size in plan.layers[name].texts:
            ents += (_tag(0, "TEXT") + _tag(8, layer) + _tag(10, _n(at[0])) + _tag(20, _n(at[1]))
                     + _tag(30, _n(0)) + _tag(40, _n(size)) + _tag(1, _ascii(text)))
    ents += _tag(0, "ENDSEC")
    return header + tables + ents + _tag(0, "EOF")
