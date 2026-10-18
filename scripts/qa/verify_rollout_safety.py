#!/usr/bin/env python3
"""A rollout or a node drain must never empty the pliego Service.

Reads ONLY the objects the production kustomization ships (`resources:` in
infra/k8s/production/kustomization.yaml) plus enclii.yaml, and checks, for every Deployment:

* `spec.replicas` >= 2 (the declared topology; the LIVE count is the owner's scale, because Enclii's Argo
  Application ignores Deployment replicas: docs/DEPLOYMENT.md "Rollouts");
* `strategy.type` RollingUpdate with `maxUnavailable` 0 and `maxSurge` >= 1 (the new pod is Ready before
  an old one stops);
* the Service named like the Deployment (the one the tunnel routes to) selects its pods, and a policy/v1
  PodDisruptionBudget has exactly that Service's selector and still allows one eviction at the declared
  replica count;
* httpGet readiness AND liveness probes, each on a port the container declares;
* `runtime.replicas` of the same-named Service in enclii.yaml equals `spec.replicas`.

Read-proof: prints how many Deployments, Services, PDBs and probes it compared; reading zero Deployments,
zero Services or zero PDBs is a failure, never a pass.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

KUSTOMIZATION = "infra/k8s/production/kustomization.yaml"
ENCLII = "enclii.yaml"
MIN_REPLICAS = 2


def _docs(path: Path) -> list[dict]:
    return [d for d in yaml.safe_load_all(path.read_text(encoding="utf-8")) if isinstance(d, dict)]


def load_objects(root: Path) -> tuple[list[dict], list[str]]:
    """Every object of every file the kustomization lists in `resources:` (files only, no remote bases)."""
    errors: list[str] = []
    kpath = root / KUSTOMIZATION
    if not kpath.is_file():
        return [], [f"{KUSTOMIZATION} does not exist"]
    kust = yaml.safe_load(kpath.read_text(encoding="utf-8")) or {}
    objects: list[dict] = []
    for rel in kust.get("resources") or []:
        path = kpath.parent / str(rel)
        if not path.is_file():
            errors.append(f"kustomization resource `{rel}` is not a file in {kpath.parent.relative_to(root)}")
            continue
        objects.extend(_docs(path))
    return objects, errors


def _percent(value: object) -> int | None:
    if isinstance(value, str) and value.endswith("%") and value[:-1].isdigit():
        return int(value[:-1])
    return None


def _int_or_percent(value: object, replicas: int, *, round_up: bool) -> int | None:
    """Kubernetes IntOrString resolved against `replicas` (surge rounds up, unavailable rounds down)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    pct = _percent(value)
    if pct is None:
        return None
    scaled = pct * replicas
    return -(-scaled // 100) if round_up else scaled // 100


def _selects(selector: dict, labels: dict) -> bool:
    return bool(selector) and all(labels.get(k) == v for k, v in selector.items())


def _pdb_allows_one_eviction(spec: dict, replicas: int) -> bool:
    if "minAvailable" in spec:
        need = _int_or_percent(spec["minAvailable"], replicas, round_up=True)
        return need is not None and replicas - need >= 1
    if "maxUnavailable" in spec:
        allowed = _int_or_percent(spec["maxUnavailable"], replicas, round_up=False)
        return allowed is not None and allowed >= 1
    return False


def _container_ports(container: dict) -> set:
    ports: set = set()
    for port in container.get("ports") or []:
        if "name" in port:
            ports.add(port["name"])
        if "containerPort" in port:
            ports.add(port["containerPort"])
    return ports


def enclii_replicas(root: Path) -> tuple[dict[str, object], list[str]]:
    path = root / ENCLII
    if not path.is_file():
        return {}, [f"{ENCLII} does not exist"]
    found: dict[str, object] = {}
    for doc in _docs(path):
        if doc.get("kind") == "Service":
            name = (doc.get("metadata") or {}).get("name")
            runtime = (doc.get("spec") or {}).get("runtime") or {}
            found[str(name)] = runtime.get("replicas")
    return found, []


def check_deployment(dep: dict, services: list[dict], pdbs: list[dict], enclii: dict[str, object],
                     counts: dict[str, int]) -> list[str]:
    errors: list[str] = []
    name = (dep.get("metadata") or {}).get("name", "?")
    spec = dep.get("spec") or {}
    replicas = spec.get("replicas", 1)
    if not isinstance(replicas, int) or isinstance(replicas, bool) or replicas < MIN_REPLICAS:
        errors.append(f"Deployment {name}: replicas={replicas!r}, need >= {MIN_REPLICAS} "
                      "(one pod means every drain is an outage)")
        replicas = replicas if isinstance(replicas, int) and not isinstance(replicas, bool) else 1

    strategy = spec.get("strategy") or {}
    stype = strategy.get("type", "RollingUpdate")
    if stype != "RollingUpdate":
        errors.append(f"Deployment {name}: strategy.type={stype}, need RollingUpdate (Recreate stops every pod first)")
    rolling = strategy.get("rollingUpdate") or {}
    # Kubernetes defaults are 25% / 25%; an unset value is checked as its default.
    unavailable = _int_or_percent(rolling.get("maxUnavailable", "25%"), replicas, round_up=False)
    surge = _int_or_percent(rolling.get("maxSurge", "25%"), replicas, round_up=True)
    if unavailable != 0:
        errors.append(f"Deployment {name}: maxUnavailable={rolling.get('maxUnavailable', '25%')!r}, need 0 "
                      "(an old pod may stop before its replacement is Ready)")
    if surge is None or surge < 1:
        errors.append(f"Deployment {name}: maxSurge={rolling.get('maxSurge', '25%')!r}, need >= 1 "
                      "(with maxUnavailable 0 the rollout could not progress)")

    # The routed Service carries the Deployment's name (enclii.yaml: a domain's route is the Service named
    # like the Enclii service); pliego-metrics shares the selector but serves only the scraper.
    pod_labels = ((spec.get("template") or {}).get("metadata") or {}).get("labels") or {}
    routed = [s for s in services if (s.get("metadata") or {}).get("name") == name]
    if not routed:
        errors.append(f"Deployment {name}: no Service named {name} (the tunnel routes to it)")
    for svc in routed:
        if not _selects((svc.get("spec") or {}).get("selector") or {}, pod_labels):
            errors.append(f"Service {name}: its selector does not select Deployment {name}'s pod labels")
            continue
        svc_name = svc["metadata"]["name"]
        selector = svc["spec"]["selector"]
        matching = [p for p in pdbs
                    if ((p.get("spec") or {}).get("selector") or {}).get("matchLabels") == selector]
        if not matching:
            errors.append(f"Service {svc_name}: no PodDisruptionBudget has selector.matchLabels == {selector}")
        for pdb in matching:
            pdb_name = pdb["metadata"]["name"]
            if pdb.get("apiVersion") != "policy/v1":
                errors.append(f"PodDisruptionBudget {pdb_name}: apiVersion={pdb.get('apiVersion')}, need policy/v1")
            if (pdb["spec"].get("selector") or {}).get("matchExpressions"):
                errors.append(f"PodDisruptionBudget {pdb_name}: matchExpressions narrow the Service's selector")
            if "minAvailable" not in pdb["spec"] and "maxUnavailable" not in pdb["spec"]:
                errors.append(f"PodDisruptionBudget {pdb_name}: neither minAvailable nor maxUnavailable is set")
            elif not _pdb_allows_one_eviction(pdb["spec"], replicas):
                errors.append(f"PodDisruptionBudget {pdb_name}: allows no eviction at replicas={replicas} "
                              "(a node drain would block forever)")

    containers = (((spec.get("template") or {}).get("spec") or {}).get("containers")) or []
    if not containers:
        errors.append(f"Deployment {name}: no containers")
    for container in containers:
        cname = container.get("name", "?")
        ports = _container_ports(container)
        for kind in ("readinessProbe", "livenessProbe"):
            probe = container.get(kind)
            http = (probe or {}).get("httpGet") or {}
            if not http.get("path"):
                errors.append(f"Deployment {name}/{cname}: no httpGet {kind}")
                continue
            counts["probes"] += 1
            if http.get("port") not in ports:
                errors.append(f"Deployment {name}/{cname}: {kind} port {http.get('port')!r} is not a declared port")

    if name not in enclii:
        errors.append(f"{ENCLII}: no Service named {name} (runtime.replicas must equal the Deployment's)")
    elif enclii[name] != spec.get("replicas", 1):
        errors.append(f"{ENCLII}: Service {name} runtime.replicas={enclii[name]!r} != Deployment replicas="
                      f"{spec.get('replicas', 1)!r}")
    return errors


def compare(root: Path) -> tuple[list[str], dict[str, int]]:
    objects, errors = load_objects(root)
    deployments = [o for o in objects if o.get("kind") == "Deployment"]
    services = [o for o in objects if o.get("kind") == "Service"]
    pdbs = [o for o in objects if o.get("kind") == "PodDisruptionBudget"]
    enclii, enclii_errors = enclii_replicas(root)
    errors.extend(enclii_errors)
    counts = {"objects": len(objects), "deployments": len(deployments), "services": len(services),
              "pdbs": len(pdbs), "probes": 0}
    for dep in deployments:
        errors.extend(check_deployment(dep, services, pdbs, enclii, counts))
    if not deployments or not services or not pdbs:
        errors.append("read 0 Deployments, 0 Services or 0 PodDisruptionBudgets — refusing to pass on an empty read")
    return errors, counts


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=".")
    args = ap.parse_args(argv)
    errors, counts = compare(Path(args.root).resolve())
    print("rollout-safety: " + " ".join(f"{k}={v}" for k, v in counts.items()) + f" errors={len(errors)}")
    for err in errors:
        print(f"  FAIL {err}")
    print("rollout-safety: " + ("FAIL" if errors else "OK"))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
