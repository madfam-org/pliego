"""POST-HOC exact decomposition of preselected captured first-accepted trials.
No World, solver, trajectory replay, new acceptance gate or full-trajectory truth.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import math
import os
import struct
import subprocess
import sys
from fractions import Fraction as F
from pathlib import Path

sys.dont_write_bytecode = True
GIT = '3d778abc179988e1c1a31b43d8048aa6a08d00b1'
CAPTURE = '09d94972d9f7f815d6fae4033eac6417810242a238911b542573b53ccbfadb78'
REVIEW = '891197fd9e7e0147ff50adbb705408561e2f502d6af7ed28fe9503f6e57ed2aa'
REVIEWER = 'aaec559930f911fc6747ef707d8bc539a092cc640e6fd58fe2f1ae73adcc16c0'
sha = lambda b: hashlib.sha256(b).hexdigest()
canonical = lambda x: json.dumps(x, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
rat = lambda x: {'numerator': str(x.numerator), 'denominator': str(x.denominator)}
vec = lambda a: {'approximate': list(map(float, a)), 'exact': [rat(x) for x in a]}
norm = lambda a: max(map(abs, a), default=F())
add = lambda *a: [sum(v, F()) for v in zip(*a)]
sub = lambda a, b: [x-y for x, y in zip(a, b)]
mv = lambda a, b: [sum((a[len(b)*i+j]*b[j] for j in range(len(b))), F()) for i in range(len(b))]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--repo', type=Path, required=True)
    ap.add_argument('--capture', type=Path, required=True)
    ap.add_argument('--selected-review', type=Path, required=True)
    ap.add_argument('--reviewer', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    repo = args.repo.resolve()
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip() == GIT
    assert subprocess.check_output(['git', 'status', '--porcelain'], cwd=repo, text=True) == ''
    source_bytes = Path(__file__).read_bytes()
    reviewer_bytes = args.reviewer.read_bytes()
    assert sha(reviewer_bytes) == REVIEWER
    module = load_module('frozen_selected_reviewer', args.reviewer)
    reviewer = module.Reviewer(repo)
    helpers_before = reviewer.helper_inventory()
    raw = args.capture.read_bytes()
    assert sha(raw) == CAPTURE
    capture = json.loads(raw)
    del raw
    review_raw = args.selected_review.read_bytes()
    assert sha(review_raw) == REVIEW
    reviewed = json.loads(review_raw)
    assert reviewed['integrityPassed'] is True and reviewed['input']['sha256'] == CAPTURE
    assert capture['source']['git'] == GIT and capture['source']['dirty'] is False
    assert capture['protocol']['instrument'] is True
    for f in capture['source']['files']:
        b = (repo / f['path']).read_bytes()
        assert len(b) == f['bytes'] and sha(b) == f['sha256'], f['path']
    indexed = {(r['selection']['trajectoryIndex'], r['selection']['iteration'], r['selection']['substepsRun']): r for r in reviewed['events']}
    group = capture['results'][0]
    rows = group['trajectories']
    assert len(capture['results']) == 1 and len(rows) == 24
    unique, selections = {}, []
    for ti, row in enumerate(rows):
        event = row['solveObservation']['snapshots']['first-accepted']
        assert event['valid'] is True and event['missing'] == []
        assert event['lineSearch']['decision'] == 'accepted' and event['acceptedAlpha'] == 1
        assert event['iteration'] == 1 and event['substepsRun'] == 0 and event['source'] == 'direct'
        old = indexed[(ti, event['iteration'], event['substepsRun'])]
        assert 'first-accepted' in old['selection']['roles'] and old['decision'] == 'accepted'
        assert old['stateSHA256'] == event['stateSHA256']
        assert old['referenceSHA256'] == row['referenceWords']['stateSHA256']['reference']
        decoded = reviewer.decode_record(event)
        identity = {'stateFloat64LE': event['stateFloat64LE'], 'stateSHA256': event['stateSHA256'],
                    'reference': row['referenceWords'], 'stateIdentity': event['stateIdentity'],
                    'forceScale': event['forceScale'], 'forceTolerance': event['forceTolerance']}
        key = sha(canonical(identity))
        selection = {'trajectoryIndex': ti, 'level': row['level'], 'budget': row['budget'], 'seed': row['seed'],
                     'role': 'first-accepted', 'iteration': event['iteration'], 'substepsRun': event['substepsRun'],
                     'source': event['source'], 'decision': event['lineSearch']['decision'], 'alpha': event['acceptedAlpha'], 'identitySHA256': key}
        selections.append(selection)
        if key in unique:
            assert unique[key]['identity'] == identity
            unique[key]['selections'].append(selection)
        else:
            unique[key] = {'identity': identity, 'event': event, 'row': row, 'decoded': decoded, 'selections': [selection]}
    assert len(unique) == 4, 'fixed first-event dataset unexpectedly changed'
    linearizations, cache, results = [], {}, []
    for key, entry in unique.items():
        row, event, a = entry['row'], entry['event'], entry['decoded']
        n, h = len(a['startU']), a['h'][0]
        assert event['h'] == row['h'] == h and event['forceScale'] == row['fixedForceScale']
        tau = F(row['forceTolerance'])
        assert float(tau) == event['forceTolerance'] == max(1e-7, 1e-10*event['forceScale'])
        assert event['stateFloat64LE']['afterU'] == event['stateFloat64LE']['lastTrialU']
        origin, elements = reviewer.geometry(group, row, n)
        assert module.words(origin) == module.words(a['x0'])
        start, end, target = [[F(x) for x in a[name]] for name in ('startU', 'lastTrialU', 'ut')]
        d = sub(end, start)
        nominal = list(map(F, a['nominalDirection']))
        native_realized = list(map(F, a['realizedDirection']))
        lin_key = sha(canonical({'reference': row['referenceWords'], 'startU': event['stateFloat64LE']['startU'], 'x0': event['stateFloat64LE']['x0']}))
        if lin_key not in cache:
            e0, elastic0, exact_h, gn_h = reviewer.oracle.assemble([F(x)+u for x, u in zip(origin, start)], elements, hessian=True)
            cache[lin_key] = (len(linearizations), elastic0, exact_h, gn_h)
            linearizations.append({'identitySHA256': lin_key, 'dimensions': n, 'energyExactNJ': rat(e0),
                'elasticGradient0': vec(elastic0), 'elasticExactHessianRowMajor': vec(exact_h), 'elasticGaussNewtonRowMajor': vec(gn_h),
                'scope': 'unchanged exact-Fraction assemble at represented real q0=X0+u0; no inertia in these matrices'})
        li, elastic0, exact_h, gn_h = cache[lin_key]
        e1, elastic1, _, _ = reviewer.oracle.assemble([F(x)+u for x, u in zip(origin, end)], elements)
        coeff = {'nativeCoefficient': [F(a['mass'][i//3]*(1/(h*h))) for i in range(n)],
                 'realMass': [F(a['mass'][i//3])/F(h)**2 for i in range(n)]}
        truths = {}
        for label, c in coeff.items():
            g0 = add(elastic0, [z*(u-t) for z,u,t in zip(c,start,target)])
            g1 = add(elastic1, [z*(u-t) for z,u,t in zip(c,end,target)])
            exact_d = add(mv(exact_h,d), [z*v for z,v in zip(c,d)])
            gn_d = add(mv(gn_h,d), [z*v for z,v in zip(c,d)])
            linear = add(g0,gn_d)
            geometric = sub(exact_d,gn_d)
            nonlinear = sub(sub(g1,g0),exact_d)
            nominal_r = add(g0,mv(gn_h,nominal),[z*v for z,v in zip(c,nominal)])
            endpoint_rounding = sub(linear,nominal_r)
            native_realized_r = add(g0,mv(gn_h,native_realized),[z*v for z,v in zip(c,native_realized)])
            assert add(linear,geometric,nonlinear) == g1
            assert add(nominal_r,endpoint_rounding) == linear
            vectors = {'fullGradient0':g0,'fullGradient1':g1,'realizedLinearError':linear,'omittedGeometricCurvature':geometric,
                'nonlinearTaylorRemainder':nonlinear,'nominalDirectionLinearError':nominal_r,'endpointAdditionRoundingContribution':endpoint_rounding,
                'nativeRoundedDifferenceLinearError':native_realized_r,'capturedGradient0Error':sub(list(map(F,a['gradient'])),g0),
                'recordedNominalResidualError':sub(list(map(F,event['nominal']['residual'])),nominal_r),
                'recordedRealizedResidualError':sub(list(map(F,event['realized']['residual'])),native_realized_r)}
            peak = max(range(n),key=lambda i:abs(g1[i]))
            truths[label] = {'coefficients':vec(c),'vectors':{k:vec(v) for k,v in vectors.items()},
                'infinityNormsMicroN':{k:{'approximate':float(norm(v)),'exact':rat(norm(v)),'ratioToOriginalTau':float(norm(v)/tau)} for k,v in vectors.items()},
                'exactDecompositionIdentity':True,'nominalPlusEndpointRoundingIdentity':True,
                'maximumFinalComponent':{'index':peak,'gradient1':rat(g1[peak]),'linear':rat(linear[peak]),'geometric':rat(geometric[peak]),'nonlinear':rat(nonlinear[peak])},
                'finalGradientPassesOriginalTau':norm(g1)<=tau}
        results.append({'identitySHA256':key,'selections':entry['selections'],'linearizationIndex':li,'forceTolerance':row['forceTolerance'],
            'fixedForceScale':row['fixedForceScale'],'h':h,'event':event,'referenceWords':row['referenceWords'],
            'actualEndpointDelta':vec(d),'nominalDirection':vec(nominal),'nativeRoundedEndpointDifference':vec(native_realized),
            'endpointDeltaMinusNominal':vec(sub(d,nominal)),'endpointDeltaMinusNativeRoundedDifference':vec(sub(d,native_realized)),
            'endElasticEnergyExactNJ':rat(e1),'endElasticGradient':vec(elastic1),'truth':truths})
    assert reviewer.helper_inventory() == helpers_before
    assert args.reviewer.read_bytes() == reviewer_bytes and Path(__file__).read_bytes() == source_bytes
    assert sha(args.capture.read_bytes()) == CAPTURE and sha(args.selected_review.read_bytes()) == REVIEW
    assert subprocess.check_output(['git','status','--porcelain'],cwd=repo,text=True) == ''
    proof = {'schema':'pliego-first-accepted-newton-defect/1','postHocDiagnostic':True,'acceptedCapture':False,
        'selectionPolicy':'first-accepted role in each of all24 trajectories; no magnitude/pass filtering; identical21 raw state bindings+native reference+state identity+F0/tau deduplicated',
        'selectedRoleReferences':len(selections),'uniqueEvents':len(results),'uniqueStartLinearizations':len(linearizations),'selections':selections,
        'identityMeaning':'actual d is exact rational difference of captured endpoint words, not the rounded subtraction buffer; both are retained',
        'decomposition':'g1 = [g0+(H_GN+C)d] + [(H_exact-H_GN)d] + [g1-g0-(H_exact+C)d]',
        'source':{'git':GIT,'scriptSHA256':sha(source_bytes),'captureSHA256':CAPTURE,'selectedReviewSHA256':REVIEW,
                  'frozenReviewerSHA256':REVIEWER,'unchangedOracleHelpers':helpers_before,'sourceUnchanged':True},
        'geometry':{k:group[k] for k in ('vertices','triangles','material','geometry')},'referenceCoefficients':rows[0]['referenceCoefficients'],
        'linearizations':linearizations,'results':results,'checks':reviewer.checks,
        'scope':'four unique actual first accepted direct/full-alpha Newton events only; native rounded C and exact real M/h² separately; exact represented selected law, not ideal material truth; no new solve, gate, full-trajectory, time/material/booklet/device acceptance'}
    out=args.out.resolve()
    assert repo not in out.parents and (out.parent.stat().st_mode&0o777)==0o700
    fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:json.dump(proof,f,sort_keys=True,separators=(',',':'),allow_nan=False);f.write('\n')
    print(json.dumps({'outputSHA256':sha(out.read_bytes()),'selectedReferences':24,'uniqueEvents':len(results),'uniqueStartLinearizations':len(linearizations),
        'summary':[{'level':r['selections'][0]['level'],'native':{k:v['approximate'] for k,v in r['truth']['nativeCoefficient']['infinityNormsMicroN'].items()},
                    'nativeFinalPass':r['truth']['nativeCoefficient']['finalGradientPassesOriginalTau']} for r in results]},indent=2))


if __name__ == '__main__':
    main()
