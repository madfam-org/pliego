"""Envelopes: styles × sizes → a die-cut blank, its gum or peel-and-seal zones and fold program.

Built on :mod:`pliego.dieline` (family ``envelope``): the central panel is the envelope's
**front** (the address side, the sheet's print side); side flaps, bottom flap and seal flap fold
behind it (mountain, 180°) to make the back. The sheet is placed print side down, so the flaps
fold up off the table, the way an envelope is folded by hand.

Sizes are **finished** (outside) sizes: ISO 269 C4 229 × 324, C5 162 × 229, C6 114 × 162,
DL 110 × 220 mm; US #10 4⅛ × 9½ in, A2 4⅜ × 5¾ in, A7 5¼ × 7¼ in (US sizes converted at
25.4 mm/in). The front panel is the size less the caliper (a 180° fold adds about t). Styles:

- ``commercial`` — side flaps, a bottom flap glued over them, a seal flap with a shallow point;
- ``baronial`` — the same seams with a deep pointed seal flap (A-sizes are the usual home);
- ``square`` — a square front (the size's height on both sides) with a pointed flap;
- ``wallet`` — a deep straight seal flap across the long edge;
- ``catalog`` / ``pocket`` — open on the short edge (deep / shallow seal flap there);
- ``diamond`` — four triangular flaps meeting near the centre;
- ``window`` — commercial with a die-cut window in the front (about 90 × 45 mm, 20 mm from the
  left and 15 mm from the bottom — a common DL placement [E]) and a glue frame for the film.

Seams vary between converters (side seam, centre seam, diagonal seam); these blanks use side
seams. ``seal="gum"`` marks a remoistenable gum strip, ``"peel-and-seal"`` a pressure-sensitive
strip under a release liner (the liner is not modelled).
"""

from __future__ import annotations

from .board import caliper as stock_caliper
from .dieline import Dieline, Packed
from .dieline_boxes import L4

IN = 25.4
SIZES: dict[str, tuple[float, float]] = {        # finished size, long × short (mm)
    "c4": (324.0, 229.0), "c5": (229.0, 162.0), "c6": (162.0, 114.0), "dl": (220.0, 110.0),
    "us-10": (9.5 * IN, 4.125 * IN), "a2": (5.75 * IN, 4.375 * IN),
    "a7": (7.25 * IN, 5.25 * IN),
}
STYLES = ("commercial", "baronial", "square", "wallet", "catalog", "pocket", "diamond",
          "window")
SEALS = ("gum", "peel-and-seal")
NAMES = {
    "front": L4("Front (address side)", "Frente (lado de la dirección)",
                "Recto (côté adresse)", "Frente (lado do endereço)"),
    "seal-flap": L4("Seal flap", "Solapa de cierre", "Rabat de fermeture", "Aba de fecho"),
    "bottom-flap": L4("Bottom flap", "Solapa inferior", "Rabat inférieur", "Aba inferior"),
    "side-flap-1": L4("Side flap 1", "Solapa lateral 1", "Rabat latéral 1", "Aba lateral 1"),
    "side-flap-2": L4("Side flap 2", "Solapa lateral 2", "Rabat latéral 2", "Aba lateral 2"),
}


def envelope(style: str = "commercial", size: str = "dl", stock: str = "copy-80", *,
             seal: str = "gum", sheet_id: str = "envelope", label=None) -> Packed:
    """An envelope blank (see the module docstring)."""
    if style not in STYLES:
        raise ValueError(f"style must be one of {STYLES}")
    if size not in SIZES:
        raise ValueError(f"size must be one of {tuple(SIZES)}")
    if seal not in SEALS:
        raise ValueError(f"seal must be one of {SEALS}")
    t = stock_caliper(stock)
    long_, short = SIZES[size]
    if style in ("catalog", "pocket"):
        W, H = short, long_                   # open on the short edge (top)
    elif style == "square":
        W = H = short
    else:
        W, H = long_, short
    w, h = W - t, H - t
    c = max(1.0, 3 * t)                       # corner clearance between flaps
    d = Dieline(sheet_id, f"{style} envelope", "envelope",
                {"width": round(W, 3), "height": round(H, 3)}, stock, t,
                label=label or L4("Envelope", "Sobre", "Enveloppe", "Envelope"),
                grain_deg=90.0)
    # front panel, lower-left at (side, bottom)
    side = {"diamond": 0.52 * w}.get(style, min(0.22 * w, 0.42 * h, 40.0))
    bottom = {"diamond": 0.62 * h, "catalog": 0.45 * h, "pocket": 0.45 * h}.get(style, 0.6 * h)
    seal_depth = {"commercial": 0.42, "window": 0.42, "baronial": 0.62, "square": 0.6,
                  "wallet": 0.55, "catalog": 0.22, "pocket": 0.12, "diamond": 0.62}[style] * h
    if style in ("catalog", "pocket"):
        seal_depth = {"catalog": 0.33, "pocket": 0.22}[style] * w
    x0, y0 = side, bottom
    x1, y1 = x0 + w, y0 + h
    d.rect("front", x0, y0, x1, y1, "panel", NAMES["front"])
    tri = style == "diamond"
    # side flaps: trapezoids (triangles for diamond) along the full height minus clearance
    for k, (edge, s) in enumerate(((x0, -1.0), (x1, 1.0)), start=1):
        name = f"side-flap-{k}"
        if tri:
            pts = [(edge, y0 + c), (edge + s * side, y0 + h * 0.5), (edge, y1 - c)]
        else:
            pts = [(edge, y0 + c), (edge + s * side, y0 + c + side * 0.6),
                   (edge + s * side, y1 - c - side * 0.3), (edge, y1 - c)]
        d.panel(name, pts, "flap", NAMES[name], print_area=False)
        d.hinge("front", name, -180.0, name=f"{name}-fold", treatment="crease")
    # bottom flap
    if tri:
        bpts = [(x0 + c, y0), (x1 - c, y0), (x0 + w * 0.5, y0 - bottom)]
    else:
        inset = min(side * 0.9, 0.18 * w)
        bpts = [(x0 + c, y0), (x1 - c, y0), (x1 - inset, y0 - bottom), (x0 + inset, y0 - bottom)]
    d.panel("bottom-flap", bpts, "flap", NAMES["bottom-flap"], print_area=False)
    d.hinge("front", "bottom-flap", -180.0, name="bottom-flap-fold", treatment="crease")
    # seal flap
    if style in ("baronial", "square", "diamond"):
        spts = [(x0 + c, y1), (x1 - c, y1), (x0 + w * 0.5, y1 + seal_depth)]
    elif style in ("commercial", "window"):
        spts = [(x0 + c, y1), (x1 - c, y1), (x1 - 0.12 * w, y1 + seal_depth * 0.55),
                (x0 + w * 0.5, y1 + seal_depth), (x0 + 0.12 * w, y1 + seal_depth * 0.55)]
    else:                                       # wallet, catalog, pocket: straight flap
        r = min(seal_depth * 0.3, 12.0)
        spts = [(x0 + c, y1), (x1 - c, y1), (x1 - c - r, y1 + seal_depth),
                (x0 + c + r, y1 + seal_depth)]
    d.panel("seal-flap", spts, "flap", NAMES["seal-flap"], print_area=False)
    d.hinge("front", "seal-flap", -180.0, name="seal-flap-fold", treatment="crease")
    # zones: seam glue on the bottom flap's slanted edges, gum / peel-and-seal on the seal flap
    _seal_zone(d, spts, y1, seal)
    _seam_zones(d, bpts, y0, tri)
    if style == "window":
        wx0, wy0 = x0 + 20.0, y0 + 15.0
        ww, wh = min(90.0, w - 30.0), min(45.0, h - 30.0)
        d.hole([(wx0, wy0), (wx0 + ww, wy0), (wx0 + ww, wy0 + wh), (wx0, wy0 + wh)])
        m, gap = 5.0, 1.0                      # film glue frame around the window [E]
        xa, xb, ya, yb = wx0 - gap, wx0 + ww + gap, wy0 - gap, wy0 + wh + gap
        strips = (((xa - m, ya - m), (xb + m, ya)), ((xa - m, yb), (xb + m, yb + m)),
                  ((xa - m, ya), (xa, yb)), ((xb, ya), (xb + m, yb)))
        for k, (p, q) in enumerate(strips, start=1):
            d.glue_zone(f"window-film-{k}", [p, (q[0], p[1]), q, (p[0], q[1])], "glue",
                        on="front")
    d.dimension((x0, y0), (x1, y0), f"W {W:g} (finished)", -6.0 if not tri else 4.0)
    d.dimension((x1, y0), (x1, y1), f"H {H:g} (finished)", 6.0)
    d.step("side-flaps", L4("Fold the side flaps in", "Dobla hacia dentro las solapas laterales",
                            "Rabattez les rabats latéraux", "Dobre as abas laterais para dentro"),
           ["side-flap-1-fold", "side-flap-2-fold"], 1200)
    d.step("bottom-flap", L4("Fold the bottom flap up and glue the seams",
                             "Sube la solapa inferior y pega las costuras",
                             "Relevez le rabat inférieur et collez les côtés",
                             "Suba a aba inferior e cole as emendas"), ["bottom-flap-fold"], 1200)
    d.step("seal", L4("Insert the letter and close the seal flap",
                      "Mete la carta y cierra la solapa",
                      "Glissez la lettre et fermez le rabat",
                      "Coloque a carta e feche a aba"), ["seal-flap-fold"], 1400)
    return d.build(rest_on="front")


def _seal_zone(d: Dieline, flap: list, y1: float, seal: str) -> None:
    """A strip along the seal flap's free edge (gum or peel-and-seal), 8 mm wide [E]."""
    top = max(p[1] for p in flap)
    xs = [p[0] for p in flap]
    depth = top - y1
    band = min(8.0, depth * 0.35)
    ya, yb = y1 + depth * 0.45, min(y1 + depth * 0.45 + band, top - 2.0)
    span = (max(xs) - min(xs))
    mid = (max(xs) + min(xs)) / 2.0
    half = span * 0.5 * (1.0 - (yb - y1) / depth) * 0.85
    d.glue_zone("seal", [(mid - half, ya), (mid + half, ya), (mid + half, yb), (mid - half, yb)],
                "gum" if seal == "gum" else "peel-and-seal", on="seal-flap")


def _seam_zones(d: Dieline, flap: list, y0: float, tri: bool) -> None:
    """Glue strips (5 mm, the middle 60 % [E]) along the bottom flap's slanted edges, on the
    flap side: they land on the side flaps when the bottom flap folds over them."""
    del y0, tri
    cx = sum(p[0] for p in flap) / len(flap)
    cy = sum(p[1] for p in flap) / len(flap)
    a, b, far = flap[0], flap[1], flap[2:]
    for k, (p, q) in enumerate(((a, far[-1]), (b, far[0])), start=1):
        mx, my = (p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0
        dx, dy = q[0] - p[0], q[1] - p[1]
        ln = (dx * dx + dy * dy) ** 0.5
        ux, uy = dx / ln, dy / ln
        nx, ny = -uy, ux
        if (cx - mx) * nx + (cy - my) * ny < 0:
            nx, ny = -nx, -ny
        half, wd = 0.3 * ln, 5.0
        quad = [(mx - ux * half + nx, my - uy * half + ny),
                (mx + ux * half + nx, my + uy * half + ny),
                (mx + ux * half + nx * (1 + wd), my + uy * half + ny * (1 + wd)),
                (mx - ux * half + nx * (1 + wd), my - uy * half + ny * (1 + wd))]
        d.glue_zone(f"side-seam-{k}", quad, "glue", on="bottom-flap")
