"""Independent small-strain, plane-stress constant-strain triangle reference.

Pure stdlib; no Pliego material, spring, mesh, solver or integration imports.
Engineering strain order is [epsilon_11, epsilon_22, gamma_12=2*epsilon_12].
nu12 is explicitly -epsilon_22/epsilon_11 under uniaxial sigma_11, so
nu21=nu12*E2/E1. angleDegrees rotates material axis 1 counterclockwise from x.
Inputs use consistent length/stress units; thickness shares the length unit.
Output gradient is dU/du; physical internal force is its NEGATIVE.

stdin: one case, or {"cases": [case, ...]}; stdout: result or {"cases": [...]}.
--self-test runs the independent analytical/derivative test suite and emits JSON.
Each case: material:{E1,E2,nu12,G12,thickness}, angleDegrees,
vertices:[[x,y],...], triangles:[[i,j,k],...], displacement:[[ux,uy],...].
This evaluates prescribed nodal displacements, not a solved boundary problem.
Triangle orientation may be either sign; overlaps/conformity are not certified.

Formulation sources (independently implemented): Bleyer's FEniCSx orthotropic
elasticity tour, sections Variational formulation / Orthotropic plane stress;
Sandia Sierra/SM Theory Manual, Element Basics, constant-strain patch test.
"""

import json
import math
import sys


def finite_number(value, name):
    """Reject booleans, coercion, nonfinite values and unsupported numeric types."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a finite number")
    try:
        value = float(value)
    except (OverflowError, ValueError) as error:
        raise ValueError(f"{name} must be a finite number") from error
    if not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    return value


def material_matrix(material):
    """Invert the declared reciprocal engineering compliance analytically."""
    if not isinstance(material, dict):
        raise TypeError("material must be an object")
    values = {key: finite_number(material.get(key), f"material.{key}")
              for key in ("E1", "E2", "nu12", "G12", "thickness")}
    e1, e2, nu12, shear, thickness = (values[k] for k in values)
    if min(e1, e2, shear, thickness) <= 0:
        raise ValueError("E1, E2, G12 and thickness must be positive")
    nu21 = nu12 * (e2 / e1)
    denominator = 1.0 - nu12 * nu21
    if not math.isfinite(denominator) or denominator <= 0:
        raise ValueError("material compliance must be positive definite")
    q = [[e1 / denominator, nu12 * e2 / denominator, 0.0],
         [nu12 * e2 / denominator, e2 / denominator, 0.0],
         [0.0, 0.0, shear]]
    if not all(math.isfinite(v) for row in q for v in row):
        raise ValueError("material stiffness exceeds finite arithmetic domain")
    return q, thickness, nu21


def points(value, name):
    if not isinstance(value, list):
        raise TypeError(f"{name} must be an array")
    result = []
    for i, point in enumerate(value):
        if not isinstance(point, list) or len(point) != 2:
            raise ValueError(f"{name}[{i}] must have two coordinates")
        result.append([finite_number(point[j], f"{name}[{i}][{j}]") for j in range(2)])
    return result


def evaluate(case):
    """Direct CST energy and analytic gradient for one prescribed-displacement case."""
    if not isinstance(case, dict):
        raise TypeError("case must be an object")
    q, thickness, nu21 = material_matrix(case.get("material"))
    angle = finite_number(case.get("angleDegrees"), "angleDegrees")
    vertices = points(case.get("vertices"), "vertices")
    displacement = points(case.get("displacement"), "displacement")
    if len(vertices) < 3 or len(displacement) != len(vertices):
        raise ValueError("at least three vertices and one displacement per vertex required")
    triangles = case.get("triangles")
    if not isinstance(triangles, list) or not triangles:
        raise ValueError("triangles must be a nonempty array")
    radians = math.radians(angle % 360.0)
    c, s = math.cos(radians), math.sin(radians)
    cc, ss, cs = c * c, s * s, c * s
    gradient = [[0.0, 0.0] for _ in vertices]
    energies, areas, used, seen = [], [], set(), set()
    for ti, triangle in enumerate(triangles):
        if not isinstance(triangle, list) or len(triangle) != 3:
            raise ValueError(f"triangle {ti} must contain three vertex indices")
        if any(isinstance(i, bool) or not isinstance(i, int) or i < 0 or i >= len(vertices)
               for i in triangle) or len(set(triangle)) != 3:
            raise ValueError(f"triangle {ti} has invalid vertex indices")
        key = tuple(sorted(triangle))
        if key in seen:
            raise ValueError(f"triangle {ti} duplicates an earlier triangle")
        seen.add(key)
        used.update(triangle)
        a, b, d = (vertices[i] for i in triangle)
        bx, by, dx, dy = b[0] - a[0], b[1] - a[1], d[0] - a[0], d[1] - a[1]
        det = bx * dy - by * dx
        scale = max(abs(bx), abs(by), abs(dx), abs(dy))
        if not math.isfinite(det) or not math.isfinite(scale * scale) or scale == 0 or abs(det) <= 1e-14 * scale * scale:
            raise ValueError(f"triangle {ti} is degenerate or outside finite geometry domain")
        area = abs(det) / 2.0
        # Shape-function gradients in reference x,y; signed det handles CW input.
        shape = [((by - dy) / det, (dx - bx) / det),
                 (dy / det, -dx / det), (-by / det, bx / det)]
        duxx = math.fsum(displacement[v][0] * shape[k][0] for k, v in enumerate(triangle))
        duxy = math.fsum(displacement[v][0] * shape[k][1] for k, v in enumerate(triangle))
        duyx = math.fsum(displacement[v][1] * shape[k][0] for k, v in enumerate(triangle))
        duyy = math.fsum(displacement[v][1] * shape[k][1] for k, v in enumerate(triangle))
        exx, eyy, exy = duxx, duyy, (duxy + duyx) / 2.0
        # Rotate the strain tensor into material axes, then encode engineering shear.
        e = [cc * exx + 2.0 * cs * exy + ss * eyy,
             ss * exx - 2.0 * cs * exy + cc * eyy,
             2.0 * (-cs * exx + (cc - ss) * exy + cs * eyy)]
        sigma = [math.fsum(q[i][j] * e[j] for j in range(3)) for i in range(3)]
        weight = thickness * area
        energies.append(0.5 * weight * math.fsum(e[i] * sigma[i] for i in range(3)))
        areas.append(area)
        # Rotate stress back to global axes; shear stress has no factor of two.
        sx = cc * sigma[0] - 2.0 * cs * sigma[2] + ss * sigma[1]
        sy = ss * sigma[0] + 2.0 * cs * sigma[2] + cc * sigma[1]
        tau = cs * (sigma[0] - sigma[1]) + (cc - ss) * sigma[2]
        for k, v in enumerate(triangle):
            nx, ny = shape[k]
            gradient[v][0] += weight * (sx * nx + tau * ny)
            gradient[v][1] += weight * (tau * nx + sy * ny)
    energy, area = math.fsum(energies), math.fsum(areas)
    if not all(math.isfinite(v) for v in [energy, area] + [g for row in gradient for g in row]):
        raise ValueError("reference result exceeds finite arithmetic domain")
    return {"schema": "pliego-membrane-reference/0.1", "area": area, "energy": energy,
            "gradient": gradient, "engineeringQ": q, "nu21": nu21,
            "vertices": len(vertices), "triangles": len(triangles), "referencedVertices": len(used),
            "unusedVertexIndices": [i for i in range(len(vertices)) if i not in used],
            "convention": "linearized strain; material [epsilon11,epsilon22,gamma12=2*epsilon12]; gradient=dU/du; internal force=-gradient",
            "scope": "prescribed-displacement CST evaluation; no equilibrium solve, time integration, contact, bending or physical-stock calibration; mesh overlap/conformity unchecked"}


def dispatch(value):
    if isinstance(value, dict) and "cases" in value:
        if not isinstance(value["cases"], list) or not value["cases"]:
            raise ValueError("cases must be a nonempty array")
        return {"cases": [evaluate(case) for case in value["cases"]]}
    return evaluate(value)


def main():
    try:
        if sys.argv[1:] == ["--self-test"]:
            from test_membrane_reference import run_self_validation
            result = run_self_validation()
        elif sys.argv[1:]:
            raise ValueError("usage: membrane-reference.py [--self-test]")
        else:
            result = dispatch(json.load(sys.stdin))
        json.dump(result, sys.stdout, allow_nan=False, separators=(",", ":"))
        sys.stdout.write("\n")
        if sys.argv[1:] == ["--self-test"] and not result["passed"]:
            return 1
    except (ValueError, TypeError, KeyError, OverflowError, ZeroDivisionError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
