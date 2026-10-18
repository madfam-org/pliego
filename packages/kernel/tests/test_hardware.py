"""hardware_ref, name-level, against the vendored yantra4d snapshot (spec §5.42, rule 41)."""

from __future__ import annotations

import json

from pliego import Assembly, Sheet, hardware, pivot, rectangle
from pliego.cartridge import main
from pliego.document_verify import verify_document

CLASP = {"platform": "yantra4d", "project_slug": "magnetic-clasp", "linked": True,
         "mode": "set", "params_map": {"magnet_dia": "clasp_d", "disc_dia": "max(clasp_d + 6, 10)"}}


def test_snapshot_is_pinned_and_has_the_clasp():
    data = json.loads(hardware.SNAPSHOT_FILE.read_text(encoding="utf-8"))
    assert len(data["upstream_commit"]) == 40
    part = hardware.catalog()["magnetic-clasp"]
    assert {"magnet_dia", "disc_dia"} <= set(part["parameter_ids"])
    assert "set" in part["mode_ids"]


def test_a_good_reference_resolves():
    assert hardware.ref_problems(CLASP, {"clasp_d"}) == []


def test_bad_references_fail_loud():
    unknown = {**CLASP, "project_slug": "no-such-part"}
    assert "not in the vendored" in hardware.ref_problems(unknown, {"clasp_d"})[0]
    bad = {**CLASP, "mode": "triple", "params_map": {"nope": "clasp_d", "magnet_dia": "__x__()",
                                                     "disc_h": "height"}}
    text = " ".join(hardware.ref_problems(bad, {"clasp_d"}))
    assert "mode 'triple'" in text and "'nope' is not a parameter" in text
    assert "not a safe expression" in text and "reads 'height'" in text
    assert hardware.ref_problems({**CLASP, "platform": "fashion-cabinet"})


def test_rule41_checks_join_references():
    a = Sheet("a", rectangle(40, 40))
    b = Sheet("b", rectangle(40, 40))
    ok = pivot("brad", ("a", (20, 20)), ("b", (20, 20)),
               hardware_ref={"platform": "yantra4d", "project_slug": "magnetic-clasp"})
    bad = pivot("brad", ("a", (20, 20)), ("b", (20, 20)),
                hardware_ref={"platform": "yantra4d", "project_slug": "no-such-part"})
    good_doc = Assembly([a, b], joins=[ok]).build()
    assert not [i for i in verify_document(good_doc) if i.get("rule") == 41]
    bad_doc = Assembly([Sheet("a", rectangle(40, 40)), Sheet("b", rectangle(40, 40))],
                       joins=[bad]).build()
    assert [i["kind"] for i in verify_document(bad_doc) if i.get("rule") == 41] == [
        "hardware_ref"]


def _cartridge(tmp_path, ref):
    root = tmp_path / "clasp-card"
    root.mkdir()
    (root / "project.json").write_text(json.dumps({
        "project": {"slug": "clasp-card"}, "modes": [{"id": "default", "script_file": "main.py"}],
        "parameters": [{"id": "clasp_d", "default": 12}], "hardware_ref": ref}))
    (root / "main.py").write_text("result = pliego.Sheet('s', pliego.rectangle(40, 40))\n")
    return root


def test_cartridge_cli_resolves_the_manifest_reference(tmp_path, stocks, capsys):
    sfile = tmp_path / "stocks.json"
    sfile.write_text(json.dumps(stocks))
    assert main([str(_cartridge(tmp_path, CLASP)), "--stocks", str(sfile)]) == 0
    assert "refs: cartridge=clasp-card hardware_ref=1 material_ref=0 unresolved=0" in \
        capsys.readouterr().out
    bad = {**CLASP, "project_slug": "no-such-part"}
    other = tmp_path / "b"
    other.mkdir()
    assert main([str(_cartridge(other, bad)), "--stocks", str(sfile)]) == 1
    assert "unresolved=1" in capsys.readouterr().out
