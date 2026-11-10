"""Independent direct-metric Decimal oracle for uv-displacement reference law.

F=Kx, A=KX0, Euv=(F^T F-A^T A)/2, Em=R^T Euv R.
Direct metrics bypass runtime displacement arithmetic and cached DD base words.
Tensor exactH uses deltaP=deltaF*S+F*deltaS; GN omits geometric deltaF*S.
Captured constants, exact-UV/X0 metric and ideal-UV metric stay separate.
"""

import argparse
import hashlib
import importlib.util
import json
import math
import struct
import sys
from decimal import Decimal, localcontext
from fractions import Fraction
from pathlib import Path

HELPER_SOURCE = Path(__file__).with_name("membrane-gradient-precision.py")
SPEC = importlib.util.spec_from_file_location(
    "reference_gradient_helpers", HELPER_SOURCE
)
HELPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)
ENERGY, STVK = HELPER.ENERGY, HELPER.STVK
D = Decimal
BINDING_SOURCE = Path(__file__).with_name("membrane-reference-binding.py")
BINDING_SPEC = importlib.util.spec_from_file_location(
    "reference_binding", BINDING_SOURCE
)
BINDING = importlib.util.module_from_spec(BINDING_SPEC)
BINDING_SPEC.loader.exec_module(BINDING)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def zeros(rows, columns):
    return [[D(0) for _ in range(columns)] for _ in range(rows)]


def decimal(value):
    return D(value.numerator) / D(value.denominator)


def rotate(tensor, rotation):
    return STVK.matmul(STVK.matmul(STVK.transpose(rotation), tensor), rotation)


def stress(strain, q, rotation):
    material = rotate(strain, rotation)
    xx, yy, gamma = material[0][0], material[1][1], 2 * material[0][1]
    sm = [[q[0] * xx + q[2] * yy, q[3] * gamma], [q[3] * gamma, q[2] * xx + q[1] * yy]]
    return STVK.matmul(STVK.matmul(rotation, sm), STVK.transpose(rotation)), [
        xx,
        yy,
        gamma,
    ]


def physical_constants(material, grain):
    e1, e2, nu, shear, thickness = [
        STVK.exact(material[k]) for k in ("E1", "E2", "nu12", "G12", "thickness")
    ]
    den = 1 - nu * nu * e2 / e1
    if min(e1, e2, shear, thickness) <= 0 or den <= 0:
        raise ValueError("positive-definite physical material required")
    return (
        [e1 / den, e2 / den, nu * e2 / den, shear],
        thickness,
        STVK.material_axes(grain),
    )


def exact_uv_operator(points):
    a, b, c = [[Fraction(v) for v in point] for point in points]
    du, dv, eu, ev = b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]
    det = du * ev - eu * dv
    if det <= 0:
        raise ValueError("positive UV reference triangle required")
    u, v = [Fraction(), ev / det, -dv / det], [Fraction(), -eu / det, du / det]
    u[0], v[0] = -u[1] - u[2], -v[1] - v[2]
    return u, v, det / 2


def deformation(points, u, v):
    # Coherent Kx, written as differences rather than consuming rounded u0/v0.
    return [
        [
            u[1] * (points[1][r] - points[0][r]) + u[2] * (points[2][r] - points[0][r]),
            v[1] * (points[1][r] - points[0][r]) + v[2] * (points[2][r] - points[0][r]),
        ]
        for r in range(3)
    ]


def direct_element(
    points,
    reference_points,
    u,
    v,
    rotation,
    q,
    volume,
    hessian=False,
    ideal_metric=False,
):
    """Direct scalar energy and independent FSP/tangent derivatives."""
    rational = isinstance(u[1], Fraction)
    if rational:
        points = [[Fraction(v) for v in point] for point in points]
        reference_points = [[Fraction(v) for v in point] for point in reference_points]
    f = deformation(points, u, v)
    metric = STVK.matmul(STVK.transpose(f), f)
    if ideal_metric:
        metric0 = [[1, 0], [0, 1]]
    else:
        a = deformation(reference_points, u, v)
        metric0 = STVK.matmul(STVK.transpose(a), a)
    strain = [[(metric[i][j] - metric0[i][j]) / 2 for j in range(2)] for i in range(2)]
    if rational:
        f = [[decimal(value) for value in row] for row in f]
        strain = [[decimal(value) for value in row] for row in strain]
        u, v = [list(map(decimal, values)) for values in (u, v)]
    s, engineering = stress(strain, q, rotation)
    ex, ey, gamma = engineering
    energy = (
        volume
        / 2
        * (q[0] * ex * ex + q[1] * ey * ey + 2 * q[2] * ex * ey + q[3] * gamma * gamma)
    )
    piola = STVK.matmul(f, s)
    gradients = [
        [volume * (piola[r][0] * u[i] + piola[r][1] * v[i]) for r in range(3)]
        for i in range(3)
    ]
    exact, gn = zeros(9, 9), zeros(9, 9)
    if hessian:
        for j in range(3):
            for component in range(3):
                df = zeros(3, 2)
                df[component] = [u[j], v[j]]
                cross = STVK.matmul(STVK.transpose(f), df)
                de = [
                    [(cross[a][b] + cross[b][a]) / 2 for b in range(2)]
                    for a in range(2)
                ]
                ds, _ = stress(de, q, rotation)
                dp_gn, geometric = STVK.matmul(f, ds), STVK.matmul(df, s)
                for i in range(3):
                    for r in range(3):
                        gn[3 * i + r][3 * j + component] = volume * (
                            dp_gn[r][0] * u[i] + dp_gn[r][1] * v[i]
                        )
                        exact[3 * i + r][3 * j + component] = gn[3 * i + r][
                            3 * j + component
                        ] + volume * (geometric[r][0] * u[i] + geometric[r][1] * v[i])
    return energy, gradients, exact, gn


def configuration(case, vertices, triangles):
    native, elements = STVK.stored_mapping(triangles, case["referenceCoefficients"])
    x0 = [None for _ in vertices]
    represented = []
    for ids, element in zip(native, elements):
        reference = element.get("reference")
        if not isinstance(reference, dict):
            raise TypeError("each native element requires its reference descriptor")
        if (
            reference.get("mode") != "uv-displacement"
            or isinstance(reference.get("version"), bool)
            or reference.get("version") != 1
        ):
            raise ValueError("explicit uv-displacement reference version1 required")
        u, v = [ENERGY.vector(reference[k], 3, k) for k in ("u", "v")]
        # Captured u0/v0 are informational rounded caches; the real derivative
        # and polynomial always use coherent negative sums, without normalization.
        u[0], v[0] = -u[1] - u[2], -v[1] - v[2]
        local0 = ENERGY.vector(reference["x0"], 9, "reference.x0")
        points0 = [local0[i : i + 3] for i in range(0, 9, 3)]
        base = deformation(points0, u, v)
        metric0 = STVK.matmul(STVK.transpose(base), base)
        if (
            u[1] * v[2] - u[2] * v[1] == 0
            or metric0[0][0] * metric0[1][1] - metric0[0][1] ** 2 <= 0
        ):
            raise ValueError(
                "nondegenerate captured UV operator and actual X0 metric required"
            )
        for node, point in zip(ids, points0):
            if x0[node] is not None and x0[node] != point:
                raise ValueError("inconsistent actual X0 at shared native vertex")
            x0[node] = point
        c, s = STVK.exact(reference["c"]), STVK.exact(reference["s"])
        if c * c + s * s <= 0:
            raise ValueError("nonzero captured material rotation required")
        q, volume = ENERGY.vector(element["Q"], 4, "Q"), STVK.exact(element["volume"])
        if volume <= 0 or min(q[0], q[1], q[3]) <= 0 or q[0] * q[1] - q[2] * q[2] <= 0:
            raise ValueError("positive captured Q and volume required")
        represented.append(
            {
                "ids": ids,
                "u": u,
                "v": v,
                "x0": points0,
                "rotation": [[c, -s], [s, c]],
                "q": q,
                "volume": volume,
            }
        )
    if any(point is None for point in x0):
        raise ValueError("actual reference X0 must consume all vertices")
    physical_q, thickness, physical_rotation = physical_constants(
        case["material"], case["grain"]
    )
    physical = []
    for ids in native:
        u, v, area = exact_uv_operator([vertices[i] for i in ids])
        physical.append(
            {
                "ids": ids,
                "u": u,
                "v": v,
                "x0": [x0[i] for i in ids],
                "rotation": physical_rotation,
                "q": physical_q,
                "volume": decimal(area) * thickness,
            }
        )
    return represented, physical, x0


def assemble(elements, x, hessian=False, ideal_metric=False):
    n = 3 * len(x)
    energy, gradient = D(0), zeros(len(x), 3)
    exact, gn = (zeros(n, n), zeros(n, n)) if hessian else ([], [])
    for element in elements:
        ids = element["ids"]
        value, g, h, p = direct_element(
            [x[i] for i in ids],
            element["x0"],
            element["u"],
            element["v"],
            element["rotation"],
            element["q"],
            element["volume"],
            hessian,
            ideal_metric,
        )
        energy += value
        for i, node in enumerate(ids):
            for r in range(3):
                gradient[node][r] += g[i][r]
                if hessian:
                    for j, other in enumerate(ids):
                        for c in range(3):
                            exact[3 * node + r][3 * other + c] += h[3 * i + r][
                                3 * j + c
                            ]
                            gn[3 * node + r][3 * other + c] += p[3 * i + r][3 * j + c]
    return (
        energy,
        [v for p in gradient for v in p],
        [v for row in exact for v in row],
        [v for row in gn for v in row],
    )


def inertia_terms(inputs, lossless):
    """Native association is verified separately from real M/h², never substituted."""
    if "mass" not in inputs:
        return None
    x, target, mass, h = [
        list(map(STVK.exact, inputs[k])) for k in ("x", "xt", "mass", "h")
    ]
    h = h[0]
    if h <= 0 or min(mass) <= 0:
        raise ValueError("positive native mass and h required")
    real_c = [mass[i // 3] / (h * h) for i in range(len(x))]
    native_c = [
        STVK.exact(inputs["mass"][i // 3] * (1 / (inputs["h"][0] * inputs["h"][0])))
        for i in range(len(x))
    ]
    native = [
        float(c) * (a - b) for c, a, b in zip(native_c, inputs["x"], inputs["xt"])
    ]
    if not all(map(math.isfinite, native)):
        raise ValueError("nonfinite native inertia")

    def same(a, b):
        return struct.pack("<d", a) == struct.pack("<d", b) if lossless else a == b

    if "inertiaGradient" in inputs and not all(
        same(a, b) for a, b in zip(native, inputs["inertiaGradient"])
    ):
        raise ValueError("supplied inertia differs from native m*(1/(h*h))*(x-xt)")
    full = [g + i for g, i in zip(inputs["gradient"], native)]
    if "incrementalGradient" in inputs and not all(
        same(a, b) for a, b in zip(full, inputs["incrementalGradient"])
    ):
        raise ValueError(
            "supplied incremental gradient differs from native rounded addition"
        )
    return {
        "realC": real_c,
        "nativeC": native_c,
        "target": target,
        "realGradient": [c * (a - b) for c, a, b in zip(real_c, x, target)],
        "full": list(map(STVK.exact, full)),
    }


def inertia_energy(points, target, coefficients):
    return sum(c * (a - b) ** 2 / 2 for a, b, c in zip(points, target, coefficients))


def evaluate(case, digits=80):
    if not isinstance(case, dict):
        raise TypeError("case must be an object")
    if (
        isinstance(digits, bool)
        or not isinstance(digits, int)
        or not 60 <= digits <= 100
    ):
        raise ValueError("precision must be 60..100 digits")
    with localcontext() as context:
        context.prec = digits
        vertices, triangles = ENERGY.mesh(case)
        reference_binding = BINDING.verify(case)
        n = 3 * len(vertices)
        include_h = case.get("includeHessian", False)
        if not isinstance(include_h, bool):
            raise TypeError("includeHessian must be boolean")
        if include_h and n > 45:
            raise ValueError("explicit dense Hessian fixtures limited to45 DOFs")
        runtime = case["runtime"]
        if not isinstance(runtime, dict):
            raise TypeError("runtime must contain energy and gradient")
        observed_energy = STVK.exact(runtime["energy"])
        inputs = {
            "x": HELPER.finite_vector(case["x"], n, "x"),
            "gradient": HELPER.finite_vector(runtime["gradient"], n, "gradient"),
        }
        for key in ("after", "direction", "xt", "inertiaGradient"):
            if key in case:
                inputs[key] = HELPER.finite_vector(case[key], n, key)
        physical = [key in case for key in ("xt", "mass", "h")]
        if any(physical) and not all(physical):
            raise ValueError("xt/mass/h must be supplied together")
        if all(physical):
            inputs["mass"] = HELPER.finite_vector(case["mass"], n // 3, "mass")
            inputs["h"] = [float(STVK.exact(case["h"]))]
        if "incrementalGradient" in runtime:
            inputs["incrementalGradient"] = HELPER.finite_vector(
                runtime["incrementalGradient"], n, "incrementalGradient"
            )
        if ("inertiaGradient" in inputs or "incrementalGradient" in inputs) and not all(
            physical
        ):
            raise ValueError("native inertia comparison requires xt/mass/h")
        inputs, hashes, lossless = HELPER.captured_inputs(case, inputs)
        inertia = inertia_terms(inputs, lossless)
        x = [list(map(STVK.exact, inputs["x"][i : i + 3])) for i in range(0, n, 3)]
        represented, physical, x0 = configuration(case, vertices, triangles)
        observed = list(map(STVK.exact, inputs["gradient"]))
        matrices = {}
        for key in ("exactHessian", "gaussNewton"):
            if key in runtime:
                if not include_h:
                    raise ValueError(
                        "runtime matrix comparison requires includeHessian:true"
                    )
                matrices[key] = ENERGY.vector(runtime[key], n * n, key)
        meanings = {}
        for name, elements, ideal in (
            ("representedUVDisplacement", represented, False),
            ("independentExactUVReferenceMetric", physical, False),
            ("independentExactUVMaterial", physical, True),
        ):
            energy, gradient, exact, gn = assemble(elements, x, include_h, ideal)
            value = {
                "energyNJ": float(energy),
                "gradient": list(map(float, gradient)),
                "energyAbsoluteErrorNJ": float(abs(observed_energy - energy)),
                "gradientError": HELPER.errors(observed, gradient),
            }
            if "direction" in inputs:
                direction = list(map(STVK.exact, inputs["direction"]))
                value["elasticProjectedSlopeAbsoluteErrorNJ"] = float(
                    abs(
                        sum(
                            (a - b) * d
                            for a, b, d in zip(observed, gradient, direction)
                        )
                    )
                )
            if inertia:
                full = [g + i for g, i in zip(gradient, inertia["realGradient"])]
                value["realIncrementalGradient"] = list(map(float, full))
                value["nativeRoundedIncrementalGradientError"] = HELPER.errors(
                    inertia["full"], full
                )
                if "direction" in inputs:
                    value["nativeRoundedIncrementalProjectedSlopeAbsoluteErrorNJ"] = (
                        float(
                            abs(
                                sum(
                                    (a - b) * d
                                    for a, b, d in zip(inertia["full"], full, direction)
                                )
                            )
                        )
                    )
            if include_h:
                for key, values in (("exactHessian", exact), ("gaussNewton", gn)):
                    value[key] = list(map(float, values))
                    if key in matrices:
                        value[key + "MaximumComponentError"] = float(
                            max(abs(a - b) for a, b in zip(matrices[key], values))
                        )
            if "after" in inputs:
                after = [
                    list(map(STVK.exact, inputs["after"][i : i + 3]))
                    for i in range(0, n, 3)
                ]
                endpoint_energy = assemble(elements, after, False, ideal)[0]
                value["endpointEnergyDeltaNJ"] = float(endpoint_energy - energy)
                if inertia:
                    old = [v for point in x for v in point]
                    end = [v for point in after for v in point]
                    for label, coefficients in (
                        ("RealMass", inertia["realC"]),
                        ("NativeCoefficient", inertia["nativeC"]),
                    ):
                        change = (
                            endpoint_energy
                            + inertia_energy(end, inertia["target"], coefficients)
                        ) - (
                            energy
                            + inertia_energy(old, inertia["target"], coefficients)
                        )
                        value["endpoint" + label + "PotentialDeltaNJ"] = float(change)
                        if runtime.get("delta") is not None:
                            value["runtime" + label + "IncrementAbsoluteErrorNJ"] = (
                                float(abs(STVK.exact(runtime["delta"]) - change))
                            )
                        if runtime.get("armijoRhs") is not None:
                            margin = STVK.exact(runtime["armijoRhs"]) - change
                            value[label + "RecordedArmijoMarginNJ"] = float(margin)
                            value["passes" + label + "RecordedArmijo"] = (
                                runtime.get("slope") is not None
                                and STVK.exact(runtime["slope"]) < 0
                                and margin >= 0
                            )
                if runtime.get("membraneDifference") is not None:
                    value["runtimeMembraneDifferenceAbsoluteErrorNJ"] = float(
                        abs(
                            STVK.exact(runtime["membraneDifference"])
                            - (endpoint_energy - energy)
                        )
                    )
            meanings[name] = value
        result = {
            "schema": "pliego-membrane-reference-precision/1",
            "decimalDigits": digits,
            "meanings": meanings,
            "inertia": {
                "scope": "real M/h² and stored native coefficient reported separately"
                if inertia
                else "absent",
                "nativeAssociationVerified": bool(
                    inertia and "inertiaGradient" in inputs
                ),
                "incrementalAssociationVerified": bool(
                    inertia and "incrementalGradient" in inputs
                ),
            },
            "reference": {
                "mode": "uv-displacement",
                "version": 1,
                "meaning": "actual captured K/X0/c/s/Q/volume; coherent node0; A derived exactly, cached base words unused",
                "exactUVReferenceMeaning": "exact UV inverse and physical material rotation/Q, actual X0 metric",
                "exactUVKinematics": "rational inverse and Gram before Decimal rotation/material; no rounded-inverse rest strain",
                "idealUVMaterialMeaning": "exact UV inverse/material with unit reference metric; can differ at rounded placed X0",
            },
            "provenance": {
                **reference_binding,
                "referenceBindingHelperSHA256": sha(BINDING_SOURCE.read_bytes()),
                "caseSHA256": sha(ENERGY.canonical(case)),
                "diagnosticSHA256": sha(Path(__file__).read_bytes()),
                "gradientHelperSHA256": sha(HELPER_SOURCE.read_bytes()),
                "tensorHelperSHA256": sha(ENERGY.SOURCE.read_bytes()),
                "energyHelperSHA256": sha(HELPER.ENERGY_SOURCE.read_bytes()),
                "referenceDescriptorSHA256": sha(
                    ENERGY.canonical(case["referenceCoefficients"])
                ),
                "actualReferenceX0NumericSHA256": sha(
                    ENERGY.canonical([[float(v) for v in point] for point in x0])
                ),
                "stateFloat64LESHA256": hashes,
                "losslessStateSupplied": lossless,
            },
            "scope": "direct metric-energy and tensor-gradient/exactH/GN evaluation only; represented reference law differs from legacy material-coefficients; no solve, stock calibration, force-gate or objectivity certificate from rounded placements",
        }
        json.dumps(result, allow_nan=False)
        return result


def self_test():
    case = {
        "vertices": [[0, 0], [2, 0], [0, 2]],
        "triangles": [[0, 1, 2]],
        "grain": 0,
        "material": {"E1": 8, "E2": 8, "nu12": 0, "G12": 4, "thickness": 1},
        "referenceCoefficients": {
            "triangles": [[0, 1, 2]],
            "elements": [
                {
                    "Q": [8, 8, 0, 4],
                    "volume": 2,
                    "reference": {
                        "mode": "uv-displacement",
                        "version": 1,
                        "u": [-0.5, 0.5, 0],
                        "v": [-0.5, 0, 0.5],
                        "x0": [0, 0, 0, 2, 0, 0, 0, 0, -2],
                        "c": 1,
                        "s": 0,
                    },
                }
            ],
        },
        "x": [0, 0, 0, 2.5, 0, 0, 0, 0, -2],
        "includeHessian": True,
        "runtime": {
            "energy": 81 / 128,
            "gradient": [-45 / 16, 0, 0, 45 / 16, 0, 0, 0, 0, 0],
        },
    }
    result = evaluate(case)
    for value in result["meanings"].values():
        assert (
            value["energyNJ"] == 81 / 128
            and value["gradientError"]["maximumComponentMicroN"] == 0
        )
        assert value["exactHessian"][9 * 3 + 3] == 59 / 8
    case["x"][3] = 1.5
    for value in evaluate(case)["meanings"].values():
        assert (
            value["exactHessian"][9 * 4 + 4] == -7 / 8
            and value["gaussNewton"][9 * 4 + 4] == 0
        )
    case["x"] = case["referenceCoefficients"]["elements"][0]["reference"]["x0"][:]
    for value in evaluate(case)["meanings"].values():
        assert value["energyNJ"] == 0 and all(g == 0 for g in value["gradient"])
    return {
        "schema": "pliego-membrane-reference-precision-self-test/1",
        "passed": True,
        "testCases": 3,
        "proofs": {
            "finitePiolaEnergyGradientExactHessian": True,
            "compressedStressNegativeExactVersusPSDGN": True,
            "nativeStressFreeReference": True,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--digits", type=int, default=80)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if not 60 <= args.digits <= 100:
        raise ValueError("precision must be60..100 digits")
    if args.self_test:
        result = self_test()
    else:
        raw = sys.stdin.buffer.read()
        value = json.loads(raw)
        if isinstance(value, dict) and "cases" in value:
            if not isinstance(value["cases"], list) or not value["cases"]:
                raise ValueError("cases must be a nonempty array")
            result = {
                "schema": "pliego-membrane-reference-precision-batch/1",
                "cases": [evaluate(c, args.digits) for c in value["cases"]],
            }
        else:
            result = evaluate(value, args.digits)
        result["inputSHA256"] = sha(raw)
    print(json.dumps(result, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, TypeError, KeyError, OverflowError, ZeroDivisionError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
