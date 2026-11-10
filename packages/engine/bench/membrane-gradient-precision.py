"""Independent Decimal energy/gradient check at a supplied actual binary64 pose.

The frozen independent energy and FSP gradient references are reused, never a
runtime derivative. Captured coefficient/coherent difference-form and independent
UV/material meanings stay separate. Optional inertia is either a named stored
algebraic term or checked against the actual native binary64 association AND
independently evaluated real M/h^2. No solve, timestep or force-gate allowance.
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
from decimal import localcontext
from fractions import Fraction
from pathlib import Path

ENERGY_SOURCE = Path(__file__).with_name("membrane-increment-precision.py")
SPEC = importlib.util.spec_from_file_location(
    "gradient_energy_reference", ENERGY_SOURCE
)
ENERGY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENERGY)
STVK = ENERGY.STVK


def sha(data):
    return hashlib.sha256(data).hexdigest()


def exact_dot(a, b):
    return sum(
        (
            Fraction.from_float(float(x)) * Fraction.from_float(float(y))
            for x, y in zip(a, b)
        ),
        Fraction(),
    )


def finite_vector(value, size, name):
    return [float(v) for v in ENERGY.vector(value, size, name)]


def captured_inputs(case, inputs):
    encoded, claimed = case.get("stateFloat64LE"), case.get("stateSHA256")
    if (encoded is None) != (claimed is None):
        raise ValueError("lossless state requires both LE bytes and SHA256 claims")
    if encoded is not None:
        if not isinstance(encoded, dict) or not isinstance(claimed, dict):
            raise TypeError("stateFloat64LE/stateSHA256 must be objects")
        if encoded.keys() != inputs.keys() or claimed.keys() != inputs.keys():
            raise ValueError(
                "lossless capture must bind exactly every supplied vector/scalar h"
            )
    hashes, decoded = {}, {}
    for key, values in inputs.items():
        raw = struct.pack("<" + str(len(values)) + "d", *values)
        actual = values
        if encoded is not None:
            if not isinstance(encoded[key], str):
                raise TypeError("lossless state values must be base64 strings")
            try:
                raw = base64.b64decode(encoded[key], validate=True)
            except (binascii.Error, ValueError) as error:
                raise ValueError(f"invalid lossless base64 for {key}") from error
            if len(raw) != 8 * len(values):
                raise ValueError(f"lossless {key} byte count mismatch")
            actual = list(struct.unpack("<" + str(len(values)) + "d", raw))
            if any(not math.isfinite(v) for v in actual) or actual != values:
                raise ValueError(f"lossless {key} numeric mismatch")
        hashes[key] = sha(raw)
        if claimed is not None and hashes[key] != claimed[key]:
            raise ValueError(f"lossless {key} SHA256 mismatch")
        decoded[key] = actual
    return decoded, hashes, encoded is not None


def norm(values):
    return sum(v * v for v in values).sqrt()


def errors(observed, reference):
    difference = [a - b for a, b in zip(observed, reference)]
    scale = norm(reference)
    return {
        "maximumComponentMicroN": float(max(map(abs, difference))),
        "l2MicroN": float(norm(difference)),
        "relativeL2": float(norm(difference) / scale) if scale else None,
        "maximumNodalMicroN": float(
            max(norm(difference[i : i + 3]) for i in range(0, len(difference), 3))
        ),
    }


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
        n, size = len(vertices), 3 * len(vertices)
        runtime = case["runtime"]
        if not isinstance(runtime, dict):
            raise TypeError("runtime must be an object with elastic energy/gradient")
        runtime_energy = STVK.exact(runtime["energy"])
        inputs = {
            "x": finite_vector(case["x"], size, "x"),
            "gradient": finite_vector(runtime["gradient"], size, "runtime.gradient"),
        }
        for key in ("direction", "inertiaGradient", "xt"):
            if key in case:
                inputs[key] = finite_vector(case[key], size, key)
        physical_keys = [key in case for key in ("xt", "mass", "h")]
        if any(physical_keys) and not all(physical_keys):
            raise ValueError("xt/mass/h must be supplied together")
        physical = all(physical_keys)
        if physical:
            inputs["mass"] = finite_vector(case["mass"], n, "mass")
            inputs["h"] = [float(STVK.exact(case["h"]))]
            if min(inputs["mass"]) <= 0 or inputs["h"][0] <= 0:
                raise ValueError("positive native mass and h required")
        if "incrementalGradient" in runtime:
            if "inertiaGradient" not in inputs:
                raise ValueError(
                    "captured incremental gradient requires supplied inertiaGradient"
                )
            inputs["incrementalGradient"] = finite_vector(
                runtime["incrementalGradient"], size, "runtime.incrementalGradient"
            )
        inputs, hashes, lossless = captured_inputs(case, inputs)
        x = list(map(STVK.exact, inputs["x"]))
        observed = list(map(STVK.exact, inputs["gradient"]))
        positions = [x[i : i + 3] for i in range(0, size, 3)]
        native_triangles, elements = STVK.stored_mapping(
            triangles, case["referenceCoefficients"]
        )
        native_inertia = inputs.get("inertiaGradient")
        real_inertia = None
        inertia_info = {"scope": "absent", "nativeAssociationVerified": False}
        if physical:
            mass, h = list(map(STVK.exact, inputs["mass"])), STVK.exact(inputs["h"][0])
            target = list(map(STVK.exact, inputs["xt"]))
            real_inertia = [
                mass[i // 3] / (h * h) * (value - target[i])
                for i, value in enumerate(x)
            ]
            idt2 = 1.0 / (inputs["h"][0] * inputs["h"][0])
            expected = [
                inputs["mass"][i // 3] * idt2 * (value - inputs["xt"][i])
                for i, value in enumerate(inputs["x"])
            ]
            if not all(map(math.isfinite, expected)):
                raise ValueError("native inertia association exceeds finite domain")
            if native_inertia is not None:
                matches = all(
                    struct.pack("<d", a) == struct.pack("<d", b) if lossless else a == b
                    for a, b in zip(native_inertia, expected)
                )
                if not matches:
                    raise ValueError(
                        "supplied inertia does not match native m*(1/(h*h))*(x-xt)"
                    )
            inertia_info = {
                "scope": "real stored M/h^2 independently evaluated; supplied native term checked separately"
                if native_inertia is not None
                else "real stored M/h^2 independently evaluated; no supplied native term",
                "nativeAssociationVerified": native_inertia is not None,
                "nativeAssociation": "m*(1/(h*h))*(x-xt), binary64 after each operation",
                "zeroSignValidation": "bit-exact decoded LE"
                if lossless
                else "numeric equality permits JSON signed-zero loss",
                "realGradient": list(map(float, real_inertia)),
            }
            if native_inertia is not None:
                inertia_info["nativeErrorAgainstReal"] = errors(
                    list(map(STVK.exact, native_inertia)), real_inertia
                )
        elif native_inertia is not None:
            inertia_info = {
                "scope": "algebra-only exact supplied binary64 term; no M/h^2 validation",
                "nativeAssociationVerified": False,
            }
            real_inertia = list(map(STVK.exact, native_inertia))
        increment_native = None
        if native_inertia is not None:
            increment_native = [
                g + i for g, i in zip(inputs["gradient"], native_inertia)
            ]
            if not all(map(math.isfinite, increment_native)):
                raise ValueError(
                    "native rounded gradient+inertia exceeds finite domain"
                )
            if "incrementalGradient" in inputs:
                matches = all(
                    struct.pack("<d", a) == struct.pack("<d", b) if lossless else a == b
                    for a, b in zip(inputs["incrementalGradient"], increment_native)
                )
                if not matches:
                    raise ValueError(
                        "captured incremental gradient differs from native rounded elastic+inertia addition"
                    )
                increment_native = inputs["incrementalGradient"]
        direction = (
            list(map(STVK.exact, inputs["direction"]))
            if "direction" in inputs
            else None
        )
        meanings = {}
        for name in ("storedCoefficientPolynomial", "independentExactUVMaterial"):
            if name == "storedCoefficientPolynomial":
                energy = ENERGY.stored_energy(native_triangles, positions, elements)
                reference = [
                    v
                    for p in STVK.stored_gradient(native_triangles, positions, elements)
                    for v in p
                ]
            else:
                energy = ENERGY.uv_energy(
                    vertices, triangles, positions, case["material"], case["grain"]
                )
                reference = [
                    v
                    for p in STVK.precise_gradient(
                        vertices, triangles, positions, case["material"], case["grain"]
                    )
                    for v in p
                ]
            value = {
                "energyNJ": float(energy),
                "gradient": list(map(float, reference)),
                "gradientL2MicroN": float(norm(reference)),
                "energyAbsoluteErrorNJ": float(abs(runtime_energy - energy)),
                "elasticGradientError": errors(observed, reference),
            }
            if direction is not None:
                slope = sum(g * d for g, d in zip(reference, direction))
                value["elasticProjectedSlopeNJ"] = float(slope)
                value["elasticProjectedSlopeAbsoluteErrorNJ"] = float(
                    abs(
                        sum(
                            (g - r) * d
                            for g, r, d in zip(observed, reference, direction)
                        )
                    )
                )
            if real_inertia is not None:
                incremental = [g + i for g, i in zip(reference, real_inertia)]
                value["realIncrementalGradient"] = list(map(float, incremental))
                if increment_native is not None:
                    value["nativeRoundedIncrementalGradientError"] = errors(
                        list(map(STVK.exact, increment_native)), incremental
                    )
                if direction is not None:
                    value["realIncrementalProjectedSlopeNJ"] = float(
                        sum(g * d for g, d in zip(incremental, direction))
                    )
                    if increment_native is not None:
                        value[
                            "nativeRoundedIncrementalProjectedSlopeAbsoluteErrorNJ"
                        ] = float(
                            abs(
                                sum(
                                    (STVK.exact(g) - r) * d
                                    for g, r, d in zip(
                                        increment_native, incremental, direction
                                    )
                                )
                            )
                        )
            meanings[name] = value
        runtime_info = {
            "arithmetic": runtime.get("arithmetic", "unspecified"),
            "elasticEnergyNJ": float(runtime_energy),
            "elasticGradient": inputs["gradient"],
        }
        if increment_native is not None:
            runtime_info["nativeRoundedIncrementalGradient"] = increment_native
            runtime_info["incrementalGradientSource"] = (
                "supplied and native association verified"
                if "incrementalGradient" in inputs
                else "computed native rounded addition, not captured full World.g"
            )
        if direction is not None:
            runtime_info["elasticProjectedSlopeNJ"] = float(
                exact_dot(inputs["gradient"], inputs["direction"])
            )
            if increment_native is not None:
                runtime_info["nativeRoundedIncrementalProjectedSlopeNJ"] = float(
                    exact_dot(increment_native, inputs["direction"])
                )
                runtime_info["sumOfStoredElasticAndInertiaProjectedTermsNJ"] = float(
                    exact_dot(inputs["gradient"], inputs["direction"])
                    + exact_dot(native_inertia, inputs["direction"])
                )
        result = {
            "schema": "pliego-membrane-gradient-precision/1",
            "decimalDigits": digits,
            "meanings": meanings,
            "runtime": runtime_info,
            "inertia": inertia_info,
            "directionScope": "supplied captured binary64 direction; no unretained endpoint inferred"
            if direction is not None
            else "absent",
            "provenance": {
                "caseSHA256": sha(ENERGY.canonical(case)),
                "diagnosticSHA256": sha(Path(__file__).read_bytes()),
                "energyHelperSHA256": sha(ENERGY_SOURCE.read_bytes()),
                "gradientHelperSHA256": sha(ENERGY.SOURCE.read_bytes()),
                "stateFloat64LESHA256": hashes,
                "losslessStateSupplied": lossless,
                "capturedCoefficientSHA256": sha(
                    ENERGY.canonical(case["referenceCoefficients"])
                ),
            },
            "scope": "fixed actual f64 pose, independent direct Decimal Green energy/coherent derivative and UV/material meaning; native inertia association checked only when all physical inputs supplied; no solve, simulation, stock calibration or force-gate allowance",
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
                    "alpha": [-0.5, 0.5, 0],
                    "beta": [-0.5, 0, 0.5],
                    "Q": [8, 8, 0, 4],
                    "volume": 2,
                }
            ],
        },
        "x": [0, 0, 0, 2.5, 0, 0, 0, 0, -2],
        "runtime": {
            "energy": 0.6328125,
            "gradient": [-2.8125, 0, 0, 2.8125, 0, 0, 0, 0, 0],
        },
        "xt": [0, 0, 0, 2, 0, 0, 0, 0, -2],
        "mass": [1, 1, 1],
        "h": 0.5,
        "inertiaGradient": [0, 0, 0, 2, 0, 0, 0, 0, 0],
        "direction": [0, 0, 0, 0.5, 0, 0, 0, 0, 0],
    }
    result = evaluate(case)
    for value in result["meanings"].values():
        assert value["energyNJ"] == 81 / 128
        assert value["elasticGradientError"]["maximumComponentMicroN"] == 0
        assert value["elasticProjectedSlopeNJ"] == 45 / 32
        assert value["realIncrementalProjectedSlopeNJ"] == 77 / 32
        assert value["nativeRoundedIncrementalProjectedSlopeAbsoluteErrorNJ"] == 0
    assert result["inertia"]["nativeAssociationVerified"]
    return {
        "schema": "pliego-membrane-gradient-precision-self-test/1",
        "passed": True,
        "testCases": 2,
        "proofs": {
            "analyticalFinitePiolaEnergyAndGradient": True,
            "nativeAndRealInertiaAndProjectedSlope": True,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--digits", type=int, default=80)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if not 60 <= args.digits <= 100:
        raise ValueError("precision must be 60..100 digits")
    if args.self_test:
        result = self_test()
    else:
        raw = sys.stdin.buffer.read()
        value = json.loads(raw)
        if isinstance(value, dict) and "cases" in value:
            if not isinstance(value["cases"], list) or not value["cases"]:
                raise ValueError("cases must be a nonempty array")
            result = {
                "schema": "pliego-membrane-gradient-precision-batch/1",
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
