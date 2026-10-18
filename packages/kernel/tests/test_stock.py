"""Stock cards: derive() mapping, validation, schema conformance and the drift gate."""

from __future__ import annotations

import copy
import json
import math
import re
from pathlib import Path

import pytest

from pliego import stock

REPO = Path(__file__).resolve().parents[3]
MATERIALS = REPO / "materials"
SCHEMAS = REPO / "packages" / "schemas"
EXPECTED_SLUGS = {
    "papel-de-china", "washi-kozo-30", "kami", "tant", "copy-80", "elephant-hide-110",
    "kraft-120", "amate", "cardstock-160", "cardstock-250", "cardstock-300", "foil-paper",
    "pet-125", "pp-300",
    # board and foam stocks (lane P, wave 2b): pliego.board constructions and plain cards
    "corrugated-e-flute", "corrugated-b-flute", "corrugated-c-flute", "corrugated-f-flute",
    "corrugated-bc-double-wall", "corrugated-aac-triple-wall", "corrugated-single-face-b",
    "folding-boxboard-300", "sbs-board-350", "greyboard-1500", "kraftliner-150",
    "eva-foam-2mm", "eva-foam-5mm", "eva-foam-hd-6mm",
}


def _card(slug: str) -> dict:
    return json.loads((MATERIALS / slug / "stock.json").read_text(encoding="utf-8"))


# ------------------------------------------------- a tiny JSON Schema 2020-12 subset validator

_TYPES = {
    "object": dict, "array": list, "string": str, "boolean": bool, "null": type(None),
}


def _is_type(value, name: str) -> bool:
    if name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    return isinstance(value, _TYPES[name])


def _resolve(root: dict, ref: str) -> dict:
    assert ref.startswith("#/"), ref
    node = root
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def schema_errors(value, schema, root, path="$") -> list[str]:  # noqa: C901 - small validator
    errs: list[str] = []
    if schema is True:
        return errs
    if "$ref" in schema:
        errs += schema_errors(value, _resolve(root, schema["$ref"]), root, path)
    for sub in schema.get("allOf", []):
        errs += schema_errors(value, sub, root, path)
    if "if" in schema and not schema_errors(value, schema["if"], root, path):
        errs += schema_errors(value, schema.get("then", True), root, path)
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_is_type(value, t) for t in types):
            return errs + [f"{path}: type {types}"]
    if "const" in schema and value != schema["const"]:
        errs.append(f"{path}: const")
    if "enum" in schema and value not in schema["enum"]:
        errs.append(f"{path}: enum {value!r}")
    if _is_type(value, "number"):
        if "minimum" in schema and value < schema["minimum"]:
            errs.append(f"{path}: minimum")
        if "maximum" in schema and value > schema["maximum"]:
            errs.append(f"{path}: maximum")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            errs.append(f"{path}: exclusiveMinimum")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            errs.append(f"{path}: minLength")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errs.append(f"{path}: pattern")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            errs.append(f"{path}: minItems")
        if "items" in schema:
            for k, item in enumerate(value):
                errs += schema_errors(item, schema["items"], root, f"{path}[{k}]")
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errs.append(f"{path}: missing {key}")
        props = schema.get("properties", {})
        for key, item in value.items():
            if key in props:
                errs += schema_errors(item, props[key], root, f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                errs.append(f"{path}: unexpected {key}")
    return errs


# ------------------------------------------------------------------------------- tests


def test_every_expected_card_is_committed():
    assert set(stock.list_slugs(MATERIALS)) == EXPECTED_SLUGS


def test_copy_paper_worked_example():
    """rsE §a4: copy 80 g/m², t = 0.1 mm, E_md = 5.5 GPa → D_md ≈ 5.0e-4 N·m = 5.0e5 engine."""
    d = stock.derive(_card("copy-80"))
    assert d["areal_density"] == 8e-05
    assert d["thickness"] == 0.1
    assert d["E_md"] == 5.5e9 and d["E_cd"] == 2.5e9
    expected = 5.5e9 * 0.1 ** 3 / (12 * (1 - 0.293 ** 2))
    assert math.isclose(d["D_md"], expected, rel_tol=1e-5)
    assert math.isclose(d["D_md"], 5.0e5, rel_tol=0.01)
    # crease hinge: D/L*, L* = 200 t = 20 mm, direction-averaged D
    l_star = 200 * 0.1
    assert math.isclose(d["crease_k"], math.sqrt(d["D_md"] * d["D_cd"]) / l_star, rel_tol=1e-5)
    assert d["crease_yield_deg"] == 35
    assert d["perf_factor"] == 0.25          # 1 mm bridge per 4 mm pitch
    assert d["collision_thickness"] == 0.1


def test_measured_bending_overrides_plate_formula():
    card = copy.deepcopy(_card("copy-80"))
    card["physical"]["bending_stiffness_mNm"] = {
        "md": 0.42, "cd": 0.2, "method": "ASTM D1388 cantilever", "source": "lab note",
    }
    d = stock.derive(card)
    assert d["D_md"] == 0.42e6 and d["D_cd"] == 0.2e6
    assert stock.validate(card, "copy-80") == []


def test_derive_returns_exactly_the_spec_keys():
    schema = json.loads((SCHEMAS / "sheet-document.schema.json").read_text(encoding="utf-8"))
    required = schema["$defs"]["stockSnapshot"]["properties"]["derived"]["required"]
    optional = set(schema["$defs"]["stockSnapshot"]["properties"]["derived"]["properties"]) \
        - set(required)
    for slug in EXPECTED_SLUGS:
        keys = list(stock.derive(_card(slug)))
        assert keys[:len(stock.DERIVED_KEYS)] == list(stock.DERIVED_KEYS)
        assert set(keys[len(stock.DERIVED_KEYS):]) <= set(stock.OPTIONAL_DERIVED_KEYS)
    assert set(stock.DERIVED_KEYS) == set(required)
    assert set(stock.OPTIONAL_DERIVED_KEYS) | set(stock.LAMINATE_DERIVED_KEYS) == optional
    for slug in EXPECTED_SLUGS:      # laminate-only keys (spec §5.40) never come from one card
        assert not set(stock.derive(_card(slug))) & set(stock.LAMINATE_DERIVED_KEYS)


def test_optional_derived_keys_from_existing_card_fields():
    card = _card("copy-80")
    d = stock.derive(card)
    assert math.isclose(d["G12"], 0.387 * math.sqrt(d["E_md"] * d["E_cd"]), rel_tol=1e-5)
    assert math.isclose(d["score_yield_deg"], d["crease_yield_deg"] * d["score_factor"],
                        rel_tol=1e-5)
    perf = card["fabrication"]["perforation"]
    assert (d["perf_cut_mm"], d["perf_bridge_mm"]) == (perf["cut_mm"], perf["bridge_mm"])
    assert math.isclose(d["perf_factor"], d["perf_bridge_mm"] / (d["perf_cut_mm"]
                                                                 + d["perf_bridge_mm"]))
    bare = copy.deepcopy(card)
    del bare["fabrication"]["perforation"]
    d2 = stock.derive(bare)
    assert "perf_cut_mm" not in d2 and "perf_bridge_mm" not in d2 and "G12" in d2


def test_snapshot_carries_the_card_appearance():
    card = _card("kami")
    snap = stock.snapshot(card)
    assert snap["appearance"] == {"front": card["appearance"]["front"],
                                  "back": card["appearance"]["back"]}


def test_stock_card_schema_derived_mirrors_sheet_document():
    doc = json.loads((SCHEMAS / "sheet-document.schema.json").read_text(encoding="utf-8"))
    card_schema = json.loads((SCHEMAS / "stock-card.schema.json").read_text(encoding="utf-8"))
    assert card_schema["properties"]["derived"] == \
        doc["$defs"]["stockSnapshot"]["properties"]["derived"]
    assert card_schema["properties"]["derived_basis"]["const"] == stock.DERIVE_BASIS


@pytest.mark.parametrize("slug", sorted(EXPECTED_SLUGS))
def test_card_conforms_to_schema_and_validator(slug):
    schema = json.loads((SCHEMAS / "stock-card.schema.json").read_text(encoding="utf-8"))
    card = _card(slug)
    assert schema_errors(card, schema, schema) == []
    assert stock.validate(card, slug) == []
    assert card["provenance"]["license"] == "CERN-OHL-W-2.0"


@pytest.mark.parametrize("slug", sorted(EXPECTED_SLUGS))
def test_snapshot_conforms_to_sheet_document_schema(slug):
    schema = json.loads((SCHEMAS / "sheet-document.schema.json").read_text(encoding="utf-8"))
    snap = stock.load_snapshot(slug, MATERIALS)
    assert schema_errors(snap, schema["$defs"]["stockSnapshot"], schema) == []


def test_heritage_stocks_cite_every_claim():
    for slug in ("papel-de-china", "amate", "washi-kozo-30"):
        heritage = _card(slug)["provenance"]["heritage"]
        assert heritage["claims"]
        for claim in heritage["claims"]:
            assert claim["source"].startswith("https://")
            assert claim["en"] and claim["es"]


def test_validator_rejects_bad_cards():
    card = copy.deepcopy(_card("copy-80"))
    del card["physical"]["E_md_gpa"]["basis"]
    card["stock"]["name"].pop("pt")
    card["physical"]["nu"]["value"] = 0.7
    kinds = {i["kind"] for i in stock.validate(card, "copy-80")}
    assert {"physical_basis", "i18n", "physical_value"} <= kinds
    measured = copy.deepcopy(_card("copy-80"))
    measured["physical"]["E_md_gpa"] = {"value": 5.0, "status": "measured", "source": "lab"}
    assert {i["kind"] for i in stock.validate(measured)} == {"physical_method"}
    assert any(i["kind"] == "slug" for i in stock.validate(_card("kami"), "tant"))


def test_load_card_fails_closed(tmp_path):
    with pytest.raises(stock.StockError):
        stock.load_card("no-such-stock", MATERIALS)
    with pytest.raises(stock.StockError):
        stock.load_card("../etc", MATERIALS)
    bad = copy.deepcopy(_card("copy-80"))
    bad["physical"]["gsm"]["status"] = "guessed"
    (tmp_path / "copy-80").mkdir()
    (tmp_path / "copy-80" / "stock.json").write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(stock.StockError):
        stock.load_card("copy-80", tmp_path)


def test_drift_gate_passes_on_committed_cards(capsys):
    assert stock.main(["--check", str(MATERIALS)]) == 0
    assert f"stock: cards={len(EXPECTED_SLUGS)} drift=0" in capsys.readouterr().out


def test_drift_gate_detects_drift_and_write_repairs(tmp_path, capsys):
    card = _card("kami")
    card["derived"]["crease_k"] = 1.0
    (tmp_path / "kami").mkdir()
    (tmp_path / "kami" / "stock.json").write_text(stock.dump_card(card), encoding="utf-8")
    assert stock.main(["--check", str(tmp_path)]) == 1
    assert "stock: cards=1 drift=1" in capsys.readouterr().out
    assert stock.main(["--write", str(tmp_path)]) == 0
    assert stock.main(["--check", str(tmp_path)]) == 0


def test_drift_gate_fails_on_zero_cards(tmp_path, capsys):
    assert stock.main(["--check", str(tmp_path)]) == 1
    assert "stock: cards=0 drift=0" in capsys.readouterr().out


def test_committed_files_are_canonical():
    for slug in EXPECTED_SLUGS:
        path = MATERIALS / slug / "stock.json"
        assert path.read_text(encoding="utf-8") == stock.dump_card(_card(slug))
