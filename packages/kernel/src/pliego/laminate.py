"""Laminated stocks: a sheet made of stacked layers (RFC 0045 phase 2; spec §5.40–§5.41).

A laminate stock is a stack of layers, bottom first. Each layer is a committed Pliego stock
(``{"stock": slug}``) or another platform's material by reference
(``{"material_ref": {"platform", "material_slug", "behaviour": "sheet"}}``), with an optional
``thickness_mm`` (default: the layer's caliper) and ``angle_deg`` (its axis 1 from the sheet's
grain, counter-clockwise). Cover cloth backed with paper, a print on fabric, a covered board.

Cross-platform data enters as **data**, never as code: the kernel does not import the keystone
(hyperobjects-spec). Every layer's physics is a ``sheet_behaviour`` document (the keystone's
cross-commons contract, ``docs/SHEET_BEHAVIOUR.md`` there):

- a Pliego stock layer reads the block its card carries (``materials/<slug>/stock.json``,
  ``sheet_behaviour``; written by the keystone's ``pliego-stock/1`` rule, drift-checked by
  ``scripts/qa/verify_sheet_behaviour.py``). A card that carries none cannot be a layer;
- a ``material_ref`` layer reads the vendored snapshot ``pliego/data/sheet-behaviour.snapshot.json``
  (each entry computed by the keystone's own mapping, with its provenance, drift-checked by the
  same script). Pliego never copies another platform's card into ``materials/``.

The stack is reduced by classical laminate theory, the keystone's ``hyperobjects_sheet.laminate``
restated (golden test: ``tests/test_laminate.py`` against the keystone's numbers): with
engineering shear strain, Voigt order (1, 2, 6), ``z`` from the bottom face,

    A = Σ Q̄ₖ tₖ     B = Σ Q̄ₖ tₖ z̄ₖ     D = Σ (ownₖ + Q̄ₖ tₖ z̄ₖ²)

where a layer's own bending is its card's bending, rotated (a fabric bends orders of magnitude
below the plate value of its membrane modulus). The engine reads the **free** stack: membrane
from the inverse of the 6 × 6 ABD matrix and bending ``D* = D − B·A⁻¹·B``. A non-zero B
(stretching bends the stack: the curl of a covered board) is flagged ``coupled``, never failed;
the engine does not model the curl yet (spec §5.40, follow-up).

Crease, tear, perforation and friction are not laminate quantities (a stack's crease is not its
layers' creases). ``pliego.laminate v1`` takes them from the **governing layer**: the Pliego stock
layer with the largest own bending √(D11·D22). A laminate therefore needs at least one Pliego
stock layer. Friction is the mean of the two face layers that state one (else the governing
layer's). Every one of these is an estimate, and the snapshot says which layer it came from.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

LAMINATE_BASIS = "pliego.laminate v1"
SNAPSHOT_FILE = Path(__file__).resolve().parent / "data" / "sheet-behaviour.snapshot.json"
SNAPSHOT_VERSION = "pliego.sheet-behaviour-snapshot v1"
PLATFORMS = ("pliego", "fashion-cabinet", "yantra4d")
COUPLING_EPS = 1e-9          # |B| / √(|A|·|D|) below which B is round-off (the keystone's value)
SIG_DIGITS = 6
# SI → engine units (mm, g, s): Pa = g/(mm·s²); N/m = 1e3 g/s²; N = 1e6 g·mm/s²; N·m = 1e9 g·mm²/s²
A_UNIT, B_UNIT, D_UNIT = 1e3, 1e6, 1e9
MIN_COLLISION_MM = 0.05

Matrix = list[list[float]]


class LaminateError(ValueError):
    """A laminate that cannot be computed (fail loud: no silent zero)."""


def _sig(x: float) -> float:
    if x == 0 or not math.isfinite(x):
        return 0.0 if x == 0 else x
    return float(f"{x:.{SIG_DIGITS}g}")


# ---------------------------------------------------------------- small linear algebra


def _zeros() -> Matrix:
    return [[0.0] * 3 for _ in range(3)]


def _add(a: Matrix, b: Matrix) -> Matrix:
    return [[x + y for x, y in zip(ra, rb, strict=True)] for ra, rb in zip(a, b, strict=True)]


def _scale(a: Matrix, k: float) -> Matrix:
    return [[k * x for x in row] for row in a]


def _matmul(a: Matrix, b: Matrix) -> Matrix:
    cols = list(zip(*b, strict=True))
    return [[sum(x * y for x, y in zip(row, col, strict=True)) for col in cols] for row in a]


def _max_abs(a: Matrix) -> float:
    return max((abs(x) for row in a for x in row), default=0.0)


def _inverse(a: Matrix) -> Matrix:
    """Gauss–Jordan with partial pivoting; a singular stack is an error, never a zero."""
    n = len(a)
    m = [list(map(float, row)) + [1.0 if i == j else 0.0 for j in range(n)]
         for i, row in enumerate(a)]
    norm = _max_abs(a)
    if norm == 0.0:
        raise LaminateError("singular laminate stiffness (all zero)")
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[piv][col]) <= 1e-13 * norm:
            raise LaminateError("singular laminate stiffness")
        m[col], m[piv] = m[piv], m[col]
        p = m[col][col]
        for r in range(n):
            if r != col and m[r][col]:
                f = m[r][col] / p
                for c in range(col, 2 * n):
                    m[r][c] -= f * m[col][c]
    return [[m[r][c] / m[r][r] for c in range(n, 2 * n)] for r in range(n)]


def reduced_stiffness(e1: float, e2: float, g12: float, nu12: float) -> Matrix:
    """Plane-stress reduced stiffness Q of an orthotropic lamina in its own axes (Pa)."""
    nu21 = nu12 * e2 / e1
    den = 1.0 - nu12 * nu21
    return [[e1 / den, nu12 * e2 / den, 0.0], [nu12 * e2 / den, e2 / den, 0.0], [0.0, 0.0, g12]]


def rotate(q: Matrix, angle_deg: float) -> Matrix:
    """Q̄ = T₁⁻¹·Q·T₂ — a symmetric 3 × 3 stiffness (Q or a bending D) in laminate axes."""
    t = math.radians(angle_deg)
    m, n = math.cos(t), math.sin(t)
    t1 = [[m * m, n * n, 2 * m * n], [n * n, m * m, -2 * m * n], [-m * n, m * n, m * m - n * n]]
    t2 = [[m * m, n * n, m * n], [n * n, m * m, -m * n], [-2 * m * n, 2 * m * n, m * m - n * n]]
    out = _matmul(_matmul(_inverse(t1), q), t2)
    ref = _max_abs(q)
    return [[0.0 if abs(x) <= 1e-14 * ref else x for x in row] for row in out]


# ---------------------------------------------------------------- layer sources


_SNAPSHOT_CACHE: dict[str, Any] = {}


def vendored_snapshot(path: Path | str | None = None) -> dict[str, Any]:
    """The vendored ``sheet_behaviour`` snapshot (``materials`` keyed ``platform/slug``)."""
    p = Path(path) if path is not None else SNAPSHOT_FILE
    key = str(p)
    if key not in _SNAPSHOT_CACHE:
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise LaminateError(f"sheet-behaviour snapshot unreadable ({p}): {exc}") from exc
        if data.get("snapshot") != SNAPSHOT_VERSION or not isinstance(data.get("materials"), dict):
            raise LaminateError(f"{p}: not a {SNAPSHOT_VERSION!r} file")
        _SNAPSHOT_CACHE[key] = data
    return _SNAPSHOT_CACHE[key]


def check_material_ref(ref: Any) -> dict[str, str]:
    """A clean ``material_ref`` ({platform, material_slug, behaviour: "sheet"})."""
    from .sheet import check_slug

    if not isinstance(ref, dict):
        raise LaminateError(f"material_ref must be an object, got {ref!r}")
    extra = set(ref) - {"platform", "material_slug", "behaviour", "role", "linked"}
    if extra:
        raise LaminateError(f"material_ref: unknown keys {sorted(extra)}")
    if ref.get("platform") not in PLATFORMS:
        raise LaminateError(f"material_ref.platform must be one of {PLATFORMS}, got "
                            f"{ref.get('platform')!r}")
    if ref.get("behaviour") != "sheet":
        raise LaminateError("material_ref.behaviour must be 'sheet' for a laminate layer")
    slug = check_slug(str(ref.get("material_slug", "")), "material_ref.material_slug")
    return {"platform": ref["platform"], "material_slug": slug, "behaviour": "sheet"}


def stock_behaviour(slug: str, root: Path | str | None = None) -> tuple[dict, dict]:
    """(the carried ``sheet_behaviour``, the card's derived block) of a committed Pliego stock."""
    from .stock import derive, load_card

    card = load_card(slug, root)
    sb = card.get("sheet_behaviour")
    if not isinstance(sb, dict):
        raise LaminateError(f"stock {slug!r} carries no sheet_behaviour block (spec §5.40); "
                            "write it with scripts/qa/verify_sheet_behaviour.py --write")
    return sb, derive(card)


def ref_behaviour(ref: dict, root: Path | str | None = None,
                  snapshot: Path | str | None = None) -> tuple[dict, dict | None, str]:
    """(sheet_behaviour, Pliego derived block or None, basis) of one ``material_ref``."""
    ref = check_material_ref(ref)
    platform, slug = ref["platform"], ref["material_slug"]
    if platform == "pliego":
        sb, der = stock_behaviour(slug, root)
        return sb, der, "card-carried sheet_behaviour (rule pliego-stock/1)"
    if platform == "yantra4d":
        raise LaminateError(f"yantra4d/{slug}: a filament card is a sheet only through a "
                            "thin-print descriptor (keystone rule y4d-thin-print/1); not in "
                            "pliego.laminate v1")
    entry = vendored_snapshot(snapshot)["materials"].get(f"{platform}/{slug}")
    if not isinstance(entry, dict) or not isinstance(entry.get("sheet_behaviour"), dict):
        raise LaminateError(f"{platform}/{slug}: not in the vendored sheet-behaviour snapshot "
                            f"({SNAPSHOT_FILE.name}); vendor it with "
                            "scripts/qa/verify_sheet_behaviour.py --write")
    return entry["sheet_behaviour"], None, (f"vendored snapshot (rule {entry.get('rule')}, "
                                            f"keystone {entry.get('keystone', '?')[:12]})")


# ---------------------------------------------------------------- the stack


def layer(stock: str | None = None, material_ref: dict | None = None, *,
          thickness_mm: float | None = None, angle_deg: float = 0.0) -> dict[str, Any]:
    """A layer spec for :func:`compute` / :func:`stock` (exactly one of stock, material_ref)."""
    if (stock is None) == (material_ref is None):
        raise LaminateError("a layer is exactly one of stock=<slug> or material_ref={...}")
    out: dict[str, Any] = ({"stock": stock} if stock is not None
                           else {"material_ref": check_material_ref(material_ref)})
    if thickness_mm is not None:
        out["thickness_mm"] = float(thickness_mm)
    out["angle_deg"] = float(angle_deg)
    return out


def _layer_inputs(spec: dict, root, snapshot) -> dict[str, Any]:
    if not isinstance(spec, dict) or ("stock" in spec) == ("material_ref" in spec):
        raise LaminateError(f"layer {spec!r}: give exactly one of stock, material_ref")
    if "stock" in spec:
        sb, der = stock_behaviour(str(spec["stock"]), root)
        basis, label = "card-carried sheet_behaviour (rule pliego-stock/1)", spec["stock"]
        rec: dict[str, Any] = {"stock": spec["stock"]}
    else:
        sb, der, basis = ref_behaviour(spec["material_ref"], root, snapshot)
        ref = check_material_ref(spec["material_ref"])
        label = f"{ref['platform']}/{ref['material_slug']}"
        rec = {"material_ref": ref}
    angle = spec.get("angle_deg", 0.0)
    if isinstance(angle, bool) or not isinstance(angle, int | float) or not math.isfinite(angle):
        raise LaminateError(f"layer {label}: angle_deg must be a number")
    cal = float(sb["caliper_mm"])
    t_mm = float(spec.get("thickness_mm", cal))
    if not (math.isfinite(t_mm) and t_mm > 0):
        raise LaminateError(f"layer {label}: thickness_mm must be positive")
    m, b = sb["membrane"], sb["bending"]
    cal_m = cal * 1e-3
    e1, e2, g12, nu12 = m["E1t"] / cal_m, m["E2t"] / cal_m, m["G12t"] / cal_m, m["nu12"]
    if not (e1 > 0 and e2 > 0 and g12 > 0) or nu12 * nu12 >= e1 / e2:
        raise LaminateError(f"layer {label}: membrane stiffness is not positive definite")
    k = (t_mm / cal) ** 3          # a card's bending belongs to its caliper: rescale as t³
    d16, d26 = b.get("D16", 0.0), b.get("D26", 0.0)
    own = [[k * b["D11"], k * b["D12"], k * d16], [k * b["D12"], k * b["D22"], k * d26],
           [k * d16, k * d26, k * b["D66"]]]
    rec.update({"thickness_mm": _sig(t_mm), "angle_deg": float(angle), "own_bending": "card",
                "basis": basis})
    return {"label": label, "record": rec, "behaviour": sb, "derived": der,
            "E1": e1, "E2": e2, "G12": g12, "nu12": nu12, "t": t_mm * 1e-3,
            "angle": float(angle), "own": own,
            "areal": float(sb["areal_density_kg_m2"]) * t_mm / cal}


def compute(layers: list[dict], root: Path | str | None = None,
            snapshot: Path | str | None = None) -> dict[str, Any]:
    """A, B, D (SI), the free-stack effective constants and the per-layer inputs of a stack."""
    if not isinstance(layers, list) or not layers:
        raise LaminateError("a laminate needs a non-empty list of layers")
    ins = [_layer_inputs(s, root, snapshot) for s in layers]
    h = sum(x["t"] for x in ins)
    a_m, b_m, d_m = _zeros(), _zeros(), _zeros()
    z = -h / 2.0
    for x in ins:
        t = x["t"]
        zbar = z + t / 2.0
        qbar = rotate(reduced_stiffness(x["E1"], x["E2"], x["G12"], x["nu12"]), x["angle"])
        a_m = _add(a_m, _scale(qbar, t))
        b_m = _add(b_m, _scale(qbar, t * zbar))
        d_m = _add(d_m, _add(rotate(x["own"], x["angle"]), _scale(qbar, t * zbar * zbar)))
        z += t
    scale_b = math.sqrt(_max_abs(a_m) * _max_abs(d_m))
    b_m = [[0.0 if abs(v) <= COUPLING_EPS * scale_b else v for v in row] for row in b_m]
    ratio = _max_abs(b_m) / scale_b if scale_b else 0.0
    abd = [ra + rb for ra, rb in zip(a_m, b_m, strict=True)] + [
        rb + rd for rb, rd in zip(b_m, d_m, strict=True)]
    inv = _inverse(abd)
    a_inv = [row[:3] for row in inv[:3]]
    dstar = _inverse([row[3:] for row in inv[3:]])
    eff = {"E1t": 1.0 / a_inv[0][0], "E2t": 1.0 / a_inv[1][1], "G12t": 1.0 / a_inv[2][2],
           "nu12": -a_inv[0][1] / a_inv[0][0], "D11": dstar[0][0], "D22": dstar[1][1],
           "D12": dstar[0][1], "D66": dstar[2][2], "D16": dstar[0][2], "D26": dstar[1][2]}
    return {"A": a_m, "B": b_m, "D": d_m, "thickness_m": h, "coupled": ratio > 0.0,
            "coupling_ratio": ratio, "effective": eff, "layers": ins,
            "areal_density_kg_m2": sum(x["areal"] for x in ins)}


def _governing(ins: list[dict]) -> int:
    cands = [i for i, x in enumerate(ins) if x["derived"] is not None
             and isinstance(x["behaviour"].get("crease"), dict)]
    if not cands:
        raise LaminateError("a laminate needs at least one Pliego stock layer (its crease, tear "
                            "and perforation constants govern the stack, spec §5.40)")
    return max(cands, key=lambda i: (math.sqrt(ins[i]["own"][0][0] * ins[i]["own"][1][1]), -i))


def _friction(ins: list[dict], gov: int) -> float:
    faces = [ins[0]] if len(ins) == 1 else [ins[0], ins[-1]]
    vals = [float(x["behaviour"]["contact"]["friction_static"]) for x in faces
            if isinstance(x["behaviour"].get("contact"), dict)
            and isinstance(x["behaviour"]["contact"].get("friction_static"), int | float)]
    return sum(vals) / len(vals) if vals else float(ins[gov]["derived"]["friction"])


def derived_block(res: dict[str, Any]) -> tuple[dict[str, float], int]:
    """The §5.2 ``derived`` block (engine units) of a computed stack, and its governing layer."""
    ins, eff = res["layers"], res["effective"]
    gov = _governing(ins)
    t_mm = res["thickness_m"] * 1e3
    t_m = res["thickness_m"]
    crease = ins[gov]["behaviour"]["crease"]
    gd = ins[gov]["derived"]
    nu21 = eff["nu12"] * eff["E2t"] / eff["E1t"]
    d_md, d_cd = eff["D11"] * D_UNIT, eff["D22"] * D_UNIT
    l_star = float(crease["crease_length_scale_t"]) * t_mm
    yield_deg = float(crease["crease_yield_deg"])
    score = float(crease.get("score_factor", gd["score_factor"]))
    out = {
        "areal_density": res["areal_density_kg_m2"] * 1e-3,
        "thickness": t_mm,
        "E_md": eff["E1t"] / t_m,
        "E_cd": eff["E2t"] / t_m,
        "nu": math.sqrt(max(eff["nu12"] * nu21, 0.0)),
        "D_md": d_md,
        "D_cd": d_cd,
        "crease_k": math.sqrt(d_md * d_cd) / l_star,
        "crease_yield_deg": yield_deg,
        "crease_set_rate": float(crease.get("crease_set_rate", gd["crease_set_rate"])),
        "score_factor": score,
        "perf_factor": float(gd["perf_factor"]),
        "tear_strain": float(gd["tear_strain"]),
        "friction": _friction(ins, gov),
        "collision_thickness": max(t_mm, MIN_COLLISION_MM),
        "G12": eff["G12t"] / t_m,
        "score_yield_deg": yield_deg * score,
        "D12": eff["D12"] * D_UNIT,
        "D66": eff["D66"] * D_UNIT,
    }
    return {k: _sig(v) for k, v in out.items()}, gov


def stock(name: dict[str, str] | str, layers: list[dict], *,
          appearance: dict[str, str] | None = None, root: Path | str | None = None,
          snapshot: Path | str | None = None) -> dict[str, Any]:
    """The §5.2 stock snapshot of a laminate, with its ``laminate`` block (§5.40).

    Pass it to ``Assembly(stocks={id: …})`` and give the sheets ``stock=id``."""
    from .sheet import i18n

    res = compute(layers, root, snapshot)
    derived, gov = derived_block(res)
    block = {
        "layers": [x["record"] for x in res["layers"]],
        "A": [[_sig(v * A_UNIT) for v in row] for row in res["A"]],
        "B": [[_sig(v * B_UNIT) for v in row] for row in res["B"]],
        "D": [[_sig(v * D_UNIT) for v in row] for row in res["D"]],
        "coupled": res["coupled"],
        "coupling_ratio": _sig(res["coupling_ratio"]),
        "governing_layer": gov,
    }
    snap: dict[str, Any] = {
        "name": dict(i18n(name, "Laminate")),
        "gsm": _sig(res["areal_density_kg_m2"] * 1e3),
        "caliper_mm": derived["thickness"],
        "derived": derived,
        "derived_basis": LAMINATE_BASIS,
        "laminate": block,
    }
    if appearance:
        snap["appearance"] = {k: appearance[k] for k in ("front", "back") if k in appearance}
    return snap


def material_refs(stocks: dict[str, dict]) -> list[dict[str, str]]:
    """Every ``material_ref`` a document's laminate stocks use, sorted and unique."""
    seen: dict[tuple[str, str], dict[str, str]] = {}
    for snap in stocks.values():
        for rec in ((snap.get("laminate") or {}).get("layers") or []):
            ref = rec.get("material_ref") if isinstance(rec, dict) else None
            if isinstance(ref, dict):
                seen[(ref.get("platform", ""), ref.get("material_slug", ""))] = dict(ref)
    return [seen[k] for k in sorted(seen)]
