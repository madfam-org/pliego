"""Static surfaces: landing, studio, engine modules, schemas, llms files, robots and sitemap.

Every file is resolved through ``safe_file``: no empty, dot or dot-dot segment, no hidden file, no
backslash or NUL, the real path (symlinks resolved) must stay inside its mount, and the extension
must be in the MIME table — anything else is a 404, so source files (``.py``) are never served.

Cache busting (the Cloudflare-TTL lesson from Fashion Cabinet): served HTML has every same-origin
asset URL that resolves to a file stamped ``?v=<token>``, where the token is
``sha256(url path, mtime_ns, size)[:10]`` of that file (a stat, never a read). A deploy changes the
token, so the edge has never cached the new URL. Every response is ``Cache-Control: no-cache`` with
an ETag (security.py), so revalidation is a cheap 304. Known limit: ES-module ``import`` specifiers
inside JavaScript are not rewritten; those files rely on no-cache + ETag revalidation.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from flask import Flask, Response, abort, redirect, request, send_file

from .config import Settings
from .hosts import HostRouter

# Bare media types: send_file appends "; charset=utf-8" to the textual ones.
MIME: dict[str, str] = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".map": "application/json",
    ".fold": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".wasm": "application/wasm",
    ".txt": "text/plain",
    ".xml": "application/xml",
}
TEXT_PLAIN = "text/plain; charset=utf-8"
HTML = "text/html; charset=utf-8"

AI_CRAWLERS = (
    "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot",
    "anthropic-ai", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot",
)

_URL_ATTR_RE = re.compile(r"""(\b(?:src|href)\s*=\s*)(["'])([^"'<>]*)\2""", re.IGNORECASE)


def safe_file(base: Path, rel: str) -> Path | None:
    """The real file for ``rel`` under ``base``, or None when anything about it is unsafe."""
    if not rel or "\x00" in rel or "\\" in rel or len(rel) > 512:
        return None
    parts = rel.split("/")
    if any(p in ("", ".", "..") or p.startswith(".") for p in parts):
        return None
    try:
        base_real = base.resolve(strict=True)
        real = (base_real / rel).resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    if not real.is_relative_to(base_real) or not real.is_file():
        return None
    if real.suffix.lower() not in MIME:
        return None
    return real


def asset_token(url_path: str, path: Path) -> str:
    st = path.stat()
    digest = hashlib.sha256(f"{url_path}\0{st.st_mtime_ns}\0{st.st_size}".encode())
    return digest.hexdigest()[:10]


class StaticSite:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        web = settings.web_dir
        # URL prefix → directory. Longest prefix first.
        self.mounts: tuple[tuple[str, Path], ...] = (
            ("/assets/", web / "assets"),
            ("/studio/", web / "studio"),
            ("/engine/", settings.engine_dir),
        )

    def resolve_url(self, url_path: str) -> Path | None:
        for prefix, base in self.mounts:
            if url_path.startswith(prefix):
                return safe_file(base, url_path[len(prefix):])
        if url_path.startswith("/schemas/"):
            name = url_path[len("/schemas/"):]
            return self.schema_file(name)
        if url_path.count("/") == 1 and not url_path.endswith(".html"):
            return safe_file(self.settings.web_dir, url_path[1:])
        return None

    def schema_file(self, name: str) -> Path | None:
        if "/" in name or not name.endswith(".schema.json"):
            return None
        return safe_file(self.settings.schemas_dir, name)

    def stamp(self, html: str, page_url: str) -> str:
        def repl(m: re.Match) -> str:
            prefix, quote, value = m.group(1), m.group(2), m.group(3)
            if not value or value.startswith(("#", "//", "data:", "blob:", "mailto:")) \
                    or "?" in value or ":" in value.split("/", 1)[0]:
                return m.group(0)
            path, _, fragment = value.partition("#")
            absolute = urlsplit(urljoin(page_url, path)).path
            target = self.resolve_url(absolute)
            if target is None:
                return m.group(0)
            stamped = f"{path}?v={asset_token(absolute, target)}"
            if fragment:
                stamped += "#" + fragment
            return f"{prefix}{quote}{stamped}{quote}"

        return _URL_ATTR_RE.sub(repl, html)

    def html_response(self, path: Path, page_url: str) -> Response:
        html = path.read_text(encoding="utf-8")
        resp = Response(self.stamp(html, page_url), content_type=HTML)
        resp.add_etag()
        return resp.make_conditional(request)

    def file_response(self, path: Path, url_path: str) -> Response:
        if path.suffix.lower() == ".html":
            return self.html_response(path, url_path)
        resp = send_file(path, mimetype=MIME[path.suffix.lower()], conditional=True,
                         etag=True, max_age=None)
        return resp


def _robots(kind: str, settings: Settings) -> str:
    if kind != "landing":
        return "User-agent: *\nDisallow: /\n"
    lines = ["User-agent: *", "Allow: /", ""]
    for bot in AI_CRAWLERS:
        lines += [f"User-agent: {bot}", "Allow: /", ""]
    lines.append(f"Sitemap: https://{settings.host_landing}/sitemap.xml")
    return "\n".join(lines) + "\n"


def _sitemap(settings: Settings) -> str:
    base = f"https://{settings.host_landing}"
    urls = (f"{base}/", f"{base}/llms.txt", f"{base}/llms-full.txt")
    body = "".join(f"  <url><loc>{u}</loc></url>\n" for u in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f"{body}</urlset>\n")


def _text(body: str, content_type: str = TEXT_PLAIN) -> Response:
    resp = Response(body, content_type=content_type)
    resp.add_etag()
    return resp.make_conditional(request)


def register(app: Flask, settings: Settings, hosts: HostRouter, api_index) -> StaticSite:
    site = StaticSite(settings)
    web = settings.web_dir

    def page(rel_dir: Path, url: str) -> Response:
        index = safe_file(rel_dir, "index.html")
        if index is None:
            abort(404)
        return site.html_response(index, url)

    @app.get("/")
    def root():
        kind = hosts.kind()
        if kind == "app":
            return redirect("/studio/", code=302)
        if kind == "api":
            return api_index()
        return page(web, "/")

    @app.get("/studio")
    def studio_bare():
        return redirect("/studio/", code=308)

    @app.get("/studio/")
    def studio():
        return page(web / "studio", "/studio/")

    def mounted(prefix: str, base: Path, rel: str) -> Response:
        target = safe_file(base, rel)
        if target is None:
            abort(404)
        return site.file_response(target, prefix + rel)

    @app.get("/assets/<path:rel>")
    def assets(rel: str):
        return mounted("/assets/", web / "assets", rel)

    @app.get("/studio/<path:rel>")
    def studio_files(rel: str):
        return mounted("/studio/", web / "studio", rel)

    @app.get("/engine/<path:rel>")
    def engine_files(rel: str):
        return mounted("/engine/", settings.engine_dir, rel)

    @app.get("/schemas/<name>")
    def schemas(name: str):
        target = site.schema_file(name)
        if target is None:
            abort(404)
        return send_file(target, mimetype="application/schema+json", conditional=True,
                         etag=True, max_age=None)

    def llms(name: str) -> Response:
        target = safe_file(settings.root, name)
        if target is None:
            abort(404)
        return send_file(target, mimetype="text/plain", conditional=True, etag=True, max_age=None)

    @app.get("/llms.txt")
    def llms_txt():
        return llms("llms.txt")

    @app.get("/llms-full.txt")
    def llms_full_txt():
        return llms("llms-full.txt")

    @app.get("/robots.txt")
    def robots():
        return _text(_robots(hosts.kind(), settings))

    @app.get("/sitemap.xml")
    def sitemap():
        if hosts.kind() != "landing":
            abort(404)
        return _text(_sitemap(settings), "application/xml")

    @app.get("/<name>")
    def web_root_file(name: str):
        if name.endswith(".html"):
            abort(404)
        return mounted("/", web, name)

    return site
