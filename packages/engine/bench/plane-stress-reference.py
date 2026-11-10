"""Independent stdlib CST assembly and solved 2D plane-stress rectangle BVP.

No engine, other oracle, spring, StVK, runtime matrix or runtime solver imports.
The entire left edge fixes u/v for clamped-left; poisson-compatible fixes left u
and one lower-left v, and is allowed only for material axes aligned with x/y.
Right-edge reference dead traction is eta*E1, multiplied by physical thickness.
stdin: case or {"cases":[...]}; --self-test emits actual independent test proof.
This linear small-strain FE reference does not calibrate a physical paper stock.
"""

import hashlib
import json
import math
import sys

PIVOT_MIN = 1e-13
BOUNDARY_TOLERANCE = 4e-9
FORCE_ABSOLUTE = 1e-7
FORCE_RELATIVE = 1e-10
ENERGY_FLOOR = 1e-20


def finite(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a finite number")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite")
    return value


def digest(value):
    return hashlib.sha256(
        json.dumps(value, allow_nan=False, separators=(",", ":")).encode()
    ).hexdigest()


def lu_factor(matrix):
    """Global-scale normalized dense partial-pivot LU; lowest index wins ties."""
    n = len(matrix)
    if n == 0 or any(len(row) != n for row in matrix):
        raise ValueError("LU requires a nonempty square matrix")
    values = [finite(v, "matrix entry") for row in matrix for v in row]
    scale = max(map(abs, values))
    if scale == 0:
        raise ValueError("singular matrix")
    lu = [[v / scale for v in row] for row in matrix]
    permutation = list(range(n))
    smallest = math.inf
    for k in range(n):
        pivot = max(range(k, n), key=lambda i: abs(lu[i][k]))
        magnitude = abs(lu[pivot][k])
        if not math.isfinite(magnitude) or magnitude <= PIVOT_MIN:
            raise ValueError("singular or numerically rank-deficient reduced matrix")
        smallest = min(smallest, magnitude)
        lu[k], lu[pivot] = lu[pivot], lu[k]
        permutation[k], permutation[pivot] = permutation[pivot], permutation[k]
        for i in range(k + 1, n):
            lu[i][k] /= lu[k][k]
            multiplier = lu[i][k]
            if multiplier:
                for j in range(k + 1, n):
                    lu[i][j] -= multiplier * lu[k][j]
    if not all(math.isfinite(v) for row in lu for v in row):
        raise ValueError("LU exceeds finite arithmetic domain")
    return {"lu": lu, "permutation": permutation, "scale": scale, "minimumScaledPivot": smallest}


def lu_solve(factor, rhs):
    lu, permutation, scale = factor["lu"], factor["permutation"], factor["scale"]
    if len(rhs) != len(lu):
        raise ValueError("LU right-hand side dimension mismatch")
    b = [finite(rhs[i], "right-hand side") / scale for i in permutation]
    for i in range(len(b)):
        b[i] -= math.fsum(lu[i][j] * b[j] for j in range(i))
    for i in reversed(range(len(b))):
        b[i] = (b[i] - math.fsum(lu[i][j] * b[j] for j in range(i + 1, len(b)))) / lu[i][i]
    if not all(map(math.isfinite, b)):
        raise ValueError("solution exceeds finite arithmetic domain")
    return b


def engineering_matrix(material, angle):
    """Explicit reciprocal compliance and tensor-rotated engineering basis."""
    if not isinstance(material, dict):
        raise TypeError("material must be an object")
    m = {
        k: finite(material.get(k), f"material.{k}")
        for k in ("E1", "E2", "nu12", "G12", "thickness")
    }
    e1, e2, nu, shear, thickness = (m[k] for k in m)
    if min(e1, e2, shear, thickness) <= 0:
        raise ValueError("positive engineering constants and thickness required")
    nu21 = nu * e2 / e1
    denominator = 1 - nu * nu21
    if not math.isfinite(denominator) or denominator <= 0:
        raise ValueError("reciprocal compliance must be positive definite")
    q = [
        [e1 / denominator, nu * e2 / denominator, 0],
        [nu * e2 / denominator, e2 / denominator, 0],
        [0, 0, shear],
    ]
    radians = math.radians(angle % 360)
    c, s = math.cos(radians), math.sin(radians)
    # Each column independently rotates a global unit strain tensor into the
    # material basis. Engineering shear is twice its off-diagonal component.
    columns = []
    for xx, yy, gamma in ((1, 0, 0), (0, 1, 0), (0, 0, 1)):
        xy = gamma / 2
        columns.append(
            [
                c * c * xx + 2 * c * s * xy + s * s * yy,
                s * s * xx - 2 * c * s * xy + c * c * yy,
                2 * (-c * s * xx + (c * c - s * s) * xy + c * s * yy),
            ]
        )
    global_q = [[0.0] * 3 for _ in range(3)]
    for i in range(3):
        for j in range(i, 3):
            value = math.fsum(
                columns[i][a] * q[a][b] * columns[j][b] for a in range(3) for b in range(3)
            )
            global_q[i][j] = global_q[j][i] = value
    if not all(math.isfinite(v) for matrix in (q, global_q) for row in matrix for v in row):
        raise ValueError("stiffness exceeds finite arithmetic domain")
    return m, q, global_q, nu21


def assemble(vertices, triangles, q, thickness):
    """Direct independent B^T Q B element assembly in sheet displacement DOFs."""
    n = len(vertices)
    matrix = [[0.0] * (2 * n) for _ in range(2 * n)]
    elements, edges, used, seen, lumped = [], {}, set(), set(), [0.0] * n
    for tri in triangles:
        if (
            not isinstance(tri, list)
            or len(tri) != 3
            or any(isinstance(i, bool) or not isinstance(i, int) or i < 0 or i >= n for i in tri)
            or len(set(tri)) != 3
        ):
            raise ValueError("triangle must contain three distinct valid vertex indices")
        key = tuple(sorted(tri))
        if key in seen:
            raise ValueError("duplicate triangle")
        seen.add(key)
        used.update(tri)
        a, b, c = [vertices[i] for i in tri]
        twice = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
        scale = max((p[0] - r[0]) ** 2 + (p[1] - r[1]) ** 2 for p, r in ((a, b), (a, c), (b, c)))
        if not math.isfinite(twice) or twice <= 1e-12 * scale:
            raise ValueError("triangle must have positive well-conditioned reference area")
        area = twice / 2
        grads = [
            [(b[1] - c[1]) / twice, (c[0] - b[0]) / twice],
            [(c[1] - a[1]) / twice, (a[0] - c[0]) / twice],
            [(a[1] - b[1]) / twice, (b[0] - a[0]) / twice],
        ]
        columns = [col for bx, by in grads for col in ([bx, 0, by], [0, by, bx])]
        dofs = [2 * i + k for i in tri for k in range(2)]
        for i in range(6):
            for j in range(i, 6):
                value = (
                    thickness
                    * area
                    * math.fsum(
                        columns[i][r] * q[r][s] * columns[j][s] for r in range(3) for s in range(3)
                    )
                )
                matrix[dofs[i]][dofs[j]] += value
                if i != j:
                    matrix[dofs[j]][dofs[i]] += value
        elements.append({"ids": tri[:], "area": area, "columns": columns, "dofs": dofs})
        for i in tri:
            lumped[i] += area / 3
        for i, j in zip(tri, tri[1:] + tri[:1]):
            edge_key = tuple(sorted((i, j)))
            records = edges.setdefault(edge_key, [])
            records.append((i, j))
            if len(records) > 2 or len(records) == 2 and records[0] != records[1][::-1]:
                raise ValueError("nonmanifold or inconsistently oriented edge")
    if len(used) != n:
        raise ValueError("every vertex must be referenced by triangles")
    return matrix, elements, edges, lumped


def rectangle_boundary(vertices, edges, boundary, angle, material):
    if boundary not in ("clamped-left", "poisson-compatible"):
        raise ValueError("unsupported boundary")
    if boundary == "poisson-compatible" and abs(angle / 90 - round(angle / 90)) > 1e-12:
        raise ValueError("poisson-compatible requires aligned grain (multiples of 90 degrees)")
    sides = {name: [] for name in ("left", "right", "bottom", "top")}
    for records in edges.values():
        if len(records) != 1:
            continue
        a, b = records[0]
        p, r = vertices[a], vertices[b]
        assigned = False
        for name, axis, target in (
            ("left", 0, 0),
            ("right", 0, 40),
            ("bottom", 1, 0),
            ("top", 1, 40),
        ):
            if (
                abs(p[axis] - target) <= BOUNDARY_TOLERANCE
                and abs(r[axis] - target) <= BOUNDARY_TOLERANCE
            ):
                sides[name].append([a, b])
                assigned = True
                break
        if not assigned:
            raise ValueError("every boundary edge must lie on the 40x40 rectangle")
    for name, segments in sides.items():
        axis = 1 if name in ("left", "right") else 0
        intervals = sorted(
            (min(vertices[a][axis], vertices[b][axis]), max(vertices[a][axis], vertices[b][axis]))
            for a, b in segments
        )
        cursor = 0.0
        for lo, hi in intervals:
            if abs(lo - cursor) > BOUNDARY_TOLERANCE or hi <= lo:
                raise ValueError("rectangle boundary has a gap or overlap")
            cursor = hi
        if abs(cursor - 40) > BOUNDARY_TOLERANCE:
            raise ValueError("rectangle boundary coverage must equal 40 mm per side")
    left = sorted({v for edge in sides["left"] for v in edge})
    fixed = [2 * v for v in left]
    if boundary == "clamped-left":
        fixed += [2 * v + 1 for v in left]
    else:
        fixed.append(2 * min(left, key=lambda i: (vertices[i][1], i)) + 1)
    force = [0.0] * (2 * len(vertices))
    for a, b in sides["right"]:
        length = math.dist(vertices[a], vertices[b])
        for node in (a, b):
            force[2 * node] += material["thickness"] * material["E1"] * length / 2
    return sorted(fixed), force, sides


def element_observation(elements, q, thickness, u, nodes):
    energy, gradient = [], [0.0] * (2 * nodes)
    for element in elements:
        columns, dofs = element["columns"], element["dofs"]
        strain = [math.fsum(columns[i][r] * u[dofs[i]] for i in range(6)) for r in range(3)]
        stress = [math.fsum(q[i][j] * strain[j] for j in range(3)) for i in range(3)]
        volume = element["area"] * thickness
        energy.append(0.5 * volume * math.fsum(strain[i] * stress[i] for i in range(3)))
        for i, dof in enumerate(dofs):
            gradient[dof] += volume * math.fsum(columns[i][r] * stress[r] for r in range(3))
    return math.fsum(energy), gradient


def nonaffinity(vertices, u):
    basis = [[1.0, (x - 20) / 40, (y - 20) / 40] for x, y in vertices]
    gram = [[math.fsum(row[i] * row[j] for row in basis) for j in range(3)] for i in range(3)]
    factor = lu_factor(gram)
    fitted = [0.0] * len(u)
    for c in range(2):
        rhs = [math.fsum(row[i] * u[2 * v + c] for v, row in enumerate(basis)) for i in range(3)]
        coefficients = lu_solve(factor, rhs)
        for v, row in enumerate(basis):
            fitted[2 * v + c] = math.fsum(a * b for a, b in zip(coefficients, row))
    denominator = math.hypot(*u)
    return math.hypot(*(a - b for a, b in zip(u, fitted))) / denominator if denominator else 0.0


def solve(case):
    if not isinstance(case, dict):
        raise TypeError("case must be an object")
    angle = finite(case.get("angleDegrees"), "angleDegrees")
    material, q, global_q, nu21 = engineering_matrix(case.get("material"), angle)
    raw = case.get("vertices")
    if not isinstance(raw, list) or len(raw) < 4 or 2 * len(raw) > 600:
        raise ValueError(
            "rectangle requires at least four vertices and at most 600 displacement DOFs"
        )
    vertices = []
    for point in raw:
        if not isinstance(point, list) or len(point) != 2:
            raise ValueError("vertices must have two coordinates")
        p = [finite(v, "vertex") for v in point]
        if any(v < -BOUNDARY_TOLERANCE or v > 40 + BOUNDARY_TOLERANCE for v in p):
            raise ValueError("vertices must lie in the 40x40 reference rectangle")
        vertices.append(p)
    if len({tuple(v) for v in vertices}) != len(vertices):
        raise ValueError("duplicate reference vertex")
    triangles = case.get("triangles")
    if not isinstance(triangles, list) or not triangles:
        raise ValueError("nonempty triangles required")
    scales = case.get("loadScales")
    if not isinstance(scales, list) or not scales or len(scales) > 16:
        raise ValueError("one to sixteen finite loadScales required")
    scales = [finite(value, "load scale") for value in scales]
    matrix, elements, edges, lumped = assemble(vertices, triangles, global_q, material["thickness"])
    area = math.fsum(e["area"] for e in elements)
    if abs(area - 1600) > 1e-10 * 1600:
        raise ValueError("assembled rectangle area must equal 1600 mm²")
    boundary = case.get("boundary")
    fixed, normalized_force, sides = rectangle_boundary(vertices, edges, boundary, angle, material)
    fixed_set = set(fixed)
    free = [i for i in range(2 * len(vertices)) if i not in fixed_set]
    reduced = [[matrix[i][j] for j in free] for i in free]
    factor = lu_factor(reduced)
    unit = [0.0] * (2 * len(vertices))
    for i, value in zip(free, lu_solve(factor, [normalized_force[i] for i in free])):
        unit[i] = value
    non_affine = nonaffinity(vertices, unit)
    maximum_k = max(abs(v) for row in matrix for v in row)
    symmetry = (
        max(
            abs(matrix[i][j] - matrix[j][i]) for i in range(len(matrix)) for j in range(len(matrix))
        )
        / maximum_k
    )
    loads = []
    for eta in scales:
        displacement = [eta * v for v in unit]
        force = [eta * v for v in normalized_force]
        ku = [math.fsum(v * u for v, u in zip(row, displacement)) for row in matrix]
        residual = [a - b for a, b in zip(ku, force)]
        reaction = [residual[i] if i in fixed_set else 0.0 for i in range(len(unit))]
        energy, element_gradient = element_observation(
            elements, global_q, material["thickness"], displacement, len(vertices)
        )
        quadratic_energy = 0.5 * math.fsum(a * b for a, b in zip(displacement, ku))
        work = math.fsum(a * b for a, b in zip(force, displacement))
        total_force = [math.fsum(force[c::2]) for c in range(2)]
        balance = [math.fsum(force[c::2]) + math.fsum(reaction[c::2]) for c in range(2)]
        force_scale = max(FORCE_ABSOLUTE, math.hypot(*total_force))
        moment = math.fsum(
            p[0] * (force[2 * i + 1] + reaction[2 * i + 1])
            - p[1] * (force[2 * i] + reaction[2 * i])
            for i, p in enumerate(vertices)
        )
        nodal_max = max(math.hypot(*force[2 * i : 2 * i + 2]) for i in range(len(vertices)))
        tolerance = max(FORCE_ABSOLUTE, FORCE_RELATIVE * nodal_max)
        free_residual = max(abs(residual[i]) for i in free)
        work_error = abs(2 * energy - work) / max(ENERGY_FLOOR, abs(2 * energy), abs(work))
        energy_error = abs(energy - quadratic_energy) / max(
            ENERGY_FLOOR, abs(energy), abs(quadratic_energy)
        )
        gradient_error = math.hypot(*(a - b for a, b in zip(ku, element_gradient))) / max(
            FORCE_ABSOLUTE, math.hypot(*ku)
        )
        row = {
            "eta": eta,
            "traction": eta * material["E1"],
            "force": [force[i : i + 2] for i in range(0, len(force), 2)],
            "displacement": [displacement[i : i + 2] for i in range(0, len(unit), 2)],
            "reaction": [reaction[i : i + 2] for i in range(0, len(unit), 2)],
            "energy": energy,
            "quadraticEnergy": quadratic_energy,
            "externalWork": work,
            "residualInfinity": free_residual,
            "forceTolerance": tolerance,
            "totalForce": total_force,
            "forceBalance": balance,
            "forceBalanceScale": force_scale,
            "forceBalanceScaled": math.hypot(*balance) / force_scale,
            "momentBalance": moment,
            "momentBalanceScale": force_scale * 40,
            "momentBalanceScaled": abs(moment) / (force_scale * 40),
            "energyWorkRelativeError": work_error,
            "elementEnergyRelativeError": energy_error,
            "elementGradientRelativeError": gradient_error,
            "nonAffineRelativeResidual": non_affine if eta else 0.0,
        }
        row["valid"] = (
            free_residual <= tolerance
            and row["forceBalanceScaled"] <= 1e-10
            and row["momentBalanceScaled"] <= 1e-10
            and work_error <= 1e-10
            and energy_error <= 1e-10
            and gradient_error <= 1e-10
        )
        loads.append(row)
    result = {
        "schema": "pliego-plane-stress-reference/1",
        "material": material,
        "engineeringQMaterial": q,
        "engineeringQGlobal": global_q,
        "nu21": nu21,
        "angleDegrees": angle,
        "boundary": boundary,
        "vertices": len(vertices),
        "triangles": len(elements),
        "area": area,
        "allVerticesReferenced": True,
        "fixedDofs": fixed,
        "freeDofs": free,
        "rightBoundarySegments": sides["right"],
        "boundarySegments": sides,
        "boundaryToleranceMm": BOUNDARY_TOLERANCE,
        "normalizedForce": [normalized_force[i : i + 2] for i in range(0, len(unit), 2)],
        "lumpedArea": lumped,
        "loads": loads,
        "matrix": {
            "size": len(matrix),
            "freeDofs": len(free),
            "symmetryScaledError": symmetry,
            "minimumScaledPivot": factor["minimumScaledPivot"],
            "pivotRejectionThreshold": PIVOT_MIN,
            "matrixSHA256": digest(matrix),
            "reducedMatrixSHA256": digest(reduced),
            "factorSHA256": digest(factor),
            "factorizations": 1,
            "normalizedSolves": 1,
            "reusedLoadSolutions": len(scales),
        },
        "tolerances": {
            "forceAbsoluteMicroN": FORCE_ABSOLUTE,
            "forceRelative": FORCE_RELATIVE,
            "balanceWorkEnergyRelative": 1e-10,
            "energyFloorNJ": ENERGY_FLOOR,
        },
        "inputSHA256": digest(case),
        "valid": symmetry <= 1e-10 and all(r["valid"] for r in loads),
        "scope": "independently assembled/solved small-strain 2D CST rectangle; no engine imports, time integration, contact or physical-stock calibration; poisson-compatible control only aligned grain",
    }
    # Reject unsupported arithmetic domains rather than serialize NaN/Infinity.
    json.dumps(result, allow_nan=False)
    return result


def dispatch(value):
    if isinstance(value, dict) and "cases" in value:
        if not isinstance(value["cases"], list) or not value["cases"]:
            raise ValueError("cases must be a nonempty array")
        return {
            "schema": "pliego-plane-stress-reference-batch/1",
            "cases": [solve(c) for c in value["cases"]],
        }
    return solve(value)


def main():
    try:
        if sys.argv[1:] == ["--self-test"]:
            from test_plane_stress_reference import run_self_validation

            result = run_self_validation()
        elif sys.argv[1:]:
            raise ValueError("usage: plane-stress-reference.py [--self-test]")
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
