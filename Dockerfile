# Pliego: ONE image serves everything (docs/strategy/architecture.md §3): landing at /, studio at
# /studio/, engine modules at /engine/, API at /api/v1/, /llms.txt; /health, /ready on 8000 and
# /metrics on 9090 (internal, never routed through the tunnel).
#   docker build -t pliego .            (build context: the repository root)
#
# - Base pinned by digest: python:3.12-slim multi-arch index, resolved 2026-10-10 with
#   `docker buildx imagetools inspect python:3.12-slim`. Dependabot (docker) proposes bumps.
# - Runs as uid 1001 with a read-only root filesystem; only /tmp is writable (emptyDir in k8s).
# - Every COPY source below is mirrored in the `paths` of .github/workflows/build-deploy.yml;
#   scripts/qa/verify_deploy_paths.py fails CI when the two drift.
# - The commons (projects/, a git submodule) must be checked out. An uninitialised submodule is an
#   empty directory, so the build FAILS CLOSED when projects/ holds no cartridge, unless
#   PLIEGO_REQUIRE_COMMONS=0 is passed for a local build. Either way it prints what it counted.

FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1 AS build

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN python -m venv /opt/venv
# The kernel is standard-library only; the API's requirements carry Flask and gunicorn.
COPY packages/kernel /src/packages/kernel
COPY apps/api/requirements.txt /src/apps/api/requirements.txt
RUN /opt/venv/bin/pip install /src/packages/kernel \
    && /opt/venv/bin/pip install -r /src/apps/api/requirements.txt \
    && /opt/venv/bin/gunicorn --version

COPY apps/api /app/apps/api
COPY apps/web /app/apps/web
COPY packages/engine/src /app/packages/engine/src
COPY packages/schemas /app/packages/schemas
COPY docs/spec /app/docs/spec
COPY materials /app/materials
COPY projects /app/projects
COPY llms.txt llms-full.txt /app/

ARG PLIEGO_REQUIRE_COMMONS=1
RUN set -eu; \
    n=$(find /app/projects -mindepth 2 -maxdepth 2 -name project.json | wc -l | tr -d ' '); \
    echo "commons-in-image: cartridges=${n} require=${PLIEGO_REQUIRE_COMMONS}"; \
    if [ "${n}" -eq 0 ] && [ "${PLIEGO_REQUIRE_COMMONS}" = "1" ]; then \
      echo "projects/ holds 0 cartridges: the sheet-hyperobjects submodule was not checked out" >&2; \
      exit 1; \
    fi
# The warm tier and the catalog previews (apps/api/prerender.py), rendered through the sandboxed runner HERE,
# once: every cartridge, every mode, at its defaults and at every applicable preset, stored under the runtime
# render-cache key (document, svg, dxf, hpgl) in /app/build/prerender, so a first view never waits on a cold render;
# the same pass draws one crease-pattern SVG per cartridge into /app/build/thumbnails (/projects/<slug>.svg).
# The root filesystem is read-only at run time. Report-only (the log prints the `prerender:` and `thumbnails:`
# lines and names every failure); CI's `api` job runs the same build with --strict.
RUN cd /app && /opt/venv/bin/python -m apps.api.prerender build --out /app/build/prerender \
       --thumbnails /app/build/thumbnails \
    && chmod -R a+rX /app/build
# Byte-compile at build time: the root filesystem is read-only at run time.
RUN /opt/venv/bin/python -m compileall -q /app/apps /opt/venv/lib


FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1 AS runtime

LABEL org.opencontainers.image.source="https://github.com/madfam-org/pliego" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.title="pliego"

RUN groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid 1001 --home-dir /tmp --no-create-home \
       --shell /usr/sbin/nologin app

COPY --from=build /opt/venv /opt/venv
COPY --from=build /app /app

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    TMPDIR=/tmp \
    PLIEGO_ENV=production

# The git commit this image was built from, reported as `revision` by /health (null when unset).
# .github/workflows/build-deploy.yml passes it as a build arg (`build_args`: PLIEGO_REVISION=github.sha);
# declared last so a new commit rebuilds only this layer.
ARG PLIEGO_REVISION=""
ENV PLIEGO_REVISION=${PLIEGO_REVISION}

WORKDIR /app
USER 1001:1001

EXPOSE 8000 9090

# apps/api/app.py exposes the Flask `app` (api lane). gunicorn's heartbeat files go to /tmp.
# apps/api/gunicorn.conf.py binds 8000 (app) and PLIEGO_METRICS_PORT (9090, /metrics only), sets the
# worker tmp dir to /tmp, disables the control socket and marks workers non-dumpable on Linux.
CMD ["gunicorn", "-c", "apps/api/gunicorn.conf.py", "apps.api.app:app"]
