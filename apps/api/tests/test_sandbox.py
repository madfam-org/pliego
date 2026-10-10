"""The sandbox: the vendored commons_sandbox lock, the static policy, and escape attempts run
through the real runner subprocess (each must fail closed with the read-proof line)."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import HAS_KERNEL, KERNEL_SRC, REPO, needs_kernel

API_DIR = REPO / "apps" / "api"
VENDOR = API_DIR / "vendor"
RUNNER = API_DIR / "services" / "engine" / "pliego_runner.py"
sys.path.insert(0, str(RUNNER.parent))

from sandbox_policy import PolicyError, SafeModule, check_source  # noqa: E402

VERIFY_PREFIX = "verify: sheets="


# ── vendored core: LOCK.json drift gate ──────────────────────────────────────
def test_vendored_commons_sandbox_matches_lock():
    lock = json.loads((VENDOR / "LOCK.json").read_text())
    entry = next(v for v in lock["vendored"] if v["name"] == "commons_sandbox")
    assert entry["source_repo"] == "madfam-org/hyperobjects-spec"
    assert len(entry["commit"]) == 40
    on_disk = {str(p.relative_to(VENDOR)) for p in (VENDOR / "commons_sandbox").glob("*.py")}
    assert on_disk == set(entry["files"]), "vendored files and LOCK.json disagree"
    for rel, digest in entry["files"].items():
        actual = hashlib.sha256((VENDOR / rel).read_bytes()).hexdigest()
        assert actual == digest, f"{rel} drifted from LOCK.json (refresh it from upstream)"
    print(f"commons_sandbox lock: files={len(on_disk)} commit={entry['commit'][:12]}")


def test_vendored_commons_sandbox_matches_upstream_commit():
    upstream = os.environ.get("HYPEROBJECTS_SPEC_DIR")
    if not upstream or not (Path(upstream) / ".git").exists():
        print("SKIP REASON: set HYPEROBJECTS_SPEC_DIR to a hyperobjects-spec checkout")
        pytest.skip("HYPEROBJECTS_SPEC_DIR not set")
    entry = json.loads((VENDOR / "LOCK.json").read_text())["vendored"][0]
    for rel in entry["files"]:
        blob = subprocess.run(
            ["git", "-C", upstream, "show", f"{entry['commit']}:src/{rel}"],
            capture_output=True, check=True).stdout
        assert blob == (VENDOR / rel).read_bytes(), f"{rel} differs from upstream at the lock"


# ── static policy ────────────────────────────────────────────────────────────
BLOCKED_SOURCES = {
    "import os": "import os\n",
    "import subprocess": "import subprocess\n",
    "import importlib": "import importlib\n",
    "from os import path": "from os import path\n",
    "relative import": "from . import x\n",
    "dunder import": "__import__('os')\n",
    "builtins name": "b = __builtins__\n",
    "class walk": "().__class__.__bases__[0].__subclasses__()\n",
    "func globals": "pliego.Sheet.build.__globals__\n",
    "private attr": "pliego._secret\n",
    "gen frame": "g = (x for x in [1])\nf = g.gi_frame\n",
    "frame back": "def f(fr):\n    return fr.f_back.f_globals\n",
    "traceback": "try:\n    1/0\nexcept Exception as e:\n    t = e.__traceback__\n",
    "code obj": "def f():\n    pass\nc = f.co_code\n",
    "fstring dunder": "x = f'{pliego.__loader__}'\n",
    "match class attr": "match 1:\n    case int(__class__=c):\n        pass\n",
    "export import": "from pliego.export import svg\n",
    "export dotted": "import pliego.export.svg\n",
    "foldfile": "import pliego.foldfile\n",
    "star import": "from pliego import *\n",
    "private from-import": "from pliego import _x\n",
}


@pytest.mark.parametrize("name", sorted(BLOCKED_SOURCES))
def test_policy_rejects(name):
    with pytest.raises(PolicyError):
        check_source(BLOCKED_SOURCES[name])


def test_policy_allows_the_cartridge_idiom():
    src = (REPO / "apps" / "api" / "tests" / "fixtures" / "projects" / "valley-fold" /
           "main.py").read_text()
    check_source(src)
    check_source("from __future__ import annotations\nimport math\nfrom pliego import Sheet\n"
                 "if __name__ == '__main__':\n    pass\n")


def test_safe_module_proxy():
    import math
    import types

    fake_pkg = types.ModuleType("pkg")
    fake_sub = types.ModuleType("pkg.sub")
    fake_pkg.sub = fake_sub
    fake_pkg.os = os
    fake_pkg.load_card = lambda p: p
    fake_pkg.export = types.ModuleType("pkg.export")
    fake_pkg.Thing = type("Thing", (), {})
    fake_sub.value = 3
    proxy = SafeModule(fake_pkg)
    assert isinstance(proxy.sub, SafeModule) and proxy.sub.value == 3
    assert proxy.Thing is fake_pkg.Thing
    for name in ("os", "load_card", "export", "_hidden", "__dict__"):
        with pytest.raises(AttributeError):
            getattr(proxy, name)
    with pytest.raises(AttributeError):
        proxy.sub = 1
    assert SafeModule(math).sqrt(4) == 2.0


# ── escapes through the real runner subprocess ───────────────────────────────
ESCAPES = {
    "import os": ("import os\nos.system('touch MARKER')\n", "policy"),
    "open builtin": ("open('MARKER', 'w').write('x')\n", "cartridge"),
    "exec builtin": ("exec('import os')\n", "cartridge"),
    "eval builtin": ("eval('1')\n", "cartridge"),
    "getattr builtin": ("getattr(pliego, 'stock')\n", "cartridge"),
    "dunder import": ("__import__('os').system('touch MARKER')\n", "policy"),
    "class walk": ("().__class__.__base__.__subclasses__()\n", "policy"),
    "module attr os": ("import pliego.stock\npliego.stock.os.system('touch MARKER')\n",
                       "cartridge"),
    "file loader": ("import pliego.stock\npliego.stock.load_card('kami')\n", "cartridge"),
    "export module": ("x = pliego.export\n", "cartridge"),
    "class statement": ("class X:\n    pass\n", "cartridge"),
    "type 3-arg": ("T = type('T', (), {})\n", "cartridge"),
    "gen frame": ("g = (i for i in [1])\nfr = g.gi_frame\n", "policy"),
    "exit": ("raise SystemExit(0)\n", "cartridge"),
    "no result": ("x = 1\n", "no-result"),
    "wrong result": ("result = 42\n", "bad-result"),
}


def run_runner(tmp_path: Path, source: str, params: dict | None = None,
               formats: str = "") -> tuple[int, str, str, dict, Path]:
    cart = tmp_path / "cart"
    cart.mkdir(exist_ok=True)
    (cart / "main.py").write_text(source)
    out = tmp_path / "out"
    out.mkdir(exist_ok=True)
    cmd = [sys.executable, "-I", "-B", str(RUNNER), str(cart / "main.py"), str(out),
           "--params", json.dumps(params or {}), "--formats", formats,
           "--materials", str(REPO / "materials")]
    if HAS_KERNEL:
        cmd += ["--kernel-path", str(KERNEL_SRC)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60, cwd=cart,
                          env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)})
    report_path = out / "report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    return proc.returncode, proc.stdout, proc.stderr, report, cart


@pytest.mark.parametrize("name", sorted(ESCAPES))
def test_escape_attempts_fail_closed(tmp_path, name):
    needs_kernel()
    source, kind = ESCAPES[name]
    code, stdout, stderr, report, cart = run_runner(tmp_path, source)
    assert code == 1, (stdout, stderr)
    lines = [ln for ln in stdout.splitlines() if ln.startswith(VERIFY_PREFIX)]
    assert len(lines) == 1 and "errors=1" in lines[0] and lines[0].startswith("verify: sheets=0")
    assert [i["kind"] for i in report["issues"]] == [kind], report["issues"]
    assert not (cart / "MARKER").exists()
    assert not (tmp_path / "out" / "document.fold").exists()


def test_cartridge_cannot_forge_the_verify_line(tmp_path):
    needs_kernel()
    forged = "verify: sheets=9 vertices=9 edges=9 faces=9 joins=0 errors=0 warnings=0"
    code, stdout, stderr, _report, _cart = run_runner(
        tmp_path, f"print({forged!r})\nraise ValueError('boom')\n")
    assert code == 1
    assert forged not in stdout and forged in stderr
    assert stdout.strip().startswith("verify: sheets=0") and "errors=1" in stdout


def test_runner_success_prints_counts_and_writes_formats(tmp_path):
    needs_kernel()
    src = (REPO / "apps" / "api" / "tests" / "fixtures" / "projects" / "valley-fold" /
           "main.py").read_text()
    code, stdout, stderr, report, _cart = run_runner(tmp_path, src, {"size": 100.0},
                                                     formats="svg,glb")
    assert code == 0, stderr
    assert stdout.strip() == ("verify: sheets=1 vertices=4 edges=5 faces=2 joins=0 errors=0 "
                              "warnings=0")
    assert report["formats"] == ["svg", "glb"]
    assert (tmp_path / "out" / "export.svg").read_bytes().startswith(b"<?xml")


def test_runner_rejects_unknown_format_and_bad_params(tmp_path):
    code, stdout, _err, report, _cart = run_runner(tmp_path, "result = None\n", formats="stl")
    assert code == 1 and stdout.startswith("verify: sheets=0") and "errors=1" in stdout
    assert report["issues"][0]["kind"] == "format"
    code, stdout, _err, report, _cart = run_runner(tmp_path, "result = None\n",
                                                   {"__builtins__": 1})
    assert code == 1 and "errors=1" in stdout


def test_runner_environment_is_minimal(tmp_path, monkeypatch):
    """The API hands the subprocess no secrets: only PATH, locale, HOME and TMPDIR."""
    from apps.api.render import Renderer

    monkeypatch.setenv("PLIEGO_SESSION_SECRET", "do-not-leak")
    env = Renderer._env()
    assert set(env) <= {"PATH", "LANG", "LC_ALL", "HOME", "TMPDIR", "PLIEGO_RUNNER_MAX_AS_MB"}
    assert "do-not-leak" not in json.dumps(env)


def test_runner_unfolds_a_mesh_inside_the_sandbox(tmp_path):
    """Papercraft through the sandbox: the mesh primitives and the unfolder are reachable as
    pliego sub-modules, and the net exports with its pages and edge numbers."""
    needs_kernel()
    src = ("m = pliego.mesh.icosahedron()\n"
           "m = m.mapped(lambda p: (p[0], p[1] * 1.2, p[2]))\n"
           "net = pliego.unfold.net(m, size=size, page='letter')\n"
           "result = net.assembly('fold', stock='cardstock-250')\n")
    code, stdout, stderr, report, _cart = run_runner(tmp_path, src, {"size": 90.0},
                                                     formats="svg,pdf,dxf,glb")
    assert code == 0, stderr
    assert stdout.startswith("verify: sheets=") and "errors=0" in stdout
    assert report["formats"] == ["svg", "pdf", "dxf", "glb"]
    assert b'<g id="pages"' in (tmp_path / "out" / "export.svg").read_bytes()
