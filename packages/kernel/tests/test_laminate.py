"""pliego.laminate against the keystone's laminate calculator (golden numbers, spec §5.40).

The goldens in ``fixtures/laminates/*.golden.json`` are the keystone's own output
(``hyperobjects_sheet.laminate_behaviour``) on the same layers, written and drift-checked by
``scripts/qa/verify_sheet_behaviour.py``. The kernel never imports the keystone; it must agree
with it to the keystone's six significant digits.
"""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path

import pytest

from pliego import Assembly, Sheet, laminate, rectangle, stock
from pliego.document_verify import verify_document

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
MATERIALS = REPO / "materials"
LAMINATES = HERE / "fixtures" / "laminates"
CASES = sorted(p.stem for p in LAMINATES.glob("*.json") if not p.name.endswith(".golden.json"))
REL = 2e-5            # the goldens are rounded to 6 significant digits


def _layers(doc: dict) -> list[dict]:
    out = []
    for spec in doc["layers"]:
        ref = spec["material_ref"]
        kw = {"angle_deg": spec.get("angle_deg", 0.0)}
        if "thickness_mm" in spec:
            kw["thickness_mm"] = spec["thickness_mm"]
        if ref["platform"] == "pliego":
            out.append(laminate.layer(stock=ref["material_slug"], **kw))
        else:
            out.append(laminate.layer(material_ref=ref, **kw))
    return out


def _close(a: float, b: float, scale: float) -> bool:
    return math.isclose(a, b, rel_tol=REL, abs_tol=REL * scale)


def test_there_are_goldens():
    assert {"bookcloth-on-cardstock", "cloth-manta-on-kraft", "cloth-popelina-on-kraft"} <= set(
        CASES)


@pytest.mark.parametrize("case", CASES)
def test_matches_keystone_golden(case):
    doc = json.loads((LAMINATES / f"{case}.json").read_text(encoding="utf-8"))
    gold = json.loads((LAMINATES / f"{case}.golden.json").read_text(encoding="utf-8"))
    res = laminate.compute(_layers(doc), MATERIALS)
    assert _close(res["thickness_m"] * 1e3, gold["caliper_mm"], 1)
    assert _close(res["areal_density_kg_m2"], gold["areal_density_kg_m2"], 1)
    for block in ("A", "B", "D"):
        mine, theirs = res[block], gold["laminate"][block]
        scale = max(abs(x) for row in theirs for x in row) or 1.0
        for i in range(3):
            for j in range(3):
                assert _close(mine[i][j], theirs[i][j], scale), (block, i, j)
    assert res["coupled"] is gold["laminate"]["coupled"]
    assert _close(res["coupling_ratio"], gold["laminate"]["coupling_ratio"], 1)
    eff = res["effective"]
    for k, v in {**gold["membrane"], **gold["bending"]}.items():
        assert _close(eff[k], v, abs(v)), k


def test_case_cloth_snapshot_is_a_valid_stock_for_the_engine():
    layers = [laminate.layer(stock="kraft-120"),
              laminate.layer(material_ref={"platform": "fashion-cabinet",
                                           "material_slug": "manta-cruda", "behaviour": "sheet"})]
    snap = laminate.stock({"en": "Cloth", "es": "Tela", "fr": "Toile", "pt": "Tecido"}, layers,
                          root=MATERIALS)
    gold = json.loads((LAMINATES / "cloth-manta-on-kraft.golden.json").read_text("utf-8"))
    der = snap["derived"]
    assert snap["derived_basis"] == laminate.LAMINATE_BASIS
    assert set(stock.DERIVED_KEYS) <= set(der)
    # engine units: D in g·mm²/s² = N·m × 1e9, E in g/(mm·s²) = Pa
    assert _close(der["D_md"], gold["bending"]["D11"] * 1e9, der["D_md"])
    assert _close(der["D_cd"], gold["bending"]["D22"] * 1e9, der["D_cd"])
    assert _close(der["E_md"], gold["membrane"]["E1t"] / (gold["caliper_mm"] * 1e-3), der["E_md"])
    assert _close(der["D12"], gold["bending"]["D12"] * 1e9, der["D12"])
    assert _close(der["D66"], gold["bending"]["D66"] * 1e9, der["D66"])
    assert der["thickness"] == snap["caliper_mm"] == 0.51
    kraft = stock.derive(stock.load_card("kraft-120", MATERIALS))
    assert snap["laminate"]["governing_layer"] == 0          # the kraft, not the cloth
    assert der["tear_strain"] == kraft["tear_strain"]
    assert der["crease_yield_deg"] == kraft["crease_yield_deg"]
    assert snap["laminate"]["coupled"] is True
    assert snap["laminate"]["layers"][1]["material_ref"]["material_slug"] == "manta-cruda"


def test_a_document_records_the_laminate_and_verifies(stocks):
    layers = [laminate.layer(stock="kraft-120"),
              laminate.layer(material_ref={"platform": "fashion-cabinet",
                                           "material_slug": "popelina-algodon",
                                           "behaviour": "sheet"})]
    cloth = laminate.stock("Cloth", layers, root=MATERIALS)
    sheet = Sheet("cover", rectangle(120, 80), stock="case-cloth")
    doc = Assembly([sheet], stocks={"case-cloth": cloth}).build()
    snap = doc.data["pliego:stocks"]["case-cloth"]
    assert snap["laminate"]["layers"][0]["stock"] == "kraft-120"
    assert laminate.material_refs(doc.data["pliego:stocks"]) == [
        {"platform": "fashion-cabinet", "material_slug": "popelina-algodon",
         "behaviour": "sheet"}]
    assert [i for i in verify_document(doc) if i["level"] == "error"] == []


def test_rule40_rejects_an_inconsistent_laminate():
    cloth = laminate.stock("Cloth", [laminate.layer(stock="kraft-120"),
                                     laminate.layer(stock="copy-80")], root=MATERIALS)
    doc = Assembly([Sheet("cover", rectangle(50, 50), stock="lam")], stocks={"lam": cloth}).build()
    bad = copy.deepcopy(doc.data)
    bad["pliego:stocks"]["lam"]["laminate"]["layers"][0]["thickness_mm"] = 1.0
    bad["pliego:stocks"]["lam"]["laminate"]["coupled"] = False
    kinds = {i["kind"] for i in verify_document(type(doc)(bad)) if i["level"] == "error"}
    assert "laminate" in kinds
    plain = copy.deepcopy(doc.data)
    plain["pliego:stocks"]["lam"].pop("laminate")
    assert "laminate" in {i["kind"] for i in verify_document(type(doc)(plain))
                          if i["level"] == "error"}


def test_layers_fail_loud():
    with pytest.raises(laminate.LaminateError, match="exactly one"):
        laminate.layer()
    with pytest.raises(laminate.LaminateError, match="not in the vendored"):
        laminate.compute([laminate.layer(material_ref={
            "platform": "fashion-cabinet", "material_slug": "no-such-cloth",
            "behaviour": "sheet"})], MATERIALS)
    with pytest.raises(laminate.LaminateError, match="thin-print"):
        laminate.compute([laminate.layer(material_ref={
            "platform": "yantra4d", "material_slug": "bambu-tpu-95a", "behaviour": "sheet"})],
            MATERIALS)
    with pytest.raises(laminate.LaminateError, match="Pliego stock layer"):
        laminate.stock("Cloth only", [laminate.layer(material_ref={
            "platform": "fashion-cabinet", "material_slug": "manta-cruda",
            "behaviour": "sheet"})], root=MATERIALS)


def test_every_card_carries_a_valid_sheet_behaviour_block():
    for path in sorted(MATERIALS.glob("*/stock.json")):
        card = json.loads(path.read_text(encoding="utf-8"))
        sb = card["sheet_behaviour"]
        assert sb["source"] == {"platform": "pliego", "material_slug": path.parent.name,
                                "rule": "pliego-stock/1", "card_basis": stock.DERIVE_BASIS}
        assert stock.validate(card, path.parent.name) == []
        bad = copy.deepcopy(card)
        bad["sheet_behaviour"]["source"]["material_slug"] = "other"
        assert "sheet_behaviour" in {i["kind"] for i in stock.validate(bad, path.parent.name)}
