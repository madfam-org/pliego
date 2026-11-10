"""Independent Decimal diagnostic verification; no engine or other FE imports."""
import contextlib
import hashlib
import importlib.util
import io
import json
import math
import subprocess
import sys
import tempfile
import unittest
from decimal import Decimal, localcontext
from pathlib import Path

SOURCE = Path(__file__).with_name("plane-stress-precision.py")
SPEC = importlib.util.spec_from_file_location("plane_stress_precision", SOURCE)
REFERENCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REFERENCE)
MATERIAL = {"E1": 5.5e9, "E2": 2.5e9, "nu12": 0.293,
            "G12": 0.387*math.sqrt(5.5e9*2.5e9), "thickness": 0.1}
SUMMARY = {}
D = Decimal


def mm(a, b):
    return [[sum(a[i][k]*b[k][j] for k in range(len(b))) for j in range(len(b[0]))]
            for i in range(len(a))]


def tr(a):
    return [list(row) for row in zip(*a)]


def constants():
    e1,e2,nu,g,t = [D.from_float(float(MATERIAL[k])) for k in ("E1","E2","nu12","G12","thickness")]
    den = 1-nu*nu*e2/e1
    return [[e1/den,nu*e2/den,0],[nu*e2/den,e2/den,0],[0,0,g]],t


def axes(angle):
    c,s = {0:(D(1),D(0)),30:(D(3).sqrt()/2,D(1)/2),
           45:(D(2).sqrt()/2,D(2).sqrt()/2),90:(D(0),D(1))}[angle]
    return [[c,-s],[s,c]]


def mesh():
    return [[D(0),D(0)],[D(2),D(0)],[D(2),D(1)],[D(0),D(1)],[D(".9"),D(".45")]], [[0,1,4],[1,2,4],[2,3,4],[3,0,4]]


def energy(vertices, triangles, positions, angle):
    """Independent scalar Green-strain energy for differentiation, no gradient call."""
    q,t = constants()
    rotation = axes(angle)
    total = D(0)
    for ids in triangles:
        a,b,c = [vertices[i] for i in ids]
        det = (b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1])
        inv = [[(c[1]-a[1])/det,-(c[0]-a[0])/det],[-(b[1]-a[1])/det,(b[0]-a[0])/det]]
        F = mm([[positions[ids[1]][r]-positions[ids[0]][r],positions[ids[2]][r]-positions[ids[0]][r]] for r in range(3)],inv)
        fm = mm(F,rotation)
        aa = sum(row[0]*row[0] for row in fm)
        bb = sum(row[1]*row[1] for row in fm)
        ab = sum(row[0]*row[1] for row in fm)
        strain = [(aa-1)/2,(bb-1)/2,ab]
        total += t*det/4*sum(strain[i]*q[i][j]*strain[j] for i in range(3) for j in range(3))
    return total


class PrecisionTests(unittest.TestCase):
    def test_identity_and_rigid_rotation_at_rotated_grains(self):
        with localcontext() as context:
            context.prec = 90
            vertices,triangles = mesh()
            rotations = [[[D(1),D(0),D(0)],[D(0),D(1),D(0)],[D(0),D(0),D(1)]],
                         [[D(1)/9,D(8)/9,D(4)/9],[D(8)/9,D(1)/9,-D(4)/9],[-D(4)/9,D(4)/9,-D(7)/9]]]
            worst = D(0)
            for angle in (0,30,45,90):
                for rotation in rotations:
                    positions = [[sum(rotation[r][k]*v for k,v in enumerate([u,D(0),-w]))+D(r+2) for r in range(3)] for u,w in vertices]
                    gradient = REFERENCE.precise_gradient(vertices,triangles,positions,MATERIAL,angle)
                    worst = max(worst,max(abs(v) for row in gradient for v in row))
            self.assertLess(worst,D("1e-65"))
            SUMMARY["maximumRigidGradientMicroN"] = float(worst)
            print(f"plane-precision-rigid: identity/finite rational 3D rotation and translation at four grains; maximum gradient={worst}")

    def test_finite_affine_piola_against_independent_boundary_traction_integral(self):
        with localcontext() as context:
            context.prec = 90
            vertices,triangles = mesh()
            q,t = constants()
            l1,l2 = D("1.002"),D(".999")
            e1,e2 = (l1*l1-1)/2,(l2*l2-1)/2
            stress1,stress2 = q[0][0]*e1+q[0][1]*e2,q[1][0]*e1+q[1][1]*e2
            embedding = [[D(1),D(0)],[D(0),D(0)],[D(0),D(-1)]]
            worst = D(0)
            for angle in (0,30,45,90):
                r = axes(angle)
                F = mm(mm(mm(embedding,r),[[l1,0],[0,l2]]),tr(r))
                P = mm(mm(mm(embedding,r),[[l1*stress1,0],[0,l2*stress2]]),tr(r))
                positions = [[sum(F[i][j]*point[j] for j in range(2)) for i in range(3)] for point in vertices]
                actual = REFERENCE.precise_gradient(vertices,triangles,positions,MATERIAL,angle)
                expected = [[D(0)]*3 for _ in vertices]
                for a,b in ((0,1),(1,2),(2,3),(3,0)):
                    dx,dy = vertices[b][0]-vertices[a][0],vertices[b][1]-vertices[a][1]
                    for node in (a,b):
                        for i in range(3):
                            expected[node][i] += t*(P[i][0]*dy-P[i][1]*dx)/2
                error = max(abs(a-b) for x,y in zip(actual,expected) for a,b in zip(x,y))
                scale = max(abs(v) for row in expected for v in row)
                worst = max(worst,error/scale)
                self.assertLess(error/scale,D("1e-65"))
                self.assertLess(max(map(abs,actual[4])),D("1e-60"))
            SUMMARY["maximumAffineTractionRelativeError"] = float(worst)
            print(f"plane-precision-affine: finite material stretches, analytic Piola and independent boundary reactions at four grains; maximum relative error={worst}")

    def test_nonaffine_gradient_scalar_energy_finite_difference_halving(self):
        with localcontext() as context:
            context.prec = 100
            vertices,triangles = mesh()
            positions = [[u+D(".01")*D(i+1),D(".007")*D((i*i)%3),-v+D(".003")*D(i-2)] for i,(u,v) in enumerate(vertices)]
            gradient = REFERENCE.precise_gradient(vertices,triangles,positions,MATERIAL,30)
            previous = None
            for h in (D("1e-7"),D("5e-8"),D("2.5e-8")):
                fd = []
                for i in range(len(vertices)):
                    for c in range(3):
                        a,b = [row[:] for row in positions],[row[:] for row in positions]
                        a[i][c] += h
                        b[i][c] -= h
                        fd.append((energy(vertices,triangles,a,30)-energy(vertices,triangles,b,30))/(2*h))
                flat = [v for row in gradient for v in row]
                error = (sum((a-b)**2 for a,b in zip(fd,flat))/sum(v*v for v in flat)).sqrt()
                if previous is not None:
                    self.assertLess(error,previous*D(".251"))
                previous = error
            self.assertLess(previous,D("1e-12"))
            SUMMARY["finestNonaffineGradientRelativeError"] = float(previous)
            print(f"plane-precision-fd: genuinely nonaffine 3D field; scalar energy derivative converges quadratically; finest relative error={previous}")

    def test_stored_polynomial_is_separate_from_exact_uv_meaning(self):
        with localcontext() as context:
            context.prec = 90
            vertices = [[D(0),D(0)],[D(10),D(0)],[D(0),D(10)]]
            positions = [[u,D(0),-v] for u,v in vertices]
            q,t = constants()
            element = {"alpha":[-.1,.1,0],"beta":[-.1,0,.1],"Q":[float(q[0][0]),float(q[1][1]),float(q[0][1]),float(q[2][2])],"volume":float(50*t)}
            exact_uv = REFERENCE.precise_gradient(vertices,[[0,1,2]],positions,MATERIAL,0)
            stored = REFERENCE.stored_gradient([[0,1,2]],positions,[element])
            self.assertEqual(max(abs(v) for row in exact_uv for v in row),0)
            self.assertGreater(max(abs(v) for row in stored for v in row),D("1e-10"))
            SUMMARY["exactUVAndRoundedCoefficientMeaningsSeparated"] = True
            print("plane-precision-meaning: exact UV identity has zero force; rounded0.1 coefficient polynomial retains its distinct rest bias")

    def test_cli_selection_reconstruction_and_provenance(self):
        zero = [[0,0] for _ in range(4)]
        report = {"source":{"git":"test-source"},"results":[{"cells":1,"pattern":"forward","grain":30,"boundary":"clamped-left",
            "vertices":[[0,0],[40,0],[40,40],[0,40]],"triangles":[[0,1,2],[0,2,3]],"material":MATERIAL,
            "loads":[{"eta":0,"boundary":{"fixedDofs":[0,1,6,7],"forces":zero},"runtime":{"displacement":zero,
                "gradient":zero,"freeDofs":[2,3,4,5],"forceTolerance":1e-7,"status":"converged","iterations":0}}]}]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"input.json"
            path.write_text(json.dumps(report))
            args = [sys.executable,str(SOURCE),str(path),"--cells","1","--pattern","forward","--grain","30","--boundary","clamped-left","--eta","0"]
            result = subprocess.run(args,capture_output=True,text=True,check=False)
            self.assertEqual(result.returncode,0,result.stderr)
            parsed = json.loads(result.stdout)
            self.assertEqual(parsed["summary"]["independentExactUVMaterial"]["freeResidualInfinityMicroN"],0)
            self.assertTrue(parsed["summary"]["runtime"]["passesUnchangedForceGate"])
            self.assertIsNone(parsed["provenance"]["storedInputSHA256"])
            self.assertEqual(len(parsed["provenance"]["actualPositionFloat64LESHA256"]),64)
            self.assertNotIn(directory,result.stdout)
            args[args.index("--cells")+1] = "2"
            rejected = subprocess.run(args,capture_output=True,text=True,check=False)
            self.assertNotEqual(rejected.returncode,0)
            self.assertEqual(rejected.stdout,"")
        SUMMARY["cliSelectionProvenanceAndErrors"] = True
        print("plane-precision-cli: exact selection/reconstruction, path-free hashes and unchanged force gate; missing selection fails without partial JSON")

    def test_stored_actual_cyclic_order_binding_and_rejected_mappings(self):
        with localcontext() as context:
            context.prec = 90
            authored,actual = [[0,1,2]],[[1,2,0]]
            positions = [[D(0),D(0),D(0)],[D.from_float(10.001),D(0),D.from_float(-.0002)],[D.from_float(.0004),D(0),D.from_float(-9.9997)]]
            q,t = constants()
            original = {"alpha":[-.1,.1,0],"beta":[-.1,0,.1],"Q":[float(q[0][0]),float(q[1][1]),float(q[0][1]),float(q[2][2])],"volume":float(50*t)}
            rotated = {**original,"alpha":[.1,0,-.1],"beta":[0,.1,-.1]}
            payload = {"triangles":actual,"elements":[rotated]}
            ids,elements = REFERENCE.stored_mapping(authored,payload)
            expected = REFERENCE.stored_gradient(authored,positions,[original])
            observed = REFERENCE.stored_gradient(ids,positions,elements)
            self.assertLess(max(abs(a-b) for x,y in zip(expected,observed) for a,b in zip(x,y)),D("1e-65"))
            wrong = REFERENCE.stored_gradient(authored,positions,[rotated])
            self.assertGreater(max(abs(a-b) for x,y in zip(expected,wrong) for a,b in zip(x,y)),1)
            for malformed in ({"elements":[rotated]}, {"triangles":[],"elements":[]},
                              {"triangles":[[0,2,1]],"elements":[rotated]},
                              {"triangles":[[0,1,3]],"elements":[rotated]}):
                with self.assertRaises((TypeError,ValueError)):
                    REFERENCE.stored_mapping(authored,malformed)
            uv = [[0,0],[10,0],[0,10]]
            displacement = [[float(p[0])-u,-float(p[2])-v] for (u,v),p in zip(uv,positions)]
            gradient = [[float(p[0]),-float(p[2])] for p in expected]
            report = {"results":[{"cells":1,"pattern":"cycle","grain":0,"boundary":"diagnostic",
                "vertices":uv,"triangles":authored,"material":MATERIAL,"loads":[{"eta":0,
                "boundary":{"fixedDofs":[],"forces":[[0,0]]*3},"runtime":{"displacement":displacement,
                "gradient":gradient,"freeDofs":list(range(6)),"forceTolerance":1e-7,"status":"diagnostic-only","iterations":0}}]}]}
            with tempfile.TemporaryDirectory() as directory:
                path,stored = Path(directory)/"audit.json",Path(directory)/"stored.json"
                path.write_text(json.dumps(report))
                stored.write_text(json.dumps(payload))
                args = [sys.executable,str(SOURCE),str(path),"--cells","1","--pattern","cycle","--grain","0","--boundary","diagnostic","--eta","0","--stored",str(stored)]
                result = subprocess.run(args,text=True,capture_output=True,check=False)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertLess(json.loads(result.stdout)["maximumRuntimeGradientErrorMicroN"]["storedCoefficientPolynomial"],1e-8)
                report["precisionFixture"] = {**payload,"case":{"cells":1,"pattern":"cycle","grain":0,"boundary":"diagnostic"},"scope":"test-captured actual runtime ordering"}
                path.write_text(json.dumps(report))
                captured_args = args[:-2]+["--stored-report"]
                captured = subprocess.run(captured_args,text=True,capture_output=True,check=False)
                self.assertEqual(captured.returncode,0,captured.stderr)
                output = json.loads(captured.stdout)
                self.assertEqual(output["summary"],json.loads(result.stdout)["summary"])
                self.assertEqual(output["provenance"]["storedInputSource"],"parent-report-captured")
                canonical = json.dumps(report["precisionFixture"],sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode("utf-8")
                self.assertEqual(output["provenance"]["storedInputSHA256"],hashlib.sha256(canonical).hexdigest())
                report["precisionFixture"]["case"]["cells"] = 2
                path.write_text(json.dumps(report))
                self.assertNotEqual(subprocess.run(captured_args,capture_output=True,check=False).returncode,0)
                self.assertNotEqual(subprocess.run(args+["--stored-report"],capture_output=True,check=False).returncode,0)
        SUMMARY["parentCapturedFixtureBindingHashAndExclusion"] = True
        SUMMARY["actualCyclicCoefficientMappingAndRejections"] = True
        print("plane-precision-mapping: actual cyclic node order bound to coefficient triples; mistaken authored pairing changes forces; missing/reversed/unrelated mappings rejected")


def run_self_validation():
    SUMMARY.clear()
    diagnostics,proof = io.StringIO(),io.StringIO()
    with contextlib.redirect_stdout(proof):
        result = unittest.TextTestRunner(stream=diagnostics,verbosity=0).run(unittest.defaultTestLoader.loadTestsFromTestCase(PrecisionTests))
    return {"schema":"pliego-plane-stress-precision-self-test/0.1","passed":result.wasSuccessful(),"testCases":result.testsRun,
            "failures":len(result.failures),"errors":len(result.errors),"checks":dict(SUMMARY),"readProof":proof.getvalue().splitlines(),
            "diagnostics":diagnostics.getvalue() if not result.wasSuccessful() else "",
            "scope":"independent diagnostic-formula verification; no engine imports, solve or calibrated-stock validation"}


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        result = run_self_validation()
        print(json.dumps(result,allow_nan=False))
        sys.exit(0 if result["passed"] else 1)
    unittest.main(verbosity=2)
