"""Independent high-precision latent/public membrane + panel-bending state oracle.

Membrane truth is the planar reference-displacement oracle (membrane-state-precision.py),
imported, never copied: exact Fraction energy/gradient of the represented UV law at the latent
real sum q = X0 + u and at the public words x. This module adds the panel-bending truth
E_b = sum_h k_h (theta_h - rest_h)^2 / 2 and composes membrane + bending + inertia.

Bending truth per hinge h = (p0, p1 | w0, w1), from exact rational positions:
  e = p1 - p0, n0 = e x (w0 - p0), n1 = (p0 - p1) x (w1 - p1),
  S = e . (n1 x n0), R = n0 . n1 (both exact rationals), L = |e| (Decimal sqrt),
  theta = atan2(S / L, R)  (valley positive; equal to atan2(S, L R) since L > 0).
The gradient is NOT the closed form the engine uses: S, R and e.e are differentiated exactly by
forward-mode rational duals, then
  d theta = [(e.e) R dS - R S d(e.e)/2 - (e.e) S dR] / (L (S^2 + (e.e) R^2)),
the quotient rule of atan2(S/L, R); only the final 1/L and one division are Decimal.
The branch is the one nearest the World's continuation angle: the bound state key theta (World
theta after the step), which is what the engine's unwrap selects; a margin below 2^-20 rad refuses.
"""

import argparse
import hashlib
import importlib.util
import json
import math
import sys
from decimal import Decimal as D, ROUND_HALF_EVEN, getcontext, localcontext
from fractions import Fraction as F
from pathlib import Path

STATE_SOURCE = Path(__file__).with_name("membrane-state-precision.py")
SPEC = importlib.util.spec_from_file_location("bending_state_membrane", STATE_SOURCE)
STATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STATE)
BENDING_IDENTITY = {
    "name": "latent-panel-bending", "version": 2, "hinges": "panel-only", "restAngle": "flat",
    "geometry": "latent-sum-exact-differences-rounded-once", "curvature": "gauss-newton",
    "angleChange": "two-word-step-expansion-atan2", "damping": "none",
}
STATE_KEYS = ("x", "xs", "xt", "v", "u", "us", "ut", "x0", "mass", "h", "initialX", "initialU", "initialV")
GUARD = 12
BRANCH_MARGIN = D(2) ** -20
PRECISION_FIELDS = ["cases[].decimalDigits"]


def sha(value):
    return hashlib.sha256(value).hexdigest()


def dec(value):
    """Exact Fraction (or int) to Decimal, one correctly rounded division."""
    value = F(value)
    return D(value.numerator) / D(value.denominator)


# ---------------------------------------------------------------- Decimal arctangent
def atan_series(t):
    """Alternating Maclaurin series for |t| <= 1/8: terms shrink by >= 64x, so the first
    omitted term (< 10^-(prec+2) |t|) bounds the truncation error."""
    total, power, n, t2 = t, t, 1, t * t
    limit = abs(t) * D(10) ** -(getcontext().prec + 2)
    if not t:
        return t
    while True:
        power *= -t2
        n += 2
        term = power / n
        if abs(term) <= limit:
            return total
        total += term


def decimal_pi():
    """Machin: pi = 16 atan(1/5) - 4 atan(1/239); both arguments are <= 1/8."""
    return 16 * atan_series(D(1) / 5) - 4 * atan_series(D(1) / 239)


def atan(t, pi):
    """Argument reduction: t > 1 reflects to pi/2 - atan(1/t); then at most three half-angle steps
    t -> t / (1 + sqrt(1 + t^2)) bring 0 <= t <= 1 below tan(pi/32) < 1/8, and the result is
    multiplied back by 2^k <= 8. Each step costs a few units in the last guard digit, so with GUARD
    extra digits the relative error is below 10^-(prec - 2) for the caller's precision."""
    if t < 0:
        return -atan(-t, pi)
    if t > 1:
        return pi / 2 - atan(1 / t, pi)
    k = 0
    while t > D(1) / 8:
        t = t / (1 + (1 + t * t).sqrt())
        k += 1
    return (2 ** k) * atan_series(t)


def atan2(y, x, pi):
    """Principal value in (-pi, pi], same quadrant rules as IEEE atan2 for nonzero rationals."""
    if x == 0 and y == 0:
        raise ValueError("atan2(0, 0) is undefined: degenerate hinge")
    if x > 0:
        return atan(y / x, pi)
    if x == 0:
        return pi / 2 if y > 0 else -pi / 2
    return atan(y / x, pi) + (pi if y >= 0 else -pi)


# ---------------------------------------------------------------- exact rational forward duals
class Dual:
    __slots__ = ("value", "grad")

    def __init__(self, value, grad):
        self.value, self.grad = value, grad

    def __add__(self, other):
        return Dual(self.value + other.value, [a + b for a, b in zip(self.grad, other.grad)])

    def __sub__(self, other):
        return Dual(self.value - other.value, [a - b for a, b in zip(self.grad, other.grad)])

    def __mul__(self, other):
        return Dual(self.value * other.value, [self.value * b + other.value * a for a, b in zip(self.grad, other.grad)])


def sub3(a, b):
    return [x - y for x, y in zip(a, b)]


def cross3(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def dot3(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def hinge_angle(points, pi):
    """theta (Decimal) and d theta / d(p0, p1, w0, w1) (12 Decimals) from 12 exact rationals."""
    coords = [Dual(F(points[i]), [F(int(i == j)) for j in range(12)]) for i in range(12)]
    p0, p1, w0, w1 = (coords[3 * i:3 * i + 3] for i in range(4))
    e = sub3(p1, p0)
    n0, n1 = cross3(e, sub3(w0, p0)), cross3(sub3(p0, p1), sub3(w1, p1))
    s, r, ee = dot3(e, cross3(n1, n0)), dot3(n0, n1), dot3(e, e)
    if ee.value == 0 or dot3(n0, n0).value == 0 or dot3(n1, n1).value == 0:
        raise ValueError("degenerate hinge edge or wing")
    length = dec(ee.value).sqrt()
    theta = atan2(dec(s.value), length * dec(r.value), pi)
    den = s.value * s.value + ee.value * r.value * r.value
    gradient = [dec((ee.value * r.value * ds - r.value * s.value * de / 2 - ee.value * s.value * dr) / den) / length
                for ds, dr, de in zip(s.grad, r.grad, ee.grad)]
    return theta, gradient, {"S": s.value, "R": r.value}


def bending_truth(points, hinges, k, rest, prev, pi):
    """Energy, assembled gradient and per-hinge record at exact positions (list of Fractions)."""
    energy, gradient, records = D(0), [D(0)] * len(points), []
    for index, ids in enumerate(hinges):
        local = [points[3 * v + c] for v in ids for c in range(3)]
        raw, local_gradient, _ = hinge_angle(local, pi)
        turns = ((raw - dec(prev[index])) / (2 * pi)).to_integral_value(rounding=ROUND_HALF_EVEN)
        theta = raw - turns * 2 * pi
        margin = pi - abs(theta - dec(prev[index]))
        if margin < BRANCH_MARGIN:
            raise ValueError("hinge %d is within 2^-20 rad of a branch tie; continuation is ambiguous" % index)
        d = theta - dec(rest[index])
        energy += dec(k[index]) * d * d / 2
        lever = dec(k[index]) * d
        for i, v in enumerate(ids):
            for c in range(3):
                gradient[3 * v + c] += lever * local_gradient[3 * i + c]
        records.append({"theta": theta, "turns": int(turns), "margin": margin, "energy": dec(k[index]) * d * d / 2})
    return energy, gradient, records


# ---------------------------------------------------------------- comparisons
def compare(observed, truth):
    """observed: Fractions (binary64 words or exact differences); truth: Decimals."""
    differences = [abs(dec(a) - b) for a, b in zip(observed, truth)]
    largest, scale = max(differences, default=D(0)), max((abs(t) for t in truth), default=D(0))
    return {"maximumComponentMicroN": float(largest), "l2MicroN": float(sum(d * d for d in differences).sqrt()),
            "truthInfinityMicroN": float(scale), "normwiseRelative": float(largest / scale) if scale else None}


def scalar(observed, truth):
    difference = abs(dec(observed) - truth)
    return {"absoluteNJ": float(difference), "relative": float(difference / abs(truth)) if truth else None}


def membrane_case(case):
    """The planar oracle's input: state words only, no force tuples (they include bending)."""
    stripped = {k: v for k, v in case.items() if k not in ("bending", "runtime", "stateFloat64LE", "stateSHA256")}
    stripped["stateFloat64LE"] = {k: case["stateFloat64LE"][k] for k in STATE_KEYS}
    stripped["stateSHA256"] = {k: case["stateSHA256"][k] for k in STATE_KEYS}
    stripped["runtime"] = {k: case["runtime"][k] for k in ("fixedForceScale", "forceTolerance")}
    return stripped


def decode_all(case, n, hinges):
    state, runtime, bending = case["state"], case["runtime"], case["bending"]
    initial = state["initialization"]
    inputs = {k: STATE.vector(case[k], n, k) for k in ("x", "xs", "xt")}
    inputs.update({k: STATE.vector(state[k], n, k) for k in ("u", "us", "ut", "v", "x0")})
    inputs.update({"mass": STATE.vector(case["mass"], n // 3, "mass"), "h": STATE.vector([case["h"]], 1, "h"),
                   "initialX": STATE.vector(initial["x"], n, "initialX"), "initialU": STATE.vector(initial["u"], n, "initialU"),
                   "initialV": STATE.vector(initial["v"], n, "initialV"),
                   "hingeK": STATE.vector(bending["hingeK"], hinges, "hingeK"), "restTheta": STATE.vector(bending["restTheta"], hinges, "restTheta"),
                   "theta": STATE.vector(bending["theta"], hinges, "theta")})
    for prefix in ("public", "authoritative"):
        for k in ("elasticGradient", "inertiaGradient", "residual"):
            inputs[prefix + k[0].upper() + k[1:]] = STATE.vector(runtime[prefix][k], n, prefix + k)
    values = STATE.decode_states(case, inputs)
    return values, values["theta"]


def evaluate(case, digits=80):
    if type(digits) is not int or not 60 <= digits <= 100:
        raise ValueError("precision must be60..100 digits")
    planar = STATE.evaluate(membrane_case(case), digits)
    with localcontext() as context:
        context.prec = digits + GUARD
        pi = decimal_pi()
        state, runtime, bending = case["state"], case["runtime"], case["bending"]
        if not isinstance(state.get("bending"), dict) or state["bending"] != BENDING_IDENTITY:
            raise ValueError("explicit latent panel-bending identity required")
        hinges = bending["hinges"]
        vertex_count = len(case["vertices"])
        if not isinstance(hinges, list) or not hinges or any(
                not isinstance(ids, list) or len(ids) != 4 or len(set(ids)) != 4
                or any(type(i) is not int or not 0 <= i < vertex_count for i in ids) for ids in hinges):
            raise ValueError("hinges must be quadruples of distinct vertex ids")
        n = 3 * vertex_count
        values, prev = decode_all(case, n, len(hinges))
        if any(t != 0 for t in values["restTheta"]) or any(k < 0 for k in values["hingeK"]):
            raise ValueError("flat rest angles and nonnegative hinge stiffness required")
        origin, elements, _ = STATE.configuration(case, n)
        tolerance = F(runtime["forceTolerance"])
        h, mass = values["h"][0], values["mass"]
        native_c = [F(mass[i // 3] * (1 / (h * h))) for i in range(n)]
        real_c = [F(mass[i // 3]) / F(h) ** 2 for i in range(n)]
        meanings, angles = {}, {}
        for label, points, target, gate in (
            ("authoritative", [F(a) + F(b) for a, b in zip(origin, values["u"])], [F(a) + F(b) for a, b in zip(origin, values["ut"])], "converged"),
            ("public", list(map(F, values["x"])), list(map(F, values["xt"])), "literalForceGate"),
        ):
            observed = runtime[label]
            membrane_energy, membrane_gradient, _, _ = STATE.assemble(points, elements)
            bending_energy, bending_gradient, records = bending_truth(points, hinges, values["hingeK"], values["restTheta"], prev, pi)
            angles[label] = records
            elastic = [dec(m) + b for m, b in zip(membrane_gradient, bending_gradient)]
            elastic_words = list(map(F, values[label + "ElasticGradient"]))
            displacement = values["u"] if label == "authoritative" else values["x"]
            prediction = values["ut"] if label == "authoritative" else values["xt"]
            native_inertia = [float(c) * (a - b) for c, a, b in zip(native_c, displacement, prediction)]
            native = STATE.observed_gate(observed, values, label, native_inertia, float(tolerance), state["targetValid"])
            energy_word, bending_word = F(observed["energy"]), F(observed["bendingEnergy"])
            result = {
                "coordinates": "latent exact real sum X0+u, target X0+ut" if label == "authoritative" else "public binary64 words x, target xt",
                "native": native,
                "membrane": {"energyNJ": float(membrane_energy), "gradient": list(map(float, membrane_gradient)),
                             "impliedObservedEnergyError": scalar(energy_word - bending_word, dec(membrane_energy))},
                "bending": {"energyNJ": float(bending_energy), "observedEnergyNJ": float(bending_word),
                            "energyError": scalar(bending_word, bending_energy), "gradient": list(map(float, bending_gradient)),
                            "impliedGradientError": compare([w - m for w, m in zip(elastic_words, membrane_gradient)], bending_gradient),
                            "thetaRad": [float(r["theta"]) for r in records],
                            "maximumAbsoluteThetaRad": float(max(abs(r["theta"]) for r in records))},
                "elastic": {"energyNJ": float(dec(membrane_energy) + bending_energy), "observedEnergyNJ": float(energy_word),
                            "energyError": scalar(energy_word, dec(membrane_energy) + bending_energy),
                            "gradient": list(map(float, elastic)), "gradientError": compare(elastic_words, elastic)},
            }
            for name, coefficient in (("nativeCoefficient", native_c), ("realMass", real_c)):
                inertia = [c * (a - b) for c, a, b in zip(coefficient, points, target)]
                residual = [g + dec(i) for g, i in zip(elastic, inertia)]
                largest = max(map(abs, residual))
                result[name] = {"inertiaGradientError": compare(list(map(F, values[label + "InertiaGradient"])), list(map(dec, inertia))),
                                "residual": list(map(float, residual)), "residualError": compare(list(map(F, values[label + "Residual"])), residual),
                                "residualInfinityMicroN": float(largest), "passesUnchangedForceTolerance": largest <= dec(tolerance),
                                "residualInfinityOverTolerance": float(largest / dec(tolerance)),
                                "agreesWithNativeGate": (largest <= dec(tolerance)) == native[gate] if state["targetValid"] else None}
            meanings[label] = result
        continuation = {
            "source": bending["continuationSource"],
            "continuationAnglesRad": list(map(float, prev)),
            "branchTurns": {k: [r["turns"] for r in v] for k, v in angles.items()},
            "minimumBranchMarginRad": float(min(r["margin"] for v in angles.values() for r in v)),
            "maximumPublicTruthMinusContinuationRad": float(max(abs(r["theta"] - dec(p)) for r, p in zip(angles["public"], prev))),
            "maximumLatentTruthMinusContinuationRad": float(max(abs(r["theta"] - dec(p)) for r, p in zip(angles["authoritative"], prev))),
        }
        planar_summary = {"schema": planar["schema"], "initialization": planar["initialization"], "projection": planar["projection"],
                          "membraneEnergyNJ": {label: {meaning: item["energyNJ"] for meaning, item in truths.items()} for label, truths in planar["truth"].items()},
                          "provenance": planar["provenance"]}
        return {"schema": "pliego-bending-state-precision/1", "decimalDigits": digits, "selection": case.get("selection"),
                "identity": {k: state[k] for k in sorted(STATE.IDENTITY) + ["bending"]},
                "hinges": [{"vertices": ids, "kMicroNmmPerRad2": values["hingeK"][i], "restThetaRad": values["restTheta"][i]} for i, ids in enumerate(hinges)],
                "membranePlanar": planar_summary, "truth": meanings, "continuation": continuation,
                "forceToleranceMicroN": float(tolerance), "fixedForceScaleMicroN": runtime["fixedForceScale"], "targetValid": state["targetValid"],
                "forceInterpretation": "completed target; native gates checked" if state["targetValid"] else "mathematical residual only; invalid predictor target cannot certify a solve",
                "provenance": {"inputCaseSHA256": sha(STATE.canonical(case)), "stateSHA256": case["stateSHA256"],
                               "oracleSHA256": sha(Path(__file__).read_bytes()), "membraneStateOracleSHA256": sha(STATE_SOURCE.read_bytes())},
                "arithmetic": "exact Fraction membrane (planar oracle) and hinge polynomials S, R, |e|^2 with rational duals; Decimal sqrt/atan2/division at digits+%d guard" % GUARD,
                "scope": "separate exact latent/public states; membrane, bending and inertia truths; unchanged tau; no trajectory/material/booklet/time acceptance"}


def self_test():
    with localcontext() as context:
        context.prec = 80 + GUARD
        pi = decimal_pi()
        if abs(pi - D("3.14159265358979323846264338327950288419716939937510582097494459230781640628620899")) > D(10) ** -79:
            raise AssertionError("Machin pi")
        if abs(atan(D(1), pi) - pi / 4) > D(10) ** -85 or abs(atan2(D(-1), D(-1), pi) + 3 * pi / 4) > D(10) ** -85 or atan2(D(0), D(-1), pi) != pi:
            raise AssertionError("atan2 quadrants")
        for y, x in ((3, 7), (-2, 5), (5, -9), (-1, -1e-3), (1e-9, 1), (7, 0.25)):
            if abs(float(atan2(D(y), D(x), pi)) - math.atan2(y, x)) > 2 * math.ulp(math.atan2(y, x)):
                raise AssertionError("atan2 versus libm")
        # Valley-positive control: wings lifted by t toward +Y fold by 2 atan(t).
        for t in (F(1), F(1, 2), F(1, 1000)):
            points = [0, 0, 0, 1, 0, 0, F(1, 2), t, -1, F(1, 2), t, 1]
            theta, gradient, _ = hinge_angle(points, pi)
            if abs(theta - 2 * atan(dec(t), pi)) > D(10) ** -85 or abs(sum(gradient[0::3])) > D(10) ** -85:
                raise AssertionError("analytical valley-positive fold")
        # Generic 3D hinge: rational central differences converge quadratically; translation invariance.
        points = [F(1, 3), F(-1, 7), F(2, 5), F(23, 10), F(1, 9), F(-3, 4), F(1, 2), F(5, 3), F(-17, 10), F(9, 5), F(-2, 3), F(13, 10)]
        theta, gradient, _ = hinge_angle(points, pi)
        if any(abs(sum(gradient[c::3])) > D(10) ** -85 for c in range(3)):
            raise AssertionError("translation invariance of the dihedral gradient")
        for index in range(12):
            previous = None
            for step in (D(10) ** -6, D(10) ** -7):
                plus, minus = points[:], points[:]
                plus[index] += F(step)
                minus[index] -= F(step)
                error = abs((hinge_angle(plus, pi)[0] - hinge_angle(minus, pi)[0]) / (2 * step) - gradient[index])
                if previous is not None and not error <= previous / 50:
                    raise AssertionError("central differences must converge quadratically")
                previous = error
            if previous > D(10) ** -12:
                raise AssertionError("gradient differs from finite differences")
    return {"schema": "pliego-bending-state-self-test/1", "passed": True, "testCases": 4,
            "checks": ["Machin pi and atan2 quadrants", "atan2 versus libm to 2 ulp", "analytical valley-positive fold 2atan(t)", "rational central-difference convergence and translation invariance"]}


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
    result = {"schema": "pliego-bending-state-precision-batch/1", "precisionFields": PRECISION_FIELDS,
              "cases": [evaluate(c, args.digits) for c in cases], "inputSHA256": sha(raw)}
    print(json.dumps(result, separators=(",", ":"), allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from None
