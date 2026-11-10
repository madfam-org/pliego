"""Fixed actual-World transient-pose Decimal force diagnostic, no solve.

Reuses independently tested exact-UV StVK and captured-coefficient derivatives.
The inertia term uses the REAL arithmetic value of the stored binary64 M, h,
x and xt. Numeric report state is verified against lossless Float64LE capture;
native raw hashes additionally use the report's explicitly declared byte order.
An ULP force scale is a warning, never a bound or a replacement force gate.
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
from pathlib import Path

SOURCE = Path(__file__).with_name("plane-stress-precision.py")
SPEC = importlib.util.spec_from_file_location("modal_precision_stvk", SOURCE)
STVK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STVK)
STATE_KEYS = ("x", "xs", "xt", "v")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()


def numbers(values, count, name):
    if not isinstance(values, list) or len(values) != count:
        raise ValueError(f"{name} requires {count} finite numeric entries")
    return [float(STVK.exact(v)) for v in values]


def select(report, selection):
    rows = [
        row
        for row in report["results"]
        if all(
            row["geometry"].get(k) == selection[k]
            for k in ("cells", "pattern", "grain")
        )
    ]
    if len(rows) != 1:
        raise ValueError("selection must identify exactly one geometry")
    row = rows[0]
    trajectories = [
        t
        for t in row["trajectories"]
        if all(
            t.get(k) == selection[k] for k in ("level", "budget", "seed", "amplitude")
        )
    ]
    if len(trajectories) != 1:
        raise ValueError("selection must identify exactly one trajectory")
    trajectory = trajectories[0]
    snapshot = trajectory["snapshots"].get(selection["snapshot"])
    if snapshot is None:
        raise ValueError("selected snapshot must exist; no nearest/final fallback")
    if not isinstance(snapshot, dict):
        raise TypeError("selected snapshot must be an object")
    return row, trajectory, snapshot


def decode_state(snapshot, count, byte_order):
    if byte_order not in ("LE", "BE"):
        raise ValueError("report.runtime.byteOrder must explicitly be LE or BE")
    observation = snapshot["observation"]
    encoded = snapshot.get("stateFloat64LE")
    if not isinstance(encoded, dict):
        raise TypeError("snapshot requires lossless stateFloat64LE object")
    state, hashes = {}, {}
    for key in STATE_KEYS:
        numeric = numbers(observation[key], count, f"observation.{key}")
        if not isinstance(encoded.get(key), str):
            raise TypeError(f"stateFloat64LE.{key} must be base64 text")
        try:
            raw = base64.b64decode(encoded[key], validate=True)
        except (ValueError, binascii.Error) as error:
            raise ValueError(f"invalid base64 state {key}") from error
        if len(raw) != 8 * count:
            raise ValueError(f"Float64LE state {key} byte count mismatch")
        decoded = list(struct.unpack(f"<{count}d", raw))
        if any(not math.isfinite(v) for v in decoded) or decoded != numeric:
            raise ValueError(f"Float64LE state {key} disagrees with numeric field")
        # Numeric equality deliberately permits signed-zero JSON loss; raw hash
        # binds the sign from the retained bytes and every other original bit.
        native_raw = (
            raw
            if byte_order == "LE"
            else b"".join(raw[i : i + 8][::-1] for i in range(0, len(raw), 8))
        )
        native_hash = sha(native_raw)
        if observation["rawSHA256"].get(key) != native_hash:
            raise ValueError(f"native rawSHA256 {key} mismatch")
        state[key] = decoded
        hashes[key] = {"float64LESHA256": sha(raw), "nativeSHA256": native_hash}
    return state, hashes


def validate_mesh(row):
    uv = row["vertices"]
    if not isinstance(uv, list) or len(uv) < 3:
        raise ValueError("at least three reference vertices required")
    vertices = [list(map(STVK.exact, numbers(p, 2, "vertex"))) for p in uv]
    triangles = row["triangles"]
    if not isinstance(triangles, list) or not triangles:
        raise ValueError("nonempty authored triangles required")
    used, seen = set(), set()
    for ids in triangles:
        if (
            not isinstance(ids, list)
            or len(ids) != 3
            or any(
                isinstance(i, bool)
                or not isinstance(i, int)
                or not 0 <= i < len(vertices)
                for i in ids
            )
            or len(set(ids)) != 3
            or tuple(sorted(ids)) in seen
        ):
            raise ValueError(
                "distinct valid triangle vertex IDs and no duplicates required"
            )
        seen.add(tuple(sorted(ids)))
        used.update(ids)
        a, b, c = [vertices[i] for i in ids]
        if (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]) <= 0:
            raise ValueError("positive authored reference orientation required")
    if len(used) != len(vertices):
        raise ValueError("all vertices must be consumed")
    return vertices, triangles


def infinity(values):
    return max(map(abs, values))


def evaluate(report, selection, digits=80, input_bytes=None):
    if (
        isinstance(digits, bool)
        or not isinstance(digits, int)
        or not 60 <= digits <= 100
    ):
        raise ValueError("precision must be 60..100 digits")
    row, trajectory, snapshot = select(report, selection)
    vertices, triangles = validate_mesh(row)
    n = len(vertices)
    observation = snapshot["observation"]
    if (
        observation.get("targetValid") is not True
        or observation.get("initial") is not False
    ):
        raise ValueError("snapshot requires a completed actual-substep inertial target")
    state, state_hashes = decode_state(snapshot, 3 * n, report["runtime"]["byteOrder"])
    masses = numbers(trajectory["runtime"]["massProof"]["native"], n, "native mass")
    h = STVK.exact(trajectory["h"])
    tolerance = STVK.exact(trajectory["forceTolerance"])
    if h <= 0 or tolerance <= 0 or min(masses) <= 0:
        raise ValueError("positive native mass, h and literal force tolerance required")
    if (
        observation["h"] != trajectory["h"]
        or observation["forceTolerance"] != trajectory["forceTolerance"]
    ):
        raise ValueError("trajectory/snapshot h or force tolerance mismatch")
    runtime = {
        key: numbers(observation[key], 3 * n, key)
        for key in ("elasticGradient", "inertiaGradient", "residual")
    }
    if any(
        g + i != r
        for g, i, r in zip(
            runtime["elasticGradient"], runtime["inertiaGradient"], runtime["residual"]
        )
    ):
        raise ValueError(
            "recorded runtime residual is not its actual binary64 term sum"
        )
    actual_maximum = max(map(abs, runtime["residual"]))
    if observation.get("residualInfinity") != actual_maximum or observation.get(
        "literalForceGate"
    ) is not (STVK.exact(actual_maximum) <= tolerance):
        raise ValueError(
            "recorded runtime maximum or literal force gate disagrees with its fields"
        )
    coefficients = row["referenceCoefficients"]
    native_triangles, elements = STVK.stored_mapping(triangles, coefficients)
    for element in elements:
        for key, count in (("alpha", 3), ("beta", 3), ("Q", 4)):
            numbers(element[key], count, f"element.{key}")
        if STVK.exact(element["volume"]) <= 0:
            raise ValueError("captured element volume must be positive")
    with localcontext() as context:
        context.prec = digits
        positions = [
            [STVK.exact(v) for v in state["x"][i : i + 3]] for i in range(0, 3 * n, 3)
        ]
        elastic = {
            "independentExactUVMaterial": [
                v
                for p in STVK.precise_gradient(
                    vertices, triangles, positions, row["material"], selection["grain"]
                )
                for v in p
            ],
            "storedCoefficientPolynomial": [
                v
                for p in STVK.stored_gradient(native_triangles, positions, elements)
                for v in p
            ],
        }
        mass = list(map(STVK.exact, masses))
        inertia = [
            mass[i // 3] / (h * h) * (STVK.exact(x) - STVK.exact(xt))
            for i, (x, xt) in enumerate(zip(state["x"], state["xt"]))
        ]
        residuals = {
            name: [g + i for g, i in zip(values, inertia)]
            for name, values in elastic.items()
        }
        residuals["runtimeRecorded"] = list(map(STVK.exact, runtime["residual"]))
        residuals["runtimeTermsRealSum"] = [
            STVK.exact(g) + STVK.exact(i)
            for g, i in zip(runtime["elasticGradient"], runtime["inertiaGradient"])
        ]
        summary = {}
        for name, residual in residuals.items():
            maximum = infinity(residual)
            summary[name] = {
                "residualInfinityMicroN": float(maximum),
                "maximumNodalResidualMicroN": float(
                    max(
                        sum(v * v for v in residual[i : i + 3]).sqrt()
                        for i in range(0, 3 * n, 3)
                    )
                ),
                "massDualResidualNorm": float(
                    sum(v * v / mass[i // 3] for i, v in enumerate(residual)).sqrt()
                ),
                "passesUnchangedForceGate": maximum <= tolerance,
            }
        errors = {
            name: {
                "elasticMaximumMicroN": float(
                    infinity(
                        [
                            STVK.exact(actual) - g
                            for actual, g in zip(runtime["elasticGradient"], values)
                        ]
                    )
                ),
                "residualMaximumMicroN": float(
                    infinity(
                        [
                            STVK.exact(actual) - r
                            for actual, r in zip(runtime["residual"], residuals[name])
                        ]
                    )
                ),
            }
            for name, values in elastic.items()
        }
        inertia_error = float(
            infinity(
                [
                    STVK.exact(actual) - value
                    for actual, value in zip(runtime["inertiaGradient"], inertia)
                ]
            )
        )
        ulp_scales = [
            mass[i // 3] * STVK.exact(math.ulp(x)) / (h * h)
            for i, x in enumerate(state["x"])
        ]
        worst = sorted(
            range(3 * n), key=lambda i: (-abs(residuals["runtimeRecorded"][i]), i)
        )[:10]
        worst_rows = [
            {
                "dof": i,
                "node": i // 3,
                "component": "XYZ"[i % 3],
                "coordinateULPMm": math.ulp(state["x"][i]),
                "massTimesCoordinateULPOverHSquaredMicroN": float(ulp_scales[i]),
                "elasticMicroN": {
                    name: float(values[i]) for name, values in elastic.items()
                },
                "inertiaMicroN": float(inertia[i]),
                "residualMicroN": {
                    name: float(values[i]) for name, values in residuals.items()
                },
            }
            for i in worst
        ]
        fields = {
            name: {
                "elasticGradient": list(map(float, values)),
                "inertiaGradient": list(map(float, inertia)),
                "residual": list(map(float, residuals[name])),
            }
            for name, values in elastic.items()
        }
    result = {
        "schema": "pliego-membrane-modal-precision/1",
        "decimalDigits": digits,
        "selection": selection,
        "step": observation.get("step"),
        "h": float(h),
        "forceToleranceMicroN": float(tolerance),
        "summary": summary,
        "maximumRuntimeTermErrorsMicroN": {
            "elasticAndResidual": errors,
            "inertia": inertia_error,
        },
        "highPrecisionFields": fields,
        "worstRuntimeDofs": worst_rows,
        "resolutionDiagnostic": {
            "maximumMassTimesCoordinateULPOverHSquaredMicroN": float(max(ulp_scales)),
            "scope": "coordinate-resolution warning only; not a bound, impossibility proof or acceptance allowance",
        },
        "provenance": {
            "inputSHA256": sha(
                input_bytes if input_bytes is not None else canonical(report)
            ),
            "diagnosticSHA256": sha(Path(__file__).read_bytes()),
            "gradientHelperSHA256": sha(SOURCE.read_bytes()),
            "runtimeSourceGit": report.get("source", {}).get("git"),
            "reportNativeByteOrder": report["runtime"]["byteOrder"],
            "state": state_hashes,
            "capturedCoefficientSHA256": sha(canonical(coefficients)),
            "capturedCoefficientHashEncoding": "sorted-key compact UTF-8 JSON; Python numeric encoding",
            "nativeMassFloat64LESHA256": sha(struct.pack(f"<{n}d", *masses)),
            "hFloat64LESHA256": sha(struct.pack("<d", float(h))),
        },
        "scope": "fixed actual binary64 pose/predictor evaluation only, no solve/time integration/calibration or proof that no representable equilibrium exists; real stored M/h^2*(x-xt); independent exact-UV/Q StVK and rounded captured-coefficient polynomial kept separate; literal force tolerance unchanged",
    }
    json.dumps(result, allow_nan=False)
    return result


def main():
    if sys.argv[1:] == ["--self-test"]:
        from test_membrane_modal_precision import run_self_validation

        proof = run_self_validation()
        print(json.dumps(proof, allow_nan=False))
        return int(not proof["passed"])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input")
    for name, kind in (
        ("cells", int),
        ("grain", float),
        ("level", int),
        ("budget", int),
        ("amplitude", float),
    ):
        parser.add_argument("--" + name, type=kind, required=True)
    parser.add_argument("--pattern", required=True)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--seed", choices=("true", "false"), required=True)
    parser.add_argument("--digits", type=int, default=80)
    args = parser.parse_args()
    raw = Path(args.input).read_bytes()
    selection = {
        k: getattr(args, k)
        for k in (
            "cells",
            "grain",
            "level",
            "budget",
            "amplitude",
            "pattern",
            "snapshot",
        )
    }
    selection["seed"] = args.seed == "true"
    result = evaluate(json.loads(raw), selection, args.digits, raw)
    print(json.dumps(result, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, TypeError, KeyError, OverflowError, ZeroDivisionError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
