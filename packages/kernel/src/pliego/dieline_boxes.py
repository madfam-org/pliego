"""Corrugated box styles for :mod:`pliego.dieline` (thickness-compensated, inside dimensions).

Styles (FEFCO codes are cited as identifiers only; every geometry here is generated from the
rules below, never copied from the FEFCO catalogue's drawings):

- ``slotted(..., flaps="regular")`` — regular slotted container (FEFCO 0201 style): all flaps
  the same length, the outer flaps meeting at the centre;
- ``flaps="half"`` — half-slotted container (FEFCO 0200 style): bottom flaps only;
- ``flaps="full"`` — full-overlap container (FEFCO 0203 style): flaps as long as the box is
  wide, so the outer flaps overlap completely;
- ``telescope`` — two half-slotted trays, the lid's inside equal to the base's outside;
- ``mailer(..., roll="ends")`` — roll-end tuck-front mailer (FEFCO 0427 style): rolled double
  end walls whose lock tabs drop into slots on the base folds, ears on the front and back walls
  trapped inside the rolled ends, a lid with dust flaps and a front tuck;
- ``mailer(..., roll="front")`` — pizza style: the front wall rolls instead, the side walls
  carry corner ears.

**Thickness compensation** (caliper t, inside L × W × D): a board folded 90° turns about its
centre line, so every panel between two folds measures inside + t (centre-line rule); RSC flaps
are (W + t)/2, full-overlap flaps W + t; slots are 2t wide (at least 2 mm); a rolled wall's
inner leaf is t shorter than its outer leaf; the telescope lid's inside is the base's inside
+ 2t. Outer flaps resting on inner flaps are drawn tilted by asin(t / flap) so the zero-thickness
preview shows them lying on the inner flaps. Factories add their own allowances on top
(manufacturer's joint width, crease-rule offsets): these are design rules, not a plant spec.
"""

from __future__ import annotations

import math

from .board import caliper as stock_caliper
from .dieline import Dieline, Packed
from .sheet import Placement


def L4(en: str, es: str, fr: str, pt: str) -> dict:
    return {"en": en, "es": es, "fr": fr, "pt": pt}


NAMES = {
    "front": L4("Front", "Frente", "Face avant", "Frente"),
    "back": L4("Back", "Parte trasera", "Face arrière", "Traseira"),
    "end-1": L4("End 1", "Cabecera 1", "Petit côté 1", "Cabeceira 1"),
    "end-2": L4("End 2", "Cabecera 2", "Petit côté 2", "Cabeceira 2"),
    "glue-flap": L4("Glue flap", "Pestaña de pegado", "Patte de collage", "Aba de colagem"),
}
TOP = L4("top flap", "solapa superior", "rabat supérieur", "aba superior")
BOTTOM = L4("bottom flap", "solapa inferior", "rabat inférieur", "aba inferior")


def _flap_label(panel: str, which: dict) -> dict:
    base = NAMES[panel]
    return {k: f"{base[k]}: {which[k]}" for k in base}


def _check(L: float, W: float, D: float) -> None:
    for name, v in (("length", L), ("width", W), ("depth", D)):
        if not (math.isfinite(v) and 20.0 <= v <= 2000.0):
            raise ValueError(f"inside {name} must be in [20, 2000] mm, got {v}")
    if W > L:
        raise ValueError("inside width must not exceed inside length (W ≤ L)")


def slotted(L: float, W: float, D: float, stock: str = "corrugated-b-flute", *,
            flaps: str = "regular", glue: float = 30.0, sheet_id: str = "shipper",
            label=None, caliper: float | None = None) -> Packed:
    """A slotted shipping case from inside dimensions (see the module docstring)."""
    if flaps not in ("regular", "half", "full"):
        raise ValueError("flaps must be regular | half | full")
    _check(L, W, D)
    t = stock_caliper(stock) if caliper is None else float(caliper)
    Lp, Wp, Dp = L + t, W + t, D + t
    s = max(2.0 * t, 2.0)
    hf = Wp / 2.0 if flaps != "full" else Wp
    g = min(max(glue, 15.0), Dp / 2.0)
    style = {"regular": "regular-slotted (FEFCO 0201 style)",
             "half": "half-slotted (FEFCO 0200 style)",
             "full": "full-overlap (FEFCO 0203 style)"}[flaps]
    d = Dieline(sheet_id, style, "corrugated", {"length": L, "width": W, "depth": D}, stock, t,
                label=label or L4("Shipping case", "Caja de envío", "Caisse d'expédition",
                                  "Caixa de expedição"), grain_deg=90.0)
    widths = [("front", Lp), ("end-1", Wp), ("back", Lp), ("end-2", Wp)]
    y0, y1 = hf, hf + Dp
    x = 0.0
    tilt = math.degrees(math.asin(min(1.0, t / hf)))
    for name, w in widths:
        d.rect(name, x, y0, x + w, y1, "panel", NAMES[name])
        major = name in ("front", "back")
        for row, (ya, yb), which in (("bottom", (0.0, y0), BOTTOM), ("top", (y1, y1 + hf), TOP)):
            if row == "top" and flaps == "half":
                continue
            fname = f"{name}-{row}-flap"
            d.rect(fname, x + s / 2.0, ya, x + w - s / 2.0, yb, "flap", _flap_label(name, which))
            d.hinge(name, fname, -(90.0 - tilt) if major else -90.0, name=f"{fname}-fold")
        x += w
    d.panel("glue-flap", [(x, y0), (x + g, y0 + g * 0.5), (x + g, y1 - g * 0.5), (x, y1)],
            "glue-flap", NAMES["glue-flap"], print_area=False)
    for a, b in (("front", "end-1"), ("end-1", "back"), ("back", "end-2")):
        d.hinge(a, b, -90.0, name=f"{a}-{b}-fold")
    d.hinge("end-2", "glue-flap", -90.0, name="glue-flap-fold")
    d.glue_zone("manufacturers-joint", [(x + 1.0, y0 + g * 0.5), (x + g - 1.0, y0 + g * 0.5 + 0.5),
                                        (x + g - 1.0, y1 - g * 0.5 - 0.5), (x + 1.0, y1 - g * 0.5)],
                on="glue-flap")
    d.dimension((0.0, y0), (Lp, y0), f"L {L:g} (inside)", -6.0)
    d.dimension((Lp, y0), (Lp + Wp, y0), f"W {W:g} (inside)", -6.0)
    d.dimension((0.0, y0), (0.0, y1), f"D {D:g} (inside)", 8.0)
    d.step("form-tube", L4("Fold the body into a tube and glue the joint",
                           "Dobla el cuerpo en un tubo y pega la unión",
                           "Pliez le corps en tube et collez la patte",
                           "Dobre o corpo num tubo e cole a junta"),
           ["front-end-1-fold", "end-1-back-fold", "back-end-2-fold", "glue-flap-fold"], 1600)
    for row in ("bottom", "top"):
        if row == "top" and flaps == "half":
            continue
        en, es, fr, pt = (("bottom", "inferiores", "inférieurs", "inferiores") if row == "bottom"
                          else ("top", "superiores", "supérieurs", "superiores"))
        d.step(f"{row}-inner-flaps", L4(f"Fold in the {en} end flaps",
                                         f"Dobla hacia dentro las solapas {es} de las cabeceras",
                                         f"Rabattez les rabats {fr} des petits côtés",
                                         f"Dobre para dentro as abas {pt} das cabeceiras"),
               [f"end-1-{row}-flap-fold", f"end-2-{row}-flap-fold"], 1000)
        d.step(f"{row}-outer-flaps", L4(f"Close the {en} with the outer flaps",
                                         f"Cierra con las solapas exteriores {es}",
                                         f"Fermez avec les rabats extérieurs {fr}",
                                         f"Feche com as abas externas {pt}"),
               [f"front-{row}-flap-fold", f"back-{row}-flap-fold"], 1000)
    return d.build(rest_on="front")


def telescope(L: float, W: float, D: float, lid_depth: float, stock: str = "corrugated-b-flute",
              *, glue: float = 30.0) -> tuple[Packed, Packed]:
    """Two-piece telescope (tray and lid, both half-slotted): the lid's inside is the base's
    inside + 2t so it slides over the base.

    Both trays erect lying on their front panels; the lid is placed turned end for end (180°
    about the vertical) and offset so that, closed, it caps the base's open end, its closed end
    t above the base's rim and its walls t outside the base's walls."""
    t = stock_caliper(stock)
    base = slotted(L, W, D, stock, flaps="half", glue=glue, sheet_id="base",
                   label=L4("Base tray", "Charola base", "Fond", "Bandeja base"))
    lid = slotted(L + 2 * t, W + 2 * t, lid_depth, stock, flaps="half", glue=glue,
                  sheet_id="lid", label=L4("Lid", "Tapa", "Couvercle", "Tampa"))
    base.block["style"] = lid.block["style"] = "telescope (two half-slotted trays)"
    rim = (W + t) / 2.0 + (D + t)              # the base's open edge, sheet v
    lid_fold = (W + 3 * t) / 2.0               # the lid's closed-end fold, sheet v
    # world = R_z(180°)·(u, 0, −v) + origin  →  x = origin_x − u, y = 0, z = origin_z − v
    lid.sheet.placement = Placement(origin=(L + 2 * t, -t, rim + t + lid_fold),
                                    rotation=(0.0, 0.0, -1.0, 0.0))
    return base, lid


MAILER = {
    "base": L4("Base", "Base", "Fond", "Base"),
    "front-wall": L4("Front wall", "Pared frontal", "Paroi avant", "Parede frontal"),
    "back-wall": L4("Back wall", "Pared trasera", "Paroi arrière", "Parede traseira"),
    "lid": L4("Lid", "Tapa", "Couvercle", "Tampa"),
    "tuck": L4("Front tuck", "Lengüeta frontal", "Rabat rentrant avant", "Aba frontal de encaixe"),
    "side": L4("Side wall", "Pared lateral", "Paroi latérale", "Parede lateral"),
    "inner": L4("Inner wall", "Pared interior", "Paroi intérieure", "Parede interna"),
    "ear": L4("Ear", "Oreja", "Oreille", "Orelha"),
    "dust": L4("Lid dust flap", "Solapa guardapolvo de la tapa",
               "Rabat anti-poussière du couvercle", "Aba guarda-pó da tampa"),
}


def notched_rect(x0: float, y0: float, x1: float, y1: float,
                 notches: dict[str, list[tuple[float, float]]], depth: float) -> list:
    """A rectangle with rectangular notches ``depth`` deep cut into its edges: ``notches`` maps
    an edge ("left" | "right" | "top" | "bottom") to spans along it. Two panels notched at the
    same spans on either side of their shared fold leave a slot through the fold."""
    pts = [(x0, y0)]
    for a, b in sorted(notches.get("bottom", [])):
        pts += [(a, y0), (a, y0 + depth), (b, y0 + depth), (b, y0)]
    pts.append((x1, y0))
    for a, b in sorted(notches.get("right", [])):
        pts += [(x1, a), (x1 - depth, a), (x1 - depth, b), (x1, b)]
    pts.append((x1, y1))
    for a, b in sorted(notches.get("top", []), reverse=True):
        pts += [(b, y1), (b, y1 - depth), (a, y1 - depth), (a, y1)]
    pts.append((x0, y1))
    for a, b in sorted(notches.get("left", []), reverse=True):
        pts += [(x0, b), (x0 + depth, b), (x0 + depth, a), (x0, a)]
    return pts


def _side(label: dict, k: int) -> dict:
    return {lang: f"{text} {k}" for lang, text in label.items()}


def mailer(L: float, W: float, D: float, stock: str = "corrugated-e-flute", *,
           roll: str = "ends", sheet_id: str = "mailer", label=None) -> Packed:
    """Roll-end tuck-front mailer (``roll="ends"``) or pizza style (``roll="front"``)."""
    if roll not in ("ends", "front"):
        raise ValueError("roll must be ends | front")
    _check(L, W, D)
    if D > W:
        raise ValueError("mailer depth must not exceed its width (D ≤ W)")
    t = stock_caliper(stock)
    Lp, Wp, Dp = L + t, W + t, D + t
    s = max(2.0 * t, 2.0)
    tuck = max(Dp - 2.0 * t, 8.0)
    tab = 2.0 * t + 2.0                       # lock tab drop through the base slot
    side_w = Dp + (Dp - t) + tab if roll == "ends" else Dp
    x0 = side_w                               # base column starts here
    x1 = x0 + Lp
    rows = {"tuck": (0.0, tuck)}
    rows["lid"] = (tuck, tuck + Wp)
    rows["back"] = (rows["lid"][1], rows["lid"][1] + Dp)
    rows["base"] = (rows["back"][1], rows["back"][1] + Wp)
    rows["front"] = (rows["base"][1], rows["base"][1] + Dp)
    if roll == "front":
        rows["front-inner"] = (rows["front"][1], rows["front"][1] + Dp - t)
    style = ("roll-end tuck-front mailer (FEFCO 0427 style)" if roll == "ends"
             else "pizza style (rolled front wall)")
    d = Dieline(sheet_id, style, "corrugated", {"length": L, "width": W, "depth": D}, stock, t,
                label=label or L4("Mailer box", "Caja tipo mailer", "Boîte postale",
                                  "Caixa mailer"), grain_deg=90.0)
    (b0, b1), (k0, k1), (f0, f1) = rows["base"], rows["back"], rows["front"]
    (l0, l1), (u0, u1) = rows["lid"], rows["tuck"]
    m = Wp / 4.0
    tab_spans = [(b0 + m - m / 4.0, b0 + m + m / 4.0), (b0 + 3 * m - m / 4.0, b0 + 3 * m + m / 4.0)]
    n_front = 3
    span = Lp / (2 * n_front + 1)
    front_spans = [(x0 + span * (2 * j - 1), x0 + span * 2 * j) for j in range(1, n_front + 1)]
    slot = [(a - 0.5, b + 0.5) for a, b in tab_spans]
    fslot = [(a - 0.5, b + 0.5) for a, b in front_spans]
    if roll == "ends":
        d.panel("base", notched_rect(x0, b0, x1, b1, {"left": slot, "right": slot}, t),
                "panel", MAILER["base"])
        d.rect("front-wall", x0, f0, x1, f1, "panel", MAILER["front-wall"])
    else:
        d.panel("base", notched_rect(x0, b0, x1, b1, {"top": fslot}, t), "panel",
                MAILER["base"])
        d.panel("front-wall", notched_rect(x0, f0, x1, f1, {"bottom": fslot}, t), "panel",
                MAILER["front-wall"])
    d.rect("back-wall", x0, k0, x1, k1, "panel", MAILER["back-wall"])
    d.rect("lid", x0, l0, x1, l1, "lid", MAILER["lid"])
    c = min(tuck / 2.0, 10.0)
    d.panel("tuck", [(x0 + c, u0), (x1 - c, u0), (x1, u1), (x0, u1)], "tuck", MAILER["tuck"])
    d.hinge("base", "back-wall", -90.0, name="back-wall-fold")
    d.hinge("base", "front-wall", -90.0, name="front-wall-fold")
    d.hinge("back-wall", "lid", -90.0, name="lid-fold")
    d.hinge("lid", "tuck", -90.0, name="tuck-fold")
    dust_w = Dp - t
    ear_w = Wp / 2.0 - t
    walls: list[str] = []
    ears: list[str] = []
    rolls: list[str] = []
    for k, sign in ((1, -1.0), (2, 1.0)):
        edge = x0 if sign < 0 else x1
        # lid dust flaps
        pd = [(edge, l0 + s), (edge + sign * dust_w, l0 + s + dust_w * 0.4),
              (edge + sign * dust_w, l1 - s), (edge, l1 - s / 2.0)]
        d.panel(f"dust-flap-{k}", pd, "dust-flap", _side(MAILER["dust"], k))
        d.hinge("lid", f"dust-flap-{k}", -90.0, name=f"dust-flap-{k}-fold")
        if roll == "ends":
            xa, xb = sorted((edge, edge + sign * Dp))
            side_notch = {"right" if sign < 0 else "left": slot}
            d.panel(f"side-wall-{k}", notched_rect(xa, b0, xb, b1, side_notch, t), "panel",
                    _side(MAILER["side"], k))
            e2 = edge + sign * Dp
            e3 = e2 + sign * (Dp - t)
            inner = [(e2, b0), (e3, b0)]
            for ya, yb in tab_spans:
                inner += [(e3, ya), (e3 + sign * tab, ya + 0.5), (e3 + sign * tab, yb - 0.5),
                          (e3, yb)]
            inner += [(e3, b1), (e2, b1)]
            d.panel(f"inner-wall-{k}", inner, "lock", _side(MAILER["inner"], k))
            d.hinge("base", f"side-wall-{k}", -90.0, name=f"side-wall-{k}-fold")
            d.hinge(f"side-wall-{k}", f"inner-wall-{k}", -180.0, name=f"roll-{k}-fold")
            for wall, (ya, yb) in (("front-wall", (f0 + s, f1 - s)),
                                   ("back-wall", (k0 + s, k1 - s))):
                ear = f"{wall}-ear-{k}"
                d.panel(ear, [(edge, ya), (edge + sign * ear_w, ya + (s if wall == "back-wall"
                                                                      else 0.0)),
                              (edge + sign * ear_w, yb - (s if wall == "front-wall" else 0.0)),
                              (edge, yb)], "dust-flap", _side(MAILER["ear"], k))
                d.hinge(wall, ear, -90.0, name=f"{ear}-fold")
                ears.append(f"{ear}-fold")
            walls.append(f"side-wall-{k}-fold")
            rolls.append(f"roll-{k}-fold")
        else:
            d.rect(f"side-wall-{k}", min(edge, edge + sign * Dp), b0, max(edge, edge + sign * Dp),
                   b1, "panel", _side(MAILER["side"], k))
            d.hinge("base", f"side-wall-{k}", -90.0, name=f"side-wall-{k}-fold")
            walls.append(f"side-wall-{k}-fold")
            ear_len = min(ear_w, Dp - s)
            for end, (ya, yb) in (("front", (b1, b1 + ear_len)), ("back", (b0 - ear_len, b0))):
                ear = f"side-wall-{k}-ear-{end}"
                xa, xb = sorted((edge + sign * s, edge + sign * (Dp - s / 2.0)))
                d.rect(ear, xa, ya, xb, yb, "dust-flap", _side(MAILER["ear"], k))
                d.hinge(f"side-wall-{k}", ear, -90.0, name=f"{ear}-fold")
                ears.append(f"{ear}-fold")
    if roll == "front":
        i1 = rows["front-inner"][1]
        poly = [(x0 + t, f1), (x1 - t, f1), (x1 - t, i1)]
        for xa, xb in reversed(front_spans):
            poly += [(xb, i1), (xb - 0.5, i1 + tab), (xa + 0.5, i1 + tab), (xa, i1)]
        poly.append((x0 + t, i1))
        d.panel("front-inner", poly, "lock", MAILER["inner"])
        d.hinge("front-wall", "front-inner", -180.0, name="roll-front-fold")
        rolls.append("roll-front-fold")
    d.dimension((x0, b0), (x1, b0), f"L {L:g} (inside)", -6.0)
    d.dimension((x1, b0), (x1, b1), f"W {W:g} (inside)", 8.0)
    d.dimension((x0, f0), (x0, f1), f"D {D:g} (inside)", -8.0)
    if roll == "ends":
        d.step("walls-up", L4("Fold up the front and back walls",
                              "Levanta las paredes frontal y trasera",
                              "Relevez les parois avant et arrière",
                              "Levante as paredes frontal e traseira"),
               ["front-wall-fold", "back-wall-fold"], 1200)
        d.step("ears-in", L4("Fold the ears in", "Dobla las orejas hacia dentro",
                             "Rabattez les oreilles", "Dobre as orelhas para dentro"), ears, 900)
        d.step("ends-up", L4("Raise the end walls over the ears",
                             "Levanta las paredes laterales sobre las orejas",
                             "Relevez les parois latérales sur les oreilles",
                             "Levante as paredes laterais sobre as orelhas"), walls, 1000)
        d.step("roll-ends", L4("Roll the end walls in and drop the tabs into the slots",
                               "Enrolla las paredes laterales y mete las pestañas en las ranuras",
                               "Roulez les parois latérales et engagez les pattes dans les fentes",
                               "Enrole as paredes laterais e encaixe as abas nas fendas"),
               rolls, 1400)
    else:
        d.step("sides-up", L4("Raise the side walls", "Levanta las paredes laterales",
                              "Relevez les parois latérales", "Levante as paredes laterais"),
               walls, 1000)
        d.step("ears-in", L4("Fold the corner ears in", "Dobla las orejas de las esquinas",
                             "Rabattez les oreilles des coins", "Dobre as orelhas dos cantos"),
               ears, 900)
        d.step("walls-up", L4("Fold up the back wall and the front wall",
                              "Levanta la pared trasera y la frontal",
                              "Relevez la paroi arrière et la paroi avant",
                              "Levante a parede traseira e a frontal"),
               ["front-wall-fold", "back-wall-fold"], 1200)
        d.step("roll-front", L4("Roll the front wall in and lock its tabs",
                                "Enrolla la pared frontal y traba sus pestañas",
                                "Roulez la paroi avant et verrouillez ses pattes",
                                "Enrole a parede frontal e trave suas abas"), rolls, 1400)
    d.step("close-lid", L4("Close the lid: dust flaps in, tuck into the front",
                           "Cierra la tapa: guardapolvos dentro y lengüeta al frente",
                           "Fermez le couvercle : rabats dedans, rabat rentrant à l'avant",
                           "Feche a tampa: guarda-pós para dentro e aba na frente"),
           ["lid-fold", "dust-flap-1-fold", "dust-flap-2-fold", "tuck-fold"], 1600)
    return d.build(rest_on="base")
