# Adapted from Fashion Cabinet fc/export/svg.py (AGPL-3.0, Innovaciones MADFAM), for sheet layers.
"""Layered SVG export of a sheet document (mm units, viewBox in mm).

Layers (``<g>`` with ``id`` and an Inkscape layer label, in drawing order): ``art``, ``glue``,
``score``, ``perforation``, ``mountain``, ``valley``, ``cut``, ``registration``, ``label``.
Styles are presentation attributes on each layer group (laser and cutter software read those more
reliably than CSS). Palettes:

- ``diagram`` — origami diagram convention: valley dashed, mountain dash-dot, cut solid, glue
  tabs hatched;
- ``lightburn`` — one distinct solid colour per line type, so LightBurn creates one layer (one
  power/speed setting) per type on import; mountain/valley are solid (the machine scores them);
- ``cricut`` — one distinct solid colour per line type; Design Space imports each colour as its
  own layer, where the operation (cut / score / draw) is assigned by the user.

Colour conventions differ per shop; the palettes are starting points, not vendor-certified
profiles. Perforations are emitted as explicit cut dashes (no dasharray), so every machine cuts
the same pattern. SVG is y-down: the layout frame (y-up) is flipped against the canvas height.
"""

from __future__ import annotations

from typing import Any

from .plan import Plan, build_plan, fmt, perforation_dashes, registration_marks

# layer → (stroke, stroke-width mm, dasharray | None)
PALETTES: dict[str, dict[str, tuple[str, float, str | None]]] = {
    "diagram": {
        "cut": ("#1a1a1a", 0.4, None),
        "mountain": ("#c0392b", 0.3, "6 1.5 1 1.5"),
        "valley": ("#2e6fd8", 0.3, "3 1.5"),
        "score": ("#7f8c8d", 0.25, None),
        "perforation": ("#1a1a1a", 0.3, None),
        "glue": ("#27ae60", 0.2, "1 1"),
        "registration": ("#000000", 0.5, None),
        "label": ("#1a1a1a", 0.0, None),
        "pages": ("#9e9e9e", 0.2, "4 3"),
    },
    "lightburn": {
        "cut": ("#000000", 0.1, None),
        "mountain": ("#ff0000", 0.1, None),
        "valley": ("#00e000", 0.1, None),
        "score": ("#0000ff", 0.1, None),
        "perforation": ("#ff8000", 0.1, None),
        "glue": ("#00e0e0", 0.1, None),
        "registration": ("#ff00ff", 0.1, None),
        "label": ("#d0d000", 0.0, None),
        "pages": ("#808080", 0.1, "4 3"),
    },
    "cricut": {
        "cut": ("#000000", 0.25, None),
        "mountain": ("#e53935", 0.25, None),
        "valley": ("#43a047", 0.25, None),
        "score": ("#1e88e5", 0.25, None),
        "perforation": ("#fb8c00", 0.25, None),
        "glue": ("#9e9e9e", 0.25, None),
        "registration": ("#000000", 0.25, None),
        "label": ("#616161", 0.0, None),
        "pages": ("#bdbdbd", 0.25, "4 3"),
    },
}

LAYER_ORDER = ("pages", "art", "glue", "score", "perforation", "mountain", "valley", "cut",
               "registration", "label")


def _esc(text: str) -> str:
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


class _Canvas:
    def __init__(self, plan: Plan) -> None:
        self.ox, self.oy, self.w, self.h = plan.canvas()

    def xy(self, p: tuple[float, float]) -> str:
        return f"{fmt(p[0] - self.ox)},{fmt(self.h - (p[1] - self.oy))}"

    def x(self, v: float) -> str:
        return fmt(v - self.ox)

    def y(self, v: float) -> str:
        return fmt(self.h - (v - self.oy))


def _group(layer: str, palette: dict[str, tuple[str, float, str | None]], body: list[str],
           fill: str = "none") -> str:
    stroke, width, dash = palette[layer]
    attrs = f'id="{layer}" inkscape:groupmode="layer" inkscape:label="{layer}"'
    if layer == "label":
        attrs += f' fill="{stroke}" font-family="Helvetica, Arial, sans-serif" font-size="4"'
    else:
        attrs += f' fill="{fill}" stroke="{stroke}" stroke-width="{fmt(width)}"'
        attrs += ' stroke-linecap="round" stroke-linejoin="round"'
        if dash:
            attrs += f' stroke-dasharray="{dash}"'
    return f"<g {attrs}>" + "".join(body) + "</g>"


def _poly(c: _Canvas, pts: tuple[tuple[float, float], ...], closed: bool, extra: str = "") -> str:
    tag = "polygon" if closed else "polyline"
    return f'<{tag}{extra} points="{" ".join(c.xy(p) for p in pts)}"/>'


def to_svg(doc: Any, palette: str = "diagram", registration: bool = True,
           labels: bool = True, profile: str | None = None) -> str:
    """Render a sheet document to a standalone layered SVG (mm). ``profile``: ``None`` picks
    the dieline profile for documents with packaging blocks (``export.dieline``), else these
    fabrication layers; ``"default"`` / ``"dieline"`` force one."""
    from .dieline import resolve_profile

    if resolve_profile(doc, profile) == "dieline":
        from .dieline import to_svg as dieline_svg

        return dieline_svg(doc)
    if palette not in PALETTES:
        raise ValueError(f"unknown palette '{palette}' ({' | '.join(PALETTES)})")
    pal = PALETTES[palette]
    plan = build_plan(doc)
    c = _Canvas(plan)
    layers: dict[str, list[str]] = {name: [] for name in LAYER_ORDER}

    for art in plan.art:
        layers["art"].append(
            f'<image href="{_esc(art.href)}" x="{c.x(art.lo[0])}" y="{c.y(art.hi[1])}" '
            f'width="{fmt(art.hi[0] - art.lo[0])}" height="{fmt(art.hi[1] - art.lo[1])}" '
            f'preserveAspectRatio="none" data-sheet="{art.sheet}"/>'
        )
    for g in plan.glue:
        layers["glue"].append(_poly(c, g.points, True, f' data-join="{_esc(g.join)}"'))
    for s in plan.strokes:
        extra = f' data-sheet="{s.sheet}" data-kind="{s.kind}"'
        if s.layer == "perforation":
            for a, b in perforation_dashes(s.points, s.closed, plan.perf_factor[s.sheet]):
                layers["perforation"].append(
                    f'<line{extra} x1="{c.x(a[0])}" y1="{c.y(a[1])}" '
                    f'x2="{c.x(b[0])}" y2="{c.y(b[1])}"/>'
                )
        else:
            layers[s.layer].append(_poly(c, s.points, s.closed, extra))
    if registration:
        squares, corners = registration_marks(plan)
        stroke = pal["registration"][0]
        for sq in squares:
            layers["registration"].append(_poly(c, sq, True, f' fill="{stroke}"'))
        for corner in corners:
            layers["registration"].append(_poly(c, corner, False))
    if labels:
        for lb in plan.labels:
            if lb.size is None:
                layers["label"].append(
                    f'<text x="{c.x(lb.at[0])}" y="{c.y(lb.at[1])}">{_esc(lb.text)}</text>'
                )
                continue
            x, y = c.x(lb.at[0]), c.y(lb.at[1])
            turn = f' transform="rotate({fmt(-lb.angle)} {x} {y})"' if lb.angle else ""
            layers["label"].append(
                f'<text x="{x}" y="{y}" font-size="{fmt(lb.size / 0.72)}" '
                f'text-anchor="middle" dominant-baseline="central"{turn}>{_esc(lb.text)}</text>'
            )
    if plan.pages:
        w, h = plan.page_size
        for _pid, x, y in plan.pages:
            layers["pages"].append(_poly(c, ((x, y), (x + w, y), (x + w, y + h), (x, y + h)),
                                         True))

    defs = ""
    glue_fill = "none"
    if palette == "diagram":
        defs = (
            '<defs><pattern id="glue-hatch" patternUnits="userSpaceOnUse" width="2" height="2" '
            'patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2" stroke="#27ae60" '
            'stroke-width="0.3"/></pattern></defs>'
        )
        glue_fill = "url(#glue-hatch)"
    body = []
    for name in LAYER_ORDER:
        if not layers[name]:
            continue
        if name == "art":
            body.append('<g id="art" inkscape:groupmode="layer" inkscape:label="art">'
                        + "".join(layers["art"]) + "</g>")
        else:
            body.append(_group(name, pal, layers[name], glue_fill if name == "glue" else "none"))
    w, h = fmt(c.w), fmt(c.h)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" '
        'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" '
        f'width="{w}mm" height="{h}mm" viewBox="0 0 {w} {h}" data-palette="{palette}">'
        f"<title>{_esc(plan.title)}</title>" + defs + "".join(body) + "</svg>\n"
    )
