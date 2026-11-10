"""Retained solved-CST-pose precision diagnostic; stdlib Decimal, no engine imports.

Input is a plane-stress-audit JSON report; select one geometry/load explicitly.
Optional --stored JSON contains actual runtime
{triangles:[[i,j,k],...],elements:[{alpha,beta,Q,volume},...]} in matched order.
--stored-report instead uses the matching parent-captured precisionFixture.
No solve, timestep, rest-force correction or proof of representable equilibrium.
"""
import argparse
import hashlib
import json
import math
import struct
import sys
from decimal import Decimal, localcontext
from pathlib import Path

PI = Decimal("3.141592653589793238462643383279502884197169399375105820974944592307816406286208998628034825342117067982148086513282306647")


def exact(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("finite numeric input required")
    return Decimal.from_float(float(value))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def matmul(a, b):
    return [[sum(a[i][k]*b[k][j] for k in range(len(b))) for j in range(len(b[0]))] for i in range(len(a))]


def transpose(a):
    return [list(row) for row in zip(*a)]


def material_axes(angle):
    angle = exact(angle) % 360
    quadrants = {Decimal(0):(1,0), Decimal(90):(0,1), Decimal(180):(-1,0), Decimal(270):(0,-1)}
    if angle in quadrants:
        c,s = map(Decimal,quadrants[angle])
    else:
        x = angle*PI/180
        c,cterm,s,sterm = Decimal(1),Decimal(1),x,x
        for k in range(1,200):
            cterm *= -x*x/((2*k-1)*(2*k))
            sterm *= -x*x/((2*k)*(2*k+1))
            previous = c,s
            c += cterm
            s += sterm
            if previous == (c,s):
                break
        else:
            raise ValueError("Decimal trigonometric expansion did not settle")
    return [[c,-s],[s,c]]


def precise_gradient(vertices, triangles, positions, material, angle):
    """Independent Ds*Dm^-1, material Green strain, S, P=FS and shape gradients."""
    E1,E2,nu,G,t = [exact(material[k]) for k in ("E1","E2","nu12","G12","thickness")]
    denominator = 1-nu*nu*E2/E1
    if min(E1,E2,G,t) <= 0 or denominator <= 0:
        raise ValueError("positive-definite material required")
    q11,q22,q12 = E1/denominator,E2/denominator,nu*E2/denominator
    R = material_axes(angle)
    gradient = [[Decimal(0)]*3 for _ in vertices]
    for ids in triangles:
        p = [vertices[i] for i in ids]
        dm = [[p[1][r]-p[0][r],p[2][r]-p[0][r]] for r in range(2)]
        determinant = dm[0][0]*dm[1][1]-dm[0][1]*dm[1][0]
        if determinant <= 0:
            raise ValueError("positive reference triangle required")
        inverse = [[dm[1][1]/determinant,-dm[0][1]/determinant],[-dm[1][0]/determinant,dm[0][0]/determinant]]
        ds = [[positions[ids[1]][r]-positions[ids[0]][r],positions[ids[2]][r]-positions[ids[0]][r]] for r in range(3)]
        F = matmul(ds,inverse)
        C = matmul(transpose(F),F)
        E = [[(C[i][j]-(1 if i==j else 0))/2 for j in range(2)] for i in range(2)]
        em = matmul(matmul(transpose(R),E),R)
        S = [[q11*em[0][0]+q12*em[1][1],2*G*em[0][1]],
             [2*G*em[0][1],q12*em[0][0]+q22*em[1][1]]]
        P = matmul(matmul(matmul(F,R),S),transpose(R))
        gradients = [[-inverse[0][j]-inverse[1][j] for j in range(2)],inverse[0],inverse[1]]
        for node,b in zip(ids,gradients):
            for r in range(3):
                gradient[node][r] += determinant*t/2*sum(P[r][j]*b[j] for j in range(2))
    return gradient


def stored_gradient(triangles, positions, elements):
    if len(elements) != len(triangles):
        raise ValueError("stored element count mismatch")
    gradient = [[Decimal(0)]*3 for _ in positions]
    for ids,element in zip(triangles,elements):
        alpha,beta,Q = [list(map(exact,element[k])) for k in ("alpha","beta","Q")]
        volume = exact(element["volume"])
        alpha[0] = -(alpha[1]+alpha[2])
        beta[0] = -(beta[1]+beta[2])
        a = [alpha[1]*(positions[ids[1]][r]-positions[ids[0]][r])+alpha[2]*(positions[ids[2]][r]-positions[ids[0]][r]) for r in range(3)]
        b = [beta[1]*(positions[ids[1]][r]-positions[ids[0]][r])+beta[2]*(positions[ids[2]][r]-positions[ids[0]][r]) for r in range(3)]
        e = [(sum(v*v for v in a)-1)/2,(sum(v*v for v in b)-1)/2,sum(u*v for u,v in zip(a,b))]
        s = [Q[0]*e[0]+Q[2]*e[1],Q[2]*e[0]+Q[1]*e[1],Q[3]*e[2]]
        for i,node in enumerate(ids):
            for r in range(3):
                gradient[node][r] += volume*(alpha[i]*(s[0]*a[r]+s[2]*b[r])+beta[i]*(s[1]*b[r]+s[2]*a[r]))
    return gradient


def stored_mapping(authored, payload):
    """Bind each coefficient triple to its actual runtime cyclic vertex order."""
    if not isinstance(payload, dict) or not isinstance(payload.get("triangles"), list) or not isinstance(payload.get("elements"), list):
        raise TypeError("stored input requires actual runtime triangles and elements")
    actual, elements = payload["triangles"], payload["elements"]
    if len(actual) != len(authored) or len(elements) != len(authored):
        raise ValueError("stored runtime triangle/element count mismatch")
    for expected, ids in zip(authored, actual):
        if not isinstance(ids, list) or len(ids) != 3 or any(isinstance(i, bool) or not isinstance(i, int) for i in ids):
            raise ValueError("stored runtime triangle requires three integer vertex IDs")
        if not any(ids == expected[k:]+expected[:k] for k in range(3)):
            raise ValueError("stored runtime triangle must positively cyclic-match its authored face")
    return actual, elements


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input")
    parser.add_argument("--cells",type=int,required=True)
    parser.add_argument("--pattern",required=True)
    parser.add_argument("--grain",type=float,required=True)
    parser.add_argument("--boundary",required=True)
    parser.add_argument("--eta",type=float,required=True)
    parser.add_argument("--digits",type=int,default=80)
    stored_options = parser.add_mutually_exclusive_group()
    stored_options.add_argument("--stored")
    stored_options.add_argument("--stored-report",action="store_true")
    args = parser.parse_args()
    if not 60 <= args.digits <= 100:
        raise ValueError("precision must be 60..100 digits")
    raw = Path(args.input).read_bytes()
    report = json.loads(raw)
    rows = [r for r in report["results"] if (r["cells"],r["pattern"],r["grain"],r["boundary"]) == (args.cells,args.pattern,args.grain,args.boundary)]
    if len(rows) != 1:
        raise ValueError("selection must identify exactly one geometry")
    row = rows[0]
    loads = [load for load in row["loads"] if load["eta"] == args.eta]
    if len(loads) != 1:
        raise ValueError("selection must identify exactly one load")
    load = loads[0]
    runtime = load["runtime"]
    uv = row["vertices"]
    # The audit retains ACTUAL applied displacement x-UV. Close-pose subtraction
    # is exact; adding it back reconstructs the same actual binary64 positions.
    x = [[u+d[0],0.0,-(v+d[1])] for (u,v),d in zip(uv,runtime["displacement"])]
    if len(x) != len(uv) or any([p[0]-u,-p[2]-v] != d for (u,v),p,d in zip(uv,x,runtime["displacement"])):
        raise ValueError("actual displacement/position reconstruction failed")
    fixed = set(load["boundary"]["fixedDofs"])
    free = [i for i in range(2*len(uv)) if i not in fixed]
    if free != runtime["freeDofs"]:
        raise ValueError("inconsistent boundary/runtime free DOFs")
    stored_raw, stored_payload, stored_source, stored_encoding = None, None, None, None
    if args.stored:
        stored_raw = Path(args.stored).read_bytes()
        stored_payload = json.loads(stored_raw)
        stored_source, stored_encoding = "external-file", "raw input bytes"
    elif args.stored_report:
        fixture = report.get("precisionFixture")
        selected = {"cells":args.cells,"pattern":args.pattern,"grain":args.grain,"boundary":args.boundary}
        if not isinstance(fixture,dict) or fixture.get("case") != selected:
            raise ValueError("parent-captured precisionFixture.case must match the selected geometry")
        stored_payload = fixture
        stored_raw = json.dumps(fixture,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode("utf-8")
        stored_source, stored_encoding = "parent-report-captured", "sorted-key compact UTF-8 JSON; Python numeric encoding"
    with localcontext() as context:
        context.prec = args.digits
        vertices = [[exact(v) for v in p] for p in uv]
        positions = [[exact(v) for v in p] for p in x]
        reference = precise_gradient(vertices,row["triangles"],positions,row["material"],args.grain)
        fields = {"independentExactUVMaterial":reference}
        if stored_raw:
            actual_triangles, elements = stored_mapping(row["triangles"], stored_payload)
            fields["storedCoefficientPolynomial"] = stored_gradient(actual_triangles,positions,elements)
        force = [exact(v) for p in load["boundary"]["forces"] for v in p]
        actual = [exact(v) for p in runtime["gradient"] for v in p]
        mapped = {name:[g[i][0 if c==0 else 2]*(1 if c==0 else -1) for i in range(len(uv)) for c in range(2)] for name,g in fields.items()}
        residuals = {name:[g[i]-force[i] for i in range(len(force))] for name,g in mapped.items()}
        residuals["runtime"] = [actual[i]-force[i] for i in range(len(force))]
        worst = sorted(free,key=lambda i:abs(residuals["runtime"][i]),reverse=True)[:10]
        summary = {name:{"freeResidualInfinityMicroN":float(max(abs(r[i]) for i in free)),
                    "passesUnchangedForceGate":max(abs(r[i]) for i in free) <= exact(runtime["forceTolerance"])} for name,r in residuals.items()}
        errors = {name:float(max(abs(actual[i]-g[i]) for i in free)) for name,g in mapped.items()}
        worst_rows = [{"dof":i,"node":i//2,"component":"u" if i%2==0 else "v","uv":uv[i//2],
            "worldPosition":x[i//2],"coordinateULPMm":math.ulp(x[i//2][0 if i%2==0 else 2]),
            "residualMicroN":{name:float(r[i]) for name,r in residuals.items()}} for i in worst]
    result = {"schema":"pliego-plane-stress-precision/0.1","decimalDigits":args.digits,
        "selection":{"cells":args.cells,"pattern":args.pattern,"grain":args.grain,"boundary":args.boundary,"eta":args.eta},
        "provenance":{"inputSHA256":sha(raw),"diagnosticSHA256":sha(Path(__file__).read_bytes()),
            "runtimeSourceGit":report.get("source",{}).get("git"),"storedInputSHA256":sha(stored_raw) if stored_raw else None,
            "storedInputSource":stored_source,"storedInputHashEncoding":stored_encoding,
            "actualPositionFloat64LESHA256":sha(b''.join(struct.pack('<d',v) for p in x for v in p))},
        "runtimeStatus":runtime["status"],"iterations":runtime["iterations"],"forceToleranceMicroN":runtime["forceTolerance"],
        "summary":summary,"maximumRuntimeGradientErrorMicroN":errors,"worstFreeDofs":worst_rows,
        "scope":"fixed actual-f64-pose evaluation only, no solve/time integration/calibration or proof that no representable equilibrium exists; independent exact-UV/Q real StVK and optional stored-coefficient polynomial kept separate; reference-displacement reconstruction verified",
        "rotationConvention":"high-precision declared-degree material rotation, exact binary64 material/UV/pose inputs; optional rounded runtime coefficient constants interpreted exactly; coherent difference-form alpha0=-(alpha1+alpha2) for polynomial derivative"}
    print(json.dumps(result,allow_nan=False,indent=2))


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        from test_plane_stress_precision import run_self_validation
        result = run_self_validation()
        print(json.dumps(result,allow_nan=False))
        sys.exit(0 if result["passed"] else 1)
    main()
