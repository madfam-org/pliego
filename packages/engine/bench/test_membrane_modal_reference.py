"""Independent modal-oracle tests; analytical eigensystems and BE, no engine."""

import contextlib
import copy
import importlib.util
import io
import json
import math
import re
import subprocess
import sys
import unittest
from pathlib import Path

SOURCE = Path(__file__).with_name("membrane-modal-reference.py")
SPEC = importlib.util.spec_from_file_location("membrane_modal_reference", SOURCE)
REFERENCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REFERENCE)
MATERIAL = {
    "E1": 5.5e9,
    "E2": 2.5e9,
    "nu12": 0.293,
    "G12": 0.387 * math.sqrt(5.5e9 * 2.5e9),
    "thickness": 0.1,
}
SUMMARY = {}


def patch(cells=2, angle=0, perturbed=False):
    vertices = []
    for j in range(cells + 1):
        for i in range(cells + 1):
            dx = (
                0.03 * math.sin(i + 2 * j)
                if perturbed and 0 < i < cells and 0 < j < cells
                else 0
            )
            dy = (
                0.04 * math.cos(2 * i - j)
                if perturbed and 0 < i < cells and 0 < j < cells
                else 0
            )
            vertices.append([40 * (i + dx) / cells, 40 * (j + dy) / cells])
    triangles = []
    for j in range(cells):
        for i in range(cells):
            a = j * (cells + 1) + i
            b, c, d = a + 1, a + cells + 2, a + cells + 1
            triangles.extend([[a, b, c], [a, c, d]])
    return {
        "material": copy.deepcopy(MATERIAL),
        "arealDensity": 80e-6,
        "angleDegrees": angle,
        "vertices": vertices,
        "triangles": triangles,
    }


class MembraneModalReferenceTests(unittest.TestCase):
    def test_analytical_two_by_two_spectra(self):
        for matrix in ([[2, 1], [1, 2]], [[0, 2], [2, 3]], [[0, 0], [0, 0]]):
            untouched = copy.deepcopy(matrix)
            values, _vectors, checks = REFERENCE.jacobi(matrix)
            a, b, d = matrix[0][0], matrix[0][1], matrix[1][1]
            discriminant = math.hypot(a - d, 2 * b)
            expected = [(a + d - discriminant) / 2, (a + d + discriminant) / 2]
            for actual, truth in zip(values, expected):
                self.assertAlmostEqual(actual, truth, places=13)
            self.assertTrue(checks["valid"])
            self.assertEqual(matrix, untouched)
        SUMMARY["analytical2x2IncludingZeroAndIndefinite"] = True

    def test_analytical_three_by_three_clusters_and_eigenspaces(self):
        basis = [
            [1 / math.sqrt(2), 1 / math.sqrt(2), 0],
            [-1 / math.sqrt(6), 1 / math.sqrt(6), 2 / math.sqrt(6)],
            [1 / math.sqrt(3), -1 / math.sqrt(3), 1 / math.sqrt(3)],
        ]
        for eigenvalues in ([1, 1, 4], [1, 1 + 1e-9, 4], [-3, 0, 7]):
            matrix = [
                [
                    sum(eigenvalues[k] * basis[k][i] * basis[k][j] for k in range(3))
                    for j in range(3)
                ]
                for i in range(3)
            ]
            values, vectors, checks = REFERENCE.jacobi(matrix)
            for value, truth in zip(values, eigenvalues):
                self.assertAlmostEqual(value, truth, places=13)
            # Clustered columns can rotate: the isolated spectral projector is
            # invariant, whereas claiming a particular repeated basis is false.
            last = [row[2] for row in vectors]
            for i in range(3):
                for j in range(3):
                    self.assertAlmostEqual(
                        last[i] * last[j], basis[2][i] * basis[2][j], places=13
                    )
            self.assertLess(checks["orthogonalityMaximum"], 1e-13)
        SUMMARY["analytical3x3RepeatedClusterAndProjector"] = True

    def test_jacobi_domains_and_nonconvergence(self):
        for matrix in (
            [],
            [[1, 0]],
            [[1, 1], [0, 1]],
            [[math.inf]],
            [[0] * 51 for _ in range(51)],
        ):
            with self.assertRaises(ValueError):
                REFERENCE.jacobi(matrix)
        with self.assertRaises(ValueError):
            REFERENCE.jacobi([[2, 1], [1, 2]], max_sweeps=0)
        with self.assertRaises(TypeError):
            REFERENCE.jacobi([[True]])
        SUMMARY["JacobiDomainAndNonconvergenceRejection"] = True

    def test_triangle_exact_mass_and_rigid_nullspace(self):
        case = patch()
        case.update(
            {
                "vertices": [[0, 0], [6, 0], [0, 4]],
                "triangles": [[0, 1, 2]],
                "arealDensity": 0.25,
                "includeMatrix": True,
            }
        )
        result = REFERENCE.solve(case)
        self.assertEqual(result["mass"], [1, 1, 1])
        self.assertEqual(result["area"], 12)
        self.assertEqual(result["totalMass"], 3)
        self.assertEqual(result["centerOfMass"], [2, 4 / 3])
        self.assertEqual(result["checks"]["nullCount"], 3)
        stiffness = result["matrix"]["stiffness"]
        for rigid in ([1, 0, 1, 0, 1, 0], [0, 1, 0, 1, 0, 1], [0, 0, 0, 6, -4, 0]):
            force = [math.fsum(k * u for k, u in zip(row, rigid)) for row in stiffness]
            self.assertLess(
                math.hypot(*force) / result["checks"]["frobeniusNorm"], 1e-14
            )
        SUMMARY["AnalyticalTriangleMassAndThreeFreeRigidModes"] = True

    def test_cells_two_four_native_mass_spectrum_and_full_basis(self):
        worst_residual = 0
        count = 0
        for cells, angle, perturbed in (
            (2, 0, False),
            (2, 30, True),
            (4, 0, False),
            (4, 45, True),
        ):
            case = patch(cells, angle, perturbed)
            case["includeMatrix"] = True
            result = REFERENCE.solve(case)
            self.assertTrue(result["valid"])
            self.assertAlmostEqual(result["totalMass"], 0.128, places=15)
            self.assertEqual(result["checks"]["nullCount"], 3)
            self.assertGreaterEqual(result["mode"]["relativeGap"], 1e-6)
            mode, masses = result["mode"], result["mass"]
            self.assertAlmostEqual(
                max(math.hypot(*p) for p in mode["phi"]), 1, places=15
            )
            self.assertGreater(
                mode["phi"][mode["signDof"] // 2][mode["signDof"] % 2], 0
            )
            self.assertAlmostEqual(
                mode["modalMass"],
                math.fsum(
                    m * sum(x * x for x in p) for m, p in zip(masses, mode["phi"])
                ),
                places=15,
            )
            phi = [x for p in mode["phi"] for x in p]
            stiffness = result["matrix"]["stiffness"]
            force = [math.fsum(k * u for k, u in zip(row, phi)) for row in stiffness]
            residual = math.hypot(
                *(
                    f - mode["eigenvalue"] * masses[i // 2] * phi[i]
                    for i, f in enumerate(force)
                )
            )
            relative = residual / math.hypot(*force)
            worst_residual = max(worst_residual, relative)
            self.assertLess(relative, 1e-10)
            basis = result["spectrum"]["massNormalizedModes"]
            self.assertEqual(len(basis), 2 * len(masses))
            for i, a in enumerate(basis):
                for j, b in enumerate(basis):
                    inner = math.fsum(
                        m * (p[0] * q[0] + p[1] * q[1]) for m, p, q in zip(masses, a, b)
                    )
                    self.assertAlmostEqual(inner, float(i == j), places=12)
            # Complete basis recovers an arbitrary nonmodal initial field,
            # including all translations/rotation rather than hiding them.
            field = [[math.sin(i + 1), math.cos(2 * i)] for i in range(len(masses))]
            coefficients = [
                math.fsum(
                    m * (p[0] * u[0] + p[1] * u[1]) for m, p, u in zip(masses, a, field)
                )
                for a in basis
            ]
            for i in range(len(masses)):
                for c in range(2):
                    recovered = math.fsum(
                        q * a[i][c] for q, a in zip(coefficients, basis)
                    )
                    self.assertAlmostEqual(recovered, field[i][c], places=12)
            count += 1
        SUMMARY["freeNativeMeshesChecked"] = count
        SUMMARY["maximumIndependentGeneralizedEigenResidual"] = worst_residual

    def test_mesh_material_density_and_disconnected_rejection(self):
        cases = []
        for key, value in (
            ("arealDensity", 0),
            ("vertices", [[0, 0]] * 26),
            ("triangles", [[0, 2, 1]]),
            ("triangles", []),
            ("angleDegrees", math.nan),
            ("vertices", [[0, 0, 0]] * 3),
        ):
            case = patch()
            case[key] = value
            cases.append(case)
        case = patch()
        case["material"]["nu12"] = 4
        cases.append(case)
        disconnected = patch()
        disconnected.update(
            {
                "vertices": [[0, 0], [1, 0], [0, 1], [3, 0], [4, 0], [3, 1]],
                "triangles": [[0, 1, 2], [3, 4, 5]],
            }
        )
        cases.append(disconnected)
        for case in cases:
            with self.assertRaises(ValueError):
                REFERENCE.solve(case)
        case = patch()
        case["arealDensity"] = True
        with self.assertRaises(TypeError):
            REFERENCE.solve(case)
        SUMMARY["NativeGeometryMaterialMassAndExtraNullModesRejected"] = True

    def test_backward_euler_exact_recurrence_energy_and_continuous_limit(self):
        omega, mass, amplitude = 7.3, 0.128, -0.004
        worst = 0
        for h in (0.013, 0.002):
            answer = REFERENCE.response(
                omega, mass, {"h": h, "steps": 80, "amplitude": amplitude}
            )
            q, v = amplitude, 0
            denominator = 1 + (omega * h) ** 2
            for sample in answer["samples"]:
                truth = sample["backwardEuler"]
                worst = max(
                    worst,
                    abs(q - truth["coordinate"]) / abs(amplitude),
                    abs(v - truth["velocity"]) / abs(amplitude * omega),
                )
                self.assertLess(abs(q - truth["coordinate"]), 1e-16)
                self.assertLess(abs(v - truth["velocity"]), 1e-15)
                energy = 0.5 * mass * (v * v + omega**2 * q * q)
                self.assertAlmostEqual(energy / truth["energy"], 1, places=12)
                continuous = sample["continuous"]
                self.assertAlmostEqual(
                    0.5
                    * mass
                    * (
                        continuous["velocity"] ** 2
                        + omega**2 * continuous["coordinate"] ** 2
                    )
                    / continuous["energy"],
                    1,
                    places=14,
                )
                q, v = (q + h * v) / denominator, (v - h * omega**2 * q) / denominator
        errors = []
        for n in (100, 200, 400):
            final = REFERENCE.response(
                omega, mass, {"h": 1 / n, "steps": n, "amplitude": amplitude}
            )["samples"][-1]
            errors.append(
                math.hypot(
                    (
                        final["backwardEuler"]["coordinate"]
                        - final["continuous"]["coordinate"]
                    )
                    / amplitude,
                    (
                        final["backwardEuler"]["velocity"]
                        - final["continuous"]["velocity"]
                    )
                    / (amplitude * omega),
                )
            )
        self.assertTrue(1.8 < errors[-2] / errors[-1] < 2.1)
        zero = REFERENCE.response(omega, mass, {"h": 0.1, "steps": 0, "amplitude": 0})
        self.assertEqual(zero["samples"][0]["backwardEuler"]["energy"], 0)
        # log(hypot(1,z)) rounds to zero here; log1p retains accumulated
        # damping instead of silently declaring energy preservation.
        tiny = REFERENCE.response(1, 1, {"h": 1e-8, "steps": 1000, "amplitude": 1})
        ratio = tiny["samples"][-1]["backwardEuler"]["energy"] / 0.5
        self.assertLess(ratio, 1)
        self.assertLess(abs(ratio - math.exp(-1000 * math.log1p(1e-16))), 3e-16)
        SUMMARY["MaximumClosedFormVersusBERecurrenceError"] = worst
        SUMMARY["BEFirstOrderFinalHalvingRatio"] = errors[-2] / errors[-1]

    def test_cli_batch_metadata_repeat_and_input_errors(self):
        original = "test_alpha ... ok\nRan 8 tests in 0.998s\nvalue=0.998\nOK\n"
        normalized = normalize_test_output(original)
        self.assertEqual(
            normalized,
            "test_alpha ... ok\nRan 8 tests (elapsed excluded)\nvalue=0.998\nOK\n",
        )
        case = patch()
        case["responses"] = [{"h": 1e-7, "steps": 2, "amplitude": 0.004}]
        payload = json.dumps({"cases": [case]})
        result = subprocess.run(
            [sys.executable, str(SOURCE)],
            input=payload,
            text=True,
            capture_output=True,
            check=True,
        )
        repeat = subprocess.run(
            [sys.executable, str(SOURCE)],
            input=payload,
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertEqual(result.stdout, repeat.stdout)
        parsed = json.loads(result.stdout)["cases"][0]
        self.assertNotIn("stiffness", parsed["matrix"])
        self.assertEqual(len(parsed["responses"][0]["samples"]), 3)
        for payload in (
            {"cases": []},
            {**case, "responses": [{"h": 0, "steps": 2, "amplitude": 1}]},
            {**case, "responses": [{"h": 0.1, "steps": True, "amplitude": 1}]},
        ):
            failed = subprocess.run(
                [sys.executable, str(SOURCE)],
                input=json.dumps(payload),
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(failed.returncode, 1)
            self.assertIn("error", json.loads(failed.stderr))
        SUMMARY["CLIBatchByteDeterminismAndDomainErrors"] = True


def normalize_test_output(output):
    return re.sub(
        r"^Ran (\d+) tests? in [0-9.]+s$",
        r"Ran \1 tests (elapsed excluded)",
        output,
        flags=re.MULTILINE,
    )


def run_self_validation():
    SUMMARY.clear()
    stream = io.StringIO()
    with contextlib.redirect_stdout(stream):
        result = unittest.TextTestRunner(stream=stream, verbosity=2).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(
                MembraneModalReferenceTests
            )
        )
    return {
        "schema": "pliego-membrane-modal-reference-self-test/1",
        "passed": result.wasSuccessful(),
        "testsRun": result.testsRun,
        "failures": len(result.failures),
        "errors": len(result.errors),
        "testCases": dict(SUMMARY),
        "output": normalize_test_output(stream.getvalue()),
    }


if __name__ == "__main__":
    proof = run_self_validation()
    print(json.dumps(proof, allow_nan=False, separators=(",", ":")))
    sys.exit(int(not proof["passed"]))
