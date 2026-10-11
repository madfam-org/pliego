"""Catalog preview images: one crease-pattern SVG per cartridge, built once, served same-origin.

108 of the commons' manifests declare ``"thumbnail": "/projects/<slug>.svg"``; this module makes that
path real for EVERY cartridge. A thumbnail is the cartridge's default mode (its first declared mode)
at its manifest defaults, rendered through the same sandboxed runner as the API
(``render.Renderer``), then drawn by the kernel's own SVG exporter (``pliego.export.svg.to_svg``) in
the ``diagram`` palette (valley dashed blue, mountain dash-dot red, cut solid), fabrication profile,
without registration marks or labels.

Built at IMAGE BUILD time (the Dockerfile runs ``python -m apps.api.thumbnails build``): a default
render of the whole commons takes minutes of CPU, far too much for a first request on a 500m pod,
and the result is a pure function of the commons and the kernel in the image. The files are the
cache: ``build/thumbnails/<slug>.svg`` plus ``index.json`` (what was produced, what failed and why).
At run time the API only serves them (``GET /projects/<slug>.svg``) and lists the URL in the
catalog record when the file exists.

The check (the shape of yantra4d's ``prerender-commons`` and Fashion Cabinet's flats coverage):

    python -m apps.api.thumbnails build OUT_DIR [--strict] [--only a,b] [--jobs N]

prints ``thumbnails: cartridges=N produced=P failed=F …`` and one ``FAIL <slug>: <reason>`` line per
cartridge whose thumbnail cannot be produced. Exit 1 on an empty read (no cartridge, or nothing
produced), and with ``--strict`` (CI) on any failure. The image build runs without ``--strict``: a
missing preview must not block a deploy, and the build log names it.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from flask import Flask, abort, send_file

from .catalog import Catalog
from .config import Settings
from .manifest import SLUG_RE, Cartridge, resolve_request
from .render import Renderer, RenderError

INDEX = "index.json"
INDEX_FORMAT = "pliego.thumbnails"
URL_PREFIX = "/projects/"
SVG_OPTIONS = {"palette": "diagram", "registration": False, "labels": False, "profile": "default"}
BUILD_TIMEOUT_S = 120.0  # a build runs many renders side by side; the API's 30 s is for one


def thumbnail_url(slug: str) -> str:
    return f"{URL_PREFIX}{slug}.svg"


class ThumbnailStore:
    """Read side: the built files under one directory (read-only at run time)."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def path(self, slug: str) -> Path | None:
        if not isinstance(slug, str) or not SLUG_RE.match(slug):
            return None
        candidate = self.directory / f"{slug}.svg"
        if candidate.is_symlink() or not candidate.is_file():
            return None
        return candidate

    def url(self, slug: str) -> str | None:
        return thumbnail_url(slug) if self.path(slug) is not None else None

    def count(self) -> int:
        if not self.directory.is_dir():
            return 0
        return sum(1 for p in self.directory.glob("*.svg")
                   if SLUG_RE.match(p.stem) and p.is_file() and not p.is_symlink())


def register(app: Flask, store: ThumbnailStore) -> None:
    """``GET /projects/<slug>.svg``: the built thumbnail, or 404 (never rendered on request)."""

    @app.get("/projects/<slug>.svg")
    def project_thumbnail(slug: str):
        path = store.path(slug)
        if path is None:
            abort(404)
        return send_file(path, mimetype="image/svg+xml", conditional=True, etag=True,
                         max_age=None)


# ── build side ───────────────────────────────────────────────────────────────
@dataclass
class BuildReport:
    cartridges: int = 0
    produced: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)
    seconds: float = 0.0

    def line(self, jobs: int) -> str:
        return (f"thumbnails: cartridges={self.cartridges} produced={len(self.produced)} "
                f"failed={len(self.failed)} jobs={jobs} seconds={self.seconds:.1f}")


def _ensure_kernel(settings: Settings) -> None:
    try:
        import pliego  # noqa: F401
    except ImportError:
        src = str(settings.kernel_src)
        if settings.kernel_src.is_dir() and src not in sys.path:
            sys.path.insert(0, src)


def svg_from_document(document: bytes) -> bytes:
    """The thumbnail drawn from a rendered sheet document (diagram palette, no marks or labels)."""
    from pliego.export.svg import to_svg

    return to_svg(json.loads(document), **SVG_OPTIONS).encode("utf-8")


def render_svg(renderer: Renderer, cart: Cartridge) -> bytes:
    """The thumbnail of one cartridge: default mode, manifest defaults, diagram palette."""
    mode, params = resolve_request(cart, cart.modes[0].id, {})
    return svg_from_document(renderer.run(cart, mode, params, ()).document)


def finish(out_dir: Path, all_slugs, report: BuildReport, *, full: bool) -> None:
    """Drop previews of cartridges that left the commons (a full build) and write ``index.json``."""
    if full:
        for stale in out_dir.glob("*.svg"):
            if stale.stem not in all_slugs:
                stale.unlink()
    index = {"format": INDEX_FORMAT, "version": 1, "svg": SVG_OPTIONS,
             "cartridges": report.cartridges, "produced": sorted(report.produced),
             "failed": report.failed}
    _write_atomic(out_dir / INDEX, (json.dumps(index, indent=1, sort_keys=True) + "\n").encode())


def _write_atomic(path: Path, data: bytes) -> None:
    """Write then rename. The files are public previews, created with the process umask; the image
    build makes them readable by the runtime user explicitly (Dockerfile ``chmod -R a+rX``)."""
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def build(settings: Settings, out_dir: Path, *, only: set[str] | None = None, jobs: int = 0,
          timeout_s: float = BUILD_TIMEOUT_S) -> BuildReport:
    """Render the thumbnails into ``out_dir`` and write ``index.json``; never raises per cartridge."""
    _ensure_kernel(settings)
    started = time.monotonic()
    renderer = Renderer(dataclasses.replace(settings, render_timeout_s=timeout_s))
    carts = Catalog(settings.projects, renderer.published_formats).state()["cartridges"]
    selected = sorted(s for s in carts if only is None or s in only)
    report = BuildReport(cartridges=len(selected))
    out_dir.mkdir(parents=True, exist_ok=True)

    def one(slug: str) -> tuple[str, bytes | None, str]:
        try:
            return slug, render_svg(renderer, carts[slug]), ""
        except RenderError as exc:
            return slug, None, f"render failed ({exc.status}): {exc}"
        except Exception as exc:  # noqa: BLE001 — every failure is reported, none stops the build
            return slug, None, f"{type(exc).__name__}: {exc}"

    workers = jobs if jobs > 0 else max(1, os.cpu_count() or 1)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for slug, svg, reason in pool.map(one, selected):
            if svg is None:
                report.failed[slug] = reason[:500]
                (out_dir / f"{slug}.svg").unlink(missing_ok=True)
            else:
                _write_atomic(out_dir / f"{slug}.svg", svg)
                report.produced.append(slug)
    report.seconds = time.monotonic() - started
    finish(out_dir, carts, report, full=only is None)
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build the catalog thumbnails (one SVG per cartridge)")
    sub = ap.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build", help="render every cartridge's thumbnail into OUT_DIR")
    b.add_argument("out_dir")
    b.add_argument("--strict", action="store_true", help="exit 1 when any thumbnail fails (CI)")
    b.add_argument("--only", default="", help="comma-separated slugs (default: the whole commons)")
    b.add_argument("--jobs", type=int, default=0, help="parallel renders (default: CPU count)")
    b.add_argument("--timeout", type=float, default=BUILD_TIMEOUT_S, help="per-render seconds")
    args = ap.parse_args(argv)
    settings = Settings.from_env()
    only = {s for s in args.only.split(",") if s} or None
    report = build(settings, Path(args.out_dir), only=only, jobs=args.jobs, timeout_s=args.timeout)
    jobs = args.jobs if args.jobs > 0 else max(1, os.cpu_count() or 1)
    print(report.line(jobs), flush=True)
    for slug, reason in sorted(report.failed.items()):
        print(f"  FAIL {slug}: {reason}", flush=True)
    if report.cartridges == 0:
        print(f"thumbnails: FAIL 0 cartridges under {settings.projects} (empty read)")
        return 1
    if not report.produced:
        print("thumbnails: FAIL no thumbnail produced")
        return 1
    if args.strict and report.failed:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
