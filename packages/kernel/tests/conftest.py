"""Shared fixtures: a stock snapshot in the §5.2 shape (test data, not a physics mapping)."""

from __future__ import annotations

import pytest

KAMI = {
    "name": {"en": "Kami 63 g/m²", "es": "Kami 63 g/m²", "fr": "Kami 63 g/m²",
             "pt": "Kami 63 g/m²"},
    "gsm": 63,
    "caliper_mm": 0.072,
    "derived": {
        "areal_density": 6.3e-05, "thickness": 0.072, "E_md": 5.0e9, "E_cd": 2.3e9,
        "nu": 0.293, "D_md": 1.7e5, "D_cd": 7.8e4, "crease_k": 1.0e5,
        "crease_yield_deg": 35, "crease_set_rate": 0.5, "score_factor": 0.35,
        "perf_factor": 0.2, "tear_strain": 0.02, "friction": 0.4,
        "collision_thickness": 0.1,
    },
    "derived_basis": "test fixture",
}
STOCKS = {"kami": KAMI, "card": {**KAMI, "caliper_mm": 0.3,
                                 "derived": {**KAMI["derived"], "collision_thickness": 0.3}}}


@pytest.fixture
def stocks() -> dict:
    return {k: dict(v) for k, v in STOCKS.items()}
