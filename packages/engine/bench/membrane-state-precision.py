"""Independent exact-rational latent/reference-displacement state observer.

q=X0+u is an exact real sum of captured binary64 words, not projected public x.
The represented Green polynomial is evaluated by direct F^T F-A^T A, with
independent tensor/Piola derivatives. Original absolute-x oracles stay unchanged.
"""

import argparse
import base64
import hashlib
import importlib.util
import json
import math
import struct
import sys
from decimal import localcontext
from fractions import Fraction as F
from pathlib import Path

SOURCE = Path(__file__).with_name("membrane-reference-precision.py")
SPEC = importlib.util.spec_from_file_location("state_reference", SOURCE)
REFERENCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REFERENCE)
IDENTITY = {
    "mode": "reference-displacement", "version": 1,
    "representation": "binary64", "origin": "actual-X0",
    "predictor": "displacement-first", "projection": "round-X0-plus-u",
    "preconditioner": "rounded-public-pose",
}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def bits(value):
    return struct.pack("<d", float(value))


def vector(value, length, label):
    if not isinstance(value, list):
        raise TypeError(label + " must be an array")
    if len(value) != length or any(
        isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x)
        for x in value
    ):
        raise ValueError(label + " requires the declared finite binary64 words")
    return list(map(float, value))


def matrix(a, b):
    return [[sum(x * y for x, y in zip(row, column)) for column in zip(*b)] for row in a]


def transpose(a):
    return list(map(list, zip(*a)))


def direct_element(points, element, hessian=False):
    """Exact stored-constant polynomial; no runtime H or DD base words."""
    u, v, x0, c, s, q, volume = element
    frame = lambda p: [[sum(p[i][r] * k[i] for i in range(3)) for k in (u, v)] for r in range(3)]
    f, a = frame(points), frame(x0)
    metric, metric0 = matrix(transpose(f), f), matrix(transpose(a), a)
    if any(m[0][0] * m[1][1] - m[0][1] ** 2 <= 0 for m in (metric, metric0)):
        raise ValueError("nondegenerate actual reference and current metric required")
    strain = [[(metric[i][j] - metric0[i][j]) / 2 for j in range(2)] for i in range(2)]
    rotation = [[c, -s], [s, c]]

    def stress(e):
        em = matrix(matrix(transpose(rotation), e), rotation)
        ex, ey, gamma = em[0][0], em[1][1], 2 * em[0][1]
        sm = [[q[0] * ex + q[2] * ey, q[3] * gamma],
              [q[3] * gamma, q[2] * ex + q[1] * ey]]
        return matrix(matrix(rotation, sm), transpose(rotation)), (ex, ey, gamma)

    second, (ex, ey, gamma) = stress(strain)
    energy = volume * (q[0] * ex * ex + q[1] * ey * ey + 2 * q[2] * ex * ey + q[3] * gamma * gamma) / 2
    piola = matrix(f, second)
    gradient = [[volume * (piola[r][0] * u[i] + piola[r][1] * v[i]) for r in range(3)] for i in range(3)]
    exact, gn = [[F() for _ in range(9)] for _ in range(9)], [[F() for _ in range(9)] for _ in range(9)]
    if hessian:
        for j in range(3):
            for component in range(3):
                df = [[F(), F()] for _ in range(3)]
                df[component] = [u[j], v[j]]
                cross = matrix(transpose(f), df)
                ds, _ = stress([[(cross[i][k] + cross[k][i]) / 2 for k in range(2)] for i in range(2)])
                material, geometric = matrix(f, ds), matrix(df, second)
                for i in range(3):
                    for r in range(3):
                        gn[3 * i + r][3 * j + component] = volume * (material[r][0] * u[i] + material[r][1] * v[i])
                        exact[3 * i + r][3 * j + component] = gn[3 * i + r][3 * j + component] + volume * (geometric[r][0] * u[i] + geometric[r][1] * v[i])
    return energy, gradient, exact, gn


def configuration(case, n):
    binding = REFERENCE.BINDING.verify(case)
    if not binding["referenceLosslessSupplied"]:
        raise ValueError("authoritative state requires lossless native reference words")
    raw = base64.b64decode(case["referenceFloat64LE"], validate=True)
    words = struct.unpack("<" + "d" * (len(raw) // 8), raw)
    native, original = REFERENCE.STVK.stored_mapping(case["triangles"], case["referenceCoefficients"])
    origin, elements = [None] * n, []
    for index, (ids, entry) in enumerate(zip(native, original)):
        ref = entry.get("reference", {})
        if ref.get("mode") != "uv-displacement" or type(ref.get("version")) is not int or ref["version"] != 1:
            raise ValueError("explicit native UV reference version1 required")
        w = list(words[22 * index : 22 * (index + 1)])
        u, v, x0, c, s, q, volume = list(map(F, w[:3])), list(map(F, w[3:6])), list(map(F, w[6:15])), F(w[15]), F(w[16]), list(map(F, w[17:21])), F(w[21])
        u[0], v[0] = -u[1] - u[2], -v[1] - v[2]
        if volume <= 0 or min(q[0], q[1], q[3]) <= 0 or q[0] * q[1] <= q[2] ** 2:
            raise ValueError("positive native Q and volume required")
        if u[1] * v[2] == u[2] * v[1] or c * c + s * s == 0:
            raise ValueError("nondegenerate native operator/rotation required")
        for local, node in enumerate(ids):
            for r in range(3):
                value = w[6 + 3 * local + r]
                if origin[3 * node + r] is not None and bits(origin[3 * node + r]) != bits(value):
                    raise ValueError("shared native X0 words differ")
                origin[3 * node + r] = value
        elements.append((ids, (u, v, [x0[i:i + 3] for i in range(0, 9, 3)], c, s, q, volume)))
    if any(x is None for x in origin):
        raise ValueError("native reference must consume all vertices")
    return origin, elements, binding


def assemble(points, elements, hessian=False):
    n = len(points)
    total, g = F(), [F()] * n
    h, gn = ([F()] * (n * n), [F()] * (n * n)) if hessian else ([], [])
    for ids, element in elements:
        e, local, he, ge = direct_element([points[3 * i:3 * i + 3] for i in ids], element, hessian)
        total += e
        for i, node in enumerate(ids):
            for r in range(3):
                g[3 * node + r] += local[i][r]
                if hessian:
                    for j, other in enumerate(ids):
                        for c in range(3):
                            h[n * (3 * node + r) + 3 * other + c] += he[3 * i + r][3 * j + c]
                            gn[n * (3 * node + r) + 3 * other + c] += ge[3 * i + r][3 * j + c]
    return total, g, h, gn


def initialization(origin, initial_x, initial_u):
    zero_overrides = 0
    for x, x0, u in zip(initial_x, origin, initial_u):
        high = x + -x0
        virtual = high - x
        low = (x - (high - virtual)) + (-x0 - virtual)
        negative_zero_choice = x == x0 == u == 0 and all(math.copysign(1, a) < 0 for a in (x, x0, u))
        if not math.isfinite(high) or low != 0 or F(x) - F(x0) != F(high) or (bits(high) != bits(u) and not negative_zero_choice):
            raise ValueError("initial actual x-X0 must be exact one-word TwoDiff with zero low word")
        zero_overrides += negative_zero_choice and bits(high) != bits(u)
        if bits(x0 + u) != bits(x):
            raise ValueError("initial public projection must preserve actual x including zero signs")
    return {"twoDiffLowWordsZero": True, "exactRealInitialStatePreserved": True,
            "publicInitialObjectIsPreserved": True, "coordinatesCertified": len(origin),
            "signedZeroInitialUOverrides": zero_overrides,
            "zeroSignPolicy": "u=-0 only for desired x=-0 and X0=-0; origin+0/desired-0 refused; nonzero TwoDiff unchanged"}


def decode_states(case, inputs):
    enc, hashes = case.get("stateFloat64LE"), case.get("stateSHA256")
    if not isinstance(enc, dict) or not isinstance(hashes, dict):
        raise TypeError("stateFloat64LE and stateSHA256 objects required")
    if set(enc) != set(inputs) or set(hashes) != set(inputs):
        raise ValueError("lossless state keys must exactly match supplied state/runtime vectors")
    result = {}
    for key, numeric in inputs.items():
        raw = base64.b64decode(enc[key], validate=True)
        if base64.b64encode(raw).decode() != enc[key] or sha(raw) != hashes[key] or len(raw) != 8 * len(numeric):
            raise ValueError("invalid state LE/SHA binding: " + key)
        words = list(struct.unpack("<" + "d" * len(numeric), raw))
        if any(not math.isfinite(a) or a != b or (b == 0 and math.copysign(1, b) < 0 and math.copysign(1, a) > 0) for a, b in zip(words, numeric)):
            raise ValueError("state words differ from numeric fields: " + key)
        result[key] = words
    return result


def errors(observed, truth):
    differences = [abs(F(a) - b) for a, b in zip(observed, truth)]
    return {"maximumComponentMicroN": float(max(differences, default=F())),
            "l2MicroN": math.hypot(*map(float, differences))}


def observed_gate(runtime, values, prefix, native, tolerance, target_valid):
    if prefix + "ElasticGradient" not in values:
        return {"supplied": False}
    elastic = values[prefix + "ElasticGradient"]
    residual = [a + b for a, b in zip(elastic, native)]
    if any(bits(a) != bits(b) for a, b in zip(native, values[prefix + "InertiaGradient"])):
        raise ValueError(prefix + " inertia does not match declared native binary64 association")
    if any(bits(a) != bits(b) for a, b in zip(residual, values[prefix + "Residual"])):
        raise ValueError(prefix + " residual does not match rounded elastic+inertia")
    maximum = max(map(abs, residual))
    gate = "converged" if prefix == "authoritative" else "literalForceGate"
    observed_maximum = vector([runtime["residualInfinity"]], 1, prefix + "residualInfinity")[0]
    gate_valid = (type(runtime[gate]) is bool and runtime[gate] == (maximum <= tolerance)) if target_valid else runtime[gate] is None
    if bits(maximum) != bits(observed_maximum) or not gate_valid:
        raise ValueError(prefix + " native force gate is inconsistent")
    return {"supplied": True, "nativeAssociationVerified": True,
            "residualInfinityMicroN": maximum, gate: runtime[gate]}


def physical_truth(case, points, ideal):
    vertices = case["vertices"]
    _, physical, _ = REFERENCE.configuration(case, vertices, case["triangles"])
    xyz = [points[i:i + 3] for i in range(0, len(points), 3)]
    energy, gradient, _, _ = REFERENCE.assemble(physical, xyz, False, ideal)
    return F(energy), list(map(F, gradient))


def evaluate(case, digits=80):
    if type(digits) is not int or not 60 <= digits <= 100:
        raise ValueError("precision must be60..100 digits")
    with localcontext() as context:
        context.prec = digits
        vertices, _ = REFERENCE.ENERGY.mesh(case)
        n, state, runtime = 3 * len(vertices), case["state"], case["runtime"]
        if not isinstance(state, dict) or not isinstance(runtime, dict):
            raise TypeError("state and runtime must be objects")
        if any(type(state.get(k)) is not type(v) or state.get(k) != v for k, v in IDENTITY.items()):
            raise ValueError("explicit reference-displacement binary64 state identity required")
        origin, elements, binding = configuration(case, n)
        initial = state["initialization"]
        if not isinstance(initial, dict):
            raise TypeError("initialization must be an object")
        inputs = {k: vector(case[k], n, k) for k in ("x", "xt")}
        inputs.update({k: vector(state[k], n, k) for k in ("u", "ut")})
        inputs.update({"mass": vector(case["mass"], n // 3, "mass"), "h": vector([case["h"]], 1, "h"),
                       "initialX": vector(initial["x"], n, "initialX"), "initialU": vector(initial["u"], n, "initialU")})
        for k in ("us", "v"):
            if k in state:
                inputs[k] = vector(state[k], n, k)
        if "xs" in case:
            inputs["xs"] = vector(case["xs"], n, "xs")
            if "us" not in state:
                raise ValueError("public xs requires authoritative us")
        if "v" in initial:
            inputs["initialV"] = vector(initial["v"], n, "initialV")
            if any(inputs["initialV"]):
                raise ValueError("initial velocity must be zero")
        if "x0" in state:
            inputs["x0"] = vector(state["x0"], n, "x0")
        if type(state.get("targetValid")) is not bool:
            raise TypeError("targetValid must be boolean")
        for prefix in ("authoritative", "public"):
            observed = runtime.get(prefix, {})
            if not isinstance(observed, dict):
                raise TypeError("observed native force records must be objects")
            keys = ("elasticGradient", "inertiaGradient", "residual")
            if any(k in observed for k in keys) and not all(k in observed for k in keys):
                raise ValueError("complete observed native gradient/inertia/residual tuple required")
            for k in keys:
                if k in observed:
                    inputs[prefix + k[0].upper() + k[1:]] = vector(observed[k], n, prefix + k)
        values = decode_states(case, inputs)
        if "x0" in values and any(bits(a) != bits(b) for a, b in zip(origin, values["x0"])):
            raise ValueError("supplied state X0 differs from immutable native reference")
        if values["h"][0] <= 0 or min(values["mass"]) <= 0:
            raise ValueError("positive actual mass and h required")
        initial_proof = initialization(origin, values["initialX"], values["initialU"])
        for view, source in (("x", "u"), ("xt", "ut"), ("xs", "us")):
            if view in values and any(bits(a + b) != bits(c) for a, b, c in zip(origin, values[source], values[view])):
                raise ValueError("public projection is inconsistent including signed zeros: " + view)
        force_scale = vector([runtime["fixedForceScale"]], 1, "fixedForceScale")[0]
        tolerance = vector([runtime["forceTolerance"]], 1, "forceTolerance")[0]
        if not math.isfinite(force_scale) or force_scale <= 0 or bits(tolerance) != bits(max(1e-7, 1e-10 * force_scale)):
            raise ValueError("unchanged fixed initial force scale/tolerance required")
        h, mass = values["h"][0], values["mass"]
        if not math.isfinite(h * h) or h * h == 0:
            raise ValueError("h squared must be finite and nonzero in native arithmetic")
        native_words = [mass[i // 3] * (1 / (h * h)) for i in range(n)]
        if not all(math.isfinite(c) and c > 0 for c in native_words):
            raise ValueError("native inertia coefficient must be finite and positive")
        native_c = list(map(F, native_words))
        real_c = [F(mass[i // 3]) / F(h) ** 2 for i in range(n)]
        latent = [F(x0) + F(u) for x0, u in zip(origin, values["u"])]
        latent_target = [F(x0) + F(u) for x0, u in zip(origin, values["ut"])]
        public, public_target = list(map(F, values["x"])), list(map(F, values["xt"]))
        include_h = case.get("includeHessian", False)
        if type(include_h) is not bool or (include_h and n > 45):
            raise ValueError("optional dense Hessian is boolean and bounded to45 DOFs")
        truths, observed, exact_states = {}, {}, {}
        for label, points, target, displacement, prediction in (
            ("authoritative", latent, latent_target, values["u"], values["ut"]),
            ("public", public, public_target, values["x"], values["xt"]),
        ):
            energy, g, exact, gn = assemble(points, elements, include_h)
            exact_states[label] = (energy, g)
            native_inertia = [float(c) * (u - t) for c, u, t in zip(native_c, displacement, prediction)]
            if not all(map(math.isfinite, native_inertia)):
                raise ValueError("nonfinite native inertia")
            observed[label] = observed_gate(runtime.get(label, {}), values, label, native_inertia, tolerance, state["targetValid"])
            meanings = [("representedUVDisplacement", (energy, g))] + [
                (key, physical_truth(case, points, ideal))
                for key, ideal in (("independentExactUVReferenceMetric", False), ("independentExactUVMaterial", True))
            ]
            result = {}
            for key, (e, gradient) in meanings:
                item = {"energyNJ": float(e), "elasticGradient": list(map(float, gradient))}
                result[key] = item
                item["nativeVersusRealInertiaMaximumComponentDifferenceMicroN"] = float(max(
                    abs((a - b) * (x - t)) for a, b, x, t in zip(native_c, real_c, points, target)
                ))
                if observed[label]["supplied"]:
                    item["elasticGradientError"] = errors(values[label + "ElasticGradient"], gradient)
                    observed_energy = vector([runtime[label]["energy"]], 1, label + "energy")[0]
                    item["energyAbsoluteErrorNJ"] = float(abs(F(observed_energy) - e))
                for coefficient_name, coefficient in (("nativeCoefficient", native_c), ("realMass", real_c)):
                    inertia = [c * (a - b) for c, a, b in zip(coefficient, points, target)]
                    residual = [a + b for a, b in zip(gradient, inertia)]
                    maximum = max(map(abs, residual))
                    item[coefficient_name] = {"inertiaGradient": list(map(float, inertia)), "residual": list(map(float, residual)),
                                             "residualInfinityMicroN": float(maximum), "passesUnchangedForceTolerance": maximum <= F(tolerance),
                                             "inertiaPotentialNJ": float(sum(c * (a - b) ** 2 / 2 for c, a, b in zip(coefficient, points, target)))}
                    if observed[label]["supplied"]:
                        item[coefficient_name]["residualError"] = errors(values[label + "Residual"], residual)
            if include_h:
                result["representedUVDisplacement"].update(exactHessian=list(map(float, exact)), gaussNewton=list(map(float, gn)))
            truths[label] = result
        projected_difference = [a - b for a, b in zip(latent, public)]
        energy_difference = exact_states["authoritative"][0] - exact_states["public"][0]
        gradient_difference = [a - b for a, b in zip(exact_states["authoritative"][1], exact_states["public"][1])]
        return {"schema": "pliego-membrane-state-precision/1", "decimalDigits": digits, "identity": IDENTITY,
                "initialization": initial_proof, "native": observed, "truth": truths,
                "projection": {"publicObjectIsVerified": True, "maximumLatentPublicDistanceMm": float(max(map(abs, projected_difference))),
                               "latentEqualsPublicRealState": all(x == 0 for x in projected_difference),
                               "representedLatentMinusPublicEnergyNJ": float(energy_difference),
                               "representedMaximumElasticGradientDifferenceMicroN": float(max(map(abs, gradient_difference)))},
                "forceToleranceMicroN": tolerance, "fixedForceScaleMicroN": force_scale,
                "fixedForceScaleVerification": "provided native initial modal F0 must be bound by capture; oracle verifies unchanged tau rule only",
                "targetValid": state.get("targetValid"),
                "forceInterpretation": "completed target; native gates checked" if state["targetValid"] else "mathematical residual only; invalid predictor target cannot certify a solve",
                "provenance": {**binding, "inputCaseSHA256": sha(canonical(case)), "stateSHA256": case["stateSHA256"],
                               "oracleSHA256": sha(Path(__file__).read_bytes()), "referenceOracleSHA256": sha(SOURCE.read_bytes()),
                               "referenceBindingSHA256": sha(REFERENCE.BINDING_SOURCE.read_bytes()),
                               "gradientHelperSHA256": sha(REFERENCE.HELPER_SOURCE.read_bytes()),
                               "energyHelperSHA256": sha(REFERENCE.HELPER.ENERGY_SOURCE.read_bytes()),
                               "tensorHelperSHA256": sha(REFERENCE.ENERGY.SOURCE.read_bytes())},
                "arithmetic": "exact Fraction q/K/X0/c/s/Q/volume and represented derivatives; exact rational UV metrics before Decimal material angle/Q for independent physical meanings",
                "scope": "separate exact latent/public physical states; native rounded coefficient vs realM/h²; unchanged public literal force gate, no trajectory/material/booklet/time acceptance"}


def self_test():
    u, v = [F(-1), F(1), F()], [F(-1), F(), F(1)]
    x0 = [[F(), F(), F()], [F(1), F(), F()], [F(), F(), F(-1)]]
    element = (u, v, x0, F(1), F(), list(map(F, [2, 1, .25, .5])), F(1))
    points = [[F(), F(), F()], [F(5, 4), F(), F()], [F(), F(), F(-3, 4)]]
    energy, gradient, exact, gn = direct_element(points, element, True)
    e1, e2 = F(9, 32), F(-7, 32)
    s1, s2 = 2 * e1 + e2 / 4, e1 / 4 + e2
    if energy != (2 * e1 ** 2 + e2 ** 2 + e1 * e2 / 2) / 2 or gradient[1][0] != F(5, 4) * s1 or gradient[2][2] != -F(3, 4) * s2:
        raise AssertionError("independent analytical finite Piola control failed")
    previous = None
    for h in (F(1, 8), F(1, 16), F(1, 32)):
        plus, minus = [p[:] for p in points], [p[:] for p in points]
        plus[1][0] += h
        minus[1][0] -= h
        ep = direct_element(plus, element)[0]
        em = direct_element(minus, element)[0]
        error = abs((ep - em) / (2 * h) - gradient[1][0])
        if previous is not None and error != previous / 4:
            raise AssertionError("exact rational scalar FD must halve quadratically")
        previous = error
    compressed = [[F(), F(), F()], [F(1, 2), F(), F()], [F(), F(), F(-1)]]
    _, _, eh, gh = direct_element(compressed, element, True)
    if not eh[4][4] < 0 or gh[4][4] != 0 or exact == gn:
        raise AssertionError("exact geometric curvature differs from GN PSD")
    return {"schema": "pliego-membrane-state-self-test/1", "passed": True, "testCases": 3,
            "checks": ["analytical finite Piola/energy", "exact rational scalar FD halving", "compressed exact curvature versus GN"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--digits", type=int, default=80)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test(), separators=(",", ":")))
        return
    raw = sys.stdin.buffer.read()
    value = json.loads(raw)
    cases = value["cases"] if isinstance(value, dict) and "cases" in value else [value]
    if not cases:
        raise ValueError("nonempty cases required")
    result = {"schema": "pliego-membrane-state-precision-batch/1", "cases": [evaluate(c, args.digits) for c in cases], "inputSHA256": sha(raw)}
    print(json.dumps(result, separators=(",", ":"), allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from None
