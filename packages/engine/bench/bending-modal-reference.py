"""Independent linear bending reference for the panel-hinge law at the flat state.

Standard library only; no engine imports. Reads one JSON object on stdin holding the represented
binary64 words of a flat patch: UV vertices, triangles, hinge quadruples (p0, p1 | w0, w1), the
material bending harmonics, C_B, panelStiffness, the grain angle and the native lumped masses.
Every binary64 word is read as the exact rational it denotes.

At the flat state the out-of-plane (Y) stiffness of the discrete hinge law is K = sum_h k_h g_h g_h^T,
with g_h the linearized dihedral change per unit out-of-plane displacement. g_h is derived here from
piecewise-linear plate kinematics, as the jump of the out-of-plane slope across the hinge edge built
from barycentric gradients; it does not use the engine's dihedral formula. The stiffness
k_h = panelStiffness * C_B * D_eff(phi) * L^2 / (A1 + A2) is recomputed from the documented law, with
D_eff(phi) = max(a0 + 1.5 a2 cos 2phi + 6 a4 cos 4phi, 0.05 min(D11, D22)). With grain 0, cos 2phi and
cos 4phi are rational in the edge vector and L^2 cancels against |e|^2 in g g^T, so K is an exact
rational matrix. Rigid out-of-plane motions are checked to be exact null vectors.

The generalized eigenproblem K phi = lambda M phi (M = diag of native masses) is solved by cyclic
Jacobi rotations at the declared decimal precision. The selected mode is the lowest nonzero one,
scaled to maximum nodal magnitude 1. The time plan follows the membrane transient protocol:
S0 = ceil(omega / (60 z0)), h0 = 1 / (60 S0), N0 = ceil(2 pi / (omega h0)).

In-plane (membrane) motion decouples from Y at the flat state to first order, so this is a linear
comparator for the represented discrete law, not continuous plate theory and not the engine's
nonlinear trajectory.
"""

from __future__ import annotations

import json
import math
import sys
from decimal import ROUND_CEILING, Decimal, localcontext
from fractions import Fraction

SCHEMA = "pliego-bending-modal-reference/1"
DIGITS = 90
OFF_DIAGONAL_EXPONENT = -80


def exact(value) -> Fraction:
    """The exact rational a JSON binary64 number denotes."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"finite binary64 number required, got {value!r}")
    return Fraction(value)


def decimal(value: Fraction) -> Decimal:
    return Decimal(value.numerator) / Decimal(value.denominator)


def pi_decimal() -> Decimal:
    """Machin's formula at the current precision."""
    def arctan_inverse(x: int) -> Decimal:
        x2, term, total, n = x * x, Decimal(1) / x, Decimal(1) / x, 1
        while True:
            term /= x2
            n += 2
            delta = term / n
            if delta == 0:
                return total
            total += -delta if (n // 2) % 2 else delta

    return 4 * (4 * arctan_inverse(5) - arctan_inverse(239))


def barycentric_gradients(points):
    """Gradients of the three barycentric coordinates of a UV triangle (exact rationals)."""
    (x0, y0), (x1, y1), (x2, y2) = points
    twice = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
    if twice == 0:
        raise ValueError("degenerate triangle")
    return [((y1 - y2) / twice, (x2 - x1) / twice),
            ((y2 - y0) / twice, (x0 - x2) / twice),
            ((y0 - y1) / twice, (x1 - x0) / twice)], abs(twice) / 2


def hinge_data(uv, hinge, law):
    """Exact unnormalized slope-jump vector g~ and the rational factor k / |e|^2 of one hinge."""
    p0, p1, w0, w1 = hinge
    e = (uv[p1][0] - uv[p0][0], uv[p1][1] - uv[p0][1])
    length2 = e[0] * e[0] + e[1] * e[1]
    perp = (-e[1], e[0])
    # Orient the edge normal from the w0 side (triangle T0) into the w1 side (triangle T1).
    if (uv[w0][0] - uv[p0][0]) * perp[0] + (uv[w0][1] - uv[p0][1]) * perp[1] > 0:
        perp = (-perp[0], -perp[1])
    if (uv[w1][0] - uv[p0][0]) * perp[0] + (uv[w1][1] - uv[p0][1]) * perp[1] <= 0:
        raise ValueError("hinge wings are not on opposite sides of the edge")
    t0 = (p0, p1, w0)
    t1 = (p1, p0, w1)
    grad0, area0 = barycentric_gradients([uv[i] for i in t0])
    grad1, area1 = barycentric_gradients([uv[i] for i in t1])
    jump = {}
    for vertex, gradient in zip(t1, grad1):
        jump[vertex] = jump.get(vertex, Fraction(0)) + gradient[0] * perp[0] + gradient[1] * perp[1]
    for vertex, gradient in zip(t0, grad0):
        jump[vertex] = jump.get(vertex, Fraction(0)) - (gradient[0] * perp[0] + gradient[1] * perp[1])
    if sum(jump.values()) != 0:
        raise ValueError("slope jump is not translation invariant")
    # grain 0: cos(phi) = |-e_v| / L, phi between the machine direction and the curvature direction.
    cos2 = 2 * e[1] * e[1] / length2 - 1
    cos4 = 2 * cos2 * cos2 - 1
    a0, a2, a4 = law["harmonics"]
    raw = a0 + Fraction(3, 2) * a2 * cos2 + 6 * a4 * cos4
    floor = Fraction(1, 20) * min(law["D11"], law["D22"])
    d_eff = max(raw, floor)
    areas = area0 + area1
    k = law["panelStiffness"] * law["CB"] * d_eff * length2 / areas
    return {"jump": jump, "k": k, "kOverLength2": k / length2, "length2": length2, "areas": areas,
            "cos2phi": cos2, "cos4phi": cos4, "dEff": d_eff, "floorActive": raw < floor}


def jacobi(matrix, tolerance):
    """Cyclic Jacobi eigen-decomposition of a symmetric Decimal matrix."""
    n = len(matrix)
    a = [row[:] for row in matrix]
    v = [[Decimal(int(i == j)) for j in range(n)] for i in range(n)]
    for sweep in range(200):
        off = max((abs(a[i][j]) for i in range(n) for j in range(i + 1, n)), default=Decimal(0))
        if off <= tolerance:
            return [a[i][i] for i in range(n)], v, sweep
        for p in range(n):
            for q in range(p + 1, n):
                if a[p][q] == 0:
                    continue
                theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
                sign = 1 if theta >= 0 else -1
                t = sign / (abs(theta) + (theta * theta + 1).sqrt())
                c = 1 / (t * t + 1).sqrt()
                s = t * c
                for k in range(n):
                    akp, akq = a[k][p], a[k][q]
                    a[k][p], a[k][q] = c * akp - s * akq, s * akp + c * akq
                for k in range(n):
                    apk, aqk = a[p][k], a[q][k]
                    a[p][k], a[q][k] = c * apk - s * aqk, s * apk + c * aqk
                for k in range(n):
                    vkp, vkq = v[k][p], v[k][q]
                    v[k][p], v[k][q] = c * vkp - s * vkq, s * vkp + c * vkq
    raise RuntimeError("Jacobi did not converge")


def text(value: Decimal, digits: int = 40) -> str:
    return format(value, f".{digits}e")


def reference(data):
    if data.get("schema") != "pliego-bending-modal-reference-input/1":
        raise ValueError("unknown input schema")
    if data["grainDeg"] != 0:
        raise ValueError("this reference is exact only for grain 0")
    uv = [(exact(u), exact(v)) for u, v in data["vertices"]]
    n = len(uv)
    masses = [exact(m) for m in data["masses"]]
    if len(masses) != n or any(m <= 0 for m in masses):
        raise ValueError("one positive native mass per vertex required")
    law = {"harmonics": [exact(x) for x in data["material"]["dHarm"]], "D11": exact(data["material"]["D11"]),
           "D22": exact(data["material"]["D22"]), "CB": exact(data["CB"]), "panelStiffness": exact(data["panelStiffness"])}
    hinges = [tuple(h) for h in data["hinges"]]
    engine_k = [exact(k) for k in data["engineHingeK"]]
    if len(engine_k) != len(hinges):
        raise ValueError("one engine stiffness word per hinge required")

    stiffness = [[Fraction(0)] * n for _ in range(n)]
    records = []
    for index, hinge in enumerate(hinges):
        h = hinge_data(uv, hinge, law)
        for a, ga in h["jump"].items():
            for b, gb in h["jump"].items():
                stiffness[a][b] += h["kOverLength2"] * ga * gb
        relative = abs(engine_k[index] - h["k"]) / h["k"]
        records.append({"index": index, "vertices": list(hinge), "length2": str(h["length2"]), "areas": str(h["areas"]),
                        "cos2phi": str(h["cos2phi"]), "cos4phi": str(h["cos4phi"]), "dEff": str(h["dEff"]),
                        "floorActive": h["floorActive"], "k": str(h["k"]), "kBinary64": float(h["k"]),
                        "engineK": float(engine_k[index]), "engineRelativeDifference": float(relative)})

    rigid = {"translation": [Fraction(1)] * n, "rotationAboutU": [v for _, v in uv], "rotationAboutV": [u for u, _ in uv]}
    for name, field in rigid.items():
        if any(sum(stiffness[i][j] * field[j] for j in range(n)) != 0 for i in range(n)):
            raise ValueError(f"rigid motion {name} is not an exact null vector")
    symmetric = all(stiffness[i][j] == stiffness[j][i] for i in range(n) for j in range(n))
    if not symmetric:
        raise ValueError("stiffness is not symmetric")

    with localcontext() as context:
        context.prec = DIGITS
        root = [decimal(m).sqrt() for m in masses]
        scaled = [[decimal(stiffness[i][j]) / (root[i] * root[j]) for j in range(n)] for i in range(n)]
        scale = max(abs(x) for row in scaled for x in row)
        values, vectors, sweeps = jacobi(scaled, scale * Decimal(10) ** OFF_DIAGONAL_EXPONENT)
        order = sorted(range(n), key=lambda i: values[i])
        largest = max(abs(x) for x in values)
        zero = [i for i in order if abs(values[i]) <= largest * Decimal(10) ** -60]
        if len(zero) != 3:
            raise ValueError(f"expected three rigid modes, found {len(zero)}")
        nonzero = [i for i in order if i not in zero]
        modes = []
        for i in order:
            phi = [vectors[k][i] / root[k] for k in range(n)]
            peak = max(abs(x) for x in phi)
            lead = next(k for k in range(n) if abs(phi[k]) >= peak * (1 - Decimal(10) ** -60))
            sign = 1 if phi[lead] > 0 else -1
            phi = [sign * x / peak for x in phi]
            modal_mass = sum(decimal(masses[k]) * phi[k] * phi[k] for k in range(n))
            residual = max(abs(sum(decimal(stiffness[r][c]) * phi[c] for c in range(n)) - values[i] * decimal(masses[r]) * phi[r]) for r in range(n))
            modes.append({"lambda": values[i], "phi": phi, "modalMass": modal_mass, "residual": residual, "rigid": i in zero})
        selected = next(m for m in modes if not m["rigid"])
        following = modes[modes.index(selected) + 1]
        omega = selected["lambda"].sqrt()
        gap = following["lambda"] / selected["lambda"]
        if gap < Decimal("1.1"):
            raise ValueError("selected mode is not separated from the next one")
        pi = pi_decimal()
        z0 = Decimal(data["z0"])
        S0 = int((omega / (60 * z0)).to_integral_value(rounding=ROUND_CEILING))
        h0 = Decimal(1) / (60 * S0)
        N0 = int((2 * pi / (omega * h0)).to_integral_value(rounding=ROUND_CEILING))
        planMargins = {"S0": float(Decimal(S0) - omega / (60 * z0)), "N0": float(Decimal(N0) - 2 * pi / (omega * h0))}
        amplitude = decimal(exact(data["amplitude"]))
        force_scale = amplitude * selected["lambda"] * max(decimal(masses[k]) * abs(selected["phi"][k]) for k in range(n))
        orthogonality = max(abs(sum(decimal(masses[k]) * a["phi"][k] * b["phi"][k] for k in range(n))) / (a["modalMass"] * b["modalMass"]).sqrt()
                            for ai, a in enumerate(modes) for b in modes[ai + 1:] if not (a["rigid"] and b["rigid"]))
        return {
            "schema": SCHEMA,
            "digits": DIGITS,
            "law": "k = panelStiffness*C_B*D_eff(phi)*L^2/(A1+A2), D_eff = max(a0+1.5a2cos2phi+6a4cos4phi, 0.05min(D11,D22)); grain 0",
            "kinematics": "slope jump across the hinge edge from barycentric gradients of the piecewise-linear out-of-plane field",
            "hinges": records,
            "maximumEngineStiffnessRelativeDifference": max(r["engineRelativeDifference"] for r in records),
            "stiffness": [[str(x) for x in row] for row in stiffness],
            "checks": {"symmetric": symmetric, "rigidNullVectors": list(rigid), "jacobiSweeps": sweeps,
                       "maximumEigenResidual": float(max(m["residual"] / max(abs(m["lambda"]), Decimal(1)) for m in modes)),
                       "maximumModalOrthogonality": float(orthogonality)},
            "spectrum": [{"lambda": text(m["lambda"]), "lambdaBinary64": float(m["lambda"]), "rigid": m["rigid"],
                          "omegaBinary64": 0.0 if m["rigid"] else float(m["lambda"].sqrt()),
                          "phi": [text(x) for x in m["phi"]], "phiBinary64": [float(x) for x in m["phi"]],
                          "modalMassBinary64": float(m["modalMass"])} for m in modes],
            "mode": {"index": modes.index(selected), "lambda": text(selected["lambda"]), "omega": text(omega), "omegaBinary64": float(omega),
                     "phi": [text(x) for x in selected["phi"]], "phiBinary64": [float(x) for x in selected["phi"]],
                     "modalMass": text(selected["modalMass"]), "modalMassBinary64": float(selected["modalMass"]),
                     "nextLambdaRatio": float(gap), "frequencyHz": float(omega / (2 * pi))},
            "plan": {"z0": data["z0"], "S0": S0, "h0Binary64": float(h0), "N0": N0, "horizonSeconds": float(N0 * h0), "integerMargins": planMargins,
                     "rule": "S0=ceil(omega/(60 z0)), h0=1/(60 S0), N0=ceil(2 pi/(omega h0))"},
            "forceScale": {"value": text(force_scale), "binary64": float(force_scale),
                           "convention": "FIXED |A| omega^2 max_i(native mass_i |phi_i|), phi with maximum nodal magnitude 1"},
            "scope": "linear discrete-law comparator at the flat state; not continuous plate theory, material calibration or the nonlinear trajectory",
        }


def main():
    json.dump(reference(json.load(sys.stdin)), sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
