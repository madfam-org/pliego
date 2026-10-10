"""Folding-carton styles for :mod:`pliego.dieline` (thickness-compensated, inside dimensions).

One generator, :func:`carton`, with a top and a bottom closure. Panels run front · side ·
back · side with the glue flap on the last side (glued inside the front panel's free edge).

- ``style="straight-tuck"`` — tuck lids top and bottom, both hinged to the back panel;
- ``"reverse-tuck"`` — top tuck on the back panel, bottom tuck on the front panel;
- ``"seal-end"`` — four flaps at each end, the outer flap glued over the inner one;
- ``"crash-lock"`` — tuck top, auto (crash-lock) bottom: two major bottom flaps and two minor
  flaps with a diagonal crease whose triangle is glued to the neighbouring major flap;
- ``"snap-lock"`` — tuck top, 1-2-3 bottom: minor flap, major flap, minor flap folded in turn,
  then the front flap's tongue locks under them.

These are the common tuck/seal/auto-bottom families (the ECMA catalogue groups them); geometry
is generated from the rules here, not copied from any catalogue drawing.

**Compensation** (caliper t): panels between folds are inside + t; tuck lids are W + t deep;
the tuck tongue is 0.3·(W + t) (12–25 mm); dust flaps reach 0.6·(W + t) but never past half
the opening; the front panel's flaps are trimmed t (≥ 0.5 mm) at the free edge for clearance
against the glue flap. **Preview limits**: the glued crash-lock triangles and the
manufacturer's joint are glue zones (the engine welds them); the crash-lock's pop-open action
and the snap-lock's tongue friction need the physics engine. The diagonal crash-lock crease is
drawn but left flat by the erecting program (it folds only when the carton is knocked flat).
"""

from __future__ import annotations

import math

from .board import caliper as stock_caliper
from .dieline import Dieline, Packed
from .dieline_boxes import L4

STYLES = ("straight-tuck", "reverse-tuck", "seal-end", "crash-lock", "snap-lock")
PANELS = {
    "front": L4("Front", "Frente", "Face avant", "Frente"),
    "side-1": L4("Side 1", "Costado 1", "Côté 1", "Lateral 1"),
    "back": L4("Back", "Parte trasera", "Face arrière", "Traseira"),
    "side-2": L4("Side 2", "Costado 2", "Côté 2", "Lateral 2"),
}
PART = {
    "lid": L4("lid", "tapa", "couvercle", "tampa"),
    "tuck": L4("tuck flap", "lengüeta", "patte rentrante", "aba de encaixe"),
    "dust": L4("dust flap", "guardapolvo", "rabat anti-poussière", "aba guarda-pó"),
    "outer": L4("outer seal flap", "solapa exterior de sellado", "rabat extérieur à coller",
                "aba externa de colagem"),
    "inner": L4("inner seal flap", "solapa interior de sellado", "rabat intérieur",
                "aba interna"),
    "major": L4("bottom flap", "solapa de fondo", "rabat de fond", "aba do fundo"),
    "minor": L4("bottom flap with glue triangle", "solapa de fondo con triángulo de pegado",
                "rabat de fond à triangle collé", "aba do fundo com triângulo de colagem"),
}


def _lab(panel: str, part: str, end: str) -> dict:
    where = {"top": L4("top", "arriba", "haut", "em cima"),
             "bottom": L4("bottom", "abajo", "bas", "embaixo")}[end]
    return {k: f"{PANELS[panel][k]}: {PART[part][k]} ({where[k]})" for k in PANELS[panel]}


def carton(L: float, W: float, D: float, stock: str = "folding-boxboard-300", *,
           style: str = "reverse-tuck", glue: float = 15.0, window: bool = False,
           sheet_id: str = "carton", label=None) -> Packed:
    """A folding carton from inside dimensions (see the module docstring)."""
    if style not in STYLES:
        raise ValueError(f"style must be one of {STYLES}")
    for name, v in (("length", L), ("width", W), ("depth", D)):
        if not (math.isfinite(v) and 15.0 <= v <= 600.0):
            raise ValueError(f"inside {name} must be in [15, 600] mm, got {v}")
    if W > L:
        raise ValueError("inside width must not exceed inside length (W ≤ L)")
    t = stock_caliper(stock)
    Lp, Wp, Dp = L + t, W + t, D + t
    c = max(t, 0.5)                            # clearance trim
    tuck = min(max(0.3 * Wp, 12.0), 25.0)
    dust = min(0.6 * Wp, Lp / 2.0 - t)
    g = min(max(glue, 8.0), Wp * 0.9)
    bottom_h = {"straight-tuck": Wp + tuck, "reverse-tuck": Wp + tuck, "seal-end": Wp,
                "crash-lock": 0.62 * Wp, "snap-lock": 0.82 * Wp}[style]
    y0 = max(bottom_h, dust)
    y1 = y0 + Dp
    xs = {"front": (0.0, Lp), "side-1": (Lp, Lp + Wp), "back": (Lp + Wp, 2 * Lp + Wp),
          "side-2": (2 * Lp + Wp, 2 * Lp + 2 * Wp)}
    d = Dieline(sheet_id, f"{style} carton", "folding-carton",
                {"length": L, "width": W, "depth": D}, stock, t,
                label=label or L4("Folding carton", "Estuche plegadizo", "Étui pliant",
                                  "Cartucho dobrável"), grain_deg=90.0)
    for name, (xa, xb) in xs.items():
        d.rect(name, xa, y0, xb, y1, "panel", PANELS[name])
    xe = xs["side-2"][1]
    d.panel("glue-flap", [(xe, y0 + g * 0.4), (xe + g, y0 + g), (xe + g, y1 - g),
                          (xe, y1 - g * 0.4)], "glue-flap",
            L4("Glue flap", "Pestaña de pegado", "Patte de collage", "Aba de colagem"),
            print_area=False)
    d.glue_zone("manufacturers-joint", [(xe + 1.0, y0 + g), (xe + g - 1.0, y0 + g + 0.6),
                                        (xe + g - 1.0, y1 - g - 0.6), (xe + 1.0, y1 - g)],
                on="glue-flap")
    for a, b in (("front", "side-1"), ("side-1", "back"), ("back", "side-2")):
        d.hinge(a, b, -90.0, name=f"{a}-{b}-fold")
    d.hinge("side-2", "glue-flap", -90.0, name="glue-flap-fold")
    if window:
        m = max(8.0, 0.18 * min(Lp, Dp))
        d.hole([(m, y0 + m), (Lp - m, y0 + m), (Lp - m, y1 - m), (m, y1 - m)])
    steps: list[tuple[str, dict, list[str], int]] = []

    def trim(panel: str) -> tuple[float, float]:
        xa, xb = xs[panel]
        return (xa + c if panel == "front" else xa, xb)

    def sgn(end: str) -> tuple[float, float]:
        return (y1, 1.0) if end == "top" else (y0, -1.0)

    def tuck_end(panel: str, end: str) -> list[str]:
        base, s = sgn(end)
        xa, xb = trim(panel)
        lid, tk = f"{panel}-{end}-lid", f"{panel}-{end}-tuck"
        d.rect(lid, xa, min(base, base + s * Wp), xb, max(base, base + s * Wp), "lid",
               _lab(panel, "lid", end))
        e = base + s * Wp
        ch = min(tuck * 0.6, (xb - xa) * 0.15)
        d.panel(tk, [(xa, e), (xb, e), (xb - ch, e + s * tuck), (xa + ch, e + s * tuck)],
                "tuck", _lab(panel, "tuck", end))
        d.hinge(panel, lid, -90.0, name=f"{lid}-fold")
        d.hinge(lid, tk, -90.0, name=f"{tk}-fold")
        return [f"{lid}-fold", f"{tk}-fold"]

    def dust_flaps(end: str, depth: float) -> list[str]:
        base, s = sgn(end)
        out = []
        for panel in ("side-1", "side-2"):
            xa, xb = xs[panel]
            ch = min(depth * 0.5, Wp * 0.25)
            name = f"{panel}-{end}-dust"
            d.panel(name, [(xa, base), (xb, base), (xb - ch * 0.4, base + s * depth),
                           (xa + ch, base + s * depth)], "dust-flap", _lab(panel, "dust", end))
            d.hinge(panel, name, -90.0, name=f"{name}-fold")
            out.append(f"{name}-fold")
        return out

    def seal_end(end: str) -> tuple[list[str], list[str]]:
        base, s = sgn(end)
        dusts = dust_flaps(end, Wp / 2.0)
        inner_h, outer_h = Wp, 0.55 * Wp
        flaps = []
        for panel, h, part in (("back", inner_h, "inner"), ("front", outer_h, "outer")):
            xa, xb = trim(panel)
            name = f"{panel}-{end}-seal"
            d.rect(name, xa, min(base, base + s * h), xb, max(base, base + s * h), "flap",
                   _lab(panel, part, end))
            d.hinge(panel, name, -90.0, name=f"{name}-fold")
            flaps.append(f"{name}-fold")
            if part == "outer":
                e0, e1 = sorted((base + s * 3.0, base + s * (h - 2.0)))
                d.glue_zone(f"{end}-seal-glue", [(xa + 3.0, e0), (xb - 3.0, e0),
                                                 (xb - 3.0, e1), (xa + 3.0, e1)], on=name)
        return dusts, flaps

    labels = {
        "tube": L4("Fold the body into a tube and glue the joint",
                   "Dobla el cuerpo en un tubo y pega la unión",
                   "Pliez le corps en tube et collez la patte", "Dobre o corpo num tubo e cole"),
        "dust": L4("Fold in the {end} dust flaps", "Dobla hacia dentro los guardapolvos de {end}",
                   "Rabattez les rabats anti-poussière du {end}",
                   "Dobre para dentro as abas guarda-pó de {end}"),
        "close": L4("Close the {end}", "Cierra {end}", "Fermez le {end}", "Feche {end}"),
    }
    words = {"top": {"en": "top", "es": "arriba", "fr": "haut", "pt": "cima"},
             "bottom": {"en": "bottom", "es": "abajo", "fr": "bas", "pt": "baixo"}}
    ends_es = {"top": "la parte de arriba", "bottom": "el fondo"}

    def lab(kind: str, end: str) -> dict:
        out = {}
        for lang, text in labels[kind].items():
            w = ends_es[end] if (lang == "es" and kind == "close") else words[end][lang]
            out[lang] = text.replace("{end}", w)
        return out

    steps.append(("form-tube", labels["tube"], ["front-side-1-fold", "side-1-back-fold",
                                                "back-side-2-fold", "glue-flap-fold"], 1500))
    # bottom closure
    if style in ("straight-tuck", "reverse-tuck"):
        dusts = dust_flaps("bottom", dust)
        lid = tuck_end("back" if style == "straight-tuck" else "front", "bottom")
        steps += [("bottom-dust", lab("dust", "bottom"), dusts, 900),
                  ("bottom-close", lab("close", "bottom"), lid, 1200)]
    elif style == "seal-end":
        dusts, flaps = seal_end("bottom")
        steps += [("bottom-dust", lab("dust", "bottom"), dusts, 900),
                  ("bottom-close", lab("close", "bottom"), flaps, 1200)]
    elif style == "crash-lock":
        majors, minors = [], []
        for panel in ("front", "back"):
            xa, xb = trim(panel)
            name = f"{panel}-bottom-major"
            h = 0.62 * Wp
            d.rect(name, xa, y0 - h, xb, y0, "bottom", _lab(panel, "major", "bottom"))
            d.hinge(panel, name, -90.0, name=f"{name}-fold")
            majors.append(f"{name}-fold")
        for panel, neighbour in (("side-1", "back"), ("side-2", "front")):
            xa, xb = xs[panel]
            h = Wp / 2.0
            name = f"{panel}-bottom-minor"
            tri = f"{panel}-glue-triangle"
            # the diagonal runs at 45° from the corner next to the neighbouring panel, inset by
            # the clearance so the glue triangle never shares an edge with that panel's flap
            hh = h - c
            if neighbour == "back":
                x_c, sx = xb - c, -1.0
            else:
                x_c, sx = xa + c, 1.0
            far = (x_c + sx * hh, y0 - hh)
            other = (xa + 0.2 * h, y0 - hh) if neighbour == "back" else (xb - 0.2 * h, y0 - hh)
            poly = ([(xa, y0), (x_c, y0), far, other] if neighbour == "back"
                    else [(x_c, y0), (xb, y0), other, far])
            d.panel(name, poly, "bottom", _lab(panel, "minor", "bottom"))
            d.panel(tri, [(x_c, y0), (x_c, y0 - hh), far], "bottom",
                    _lab(panel, "minor", "bottom"), print_area=False)
            d.hinge(panel, name, -90.0, name=f"{name}-fold")
            d.hinge(name, tri, -180.0, name=f"{tri}-fold", driven=False)
            minors.append(f"{name}-fold")
            tp = d.panels[tri].polygon
            cx, cy = (sum(p[0] for p in tp) / 3.0, sum(p[1] for p in tp) / 3.0)
            d.glue_zone(f"{panel}-crash-glue", [((x - cx) * 0.7 + cx, (y - cy) * 0.7 + cy)
                                                for x, y in tp], on=tri)
        steps += [("bottom-minor", lab("dust", "bottom"), minors, 900),
                  ("bottom-close", lab("close", "bottom"), majors, 1200)]
    else:                                              # snap-lock (1-2-3)
        h_minor, h_major = Wp / 2.0, 0.7 * Wp
        order = []
        for panel, kind, h in (("side-1", "minor", h_minor), ("back", "major", h_major),
                               ("side-2", "minor", h_minor)):
            xa, xb = trim(panel)
            name = f"{panel}-bottom-{len(order) + 1}"
            ch = min(h * 0.5, (xb - xa) * 0.2)
            d.panel(name, [(xa, y0), (xb, y0), (xb - ch, y0 - h), (xa + ch, y0 - h)], "bottom",
                    _lab(panel, "major" if kind == "major" else "dust", "bottom"))
            d.hinge(panel, name, -90.0, name=f"{name}-fold")
            order.append(f"{name}-fold")
        xa, xb = trim("front")
        tongue = (xb - xa) / 3.0
        h = h_major
        name = "front-bottom-4"
        d.panel(name, [(xa, y0), (xb, y0), (xb, y0 - h), (xa + 2 * tongue, y0 - h),
                       (xa + 2 * tongue - 2.0, y0 - h - 0.12 * Wp),
                       (xa + tongue + 2.0, y0 - h - 0.12 * Wp), (xa + tongue, y0 - h),
                       (xa, y0 - h)], "lock", _lab("front", "major", "bottom"))
        d.hinge("front", name, -90.0, name=f"{name}-fold")
        steps += [(f"bottom-{k + 1}", L4(f"Fold bottom flap {k + 1}",
                                         f"Dobla la solapa de fondo {k + 1}",
                                         f"Rabattez le rabat de fond {k + 1}",
                                         f"Dobre a aba do fundo {k + 1}"), [h_], 800)
                  for k, h_ in enumerate(order)]
        steps.append(("bottom-lock", L4("Lock the front flap's tongue under the others",
                                        "Traba la lengüeta de la solapa frontal bajo las demás",
                                        "Glissez la languette du rabat avant sous les autres",
                                        "Trave a lingueta da aba frontal sob as outras"),
                      [f"{name}-fold"], 1000))
    # top closure
    if style == "seal-end":
        dusts, flaps = seal_end("top")
        steps += [("top-dust", lab("dust", "top"), dusts, 900),
                  ("top-close", lab("close", "top"), flaps, 1200)]
    else:
        dusts = dust_flaps("top", dust)
        lid = tuck_end("back", "top")
        steps += [("top-dust", lab("dust", "top"), dusts, 900),
                  ("top-close", lab("close", "top"), lid, 1200)]
    for sid, label_, hinges, ms in steps:
        d.step(sid, label_, hinges, ms)
    d.dimension((0.0, y0), (Lp, y0), f"L {L:g} (inside)", -6.0)
    d.dimension((Lp, y0), (Lp + Wp, y0), f"W {W:g} (inside)", -6.0)
    d.dimension((0.0, y0), (0.0, y1), f"D {D:g} (inside)", 8.0)
    return d.build(rest_on="front")
