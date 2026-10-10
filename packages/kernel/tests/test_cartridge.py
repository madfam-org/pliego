from __future__ import annotations

import json
import shutil
from pathlib import Path

import pliego
from pliego import cartridge
from pliego.cartridge import check_result, find_result, main

FIXTURE = Path(__file__).parent / "fixtures" / "valley-fold"


def _stocks_file(tmp_path: Path, stocks: dict) -> str:
    p = tmp_path / "stocks.json"
    p.write_text(json.dumps(stocks), encoding="utf-8")
    return str(p)


def test_cli_renders_every_mode_and_preset(tmp_path, stocks, capsys):
    out = tmp_path / "out"
    code = main([str(FIXTURE), "--out", str(out), "--stocks", _stocks_file(tmp_path, stocks)])
    lines = capsys.readouterr().out.strip().splitlines()
    assert code == 0
    assert lines == [
        "verify: cartridge=valley-fold mode=default sheets=1 vertices=4 edges=5 faces=2 joins=0 "
        "errors=0 warnings=0",
        "verify: cartridge=valley-fold mode=default:small sheets=1 vertices=4 edges=5 faces=2 "
        "joins=0 errors=0 warnings=0",
    ]
    doc = pliego.Document.from_json((out / "valley-fold.default.fold").read_text())
    assert doc.verify() == [] and doc.data["pliego:meta"]["cartridge"] == "valley-fold"
    assert doc.data["pliego:meta"]["params"] == {"size": 150}
    small = pliego.Document.from_json((out / "valley-fold.default.small.fold").read_text())
    assert max(c[0] for c in small.data["vertices_coords"]) == 75


def test_cli_params_and_mode(tmp_path, stocks, capsys):
    code = main([str(FIXTURE), "--mode", "default", "--params", '{"size": 60}',
                 "--stocks", _stocks_file(tmp_path, stocks)])
    assert code == 0
    assert "mode=default " in capsys.readouterr().out


def test_cli_fails_closed(tmp_path, stocks, capsys):
    bad = tmp_path / "bad"
    shutil.copytree(FIXTURE, bad)
    (bad / "main.py").write_text("import os\nresult = None\n", encoding="utf-8")
    assert main([str(bad), "--stocks", _stocks_file(tmp_path, stocks)]) == 1
    assert "errors=1" in capsys.readouterr().out
    assert main([str(tmp_path / "missing")]) == 1
    assert main([str(FIXTURE), "--params", "[]"]) == 1


def test_check_result_contract(stocks):
    s = pliego.Sheet("s", pliego.square(10))
    ok = check_result(s, stocks=stocks)
    assert ok.ok and ok.line.startswith("verify: sheets=1")
    assert not check_result(42).ok
    assert check_result(pliego.Sheet("t", pliego.square(10), stock="ghost")).exit_code == 1
    assert find_result({"result": s}) is s
    assert cartridge.param(lambda: undefined_name, 3) == 3  # noqa: F821
    assert cartridge.clamp(500, 0, 300) == 300


def test_module_entry_point(tmp_path, stocks):
    import subprocess
    import sys

    src = Path(__file__).resolve().parents[1] / "src"
    proc = subprocess.run(
        [sys.executable, "-m", "pliego.cartridge", str(FIXTURE), "--mode", "default",
         "--stocks", _stocks_file(tmp_path, stocks)],
        capture_output=True, text=True, timeout=60, env={"PYTHONPATH": str(src)}, check=False)
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.startswith("verify: cartridge=valley-fold mode=default sheets=1")
    assert "RuntimeWarning" not in proc.stderr
