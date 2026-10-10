"""Tests for the scripts/qa lanes. Run: python -m unittest discover -s scripts/qa/tests -v

Each lane is exercised against a throwaway tree so a pass proves the lane can FAIL: every test that
asserts OK has a sibling that plants the defect and asserts the failure.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

QA = Path(__file__).resolve().parents[1]
REPO = QA.parents[1]


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, QA / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


pin = load("verify_commons_pin")
comp = load("verify_compliance")
paths = load("verify_deploy_paths")
host = load("verify_canonical_host")
chain = load("verify_supply_chain")
oapi = load("verify_openapi")


def run_main(mod, *argv: str) -> tuple[int, str]:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = mod.main(list(argv))
    return code, buf.getvalue()


def write(root: Path, rel: str, text: str) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(text), encoding="utf-8")
    return path


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "protocol.file.allow=always", *args],
        cwd=cwd, check=True, capture_output=True, text=True,
    ).stdout


class TmpCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="pliego-qa-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)


class CommonsPinTest(TmpCase):
    def _platform(self) -> Path:
        root = self.tmp / "platform"
        root.mkdir()
        git(root, "init", "-q")
        return root

    def _commons(self, cartridges: int) -> Path:
        commons = self.tmp / "sheet-hyperobjects"
        commons.mkdir()
        git(commons, "init", "-q")
        write(commons, "README.md", "commons\n")
        for i in range(cartridges):
            write(commons, f"obj-{i}/project.json", "{}\n")
        git(commons, "add", "-A")
        git(commons, "commit", "-qm", "init")
        return commons

    def test_unmounted_is_a_printed_skip(self) -> None:
        root = self._platform()
        code, out = run_main(pin, "--root", str(root))
        self.assertEqual(code, 0)
        self.assertIn("skip:", out)
        self.assertIn("state=unmounted", out)

    def test_unmounted_fails_with_require(self) -> None:
        code, out = run_main(pin, "--root", str(self._platform()), "--require")
        self.assertEqual(code, 1)
        self.assertIn("FAIL (unmounted)", out)

    def test_mounted_then_empty_gitlink_fails(self) -> None:
        root, commons = self._platform(), self._commons(2)
        git(root, "submodule", "add", "-q", str(commons), "projects")
        code, out = run_main(pin, "--root", str(root), "--require", "--min-cartridges", "2")
        self.assertEqual(code, 0, out)
        self.assertIn("state=mounted cartridges=2", out)
        # Simulate a checkout without submodules: the gitlink stays, the directory is empty.
        shutil.rmtree(root / "projects")
        (root / "projects").mkdir()
        code, out = run_main(pin, "--root", str(root))
        self.assertEqual(code, 1)
        self.assertIn("state=empty", out)

    def test_min_cartridges_and_wrong_remote(self) -> None:
        root, commons = self._platform(), self._commons(0)
        git(root, "submodule", "add", "-q", str(commons), "projects")
        code, out = run_main(pin, "--root", str(root), "--min-cartridges", "1")
        self.assertEqual(code, 1)
        self.assertIn("cartridges=0 < required 1", out)
        gm = (root / ".gitmodules").read_text().replace("sheet-hyperobjects", "other-commons")
        (root / ".gitmodules").write_text(gm)
        code, out = run_main(pin, "--root", str(root))
        self.assertEqual(code, 1)
        self.assertIn("state=drift", out)


class ComplianceTest(TmpCase):
    def _clean(self) -> Path:
        root = self.tmp
        write(root, "packages/kernel/pliego/sheet.py", "import math\nfrom fractions import Fraction\n")
        write(root, "packages/engine/src/solver.js", "import { vec } from './vec.js';\nexport const a = 1;\n")
        write(root, "materials/kami/stock.json", json.dumps({"stock": {"slug": "kami"}, "provenance": {"license": "CERN-OHL-W-2.0"}}))
        manifest = {
            "project": {"slug": "page-turn", "attribution": {"license": "CERN-OHL-W-2.0", "lineage": []}},
            "hyperobject": {"commons_license": "CERN-OHL-W-2.0"},
        }
        write(root, "projects/page-turn/project.json", json.dumps(manifest))
        write(root, "docs/licenses/CARVE-OUTS.md", "| slug | licence | ruling | reason |\n|---|---|---|---|\n")
        return root

    def test_clean_tree_passes_with_counts(self) -> None:
        code, out = run_main(comp, "--root", str(self._clean()))
        self.assertEqual(code, 0, out)
        self.assertIn("py_files=1 js_files=1", out)
        self.assertIn("manifests=1 stock_cards=1", out)

    def test_empty_tree_fails(self) -> None:
        code, out = run_main(comp, "--root", str(self.tmp))
        self.assertEqual(code, 1)
        self.assertIn("scanned 0 source files", out)

    def test_solid_modeler_imports_fail(self) -> None:
        root = self._clean()
        write(root, "apps/api/geo.py", "import cadquery as cq\nfrom OCP.BRep import X\n")
        write(root, "apps/web/x.js", "import Manifold from 'manifold-3d';\nconst r = await import('replicad');\n")
        code, out = run_main(comp, "--root", str(root))
        self.assertEqual(code, 1)
        for needle in ("`cadquery`", "`OCP`", "`manifold-3d`", "`replicad`"):
            self.assertIn(needle, out)

    def test_ai_outside_selva_fails(self) -> None:
        root = self._clean()
        write(root, "apps/api/ai.py", "import anthropic\nimport openai\nURL = 'https://api.openai.com/v1'\n")
        write(root, ".env.example", "OPENAI_API_KEY=\n")
        code, out = run_main(comp, "--root", str(root))
        self.assertEqual(code, 1)
        self.assertIn("`anthropic`", out)
        self.assertIn("without reading SELVA_BASE_URL", out)
        self.assertIn("api.openai.com", out)
        self.assertIn("OPENAI_API_KEY", out)

    def test_openai_sdk_pointed_at_selva_passes(self) -> None:
        root = self._clean()
        write(root, "apps/api/ai.py", "import os\nfrom openai import OpenAI\nc = OpenAI(base_url=os.environ['SELVA_BASE_URL'])\n")
        code, out = run_main(comp, "--root", str(root))
        self.assertEqual(code, 0, out)

    def test_prices_and_licence_fields_fail(self) -> None:
        root = self._clean()
        write(root, "materials/kami/stock.json", json.dumps({"stock": {"unit_price": 3}, "provenance": {"license": "MIT"}}))
        bad = {"project": {"attribution": {"license": "CERN-OHL-S-2.0"}}, "hyperobject": {"commons_license": "CERN-OHL-W-2.0"}}
        write(root, "projects/page-turn/project.json", json.dumps(bad))
        write(root, "projects/page-turn/LICENSE", "x\n")
        code, out = run_main(comp, "--root", str(root))
        self.assertEqual(code, 1)
        for needle in ("stock.unit_price", "provenance.license must be", "licence fields disagree", "lineage must be a list", "no per-cartridge licence file"):
            self.assertIn(needle, out)

    def test_carve_out_allows_a_registered_licence(self) -> None:
        root = self._clean()
        m = {"project": {"attribution": {"license": "CC-BY-4.0", "lineage": [{"source": "x"}]}}, "hyperobject": {"commons_license": "CC-BY-4.0"}}
        write(root, "projects/page-turn/project.json", json.dumps(m))
        self.assertEqual(run_main(comp, "--root", str(root))[0], 1)
        write(root, "docs/licenses/CARVE-OUTS.md", "| slug | licence | ruling | reason |\n|---|---|---|---|\n| page-turn | CC-BY-4.0 | r | why |\n")
        code, out = run_main(comp, "--root", str(root))
        self.assertEqual(code, 0, out)


DOCKERFILE = """\
FROM python:3.12-slim@sha256:00 AS build
COPY packages/kernel /src/kernel
COPY apps/api/requirements.txt /src/req.txt
COPY apps/api /app/apps/api
COPY llms.txt llms-full.txt /app/
FROM python:3.12-slim@sha256:00
COPY --from=build /app /app
"""


def workflow(paths_value: str) -> str:
    return textwrap.dedent(f"""\
        jobs:
          build-publish:
            uses: madfam-org/enclii/.github/workflows/build-publish.yml@{'a' * 40}
            with:
              services: |
                [{{"name":"pliego","dockerfile":"Dockerfile","paths":"{paths_value}"}}]
        """)


class DeployPathsTest(TmpCase):
    def _tree(self, paths_value: str) -> Path:
        write(self.tmp, "Dockerfile", DOCKERFILE)
        write(self.tmp, ".github/workflows/build-deploy.yml", workflow(paths_value))
        return self.tmp

    def test_matching_filter_passes(self) -> None:
        root = self._tree("Dockerfile .dockerignore packages/kernel apps/api llms.txt llms-full.txt")
        code, out = run_main(paths, "--root", str(root))
        self.assertEqual(code, 0, out)
        self.assertIn("services=1 copy_sources=5", out)

    def test_missing_and_extra_paths_fail(self) -> None:
        root = self._tree("Dockerfile packages/kernel apps llms.txt docs")
        code, out = run_main(paths, "--root", str(root))
        self.assertEqual(code, 1)
        self.assertIn("COPY source `llms-full.txt` is not in paths", out)
        self.assertIn("paths entry `docs` matches no COPY source", out)

    def test_repo_files_agree(self) -> None:
        code, out = run_main(paths, "--root", str(REPO))
        self.assertEqual(code, 0, out)


class CanonicalHostTest(TmpCase):
    def _copy_repo_config(self) -> Path:
        for rel in ("enclii.yaml", "janua.client.yaml", "infra/k8s/production/deployment.yaml"):
            dest = self.tmp / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / rel, dest)
        return self.tmp

    def test_repo_config_agrees(self) -> None:
        code, out = run_main(host, "--root", str(self._copy_repo_config()))
        self.assertEqual(code, 0, out)
        self.assertIn("hosts=3", out)

    def test_cors_drift_and_wildcard_fail(self) -> None:
        root = self._copy_repo_config()
        dep = root / "infra/k8s/production/deployment.yaml"
        dep.write_text(dep.read_text().replace("https://pliego.madfam.io,https://pliego-app.madfam.io", "https://*.madfam.io"))
        code, out = run_main(host, "--root", str(root))
        self.assertEqual(code, 1)
        self.assertIn("CORS origin 'https://*.madfam.io'", out)
        self.assertIn("PLIEGO_CORS_ORIGINS misses https://pliego.madfam.io", out)

    def test_redirect_port_and_source_drift_fail(self) -> None:
        root = self._copy_repo_config()
        jan = root / "janua.client.yaml"
        jan.write_text(jan.read_text().replace("https://pliego-app.madfam.io/auth/callback", "https://app.pliego.madfam.io/auth/callback"))
        enc = root / "enclii.yaml"
        enc.write_text(enc.read_text().replace("    - name: pliego-api.madfam.io\n      environment: production\n      port: 80", "    - name: pliego-api.madfam.io\n      environment: production"))
        write(root, "apps/api/cors.py", "ORIGINS = ['https://pliego-studio.madfam.io', 'https://auth.madfam.io']\n")
        code, out = run_main(host, "--root", str(root))
        self.assertEqual(code, 1)
        self.assertIn("names undeclared host 'app.pliego.madfam.io'", out)
        self.assertIn("pliego-api.madfam.io must pin `port: 80`", out)
        self.assertIn("https://pliego-studio.madfam.io is not an enclii.yaml host", out)
        self.assertNotIn("auth.madfam.io is not", out)


class SupplyChainTest(TmpCase):
    GOOD = f"""\
        on: push
        permissions:
          contents: read
        jobs:
          a:
            runs-on: ubuntu-24.04
            timeout-minutes: 5
            steps:
              - uses: actions/checkout@{'b' * 40} # v7
          b:
            uses: madfam-org/enclii/.github/workflows/build-publish.yml@{'c' * 40}
            secrets:
              X: y
        """

    def test_good_workflow_passes_and_repo_passes(self) -> None:
        write(self.tmp, ".github/workflows/ci.yml", self.GOOD)
        self.assertEqual(run_main(chain, "--root", str(self.tmp))[0], 0)
        code, out = run_main(chain, "--root", str(REPO))
        self.assertEqual(code, 0, out)

    def test_violations_fail(self) -> None:
        bad = (textwrap.dedent(self.GOOD).replace("ubuntu-24.04", "ubuntu-latest").replace("b" * 40, "v4")
               .replace("    secrets:\n      X: y", "    secrets: inherit").replace("contents: read", "contents: write"))
        write(self.tmp, ".github/workflows/ci.yml", bad)
        code, out = run_main(chain, "--root", str(self.tmp))
        self.assertEqual(code, 1)
        for needle in ("runs-on must be", "not pinned to a full commit SHA", "secrets: inherit", "top-level permissions"):
            self.assertIn(needle, out)

    def test_zero_workflows_fail(self) -> None:
        self.assertEqual(run_main(chain, "--root", str(self.tmp))[0], 1)


class _Rule:
    def __init__(self, rule: str, methods: set[str], endpoint: str = "x") -> None:
        self.rule, self.methods, self.endpoint = rule, methods, endpoint


class _App:
    def __init__(self, rules: list[_Rule]) -> None:
        self.url_map = type("M", (), {"iter_rules": lambda _self: rules})()


class OpenApiTest(TmpCase):
    def test_route_normalisation_and_drift(self) -> None:
        app = _App([
            _Rule("/api/v1/catalog", {"GET", "HEAD", "OPTIONS"}),
            _Rule("/api/v1/documents/<int:doc_id>", {"GET", "DELETE"}),
            _Rule("/static/<path:filename>", {"GET"}, endpoint="static"),
            _Rule("/health", {"GET"}),
        ])
        served = oapi.flask_routes(app, "/api/v1")
        self.assertEqual(served, {("GET", "/api/v1/catalog"), ("GET", "/api/v1/documents/{doc_id}"), ("DELETE", "/api/v1/documents/{doc_id}")})
        spec = {"servers": [{"url": "/api/v1"}], "paths": {"/catalog": {"get": {}}, "/documents/{doc_id}": {"get": {}}}}
        documented = oapi.spec_routes(spec, "/api/v1")
        self.assertEqual(served - documented, {("DELETE", "/api/v1/documents/{doc_id}")})

    def test_missing_app_is_a_printed_skip(self) -> None:
        code, out = run_main(oapi, "--root", str(self.tmp))
        self.assertEqual(code, 2)
        self.assertIn("skip:", out)


if __name__ == "__main__":
    unittest.main()
