"""Bounded external reviewer tests; no solver, World, or full matrix executed."""
import argparse
import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--repo', type=Path, required=True)
p.add_argument('--fixture', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
source = Path(__file__).with_name('review-selected-newton.py')
spec = importlib.util.spec_from_file_location('reviewer', source)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
fixture = json.loads(a.fixture.read_bytes())
r = m.Reviewer(a.repo.resolve())
proof = r.review(fixture, {'file': a.fixture.name, 'sha256': m.sha(a.fixture.read_bytes())})
assert proof['selection'] == {'roleReferences': 10, 'uniqueEvents': 8, 'allScalarEventsRetained': 24,
    'deduplication': 'trajectory+substepsRun+iteration; all roles preserved; identical full bytes/values required'}
assert proof['decisions'] == {'accepted': 5, 'precision-limited-zero-step': 3}
assert all(c['wrongAcceptedExactGradientArmijo'] == c['wrongAcceptedCapturedGradientArmijo'] == c['positiveAcceptedPotential'] == 0 for c in proof['counts'].values())
tests = ['ordinary two-start small fixture independently evaluated; selected roles deduplicated; both inertia laws']
changed = copy.deepcopy(fixture)
snapshots = changed['results'][0]['trajectories'][0]['solveObservation']['snapshots']
for event in snapshots.values():
    event['stateSHA256']['startU'] = '0' * 64
try:
    m.Reviewer(a.repo.resolve()).review(changed, {'file': 'deliberately-corrupted-in-memory'})
except AssertionError as error:
    assert 'SHA256' in str(error)
    tests.append('corrupted raw binding rejected')
else:
    raise AssertionError('corrupted raw binding was accepted')
changed = copy.deepcopy(fixture)
snapshots = changed['results'][0]['trajectories'][0]['solveObservation']['snapshots']
first = next(iter(snapshots.values()))
snapshots['deliberately-inconsistent-duplicate-role'] = copy.deepcopy(first)
snapshots['deliberately-inconsistent-duplicate-role']['source'] = 'tampered-only-in-test'
try:
    m.Reviewer(a.repo.resolve()).review(changed, {'file': 'deliberately-corrupted-in-memory'})
except AssertionError as error:
    assert 'duplicate roles' in str(error)
    tests.append('conflicting roles for same actual iteration rejected')
else:
    raise AssertionError('conflicting roles were accepted')
# The numerical classifier must not copy accepted flags as an independent pass.
group = fixture['results'][0]
row = group['trajectories'][0]
event = copy.deepcopy(row['solveObservation']['snapshots']['first-precision-limited'])
event['increment']['last']['decision'] = 'accepted'
event['incrementTrial']['runtime']['decision'] = 'accepted'
event['lineSearch'].update(decision='accepted', accepted=True, stationaryNoop=False, precisionLimited=False, rejected=False)
classified = m.Reviewer(a.repo.resolve()).event(group, row, event, {'scope': 'synthetic decision-label corruption of actual zero-step endpoint; not a solver execution'})
assert all(not t['exactGradientStrictRealArmijo'] and not t['capturedGradientStrictRealArmijo'] for t in classified['truth'].values())
tests.append('synthetic accepted label on an actual zero step remains numerical Armijo failure under both laws')
result = {'schema': 'pliego-selected-newton-review-tests/1', 'passed': True, 'tests': tests,
    'ordinaryFixtureSHA256': m.sha(a.fixture.read_bytes()), 'reviewerSHA256': m.sha(source.read_bytes()),
    'ordinaryProofSummary': {k: proof[k] for k in ('checks', 'decodedFloat64Words', 'selection', 'decisions', 'counts')},
    'scope': 'bounded reviewer development checks only; no accepted24matrix, no new solver execution by tests'}
with a.out.open('x') as stream:
    stream.write(json.dumps(result, indent=2) + '\n')
a.out.chmod(0o600)
print(json.dumps({'passed': True, 'tests': len(tests)}))
