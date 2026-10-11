"""Runtime settings for the Pliego web service, read once from the environment.

Every path is derived from one repository root (``PLIEGO_ROOT``, default: the checkout or
``/app`` in the image), so tests point the whole service at a temporary tree. Host names default
to the owner's 2026-10-10 ruling (docs/strategy/architecture.md §3). Variable names are the scaffold's env contract
(enclii.yaml, infra/k8s, .env.example): PLIEGO_PUBLIC_{LANDING,APP,API}_HOST, PLIEGO_CORS_ORIGINS,
PLIEGO_TRUSTED_PROXY_HEADER, PLIEGO_METRICS_PORT; PLIEGO_DEV=1 is the local-development switch.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[2]

HOST_LANDING = "pliego.madfam.io"
HOST_APP = "pliego-app.madfam.io"
HOST_API = "pliego-api.madfam.io"

MAX_CONTENT_LENGTH = 256 * 1024  # bytes; POST bodies are small JSON objects
RENDER_TIMEOUT_S = 30.0
DEFAULT_RATE_LIMIT = (30, 60.0)  # requests per window (seconds) per client, per worker


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


@dataclass(frozen=True)
class Settings:
    root: Path = DEFAULT_ROOT
    projects_dir: Path | None = None
    materials_dir: Path | None = None
    thumbnails_dir: Path | None = None
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
    plausible_origin: str = ""

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
        header = env.get("PLIEGO_TRUSTED_PROXY_HEADER")
        timeout = env.get("PLIEGO_RENDER_TIMEOUT_S")
        return cls(
            root=root,
            projects_dir=Path(projects) if projects else None,
            materials_dir=Path(materials) if materials else None,
            thumbnails_dir=Path(thumbnails) if thumbnails else None,
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
            plausible_origin=(env.get("PLIEGO_PLAUSIBLE_ORIGIN") or "").strip(),
        )
