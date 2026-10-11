"""Shared fixtures: a throwaway repository tree and an app factory pointed at it.

Every test builds the service over ``tmp_path`` (web pages, engine modules, schemas, llms files,
stock cards and fixture cartridges), so nothing depends on the other lanes' files being present
except the real kernel, which is symlinked in from the checkout when it exists (end-to-end tests
skip with a printed reason otherwise).
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from apps.api.app import create_app  # noqa: E402
from apps.api.config import Settings  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
KERNEL_SRC = REPO / "packages" / "kernel" / "src"
HAS_KERNEL = (KERNEL_SRC / "pliego" / "document.py").is_file()
LANDING = "https://pliego.madfam.io"
APP = "https://pliego-app.madfam.io"
API = "https://pliego-api.madfam.io"
ORIGINS = f"{LANDING},{APP}"

LANDING_HTML = """<!doctype html>
<html lang="en"><head>
<link rel="stylesheet" href="/assets/site.css">
<link rel="icon" href="/favicon.svg">
<script type="module" src="/assets/app.js"></script>
<link rel="preconnect" href="https://plausible.madfam.io">
</head><body>
<a href="/studio/">Studio</a>
<a href="/llms.txt">llms.txt</a>
<img src="data:image/png;base64,AAAA" alt="">
<img src="/assets/missing.png" alt="">
<script src="/assets/app.js?v=keep"></script>
</body></html>
"""

STUDIO_HTML = """<!doctype html>
<html lang="en"><head>
<link rel="stylesheet" href="studio.css">
<script src="../shared/lang-boot.js"></script>
<script type="module" src="./studio.js"></script>
<script type="module" src="/engine/index.js"></script>
</head><body><main id="studio"></main></body></html>
"""


def build_tree(root: Path, *, projects: bool = True, materials: bool = True) -> Path:
    web = root / "apps" / "web"
    (web / "assets").mkdir(parents=True)
    (web / "studio").mkdir(parents=True)
    (web / "index.html").write_text(LANDING_HTML, encoding="utf-8")
    (web / "favicon.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>", encoding="utf-8")
    (web / ".hidden.txt").write_text("hidden", encoding="utf-8")
    (web / "notes.py").write_text("SECRET = 1\n", encoding="utf-8")
    (web / "assets" / "site.css").write_text("body{margin:0}\n", encoding="utf-8")
    (web / "assets" / "app.js").write_text("export const app = 1;\n", encoding="utf-8")
    (web / "studio" / "index.html").write_text(STUDIO_HTML, encoding="utf-8")
    (web / "studio" / "studio.css").write_text("main{display:block}\n", encoding="utf-8")
    (web / "studio" / "studio.js").write_text("import '/engine/index.js';\n", encoding="utf-8")
    (web / "studio" / "demo").mkdir()
    (web / "studio" / "demo" / "page-turn.fold").write_text('{"file_spec": 1.2}', encoding="utf-8")
    (web / "shared").mkdir()
    (web / "shared" / "lang-boot.js").write_text("document.documentElement.lang='en';\n",
                                                 encoding="utf-8")
    (web / "scripts").mkdir()
    (web / "scripts" / "make-og.mjs").write_text("// tooling\n", encoding="utf-8")
    (web / "test").mkdir()
    (web / "test" / "csp-lint.test.mjs").write_text("// tooling\n", encoding="utf-8")
    (web / "dev-server.mjs").write_text("// tooling\n", encoding="utf-8")
    (web / "llms.txt").write_text("web copy: shadowed by the repository root file\n",
                                  encoding="utf-8")
    engine = root / "packages" / "engine" / "src"
    (engine / "physics").mkdir(parents=True)
    (engine / "index.js").write_text("export * from './physics/xpbd.js';\n", encoding="utf-8")
    (engine / "physics" / "xpbd.js").write_text("export const dt = 1 / 240;\n", encoding="utf-8")
    schemas = root / "packages" / "schemas"
    schemas.mkdir(parents=True)
    real_schema = REPO / "packages" / "schemas" / "sheet-document.schema.json"
    if real_schema.is_file():
        shutil.copy(real_schema, schemas / "sheet-document.schema.json")
    else:
        (schemas / "sheet-document.schema.json").write_text("{}", encoding="utf-8")
    if HAS_KERNEL:
        (root / "packages" / "kernel").mkdir(parents=True)
        (root / "packages" / "kernel" / "src").symlink_to(KERNEL_SRC, target_is_directory=True)
    (root / "llms.txt").write_text("# Pliego\n\n> Sheet hyperobjects.\n", encoding="utf-8")
    (root / "llms-full.txt").write_text("# Pliego (full)\n", encoding="utf-8")
    (root / "secret.txt").write_text("not served\n", encoding="utf-8")
    if projects:
        shutil.copytree(FIXTURES / "projects", root / "projects")
    if materials:
        real = REPO / "materials"
        dest = root / "materials"
        dest.mkdir()
        for slug in ("kami", "copy-80"):
            if (real / slug / "stock.json").is_file():
                shutil.copytree(real / slug, dest / slug)
    return root


@pytest.fixture
def tree(tmp_path: Path) -> Path:
    return build_tree(tmp_path / "repo")


@pytest.fixture
def make_app(tree: Path):
    def factory(**overrides):
        fields = {"root": tree, "cors_origins_raw": ORIGINS, "dev": False,
                  "require_commons": True, "render_cache_dir": tree / "render-cache"}
        fields.update(overrides)
        app = create_app(Settings(**fields))
        app.testing = True
        return app

    return factory


@pytest.fixture
def app(make_app):
    return make_app()


@pytest.fixture
def client(app):
    return app.test_client()


def needs_kernel():
    if not HAS_KERNEL:
        print("SKIP REASON: packages/kernel/src/pliego is not merged into this checkout")
        pytest.skip("kernel-core not merged: packages/kernel/src/pliego missing")
