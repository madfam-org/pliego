"""Spec §5.20–§5.22 (wave 3 lane E): keyed mechanisms, step-activated joins and untying are
accepted and checked by the kernel's verify (rules 20–22) the way the engine checks them."""

from __future__ import annotations

import pliego

L4 = {"en": "Step", "es": "Paso", "fr": "Étape", "pt": "Passo"}


def _glued_fold(stocks, *, gate=True, release=False, active_from="glue"):
    s = pliego.Sheet("strip", pliego.rectangle(100, 40), label=L4)
    crease = s.valley((50, 0), (50, 40))
    glue = pliego.glue("tab", s, [(86, 6), (96, 6), (96, 34), (86, 34)], s,
                       map=(-1, 0, 0, 1, 100, 0))
    if gate:
        glue["active_from"] = active_from
    steps = [pliego.Step("fold", L4, [(crease, 180)]),
             pliego.Step("glue", L4, duration_ms=500),
             pliego.Step("let-go", L4, release=[crease])]
    if release:
        steps.append(pliego.Step("peel", L4, release_joins=["tab"]))
    return pliego.Assembly([s], joins=[glue], sequence=pliego.Sequence(steps),
                           initial={"strip": {"angles": {}}}).build(stocks=stocks)


def _codes(doc):
    return {(i["rule"], i["kind"]) for i in doc.verify() if i["level"] == "error"}


def test_step_activated_glue_starts_flat_and_verifies(stocks):
    d = _glued_fold(stocks)
    assert d.verify() == []
    # an ungated glue must hold in the initial frame
    assert (9, "glue_weld") in _codes(_glued_fold(stocks, gate=False))
    assert (21, "active_from_step") in _codes(_glued_fold(stocks, active_from="nope"))


def test_release_joins_is_emitted_and_checked(stocks):
    d = _glued_fold(stocks, release=True)
    assert d.data["pliego:sequence"]["steps"][3]["release_joins"] == ["tab"]
    assert d.verify() == []
    d.data["pliego:sequence"]["steps"][3]["release_joins"] = ["nope"]
    assert (22, "release_joins") in _codes(d)
    d.data["pliego:sequence"]["steps"][3]["release_joins"] = []
    d.data["pliego:sequence"]["steps"][1]["release_joins"] = ["tab"]  # the step that activates it
    assert (22, "release_joins") in _codes(d)


def test_keyed_mechanism_rules(stocks):
    disc = pliego.Sheet("disc", pliego.square(40), label=L4, kinematic="spin")
    base = pliego.Sheet("base", pliego.square(60), label=L4)
    spin = pliego.rotate("spin", (base, (30, 30)), "turn", [disc])
    spin.update(keys=[[0, 0], [180, 90], [360, 360]], period=360)
    a = pliego.Assembly([base, disc], mechanisms=[spin],
                        controls=[pliego.angle_control("turn", L4, 0, 0, 360)])
    d = a.build(stocks=stocks)
    assert d.verify() == []
    d.data["pliego:mechanisms"][0]["keys"] = [[0, 0], [0, 1]]
    assert (20, "keys_order") in _codes(d)
    d.data["pliego:mechanisms"][0]["keys"] = [[0, 0], [400, 1]]
    assert (20, "period") in _codes(d)
    d.data["pliego:mechanisms"][0]["keys"] = [[0, 0], [90, 1]]
    d.data["pliego:mechanisms"][0]["ride"] = "spin"
    assert (20, "ride_cycle") in _codes(d)
