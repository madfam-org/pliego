# Deployment

> Last Updated: 2026-10-10
> Boundary: public. Production operations are Enclii-first; this repository carries no break-glass
> procedure. Operator procedures and secret handling live in MADFAM's private ops repository.

## Shape

One Enclii project `pliego`, one Service `pliego`, one image `ghcr.io/madfam-org/pliego` built from
the root `Dockerfile` (context: repository root). Hosts (owner ruling, 2026-10-10), all routed by
the tunnel to Service `pliego` on port 80, i.e. container port 8000:

| Host | Serves |
|---|---|
| `pliego.madfam.io` | landing `/`, `/llms.txt` |
| `pliego-app.madfam.io` | studio `/studio/`, engine modules `/engine/`, OAuth callback `/auth/callback` |
| `pliego-api.madfam.io` | API `/api/v1/` |

Health: liveness `/health` (static 200), readiness `/ready` (503 until the catalog, stock cards and
commons load). Metrics: `/metrics` on 9090, scraped through Service `pliego-metrics`, never routed.

## Configuration contract

Env (set in `infra/k8s/production/deployment.yaml`): `PLIEGO_ENV`, `PLIEGO_PUBLIC_LANDING_HOST`,
`PLIEGO_PUBLIC_APP_HOST`, `PLIEGO_PUBLIC_API_HOST`, `PLIEGO_CORS_ORIGINS` (explicit allowlist),
`PLIEGO_JANUA_ISSUER`, `PLIEGO_JANUA_AUDIENCE` (`pliego-api`), `PLIEGO_JANUA_JWKS_URL`,
`PLIEGO_TRUSTED_PROXY_HEADER` (rate limits key on it, never on the first X-Forwarded-For hop),
`PLIEGO_METRICS_PORT`, and later `SELVA_BASE_URL`.

Secret `pliego-secrets` (names only, `infra/k8s/production/secrets-template.yaml`):
`AUTH_JANUA_CLIENT_ID`, `AUTH_JANUA_CLIENT_SECRET`, `PLIEGO_SESSION_SECRET`, later
`SELVA_API_TOKEN`. Values reach the store only through `enclii secrets intake`; every key is optional
at boot and the app fails closed while one is absent.

`scripts/qa/verify_canonical_host.py` keeps the hosts in `enclii.yaml`, the host and CORS env and the
Janua redirect URIs in lockstep.

## Build and pin

`.github/workflows/build-deploy.yml` is **dispatch-only** until onboarding. A preflight job checks
the commons pin (`verify_commons_pin.py --require --min-cartridges 1`) and the deploy path filter
(`verify_deploy_paths.py`), then calls Enclii's reusable `build-publish.yml` pinned to a full SHA on
Enclii `main`: buildx, GHCR push, keyless cosign sign and verify, the digest pin committed to
`infra/k8s/production/kustomization.yaml`, and the lifecycle callback that registers the Release.
The all-zero digest in the kustomization is a placeholder that never resolves.

## First deploy: what must happen, in order

1. **Done: Enclii checks out submodules in build-publish.** enclii#714 added the optional
   `checkout_submodules` input (build job only, default `"false"`). Pliego passes `"true"`, so
   `projects/` is populated in the build context. The root Dockerfile still fails closed on an
   empty commons (`commons-in-image: cartridges=0`).
2. **Done: `apps/api` is on main** with `app.py` (Flask `app`), `requirements.txt` (including
   gunicorn), `/health`, `/ready`, `/api/v1`, and a metrics listener on 9090.
3. **Operator: repository settings** (secret scanning, push protection, private vulnerability
   reporting, Dependabot, squash-only, read-only workflow token, SHA pinning required, branch
   protection with CODEOWNERS).
4. **One dispatch** of Build & Deploy (agent or operator) so a digest is pinned (onboarding rejects unpinned
   manifests, and a first push has no previous commit to diff).
5. **Operator: Enclii onboarding** of project `pliego` (no database, no bucket), the repository
   secret `ENCLII_CALLBACK_TOKEN`, a services-sync dry run read on its own before any reconcile.
6. **Operator: domains and tunnel routes** for the three hosts, each verified.
7. **Operator: Janua client `pliego-web`** through Enclii's OIDC provisioner, then the secret intake
   for `pliego-secrets`.
8. Only then: a pull request that turns on push-on-main for Build & Deploy and sets
   `autoDeploy: true`.
