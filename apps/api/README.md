# apps/api — the Pliego web service

> Boundary: public repository; no secrets, hostnames beyond the ruled public hosts, or prices.

One Flask 3 app serves everything (docs/strategy/architecture.md §3): the landing at `/`, the studio
at `/studio/`, engine modules at `/engine/`, `/schemas/*.schema.json`, `/llms.txt`,
`/llms-full.txt`, host-aware `/robots.txt` and `/sitemap.xml`, `/.well-known/security.txt`, the catalog previews at
`/projects/<slug>.svg`, and the JSON API (`/health`, `/ready`, `/api/v1/*`, described in
[`openapi.json`](openapi.json), which the API serves at `/api/v1/openapi.json` and links from the
index at `/` on the API host).

```bash
gunicorn -c apps/api/gunicorn.conf.py apps.api.app:app          # 8000 app, 9090 metrics
PLIEGO_DEV=1 python -m flask --app apps.api.app:create_app run  # local, dev CORS origins
python -m pytest apps/api/tests -q
python -m apps.api.prerender build --thumbnails build/thumbnails --strict  # warm tier + previews (what the image builds)
python -m apps.api.thumbnails build build/thumbnails --strict   # catalog previews alone
```

## Modules

| File | Role |
|---|---|
| `app.py` | `create_app(settings)`; lazy module attribute `app` for gunicorn; POST guard (JSON object, strict parse, 256 KiB); JSON errors |
| `config.py` | settings from the env contract (below) |
| `security.py` | CSP and the other security headers on every response; `X-Robots-Tag` on app/api hosts and on the landing host's copy of the studio (`/studio/…`; canonical = app host) |
| `cors.py` | explicit origin allowlist; wildcard, `null` or malformed entries raise |
| `ratelimit.py` | fixed window keyed on the trusted proxy header (never `X-Forwarded-For`); per-worker trust model |
| `render_limits.py` | one render per worker (503 + `Retry-After: 1`) |
| `hosts.py` | landing / app / api / other host classification |
| `static_routes.py` | traversal-safe static serving, `?v=` cache-busting stamps, robots, sitemap, llms, `/.well-known/security.txt` (RFC 9116; renew `SECURITY_TXT_EXPIRES` before it lapses) |
| `catalog.py`, `manifest.py` | stat-signature-memoized catalog and stock cards (one stat walk per request); fail-closed manifest checks; strict params |
| `render.py` | the sandbox runner as a killable subprocess (minimal env, own session, 30 s); render errors carry a stable `code` and a `request_id`, and the runner's stderr is logged server-side under that id, never returned |
| `generator.py`, `services/engine/generator_output.py` | GOC-1 (hyperobjects-spec generator output): `X-Generator-*` headers on every render, `variables.json`, and the deterministic, digest-stamped `format: "bundle"` zip (document + cut files + `variables.json`); the algorithms pin the keystone's golden vectors |
| `render_cache.py` | exact render cache: key = slug, mode, effective params, formats, cartridge source digest, commons pin, kernel identity; per-worker memory LRU + shared `/tmp` disk tier, both bounded by bytes; a hit skips the render slot (`X-Pliego-Cache`); checked first, the read-only prerendered tier |
| `prerender.py`, `prerender_store.py` | the warm tier: every cartridge, mode and applicable preset rendered at image build time (document, svg, dxf, hpgl) under the runtime cache key, content-addressed blobs, verified on read (`hit-prerendered`; a corrupt entry falls through); the same pass draws the thumbnails |
| `api_v1.py` | `/health`, `/ready`, `/api/v1/*` |
| `thumbnails.py` | catalog previews: built at image build time (one crease-pattern SVG per cartridge, default mode, kernel SVG exporter, diagram palette), served at `/projects/<slug>.svg`; the coverage check (`build --strict`) |
| `metrics.py` | Prometheus text on the metrics listener only (per-worker counters) |
| `services/engine/pliego_runner.py` | the cartridge runner: sandbox, `verify:` read-proof line, exports |
| `services/engine/sandbox_policy.py` | import allowlist, AST policy, module proxies (on top of `commons_sandbox`) |
| `vendor/commons_sandbox/` | the shared restricted-exec core, vendored from hyperobjects-spec; `vendor/LOCK.json` pins commit and sha256 |

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PLIEGO_PUBLIC_LANDING_HOST` / `_APP_HOST` / `_API_HOST` | `pliego.madfam.io` / `pliego-app.madfam.io` / `pliego-api.madfam.io` | host routing (a value with a port matches exactly) |
| `PLIEGO_CORS_ORIGINS` | — (required) | comma-separated bare origins; empty is allowed only with `PLIEGO_DEV=1` |
| `PLIEGO_TRUSTED_PROXY_HEADER` | `CF-Connecting-IP` | rate-limit key; set to empty when no trusted proxy overwrites it |
| `PLIEGO_METRICS_PORT` | `9090` | the metrics listener (gunicorn binds it; `/metrics` answers only there) |
| `PLIEGO_RATE_LIMIT` | `30/60` | renders per window (s) per client, per worker |
| `PLIEGO_REQUIRE_COMMONS` | `1` | `/ready` refuses an empty commons |
| `PLIEGO_RENDER_TIMEOUT_S` | `30` | runner timeout |
| `PLIEGO_RENDER_CACHE_MB` | `16` | render cache memory tier per worker, MiB (`0` turns it off) |
| `PLIEGO_RENDER_CACHE_DISK_MB` | `32` | render cache disk tier shared by the pod's workers, MiB (`0` turns it off) |
| `PLIEGO_RENDER_CACHE_DIR` | `$TMPDIR/pliego-render-cache` | the disk tier's directory (atomic writes; corrupt entries are ignored) |
| `PLIEGO_COMMONS_SHA` | unset | the commons commit for the cache key when there is no `.git` (the image); the cartridge's source digest keeps the key exact without it |
| `PLIEGO_REVISION` | unset | the git commit the image was built from, reported as `revision` by `/health` (`null` when unset). The Dockerfile's `ARG PLIEGO_REVISION` sets it; `build-deploy.yml` passes `github.sha`. A value that is not 7–40 lowercase hex fails the boot |
| `PLIEGO_PLAUSIBLE_ORIGIN` | unset | adds that https origin to `script-src`/`connect-src` on the landing host only |
| `PLIEGO_DEV` | unset | local development switch |
| `PLIEGO_ROOT`, `PLIEGO_PROJECTS_DIR`, `PLIEGO_MATERIALS_DIR` | repository paths | overrides (tests) |
| `PLIEGO_THUMBNAILS_DIR` | `<root>/build/thumbnails` | the built catalog previews (the image builds them into `/app/build/thumbnails`) |
| `PLIEGO_PRERENDER_DIR` | `<root>/build/prerender` | the prerendered tier (the image builds it into `/app/build/prerender`). Its keys include the commons pin: setting `PLIEGO_COMMONS_SHA` at run time but not at build time makes every entry miss |

Janua (`PLIEGO_JANUA_*`, `AUTH_JANUA_*`, `PLIEGO_SESSION_SECRET`) and Selva (`SELVA_*`) are not read
yet: requests that carry `Authorization` are refused with 401 and there are no AI routes, so nothing
can fail open while those seams are unwired.
