"""Fixed-pose transient Decimal diagnostic proofs, no engine imports or solves."""

import base64
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import math
import re
import struct
import subprocess
import sys
import tempfile
import unittest
from decimal import Decimal, localcontext
from pathlib import Path

SOURCE = Path(__file__).with_name("membrane-modal-precision.py")
SPEC = importlib.util.spec_from_file_location("membrane_modal_precision", SOURCE)
REFERENCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REFERENCE)
SELECTION = {
    "cells": 1,
    "pattern": "forward",
    "grain": 0,
    "level": 1,
    "budget": 4,
    "seed": False,
    "amplitude": 0.5,
    "snapshot": "worst-force",
}
SUMMARY = {}


def fixture(h=0.5, byte_order="LE"):
    # Unit-thickness isotropic nu0 triangle, exact finite stretch lambda=5/4.
    # Green strain=9/32, Piola=45/16, boundary nodal force +/-45/16.
    x = [0.0, 0.0, 0.0, 2.5, 0.0, 0.0, 0.0, 0.0, -2.0]
    gradient = [-2.8125, 0.0, 0.0, 2.8125, 0.0, 0.0, 0.0, 0.0, 0.0]
    xt = [a + h * h * g for a, g in zip(x, gradient)]
    state = {
        "x": x,
        # Turning-point fixture: current v=(x-xs)/h=0, prior velocity
        # (xt-xs)/h balances the exact finite-strain restoring force.
        "xs": x[:],
        "xt": xt,
        "v": [0.0] * 9,
    }
    inertia = [(1 / (h * h)) * (a - b) for a, b in zip(x, xt)]
    residual = [g + i for g, i in zip(gradient, inertia)]
    maximum = max(map(abs, residual))
    observation = {
        **state,
        "initial": False,
        "targetValid": True,
        "step": 3,
        "h": h,
        "forceTolerance": 1e-7,
        "elasticGradient": gradient,
        "inertiaGradient": inertia,
        "residual": residual,
        "residualInfinity": maximum,
        "literalForceGate": maximum <= 1e-7,
        "rawSHA256": {
            k: hashlib.sha256(
                struct.pack(("<" if byte_order == "LE" else ">") + "9d", *a)
            ).hexdigest()
            for k, a in state.items()
        },
    }
    snapshot = {
        "observation": observation,
        "stateFloat64LE": {
            k: base64.b64encode(struct.pack("<9d", *a)).decode()
            for k, a in state.items()
        },
    }
    row = {
        "geometry": {k: SELECTION[k] for k in ("cells", "pattern", "grain")},
        "vertices": [[0, 0], [2, 0], [0, 2]],
        "triangles": [[0, 1, 2]],
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
        "trajectories": [
            {
                **{k: SELECTION[k] for k in ("level", "budget", "seed", "amplitude")},
                "h": h,
                "forceTolerance": 1e-7,
                "runtime": {"massProof": {"native": [1.0, 1.0, 1.0]}},
                "snapshots": {"worst-force": snapshot},
            }
        ],
    }
    return {
        "runtime": {"byteOrder": byte_order},
        "source": {"git": "fixture-only"},
        "results": [row],
    }


def snapshot(report):
    return report["results"][0]["trajectories"][0]["snapshots"]["worst-force"]


class ModalPrecisionTests(unittest.TestCase):
    def test_analytic_finite_strain_dynamic_equilibrium(self):
        result = REFERENCE.evaluate(fixture(), SELECTION)
        for name in (
            "independentExactUVMaterial",
            "storedCoefficientPolynomial",
            "runtimeRecorded",
        ):
            self.assertEqual(result["summary"][name]["residualInfinityMicroN"], 0)
            self.assertTrue(result["summary"][name]["passesUnchangedForceGate"])
        gradient = result["highPrecisionFields"]["independentExactUVMaterial"][
            "elasticGradient"
        ]
        self.assertEqual(gradient, [-2.8125, 0, 0, 2.8125, 0, 0, 0, 0, 0])
        self.assertEqual(result["maximumRuntimeTermErrorsMicroN"]["inertia"], 0)
        SUMMARY["analyticalFiniteStretchPiolaBalancedByRealInertia"] = True

    def test_represented_small_h_failed_pose_retains_literal_gate(self):
        report = fixture(h=1e-5)
        result = REFERENCE.evaluate(report, SELECTION, 80)
        observed = snapshot(report)["observation"]
        with localcontext() as context:
            context.prec = 100
            d = Decimal.from_float
            exact_residual = d(2.8125) + (
                d(observed["x"][3]) - d(observed["xt"][3])
            ) / (d(1e-5) ** 2)
        self.assertGreater(abs(exact_residual), Decimal.from_float(1e-7))
        self.assertEqual(
            result["highPrecisionFields"]["independentExactUVMaterial"]["residual"][3],
            float(exact_residual),
        )
        self.assertFalse(
            result["summary"]["independentExactUVMaterial"]["passesUnchangedForceGate"]
        )
        self.assertFalse(
            result["summary"]["storedCoefficientPolynomial"]["passesUnchangedForceGate"]
        )
        self.assertGreater(
            result["resolutionDiagnostic"][
                "maximumMassTimesCoordinateULPOverHSquaredMicroN"
            ],
            1e-7,
        )
        repeated = REFERENCE.evaluate(report, SELECTION, 100)
        del result["decimalDigits"]
        del repeated["decimalDigits"]
        self.assertEqual(result, repeated)
        SUMMARY["actualF64SmallHFailurePreservedAt80And100Digits"] = float(
            abs(exact_residual)
        )

    def test_cyclic_coefficients_bound_to_actual_native_ids(self):
        report = fixture()
        captured = report["results"][0]["referenceCoefficients"]
        captured["triangles"] = [[1, 2, 0]]
        captured["elements"][0].update(
            {"alpha": [0.5, 0, -0.5], "beta": [0, 0.5, -0.5]}
        )
        rotated = REFERENCE.evaluate(report, SELECTION)
        self.assertEqual(
            rotated["highPrecisionFields"],
            REFERENCE.evaluate(fixture(), SELECTION)["highPrecisionFields"],
        )
        for invalid in ([[1, 0, 2]], [[0, 1, 3]], []):
            captured["triangles"] = invalid
            with self.assertRaises(ValueError):
                REFERENCE.evaluate(report, SELECTION)
        del captured["triangles"]
        with self.assertRaises(TypeError):
            REFERENCE.evaluate(report, SELECTION)
        SUMMARY["nativePositiveCyclicMappingAndRejectedMismatches"] = True

    def test_lossless_state_native_endianness_signed_zero_and_hashes(self):
        for order in ("LE", "BE"):
            report = fixture(byte_order=order)
            retained = snapshot(report)
            raw = struct.pack("<9d", -0.0, *retained["observation"]["x"][1:])
            retained["stateFloat64LE"]["x"] = base64.b64encode(raw).decode()
            native = (
                raw
                if order == "LE"
                else b"".join(raw[i : i + 8][::-1] for i in range(0, len(raw), 8))
            )
            retained["observation"]["rawSHA256"]["x"] = hashlib.sha256(
                native
            ).hexdigest()
            proof = REFERENCE.evaluate(report, SELECTION)
            self.assertEqual(
                proof["provenance"]["state"]["x"]["float64LESHA256"],
                hashlib.sha256(raw).hexdigest(),
            )
            self.assertEqual(
                proof["provenance"]["state"]["x"]["nativeSHA256"],
                hashlib.sha256(native).hexdigest(),
            )
            retained["observation"]["x"][3] = math.nextafter(2.5, math.inf)
            with self.assertRaises(ValueError):
                REFERENCE.evaluate(report, SELECTION)
        for key, value in (("x", "???"), ("xs", base64.b64encode(b"short").decode())):
            report = fixture()
            snapshot(report)["stateFloat64LE"][key] = value
            with self.assertRaises(ValueError):
                REFERENCE.evaluate(report, SELECTION)
        report = fixture()
        snapshot(report)["observation"]["rawSHA256"]["v"] = "0" * 64
        with self.assertRaises(ValueError):
            REFERENCE.evaluate(report, SELECTION)
        SUMMARY["LEStateNativeLEBEHashesAndSignedZeroVerified"] = True

    def test_exact_selection_and_domain_rejections(self):
        for key, value in (
            ("cells", 2),
            ("grain", 1),
            ("level", 2),
            ("seed", True),
            ("amplitude", math.nextafter(0.5, 1)),
            ("snapshot", "final"),
        ):
            with self.assertRaises(ValueError):
                REFERENCE.evaluate(fixture(), {**SELECTION, key: value})
        report = fixture()
        report["results"].append(copy.deepcopy(report["results"][0]))
        with self.assertRaises(ValueError):
            REFERENCE.evaluate(report, SELECTION)
        for mutate in (
            lambda r: r["runtime"].update(byteOrder="unknown"),
            lambda r: snapshot(r)["observation"].update(targetValid=False),
            lambda r: snapshot(r)["observation"].update(initial=True),
            lambda r: snapshot(r)["observation"].update(literalForceGate=False),
            lambda r: snapshot(r)["observation"].update(residualInfinity=1),
            lambda r: r["results"][0].update(triangles=[[0, 2, 1]]),
            lambda r: r["results"][0]["trajectories"][0]["runtime"]["massProof"].update(
                native=[0, 1, 1]
            ),
        ):
            report = fixture()
            mutate(report)
            with self.assertRaises(ValueError):
                REFERENCE.evaluate(report, SELECTION)
        SUMMARY["exactSelectionNoFallbackAndDomainFailures"] = True

    def test_cli_hash_selection_and_no_path_leak(self):
        report = fixture()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "captured.json"
            raw = json.dumps(report).encode()
            path.write_bytes(raw)
            args = [
                sys.executable,
                str(SOURCE),
                str(path),
                "--cells",
                "1",
                "--pattern",
                "forward",
                "--grain",
                "0",
                "--level",
                "1",
                "--budget",
                "4",
                "--seed",
                "false",
                "--amplitude",
                ".5",
                "--snapshot",
                "worst-force",
            ]
            result = subprocess.run(args, capture_output=True, text=True, check=True)
            proof = json.loads(result.stdout)
            self.assertEqual(
                proof["provenance"]["inputSHA256"], hashlib.sha256(raw).hexdigest()
            )
            self.assertEqual(
                proof["provenance"]["gradientHelperSHA256"],
                hashlib.sha256(REFERENCE.SOURCE.read_bytes()).hexdigest(),
            )
            self.assertNotIn(directory, result.stdout)
            args[args.index("--budget") + 1] = "5"
            failed = subprocess.run(args, capture_output=True, text=True, check=False)
            self.assertEqual(failed.returncode, 1)
            self.assertEqual(failed.stdout, "")
            self.assertIn("error", json.loads(failed.stderr))
        SUMMARY["CLIRawInputHelperHashesAndExplicitSelection"] = True


def run_self_validation():
    SUMMARY.clear()
    stream = io.StringIO()
    with contextlib.redirect_stdout(stream):
        result = unittest.TextTestRunner(stream=stream, verbosity=2).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(ModalPrecisionTests)
        )
    output = re.sub(
        r"^Ran (\d+) tests? in [0-9.]+s$",
        r"Ran \1 tests (elapsed excluded)",
        stream.getvalue(),
        flags=re.MULTILINE,
    )
    return {
        "schema": "pliego-membrane-modal-precision-self-test/1",
        "passed": result.wasSuccessful(),
        "testsRun": result.testsRun,
        "testCases": len(SUMMARY),
        "proofs": dict(SUMMARY),
        "failures": len(result.failures),
        "errors": len(result.errors),
        "output": output,
    }


if __name__ == "__main__":
    proof = run_self_validation()
    print(json.dumps(proof, allow_nan=False))
    sys.exit(int(not proof["passed"]))
