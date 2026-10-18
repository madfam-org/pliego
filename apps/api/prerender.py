"""The warm tier: render the commons at image build time, so first views never wait on a cold render.

    python -m apps.api.prerender build [--out build/prerender] [--thumbnails build/thumbnails]
                                       [--no-presets] [--strict] [--only a,b] [--jobs N]

For every cartridge, every mode, at its manifest defaults and at every preset that applies to the
mode (a preset naming a parameter scoped to other modes does not; the API would refuse it too), the
build runs the sandboxed runner once with the cheap published formats (``PRERENDER_FORMATS``: svg,
dxf, hpgl) and stores, under the exact runtime cache key (``RenderCache.key``: slug, mode, effective
parameters, formats, commons pin or source digest, kernel identity):

- the document alone (``POST /api/v1/documents``, every first view in the studio);
- the document with each of those files (``POST /api/v1/exports`` for that format).

Not prerendered, measured on the commons: PDF (82 MB for one copy per variant, more than everything
else together) and GLB (an animated GLB of a long program is megabytes), hence also not the bundle,
whose default set includes PDF. Those stay runtime renders that the memory and disk tiers then keep.
Presets that resolve to the same effective parameters as another variant are rendered once.

The same pass draws the catalog thumbnails from the first mode's default document
(``thumbnails.py``), so the image build renders the commons once. It prints one read-proof line,
``prerender: cartridges=… variants=… rendered=… failed=… entries=… bytes=… seconds=…``, plus one
``FAIL`` line per variant that cannot be rendered, and the thumbnails line. Exit 1 on an empty read,
and with ``--strict`` (CI) on any render failure; the image build is report-only, as for thumbnails.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from . import thumbnails
from .catalog import Catalog
from .config import Settings
from .manifest import Cartridge, Mode, PayloadError, resolve_request
from .prerender_store import PrerenderStore, _write
from .render import Renderer, RenderError, RenderResult
from .render_cache import RenderCache, canonical_json

INDEX_FORMAT = "pliego.prerender"
PRERENDER_FORMATS = ("svg", "dxf", "hpgl")
BUILD_TIMEOUT_S = 180.0  # heavy presets beside other renders on 4 cores; the API's limit is for one


@dataclass(frozen=True)
class Variant:
    cart: Cartridge
    mode: Mode
    preset: str | None          # None: the manifest defaults
    params: dict                # the effective parameters (what the runner receives)

    @property
    def label(self) -> str:
        return f"{self.cart.slug}/{self.mode.id}" + (f"@{self.preset}" if self.preset else "")


@dataclass
class PrerenderReport:
    cartridges: int = 0
    defaults: int = 0
    presets: int = 0
    inapplicable: int = 0
    duplicates: int = 0
    rendered: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)
    entries: int = 0
    bytes: int = 0
    seconds: float = 0.0

    def line(self, jobs: int) -> str:
        return (f"prerender: cartridges={self.cartridges} variants={self.defaults + self.presets} "
                f"(defaults={self.defaults} presets={self.presets} "
                f"inapplicable={self.inapplicable} duplicates={self.duplicates}) "
                f"rendered={len(self.rendered)} failed={len(self.failed)} entries={self.entries} "
                f"bytes={self.bytes} jobs={jobs} seconds={self.seconds:.1f}")


def variants(cart: Cartridge, presets: bool, report: PrerenderReport) -> list[Variant]:
    out: list[Variant] = []
    for mode in cart.modes:
        seen: set[bytes] = set()
        _m, defaults = resolve_request(cart, mode.id, {})
        seen.add(canonical_json(defaults))
        out.append(Variant(cart, mode, None, defaults))
        report.defaults += 1
        if not presets:
            continue
        for preset in cart.manifest.get("presets") or []:
            values = preset.get("values") if isinstance(preset, dict) else None
            if not isinstance(values, dict):
                continue
            try:
                _m, effective = resolve_request(cart, mode.id, values)
            except PayloadError:
                report.inapplicable += 1
                continue
            key = canonical_json(effective)
            if key in seen:
                report.duplicates += 1
                continue
            seen.add(key)
            out.append(Variant(cart, mode, str(preset.get("id")), effective))
            report.presets += 1
    return out


def entries_for(formats: tuple[str, ...]) -> list[tuple[str, ...]]:
    """The format tuples a request can ask for that one render with ``formats`` answers."""
    return [()] + [(f,) for f in formats]


def build(settings: Settings, out_dir: Path, thumbs_dir: Path | None, *, presets: bool = True,
          only: set[str] | None = None, jobs: int = 0,
          timeout_s: float = BUILD_TIMEOUT_S
          ) -> tuple[PrerenderReport, thumbnails.BuildReport | None]:
    thumbnails._ensure_kernel(settings)
    started = time.monotonic()
    renderer = Renderer(dataclasses.replace(settings, render_timeout_s=timeout_s))
    cache = RenderCache(settings)
    store = PrerenderStore(out_dir)
    carts = Catalog(settings.projects, renderer.published_formats).state()["cartridges"]
    selected = sorted(s for s in carts if only is None or s in only)
    report = PrerenderReport(cartridges=len(selected))
    work = [v for slug in selected for v in variants(carts[slug], presets, report)]

    def one(v: Variant) -> tuple[Variant, RenderResult | None, tuple[str, ...], str]:
        formats = tuple(f for f in renderer.published_formats(v.cart) if f in PRERENDER_FORMATS)
        try:
            return v, renderer.run(v.cart, v.mode, v.params, formats), formats, ""
        except RenderError as exc:
            if not formats:
                return v, None, (), f"render failed ({exc.status}): {exc.server_detail()}"
        except Exception as exc:  # noqa: BLE001 — every failure is reported, none stops the build
            return v, None, (), f"{type(exc).__name__}: {exc}"
        try:  # an export failed: keep at least the document
            return v, renderer.run(v.cart, v.mode, v.params, ()), (), ""
        except RenderError as exc:
            return v, None, (), f"render failed ({exc.status}): {exc.server_detail()}"

    thumbs = thumbnails.BuildReport(cartridges=len(selected)) if thumbs_dir is not None else None
    if thumbs_dir is not None:
        thumbs_dir.mkdir(parents=True, exist_ok=True)
    workers = jobs if jobs > 0 else max(1, os.cpu_count() or 1)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for v, result, formats, reason in pool.map(one, work):
            is_thumb = v.preset is None and v.mode.id == v.cart.modes[0].id
            if result is None:
                report.failed[v.label] = reason[:500]
                if thumbs is not None and is_thumb:
                    thumbs.failed[v.cart.slug] = reason[:500]
                continue
            report.rendered.append(v.label)
            for fmts in entries_for(formats):
                report.bytes += store.put(cache.key(v.cart, v.mode, v.params, fmts), result, fmts)
                report.entries += 1
            if thumbs is not None and is_thumb:
                try:
                    thumbnails._write_atomic(thumbs_dir / f"{v.cart.slug}.svg",
                                             thumbnails.svg_from_document(result.document))
                    thumbs.produced.append(v.cart.slug)
                except Exception as exc:  # noqa: BLE001
                    thumbs.failed[v.cart.slug] = f"{type(exc).__name__}: {exc}"[:500]
    report.seconds = time.monotonic() - started
    index = {"format": INDEX_FORMAT, "version": 1, "kernel": cache.kernel(),
             "commons": cache.commons(), "presets": presets, "line": report.line(workers),
             "rendered": sorted(report.rendered), "failed": report.failed}
    _write(out_dir / "index.json", (json.dumps(index, indent=1, sort_keys=True) + "\n").encode())
    if thumbs is not None:
        thumbs.seconds = report.seconds
        thumbnails.finish(thumbs_dir, carts, thumbs, full=only is None)
    return report, thumbs


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Prerender the commons (the warm cache tier)")
    sub = ap.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build", help="render every cartridge, mode and preset into OUT")
    b.add_argument("--out", default="", help="default: the settings' prerender directory")
    b.add_argument("--thumbnails", default="", help="also draw the catalog thumbnails here")
    b.add_argument("--no-presets", action="store_true", help="manifest defaults only")
    b.add_argument("--strict", action="store_true", help="exit 1 on any failed render (CI)")
    b.add_argument("--only", default="", help="comma-separated slugs (default: the whole commons)")
    b.add_argument("--jobs", type=int, default=0, help="parallel renders (default: CPU count)")
    b.add_argument("--timeout", type=float, default=BUILD_TIMEOUT_S, help="per-render seconds")
    args = ap.parse_args(argv)
    settings = Settings.from_env()
    only = {s for s in args.only.split(",") if s} or None
    out = Path(args.out) if args.out else settings.prerender
    thumbs_dir = Path(args.thumbnails) if args.thumbnails else None
    report, thumbs = build(settings, out, thumbs_dir, presets=not args.no_presets, only=only,
                           jobs=args.jobs, timeout_s=args.timeout)
    jobs = args.jobs if args.jobs > 0 else max(1, os.cpu_count() or 1)
    print(report.line(jobs), flush=True)
    for label, reason in sorted(report.failed.items()):
        print(f"  FAIL {label}: {reason}", flush=True)
    if thumbs is not None:
        print(thumbs.line(jobs), flush=True)
    if report.cartridges == 0:
        print(f"prerender: FAIL 0 cartridges under {settings.projects} (empty read)")
        return 1
    if not report.rendered:
        print("prerender: FAIL nothing rendered")
        return 1
    if args.strict and (report.failed or (thumbs is not None and thumbs.failed)):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
