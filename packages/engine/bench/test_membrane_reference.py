"""Self-verification of the independent reference, using unittest and stdlib only.

Run: python3 packages/engine/bench/test_membrane_reference.py
No engine code, spring laws, quadrature weights or solver imports.
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

SOURCE = Path(__file__).with_name("membrane-reference.py")
SPEC = importlib.util.spec_from_file_location("membrane_reference", SOURCE)
REFERENCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REFERENCE)
MATERIAL = {"E1": 5.5e9, "E2": 2.5e9, "nu12": 0.293,
            "G12": 0.387 * math.sqrt(5.5e9 * 2.5e9), "thickness": 0.1}
SUMMARY = {}


def matmul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(len(b)))
             for j in range(len(b[0]))] for i in range(len(a))]


def transpose(a):
    return list(map(list, zip(*a)))


def patch(nx=3, ny=2, perturbed=False, alternating=False):
    """Independent rectangular mesh with an explicit CCW boundary loop."""
    rng = random.Random(371)
    vertices, triangles = [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            x, y = 2.3 * i / nx, 1.7 * j / ny
            if perturbed and 0 < i < nx and 0 < j < ny:
                x += (rng.random() - 0.5) * 0.2 / nx
                y += (rng.random() - 0.5) * 0.2 / ny
            vertices.append([x, y])
    for j in range(ny):
        for i in range(nx):
            a, b = j * (nx + 1) + i, j * (nx + 1) + i + 1
            c, d = a + nx + 1, b + nx + 1
            triangles.extend([[a, b, c], [b, d, c]] if alternating and (i + j) % 2
                             else [[a, b, d], [a, d, c]])
    boundary = (list(range(nx + 1)) + [j * (nx + 1) + nx for j in range(1, ny + 1)]
                + [ny * (nx + 1) + i for i in range(nx - 1, -1, -1)]
                + [j * (nx + 1) for j in range(ny - 1, 0, -1)])
    return vertices, triangles, boundary


def case_for(vertices, triangles, affine, angle=0, translation=(0, 0)):
    return {"material": dict(MATERIAL), "angleDegrees": angle,
            "vertices": vertices, "triangles": triangles,
            "displacement": [[sum(affine[i][k] * xy[k] for k in range(2)) + translation[i]
                              for i in range(2)] for xy in vertices]}


def analytic(case, affine, boundary):
    """Global affine energy and boundary traction, without FE shape gradients.

    Uses full 2x2 matrix rotations, independently of production scalar formulas.
    The constant stress follows the declared compliance via its 2x2 inverse.
    """
    m = case["material"]
    theta = math.radians(case["angleDegrees"])
    rotation = [[math.cos(theta), -math.sin(theta)], [math.sin(theta), math.cos(theta)]]
    strain = [[(affine[i][j] + affine[j][i]) / 2 for j in range(2)] for i in range(2)]
    em = matmul(matmul(transpose(rotation), strain), rotation)
    compliance_det = 1 / (m["E1"] * m["E2"]) - (m["nu12"] / m["E1"]) ** 2
    s11 = (em[0][0] / m["E2"] + em[1][1] * m["nu12"] / m["E1"]) / compliance_det
    s22 = (em[1][1] / m["E1"] + em[0][0] * m["nu12"] / m["E1"]) / compliance_det
    s12 = 2 * m["G12"] * em[0][1]
    stress = matmul(matmul(rotation, [[s11, s12], [s12, s22]]), transpose(rotation))
    vertices, thickness = case["vertices"], m["thickness"]
    area = 0
    gradient = [[0.0, 0.0] for _ in vertices]
    for k, a in enumerate(boundary):
        b = boundary[(k + 1) % len(boundary)]
        dx, dy = vertices[b][0] - vertices[a][0], vertices[b][1] - vertices[a][1]
        # Outward unit normal times edge length on a CCW boundary is [dy,-dx].
        traction = [thickness * (row[0] * dy - row[1] * dx) / 2 for row in stress]
        for v in (a, b):
            for i in range(2):
                gradient[v][i] += traction[i]
        area += (vertices[a][0] * vertices[b][1] - vertices[b][0] * vertices[a][1]) / 2
    energy = 0.5 * thickness * area * sum(strain[i][j] * stress[i][j]
                                         for i in range(2) for j in range(2))
    return energy, gradient, area


class MembraneReferenceTests(unittest.TestCase):
    def assert_scaled(self, measured, expected, scale, tolerance=1e-10):
        SUMMARY["maxAnalyticScaledError"] = max(SUMMARY.get("maxAnalyticScaledError", 0),
                                                  abs(measured - expected) / scale)
        self.assertLessEqual(abs(measured - expected), tolerance * scale,
                             f"{measured} != {expected}, scale={scale}, tol={tolerance}")

    def test_affine_energy_gradient_rotations_and_meshes(self):
        rng = random.Random(716)
        fields = [[[rng.uniform(-0.003, 0.003) for _ in range(2)] for _ in range(2)]
                  for _ in range(4)]
        cases = 0
        for n in (2, 4, 7):
            for irregular in (False, True):
                vertices, triangles, boundary = patch(n, n, irregular, irregular)
                for angle in (0, 17, 30, 45, 90, -63):
                    for field in fields:
                        case = case_for(vertices, triangles, field, angle, (0.01, -0.02))
                        actual = REFERENCE.evaluate(case)
                        energy, gradient, area = analytic(case, field, boundary)
                        self.assert_scaled(actual["energy"], energy, abs(energy))
                        force_scale = max(abs(v) for row in gradient for v in row)
                        for ga, ge in zip(actual["gradient"], gradient):
                            for a, e in zip(ga, ge):
                                self.assert_scaled(a, e, force_scale)
                        self.assert_scaled(actual["area"], area, area)
                        self.assertEqual(actual["referencedVertices"], len(vertices))
                        self.assertEqual(actual["vertices"], len(vertices))
                        self.assertEqual(actual["triangles"], len(triangles))
                        self.assertEqual(actual["unusedVertexIndices"], [])
                        cases += 1
        SUMMARY["affineCases"] = cases
        SUMMARY["analyticScaledTolerance"] = 1e-10
        print(f"membrane-reference-affine: {cases} cases; analytic energy/boundary traction and interior zero force within scaled 1e-10; counts complete")

    def test_material_compliance_reciprocity_symmetry_and_positive_definiteness(self):
        for nu in (-0.7, 0, 0.293, 1.2):
            material = dict(MATERIAL, nu12=nu)
            q, _, nu21 = REFERENCE.material_matrix(material)
            compliance = [[1 / material["E1"], -nu / material["E1"], 0],
                          [-nu21 / material["E2"], 1 / material["E2"], 0],
                          [0, 0, 1 / material["G12"]]]
            identity = matmul(q, compliance)
            for i in range(3):
                for j in range(3):
                    self.assert_scaled(identity[i][j], 1 if i == j else 0, 1)
                    self.assertEqual(q[i][j], q[j][i])
            self.assertGreater(q[0][0], 0)
            self.assertGreater(q[0][0] * q[1][1] - q[0][1] ** 2, 0)
            self.assertGreater(q[2][2], 0)
        SUMMARY["materialCases"] = 4
        print("membrane-reference-material: reciprocal compliance inverse, Q symmetry and positive principal minors verified; declared nu12 convention")

    def test_rigid_modes_shear_factor_orientation_and_unused_counts(self):
        vertices, triangles, _ = patch(4, 3, True, True)
        for field, translation in (([[0, 0], [0, 0]], (0, 0)),
                                   ([[0, 0], [0, 0]], (0.125, -0.25)),
                                   ([[0, -0.0001], [0.0001, 0]], (0, 0))):
            case = case_for(vertices, triangles, field, 39, translation)
            actual = REFERENCE.evaluate(case)
            # Explicit absolute floor from E*t*A and displacement-gradient scale.
            scale = MATERIAL["E1"] * MATERIAL["thickness"] * actual["area"]
            self.assertLessEqual(actual["energy"], 1e-28 * scale)
            self.assertLessEqual(max(abs(v) for row in actual["gradient"] for v in row), 1e-14 * scale)
        gamma = 0.002
        case = case_for(vertices, triangles, [[0, gamma / 2], [gamma / 2, 0]])
        actual = REFERENCE.evaluate(case)
        expected = 0.5 * MATERIAL["thickness"] * actual["area"] * MATERIAL["G12"] * gamma ** 2
        self.assert_scaled(actual["energy"], expected, expected)
        flipped = copy.deepcopy(case)
        flipped["triangles"] = [list(reversed(t)) for t in triangles]
        reverse = REFERENCE.evaluate(flipped)
        self.assert_scaled(reverse["energy"], actual["energy"], expected)
        for a, b in zip(reverse["gradient"], actual["gradient"]):
            for aa, bb in zip(a, b):
                self.assert_scaled(aa, bb, MATERIAL["G12"] * gamma * MATERIAL["thickness"])
        case["vertices"].append([10, 10])
        case["displacement"].append([0, 0])
        unused = REFERENCE.evaluate(case)
        self.assertEqual(unused["unusedVertexIndices"], [len(vertices) - 1])
        self.assertEqual(unused["gradient"][-1], [0, 0])
        SUMMARY["rigidModeCases"] = 3
        SUMMARY["engineeringShearAndOrientationChecked"] = True
        print("membrane-reference-modes: zero/translation/infinitesimal rotation, engineering shear factor, CW/CCW and explicit unused-node counts verified")

    def test_analytic_gradient_by_independent_finite_differences(self):
        vertices, triangles, _ = patch(2, 2, True, True)
        rng = random.Random(910)
        case = case_for(vertices, triangles, [[0, 0], [0, 0]], 31)
        case["displacement"] = [[rng.uniform(-0.002, 0.002) for _ in range(2)] for _ in vertices]
        actual = REFERENCE.evaluate(case)
        scale = max(abs(v) for row in actual["gradient"] for v in row)
        max_error = 0
        for i in range(len(vertices)):
            for component in range(2):
                before = case["displacement"][i][component]
                h = 1e-6
                case["displacement"][i][component] = before + h
                plus = REFERENCE.evaluate(case)["energy"]
                case["displacement"][i][component] = before - h
                minus = REFERENCE.evaluate(case)["energy"]
                case["displacement"][i][component] = before
                derivative = (plus - minus) / (2 * h)
                error = abs(derivative - actual["gradient"][i][component]) / scale
                max_error = max(max_error, error)
                self.assertLessEqual(error, 1e-9)
        SUMMARY["coordinateFiniteDifferences"] = 2 * len(vertices)
        SUMMARY["maxDerivativeScaledError"] = max_error
        SUMMARY["derivativeScaledTolerance"] = 1e-9
        print(f"membrane-reference-derivative: {2 * len(vertices)} independent coordinate differences; analytic gradient maximum scaled error={max_error:.3g} <=1e-9")

    def test_invalid_domain_rejected(self):
        vertices, triangles, _ = patch(1, 1)
        base = case_for(vertices, triangles, [[0.001, 0], [0, 0]])
        bad = []
        for key, value in (("E1", 0), ("E2", -1), ("G12", 0), ("thickness", -0.1),
                           ("nu12", 2), ("E1", True), ("E2", math.inf), ("G12", math.nan)):
            c = copy.deepcopy(base)
            c["material"][key] = value
            bad.append(c)
        for key, value in (("angleDegrees", math.inf), ("vertices", [[0, 0], [1, 0], [2, 0], [3, 0]]),
                           ("displacement", [[0, 0]]), ("triangles", []),
                           ("triangles", [[0, 1, 1]]), ("triangles", [[0, 1, -1]]),
                           ("triangles", [[0, 1, 0.5]]), ("triangles", [[0, 1, True]]),
                           ("triangles", [[0, 1, 9]]), ("triangles", [[0, 1, 2], [2, 0, 1]]),
                           ("vertices", [[0, 0], [1, 0], [2, 1e-16], [3, 0]])):
            c = copy.deepcopy(base)
            c[key] = value
            bad.append(c)
        for c in bad:
            with self.assertRaises((TypeError, ValueError)):
                REFERENCE.evaluate(c)
        with self.assertRaises(ValueError):
            REFERENCE.dispatch({"cases": []})
        SUMMARY["invalidCasesRejected"] = len(bad) + 1
        print(f"membrane-reference-domain: {len(bad) + 1} invalid material/geometry/index/count/batch inputs rejected")

    def test_cli_single_batch_and_error_contract(self):
        vertices, triangles, _ = patch(1, 1)
        case = case_for(vertices, triangles, [[0.001, 0.002], [-0.001, 0.0002]], 28)
        def run(value):
            return subprocess.run([sys.executable, str(SOURCE)], input=json.dumps(value),
                                  text=True, capture_output=True, check=False)
        one = run(case)
        self.assertEqual(one.returncode, 0, one.stderr)
        self.assertEqual(json.loads(one.stdout), REFERENCE.evaluate(case))
        batch = run({"cases": [case, case]})
        self.assertEqual(batch.returncode, 0, batch.stderr)
        self.assertEqual(json.loads(batch.stdout), {"cases": [REFERENCE.evaluate(case)] * 2})
        invalid = run({"cases": []})
        self.assertEqual(invalid.returncode, 1)
        self.assertEqual(invalid.stdout, "")
        self.assertIn("error", json.loads(invalid.stderr))
        SUMMARY["cliSingleBatchAndErrorChecked"] = True
        print("membrane-reference-cli: single/batch results deterministic and identical; invalid input nonzero with JSON stderr, no partial stdout")


def run_self_validation():
    """Machine-readable proof from the actual analytical/FD test suite."""
    SUMMARY.clear()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(MembraneReferenceTests)
    diagnostics, proof = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(proof):
        result = unittest.TextTestRunner(stream=diagnostics, verbosity=0).run(suite)
    return {"schema": "pliego-membrane-reference-self-test/0.1", "passed": result.wasSuccessful(),
            "testCases": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
            "checks": dict(SUMMARY), "readProof": proof.getvalue().splitlines(),
            "scope": "independent CST/analytic affine energy and boundary traction, derivative finite differences, rigid/shear/domain/CLI self-verification; no engine or physical-stock validation",
            "diagnostics": diagnostics.getvalue().strip() if not result.wasSuccessful() else ""}


if __name__ == "__main__":
    unittest.main(verbosity=2)
