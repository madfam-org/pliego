"""Independent solved-CST oracle self-validation; stdlib only, no engine imports."""

import contextlib
import copy
import importlib.util
import io
import json
import math
import subprocess
import sys
import unittest
from pathlib import Path

SOURCE = Path(__file__).with_name("plane-stress-reference.py")
SPEC = importlib.util.spec_from_file_location("plane_stress_reference", SOURCE)
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


def patch(cells=2, pattern="forward", angle=0, boundary="clamped-left"):
    vertices, triangles = [], []
    step = 40 / cells
    for j in range(cells + 1):
        for i in range(cells + 1):
            du = dv = 0
            if pattern == "perturbed" and 0 < i < cells and 0 < j < cells:
                du = 0.04 * step * math.sin(1.3 * i + 1.7 * j)
                dv = 0.04 * step * math.cos(1.7 * i - 0.3 * j)
            vertices.append([i * step + du, j * step + dv])
    for j in range(cells):
        for i in range(cells):
            a = j * (cells + 1) + i
            b, c, d = a + 1, a + cells + 2, a + cells + 1
            triangles += (
                [[a, b, d], [b, c, d]]
                if pattern != "forward" and (i + j) % 2
                else [[a, b, c], [a, c, d]]
            )
    return {
        "material": copy.deepcopy(MATERIAL),
        "angleDegrees": angle,
        "vertices": vertices,
        "triangles": triangles,
        "loadScales": [1e-4, 5e-5, 2.5e-5],
        "boundary": boundary,
    }


class PlaneStressReferenceTests(unittest.TestCase):
    def test_known_partial_pivot_solve_and_singularity(self):
        matrix = [[0, 2, 1], [1, -2, -3], [2, 3, 1]]
        factor = REFERENCE.lu_factor(matrix)
        answer = REFERENCE.lu_solve(factor, [3, 0, 7])
        for actual, expected in zip(answer, [1, 2, -1]):
            self.assertAlmostEqual(actual, expected, places=13)
        self.assertNotEqual(factor["permutation"][0], 0)
        self.assertEqual(matrix, [[0, 2, 1], [1, -2, -3], [2, 3, 1]])
        for singular in ([[1, 2], [2, 4]], [[0, 0], [0, 0]], [[1, 0], [0, 1e-15]]):
            with self.assertRaises(ValueError):
                REFERENCE.lu_factor(singular)
        SUMMARY["pivotedSolveAndSingularity"] = True
        print(
            "plane-stress-reference-lu: known nontrivial row pivot solve agrees; singular and declared near-rank-deficient systems rejected"
        )

    def test_poisson_compatible_analytical_field_and_energy(self):
        worst = 0
        for cells in (2, 4, 8):
            for angle in (0, 90):
                case = patch(cells, "perturbed", angle, "poisson-compatible")
                result = REFERENCE.solve(case)
                self.assertTrue(result["valid"])
                self.assertEqual(len(result["fixedDofs"]), cells + 2)
                axial = MATERIAL["E1"] if angle == 0 else MATERIAL["E2"]
                for load in result["loads"]:
                    eta = load["eta"]
                    expected = [
                        [eta * MATERIAL["E1"] / axial * x, -eta * MATERIAL["nu12"] * y]
                        for x, y in case["vertices"]
                    ]
                    error = math.hypot(
                        *(
                            u - v
                            for a, b in zip(expected, load["displacement"])
                            for u, v in zip(a, b)
                        )
                    ) / math.hypot(*(v for p in expected for v in p))
                    worst = max(worst, error)
                    self.assertLess(error, 1e-11)
                    self.assertLess(load["nonAffineRelativeResidual"], 1e-11)
                    energy = (
                        0.5 * 1600 * MATERIAL["thickness"] * (eta * MATERIAL["E1"]) ** 2 / axial
                    )
                    self.assertLess(abs(load["energy"] / energy - 1), 1e-11)
        SUMMARY["analyticalPoissonMaximumRelativeFieldError"] = worst
        print(
            f"plane-stress-reference-poisson: aligned 0/90-degree analytical fields/energy on cells2/4/8; worst relative field error={worst}"
        )

    def test_clamped_nonaffine_all_orientations_and_triangle_families(self):
        count, minimum_nonaffine, worst_residual = 0, math.inf, 0
        for cells in (2, 4):
            for pattern in ("forward", "alternating", "perturbed"):
                for angle in (0, 30, 45, 90):
                    case = patch(cells, pattern, angle)
                    result = REFERENCE.solve(case)
                    self.assertTrue(result["valid"])
                    self.assertEqual(result["vertices"], (cells + 1) ** 2)
                    self.assertEqual(result["triangles"], 2 * cells * cells)
                    self.assertEqual(len(result["fixedDofs"]), 2 * (cells + 1))
                    self.assertAlmostEqual(result["area"], 1600, places=10)
                    self.assertEqual(result["matrix"]["factorizations"], 1)
                    self.assertEqual(result["matrix"]["normalizedSolves"], 1)
                    self.assertEqual(result["matrix"]["reusedLoadSolutions"], 3)
                    self.assertEqual(result["matrix"]["symmetryScaledError"], 0)
                    self.assertGreater(result["matrix"]["minimumScaledPivot"], REFERENCE.PIVOT_MIN)
                    for load in result["loads"]:
                        self.assertTrue(load["valid"])
                        self.assertLessEqual(load["residualInfinity"], load["forceTolerance"])
                        self.assertLess(load["forceBalanceScaled"], 1e-10)
                        self.assertLess(load["momentBalanceScaled"], 1e-10)
                        self.assertLess(load["energyWorkRelativeError"], 1e-10)
                        minimum_nonaffine = min(
                            minimum_nonaffine, load["nonAffineRelativeResidual"]
                        )
                        worst_residual = max(
                            worst_residual, load["residualInfinity"] / load["forceTolerance"]
                        )
                        for dof in result["fixedDofs"]:
                            self.assertEqual(load["displacement"][dof // 2][dof % 2], 0)
                        fixed = set(result["fixedDofs"])
                        for i in result["freeDofs"]:
                            self.assertNotIn(i, fixed)
                            self.assertEqual(load["reaction"][i // 2][i % 2], 0)
                    count += 1
        self.assertGreater(minimum_nonaffine, 1e-3)
        SUMMARY["clampedGeometries"] = count
        SUMMARY["clampedMinimumNonaffinity"] = minimum_nonaffine
        SUMMARY["worstResidualFractionOfTolerance"] = worst_residual
        print(
            f"plane-stress-reference-clamped: geometries={count}; actual solved non-affinity min={minimum_nonaffine}; worst free residual/tolerance={worst_residual}"
        )

    def test_zero_load_and_cached_linear_scaling(self):
        case = patch(4, "perturbed", 30)
        case["loadScales"] = [0, 1e-4, 5e-5, -1e-4]
        result = REFERENCE.solve(case)
        zero, first, half, negative = result["loads"]
        self.assertTrue(result["valid"])
        self.assertEqual(zero["energy"], 0)
        self.assertEqual(zero["externalWork"], 0)
        self.assertEqual(zero["residualInfinity"], 0)
        self.assertTrue(
            all(
                v == 0
                for field in ("displacement", "reaction", "force")
                for row in zero[field]
                for v in row
            )
        )
        for field in ("displacement", "reaction", "force"):
            for a, b, c in zip(first[field], half[field], negative[field]):
                for x, y, z in zip(a, b, c):
                    self.assertEqual(x / 2, y)
                    self.assertEqual(-x, z)
        self.assertEqual(first["energy"] / 4, half["energy"])
        self.assertEqual(first["energy"], negative["energy"])
        self.assertEqual(result["matrix"]["factorizations"], 1)
        self.assertEqual(result["matrix"]["normalizedSolves"], 1)
        SUMMARY["zeroSignedAndCachedLoadScaling"] = True
        print(
            "plane-stress-reference-scaling: zero/signed/halved displacement, force, reactions and quadratic energy agree; one stiffness factor and normalized solve reused"
        )

    def test_independent_element_energy_gradient_and_assembled_matrix(self):
        case = patch(2, "perturbed", 37)
        _m, _qm, q, _nu21 = REFERENCE.engineering_matrix(MATERIAL, 37)
        matrix, elements, _edges, _lumped = REFERENCE.assemble(
            case["vertices"], case["triangles"], q, MATERIAL["thickness"]
        )
        u = [0.001 * math.sin(0.31 * i + 0.17) for i in range(len(matrix))]
        energy, gradient = REFERENCE.element_observation(
            elements, q, MATERIAL["thickness"], u, len(case["vertices"])
        )
        ku = [math.fsum(a * b for a, b in zip(row, u)) for row in matrix]
        self.assertLess(math.hypot(*(a - b for a, b in zip(gradient, ku))) / math.hypot(*ku), 1e-13)
        self.assertLess(abs(energy - 0.5 * math.fsum(a * b for a, b in zip(u, ku))) / energy, 1e-13)
        h, fd = 1e-7, []
        for i in range(len(u)):
            a, b = u[:], u[:]
            a[i] += h
            b[i] -= h
            plus = REFERENCE.element_observation(
                elements, q, MATERIAL["thickness"], a, len(case["vertices"])
            )[0]
            minus = REFERENCE.element_observation(
                elements, q, MATERIAL["thickness"], b, len(case["vertices"])
            )[0]
            fd.append((plus - minus) / (2 * h))
        error = math.hypot(*(a - b for a, b in zip(fd, gradient))) / math.hypot(*gradient)
        self.assertLess(error, 1e-8)
        SUMMARY["elementGradientFiniteDifferenceRelativeError"] = error
        print(
            f"plane-stress-reference-energy: independent element energy/gradient match assembled K and finite differences; relative error={error}"
        )

    def test_boundary_load_and_reaction_bookkeeping(self):
        result = REFERENCE.solve(patch(4, "alternating", 45))
        self.assertEqual(len(result["rightBoundarySegments"]), 4)
        self.assertEqual(len(result["boundarySegments"]["left"]), 4)
        self.assertAlmostEqual(
            sum(r[0] for r in result["normalizedForce"]),
            40 * MATERIAL["thickness"] * MATERIAL["E1"],
        )
        self.assertTrue(all(r[1] == 0 for r in result["normalizedForce"]))
        load = result["loads"][0]
        support = [math.fsum(row[c] for row in load["reaction"]) for c in range(2)]
        self.assertLess(abs(support[0] + load["totalForce"][0]) / abs(support[0]), 1e-12)
        self.assertLess(abs(support[1]) / abs(support[0]), 1e-12)
        self.assertGreater(sum(abs(row[1]) for row in load["reaction"]), 1)
        SUMMARY["independentBoundaryLoadAndSupportBookkeeping"] = True
        print(
            "plane-stress-reference-boundary: all four sides covered; consistent nodal right traction; constrained-only support forces and reference-position moment balance verified"
        )

    def test_domains_and_false_affine_control_rejected(self):
        invalid = []
        case = patch()
        case["boundary"] = "unknown"
        invalid.append(case)
        case = patch(angle=30, boundary="poisson-compatible")
        invalid.append(case)
        case = patch()
        case["material"]["nu12"] = 2
        invalid.append(case)
        case = patch()
        case["material"]["E1"] = True
        invalid.append(case)
        case = patch()
        case["loadScales"] = [math.nan]
        invalid.append(case)
        case = patch()
        case["triangles"].append(case["triangles"][0])
        invalid.append(case)
        case = patch()
        case["triangles"][0] = list(reversed(case["triangles"][0]))
        invalid.append(case)
        case = patch()
        case["vertices"].append([17, 19])
        invalid.append(case)
        case = patch()
        case["triangles"].pop()
        invalid.append(case)
        case = patch()
        case["vertices"][0][0] = math.inf
        invalid.append(case)
        for case in invalid:
            with self.assertRaises((ValueError, TypeError, OverflowError)):
                REFERENCE.solve(case)
        self.assertGreaterEqual(len(invalid), 10)
        SUMMARY["rejectedDomainCases"] = len(invalid)
        print(
            f"plane-stress-reference-domain: invalid material, mesh, coverage, loads and off-axis false-affine control rejected; cases={len(invalid)}"
        )

    def test_cli_single_batch_determinism_and_nonzero_errors(self):
        case = patch(2, "alternating", 30)

        def call(value):
            return subprocess.run(
                [sys.executable, str(SOURCE)],
                input=json.dumps(value),
                text=True,
                capture_output=True,
                check=False,
            )

        single, repeat, batch = call(case), call(case), call({"cases": [case, case]})
        self.assertEqual(single.returncode, 0, single.stderr)
        self.assertEqual(single.stdout, repeat.stdout)
        self.assertEqual(json.loads(batch.stdout)["cases"], [json.loads(single.stdout)] * 2)
        invalid = call({"cases": [case, {"boundary": "bad"}]})
        self.assertNotEqual(invalid.returncode, 0)
        self.assertEqual(invalid.stdout, "")
        self.assertIn("error", json.loads(invalid.stderr))
        SUMMARY["cliSingleBatchDeterminismAndErrors"] = True
        print(
            "plane-stress-reference-cli: single/batch results replay exactly; invalid batch emits nonzero JSON error without partial stdout"
        )


def run_self_validation():
    SUMMARY.clear()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PlaneStressReferenceTests)
    diagnostics, proof = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(proof):
        result = unittest.TextTestRunner(stream=diagnostics, verbosity=0).run(suite)
    return {
        "schema": "pliego-plane-stress-reference-self-test/1",
        "passed": result.wasSuccessful(),
        "testCases": result.testsRun,
        "failures": len(result.failures),
        "errors": len(result.errors),
        "checks": dict(SUMMARY),
        "readProof": proof.getvalue().splitlines(),
        "diagnostics": diagnostics.getvalue().strip() if not result.wasSuccessful() else "",
        "scope": "independent stdlib solved CST linear BVP self-validation; no engine imports or physical-stock validation",
    }


if __name__ == "__main__":
    unittest.main(verbosity=2)
