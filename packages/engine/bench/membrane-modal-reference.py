"""Independent free in-plane CST modal reference; stdlib only, no engine imports.

Reuses the separately tested independent CST *assembler*, without its constraints
or solver. Units: mm, g, s, microN, nJ. Mass is area-lumped from areal density,
not multiplied by thickness twice. No pins, regularization or material rescaling.
stdin: case or {"cases":[...]}; --self-test emits independent validation proof.
"""

import importlib.util
import json
import math
import sys
from pathlib import Path

SOURCE = Path(__file__).with_name("plane-stress-reference.py")
SPEC = importlib.util.spec_from_file_location("modal_cst_reference", SOURCE)
CST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CST)
MAX_DOF = 50
MAX_SWEEPS = 100
JACOBI_RELATIVE = 1e-14
NULL_RELATIVE = 1e-10
CHECK_RELATIVE = 1e-10
ISOLATED_GAP = 1e-6


def dot(a, b):
    return math.fsum(x * y for x, y in zip(a, b))


def norm(values):
    return math.hypot(*values)


def matvec(matrix, vector):
    return [dot(row, vector) for row in matrix]


def jacobi(matrix, max_sweeps=MAX_SWEEPS):
    """Cyclic symmetric Jacobi; no eigenvalue clipping, shifts or input mutation.

    Off-diagonal Frobenius norm <= 1e-14 times original Frobenius norm stops
    the deterministic p/q sweeps. The original physical matrix is not rescaled.
    Eigenvectors are returned as columns in the sorted row-major vectors matrix.
    """
    n = len(matrix)
    if not 1 <= n <= MAX_DOF or any(len(row) != n for row in matrix):
        raise ValueError(f"Jacobi requires a square matrix with 1..{MAX_DOF} DOFs")
    a = [[CST.finite(v, "matrix entry") for v in row] for row in matrix]
    scale = norm(v for row in a for v in row)
    if not math.isfinite(scale):
        raise ValueError("matrix Frobenius norm exceeds finite arithmetic domain")
    symmetry = norm(a[i][j] - a[j][i] for i in range(n) for j in range(n))
    if symmetry > JACOBI_RELATIVE * scale:
        raise ValueError("Jacobi requires a symmetric matrix")
    vectors = [[float(i == j) for j in range(n)] for i in range(n)]
    sweeps = 0
    off = norm(a[i][j] for i in range(n) for j in range(n) if i != j)
    while off > JACOBI_RELATIVE * scale and sweeps < max_sweeps:
        for p in range(n - 1):
            for q in range(p + 1, n):
                apq = a[p][q]
                if apq == 0:
                    continue
                delta = a[q][q] / 2 - a[p][p] / 2
                if delta == 0:
                    t = math.copysign(1.0, apq)
                else:
                    t = apq / (delta + math.copysign(math.hypot(delta, apq), delta))
                c = 1 / math.hypot(1, t)
                s = t * c
                a[p][p] -= t * apq
                a[q][q] += t * apq
                a[p][q] = a[q][p] = 0.0
                for k in range(n):
                    if k != p and k != q:
                        akp, akq = a[k][p], a[k][q]
                        a[k][p] = a[p][k] = c * akp - s * akq
                        a[k][q] = a[q][k] = s * akp + c * akq
                    vkp, vkq = vectors[k][p], vectors[k][q]
                    vectors[k][p] = c * vkp - s * vkq
                    vectors[k][q] = s * vkp + c * vkq
        sweeps += 1
        off = norm(a[i][j] for i in range(n) for j in range(n) if i != j)
    if off > JACOBI_RELATIVE * scale:
        raise ValueError(f"Jacobi did not converge in {max_sweeps} sweeps")
    order = sorted(range(n), key=lambda i: (a[i][i], i))
    values = [a[i][i] for i in order]
    vectors = [[row[i] for i in order] for row in vectors]
    if not all(math.isfinite(v) for v in values + [v for row in vectors for v in row]):
        raise ValueError("Jacobi exceeds finite arithmetic domain")
    checks = spectral_checks(matrix, values, vectors)
    checks.update(
        {"sweeps": sweeps, "offDiagonalRelative": off / scale if scale else 0}
    )
    if not checks["valid"]:
        raise ValueError(f"Jacobi eigen verification failed: {checks}")
    return values, vectors, checks


def spectral_checks(matrix, values, vectors):
    n = len(values)
    scale = norm(v for row in matrix for v in row)
    columns = [[row[j] for row in vectors] for j in range(n)]
    residual = norm(
        x - values[j] * columns[j][i]
        for j in range(n)
        for i, x in enumerate(matvec(matrix, columns[j]))
    )
    reconstruction = norm(
        matrix[i][j]
        - math.fsum(values[k] * vectors[i][k] * vectors[j][k] for k in range(n))
        for i in range(n)
        for j in range(n)
    )
    orthogonality = max(
        abs(dot(columns[i], columns[j]) - float(i == j))
        for i in range(n)
        for j in range(n)
    )
    trace = abs(math.fsum(values) - math.fsum(matrix[i][i] for i in range(n)))
    result = {
        "frobeniusNorm": scale,
        "eigenResidualRelative": residual / scale if scale else residual,
        "reconstructionRelative": reconstruction / scale if scale else reconstruction,
        "orthogonalityMaximum": orthogonality,
        "traceRelative": trace / scale if scale else trace,
    }
    result["valid"] = all(
        result[k] <= CHECK_RELATIVE
        for k in (
            "eigenResidualRelative",
            "reconstructionRelative",
            "orthogonalityMaximum",
            "traceRelative",
        )
    )
    return result


def response(omega, modal_mass, request):
    """Closed-form continuous and exact discrete BE scalar modal response.

    q has units mm; v mm/s; E nJ. Initial q=A, v=0. Scalar outputs reconstruct
    full fields as q*phi, v*phi without copying the eigenvector at each sample.
    """
    if not isinstance(request, dict):
        raise TypeError("response must be an object")
    h = CST.finite(request.get("h"), "response.h")
    amplitude = CST.finite(request.get("amplitude"), "response.amplitude")
    steps = request.get("steps")
    if isinstance(steps, bool) or not isinstance(steps, int):
        raise TypeError("response.steps must be an integer")
    if h <= 0 or not 0 <= steps <= 100000:
        raise ValueError("response requires positive h and 0..100000 steps")
    z = omega * h
    if not math.isfinite(z):
        raise ValueError("response omega*h exceeds finite arithmetic domain")
    angle = math.atan(z)
    attenuation_log = (
        0.5 * math.log1p(z * z)
        if abs(z) <= 1
        else math.log(abs(z)) + 0.5 * math.log1p((1 / z) ** 2)
    )
    energy0 = 0.5 * modal_mass * (amplitude * omega) ** 2
    samples = []
    for step in range(steps + 1):
        time = step * h
        theta = omega * time
        attenuation = math.exp(-step * attenuation_log)
        samples.append(
            {
                "step": step,
                "time": time,
                "continuous": {
                    "coordinate": amplitude * math.cos(theta),
                    "velocity": -amplitude * omega * math.sin(theta),
                    "energy": energy0,
                },
                "backwardEuler": {
                    "coordinate": amplitude * attenuation * math.cos(step * angle),
                    "velocity": -amplitude
                    * omega
                    * attenuation
                    * math.sin(step * angle),
                    "energy": energy0 * attenuation * attenuation,
                },
            }
        )
    result = {"h": h, "steps": steps, "amplitude": amplitude, "samples": samples}
    json.dumps(result, allow_nan=False)
    return result


def rigid_basis(vertices, mass):
    total = math.fsum(mass)
    center = [
        math.fsum(m * p[k] for m, p in zip(mass, vertices)) / total for k in range(2)
    ]
    basis = []
    for kind in range(3):
        vector = []
        for (u, v), m in zip(vertices, mass):
            pair = (
                (1, 0)
                if kind == 0
                else (0, 1)
                if kind == 1
                else (-(v - center[1]), u - center[0])
            )
            vector.extend(math.sqrt(m) * value for value in pair)
        for previous in basis:
            projection = dot(vector, previous)
            vector = [x - projection * y for x, y in zip(vector, previous)]
        length = norm(vector)
        if length == 0 or not math.isfinite(length):
            raise ValueError("degenerate rigid rotation basis")
        basis.append([v / length for v in vector])
    return basis, center


def solve(case):
    if not isinstance(case, dict):
        raise TypeError("case must be an object")
    raw = case.get("vertices")
    if not isinstance(raw, list) or not 3 <= len(raw) <= MAX_DOF // 2:
        raise ValueError(
            f"vertices must contain 3..{MAX_DOF // 2} 2D points (<=50 DOFs)"
        )
    if any(not isinstance(p, list) or len(p) != 2 for p in raw):
        raise ValueError("each vertex must be a 2D point")
    vertices = [[CST.finite(v, "vertex coordinate") for v in p] for p in raw]
    triangles = case.get("triangles")
    if not isinstance(triangles, list) or not triangles:
        raise ValueError("triangles must be a nonempty array")
    rho = CST.finite(case.get("arealDensity"), "arealDensity")
    angle = CST.finite(case.get("angleDegrees"), "angleDegrees")
    if rho <= 0:
        raise ValueError("arealDensity must be positive g/mm^2")
    material, q, global_q, nu21 = CST.engineering_matrix(case.get("material"), angle)
    matrix, elements, _edges, area = CST.assemble(
        vertices, triangles, global_q, material["thickness"]
    )
    mass = [rho * value for value in area]
    if any(v <= 0 or not math.isfinite(v) for v in mass):
        raise ValueError("every nodal mass must be finite positive")
    # Canonical symmetric assignment avoids asymmetric division association.
    ndof = len(matrix)
    root_mass = [math.sqrt(m) for m in mass for _ in range(2)]
    whitened = [[0.0] * ndof for _ in range(ndof)]
    for i in range(ndof):
        for j in range(i, ndof):
            whitened[i][j] = whitened[j][i] = matrix[i][j] / root_mass[i] / root_mass[j]
    values, vectors, checks = jacobi(whitened)
    null_limit = NULL_RELATIVE * checks["frobeniusNorm"]
    null_count = sum(abs(v) <= null_limit for v in values)
    if null_count != 3 or any(v < -null_limit for v in values):
        raise ValueError(
            f"free connected in-plane mesh must have exactly 3 rigid modes; got {null_count}"
        )
    positive = [i for i, value in enumerate(values) if value > null_limit]
    selected = None
    for i in positive:
        gap = min(
            abs(values[i] - values[j]) / max(abs(values[i]), abs(values[j]))
            for j in (i - 1, i + 1)
            if 0 <= j < ndof
        )
        if gap >= ISOLATED_GAP:
            selected = i, gap
            break
    if selected is None:
        raise ValueError("no isolated positive mode meets the predeclared relative gap")
    index, gap = selected
    eigenvector = [row[index] for row in vectors]
    phi = [x / m for x, m in zip(eigenvector, root_mass)]
    max_node = max(math.hypot(phi[2 * i], phi[2 * i + 1]) for i in range(len(mass)))
    sign_index = max(range(ndof), key=lambda i: abs(phi[i]))
    factor = math.copysign(1.0, phi[sign_index]) / max_node
    phi = [v * factor for v in phi]
    modal_mass = math.fsum(mass[i // 2] * v * v for i, v in enumerate(phi))
    rigid, center = rigid_basis(vertices, mass)
    rigid_residual = (
        max(norm(matvec(whitened, vector)) for vector in rigid)
        / checks["frobeniusNorm"]
    )
    rigid_projection = max(abs(dot(eigenvector, vector)) for vector in rigid)
    null_projection = max(
        norm(
            x
            - math.fsum(
                dot(vector, [row[k] for row in vectors]) * vectors[i][k]
                for k in range(3)
            )
            for i, x in enumerate(vector)
        )
        for vector in rigid
    )
    checks.update(
        {
            "nullCount": null_count,
            "nullAbsoluteLimit": null_limit,
            "rigidResidualRelative": rigid_residual,
            "modeRigidProjectionMaximum": rigid_projection,
            "rigidNullspaceProjectionError": null_projection,
        }
    )
    checks["valid"] = (
        checks["valid"]
        and max(rigid_residual, rigid_projection, null_projection) <= CHECK_RELATIVE
    )
    if not checks["valid"]:
        raise ValueError(f"rigid subspace verification failed: {checks}")
    omega = math.sqrt(values[index])
    requests = case.get("responses", [])
    if not isinstance(requests, list):
        raise TypeError("responses must be an array")
    result = {
        "schema": "pliego-membrane-modal-reference/1",
        "valid": True,
        "vertices": len(vertices),
        "triangles": len(triangles),
        "dofs": ndof,
        "area": math.fsum(e["area"] for e in elements),
        "mass": mass,
        "totalMass": math.fsum(mass),
        "centerOfMass": center,
        "material": material,
        "nu21": nu21,
        "engineeringQ": q,
        "angleDegrees": angle,
        "arealDensity": rho,
        "eigenvalues": values,
        "checks": checks,
        "spectrum": {
            "eigenvalues": values,
            "nullIndices": [
                i for i, value in enumerate(values) if abs(value) <= null_limit
            ],
            "massNormalizedModes": [
                [
                    [
                        vectors[2 * i][k] / root_mass[2 * i],
                        vectors[2 * i + 1][k] / root_mass[2 * i + 1],
                    ]
                    for i in range(len(mass))
                ]
                for k in range(ndof)
            ],
            "basisUnits": "g^(-1/2); M-orthonormal, distinct from dimensionless selected phi",
            "nullPropagation": "classified null modes propagate at exactly zero frequency; raw eigenvalues retained",
        },
        "mode": {
            "eigenIndex": index,
            "positiveIndex": positive.index(index),
            "eigenvalue": values[index],
            "omega": omega,
            "relativeGap": gap,
            "phi": [phi[i : i + 2] for i in range(0, ndof, 2)],
            "modalMass": modal_mass,
            "maxNodeNorm": max(norm(phi[i : i + 2]) for i in range(0, ndof, 2)),
            "signDof": sign_index,
        },
        "matrix": {
            "stiffnessSHA256": CST.digest(matrix),
            "whitenedSHA256": CST.digest(whitened),
        },
        "tolerances": {
            "maximumDOF": MAX_DOF,
            "maximumSweeps": MAX_SWEEPS,
            "jacobiOffDiagonalFrobeniusRelative": JACOBI_RELATIVE,
            "nullFrobeniusRelative": NULL_RELATIVE,
            "verificationRelative": CHECK_RELATIVE,
            "isolatedModeRelativeGap": ISOLATED_GAP,
        },
        "responses": [response(omega, modal_mass, r) for r in requests],
        "inputSHA256": CST.digest(case),
        "scope": "free in-plane linear CST and independent area-lumped mass; first isolated positive mode; no pins, regularization, engine matrices, continuum convergence or physical-stock calibration",
    }
    if case.get("includeMatrix") is True:
        result["matrix"]["stiffness"] = matrix
        result["matrix"]["whitened"] = whitened
    json.dumps(result, allow_nan=False)
    return result


def dispatch(value):
    if isinstance(value, dict) and "cases" in value:
        if not isinstance(value["cases"], list) or not value["cases"]:
            raise ValueError("cases must be a nonempty array")
        return {
            "schema": "pliego-membrane-modal-reference-batch/1",
            "cases": [solve(c) for c in value["cases"]],
        }
    return solve(value)


def main():
    try:
        if sys.argv[1:] == ["--self-test"]:
            from test_membrane_modal_reference import run_self_validation

            result = run_self_validation()
        elif sys.argv[1:]:
            raise ValueError("usage: membrane-modal-reference.py [--self-test]")
        else:
            result = dispatch(json.load(sys.stdin))
        json.dump(result, sys.stdout, allow_nan=False, separators=(",", ":"))
        sys.stdout.write("\n")
        return int(sys.argv[1:] == ["--self-test"] and not result["passed"])
    except (ValueError, TypeError, KeyError, OverflowError, ZeroDivisionError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
