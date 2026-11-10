"""Independent Decimal Green-plus-inertia potential increment at actual f64 poses.

Direct BEFORE and AFTER scalar energies are evaluated separately, not with the
runtime remainder formula. Stored rounded coefficients and independent UV/material
meaning remain distinct. No solves, steps, equilibrium claims or EPS error bounds.
stdin accepts a case or {"cases":[...]}; --digits 80/100; --self-test is analytical.
after ALWAYS means the actual evaluated trial endpoint, including rejected trials,
not a restored accepted World position. h, mass and xt are fixed across the trial.
"""

import argparse
import base64
import binascii
import hashlib
import importlib.util
import json
import math
import struct
import sys
from decimal import Decimal, localcontext
from fractions import Fraction
from pathlib import Path

SOURCE = Path(__file__).with_name("plane-stress-precision.py")
SPEC = importlib.util.spec_from_file_location("increment_stvk_precision", SOURCE)
STVK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STVK)
DIAGNOSTIC_SUM_VERSION = "exact-rational-dot-plus-remainders/2"


def correctly_rounded_runtime_term_sum(gradient, rounded_delta, membrane_r, inertia_r):
    """Exact sum of stored f64 products/remainders, then one binary64 rounding.

    Preserve the original diagnostic's mathematical meaning: the dot product
    uses stored gradient and rounded endpoint differences, NOT runtime.slope.
    Fraction arithmetic has no Decimal-context dependence or intermediate f64
    products. float(Fraction) rounds once, nearest/ties-even. Exact rational zero
    becomes +0; a negative nonzero value that underflows becomes -0. Stored zero
    signs remain bound separately by state hashes, not real rational arithmetic.
    This repairs only the diagnostic output, not objective/error/Armijo paths.
    """
    if len(gradient) != len(rounded_delta):
        raise ValueError("diagnostic gradient/delta dimensions differ")
    rational = lambda v: Fraction.from_float(float(STVK.exact(float(v))))
    total = sum(
        (rational(g) * rational(d) for g, d in zip(gradient, rounded_delta)), Fraction()
    )
    return float(total + rational(membrane_r) + rational(inertia_r))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()


def vector(value, length, name):
    if not isinstance(value, list) or len(value) != length:
        raise ValueError(f"{name} requires {length} finite binary64 entries")
    return [STVK.exact(v) for v in value]


def mesh(case):
    uv, triangles = case["vertices"], case["triangles"]
    if not isinstance(uv, list) or len(uv) < 3:
        raise ValueError("at least three UV vertices required")
    vertices = [vector(p, 2, "UV point") for p in uv]
    if not isinstance(triangles, list) or not triangles:
        raise ValueError("nonempty authored triangle array required")
    used, seen = set(), set()
    for ids in triangles:
        if (
            not isinstance(ids, list)
            or len(ids) != 3
            or any(
                isinstance(i, bool) or not isinstance(i, int) or not 0 <= i < len(uv)
                for i in ids
            )
            or len(set(ids)) != 3
            or tuple(sorted(ids)) in seen
        ):
            raise ValueError(
                "triangle requires distinct valid IDs and no duplicate faces"
            )
        a, b, c = [vertices[i] for i in ids]
        if (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]) <= 0:
            raise ValueError("authored reference faces must be positive")
        seen.add(tuple(sorted(ids)))
        used.update(ids)
    if len(used) != len(uv):
        raise ValueError("all vertices must be consumed")
    return vertices, triangles


def stored_energy(triangles, positions, elements):
    """Direct scalar U, using exact stored f64 alpha1/2,beta1/2,Q,volume."""
    total = Decimal(0)
    for ids, element in zip(triangles, elements):
        alpha = vector(element["alpha"], 3, "alpha")
        beta = vector(element["beta"], 3, "beta")
        q = vector(element["Q"], 4, "Q")
        volume = STVK.exact(element["volume"])
        if volume <= 0 or min(q[0], q[1], q[3]) <= 0 or q[0] * q[1] - q[2] * q[2] <= 0:
            raise ValueError("stored volume and material Q must be positive definite")
        tangents = [
            [
                coeff[1] * (positions[ids[1]][r] - positions[ids[0]][r])
                + coeff[2] * (positions[ids[2]][r] - positions[ids[0]][r])
                for r in range(3)
            ]
            for coeff in (alpha, beta)
        ]
        a, b = tangents
        strain = [
            (sum(v * v for v in a) - 1) / 2,
            (sum(v * v for v in b) - 1) / 2,
            sum(u * v for u, v in zip(a, b)),
        ]
        e, f, gamma = strain
        total += (
            volume
            / 2
            * (q[0] * e * e + q[1] * f * f + 2 * q[2] * e * f + q[3] * gamma * gamma)
        )
    return total


def uv_energy(vertices, triangles, positions, material, grain):
    """Independent DsDm^-1 and rotated Green tensor scalar energy."""
    e1, e2, nu, shear, thickness = [
        STVK.exact(material[k]) for k in ("E1", "E2", "nu12", "G12", "thickness")
    ]
    denominator = 1 - nu * nu * e2 / e1
    if min(e1, e2, shear, thickness) <= 0 or denominator <= 0:
        raise ValueError("positive-definite UV/material constants required")
    q11, q22, q12 = e1 / denominator, e2 / denominator, nu * e2 / denominator
    rotation = STVK.material_axes(grain)
    total = Decimal(0)
    for ids in triangles:
        a, b, c = [vertices[i] for i in ids]
        dm = [[b[r] - a[r], c[r] - a[r]] for r in range(2)]
        det = dm[0][0] * dm[1][1] - dm[0][1] * dm[1][0]
        inverse = [[dm[1][1] / det, -dm[0][1] / det], [-dm[1][0] / det, dm[0][0] / det]]
        ds = [
            [
                positions[ids[1]][r] - positions[ids[0]][r],
                positions[ids[2]][r] - positions[ids[0]][r],
            ]
            for r in range(3)
        ]
        deformation = STVK.matmul(ds, inverse)
        metric = STVK.matmul(STVK.transpose(deformation), deformation)
        green = [[(metric[i][j] - int(i == j)) / 2 for j in range(2)] for i in range(2)]
        strain = STVK.matmul(STVK.matmul(STVK.transpose(rotation), green), rotation)
        xx, yy, xy = strain[0][0], strain[1][1], strain[0][1]
        total += (
            thickness
            * det
            / 4
            * (q11 * xx * xx + q22 * yy * yy + 2 * q12 * xx * yy + 4 * shear * xy * xy)
        )
    return total


def lossless(case, inputs):
    encoded = case.get("stateFloat64LE")
    if encoded is not None and not isinstance(encoded, dict):
        raise TypeError("stateFloat64LE must be an object")
    claimed = case.get("stateSHA256")
    if claimed is not None and not isinstance(claimed, dict):
        raise TypeError("stateSHA256 must be an object")
    hashes = {}
    for key, values in inputs.items():
        raw = struct.pack("<" + str(len(values)) + "d", *map(float, values))
        if encoded is not None:
            if not isinstance(encoded.get(key), str):
                raise TypeError(f"stateFloat64LE.{key} must be base64 text")
            try:
                captured = base64.b64decode(encoded[key], validate=True)
            except (binascii.Error, ValueError) as error:
                raise ValueError(f"invalid base64 for {key}") from error
            if len(captured) != len(raw):
                raise ValueError(f"lossless {key} byte count mismatch")
            decoded = list(struct.unpack("<" + str(len(values)) + "d", captured))
            if any(not math.isfinite(v) for v in decoded) or decoded != list(
                map(float, values)
            ):
                raise ValueError(f"lossless {key} and numeric fields disagree")
            raw = captured  # Preserve signed-zero bits lost through JSON.
        hashes[key] = sha(raw)
        if claimed is not None and claimed.get(key) != hashes[key]:
            raise ValueError(f"stateSHA256.{key} mismatch")
    return hashes


def evaluate(case, digits=80):
    if not isinstance(case, dict):
        raise TypeError("case must be an object")
    if (
        isinstance(digits, bool)
        or not isinstance(digits, int)
        or not 60 <= digits <= 100
    ):
        raise ValueError("Decimal precision must be 60..100 digits")
    with localcontext() as context:
        context.prec = digits
        vertices, triangles = mesh(case)
        size = 3 * len(vertices)
        before, after, target, g = [
            vector(case[k], size, k) for k in ("before", "after", "xt", "gradient")
        ]
        mass, h = vector(case["mass"], len(vertices), "mass"), STVK.exact(case["h"])
        if h <= 0 or min(mass) <= 0:
            raise ValueError("positive native mass and fixed h required")
        hashes = lossless(
            case,
            {
                "before": before,
                "after": after,
                "xt": target,
                "mass": mass,
                "h": [h],
                "gradient": g,
            },
        )
        before_points = [before[i : i + 3] for i in range(0, size, 3)]
        after_points = [after[i : i + 3] for i in range(0, size, 3)]
        native_triangles, elements = STVK.stored_mapping(
            triangles, case["referenceCoefficients"]
        )
        delta = [b - a for a, b in zip(before, after)]
        rounded_delta = [STVK.exact(float(b) - float(a)) for a, b in zip(before, after)]
        coefficients = [mass[i // 3] / (h * h) for i in range(size)]
        inertia_before = sum(
            c * (x - t) ** 2 / 2 for c, x, t in zip(coefficients, before, target)
        )
        inertia_after = sum(
            c * (x - t) ** 2 / 2 for c, x, t in zip(coefficients, after, target)
        )
        inertia_delta = inertia_after - inertia_before
        inertia_linear = sum(
            c * (x - t) * d for c, x, t, d in zip(coefficients, before, target, delta)
        )
        inertia_remainder = sum(c * d * d / 2 for c, d in zip(coefficients, delta))
        gradient_slope = sum(value * d for value, d in zip(g, rounded_delta))
        runtime = case.get("runtime", {})
        if not isinstance(runtime, dict):
            raise TypeError("runtime must be an object")
        c1 = STVK.exact(runtime.get("c1", 1e-4))
        if not 0 < c1 < 1:
            raise ValueError("Armijo c1 must be in (0,1)")
        values, truths = {}, {}
        for name in ("storedCoefficientPolynomial", "independentExactUVMaterial"):
            if name == "storedCoefficientPolynomial":
                energies = [
                    stored_energy(native_triangles, p, elements)
                    for p in (before_points, after_points)
                ]
                elastic_gradient = STVK.stored_gradient(
                    native_triangles, before_points, elements
                )
            else:
                energies = [
                    uv_energy(vertices, triangles, p, case["material"], case["grain"])
                    for p in (before_points, after_points)
                ]
                elastic_gradient = STVK.precise_gradient(
                    vertices, triangles, before_points, case["material"], case["grain"]
                )
            membrane_delta = energies[1] - energies[0]
            elastic_linear = sum(
                value * d
                for value, d in zip([v for p in elastic_gradient for v in p], delta)
            )
            real_slope = elastic_linear + inertia_linear
            potential_delta = (energies[1] + inertia_after) - (
                energies[0] + inertia_before
            )
            truths[name] = potential_delta, membrane_delta - elastic_linear
            values[name] = {
                "membraneBeforeNJ": float(energies[0]),
                "membraneAfterNJ": float(energies[1]),
                "membraneDeltaNJ": float(membrane_delta),
                "inertiaDeltaNJ": float(inertia_delta),
                "potentialDeltaNJ": float(potential_delta),
                "realGradientSlopeNJ": float(real_slope),
                "realMembraneRemainderNJ": float(membrane_delta - elastic_linear),
                "realInertiaRemainderNJ": float(inertia_remainder),
                "runtimeGradientSlopeErrorNJ": float(abs(gradient_slope - real_slope)),
                "armijoMarginUsingRuntimeGradientNJ": float(
                    c1 * gradient_slope - potential_delta
                ),
                "passesRealPotentialArmijoWithRuntimeGradient": gradient_slope < 0
                and potential_delta <= c1 * gradient_slope,
            }
        runtime_values = {
            "actualGradientDotRoundedDeltaNJ": float(gradient_slope),
            "runtimeGradientDotRealEndpointDeltaNJ": float(
                sum(value * d for value, d in zip(g, delta))
            ),
            "c1": float(c1),
        }
        for key in (
            "slope",
            "increment",
            "delta",
            "membraneRemainder",
            "inertiaRemainder",
            "armijoRhs",
            "rawDifference",
        ):
            if runtime.get(key) is not None:
                runtime_values[key] = float(STVK.exact(runtime[key]))
        if (
            "increment" in runtime_values
            and "delta" in runtime_values
            and runtime_values["increment"] != runtime_values["delta"]
        ):
            raise ValueError("runtime.increment and runtime.delta disagree")
        if (
            runtime.get("membraneRemainder") is not None
            and runtime.get("inertiaRemainder") is not None
        ):
            membrane_r = STVK.exact(runtime["membraneRemainder"])
            inertia_r = STVK.exact(runtime["inertiaRemainder"])
            recombined = gradient_slope + membrane_r + inertia_r
            runtime_values["realSumOfStoredRuntimeTermsNJ"] = (
                correctly_rounded_runtime_term_sum(
                    g, rounded_delta, membrane_r, inertia_r
                )
            )
            runtime_values["inertiaRemainderErrorNJ"] = float(
                abs(inertia_r - inertia_remainder)
            )
            for name, value in values.items():
                truth, membrane_remainder = truths[name]
                value["runtimeRecombinedAbsoluteErrorNJ"] = float(
                    abs(recombined - truth)
                )
                value["runtimeMembraneRemainderErrorNJ"] = float(
                    abs(membrane_r - membrane_remainder)
                )
                increment = runtime.get("increment", runtime.get("delta"))
                if increment is not None:
                    value["runtimeRecordedIncrementAbsoluteErrorNJ"] = float(
                        abs(STVK.exact(increment) - truth)
                    )
                if runtime.get("rawDifference") is not None:
                    value["rawDifferenceAbsoluteErrorNJ"] = float(
                        abs(STVK.exact(runtime["rawDifference"]) - truth)
                    )
                if runtime.get("armijoRhs") is not None:
                    rhs = STVK.exact(runtime["armijoRhs"])
                    value["armijoMarginUsingRecordedRhsNJ"] = float(rhs - truth)
                    value["passesRealPotentialRecordedArmijo"] = (
                        gradient_slope < 0 and truth <= rhs
                    )
        result = {
            "schema": "pliego-membrane-increment-precision/1",
            "diagnosticSumVersion": DIAGNOSTIC_SUM_VERSION,
            "decimalDigits": digits,
            "meanings": values,
            "runtime": runtime_values,
            "actualStep": {
                "maximumCoordinateDeltaMm": float(max(map(abs, delta))),
                "maximumDeltaSubtractionErrorMm": float(
                    max(abs(a - b) for a, b in zip(delta, rounded_delta))
                ),
                "zeroRealDelta": all(v == 0 for v in delta),
                "zeroRuntimeGradient": all(v == 0 for v in g),
            },
            "provenance": {
                "caseSHA256": sha(canonical(case)),
                "diagnosticSHA256": sha(Path(__file__).read_bytes()),
                "gradientHelperSHA256": sha(SOURCE.read_bytes()),
                "stateFloat64LESHA256": hashes,
                "capturedCoefficientSHA256": sha(
                    canonical(case["referenceCoefficients"])
                ),
            },
            "scope": "direct Decimal before/after Green+fixed real M/h^2 inertia; actual finite f64 endpoints, no solve, no EPS bound, no near-zero relative error claim, no convergence or representable-equilibrium certificate",
        }
        json.dumps(result, allow_nan=False)
        return result


def self_test():
    # Fully dyadic finite stretch: independent hand-computed Pi1-Pi0=511/128.
    case = {
        "vertices": [[0, 0], [2, 0], [0, 2]],
        "triangles": [[0, 1, 2]],
        "grain": 0,
        "material": {"E1": 8, "E2": 8, "nu12": 0, "G12": 4, "thickness": 1},
        "referenceCoefficients": {
            "triangles": [[0, 1, 2]],
            "elements": [
                {
                    "alpha": [-0.5, 0.5, 0],
                    "beta": [-0.5, 0, 0.5],
                    "Q": [8, 8, 0, 4],
                    "volume": 2,
                }
            ],
        },
        "before": [0, 0, 0, 2.5, 0, 0, 0, 0, -2],
        "after": [0, 0, 0, 3, 0, 0, 0, 0, -2],
        "xt": [0, 0, 0, 2, 0, 0, 0, 0, -2],
        "mass": [1, 1, 1],
        "h": 0.5,
        "gradient": [-2.8125, 0, 0, 4.8125, 0, 0, 0, 0, 0],
        "runtime": {
            "slope": 2.40625,
            "membraneRemainder": 1.0859375,
            "inertiaRemainder": 0.5,
            "increment": 3.9921875,
        },
    }
    base = evaluate(case)
    for value in base["meanings"].values():
        assert value["potentialDeltaNJ"] == 511 / 128
        assert value["runtimeRecombinedAbsoluteErrorNJ"] == 0
    reversed_case = {
        **case,
        "before": case["after"],
        "after": case["before"],
        "runtime": {},
    }
    for value in evaluate(reversed_case)["meanings"].values():
        assert value["potentialDeltaNJ"] == -511 / 128
    stationary = {**case, "after": case["before"], "runtime": {}}
    for value in evaluate(stationary)["meanings"].values():
        assert value["potentialDeltaNJ"] == 0
    return {
        "schema": "pliego-membrane-increment-precision-self-test/1",
        "passed": True,
        "testCases": 3,
        "proofs": {
            "analyticalFiniteStretchAndInertiaDeltaNJ": 511 / 128,
            "reversalAndZeroActualStep": True,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--digits", type=int, default=80)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if not 60 <= args.digits <= 100:
        raise ValueError("Decimal precision must be 60..100 digits")
    if args.self_test:
        result = self_test()
    else:
        raw = sys.stdin.buffer.read()
        value = json.loads(raw)
        if isinstance(value, dict) and "cases" in value:
            if not isinstance(value["cases"], list) or not value["cases"]:
                raise ValueError("cases must be a nonempty array")
            result = {
                "schema": "pliego-membrane-increment-precision-batch/1",
                "cases": [evaluate(c, args.digits) for c in value["cases"]],
            }
        else:
            result = evaluate(value, args.digits)
        result["inputSHA256"] = sha(raw)
    print(json.dumps(result, allow_nan=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, TypeError, KeyError, OverflowError, ZeroDivisionError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
