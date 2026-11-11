"""Bounded external bending reviewer tests; no solver, World, or full matrix executed."""
import argparse
import base64
import copy
import hashlib
import importlib.util
import json
import struct
import sys
from pathlib import Path

sys.dont_write_bytecode = True
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--repo', type=Path, required=True)
p.add_argument('--fixture', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
source = Path(__file__).with_name('review-selected-newton-bending.py')
spec = importlib.util.spec_from_file_location('bending_reviewer', source)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
repo, raw = a.repo.resolve(), a.fixture.read_bytes()
fixture = json.loads(raw)
planar_before = m.PLANAR_SOURCE.read_bytes()
# Engine bending terms are binary64 (dihedral on once-rounded latent differences, Neumaier sums):
# a few ulps of the engine's own magnitude is expected; 1e-12 leaves ~1000x margin.
ENGINE_BENDING_RELATIVE = 1e-12


def reviewer():
    return m.BendingReviewer(repo)


def refused(report, pattern):
    try:
        reviewer().review(report, {'file': 'deliberately-corrupted-in-memory'})
    except AssertionError as error:
        assert pattern in str(error), (pattern, str(error))
        return
    raise AssertionError('corruption accepted: ' + pattern)


def rehash(row):
    pose = json.dumps([e['stateSHA256'] for e in row['history']], separators=(',', ':'), ensure_ascii=False).encode()
    row['poseHistorySHA256'] = m.sha(pose)


def rebind(binding, key, values):
    b = b''.join(struct.pack('<d', x) for x in values)
    binding['stateFloat64LE'][key], binding['stateSHA256'][key] = base64.b64encode(b).decode(), hashlib.sha256(b).hexdigest()


proof = reviewer().review(fixture, {'file': a.fixture.name, 'sha256': m.sha(raw)})
assert proof['selection'] == {'roleReferences': 14, 'uniqueEvents': 14, 'allScalarEventsRetained': 160,
    'deduplication': 'trajectory+substepsRun+iteration; all roles preserved; identical full bytes/values required'}, proof['selection']
assert proof['decisions'] == {'accepted': 12, 'rejected': 2}, proof['decisions']
for c in proof['counts'].values():
    assert c['acceptedEvaluated'] == 12 and c['selectedTrialsEvaluated'] == 14
    assert c['wrongAcceptedRecordedSlopeArmijo'] == c['wrongAcceptedCapturedGradientSlopeArmijo'] == c['wrongAcceptedExactGradientSlopeArmijo'] == 0
    assert c['positiveAcceptedPotential'] == c['uncertainVerdicts'] == c['rejectedNonzeroPassingRecordedSlopeArmijo'] == 0
    assert c['bendingDecisiveForRecordedSlopeVerdict'] > 0, 'bending must matter somewhere in this fixture'
assert all(v <= ENGINE_BENDING_RELATIVE for v in proof['bendingTermErrors']['maximumOverEngineMagnitude'].values())
assert all(e['bending']['evaluated'] for e in proof['events'])  # 80/100 agreement is enforced inside the reviewer
tests = ['ordinary 4-row bending fixture: 14 selected records, both inertia laws, exact membrane+inertia, high-precision bending, 80/100 agreement, engine bending terms within 1e-12 of their magnitude, no wrong accept']
group = fixture['results'][0]

changed = copy.deepcopy(fixture)
for event in changed['results'][0]['trajectories'][0]['solveObservation']['snapshots'].values():
    event['stateSHA256']['startU'] = '0' * 64
refused(changed, 'SHA256')
tests.append('corrupted raw binding rejected')

changed = copy.deepcopy(fixture)
snapshots = changed['results'][0]['trajectories'][0]['solveObservation']['snapshots']
snapshots['deliberately-inconsistent-duplicate-role'] = copy.deepcopy(next(iter(snapshots.values())))
snapshots['deliberately-inconsistent-duplicate-role']['source'] = 'tampered-only-in-test'
refused(changed, 'duplicate roles')
tests.append('conflicting roles for same actual iteration rejected')

changed = copy.deepcopy(fixture)
row = changed['results'][0]['trajectories'][0]
entry = row['history'][3]
entry['hingeAngles'] = [t + 1e-3 for t in entry['hingeAngles']]
refused(changed, 'continuation theta JSON view')
rebind(entry, 'theta', entry['hingeAngles'])
refused(changed, 'pose history hashes')
tests.append('edited continuation angles rejected (JSON view, then consistently re-bound words against the pose-history hash)')

changed = copy.deepcopy(fixture)
row = changed['results'][0]['trajectories'][0]
row['history'][3]['stateFloat64LE']['u'], row['history'][3]['stateSHA256']['u'] = row['history'][2]['stateFloat64LE']['u'], row['history'][2]['stateSHA256']['u']
row['history'][3]['u'] = row['history'][2]['u']
rehash(row)
refused(changed, 'continuation entry u equals the record us')
tests.append('continuation entry not tied to the record us rejected even with a recomputed pose-history hash')

changed = copy.deepcopy(fixture)
for event in changed['results'][0]['trajectories'][0]['solveObservation']['snapshots'].values():
    event['stateIdentity']['bending']['version'] = 3
refused(changed, 'latent panel bending')
tests.append('changed bending identity rejected')

# The numerical classifier must not copy accepted flags: label an actual non-descent rejected trial accepted.
row = next(r for r in group['trajectories'] if r['budget'] == 16 and r['seed'] is False)
event = copy.deepcopy(row['solveObservation']['snapshots']['first-rejected'])
assert event['increment']['last']['slope'] > 0
for key in ('U', 'X'):
    event['after' + key] = event['lastTrial' + key]
    event['stateFloat64LE']['after' + key], event['stateSHA256']['after' + key] = event['stateFloat64LE']['lastTrial' + key], event['stateSHA256']['lastTrial' + key]
event['increment']['last']['decision'] = event['incrementTrial']['runtime']['decision'] = 'accepted'
event['lineSearch'].update(decision='accepted', accepted=True, stationaryNoop=False, precisionLimited=False, rejected=False)
classified = reviewer().event(group, row, event, {'scope': 'synthetic decision-label corruption of an actual non-descent trial; not a solver execution'})
assert all(not t[k]['strictRealArmijo'] and t[k]['certain'] for t in classified['truth'].values() for k in ('recordedSlope', 'capturedGradientSlope', 'exactGradientSlope'))
tests.append('synthetic accepted label on an actual non-descent trial remains a certain Armijo failure under all three slopes and both inertia laws')

assert m.PLANAR_SOURCE.read_bytes() == planar_before and m.sha(planar_before) == m.PLANAR_SHA256
tests.append('frozen planar reviewer byte-identical and SHA-pinned')
result = {'schema': 'pliego-selected-newton-bending-review-tests/1', 'passed': True, 'tests': tests,
    'ordinaryFixtureSHA256': m.sha(raw), 'reviewerSHA256': m.sha(source.read_bytes()), 'planarReviewerSHA256': m.PLANAR_SHA256,
    'ordinaryProofSummary': {k: proof[k] for k in ('checks', 'decodedFloat64Words', 'selection', 'decisions', 'counts', 'bendingTermErrors')},
    'maximumSecondsPerRecord': proof['timing']['maximumSecondsPerRecord'],
    'scope': 'bounded reviewer development checks only; no accepted 24-row matrix, no new solver execution by tests'}
with a.out.open('x') as stream:
    stream.write(json.dumps(result, indent=2) + '\n')
a.out.chmod(0o600)
print(json.dumps({'passed': True, 'tests': len(tests)}))
