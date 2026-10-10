"""Rule 16: pliego:meta carries only the §5.7 keys."""

from __future__ import annotations

import pliego

L4 = {"en": "Base", "es": "Base", "fr": "Base", "pt": "Base"}


def test_rule16_unknown_meta_keys_warn(stocks):
    """`pliego:meta` is closed in the schema (§5.7): extra keys merged through `Assembly(meta=…)`
    are reported (a warning for now) instead of passing silently."""
    s = pliego.Sheet("p", pliego.square(10), label=L4)
    d = pliego.Assembly([s], meta={"cartridge": "demo", "segmentation": 12}).build(stocks=stocks)
    issues = [i for i in d.verify() if i.get("rule") == 16]
    assert [(i["level"], i["kind"]) for i in issues] == [("warning", "meta_unknown_key")]
    assert "segmentation" in issues[0]["detail"]
    clean = pliego.Assembly([s], meta={"cartridge": "demo", "params": {"a": 1}}).build(
        stocks=stocks)
    assert clean.verify() == []
