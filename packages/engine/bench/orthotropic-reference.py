"""Independent finite-Green-strain orthotropic 3D membrane CST reference.

Pure stdlib matrix F/S/P formulation; imports no engine, spring or linear oracle.
Input case: material:{E1,E2,nu12,G12,thickness}, angleDegrees,
vertices:[[u,v],...], triangles:[[i,j,k],...], positions:[[x,y,z],...].
stdin accepts a case or {"cases":[...]}; --self-test emits validation JSON.
nu12 is -epsilon22/epsilon11 in uniaxial sigma11; nu21=nu12*E2/E1.
Gradient is dU/dx; physical internal force is its negative.

Model-class sources: FEBio Theory, Compressible Materials / Orthotropic
Elasticity (Green-strain StVK); Bleyer's orthotropic plane-stress formulation
(reciprocal Q and engineering shear). These matrix formulas are derived here;
this is not a reproduced FEBio shell, calibrated paper law or injectivity proof.
"""

import json
import math
import sys

REFERENCE_DETERMINANT_TOLERANCE = 1e-14
CURRENT_RANK_TOLERANCE = 1e-14
MINIMUM_AREA_RATIO = 1e-12


def number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a finite number")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def coordinates(value, size, name):
    if not isinstance(value, list):
        raise TypeError(f"{name} must be an array")
    result = []
    for i, row in enumerate(value):
        if not isinstance(row, list) or len(row) != size:
            raise ValueError(f"{name}[{i}] must have {size} coordinates")
        result.append([number(v, f"{name}[{i}]") for v in row])
    return result


def transpose(a):
    return [list(row) for row in zip(*a)]


def multiply(a, b):
    return [[math.fsum(a[i][k] * b[k][j] for k in range(len(b)))
             for j in range(len(b[0]))] for i in range(len(a))]


def material_matrix(material):
    if not isinstance(material, dict):
        raise TypeError("material must be an object")
    e1, e2, nu, shear, thickness = [number(material.get(k), f"material.{k}")
                                    for k in ("E1", "E2", "nu12", "G12", "thickness")]
    if min(e1, e2, shear, thickness) <= 0:
        raise ValueError("E1, E2, G12 and thickness must be positive")
    reciprocal = nu * e2 / e1
    d = 1.0 - nu * reciprocal
    if not math.isfinite(d) or d <= 0:
        raise ValueError("reciprocal plane-stress compliance must be positive definite")
    q = [[e1 / d, nu * e2 / d, 0.0],
         [nu * e2 / d, e2 / d, 0.0], [0.0, 0.0, shear]]
    if not all(math.isfinite(v) for row in q for v in row):
        raise ValueError("material outside finite stiffness domain")
    return q, thickness, reciprocal


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]]


def evaluate(case):
    if not isinstance(case, dict):
        raise TypeError("case must be an object")
    q, thickness, reciprocal = material_matrix(case.get("material"))
    angle = number(case.get("angleDegrees"), "angleDegrees")
    uv = coordinates(case.get("vertices"), 2, "vertices")
    positions = coordinates(case.get("positions"), 3, "positions")
    triangles = case.get("triangles")
    if len(uv) < 3 or len(positions) != len(uv):
        raise ValueError("at least three reference vertices and matching positions required")
    if not isinstance(triangles, list) or not triangles:
        raise ValueError("triangles must be a nonempty array")
    theta = math.radians(angle % 360.0)
    rotation = [[math.cos(theta), -math.sin(theta)], [math.sin(theta), math.cos(theta)]]
    rt = transpose(rotation)
    gradient_terms = [[[] for _ in range(3)] for _ in uv]
    energies, areas, ratios, stretches, used, seen = [], [], [], [], set(), set()
    for ti, tri in enumerate(triangles):
        if not isinstance(tri, list) or len(tri) != 3 or any(
                isinstance(i, bool) or not isinstance(i, int) or i < 0 or i >= len(uv) for i in tri):
            raise ValueError(f"triangle {ti} has invalid indices")
        key = tuple(sorted(tri))
        if len(set(tri)) != 3 or key in seen:
            raise ValueError(f"triangle {ti} repeats a vertex or element")
        seen.add(key)
        used.update(tri)
        a, b, c = [uv[i] for i in tri]
        dm = [[b[j] - a[j], c[j] - a[j]] for j in range(2)]
        scale = max(abs(v) for row in dm for v in row)
        if scale == 0 or not math.isfinite(scale):
            raise ValueError(f"triangle {ti} has degenerate reference geometry")
        normalized = [[v / scale for v in row] for row in dm]
        ndet = normalized[0][0] * normalized[1][1] - normalized[0][1] * normalized[1][0]
        if abs(ndet) <= REFERENCE_DETERMINANT_TOLERANCE:
            raise ValueError(f"triangle {ti} has ill-conditioned reference geometry")
        area = abs(ndet) * scale * scale / 2.0
        inverse = [[normalized[1][1] / ndet / scale, -normalized[0][1] / ndet / scale],
                   [-normalized[1][0] / ndet / scale, normalized[0][0] / ndet / scale]]
        if not math.isfinite(area) or area <= 0 or not all(math.isfinite(v) for row in inverse for v in row):
            raise ValueError(f"triangle {ti} outside finite reference geometry domain")
        xa, xb, xc = [positions[i] for i in tri]
        ds = [[xb[j] - xa[j], xc[j] - xa[j]] for j in range(3)]
        f = multiply(ds, inverse)
        if not all(math.isfinite(v) for row in f for v in row):
            raise ValueError(f"triangle {ti} has nonfinite deformation gradient")
        metric = multiply(transpose(f), f)
        fcolumns = transpose(f)
        jacobian = math.hypot(*cross(*fcolumns))
        metric_scale = max(metric[0][0], metric[1][1])
        if not math.isfinite(jacobian) or not math.isfinite(metric_scale) or metric_scale <= 0 or jacobian <= MINIMUM_AREA_RATIO or jacobian <= CURRENT_RANK_TOLERANCE * metric_scale:
            raise ValueError(f"triangle {ti} has collapsed or ill-conditioned current geometry")
        largest = (metric[0][0] + metric[1][1] + math.hypot(metric[0][0] - metric[1][1], 2.0 * metric[0][1])) / 2.0
        maximum_stretch = math.sqrt(largest)
        minimum_stretch = jacobian / maximum_stretch
        green = [[(metric[i][j] - (1 if i == j else 0)) / 2.0 for j in range(2)] for i in range(2)]
        material_green = multiply(multiply(rt, green), rotation)
        strain = [material_green[0][0], material_green[1][1], 2.0 * material_green[0][1]]
        stress = [math.fsum(q[i][j] * strain[j] for j in range(3)) for i in range(3)]
        second_piola = multiply(multiply(rotation, [[stress[0], stress[2]], [stress[2], stress[1]]]), rt)
        first_piola = multiply(f, second_piola)
        volume = thickness * area
        energies.append(0.5 * volume * math.fsum(strain[i] * stress[i] for i in range(3)))
        # N1,N2 gradients are rows of Dm^-1; N0 closes partition of unity.
        shapes = [[-inverse[0][j] - inverse[1][j] for j in range(2)], inverse[0], inverse[1]]
        for local, vertex in enumerate(tri):
            for j in range(3):
                gradient_terms[vertex][j].append(volume * math.fsum(first_piola[j][k] * shapes[local][k] for k in range(2)))
        areas.append(area)
        ratios.append(jacobian)
        stretches.append([minimum_stretch, maximum_stretch])
    gradient = [[math.fsum(values) for values in row] for row in gradient_terms]
    energy, area = math.fsum(energies), math.fsum(areas)
    outputs = [energy, area] + [v for row in gradient for v in row] + ratios + [v for row in stretches for v in row]
    if not all(math.isfinite(v) for v in outputs):
        raise ValueError("result outside finite arithmetic domain")
    return {"schema": "pliego-orthotropic-reference/0.1", "energy": energy, "gradient": gradient,
            "area": area, "vertices": len(uv), "triangles": len(triangles),
            "referencedVertices": len(used), "unusedVertexIndices": [i for i in range(len(uv)) if i not in used],
            "engineeringQ": q, "nu21": reciprocal,
            "minPrincipalStretch": min(v[0] for v in stretches),
            "maxPrincipalStretch": max(v[1] for v in stretches), "principalStretches": stretches,
            "areaRatios": ratios, "minAreaRatio": min(ratios), "maxAreaRatio": max(ratios),
            "domain": {"referenceRelativeDeterminantTolerance": REFERENCE_DETERMINANT_TOLERANCE,
                       "currentRelativeRankTolerance": CURRENT_RANK_TOLERANCE,
                       "minimumAreaRatioExclusive": MINIMUM_AREA_RATIO},
            "convention": "surface F=Ds*Dm^-1; Green E=(F^T F-I)/2; material [E11,E22,2E12]; nu12 explicit; gradient=dU/dx; internal force=-gradient",
            "scope": "prescribed 3D finite-strain StVK membrane; no solve, time/contact/bending/stock validation; endpoint rank guard only, no path injectivity or overlap/conformity guarantee"}


def dispatch(value):
    if isinstance(value, dict) and "cases" in value:
        if not isinstance(value["cases"], list) or not value["cases"]:
            raise ValueError("cases must be a nonempty array")
        return {"cases": [evaluate(case) for case in value["cases"]]}
    return evaluate(value)


def main():
    try:
        if sys.argv[1:] == ["--self-test"]:
            from test_orthotropic_reference import run_self_validation
            result = run_self_validation()
        elif sys.argv[1:]:
            raise ValueError("usage: orthotropic-reference.py [--self-test]")
        else:
            result = dispatch(json.load(sys.stdin))
        json.dump(result, sys.stdout, allow_nan=False, separators=(",", ":"))
        sys.stdout.write("\n")
        return 1 if sys.argv[1:] == ["--self-test"] and not result["passed"] else 0
    except (ValueError, TypeError, KeyError, OverflowError, ZeroDivisionError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
