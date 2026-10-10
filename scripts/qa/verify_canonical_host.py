#!/usr/bin/env python3
"""Every public host is declared once (enclii.yaml) and agreed everywhere else.

The canonical hosts are the `spec.domains[].name` of the Service documents in `enclii.yaml`.
This lane fails when:

* a domain in enclii.yaml does not pin `port: 80` (the tunnel would dial the container port);
* a status entry probes a host that enclii.yaml does not declare, or lacks
  `assertNotContains: localhost:`;
* `PLIEGO_PUBLIC_{LANDING,APP,API}_HOST` in the production deployment is not an enclii.yaml host,
  or an enclii.yaml host is named by none of them;
* an origin in `PLIEGO_CORS_ORIGINS` is not `https://<enclii host>`, is a wildcard, or the landing
  and studio hosts are missing from it;
* a Janua redirect or post-logout URI in `janua.client.yaml` names a host enclii.yaml does not
  declare;
* a `https://*.madfam.io` origin literal in `apps/api/**/*.py` or `apps/web/**/*.js` names a
  host outside enclii.yaml.

Read-proof: prints the hosts and references it compared; zero hosts is a failure.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import yaml

HOST_ENVS = ("PLIEGO_PUBLIC_LANDING_HOST", "PLIEGO_PUBLIC_APP_HOST", "PLIEGO_PUBLIC_API_HOST")
MADFAM_ORIGIN = re.compile(r"https://([a-z0-9.-]+\.madfam\.io)\b")
SKIP_DIRS = {"node_modules", "__pycache__", ".venv", "venv"}


def load_all(path: Path) -> list[dict]:
    return [d for d in yaml.safe_load_all(path.read_text(encoding="utf-8")) if isinstance(d, dict)]


def enclii_hosts(docs: list[dict], errors: list[str]) -> tuple[set[str], list[dict]]:
    hosts: set[str] = set()
    entries: list[dict] = []
    for doc in docs:
        if doc.get("kind") != "Service":
            continue
        spec = doc.get("spec") or {}
        for dom in spec.get("domains") or []:
            name = str(dom.get("name", "")).strip()
            if not name:
                continue
            hosts.add(name)
            if dom.get("port") != 80:
                errors.append(f"enclii.yaml: domain {name} must pin `port: 80` (got {dom.get('port')!r})")
            if name.count(".") != 2:
                errors.append(f"enclii.yaml: domain {name} is not a flat label under madfam.io")
        entries.extend((spec.get("status") or {}).get("entries") or [])
    return hosts, entries


def deployment_env(docs: list[dict]) -> dict[str, str]:
    env: dict[str, str] = {}
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        for container in ((doc.get("spec") or {}).get("template") or {}).get("spec", {}).get("containers") or []:
            for item in container.get("env") or []:
                if "value" in item:
                    env[str(item.get("name"))] = str(item.get("value"))
    return env


def source_origins(root: Path) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for base, exts in (("apps/api", {".py"}), ("apps/web", {".js", ".mjs", ".html"})):
        start = root / base
        if not start.is_dir():
            continue
        for path in sorted(start.rglob("*")):
            if not path.is_file() or path.suffix not in exts or SKIP_DIRS & set(path.parts):
                continue
            for host in MADFAM_ORIGIN.findall(path.read_text(encoding="utf-8", errors="replace")):
                found.append((str(path.relative_to(root)), host))
    return found


# Hosts a product may legitimately name that are not its own: the identity provider and analytics.
ECOSYSTEM_HOSTS = {"auth.madfam.io", "plausible.madfam.io", "status.madfam.io"}


def compare(root: Path) -> tuple[list[str], dict[str, int]]:
    errors: list[str] = []
    hosts, entries = enclii_hosts(load_all(root / "enclii.yaml"), errors)
    counts = {"hosts": len(hosts), "status_entries": len(entries), "env_hosts": 0, "cors": 0, "janua_uris": 0, "source_refs": 0}
    if not hosts:
        errors.append("enclii.yaml declares 0 domains — refusing to pass on an empty read")
        return errors, counts

    for entry in entries:
        host = urlparse(str(entry.get("url", ""))).hostname
        if host not in hosts:
            errors.append(f"enclii.yaml: status entry {entry.get('name')!r} probes undeclared host {host!r}")
        if "localhost:" not in str(entry.get("assertNotContains", "")):
            errors.append(f"enclii.yaml: status entry {entry.get('name')!r} lacks assertNotContains: localhost:")

    deploy = root / "infra" / "k8s" / "production" / "deployment.yaml"
    env = deployment_env(load_all(deploy)) if deploy.is_file() else {}
    if not env:
        errors.append("infra/k8s/production/deployment.yaml: no container env read")
    named = set()
    for key in HOST_ENVS:
        value = env.get(key)
        counts["env_hosts"] += value is not None
        if value is None:
            errors.append(f"deployment.yaml: {key} is not set")
        elif value not in hosts:
            errors.append(f"deployment.yaml: {key}={value} is not an enclii.yaml host")
        else:
            named.add(value)
    for host in sorted(hosts - named):
        errors.append(f"enclii.yaml: host {host} is named by no PLIEGO_PUBLIC_*_HOST env")

    origins = [o.strip() for o in env.get("PLIEGO_CORS_ORIGINS", "").split(",") if o.strip()]
    counts["cors"] = len(origins)
    for origin in origins:
        parsed = urlparse(origin)
        if "*" in origin or parsed.scheme != "https" or parsed.hostname not in hosts or parsed.path not in ("", "/"):
            errors.append(f"deployment.yaml: CORS origin {origin!r} is not https://<enclii host>")
    origin_hosts = {urlparse(o).hostname for o in origins}
    for key in ("PLIEGO_PUBLIC_LANDING_HOST", "PLIEGO_PUBLIC_APP_HOST"):
        if env.get(key) and env[key] not in origin_hosts:
            errors.append(f"deployment.yaml: PLIEGO_CORS_ORIGINS misses https://{env[key]} ({key})")

    janua = root / "janua.client.yaml"
    if janua.is_file():
        data = yaml.safe_load(janua.read_text(encoding="utf-8")) or {}
        for client in data.get("clients") or []:
            for uri in (client.get("redirect_uris") or []) + (client.get("post_logout_redirect_uris") or []):
                counts["janua_uris"] += 1
                host = urlparse(uri).hostname
                if urlparse(uri).scheme != "https" or host not in hosts:
                    errors.append(f"janua.client.yaml: {client.get('name')} URI {uri} names undeclared host {host!r}")
    else:
        errors.append("janua.client.yaml is missing")

    for rel, host in source_origins(root):
        counts["source_refs"] += 1
        if host not in hosts and host not in ECOSYSTEM_HOSTS:
            errors.append(f"{rel}: origin https://{host} is not an enclii.yaml host")
    return errors, counts


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=".")
    args = ap.parse_args(argv)
    errors, counts = compare(Path(args.root).resolve())
    print("canonical-host: " + " ".join(f"{k}={v}" for k, v in counts.items()) + f" errors={len(errors)}")
    for err in errors:
        print(f"  FAIL {err}")
    print("canonical-host: " + ("FAIL" if errors else "OK"))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
