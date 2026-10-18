"""Tests for scripts/qa/verify_rollout_safety.py. Run: python -m unittest discover -s scripts/qa/tests -v

The repository's own manifests must pass; every other test copies them into a throwaway tree, plants one
defect and asserts the lane names it, so a pass proves the lane can FAIL.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

QA = Path(__file__).resolve().parents[1]
REPO = QA.parents[1]
PROD = "infra/k8s/production"

_spec = importlib.util.spec_from_file_location("verify_rollout_safety", QA / "verify_rollout_safety.py")
rollout = importlib.util.module_from_spec(_spec)
sys.modules["verify_rollout_safety"] = rollout
_spec.loader.exec_module(rollout)


def run(root: Path) -> tuple[int, str]:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = rollout.main(["--root", str(root)])
    return code, buf.getvalue()


class RolloutSafetyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="pliego-qa-rollout-"))
        shutil.copytree(REPO / PROD, self.tmp / PROD)
        shutil.copy(REPO / "enclii.yaml", self.tmp / "enclii.yaml")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def edit(self, rel: str, old: str, new: str) -> None:
        path = self.tmp / rel
        text = path.read_text(encoding="utf-8")
        self.assertIn(old, text, f"fixture drifted: {old!r} not in {rel}")
        path.write_text(text.replace(old, new, 1), encoding="utf-8")

    def assertFails(self, needle: str) -> None:
        code, out = run(self.tmp)
        self.assertEqual(code, 1, out)
        self.assertIn(needle, out)

    def test_repo_manifests_pass(self) -> None:
        code, out = run(REPO)
        self.assertEqual(code, 0, out)
        self.assertIn("deployments=1", out)
        self.assertIn("pdbs=1", out)
        self.assertIn("probes=2", out)

    def test_copied_tree_passes(self) -> None:
        code, out = run(self.tmp)
        self.assertEqual(code, 0, out)

    def test_one_replica_fails(self) -> None:
        self.edit(f"{PROD}/deployment.yaml", "  replicas: 2\n", "  replicas: 1\n")
        self.edit("enclii.yaml", "    replicas: 2\n", "    replicas: 1\n")
        self.assertFails("replicas=1, need >= 2")

    def test_unset_replicas_counts_as_one(self) -> None:
        self.edit(f"{PROD}/deployment.yaml", "  replicas: 2\n", "")
        self.assertFails("replicas=1, need >= 2")

    def test_max_unavailable_one_fails(self) -> None:
        self.edit(f"{PROD}/deployment.yaml", "maxUnavailable: 0", "maxUnavailable: 1")
        self.assertFails("maxUnavailable=1, need 0")

    def test_unset_rolling_update_uses_kubernetes_defaults(self) -> None:
        # 25% of 2 rounds down to 0 unavailable and up to 1 surge: the defaults happen to be safe at 2.
        self.edit(f"{PROD}/deployment.yaml", "      maxSurge: 1\n      maxUnavailable: 0\n", "")
        code, out = run(self.tmp)
        self.assertEqual(code, 0, out)

    def test_max_surge_zero_fails(self) -> None:
        self.edit(f"{PROD}/deployment.yaml", "maxSurge: 1", "maxSurge: 0")
        self.assertFails("maxSurge=0, need >= 1")

    def test_recreate_strategy_fails(self) -> None:
        self.edit(f"{PROD}/deployment.yaml", "type: RollingUpdate", "type: Recreate")
        self.assertFails("strategy.type=Recreate")

    def test_missing_pdb_fails(self) -> None:
        self.edit(f"{PROD}/kustomization.yaml", "- poddisruptionbudget.yaml\n", "")
        self.assertFails("no PodDisruptionBudget has selector.matchLabels")
        self.assertFails("refusing to pass on an empty read")

    def test_pdb_selector_drift_fails(self) -> None:
        self.edit(f"{PROD}/poddisruptionbudget.yaml", "  selector:\n    matchLabels:\n      app.kubernetes.io/name: pliego",
                  "  selector:\n    matchLabels:\n      app: pliego")
        self.assertFails("no PodDisruptionBudget has selector.matchLabels == {'app.kubernetes.io/name': 'pliego'}")

    def test_pdb_that_blocks_every_eviction_fails(self) -> None:
        self.edit(f"{PROD}/poddisruptionbudget.yaml", "minAvailable: 1", "minAvailable: 2")
        self.assertFails("allows no eviction at replicas=2")

    def test_pdb_percent_that_blocks_every_eviction_fails(self) -> None:
        self.edit(f"{PROD}/poddisruptionbudget.yaml", "minAvailable: 1", 'minAvailable: "100%"')
        self.assertFails("allows no eviction at replicas=2")

    def test_pdb_old_api_fails(self) -> None:
        self.edit(f"{PROD}/poddisruptionbudget.yaml", "apiVersion: policy/v1\n", "apiVersion: policy/v1beta1\n")
        self.assertFails("need policy/v1")

    def test_routed_service_must_select_the_pods(self) -> None:
        self.edit(f"{PROD}/service.yaml", "  selector:\n    app.kubernetes.io/name: pliego",
                  "  selector:\n    app.kubernetes.io/name: pliego-old")
        self.assertFails("does not select Deployment pliego's pod labels")

    def test_missing_readiness_probe_fails(self) -> None:
        self.edit(f"{PROD}/deployment.yaml", "          readinessProbe:\n            httpGet: { path: /ready, port: http }\n",
                  "          readinessProbe:\n            tcpSocket: { port: http }\n")
        self.assertFails("no httpGet readinessProbe")

    def test_liveness_probe_on_undeclared_port_fails(self) -> None:
        self.edit(f"{PROD}/deployment.yaml", "httpGet: { path: /health, port: http }", "httpGet: { path: /health, port: web }")
        self.assertFails("livenessProbe port 'web' is not a declared port")

    def test_enclii_replicas_drift_fails(self) -> None:
        self.edit("enclii.yaml", "    replicas: 2\n", "    replicas: 1\n")
        self.assertFails("runtime.replicas=1 != Deployment replicas=2")

    def test_missing_kustomization_resource_fails(self) -> None:
        (self.tmp / PROD / "poddisruptionbudget.yaml").unlink()
        self.assertFails("kustomization resource `poddisruptionbudget.yaml` is not a file")


if __name__ == "__main__":
    unittest.main()
