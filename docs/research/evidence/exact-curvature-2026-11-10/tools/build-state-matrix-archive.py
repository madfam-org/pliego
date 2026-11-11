"""Build a lossless public evidence archive from terminal durable inputs only.

Originals are never modified. Four raw numerical reports become deterministic
mtime0 gzip; every other selected source/proof/receipt remains byte-exact. Private
path findings abort staging, retain originals and retain a hash-only rejection
ledger. JSON and JSONL are parsed and decoded base64 source/raw-word wrappers
are scanned as well as raw bytes. CLI supplies all machine paths.
"""
import argparse
import base64
import gzip
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPORTS = {'baseline.json', 'candidate.json', 'repeat.json', 'plain.json'}
REVIEW_FILES = ['review-selected-newton.py', 'reviewer-freeze.json', 'reviewer-sources.json',
                'make-selected-newton-test-fixture.mjs', 'test-selected-newton-review.py',
                'selected-newton-small-fixture.json', 'selected-newton-small-proof.json', 'selected-newton-test-proof.json']
PRIVATE = re.compile(rb'(?:/Users/|/home/)[A-Za-z0-9_.-]+(?:/|\b)|(?:/private)?/var/folders/[A-Za-z0-9_.-]+/')


def sha(b):
    return hashlib.sha256(b).hexdigest()


def digest(path):
    h, n = hashlib.sha256(), 0
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b); n += len(b)
    return {'bytes': n, 'sha256': h.hexdigest()}


def write(path, value):
    b = value if isinstance(value, bytes) else (json.dumps(value, indent=2, allow_nan=False) + '\n').encode()
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as f:
        f.write(b)
    return digest(path)


def load(path):
    def invalid(s):
        raise ValueError('nonfinite JSON constant: ' + s)
    return json.loads(path.read_bytes(), parse_constant=invalid)


def confined_name(name):
    p = Path(name)
    assert name and not p.is_absolute() and '..' not in p.parts and ':' not in name, 'unsafe public identity'
    return p.as_posix()


def private_directory(path):
    assert stat.S_IMODE(path.stat().st_mode) == 0o700 and path.is_dir(), '0700 durable directory required'
    assert not any(path == p or p in path.parents for p in (Path('/tmp').resolve(), Path('/private/tmp'), Path('/var/folders'))), 'temporary output refused'


class Scanner:
    def __init__(self):
        self.raw_bytes, self.decoded_bytes, self.json_files, self.wrappers = 0, 0, 0, 0
        self.rejected = []

    def scan_bytes(self, raw, identity, label):
        if PRIVATE.search(raw):
            self.rejected.append({'file': identity, 'location': label, 'reason': 'private absolute path pattern', 'bytes': len(raw), 'sha256': sha(raw)})

    def tree(self, value, identity, trail='', encoded_parent=False):
        if isinstance(value, dict):
            # Both current and older archives use explicit source wrappers.
            encoding = value.get('encoding')
            for k, v in value.items():
                encoded = encoded_parent or ('float64le' in k.lower() and 'sha' not in k.lower())
                if isinstance(v, str) and ((encoding in ('base64', 'utf8-base64') and k in ('source', 'base64', 'data', 'content')) or k in ('sourceBase64', 'contentBase64') or encoded):
                    try:
                        raw = base64.b64decode(v, validate=True)
                    except Exception as error:
                        raise AssertionError('invalid declared base64: ' + identity + ':' + trail + '.' + k) from error
                    assert base64.b64encode(raw).decode() == v, 'noncanonical declared base64'
                    self.wrappers += 1; self.decoded_bytes += len(raw)
                    self.scan_bytes(raw, identity, 'decoded:' + trail + '.' + k)
                else:
                    self.tree(v, identity, trail + '.' + k, encoded)
        elif isinstance(value, list):
            for i, v in enumerate(value):
                self.tree(v, identity, trail + '[' + str(i) + ']', encoded_parent)
        elif isinstance(value, str):
            self.scan_bytes(value.encode(), identity, 'json-string:' + trail)

    def file(self, path, identity):
        before = digest(path)
        # Streaming raw scan preserves boundary matches without a second copy of
        # a large numerical JSON report in memory.
        tail = b''
        with path.open('rb') as f:
            for b in iter(lambda: f.read(1024 * 1024), b''):
                self.raw_bytes += len(b)
                self.scan_bytes(tail + b, identity, 'raw')
                tail = b[-256:]
        if path.suffix == '.json':
            self.json_files += 1
            self.tree(load(path), identity)
        elif path.suffix == '.jsonl':
            self.json_files += 1
            with path.open('r') as f:
                for i, line in enumerate(f):
                    self.tree(json.loads(line), identity, 'line' + str(i + 1))
        assert digest(path) == before, 'input changed while scanning: ' + identity
        return before


def select(args):
    run, review = args.run_dir.resolve(), args.review_dir.resolve()
    private_directory(run); private_directory(review)
    terminal = load(run / 'pipeline-terminal.json')
    assert terminal['schema'] == 'pliego-state-matrix-pipeline-terminal/1' and terminal['pipelineCompleted'] and terminal['sourceClean'], 'complete clean pipeline required'
    assert len(terminal['processes']) == 12 and all(p['returnCode'] == 0 and p['processError'] is None and p['sourceGuardError'] is None for p in terminal['processes']), 'all twelve process terminals required'
    assert not (run / 'pipeline-failure.json').exists(), 'failed pipeline cannot be published as complete'
    for f in terminal['files']:
        assert digest(run / confined_name(f['file'])) == {k: f[k] for k in ('bytes', 'sha256')}, 'terminal-bound input changed'
    for name in REPORTS:
        assert (run / name).is_file(), 'all four raw reports required'
    selected = []
    for p in sorted(run.iterdir()):
        assert p.is_file() and not p.is_symlink(), 'unexpected run-directory entry'
        selected.append((p, 'run/' + p.name, 'accepted-run'))
    for name in REVIEW_FILES:
        selected.append((review / name, 'independent-review/' + name, 'frozen-selected-Newton-review'))
    proof_path = args.selected_proof.resolve()
    proof = load(proof_path)
    assert proof['schema'] == 'pliego-selected-newton-exact-review/1' and proof['integrityPassed'] and proof['allNewtonEventsRealArmijoCertified'] is False
    assert proof['inputScope'] == 'clean fixed24 matrix selected Newton records', 'full candidate selected review required'
    assert proof['input']['sha256'] == digest(run / 'candidate.json')['sha256'], 'selected review binds actual candidate'
    freeze = load(review / 'reviewer-freeze.json')
    for f in freeze['files']:
        assert digest(review / f['file']) == {k: f[k] for k in ('bytes', 'sha256')}, 'frozen reviewer/test inputs changed'
    assert proof['reviewer']['sha256'] == digest(review / 'review-selected-newton.py')['sha256'], 'full proof uses frozen reviewer'
    launch = load(run / 'launch-preflight.json')
    assert launch['selectedNewtonReviewerSHA256'] == proof['reviewer']['sha256']
    selected.append((proof_path, 'independent-review/selected-newton-review.json', 'terminal-selected-Newton-review'))
    review_terminal = args.review_terminal.resolve()
    receipt = load(review_terminal)
    assert receipt['returnCode'] == 0 and receipt['outputDigest'] == digest(proof_path), 'selected review successful terminal binds proof'
    selected.append((review_terminal, 'independent-review/selected-newton-review.terminal.json', 'terminal-selected-Newton-review'))
    assert proof_path.parent == review_terminal.parent and proof_path.parent != review, 'separate terminal review execution directory required'
    for f in sorted(proof_path.parent.iterdir()):
        assert f.is_file() and not f.is_symlink(), 'unexpected selected-review execution entry'
        if f not in (proof_path, review_terminal):
            selected.append((f, 'independent-review/execution/' + f.name, 'terminal-selected-Newton-execution'))
    for spec in args.supplement:
        identity, sep, path = spec.partition('=')
        assert sep, 'supplement requires public-relative-identity=FILE'
        selected.append((Path(path).resolve(), 'supplements/' + confined_name(identity), 'explicit-supplement'))
    for name in ('build-state-matrix-archive.py', 'restore-state-matrix-archive.py'):
        selected.append((HERE / name, 'tools/' + name, 'portable-byte-preservation-tools'))
    identities = [name for _, name, _ in selected]
    assert len(set(identities)) == len(identities), 'duplicate selected identity'
    return selected, terminal


def build(args):
    out = args.out.resolve()
    private_directory(out.parent)
    assert not out.is_relative_to(args.run_dir.resolve()) and not out.is_relative_to(args.review_dir.resolve()), 'archive separate from raw inputs'
    selected, terminal = select(args)
    scan = Scanner()
    checked = [(p, name, category, scan.file(p, name)) for p, name, category in selected]
    if scan.rejected:
        rejection = {'schema': 'pliego-state-matrix-publication-rejection/1', 'stagingAllowed': False,
                     'originalsRetained': True, 'findings': scan.rejected,
                     'scope': 'hash-only findings; no source or numerical bytes redacted or overwritten'}
        write(out.with_name(out.name + '-privacy-rejected.json'), rejection)
        raise AssertionError('privacy scan rejected publication; durable originals retained')
    out.mkdir(mode=0o700)
    entries = []
    for source, identity, category, original in checked:
        compressed = category == 'accepted-run' and source.name in REPORTS
        stored_name = identity + '.gz' if compressed else identity
        target = out / stored_name
        target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        with source.open('rb') as inp, os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as output:
            if compressed:
                with gzip.GzipFile(filename='', mode='wb', compresslevel=6, fileobj=output, mtime=0) as encoded:
                    for b in iter(lambda: inp.read(1024 * 1024), b''):
                        encoded.write(b)
            else:
                for b in iter(lambda: inp.read(1024 * 1024), b''):
                    output.write(b)
        assert digest(source) == original, 'input changed after scan: ' + identity
        entries.append({'category': category, 'encoding': 'gzip' if compressed else 'identity',
                        'original': {'file': identity, **original}, 'stored': {'file': stored_name, **digest(target)}})
    readme = ('''# Fixed24 state-coordinate matrix evidence

All selected original reports, receipts and reviewers are preserved losslessly.
`manifest.json` records stored and decoded SHA256/length. The four large raw
reports use deterministic gzip (level6, empty filename, mtime0); other selected
files retain exact original bytes. Durable originals remain outside the repo.

Verify: `python3 tools/restore-state-matrix-archive.py --archive ARCHIVE`.
Restore: append `--out FRESH_DIR`; original identities are restored beneath it.
The manifest needs an external publication hash because it cannot hash itself.

The fixed diagnostic matrix has24 trajectories,7110 judged poststeps and49770
declared Newton iterations per capture. State capture restore controls are
separate24 calls/168 declared iterations. Baseline, candidate, repeat and plain
are separate runs. Process wall receipts are untimed research bookkeeping.

Selected endpoint and Newton proofs certify only their stated samples. Public
force, authoritative force, time, material, booklet and interaction gates retain
their original meanings and all failures. No all49770 real-Armijo, calibrated
paper-stock, full-booklet or performance acceptance follows from this archive.

Frozen runner and plan live under `run/`. Selected-Newton source and exact source
wrappers live under `independent-review/`. The runner supports `--help` and the
reviewer supports `--repo REPO --input CANDIDATE_JSON --out FRESH_DURABLE_PROOF`.
Builder/restorer are byte-preservation tools and execute no physics or oracle.
Optional supplements are explicitly listed; this archive does not claim every
file in the durable development workspace was selected.
''').encode()
    scan.scan_bytes(readme, 'README.md', 'generated')
    assert not scan.rejected
    rd = write(out / 'README.md', readme)
    entries.append({'category': 'generated-explanation', 'encoding': 'identity', 'original': {'file': 'README.md', **rd}, 'stored': {'file': 'README.md', **rd}})
    manifest = {'schema': 'pliego-state-matrix-lossless-archive/1', 'sourceGit': terminal['sourceGit'], 'files': entries,
                'policy': {'originalBytesModified': False, 'deterministicGzip': {'level': 6, 'mtime': 0, 'filename': ''},
                           'allAcceptedRunFilesSelected': True, 'allDurableWorkspaceFilesSelected': False,
                           'sourceMapping': 'run/ maps to CLI --run-dir; independent-review/ frozen files map to --review-dir, selected proof and terminal use their explicit CLI arguments; supplements/ identities are explicit CLI selections; tools/ maps to builder directory',
                           'manifestSelfHash': 'external publication binding required'},
                'privacyScan': {'passed': True, 'rawBytesScanned': scan.raw_bytes, 'decodedBase64BytesScanned': scan.decoded_bytes,
                                'decodedBase64Wrappers': scan.wrappers, 'jsonOrJsonlFiles': scan.json_files,
                                'method': 'raw bytes plus parsed JSON strings and explicit base64 source/Float64LE wrappers; private user and temporary home paths refused; no redaction'},
                'scope': 'lossless selected evidence preservation; numerical outcomes and all false/unmeasured gates remain in exact raw proofs'}
    write(out / 'manifest.json', manifest)
    spec = importlib.util.spec_from_file_location('archive_restorer', HERE / 'restore-state-matrix-archive.py')
    restorer = importlib.util.module_from_spec(spec); spec.loader.exec_module(restorer)
    result = restorer.restore(out)
    print(json.dumps({'built': True, 'files': len(entries), 'manifest': digest(out / 'manifest.json'), 'verification': result}), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run-dir', type=Path, required=True)
    p.add_argument('--review-dir', type=Path, required=True)
    p.add_argument('--selected-proof', type=Path, required=True)
    p.add_argument('--review-terminal', type=Path, required=True)
    p.add_argument('--supplement', action='append', default=[], help='public-relative-identity=FILE')
    p.add_argument('--out', type=Path, required=True)
    build(p.parse_args())


if __name__ == '__main__':
    main()
