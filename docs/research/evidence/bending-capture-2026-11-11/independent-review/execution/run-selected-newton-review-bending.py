"""Single frozen bending selected-Newton review invocation with durable public receipts.

CLI paths never enter receipts. Review starts only after the candidate process
terminal and after-source guard exist. No retry or solver process is performed.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

EXPECTED = 'b8732b9eaad76aa0a7be06be0999105a5e77b5f19094e0adeea194fb12bd9dcd'


def digest(path):
    h, n = hashlib.sha256(), 0
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b); n += len(b)
    return {'bytes': n, 'sha256': h.hexdigest()}


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


def exclusive(path):
    return os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb')


def write(path, value):
    with exclusive(path) as f:
        f.write(value if isinstance(value, bytes) else canonical(value)); f.flush(); os.fsync(f.fileno())


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def load(path):
    return json.loads(path.read_bytes())


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo', type=Path, required=True)
    p.add_argument('--run-dir', type=Path, required=True)
    p.add_argument('--out-dir', type=Path, required=True)
    p.add_argument('--reviewer', type=Path, required=True)
    a = p.parse_args()
    repo, run, out, reviewer = [x.resolve() for x in (a.repo, a.run_dir, a.out_dir, a.reviewer)]
    assert not out.is_relative_to(repo) and not out.is_relative_to(run)
    assert not any(out == q or q in out.parents for q in (Path('/tmp').resolve(), Path('/private/tmp'), Path('/var/folders')))
    assert out.parent.is_dir(), 'durable parent directory required; fresh output itself is0700'
    pin = load(run / 'source-pin.json')
    expected_pin = digest(run / 'source-pin.json')
    term = load(run / 'candidate.terminal.json')
    after = load(run / 'candidate.source-after.json')
    assert term['returnCode'] == 0 and term['processError'] is None and term['sourceGuardError'] is None
    assert after['clean'] and after['phase'] == 'after' and after['name'] == 'candidate' and after['git'] == pin['git']
    assert digest(reviewer)['sha256'] == EXPECTED
    candidate = run / 'candidate.json'
    candidate_digest = digest(candidate)
    assert term['outputDigest'] == candidate_digest
    out.mkdir(mode=0o700)
    source = Path(__file__).read_bytes()
    write(out / Path(__file__).name, source)
    argv = [sys.executable, str(reviewer), '--repo', str(repo), '--input', str(candidate), '--out', str(out / 'selected-newton-review.json')]
    public_argv = ['{python}', '{reviewer}', '--repo', '{repo}', '--input', '{run}/candidate.json', '--out', '{review}/selected-newton-review.json']

    def guard(phase):
        assert digest(run / 'source-pin.json') == expected_pin
        assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip() == pin['git']
        assert subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=repo, text=True).strip() == ''
        assert digest(reviewer)['sha256'] == EXPECTED
        for f in pin['files']:
            q = Path(f['path'])
            assert not q.is_absolute() and '..' not in q.parts
            assert digest(repo / q) == {k: f[k] for k in ('bytes', 'sha256')}, 'pinned source bytes changed: ' + q.as_posix()
        assert digest(candidate) == candidate_digest
        value = {'schema': 'pliego-selected-newton-review-source-guard/1', 'phase': phase, 'sourceGit': pin['git'], 'sourceClean': True,
                 'files': len(pin['files']), 'sourcePinDigest': expected_pin, 'reviewerSHA256': EXPECTED, 'candidateDigest': candidate_digest}
        write(out / ('source-' + phase + '.json'), value)
    guard('before')
    write(out / 'invocation.json', {'schema': 'pliego-selected-newton-review-invocation/1', 'argv': public_argv, 'cwd': '{repo}', 'inputDigest': candidate_digest,
          'sourceGit': pin['git'], 'reviewerSHA256': EXPECTED, 'wrapper': {'file': Path(__file__).name, 'bytes': len(source), 'sha256': hashlib.sha256(source).hexdigest()},
          'scope': 'one read-only selected-event review; no World, solver, oracle producer, retry or performance benchmark'})
    started, start_clock = utc(), time.monotonic_ns()
    source_error = None
    with exclusive(out / 'selected-newton-review.stdout.log') as stdout, exclusive(out / 'selected-newton-review.stderr.log') as stderr:
        child = subprocess.Popen(argv, cwd=repo, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
        while True:
            try:
                code = child.wait(timeout=15)
                break
            except subprocess.TimeoutExpired:
                print('RUNNING selected-Newton read-only review', flush=True)
        stdout.flush(); os.fsync(stdout.fileno()); stderr.flush(); os.fsync(stderr.fileno())
    try:
        guard('after')
    except Exception as error:
        message = str(error)
        for path, symbol in [(repo, '{repo}'), (run, '{run}'), (out, '{review}'), (reviewer, '{reviewer}')]:
            message = message.replace(str(path), symbol)
        source_error = {'type': type(error).__name__, 'message': message}
    proof = out / 'selected-newton-review.json'
    receipt = {'schema': 'pliego-selected-newton-review-terminal/1', 'argv': public_argv, 'startedAt': started, 'finishedAt': utc(),
        'returnCode': code, 'inputDigest': candidate_digest, 'outputDigest': digest(proof) if proof.is_file() else None,
        'stdoutDigest': digest(out / 'selected-newton-review.stdout.log'), 'stderrDigest': digest(out / 'selected-newton-review.stderr.log'),
        'reviewerSHA256': EXPECTED, 'sourcePinDigest': expected_pin, 'sourceGuardError': source_error,
        'researchProcessingWallSeconds': (time.monotonic_ns() - start_clock) / 1e9,
        'scope': 'one actual read-only reviewer process receipt; research bookkeeping, not an engine/interaction timing measurement'}
    write(out / 'selected-newton-review.terminal.json', receipt)
    print(json.dumps({'returnCode': code, 'outputDigest': receipt['outputDigest'], 'sourceGuardError': source_error}), flush=True)
    assert code == 0 and source_error is None, 'selected review process or source guard failed; raw evidence retained'


if __name__ == '__main__':
    main()
