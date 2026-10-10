"""FOLD writer: pass-through of the document's canonical text."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pliego.export.fold import to_fold

GOLDEN = Path(__file__).parent / "golden_export"


def sample() -> dict:
    return json.loads((GOLDEN / "sample.fold.json").read_text(encoding="utf-8"))


def test_dict_round_trips():
    d = sample()
    text = to_fold(d)
    assert json.loads(text) == d
    assert to_fold(d) == text


def test_object_with_to_json_serialises_itself():
    class Doc:
        def to_json(self) -> str:
            return '{"file_spec":1.2}'

    assert to_fold(Doc()) == '{"file_spec":1.2}'


def test_rejects_non_fold():
    with pytest.raises(ValueError):
        to_fold({"hello": 1})
    with pytest.raises(json.JSONDecodeError):
        to_fold("{not json")
