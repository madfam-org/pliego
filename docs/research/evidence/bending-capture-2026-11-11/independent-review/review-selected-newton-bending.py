"""Read-only review of selected actual reference-state Newton trials WITH latent panel bending.

No solver or World is executed. Every planar check of the frozen planar reviewer runs unchanged
(imported by path, SHA-pinned, never copied): lossless bindings, native identities, last-trial
reconstruction, decision flags, exact rational represented membrane at q = X0+u, and inertia
with native rounded C = fl(M*fl(1/fl(h*h))) and real M/h^2 kept separate. This file adds the
bending energy change between the evaluated start and the last evaluated trial.

What is exact and what is not:
  * membrane change, membrane start gradient, inertia change/gradient, captured slope and the
    recorded slope word are exact rationals;
  * bending is transcendental: theta_h = atan2(S, |e| R) with S, R, |e|^2 exact rationals of the
    latent geometry, |e| a correctly rounded Decimal sqrt and atan2 from bending-state-precision.py
    (argument reduction + alternating series; relative error < 10^-(p-2) at working precision
    p = digits + GUARD). Each continued angle therefore has absolute error < pi*10^-(digits+10)
    and we use the deliberately loose eps = 4*10^-digits per angle. With d = theta - rest,
    |error of k(d1^2 - d0^2)/2| <= k*eps*(|d0| + |d1| + eps); the start-gradient linear term is
    bounded by 10^-digits * sum_j |delta_j| * sum_h |k_h d_h dtheta_h/dx_j| (per-hinge contributions
    can cancel inside one component, so a componentwise relative bound would be wrong); Decimal conversion of the exact membrane+inertia part adds
    10^-(p-1) relative. Every Armijo verdict is labelled certain only when |margin| exceeds the
    summed bound, and the whole bending evaluation is repeated at 80 and 100 digits, which must
    agree within the 80-digit bound with identical verdicts (internal check).
The continuation (World theta during the substep) is the bound `theta` of the trajectory history
entry of the previous completed substep, tied to the record by its bound u = the record's us.
Selected records cannot certify all events, omitted backtracks, or force/time/material gates.
"""
import argparse
import gzip
import hashlib
import importlib.util
import json
import math
import os
import sys
import time
from collections import Counter
from decimal import Decimal as D, localcontext
from fractions import Fraction as F
from pathlib import Path

sys.dont_write_bytecode = True
PLANAR_SOURCE = Path(__file__).resolve().parents[2] / 'state-matrix-pcg-force-stop-2026-11-10/independent-review/review-selected-newton.py'
PLANAR_SHA256 = 'aaec559930f911fc6747ef707d8bc539a092cc640e6fd58fe2f1ae73adcc16c0'
MATRIX = 'pliego-bending-state-audit/1'
SMALL = 'pliego-selected-newton-bending-small-fixture/1'
DIGITS = (80, 100)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


if hashlib.sha256(PLANAR_SOURCE.read_bytes()).hexdigest() != PLANAR_SHA256:
    raise SystemExit('frozen planar reviewer bytes changed; refusing')
PLANAR = load('frozen_planar_selected_newton_reviewer', PLANAR_SOURCE)
sha, words, canonical, rational, quantity = PLANAR.sha, PLANAR.words, PLANAR.canonical, PLANAR.rational, PLANAR.quantity


def high(x, bound=None):
    item = {'approximate': float(x), 'decimal': format(x, '.40e')}
    if bound is not None:
        item['absoluteErrorBound'] = float(bound)
    return item


class BendingReviewer(PLANAR.Reviewer):
    def __init__(self, repo):
        super().__init__(repo)
        self.bending = load('selected_bending_oracle', repo / 'packages/engine/bench/bending-state-precision.py')
        self.identity = {**self.oracle.IDENTITY, 'bending': self.bending.BENDING_IDENTITY}
        self._decoded = None

    def decode_record(self, r):
        self._decoded = super().decode_record(r)
        return self._decoded

    def bending_inputs(self, group, row, event, a):
        """Hinges, k, rest and the continuation in force during this record's substep."""
        ref = row['referenceWords']
        k = self.decode(ref['stateFloat64LE']['hingeK'], ref['stateSHA256']['hingeK'], None, 'hingeK')
        records = group['reference']['hinges']
        self.check(len(records) == len(k) and all(r['index'] == i for i, r in enumerate(records)), 'reference hinges in native order')
        self.check(all(words([r['kBinary64']]) == words([k[i]]) for i, r in enumerate(records)), 'native hingeK equals reference hinge law words')
        hinges, n = [r['vertices'] for r in records], len(a['startU']) // 3
        self.check(all(len(h) == 4 and len(set(h)) == 4 and all(type(i) is int and 0 <= i < n for i in h) for h in hinges), 'hinge quadruples')
        history = row['history'][event['substepsRun']]
        self.check(history['step'] == event['substepsRun'], 'continuation history entry is the previous completed substep')
        enc, dig = history['stateFloat64LE'], history['stateSHA256']
        theta = self.decode(enc['theta'], dig['theta'], history['hingeAngles'], 'continuation theta')
        rest = self.decode(enc['restTheta'], dig['restTheta'], None, 'restTheta')
        self.check(enc['hingeK'] == ref['stateFloat64LE']['hingeK'] and dig['hingeK'] == ref['stateSHA256']['hingeK'], 'history hingeK words')
        self.check(enc['u'] == event['stateFloat64LE']['us'] and dig['u'] == event['stateSHA256']['us'], 'continuation entry u equals the record us')
        self.check(len(theta) == len(rest) == len(hinges) and all(t == 0 for t in rest) and all(x >= 0 for x in k), 'flat rest, nonnegative k, one angle per hinge')
        return hinges, k, rest, theta

    def bending_terms(self, start, end, delta, hinges, k, rest, theta, digits):
        with localcontext() as context:
            context.prec = digits + self.bending.GUARD
            pi, dec = self.bending.decimal_pi(), self.bending.dec
            e0, g0, r0 = self.bending.bending_truth(start, hinges, k, rest, theta, pi)
            e1, _, r1 = self.bending.bending_truth(end, hinges, k, rest, theta, pi)
            eps = 4 * D(10) ** -digits
            change, linear = e1 - e0, sum(g * dec(d) for g, d in zip(g0, delta))
            bound = sum(dec(kh) * eps * (abs(a['theta'] - dec(r)) + abs(b['theta'] - dec(r)) + eps) for kh, r, a, b in zip(k, rest, r0, r1))
            # Hinge contributions to one gradient component can cancel, so the bound uses the sum of
            # absolute per-hinge contributions |k d_h dtheta_h/dx_j| (each relative error < 10^-digits).
            magnitude = [D(0)] * len(start)
            for index, ids in enumerate(hinges):
                _, local, _ = self.bending.hinge_angle([start[3 * v + c] for v in ids for c in range(3)], pi)
                lever = abs(dec(k[index]) * (r0[index]['theta'] - dec(rest[index])))
                for i, v in enumerate(ids):
                    for c in range(3):
                        magnitude[3 * v + c] += lever * abs(local[3 * i + c])
            linear_bound = D(10) ** -digits * sum(m * abs(dec(d)) for m, d in zip(magnitude, delta))
            return {'change': change, 'linear': linear, 'remainder': change - linear, 'gradient': g0, 'bound': bound, 'linearBound': linear_bound,
                    'turns': [r['turns'] for r in r0 + r1], 'margin': min(r['margin'] for r in r0 + r1),
                    'theta0': max(abs(r['theta']) for r in r0), 'dtheta': max(abs(b['theta'] - a['theta']) for a, b in zip(r0, r1))}

    def event(self, group, row, event, selection):
        started = time.perf_counter()
        self.check(event['stateIdentity'] == self.identity, 'explicit authoritative identity with latent panel bending')
        # The frozen planar checks expect the planar identity; the bending part was checked just above.
        result = super().event(group, row, {**event, 'stateIdentity': self.oracle.IDENTITY}, selection)
        a, last = self._decoded, event['increment']['last']
        planar_truth, result['truth'] = result['truth'], {}
        if not planar_truth:
            result['bending'] = {'evaluated': False, 'reason': 'planar reviewer made no finite represented-law claim'}
            result['seconds'] = time.perf_counter() - started
            return result
        hinges, k, rest, theta = self.bending_inputs(group, row, event, a)
        n = len(a['startU'])
        origin, elements = self.geometry(group, row, n)
        start, end, target = [[F(x) for x in a[key]] for key in ('startU', 'lastTrialU', 'ut')]
        delta = [x - y for x, y in zip(end, start)]
        points = [[F(x0) + u for x0, u in zip(origin, p)] for p in (start, end)]
        try:
            terms = {d: self.bending_terms(points[0], points[1], delta, hinges, k, rest, theta, d) for d in DIGITS}
        except ValueError as error:
            self.check(last['decision'] != 'accepted', 'accepted trial has a valid unambiguous bending geometry')
            result['bending'] = {'evaluated': False, 'reason': str(error)}
            result['classification'] = 'nonaccepted last trial without a valid bending geometry'
            result['seconds'] = time.perf_counter() - started
            return result
        lo, hi = terms[80], terms[100]
        for key, bound in (('change', 'bound'), ('linear', 'linearBound')):
            self.check(abs(lo[key] - hi[key]) <= lo[bound], '80/100-digit bending ' + key + ' agree within the declared bound')
        self.check(lo['turns'] == hi['turns'] and all(t == 0 for t in hi['turns']), 'principal continuation branch in this capture')
        u0, g0, _, _ = self.oracle.assemble(points[0], elements)
        u1, _, _, _ = self.oracle.assemble(points[1], elements)
        h, c1 = a['h'][0], F(event['incrementTrial']['runtime']['c1'])
        coefficients = {'nativeCoefficient': [F(a['mass'][i // 3] * (1 / (h * h))) for i in range(n)],
                        'realMass': [F(a['mass'][i // 3]) / F(h) ** 2 for i in range(n)]}
        zero = result['realTrialStepZero']
        captured_slope = sum(F(g) * d for g, d in zip(a['gradient'], delta))
        recorded_slope = F(last['slope']) if last.get('slope') is not None else None
        dec = self.bending.dec
        with localcontext() as context:
            context.prec = 100 + self.bending.GUARD
            precision = D(10) ** -(context.prec - 1)
            for label, c in coefficients.items():
                inertia = sum(z * ((x1 - t) ** 2 - (x0 - t) ** 2) / 2 for z, x1, x0, t in zip(c, end, start, target))
                exact = u1 - u0 + inertia
                self.check(quantity(exact) == planar_truth[label]['deltaPotentialNJ'], 'membrane+inertia change equals the frozen planar evaluation')
                total = dec(exact) + hi['change']
                bound = hi['bound'] + precision * (abs(dec(exact)) + abs(hi['change']))
                planar_gradient = [g + z * (u - t) for g, z, u, t in zip(g0, c, start, target)]
                true_gradient = [dec(p) + b for p, b in zip(planar_gradient, hi['gradient'])]
                exact_slope = dec(sum(p * d for p, d in zip(planar_gradient, delta))) + hi['linear']
                slope_bound = hi['linearBound'] + precision * abs(exact_slope)

                def verdict(slope, slope_error):
                    if slope is None:
                        return {'available': False}
                    s = slope if isinstance(slope, D) else dec(slope)
                    margin = dec(c1) * s - total
                    uncertainty = bound + dec(c1) * slope_error
                    return {'available': True, 'slopeNJ': high(s, slope_error), 'armijoRhsNJ': high(dec(c1) * s), 'marginNJ': high(margin, uncertainty),
                            'strictRealArmijo': (not zero) and s < 0 and margin >= 0, 'certain': abs(margin) > uncertainty or zero}
                mi_only = (not zero) and recorded_slope is not None and recorded_slope < 0 and exact <= c1 * recorded_slope
                captured_error = max(abs(dec(F(g)) - t) for g, t in zip(a['gradient'], true_gradient))
                result['truth'][label] = {
                    'membraneInertiaChangeNJ': quantity(exact), 'bendingChangeNJ': high(hi['change'], hi['bound']), 'totalChangeNJ': high(total, bound),
                    'recordedSlope': verdict(recorded_slope, D(0)), 'capturedGradientSlope': verdict(captured_slope, D(0)), 'exactGradientSlope': verdict(exact_slope, slope_bound),
                    'positivePotentialChange': total > 0, 'membraneInertiaOnlyRecordedSlopeArmijo': mi_only,
                    'recordedDeltaMinusTrueChangeNJ': float(dec(F(last['delta'])) - total) if last.get('delta') is not None else None,
                    'capturedGradientMaximumComponentErrorMicroN': float(captured_error)}
            engine = {key: last.get(key) for key in ('bendingDifference', 'bendingLinear', 'bendingRemainder', 'bendingMagnitude')}
            truth = {'bendingDifference': hi['change'], 'bendingLinear': hi['linear'], 'bendingRemainder': hi['remainder']}
            errors = {key: (float(abs(dec(F(engine[key])) - value)) if engine[key] is not None else None) for key, value in truth.items()}
            scale = engine['bendingMagnitude']
            result['bending'] = {'evaluated': True, 'engine': engine, 'truth': {key: high(value) for key, value in truth.items()},
                'absoluteErrorNJ': errors, 'errorOverEngineMagnitude': {key: (e / scale if e is not None and scale else None) for key, e in errors.items()},
                'changeErrorBoundNJ': float(hi['bound']), 'linearErrorBoundNJ': float(hi['linearBound']),
                'precisionAgreement80vs100': {'change': float(abs(lo['change'] - hi['change'])), 'linear': float(abs(lo['linear'] - hi['linear']))},
                'maximumAbsoluteStartThetaRad': float(hi['theta0']), 'maximumAbsoluteAngleChangeRad': float(hi['dtheta']), 'minimumBranchMarginRad': float(hi['margin'])}
        result['membraneTruthPlanarReviewer'] = planar_truth
        result['classification'] = 'finite exact membrane+inertia and high-precision bending; stationary/no-op never counted as accepted descent'
        result['seconds'] = time.perf_counter() - started
        return result

    def review(self, report, input_identity):
        self.check(report['schema'] in (MATRIX, SMALL), 'bending audit or explicitly small bending fixture schema')
        small, groups = report['schema'] == SMALL, report['results']
        rows_all = [row for g in groups for row in g['trajectories']]
        if not small:
            protocol = report['protocol']
            self.check(report['source']['dirty'] is False and protocol['instrument'] is True, 'clean observed matrix input')
            self.check(protocol['trajectories'] == 24 == len(rows_all) and protocol['poststeps'] == sum(r['steps'] for r in rows_all) and
                       protocol['newtonEvents'] == sum(r['steps'] * r['budget'] for r in rows_all), 'fixed declared 24-row scope')
            for item in report['source']['files']:
                p = Path(item['path'])
                self.check(not p.is_absolute() and '..' not in p.parts, 'source path confined')
                b = (self.repo / p).read_bytes()
                self.check(sha(b) == item['sha256'] and len(b) == item['bytes'], 'captured source bytes ' + p.as_posix())
        rows, role_count, all_events, seen = [], 0, 0, set()
        for gi, group in enumerate(groups):
            for ti, row in enumerate(group['trajectories']):
                identity = (gi, row['level'], row['budget'], row['seed'])
                self.check(identity not in seen, 'unique trajectory identity')
                seen.add(identity)
                trace = row['solveObservation']['trace']
                self.check([e['iteration'] for e in trace] == list(range(1, len(trace) + 1)) and len(trace) == row['steps'] * row['budget'], 'all scalar event IDs consecutive and complete')
                self.check([e['step'] for e in row['history']] == list(range(row['steps'] + 1)), 'complete continuation history')
                pose = json.dumps([e['stateSHA256'] for e in row['history']], separators=(',', ':'), ensure_ascii=False).encode()
                self.check(sha(pose) == row['poseHistorySHA256'], 'pose history hashes bind every continuation entry')
                all_events += len(trace)
                selected = {}
                for role, event in row['solveObservation']['snapshots'].items():
                    role_count += 1
                    key = (event['substepsRun'], event['iteration'])
                    if key in selected:
                        self.check(canonical(selected[key]['event']) == canonical(event), 'all duplicate roles bind identical actual event')
                        selected[key]['roles'].append(role)
                    else:
                        selected[key] = {'event': event, 'roles': [role]}
                for (substep, iteration), item in sorted(selected.items()):
                    self.check(iteration == substep * row['budget'] + (iteration - 1) % row['budget'] + 1 and 0 <= substep < row['steps'], 'selected identity inside declared judged budget')
                    scalar = trace[iteration - 1]
                    self.check(scalar['substepsRun'] == substep and scalar['increment'] == item['event']['increment'] and scalar['lineSearch'] == item['event']['lineSearch'],
                               'selected full event agrees with all-event decision trace')
                    selection = {'groupIndex': gi, 'trajectoryIndex': ti, 'level': row['level'], 'budget': row['budget'], 'seed': row['seed'],
                                 'substepsRun': substep, 'iteration': iteration, 'roles': sorted(item['roles'])}
                    rows.append(self.event(group, row, item['event'], selection))
        self.check(len(rows) > 0 and self.helper_inventory() == self.helpers, 'selected events and immutable helper source')
        counts = {}
        for label in ('nativeCoefficient', 'realMass'):
            evaluated = [r for r in rows if label in r['truth']]
            accepted = [r['truth'][label] for r in evaluated if r['decision'] == 'accepted']
            nonzero_rejected = [r['truth'][label] for r in evaluated if r['decision'] == 'rejected' and not r['realTrialStepZero']]
            counts[label] = {'selectedTrialsEvaluated': len(evaluated), 'acceptedEvaluated': len(accepted),
                **{'wrongAccepted' + k[0].upper() + k[1:] + 'Armijo': sum(not t[k]['strictRealArmijo'] for t in accepted) for k in ('recordedSlope', 'capturedGradientSlope', 'exactGradientSlope')},
                'rejectedNonzeroPassingRecordedSlopeArmijo': sum(t['recordedSlope'].get('strictRealArmijo', False) for t in nonzero_rejected),
                'positiveAcceptedPotential': sum(t['positivePotentialChange'] for t in accepted),
                'uncertainVerdicts': sum(not t[k]['certain'] for t in (r['truth'][label] for r in evaluated) for k in ('recordedSlope', 'capturedGradientSlope', 'exactGradientSlope') if t[k]['available']),
                'bendingDecisiveForRecordedSlopeVerdict': sum(t['membraneInertiaOnlyRecordedSlopeArmijo'] != t['recordedSlope'].get('strictRealArmijo') for t in (r['truth'][label] for r in evaluated))}
        bend = [r['bending'] for r in rows if r.get('bending', {}).get('evaluated')]
        worst = {key: max((b['absoluteErrorNJ'][key] for b in bend if b['absoluteErrorNJ'][key] is not None), default=None) for key in ('bendingDifference', 'bendingLinear', 'bendingRemainder')}
        worst_relative = {key: max((b['errorOverEngineMagnitude'][key] for b in bend if b['errorOverEngineMagnitude'][key] is not None), default=None) for key in worst}
        return {'schema': 'pliego-selected-newton-bending-review/1', 'input': input_identity,
                'inputScope': 'ordinary small bending test fixture; no accepted full capture' if small else 'clean fixed 24-row bending matrix selected Newton records',
                'checks': self.checks, 'decodedFloat64Words': self.decoded, 'source': self.helpers,
                'planarReviewer': {'file': PLANAR_SOURCE.name, 'sha256': PLANAR_SHA256, 'use': 'imported by path, unchanged; all planar event checks run first'},
                'selection': {'roleReferences': role_count, 'uniqueEvents': len(rows), 'allScalarEventsRetained': all_events,
                              'deduplication': 'trajectory+substepsRun+iteration; all roles preserved; identical full bytes/values required'},
                'decisions': dict(Counter(r['decision'] for r in rows)), 'counts': counts,
                'bendingTermErrors': {'maximumAbsoluteNJ': worst, 'maximumOverEngineMagnitude': worst_relative, 'evaluated': len(bend)},
                'timing': {'seconds': [r['seconds'] for r in rows], 'maximumSecondsPerRecord': max(r['seconds'] for r in rows), 'scope': 'wall clock; excluded from any determinism claim'},
                'events': rows, 'integrityPassed': True, 'allNewtonEventsRealArmijoCertified': False,
                'scope': 'only selected last actually evaluated trial endpoints; not unretained backtracks, all Newton events, force/time/material/booklet or interaction acceptance',
                'arithmetic': {'membrane': 'exact rational direct FTF-ATA and independent Piola gradient at real X0+u (frozen planar reviewer + membrane-state-precision.py)',
                    'inertia': 'exact; nativeCoefficient = fl(M*fl(1/fl(h*h))) exactly, realMass = M/h^2 exactly', 'bending': __doc__.split('What is exact and what is not:')[1].split('The continuation')[0].strip(),
                    'recordedSlope': 'the engine increment record slope word, exact', 'capturedSlope': 'exact rational captured binary64 gradient times exact endpoint difference',
                    'exactGradientSlope': 'exact membrane+inertia start gradient plus high-precision bending start gradient, times exact endpoint difference',
                    'c1': rational(F(1e-4)), 'zeroStep': 'reported separately; never accepted as strict descent', 'digits': list(DIGITS)}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo', type=Path, required=True)
    p.add_argument('--input', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    repo, out = args.repo.resolve(), args.out.resolve()
    if out.is_relative_to(repo) or str(out).startswith(('/tmp/', '/private/tmp/', '/var/folders/')):
        p.error('output must be durable and outside checkout')
    if out.parent.stat().st_mode & 0o077:
        p.error('output directory must be mode0700')
    fd = os.open(out, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        raw = args.input.read_bytes()
        decoded = gzip.decompress(raw) if args.input.suffix == '.gz' else raw
        reviewer = BendingReviewer(repo)
        result = reviewer.review(json.loads(decoded), {'file': args.input.name, 'bytes': len(raw), 'sha256': sha(raw), 'decodedBytes': len(decoded), 'decodedSHA256': sha(decoded)})
        own = Path(__file__).read_bytes()
        result['reviewer'] = {'file': Path(__file__).name, 'bytes': len(own), 'sha256': sha(own)}
        with os.fdopen(fd, 'wb') as stream:
            fd = None
            stream.write(json.dumps(result, indent=2, allow_nan=False).encode() + b'\n')
        print(json.dumps({'integrityPassed': True, 'selection': result['selection'], 'counts': result['counts'], 'bendingTermErrors': result['bendingTermErrors']}), file=sys.stderr)
    finally:
        if fd is not None:
            os.close(fd)


if __name__ == '__main__':
    main()
