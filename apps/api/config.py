"""Runtime settings for the Pliego web service, read once from the environment.

Every path is derived from one repository root (``PLIEGO_ROOT``, default: the checkout or
``/app`` in the image), so tests point the whole service at a temporary tree. Host names default
to the owner's 2026-10-10 ruling (docs/strategy/architecture.md §3). Variable names are the scaffold's env contract
(enclii.yaml, infra/k8s, .env.example): PLIEGO_PUBLIC_{LANDING,APP,API}_HOST, PLIEGO_CORS_ORIGINS,
PLIEGO_TRUSTED_PROXY_HEADER, PLIEGO_METRICS_PORT; PLIEGO_DEV=1 is the local-development switch.
"""

from __future__ import annotations

import os
import re
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[2]

HOST_LANDING = "pliego.madfam.io"
HOST_APP = "pliego-app.madfam.io"
HOST_API = "pliego-api.madfam.io"

MAX_CONTENT_LENGTH = 256 * 1024  # bytes; POST bodies are small JSON objects
RENDER_TIMEOUT_S = 30.0
RENDER_CACHE_MB = 16.0       # per-worker memory tier (apps/api/render_cache.py)
RENDER_CACHE_DISK_MB = 32.0  # shared disk tier under /tmp (an emptyDir of 128 Mi in production)
DEFAULT_RATE_LIMIT = (30, 60.0)  # requests per window (seconds) per client, per worker
_REVISION_RE = re.compile(r"^[0-9a-f]{7,40}$")


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


def _parse_rate(raw: str | None) -> tuple[int, float]:
    """``"30/60"`` → (30, 60.0). A malformed value raises: a typo must not disable the limiter."""
    if raw is None or not raw.strip():
        return DEFAULT_RATE_LIMIT
    try:
        count, window = raw.strip().split("/", 1)
        limit, window_s = int(count), float(window)
    except ValueError as exc:
        raise RuntimeError(f"PLIEGO_RATE_LIMIT must look like '30/60', got {raw!r}") from exc
    if limit < 1 or window_s <= 0:
        raise RuntimeError(f"PLIEGO_RATE_LIMIT must be positive, got {raw!r}")
    return limit, window_s


def _megabytes(env: Mapping[str, str], name: str, default: float) -> float:
    """A cache bound in MiB; 0 turns that tier off. A malformed value raises (no silent default)."""
    raw = env.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a number of MiB, got {raw!r}") from exc
    if not value >= 0 or value == float("inf"):
        raise RuntimeError(f"{name} must be a finite number >= 0, got {raw!r}")
    return value


def _revision(raw: str | None) -> str | None:
    """The git commit the image was built from (``PLIEGO_REVISION``, set from the build arg).

    Unset or empty → None (a source checkout, a local build). A value that is not 7-40 lowercase
    hex raises: /health must never report a revision that is not a commit."""
    value = (raw or "").strip()
    if not value:
        return None
    if not _REVISION_RE.match(value):
        raise RuntimeError(f"PLIEGO_REVISION must be a git commit SHA (7-40 hex), got {raw!r}")
    return value


@dataclass(frozen=True)
class Settings:
    root: Path = DEFAULT_ROOT
    projects_dir: Path | None = None
    materials_dir: Path | None = None
    thumbnails_dir: Path | None = None
    prerender_dir: Path | None = None
    host_landing: str = HOST_LANDING
    host_app: str = HOST_APP
    host_api: str = HOST_API
    cors_origins_raw: str = ""
    dev: bool = False
    trusted_ip_header: str = "CF-Connecting-IP"
    rate_limit: tuple[int, float] = DEFAULT_RATE_LIMIT
    metrics_port: int = 9090
    require_commons: bool = True
    render_timeout_s: float = RENDER_TIMEOUT_S
    render_cache_mb: float = RENDER_CACHE_MB
    render_cache_disk_mb: float = RENDER_CACHE_DISK_MB
    render_cache_dir: Path | None = None
    plausible_origin: str = ""
    revision: str | None = None

    # ── derived paths ────────────────────────────────────────────────────────
    @property
    def web_dir(self) -> Path:
        return self.root / "apps" / "web"

    @property
    def engine_dir(self) -> Path:
        return self.root / "packages" / "engine" / "src"

    @property
    def schemas_dir(self) -> Path:
        return self.root / "packages" / "schemas"

    @property
    def kernel_src(self) -> Path:
        return self.root / "packages" / "kernel" / "src"

    @property
    def projects(self) -> Path:
        return self.projects_dir or (self.root / "projects")

    @property
    def materials(self) -> Path:
        return self.materials_dir or (self.root / "materials")

    @property
    def render_cache_path(self) -> Path:
        return self.render_cache_dir or (Path(tempfile.gettempdir()) / "pliego-render-cache")

    @property
    def prerender(self) -> Path:
        """The warm tier rendered at image build time (apps/api/prerender.py), read-only."""
        return self.prerender_dir or (self.root / "build" / "prerender")

    @property
    def thumbnails(self) -> Path:
        """Built catalog previews (apps/api/thumbnails.py; the image builds them at build time)."""
        return self.thumbnails_dir or (self.root / "build" / "thumbnails")

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if env is None else env
        root = Path(env.get("PLIEGO_ROOT") or DEFAULT_ROOT)
        projects = env.get("PLIEGO_PROJECTS_DIR")
        materials = env.get("PLIEGO_MATERIALS_DIR")
        thumbnails = env.get("PLIEGO_THUMBNAILS_DIR")
        prerender = env.get("PLIEGO_PRERENDER_DIR")
        header = env.get("PLIEGO_TRUSTED_PROXY_HEADER")
        timeout = env.get("PLIEGO_RENDER_TIMEOUT_S")
        cache_dir = env.get("PLIEGO_RENDER_CACHE_DIR")
        return cls(
            root=root,
            projects_dir=Path(projects) if projects else None,
            materials_dir=Path(materials) if materials else None,
            thumbnails_dir=Path(thumbnails) if thumbnails else None,
            prerender_dir=Path(prerender) if prerender else None,
            host_landing=(env.get("PLIEGO_PUBLIC_LANDING_HOST") or HOST_LANDING).strip().lower(),
            host_app=(env.get("PLIEGO_PUBLIC_APP_HOST") or HOST_APP).strip().lower(),
            host_api=(env.get("PLIEGO_PUBLIC_API_HOST") or HOST_API).strip().lower(),
            cors_origins_raw=env.get("PLIEGO_CORS_ORIGINS", ""),
            dev=_truthy(env.get("PLIEGO_DEV")),
            # Unset → the tunnel's header; set to "" → no trusted header (remote address only).
            trusted_ip_header="CF-Connecting-IP" if header is None else header.strip(),
            rate_limit=_parse_rate(env.get("PLIEGO_RATE_LIMIT")),
            metrics_port=int(env.get("PLIEGO_METRICS_PORT") or 9090),
            require_commons=env.get("PLIEGO_REQUIRE_COMMONS", "1").strip() != "0",
            render_timeout_s=float(timeout) if timeout else RENDER_TIMEOUT_S,
            render_cache_mb=_megabytes(env, "PLIEGO_RENDER_CACHE_MB", RENDER_CACHE_MB),
            render_cache_disk_mb=_megabytes(env, "PLIEGO_RENDER_CACHE_DISK_MB", RENDER_CACHE_DISK_MB),
            render_cache_dir=Path(cache_dir) if cache_dir else None,
            plausible_origin=(env.get("PLIEGO_PLAUSIBLE_ORIGIN") or "").strip(),
            revision=_revision(env.get("PLIEGO_REVISION")),
        )
