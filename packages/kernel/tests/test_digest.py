"""Spec §5.15: canonical serialisation (RFC 8785 JCS) and pliego:meta.digest (hardening item 8)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pliego.document import Document, canonical_bytes

VECTOR = json.loads((Path(__file__).parent / "fixtures" / "digest_vector.json").read_text())


@pytest.mark.parametrize(("value", "text"), [
    (0.0, "0"), (-0.0, "0"), (5.0, "5"), (150, "150"), (12.5, "12.5"), (0.1, "0.1"),
    (5e-06, "0.000005"), (1e-6, "0.000001"), (1e-7, "1e-7"), (1.5e-8, "1.5e-8"),
    (1e20, "100000000000000000000"), (1e21, "1e+21"), (1.5e300, "1.5e+300"),
    (-2.5e-8, "-2.5e-8"), (1 / 3, "0.3333333333333333"), (2 ** 53, "9007199254740992"),
    (5e-324, "5e-324"), (123456.789, "123456.789"),
])
def test_numbers_print_as_ecmascript(value, text):
    assert canonical_bytes(value) == text.encode()


def test_objects_strings_and_key_order():
    obj = {"b": [1, True, None], "a": "x\n\"\\ \x7f", "": 1, "\U0001f600": 2}
    # keys sorted by UTF-16 code units: the astral key (surrogate D83D) sorts before U+E000
    assert canonical_bytes(obj) == (
        '{"a":"x\\n\\"\\\\ \x7f","b":[1,true,null],"\U0001f600":2,"":1}'.encode())


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), 2 ** 53 + 1, "\ud800", {1: 2}])
def test_refuses_values_two_readers_would_disagree_on(bad):
    with pytest.raises(ValueError):
        canonical_bytes(bad)


def test_test_vector_reproduces():
    """The fixture is shared with the engine: `canonical` is what JSON.stringify writes for the
    document with sorted keys, `digest` its sha256 (checked against node when it was made)."""
    doc = Document(VECTOR["document"])
    meta = {**VECTOR["document"]["pliego:meta"], "digest": None}
    assert canonical_bytes({**VECTOR["document"], "pliego:meta": meta}).decode() == \
        VECTOR["canonical"]
    assert doc.digest() == VECTOR["digest"]


def test_digest_ignores_number_spelling_and_key_order():
    a = Document({"x": 5.0, "y": [1e-7, 0.000005], "pliego:meta": {"kernel": "k", "digest": None}})
    b = Document(json.loads('{"pliego:meta": {"digest": "sha256:' + "0" * 64 + '", "kernel": "k"},'
                            ' "y": [1e-07, 5e-06], "x": 5}'))
    assert a.digest() == b.digest()
    assert a.stamp().data["pliego:meta"]["digest"] == a.digest()
