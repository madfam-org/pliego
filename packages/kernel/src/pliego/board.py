"""Board constructions: corrugated sandwiches and laminated boards → sheet physics.

A stock card may carry a ``construction`` block (spec ``docs/spec/v1/stock-card.md``, "Board
constructions"). :func:`evaluate` turns it into the board's grammage, caliper, effective in-plane
moduli and orthotropic bending stiffness; :func:`pliego.stock.derive` then maps those to engine
units exactly as it does for plain paper. This module is the **only** place the corrugation
model lives (the stock module calls it; the corrugation generator reuses its flute table).

Corrugated board (``kind: "corrugated"``) is modelled as a sandwich, top layer first:
``liner, medium, liner[, medium, liner…]`` (single face: ``liner, medium``). The flutes run
across the machine direction (their axes lie along CD), as they leave a corrugator.

- **Flute geometry.** Pitch λ from the flutes-per-metre designation (Foster 1997, as tabled in
  Wikipedia "Corrugated fiberboard"); flute height ``h`` (the gap between the liners the medium
  spans) from measured cross-sections where available (Rogalka, Grabski & Garbowski 2023,
  Sensors 23:6242, Table 1: C 3.60, B 2.70, E 1.30 mm) and estimates [E] otherwise (A, F).
  The medium centre line is a sinusoid of amplitude ``a = (h − t_m)/2``; its **take-up**
  α (medium length per board length) is that sinusoid's arc-length factor, computed here.
  Handbook take-up values run about 0.05–0.1 higher (real profiles have steeper flanks), so the
  medium's share of grammage and of CD stiffness is a slight underestimate [E].
- **Membrane.** ``A_md = Σ_liners E_md·t`` (the wavy medium carries almost no MD load and is
  neglected — standard in corrugated-board homogenisation, e.g. Nordstrand 2003 [L]);
  ``A_cd = Σ_liners E_cd·t + Σ_media α·E_cd,m·t_m``. Effective moduli are ``A / caliper``.
- **Bending** (classical sandwich theory, Allen 1969 [L]), about each direction's own neutral
  axis z̄ = Σ E·t·z / Σ E·t:
  ``D_md = Σ_liners E_md (t³/12 + t (z − z̄)²) / (1 − ν²)``;
  ``D_cd = [Σ_liners E_cd (t³/12 + t (z − z̄)²) + Σ_media α E_cd,m t_m ((z_m − z̄)² + a²/2 +
  t_m²/12)] / (1 − ν²)`` — the sinusoid's mean square height a²/2 = h_c²/8, with the medium's
  material spread uniformly along the board length (an approximation [E]).
  Transverse-shear softness of the core is **not** included: short spans of real board are
  softer than this D predicts [L].
- **Grammage.** ``Σ liner gsm + Σ α·medium gsm + adhesive × glue lines`` (one starch glue line
  per medium–liner contact; ``adhesive_gsm_per_glueline`` defaults to 5 g/m² [E]).
- **Caliper.** ``Σ liner calipers + Σ flute heights``.

Laminated board (``kind: "laminate"``, e.g. folding boxboard: bleached top ply, bulky middle,
back ply) stacks plies with the same membrane and bending sums (no flutes).

Units here: mm, g/m², GPa; bending stiffness in mN·m (1 GPa·mm³ = 1 N·m = 1000 mN·m).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

MODEL = "pliego.board v1"
KINDS = ("corrugated", "laminate")
ROLES = {"corrugated": ("liner", "medium"), "laminate": ("ply",)}
DEFAULT_ADHESIVE_GSM = 5.0      # starch per glue line [E]
NU_DEFAULT = 0.293
TAKE_UP_SAMPLES = 512           # midpoint rule over one period (deterministic)


@dataclass(frozen=True)
class Flute:
    """One flute designation: pitch (mm), flute height (gap between liners, mm)."""

    name: str
    flutes_per_m: float
    pitch: float
    height: float
    height_status: str           # "measured" (Rogalka 2023 Table 1) or "estimated"


def _flute(name: str, per_m: float, height: float, status: str) -> Flute:
    return Flute(name, per_m, 1000.0 / per_m, height, status)


# flutes per metre: Foster 1997 (Wiley Encyclopedia of Packaging Technology) via Wikipedia's
# table (A 108, B 154, C 128, E 295, F 420 ± 10–13). Heights: B, C, E measured (Rogalka et al.
# 2023 Table 1); A ≈ 4.7 and F ≈ 0.6 mm are estimates [E] (A "about 5 mm", F "about 0.8 mm"
# board, per the same paper's survey and Foster's thickness column).
FLUTES: dict[str, Flute] = {
    "A": _flute("A", 108.0, 4.7, "estimated"),
    "B": _flute("B", 154.0, 2.7, "measured"),
    "C": _flute("C", 128.0, 3.6, "measured"),
    "E": _flute("E", 295.0, 1.3, "measured"),
    "F": _flute("F", 420.0, 0.6, "estimated"),
}


class BoardError(ValueError):
    """A construction block failed validation."""


def take_up(pitch: float, amplitude: float) -> float:
    """Arc-length factor of a sinusoid ``z = a·sin(2πx/λ)`` (length of medium per length of
    board), midpoint rule over one period (exact to ~1e-12 for the flute range)."""
    if pitch <= 0 or amplitude < 0:
        raise BoardError("take_up: pitch must be > 0 and amplitude ≥ 0")
    ak = amplitude * 2.0 * math.pi / pitch
    n = TAKE_UP_SAMPLES
    return math.fsum(math.sqrt(1.0 + (ak * math.cos(2.0 * math.pi * (i + 0.5) / n)) ** 2)
                     for i in range(n)) / n


def _num(layer: dict, key: str, where: str) -> float:
    v = layer.get(key)
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or v <= 0:
        raise BoardError(f"{where}.{key} must be a positive number")
    return float(v)


def validate(construction: Any) -> list[str]:
    """Problems with a construction block (empty list = valid)."""
    try:
        _layers(construction)
    except BoardError as exc:
        return [str(exc)]
    return []


def _layers(c: Any) -> list[dict]:
    if not isinstance(c, dict):
        raise BoardError("construction must be an object")
    kind = c.get("kind")
    if kind not in KINDS:
        raise BoardError(f"construction.kind must be one of {KINDS}, got {kind!r}")
    if c.get("model") != MODEL:
        raise BoardError(f"construction.model must be {MODEL!r}")
    layers = c.get("layers")
    if not isinstance(layers, list) or not layers:
        raise BoardError("construction.layers must be a non-empty list")
    out = []
    for k, layer in enumerate(layers):
        where = f"construction.layers[{k}]"
        if not isinstance(layer, dict):
            raise BoardError(f"{where} must be an object")
        role = layer.get("role")
        if role not in ROLES[kind]:
            raise BoardError(f"{where}.role must be one of {ROLES[kind]} for {kind}")
        for key in ("gsm", "caliper_um", "E_md_gpa", "E_cd_gpa"):
            _num(layer, key, where)
        if layer.get("status") not in ("measured", "nominal", "estimated"):
            raise BoardError(f"{where}.status must be measured | nominal | estimated")
        if not layer.get("basis") and not layer.get("source"):
            raise BoardError(f"{where} needs a basis (estimate) or a source")
        if role == "medium":
            flute = FLUTES.get(layer.get("flute"))  # type: ignore[arg-type]
            if flute is None:
                raise BoardError(f"{where}.flute must be one of {sorted(FLUTES)}")
            if layer["caliper_um"] / 1000.0 >= flute.height:
                raise BoardError(f"{where}: medium caliper must be below the {flute.name} "
                                 f"flute height {flute.height} mm")
        out.append(layer)
    if kind == "corrugated":
        roles = [layer["role"] for layer in out]
        if roles[0] != "liner" or len(roles) < 2:
            raise BoardError("corrugated layers start with a liner and hold a medium")
        for a, b in zip(roles, roles[1:], strict=False):
            if a == b:
                raise BoardError("corrugated layers alternate liner and medium")
    adhesive = c.get("adhesive_gsm_per_glueline", DEFAULT_ADHESIVE_GSM)
    if not isinstance(adhesive, (int, float)) or adhesive < 0:
        raise BoardError("construction.adhesive_gsm_per_glueline must be ≥ 0")
    return out


@dataclass(frozen=True)
class BoardModel:
    """The evaluated construction (mm, g/m², GPa, mN·m)."""

    kind: str
    gsm: float
    caliper_mm: float
    E_md_gpa: float
    E_cd_gpa: float
    D_md_mNm: float
    D_cd_mNm: float
    walls: tuple[dict, ...]       # per medium: flute, pitch, height, amplitude, take_up, z


def evaluate(construction: dict, nu: float = NU_DEFAULT) -> BoardModel:
    """Evaluate a construction block (see the module docstring for every formula)."""
    layers = _layers(construction)
    kind = construction["kind"]
    adhesive = float(construction.get("adhesive_gsm_per_glueline", DEFAULT_ADHESIVE_GSM))
    # stack bottom → top (the list is top first); each slab: (role, t, z_centre, layer, wall)
    slabs: list[tuple[str, float, float, dict, dict | None]] = []
    z = 0.0
    walls: list[dict] = []
    for idx, layer in enumerate(reversed(layers)):
        t = layer["caliper_um"] / 1000.0
        if layer["role"] == "medium":
            flute = FLUTES[layer["flute"]]
            amp = (flute.height - t) / 2.0
            wall = {"flute": flute.name, "pitch": flute.pitch, "height": flute.height,
                    "amplitude": amp, "take_up": take_up(flute.pitch, amp),
                    "z": z + flute.height / 2.0, "layer": len(layers) - 1 - idx}
            walls.append(wall)
            slabs.append(("medium", t, wall["z"], layer, wall))
            z += flute.height
        else:
            slabs.append((layer["role"], t, z + t / 2.0, layer, None))
            z += t
    caliper = z
    plate = 1.0 / (1.0 - nu * nu)

    def axis_sums(direction: str) -> tuple[float, float]:
        key = "E_md_gpa" if direction == "md" else "E_cd_gpa"
        a_sum = zm = 0.0
        terms = []
        for role, t, zc, layer, wall in slabs:
            if role == "medium":
                if direction == "md":
                    continue
                w = wall["take_up"] * layer[key] * t          # type: ignore[index]
            else:
                w = layer[key] * t
            terms.append((role, t, zc, w, wall))
            a_sum += w
            zm += w * zc
        zbar = zm / a_sum
        d = 0.0
        for role, t, zc, w, wall in terms:
            spread = t * t / 12.0
            if role == "medium":
                spread += wall["amplitude"] ** 2 / 2.0          # type: ignore[index]
            d += w * (spread + (zc - zbar) ** 2)
        return a_sum, d * plate * 1000.0                         # GPa·mm, mN·m

    a_md, d_md = axis_sums("md")
    a_cd, d_cd = axis_sums("cd")
    gsm = 0.0
    glue_lines = 0
    for k, layer in enumerate(layers):
        if layer["role"] == "medium":
            wall = next(w for w in walls if w["layer"] == k)
            gsm += wall["take_up"] * layer["gsm"]
            glue_lines += (1 if k > 0 else 0) + (1 if k + 1 < len(layers) else 0)
        else:
            gsm += layer["gsm"]
    gsm += adhesive * glue_lines if kind == "corrugated" else 0.0
    return BoardModel(kind, gsm, caliper, a_md / caliper, a_cd / caliper, d_md, d_cd,
                      tuple(reversed(walls)))


def physical_values(model: BoardModel) -> dict[str, float]:
    """The card ``physical`` values a construction implies (rounded as the card stores them)."""
    return {"gsm": round(model.gsm, 1), "caliper_um": round(model.caliper_mm * 1000.0, 1),
            "E_md_gpa": round(model.E_md_gpa, 4), "E_cd_gpa": round(model.E_cd_gpa, 4)}
