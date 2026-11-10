"""Independent analytical/finite-difference verification of the 3D StVK oracle.

No engine, nodal strain-Jacobian/Hessian, or previous Python oracle imports.
Run directly or through orthotropic-reference.py --self-test.
"""

import contextlib
import copy
import importlib.util
import io
import json
import math
import random
import subprocess
import sys
import unittest
from pathlib import Path

SOURCE = Path(__file__).with_name("orthotropic-reference.py")
SPEC = importlib.util.spec_from_file_location("orthotropic_reference", SOURCE)
REFERENCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REFERENCE)
MATERIAL = {"E1": 5.5e9, "E2": 2.5e9, "nu12": .293,
            "G12": .387 * math.sqrt(5.5e9 * 2.5e9), "thickness": .1}
SUMMARY = {}


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def norm(rows):
    return math.sqrt(sum(x * x for row in rows for x in row))


def patch(n=3, irregular=False, skew=False):
    rng = random.Random(716)
    vertices, triangles = [], []
    for j in range(n + 1):
        for i in range(n + 1):
            u, v = 2.3 * i / n, 1.7 * j / n
            if irregular and 0 < i < n and 0 < j < n:
                u += .15 / n * (rng.random() - .5)
                v += .15 / n * (rng.random() - .5)
            vertices.append([u + .2 * v, v - .13 * u] if skew else [u, v])
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            b, c, d = a + 1, a + n + 2, a + n + 1
            triangles.extend([[a, b, d], [b, c, d]] if (i + j) % 2 else [[a, b, c], [a, c, d]])
    boundary = (list(range(n + 1)) + [j * (n + 1) + n for j in range(1, n + 1)]
                + [n * (n + 1) + i for i in range(n - 1, -1, -1)]
                + [j * (n + 1) for j in range(n - 1, 0, -1)])
    return vertices, triangles, boundary


def case_for(n=3, irregular=False, skew=False, angle=0, f=None):
    uv, triangles, boundary = patch(n, irregular, skew)
    f = f or [[1.02, .03], [.01, -.02], [-.04, -.98]]
    return {"material": dict(MATERIAL), "angleDegrees": angle, "vertices": uv,
            "triangles": triangles, "positions": [[dot(row, v) for row in f] for v in uv]}, boundary


def stresses_from_strain(material, e):
    # Solve the reciprocal 2x2 compliance directly, independently of oracle Q.
    a, b, d = 1 / material["E1"], -material["nu12"] / material["E1"], 1 / material["E2"]
    determinant = a * d - b * b
    return [(d * e[0] - b * e[1]) / determinant,
            (-b * e[0] + a * e[1]) / determinant, material["G12"] * e[2]]


def traction_gradient(case, boundary, first_piola):
    gradient = [[0.0] * 3 for _ in case["vertices"]]
    area = 0
    for k, i in enumerate(boundary):
        j = boundary[(k + 1) % len(boundary)]
        u, v = case["vertices"][i], case["vertices"][j]
        du, dv = v[0] - u[0], v[1] - u[1]
        for c in range(3):
            reaction = case["material"]["thickness"] * (first_piola[c][0] * dv - first_piola[c][1] * du) / 2
            gradient[i][c] += reaction
            gradient[j][c] += reaction
        area += (u[0] * v[1] - v[0] * u[1]) / 2
    return gradient, area


def affine_analytic(case, boundary, f):
    # Direct material tangent-vector contractions, not reference inverse/shape gradients.
    theta = math.radians(case["angleDegrees"])
    c, s = math.cos(theta), math.sin(theta)
    a = [row[0] * c + row[1] * s for row in f]
    b = [-row[0] * s + row[1] * c for row in f]
    strain = [(dot(a, a) - 1) / 2, (dot(b, b) - 1) / 2, dot(a, b)]
    stress = stresses_from_strain(case["material"], strain)
    pa = [stress[0] * a[i] + stress[2] * b[i] for i in range(3)]
    pb = [stress[2] * a[i] + stress[1] * b[i] for i in range(3)]
    p = [[c * pa[i] - s * pb[i], s * pa[i] + c * pb[i]] for i in range(3)]
    gradient, area = traction_gradient(case, boundary, p)
    energy = .5 * case["material"]["thickness"] * area * dot(strain, stress)
    return energy, gradient, area


def rotation(axis, angle):
    length = math.sqrt(dot(axis, axis))
    x, y, z = [v / length for v in axis]
    c, s, d = math.cos(angle), math.sin(angle), 1 - math.cos(angle)
    return [[c + x*x*d, x*y*d - z*s, x*z*d + y*s],
            [x*y*d + z*s, c + y*y*d, y*z*d - x*s],
            [x*z*d - y*s, y*z*d + x*s, c + z*z*d]]


class OrthotropicReferenceTests(unittest.TestCase):
    def test_affine_green_energy_piola_and_boundary_reactions(self):
        fields = [[[1.02, .03], [.01, -.02], [-.04, -.98]],
                  [[.92, .12], [.11, .25], [-.05, -1.03]],
                  [[1.08, -.07], [-.03, .04], [.09, -.91]]]
        worst_energy, worst_gradient, count = 0, 0, 0
        for n in (2, 4, 7):
            for irregular, skew in ((False, False), (True, False), (True, True)):
                for angle in (0, 30, 45, 90):
                    for f in fields:
                        case, boundary = case_for(n, irregular, skew, angle, f)
                        result = REFERENCE.evaluate(case)
                        energy, gradient, area = affine_analytic(case, boundary, f)
                        e = abs(result["energy"] - energy) / abs(energy)
                        g = norm([[a-b for a, b in zip(x, y)] for x, y in zip(result["gradient"], gradient)]) / norm(gradient)
                        worst_energy, worst_gradient = max(worst_energy, e), max(worst_gradient, g)
                        self.assertLessEqual(e, 1e-10)
                        self.assertLessEqual(g, 1e-10)
                        self.assertAlmostEqual(result["area"] / area, 1, places=13)
                        self.assertEqual(result["referencedVertices"], len(case["vertices"]))
                        self.assertEqual(result["unusedVertexIndices"], [])
                        count += 1
        SUMMARY.update(affineCases=count, maximumAffineEnergyRelativeError=worst_energy,
                       maximumAffineGradientRelativeError=worst_gradient, analyticTolerance=1e-10)
        print(f"orthotropic-reference-affine: {count} skew/perturbed/regular cases; analytical Green energy and Piola boundary reactions pass 1e-10")

    def test_nonlinear_nonaffine_coordinate_derivatives_with_halving(self):
        rng = random.Random(872)
        worst, families = 0, []
        for angle in (0, 30, 45, 90):
            case, _ = case_for(2, True, True, angle)
            for row in case["positions"]:
                for c in range(3):
                    row[c] += rng.uniform(-.03, .03)
            result = REFERENCE.evaluate(case)
            scale = norm(result["gradient"])
            errors = []
            for h in (1e-4, 5e-5, 2.5e-5):
                maximum = 0
                for i in range(len(case["positions"])):
                    for c in range(3):
                        value = case["positions"][i][c]
                        case["positions"][i][c] = value + h
                        positive = REFERENCE.evaluate(case)["energy"]
                        case["positions"][i][c] = value - h
                        negative = REFERENCE.evaluate(case)["energy"]
                        case["positions"][i][c] = value
                        error = abs((positive-negative)/(2*h)-result["gradient"][i][c]) / scale
                        maximum = max(maximum, error)
                errors.append(maximum)
            self.assertLess(errors[-1], 1e-7)
            self.assertLess(errors[-1], errors[0] * .15)
            worst = max(worst, errors[-1])
            families.append({"angleDegrees": angle, "steps": [1e-4, 5e-5, 2.5e-5], "maximumScaledErrors": errors})
        SUMMARY.update(coordinateFiniteDifferences=4*3*27, derivativeHalving=families, maximumFinestDerivativeScaledError=worst)
        print("orthotropic-reference-derivatives: 324 nonlinear nonaffine 3D coordinate differences; halving reduces truncation error")

    def test_rigid_objectivity_covariance_balance_and_moment(self):
        worst_energy, worst_gradient, worst_balance, worst_moment, count = 0, 0, 0, 0, 0
        for angle in (0, 30, 45, 90):
            case, _ = case_for(3, True, True, angle)
            for i, x in enumerate(case["positions"]):
                x[1] += .02 * math.sin(i * .4)
            base = REFERENCE.evaluate(case)
            for axis, radians in (([1, 2, 3], .73), ([1, -3, 2], 2.4), ([0, 1, 0], math.pi)):
                r = rotation(axis, radians)
                moved = copy.deepcopy(case)
                moved["positions"] = [[dot(row, x) + t for row, t in zip(r, [.7, -.4, .9])] for x in case["positions"]]
                actual = REFERENCE.evaluate(moved)
                expected_gradient = [[dot(row, g) for row in r] for g in base["gradient"]]
                e = abs(actual["energy"]-base["energy"]) / base["energy"]
                g = norm([[a-b for a, b in zip(x, y)] for x, y in zip(actual["gradient"], expected_gradient)]) / norm(expected_gradient)
                force = [[sum(row[c] for row in actual["gradient"]) for c in range(3)]]
                moment = [[sum(REFERENCE.cross(x, grad)[c] for x, grad in zip(moved["positions"], actual["gradient"])) for c in range(3)]]
                balance = norm(force) / norm(actual["gradient"])
                moment_error = norm(moment) / (norm(actual["gradient"]) * max(1, norm(moved["positions"])))
                for error in (e, g, balance, moment_error):
                    self.assertLess(error, 1e-10)
                worst_energy, worst_gradient = max(worst_energy, e), max(worst_gradient, g)
                worst_balance, worst_moment = max(worst_balance, balance), max(worst_moment, moment_error)
                count += 1
            rest, _ = case_for(3, True, True, angle, [[1, 0], [0, 0], [0, -1]])
            r = rotation([1, 1, -2], 2.6)
            rest["positions"] = [[dot(row, x) + shift for row, shift in zip(r, [.2, .1, -.6])] for x in rest["positions"]]
            result = REFERENCE.evaluate(rest)
            scale = MATERIAL["E1"] * MATERIAL["thickness"] * result["area"]
            self.assertLess(result["energy"] / scale, 1e-26)
            self.assertLess(norm(result["gradient"]) / scale, 1e-12)
        SUMMARY.update(rigidCovarianceCases=count, maximumRigidEnergyRelativeError=worst_energy,
                       maximumRigidGradientRelativeError=worst_gradient, maximumForceBalanceScaledError=worst_balance,
                       maximumMomentScaledError=worst_moment, finiteRigidRestCases=4)
        print("orthotropic-reference-objectivity: finite arbitrary-axis/180-degree rotations, translations, gradient covariance, force/moment balance and rotated stress-free sheets verified")

    def test_material_metric_orientation_and_scaling(self):
        case, _ = case_for(2, f=[[1.1, 0], [0, .8], [0, 0]])
        base = REFERENCE.evaluate(case)
        self.assertAlmostEqual(base["minPrincipalStretch"], .8, places=13)
        self.assertAlmostEqual(base["maxPrincipalStretch"], 1.1, places=13)
        for ratio in base["areaRatios"]:
            self.assertAlmostEqual(ratio, .88, places=13)
        flipped = copy.deepcopy(case)
        flipped["triangles"] = [list(reversed(t)) for t in case["triangles"]]
        reverse = REFERENCE.evaluate(flipped)
        self.assertLess(abs(reverse["energy"] / base["energy"] - 1), 1e-13)
        self.assertLess(norm([[a-b for a, b in zip(x, y)] for x, y in zip(reverse["gradient"], base["gradient"])]) / norm(base["gradient"]), 1e-13)
        for length in (1e-3, 1e3):
            scaled = copy.deepcopy(case)
            for field in ("vertices", "positions"):
                scaled[field] = [[length*v for v in row] for row in scaled[field]]
            actual = REFERENCE.evaluate(scaled)
            self.assertLess(abs(actual["energy"] / (base["energy"]*length**2) - 1), 1e-12)
            self.assertLess(norm([[a/length-b for a, b in zip(x, y)] for x, y in zip(actual["gradient"], base["gradient"])]) / norm(base["gradient"]), 1e-12)
        thick = copy.deepcopy(case)
        thick["material"]["thickness"] *= 3
        actual = REFERENCE.evaluate(thick)
        self.assertAlmostEqual(actual["energy"] / base["energy"], 3, places=12)
        unused = copy.deepcopy(case)
        unused["vertices"].append([10, 10]); unused["positions"].append([10, 0, -10])
        output = REFERENCE.evaluate(unused)
        self.assertEqual(output["unusedVertexIndices"], [len(case["vertices"])])
        SUMMARY.update(metricAndScalingChecked=True, orientationAndUnusedCountsChecked=True)
        print("orthotropic-reference-metric: known principal stretches/area ratios, CW/CCW, length/thickness scaling and unused counts verified")

    def test_small_strain_linear_cst_limit(self):
        errors = []
        for angle in (0, 30, 45, 90):
            case, boundary = case_for(3, True, True, angle)
            theta = math.radians(angle)
            c, s = math.cos(theta), math.sin(theta)
            e = [.7*c*c + .5*c*s - .2*s*s, .7*s*s - .5*c*s - .2*c*c,
                 2*(-.9*c*s + .25*(c*c-s*s))]
            stress = stresses_from_strain(MATERIAL, e)
            _, area = traction_gradient(case, boundary, [[0, 0]] * 3)
            linear = .5*MATERIAL["thickness"]*area*dot(e, stress)
            family = []
            for h in (1e-3, 5e-4, 2.5e-4, 1.25e-4):
                energies = []
                for sign in (1, -1):
                    value = copy.deepcopy(case)
                    value["positions"] = [[u + sign*h*(.7*u+.25*v), 0, -(v + sign*h*(.25*u-.2*v))] for u, v in case["vertices"]]
                    energies.append(REFERENCE.evaluate(value)["energy"])
                family.append(abs(sum(energies)/(2*h*h)-linear)/linear)
            self.assertLess(family[-1], 1e-7)
            self.assertLess(family[-1], family[0]*.03)
            errors.append({"angleDegrees": angle, "relativeEnergyErrors": family})
        SUMMARY["linearLimitHalving"] = errors
        print("orthotropic-reference-linear-limit: symmetric finite-Green energies approach independently computed linear CST energies at four grains under amplitude halving")

    def test_positive_material_and_invalid_domains(self):
        for nu in (-.7, 0, .293, 1.2):
            q, _, reciprocal = REFERENCE.material_matrix(dict(MATERIAL, nu12=nu))
            self.assertEqual(q[0][1], q[1][0])
            self.assertGreater(q[0][0]*q[1][1]-q[0][1]**2, 0)
            self.assertGreater(q[2][2], 0)
            self.assertEqual(reciprocal, nu*MATERIAL["E2"]/MATERIAL["E1"])
        base, _ = case_for(1)
        bad = []
        for name, value in (("E1", 0), ("E2", -1), ("G12", 0), ("thickness", -1), ("nu12", 2), ("E1", True), ("E2", math.inf)):
            case = copy.deepcopy(base); case["material"][name] = value; bad.append(case)
        for name, value in (("angleDegrees", math.nan), ("positions", [[0, 0, 0]]), ("positions", [[0, 0, math.inf]]*4), ("positions", [[i, 0, 0] for i in range(4)]),
                            ("triangles", []), ("triangles", [[0, 1, True]]), ("triangles", [[0, 1, 0]]),
                            ("triangles", [[0, 1, 9]]), ("triangles", [[0, 1, 2], [2, 1, 0]]),
                            ("vertices", [[i, 0] for i in range(4)]),
                            ("vertices", [[0, 0], [1, 0], [0, 1e-16], [1, 1e-16]]),
                            ("positions", [[0, 0, 0], [1, 0, 0], [0, 1e-15, 0], [1, 1e-15, 0]])):
            case = copy.deepcopy(base); case[name] = value; bad.append(case)
        case = copy.deepcopy(base)
        case["positions"] = [[1e-7*x for x in row] for row in case["positions"]]; bad.append(case)
        for case in bad:
            with self.assertRaises((ValueError, TypeError)):
                REFERENCE.evaluate(case)
        with self.assertRaises(ValueError):
            REFERENCE.dispatch({"cases": []})
        SUMMARY.update(materialCases=4, invalidCasesRejected=len(bad)+1)
        print(f"orthotropic-reference-domain: four reciprocal SPD materials; {len(bad)+1} invalid material/reference/current-collapse/count/index/batch cases rejected; no normal-sign rule")

    def test_cli_single_batch_and_error_contract(self):
        case, _ = case_for(1, angle=30)
        def run(value):
            return subprocess.run([sys.executable, str(SOURCE)], input=json.dumps(value), text=True, capture_output=True, check=False)
        single = run(case)
        self.assertEqual(single.returncode, 0, single.stderr)
        self.assertEqual(json.loads(single.stdout), REFERENCE.evaluate(case))
        batch = run({"cases": [case, case]})
        self.assertEqual(batch.returncode, 0, batch.stderr)
        self.assertEqual(json.loads(batch.stdout), {"cases": [REFERENCE.evaluate(case)]*2})
        invalid = run({"cases": []})
        self.assertEqual(invalid.returncode, 1)
        self.assertEqual(invalid.stdout, "")
        self.assertIn("error", json.loads(invalid.stderr))
        SUMMARY["cliSingleBatchAndErrorChecked"] = True
        print("orthotropic-reference-cli: deterministic single/batch results and JSON stderr/nonzero invalid-input contract verified")


def run_self_validation():
    SUMMARY.clear()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(OrthotropicReferenceTests)
    diagnostics, proof = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(proof):
        result = unittest.TextTestRunner(stream=diagnostics, verbosity=0).run(suite)
    return {"schema": "pliego-orthotropic-reference-self-test/0.1", "passed": result.wasSuccessful(),
            "testCases": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
            "checks": dict(SUMMARY), "readProof": proof.getvalue().splitlines(),
            "scope": "independent finite-Green 3D membrane matrix F/S/P oracle self-validation; no runtime/solver/paper calibration/path-injectivity claim",
            "diagnostics": diagnostics.getvalue().strip() if not result.wasSuccessful() else ""}


if __name__ == "__main__":
    result = run_self_validation()
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["passed"] else 1)
