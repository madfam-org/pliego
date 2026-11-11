"""Verify stored and decoded archive bytes, optionally restore exact original files.

Usage: python3 restore-bending-matrix-archive.py --archive ARCHIVE [--out FRESH_DIR]
No solver or numerical oracle is executed. Manifest paths are confined; restored
files use exclusive0600 creation under a new0700 directory. A manifest cannot
include its own hash; publication must bind manifest.json externally.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path


def digest(path):
    h, n = hashlib.sha256(), 0
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b); n += len(b)
    return {'bytes': n, 'sha256': h.hexdigest()}


def confined(root, name):
    p = Path(name)
    assert not p.is_absolute() and '..' not in p.parts and p.parts, 'unsafe manifest path'
    result = root / p
    assert not any(x.is_symlink() for x in [result, *result.parents] if x != root.parent), 'symlink refused'
    return result


def restore(archive, out=None):
    manifest = json.loads((archive / 'manifest.json').read_bytes())
    assert manifest['schema'] == 'pliego-bending-matrix-lossless-archive/1'
    if out:
        out.mkdir(mode=0o700)
    actual = {p.relative_to(archive).as_posix() for p in archive.rglob('*') if p.is_file()}
    expected = {e['stored']['file'] for e in manifest['files']} | {'manifest.json'}
    assert actual == expected, 'archive file inventory differs'
    restored, total = set(), 0
    for entry in manifest['files']:
        stored, original = entry['stored'], entry['original']
        source = confined(archive, stored['file'])
        assert digest(source) == {k: stored[k] for k in ('bytes', 'sha256')}, 'stored bytes differ: ' + stored['file']
        name = original['file']
        assert name not in restored, 'duplicate original path'
        restored.add(name)
        target = confined(out, name) if out else None
        if target:
            target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        opened = gzip.open(source, 'rb') if entry['encoding'] == 'gzip' else source.open('rb')
        h, n = hashlib.sha256(), 0
        destination = os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') if target else None
        try:
            with opened as stream:
                for b in iter(lambda: stream.read(1024 * 1024), b''):
                    h.update(b); n += len(b)
                    if destination:
                        destination.write(b)
        finally:
            if destination:
                destination.close()
        assert {'bytes': n, 'sha256': h.hexdigest()} == {k: original[k] for k in ('bytes', 'sha256')}, 'decoded original differs: ' + name
        total += n
    return {'schema': 'pliego-bending-matrix-archive-restore/1', 'verified': True, 'files': len(restored), 'decodedBytes': total,
            'manifestSHA256': digest(archive / 'manifest.json')['sha256'], 'restored': bool(out),
            'scope': 'byte preservation only; no numerical or interaction acceptance'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive', type=Path, required=True)
    p.add_argument('--out', type=Path)
    a = p.parse_args()
    print(json.dumps(restore(a.archive.resolve(), a.out.resolve() if a.out else None)))


if __name__ == '__main__':
    main()
