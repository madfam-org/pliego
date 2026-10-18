# Runbook

> Last Updated: 2026-10-18
> Boundary: public. Routine operations are Enclii-first (web, API or CLI). This repository carries
> no break-glass procedure; anything beyond what is written here is in MADFAM's private ops
> repository.

Nothing is deployed yet (docs/HONEST_STATUS.md). These are the routine checks once it is.

| Symptom | First check | Routine action |
|---|---|---|
| status page red for a host | `curl -fsS https://<host>/health` and `/ready`; the status entry asserts `"status": "ok"` and no `localhost:` | read the Release and pod events in Enclii; roll back by reverting the digest-pin commit |
| `/ready` 503 | the body names the capability that is off (catalog, commons, stock cards, sign-in) | a missing secret key: submit it through the Enclii secret intake; a missing commons: the image was built without the submodule (DEPLOYMENT.md, step 1) |
| sign-in fails | Janua redirect URI is exact-match (`https://pliego-app.madfam.io/auth/callback`) | compare with `janua.client.yaml`; never widen with a wildcard |
| AI routes answer 503 | expected while `SELVA_BASE_URL` is unset | enabling AI is an owner decision |
| a rollout or a node drain took a host down | the LIVE Deployment's `spec.replicas` and `status.availableReplicas` (git says 2; Enclii's Argo Application ignores replicas, so live may still be 1) and PodDisruptionBudget `pliego` (allowed disruptions) | scale to 2 Enclii-first, or `kubectl -n pliego scale deploy/pliego --replicas=2` (DEPLOYMENT.md, "Rollouts and disruptions"); a drain blocked by the budget at one pod clears once the second pod is Ready |
| a deploy changed nothing | `curl -fsS https://pliego-api.madfam.io/health` and compare `revision` with the dispatched commit; then `verify_deploy_paths.py` (the change filter must cover every Dockerfile COPY) | fix the filter in the same PR as the Dockerfile |

Rollback: revert the digest-pin commit on `main`; the GitOps sync rolls the previous digest.
Secrets: rotate through the Enclii secret intake; never paste a value into an issue, PR or log.
