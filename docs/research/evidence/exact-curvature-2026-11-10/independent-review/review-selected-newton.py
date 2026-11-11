"""Read-only exact rational review of selected actual reference-state Newton trials.

No solver or World is executed. Last evaluated trial differs from a restored final
endpoint. Exact q=X0+u direct-metric/Piola helpers evaluate the represented native
reference polynomial; native rounded C and real M/h² remain separate. Selected
records cannot certify all events, omitted backtracks, force/time/material gates.
"""
import argparse
import base64
import gzip
import hashlib
import importlib.util
import json
import math
import os
import struct
import sys
from collections import Counter
from fractions import Fraction as F
from pathlib import Path

sys.dont_write_bytecode = True
MATRIX = 'pliego-membrane-state-modal-audit/1'
SMALL = 'pliego-selected-newton-small-fixture/1'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def words(a):
    return b''.join(struct.pack('<d', float(x)) for x in a)


def canonical(a):
    return json.dumps(a, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def rational(x):
    return {'numerator': str(x.numerator), 'denominator': str(x.denominator)}


def quantity(x):
    return {'approximate': float(x), 'exact': rational(x)}


class Reviewer:
    def __init__(self, repo):
        self.repo, self.checks, self.decoded = repo, 0, 0
        source = repo / 'packages/engine/bench/membrane-state-precision.py'
        spec = importlib.util.spec_from_file_location('selected_state_oracle', source)
        self.oracle = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.oracle)
        self.helpers = self.helper_inventory()

    def check(self, ok, label):
        self.checks += 1
        if not ok:
            raise AssertionError(label)

    def helper_inventory(self):
        # Include the full transitive bench Python source set rather than guessing
        # which nested import a future source version might use.
        return [{'path': p.relative_to(self.repo).as_posix(), 'bytes': len(b), 'sha256': sha(b)}
                for p in sorted((self.repo / 'packages/engine/bench').glob('*.py'))
                for b in [p.read_bytes()]]

    def decode(self, encoded, digest, numeric=None, label='vector'):
        raw = base64.b64decode(encoded, validate=True)
        self.check(base64.b64encode(raw).decode() == encoded and len(raw) % 8 == 0, label + ' encoding')
        self.check(sha(raw) == digest, label + ' SHA256')
        a = list(struct.unpack('<' + 'd' * (len(raw) // 8), raw))
        if numeric is not None:
            self.check(len(a) == len(numeric), label + ' numeric dimensions')
            self.check(all((math.isfinite(x) and type(y) in (int, float) and x == y) or
                           (not math.isfinite(x) and y is None) for x, y in zip(a, numeric)), label + ' JSON view')
        self.decoded += len(a)
        return a

    def decode_record(self, r):
        enc, dig = r['stateFloat64LE'], r['stateSHA256']
        self.check(enc.keys() == dig.keys(), 'all event binding keys')
        a = {}
        for k in enc:
            v = [r[k]] if k == 'h' else r.get(k)
            if k in ('nominalDirection', 'realizedDirection'):
                v = r[k[:-9]]['direction']
            a[k] = self.decode(enc[k], dig[k], v, k)
        return a

    def geometry(self, group, row, n):
        ref = row['referenceWords']
        c = {'vertices': group['vertices'], 'triangles': group['triangles'], 'material': group['material'],
             'grain': group['geometry']['grain'], 'referenceCoefficients': row['referenceCoefficients'],
             'referenceFloat64LE': ref['stateFloat64LE']['reference'], 'referenceSHA256': ref['stateSHA256']['reference']}
        origin, elements, binding = self.oracle.configuration(c, n)
        self.check(binding['referenceLosslessSupplied'], 'native reference losslessly bound')
        return origin, elements

    def event(self, group, row, event, selection):
        a = self.decode_record(event)
        required = {'startU', 'candidateU', 'afterU', 'lastTrialU', 'startX', 'candidatePublicBeforeFinish',
                    'afterX', 'lastTrialX', 'us', 'ut', 'xs', 'xt', 'x0', 'mass', 'h', 'gradient',
                    'acceptedRealizedDirection', 'packedDirection', 'nominalDirection', 'realizedDirection'}
        self.check(required == a.keys(), 'complete actual selected event packet')
        n = len(a['startU'])
        self.check(n % 3 == 0 and len(a['mass']) == n // 3 and len(a['h']) == 1, 'native dimensions')
        self.check(all(len(v) == n for k, v in a.items() if k not in ('mass', 'h')), 'all state dimensions')
        self.check(event['h'] == row['h'] == a['h'][0] and event['forceScale'] == row['fixedForceScale'] and
                   event['forceTolerance'] == row['forceTolerance'] == max(1e-7, 1e-10 * event['forceScale']), 'fixed native h/F0/tau')
        self.check(words(a['mass']) == words(row['runtime']['massProof']['native']), 'actual native masses')
        self.check(event['stateCoordinates'] == 'reference-displacement' and event['stateIdentity'] == self.oracle.IDENTITY,
                   'explicit authoritative identity')
        origin, elements = self.geometry(group, row, n)
        self.check(words(origin) == words(a['x0']), 'immutable actual reference origin')
        for u, x in [('startU', 'startX'), ('afterU', 'afterX'), ('lastTrialU', 'lastTrialX')]:
            self.check(words([x0 + z for x0, z in zip(origin, a[u])]) == words(a[x]), 'actual rounded projection ' + x)
        self.check(words(a['candidatePublicBeforeFinish']) == words(a['startX']), 'stale public candidate explicitly distinct')
        trial = event['incrementTrial']
        self.check(trial['coordinates'] == 'reference-displacement', 'trial coordinates')
        binding = {'beforeU': 'startU', 'trialU': 'lastTrialU', 'ut': 'ut', 'mass': 'mass', 'h': 'h', 'gradient': 'gradient'}
        self.check(trial['stateFloat64LE'].keys() == binding.keys() == trial['stateSHA256'].keys(), 'trial binding keys')
        for k, top in binding.items():
            v = [trial[k]] if k == 'h' else trial[k]
            self.decode(trial['stateFloat64LE'][k], trial['stateSHA256'][k], v, 'trial.' + k)
            self.check(trial['stateFloat64LE'][k] == event['stateFloat64LE'][top] and
                       trial['stateSHA256'][k] == event['stateSHA256'][top], 'trial/raw endpoint association ' + k)
        last, line = trial['runtime'], event['lineSearch']
        self.check({k: v for k, v in last.items() if k != 'c1'} == event['increment']['last'], 'actual last decision packet')
        decision = last['decision']
        self.check(decision in ('accepted', 'stationary-noop', 'precision-limited-zero-step', 'rejected'), 'named actual decision')
        self.check(line['decision'] == decision and line['accepted'] == (decision == 'accepted') and
                   line['stationaryNoop'] == (decision == 'stationary-noop') and
                   line['precisionLimited'] == (decision == 'precision-limited-zero-step') and
                   line['rejected'] == (decision in ('rejected', 'precision-limited-zero-step')), 'decision flags')
        self.check(type(last['trials']) is int and 1 <= last['trials'] <= 21 and
                   last['alpha'] == 2 ** -(last['trials'] - 1) and line['trials'] == last['trials'] and last['c1'] == 1e-4,
                   'actual trial count/alpha/native c1')
        reconstructed = a['candidateU'] if last['trials'] == 1 else [u + last['alpha'] * (c - u) for u, c in zip(a['startU'], a['candidateU'])]
        self.check(words(reconstructed) == words(a['lastTrialU']), 'last actual native interpolation expression')
        if decision == 'accepted':
            self.check(words(a['afterU']) == words(a['lastTrialU']), 'accepted endpoint equals last evaluated trial')
        elif decision != 'stationary-noop':
            self.check(words(a['afterU']) == words(a['startU']), 'nonaccepted final endpoint restored independently')
        result = {'selection': selection, 'decision': decision, 'observerValid': event['valid'], 'observerMissing': event['missing'],
                  'stateSHA256': event['stateSHA256'], 'referenceSHA256': row['referenceWords']['stateSHA256']['reference'],
                  'lastTrialEqualsFinalBytes': words(a['lastTrialU']) == words(a['afterU']), 'truth': {}}
        finite = all(math.isfinite(x) for v in a.values() for x in v)
        if not finite:
            self.check(decision != 'accepted', 'accepted event cannot lack finite exact represented-law truth')
            result['classification'] = 'nonfinite nonaccepted trial; raw evidence retained, no rational Armijo claim'
            return result
        self.check(all(m > 0 for m in a['mass']) and a['h'][0] > 0, 'positive mass/timestep')
        start, end, target = [[F(x) for x in a[k]] for k in ('startU', 'lastTrialU', 'ut')]
        delta = [x - y for x, y in zip(end, start)]
        zero = all(x == 0 for x in delta)
        result['realTrialStepZero'] = zero
        if decision in ('stationary-noop', 'precision-limited-zero-step'):
            self.check(zero, 'named zero-step decision is exact endpoint no-op')
        if decision == 'stationary-noop':
            self.check(all(g == 0 for g in a['gradient']) and all(F(x) == y for x, y in zip(a['afterU'], start)), 'physical stationary final/no gradient')
        points = [[F(x0) + u for x0, u in zip(origin, p)] for p in (start, end)]
        u0, g0, _, _ = self.oracle.assemble(points[0], elements)
        try:
            u1, _, _, _ = self.oracle.assemble(points[1], elements)
        except ValueError as error:
            self.check(decision != 'accepted', 'accepted trial has valid represented metric')
            result['classification'] = 'invalid represented metric of nonaccepted last trial'
            result['metricError'] = str(error)
            return result
        h = a['h'][0]
        coeff = {'nativeCoefficient': [F(a['mass'][i // 3] * (1 / (h * h))) for i in range(n)],
                 'realMass': [F(a['mass'][i // 3]) / F(h) ** 2 for i in range(n)]}
        captured_slope = sum(F(g) * d for g, d in zip(a['gradient'], delta))
        captured_rhs = F(last['c1']) * captured_slope
        result['capturedGradientSlopeNJ'] = quantity(captured_slope)
        for label, c in coeff.items():
            inertia = sum(z * ((a1 - t) ** 2 - (b - t) ** 2) / 2 for z, a1, b, t in zip(c, end, start, target))
            change = u1 - u0 + inertia
            true_gradient = [g + z * (u - t) for g, z, u, t in zip(g0, c, start, target)]
            slope = sum(g * d for g, d in zip(true_gradient, delta))
            rhs = F(last['c1']) * slope
            error = max(abs(F(g) - truth) for g, truth in zip(a['gradient'], true_gradient))
            result['truth'][label] = {'deltaPotentialNJ': quantity(change), 'exactGradientSlopeNJ': quantity(slope),
                'exactGradientArmijoRhsNJ': quantity(rhs), 'exactGradientMarginNJ': quantity(rhs - change),
                'capturedGradientArmijoRhsNJ': quantity(captured_rhs), 'capturedGradientMarginNJ': quantity(captured_rhs - change),
                'exactGradientStrictRealArmijo': not zero and slope < 0 and change <= rhs,
                'capturedGradientStrictRealArmijo': not zero and captured_slope < 0 and change <= captured_rhs,
                'positivePotentialChange': change > 0, 'capturedGradientMaximumComponentErrorMicroN': quantity(error)}
        result['classification'] = 'finite exact represented-law trial; stationary/no-op never counted as accepted descent'
        return result

    def review(self, report, input_identity):
        self.check(report['schema'] in (MATRIX, SMALL), 'dedicated captured matrix or explicitly small test fixture schema')
        small = report['schema'] == SMALL
        groups = report['results']
        if not small:
            self.check(report['source']['dirty'] is False and report['protocol']['instrument'] is True, 'clean observed matrix input')
            self.check(report['protocol']['trajectories'] == 24 and report['protocol']['poststeps'] == 7110 and
                       report['protocol']['newtonEvents'] == 49770, 'fixed declared24 scope')
            self.check(sum(len(g['trajectories']) for g in groups) == 24, 'all requested rows represented')
            for item in report['source']['files']:
                p = Path(item['path'])
                self.check(not p.is_absolute() and '..' not in p.parts, 'source path confined')
                b = (self.repo / p).read_bytes()
                self.check(sha(b) == item['sha256'] and len(b) == item['bytes'], 'captured source bytes ' + p.as_posix())
        rows, role_count, selected_count, all_events = [], 0, 0, 0
        seen_rows = set()
        for gi, group in enumerate(groups):
            for ti, row in enumerate(group['trajectories']):
                identity = (gi, row['level'], row['budget'], row['seed'])
                self.check(identity not in seen_rows, 'unique trajectory identity')
                seen_rows.add(identity)
                selected, previous = {}, None
                for event in row['solveObservation']['trace']:
                    self.check(event['iteration'] == (1 if previous is None else previous + 1), 'all scalar event IDs consecutive')
                    previous = event['iteration']
                all_events += len(row['solveObservation']['trace'])
                for role, event in row['solveObservation']['snapshots'].items():
                    role_count += 1
                    key = (event['substepsRun'], event['iteration'])
                    if key in selected:
                        self.check(canonical(selected[key]['event']) == canonical(event), 'all duplicate roles bind identical actual event')
                        selected[key]['roles'].append(role)
                    else:
                        selected[key] = {'event': event, 'roles': [role]}
                for (substep, iteration), item in sorted(selected.items()):
                    self.check(iteration == substep * row['budget'] + (iteration - 1) % row['budget'] + 1 and
                               0 <= substep < row['steps'], 'selected identity falls inside declared judged budget')
                    scalar = next(x for x in row['solveObservation']['trace'] if x['iteration'] == iteration)
                    self.check(scalar['substepsRun'] == substep and scalar['increment'] == item['event']['increment'] and
                               scalar['lineSearch'] == item['event']['lineSearch'], 'selected full event agrees with all-event decision trace')
                    selection = {'groupIndex': gi, 'trajectoryIndex': ti, 'level': row['level'], 'budget': row['budget'],
                                 'seed': row['seed'], 'substepsRun': substep, 'iteration': iteration, 'roles': sorted(item['roles'])}
                    rows.append(self.event(group, row, item['event'], selection))
                    selected_count += 1
        self.check(selected_count > 0 and self.helper_inventory() == self.helpers, 'selected events and immutable helper source')
        decisions = Counter(r['decision'] for r in rows)
        counts = {}
        for label in ('nativeCoefficient', 'realMass'):
            accepted = [r['truth'][label] for r in rows if r['decision'] == 'accepted' and label in r['truth']]
            evaluated = [r['truth'][label] for r in rows if label in r['truth']]
            counts[label] = {'acceptedEvaluated': len(accepted), 'wrongAcceptedExactGradientArmijo': sum(not t['exactGradientStrictRealArmijo'] for t in accepted),
                'wrongAcceptedCapturedGradientArmijo': sum(not t['capturedGradientStrictRealArmijo'] for t in accepted),
                'positiveAcceptedPotential': sum(t['positivePotentialChange'] for t in accepted), 'selectedTrialsEvaluated': len(evaluated)}
        return {'schema': 'pliego-selected-newton-exact-review/1', 'input': input_identity, 'inputScope': 'ordinary small test fixture; no accepted full capture' if small else 'clean fixed24 matrix selected Newton records',
                'checks': self.checks, 'decodedFloat64Words': self.decoded, 'source': self.helpers,
                'selection': {'roleReferences': role_count, 'uniqueEvents': selected_count, 'allScalarEventsRetained': all_events,
                              'deduplication': 'trajectory+substepsRun+iteration; all roles preserved; identical full bytes/values required'},
                'decisions': dict(decisions), 'counts': counts, 'events': rows,
                'integrityPassed': True, 'allNewtonEventsRealArmijoCertified': False,
                'scope': 'only selected last actually evaluated trial endpoints; not unretained backtracks, all49770 events, force/time/material/booklet or interaction acceptance',
                'arithmetic': {'geometry': 'exact rational direct FTF-ATA and independent Piola gradient at real X0+u',
                    'nativeCoefficient': 'exact interpretation of fl(M*fl(1/fl(h*h)))', 'realMass': 'exact represented M divided by exact represented h squared',
                    'capturedSlope': 'exact rational sum of captured binary64 gradient times exact endpoint difference',
                    'trueSlope': 'independent exact full gradient for each inertia law times exact endpoint difference',
                    'c1': rational(F(1e-4)), 'zeroStep': 'reported separately; never accepted as strict descent'}}


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
        reviewer = Reviewer(repo)
        result = reviewer.review(json.loads(decoded), {'file': args.input.name, 'bytes': len(raw), 'sha256': sha(raw), 'decodedBytes': len(decoded), 'decodedSHA256': sha(decoded)})
        own = Path(__file__).read_bytes()
        result['reviewer'] = {'file': Path(__file__).name, 'bytes': len(own), 'sha256': sha(own)}
        with os.fdopen(fd, 'wb') as stream:
            fd = None
            stream.write(json.dumps(result, indent=2, allow_nan=False).encode() + b'\n')
        print(json.dumps({'integrityPassed': True, 'selection': result['selection'], 'counts': result['counts']}), file=sys.stderr)
    finally:
        if fd is not None:
            os.close(fd)


if __name__ == '__main__':
    main()
