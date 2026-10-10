"""The runner injects `mode` (the mode id) as a bare global, exactly like `python -m
pliego.cartridge`, and the kernel's top-level cartridge helpers are reachable in the sandbox."""

from __future__ import annotations

import json
import subprocess
import sys

from conftest import KERNEL_SRC, REPO, needs_kernel

RUNNER = REPO / "apps" / "api" / "services" / "engine" / "pliego_runner.py"

SCRIPT = """\
import pliego

size = pliego.clamp(pliego.param(lambda: size, 120.0), 60.0, 300.0)  # noqa: F821
run_mode = pliego.param(lambda: mode, "standalone")  # noqa: F821
sheet = pliego.Sheet("square", pliego.square(size), stock="kami")
if run_mode == "half":
    sheet.valley((size / 2, 0), (size / 2, size), angle=90)
elif run_mode == "diagonal":
    sheet.valley((0, 0), (size, size), angle=90)
else:
    raise ValueError("unexpected mode " + repr(run_mode))
result = sheet
"""


def run(tmp_path, mode: str | None, params: dict):
    cart = tmp_path / f"cart-{mode}"
    cart.mkdir()
    (cart / "main.py").write_text(SCRIPT)
    out = tmp_path / f"out-{mode}"
    out.mkdir()
    cmd = [sys.executable, "-I", "-B", str(RUNNER), str(cart / "main.py"), str(out),
           "--params", json.dumps(params), "--materials", str(REPO / "materials"),
           "--kernel-path", str(KERNEL_SRC), "--cartridge", "mode-probe"]
    if mode is not None:
        cmd += ["--mode", mode]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60, cwd=cart,
                          env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)},
                          stdin=subprocess.DEVNULL)
    doc = json.loads((out / "document.fold").read_text()) if (out / "document.fold").exists() \
        else None
    return proc, doc


def test_runner_injects_mode_as_a_global(tmp_path):
    needs_kernel()
    proc, doc = run(tmp_path, "half", {"size": 100.0})
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip().startswith("verify: sheets=1") and "errors=0" in proc.stdout
    assert doc["pliego:meta"]["mode"] == "half"
    assert doc["pliego:meta"]["cartridge"] == "mode-probe"
    xs = sorted({round(c[0], 3) for c in doc["vertices_coords"]})
    assert xs == [0, 50.0, 100.0]          # the crease of mode `half` runs through x = 50

    proc, doc = run(tmp_path, "diagonal", {"size": 400.0})
    assert proc.returncode == 0, proc.stderr
    assert doc["pliego:meta"]["mode"] == "diagonal"
    assert max(c[0] for c in doc["vertices_coords"]) == 300   # pliego.clamp in the sandbox


def test_runner_mode_wins_over_a_parameter_named_mode(tmp_path):
    """As in the CLI (`{**params, "mode": mode}`), the runner's mode id is authoritative."""
    needs_kernel()
    proc, doc = run(tmp_path, "half", {"mode": "diagonal"})
    assert proc.returncode == 0, proc.stderr
    assert doc["pliego:meta"]["mode"] == "half"
    assert len(doc["vertices_coords"]) == 6


def test_runner_default_mode(tmp_path):
    needs_kernel()
    proc, _doc = run(tmp_path, None, {})
    assert proc.returncode == 1                                  # `default` is not half/diagonal
    assert "unexpected mode 'default'" in proc.stderr
