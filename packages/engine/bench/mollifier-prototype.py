"""Independent IPC multiplier algebra, not the native contact implementation.

Run with a Python environment containing ipctk==1.4.0 and NumPy; stdout is
machine-readable evidence. No runtime/package dependency is added to Pliego.
"""

import argparse
import hashlib
import json
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

import ipctk
import numpy as np

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--native",
    action="store_true",
    help="also compare the production JavaScript multiplier and gradient",
)
args = parser.parse_args()


def own(p, eps):
    u, v = p[1] - p[0], p[3] - p[2]
    cross = np.cross(u, v)
    c = float(cross @ cross)
    if c >= eps:
        return 1.0, np.zeros(12), np.zeros((12, 12))
    ua = [-1, 1, 0, 0]
    vb = [0, 0, -1, 1]
    basis = np.eye(3)
    J = np.zeros((3, 12))
    Hc = np.zeros((12, 12))
    for a in range(4):
        for i in range(3):
            J[:, 3 * a + i] = ua[a] * np.cross(basis[i], v) + vb[a] * np.cross(
                u, basis[i]
            )
    dc = 2 * J.T @ cross
    for a in range(4):
        for b in range(4):
            for i in range(3):
                for j in range(3):
                    Hc[3 * a + i, 3 * b + j] = 2 * (
                        J[:, 3 * a + i] @ J[:, 3 * b + j]
                    ) + 2 * (ua[a] * vb[b] - ua[b] * vb[a]) * (
                        cross @ np.cross(basis[i], basis[j])
                    )
    r = c / eps
    mp = 2 * (1 - r) / eps
    mpp = -2 / (eps * eps)
    return (2 - r) * r, mp * dc, mp * Hc + mpp * np.outer(dc, dc)


rng = np.random.default_rng(195)
cases = []
for scale in [0.001, 1, 1000]:
    for tilt in [0, 1e-9, 1e-5, 0.001, 0.01, 0.02, 0.03, 0.04, 1]:
        p = (
            np.array(
                [[-1, 0, 0], [1, 0, 0], [-0.5, 0.12, -tilt], [0.5, 0.12, tilt]],
                dtype=float,
            )
            * scale
        )
        cases.append((p, 0.004 * scale**4))
for i in range(32):
    p = rng.normal(size=(4, 3))
    u = p[1] - p[0]
    p[3] = (
        p[2] + u * (0.3 + rng.random()) + rng.normal(size=3) * (0.001 if i % 2 else 0.1)
    )
    eps = 0.001 * float(u @ u) * float((p[3] - p[2]) @ (p[3] - p[2]))
    cases.append((p, eps))
# Zero-rest-length threshold follows the published scalar branch: m=1.
cases.append(
    (np.array([[-1, 0, 0], [1, 0, 0], [-0.5, 0.12, 0], [0.5, 0.12, 0]], float), 0.0)
)
maxerr = [0.0, 0.0, 0.0]
maxfd = 0.0
maxhfd = 0.0
for p, eps in cases:
    a = own(p, eps)
    b = (
        ipctk.edge_edge_mollifier(*p, eps),
        ipctk.edge_edge_mollifier_gradient(*p, eps),
        ipctk.edge_edge_mollifier_hessian(*p, eps),
    )
    for i in range(3):
        err = float(np.linalg.norm(np.asarray(a[i]) - b[i])) / max(
            1.0, float(np.linalg.norm(b[i]))
        )
        maxerr[i] = max(maxerr[i], err)
        assert err < 3e-10, (i, err)
# Independent finite differences away from the clamp boundary; units here mm.
for p, eps in cases[9:18]:
    if not eps:
        continue
    m, g, h = own(p, eps)
    step = 2e-7
    for j in range(12):
        plus = p.copy().reshape(-1)
        minus = p.copy().reshape(-1)
        plus[j] += step
        minus[j] -= step
        ap = own(plus.reshape((4, 3)), eps)
        am = own(minus.reshape((4, 3)), eps)
        fd = (ap[0] - am[0]) / (2 * step)
        ge = abs(fd - g[j]) / max(1.0, abs(g[j]))
        maxfd = max(maxfd, ge)
        assert ge < 1e-5, (j, ge)
        he = np.linalg.norm((ap[1] - am[1]) / (2 * step) - h[:, j]) / max(
            1.0, np.linalg.norm(h[:, j])
        )
        maxhfd = max(maxhfd, float(he))
        assert he < 1e-5, (j, he)
r = {
    "schema": "pliego-mollifier-independent-prototype/0.1",
    "reference": {
        "package": "ipctk",
        "version": version("ipctk"),
        "numpy": np.__version__,
        "python": sys.version.split()[0],
        "binarySHA256": hashlib.sha256(Path(ipctk.__file__).read_bytes()).hexdigest(),
        "sourceTagCommit": "dac3b97b1a4a8247f5d55ccba352659976d276e5",
    },
    "seed": 195,
    "cases": len(cases),
    "inputsSHA256": hashlib.sha256(
        b"".join(
            p.astype("<f8").tobytes() + np.array([eps], dtype="<f8").tobytes()
            for p, eps in cases
        )
    ).hexdigest(),
    "scaleRange": [0.001, 1000],
    "quantity": "scalar energy multiplier, Cartesian gradient and exact multiplier Hessian; not full contact or World implementation",
    "maximumNormalizedReferenceErrors": {
        "value": maxerr[0],
        "gradient": maxerr[1],
        "hessian": maxerr[2],
    },
    "maximumGradientFiniteDifferenceError": maxfd,
    "maximumHessianFiniteDifferenceError": maxhfd,
    "prototypeSHA256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "acceptance": "component algebra only; no native physics, coverage, friction or material validation",
}
if args.native:
    adapter = Path(__file__).with_name("mollifier-native.mjs")
    module = adapter.parent.parent / "src" / "collision" / "edge-mollifier.js"
    payload = [{"points": p.tolist(), "threshold": eps} for p, eps in cases]
    native = json.loads(
        subprocess.run(
            ["node", str(adapter)],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            check=True,
        ).stdout
    )
    assert len(native) == len(cases)
    errors = [0.0, 0.0]
    for (p, eps), actual in zip(cases, native, strict=True):
        expected = [
            ipctk.edge_edge_mollifier(*p, eps),
            ipctk.edge_edge_mollifier_gradient(*p, eps),
        ]
        for i, value in enumerate([actual["multiplier"], actual["gradient"]]):
            error = float(np.linalg.norm(np.asarray(value) - expected[i])) / max(
                1.0, float(np.linalg.norm(expected[i]))
            )
            errors[i] = max(errors[i], error)
            assert error < 3e-10, (i, error)
    r["native"] = {
        "cases": len(cases),
        "moduleSHA256": hashlib.sha256(module.read_bytes()).hexdigest(),
        "adapterSHA256": hashlib.sha256(adapter.read_bytes()).hexdigest(),
        "maximumNormalizedReferenceErrors": {"value": errors[0], "gradient": errors[1]},
        "scope": "production multiplier/gradient only; approximate contact curvature, coverage and World convergence tested separately",
    }
print(json.dumps(r, indent=2))

print(
    f"mollifier-prototype: cases={len(cases)} reference={version('ipctk')} value/gradient/Hessian and finite differences passed; native coverage OPEN",
    file=sys.stderr,
)
