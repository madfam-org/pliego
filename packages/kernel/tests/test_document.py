from __future__ import annotations

import pliego


def _doc(stocks):
    s = pliego.Sheet("square", pliego.square(150),
                     label={"en": "Square", "es": "Cuadrado", "fr": "Carré", "pt": "Quadrado"})
    s.valley((0, 0), (150, 150))
    a = pliego.Assembly([s], controls=[pliego.sequence_control()],
                        sequence=pliego.Sequence.fold_each())
    return a.build(stocks=stocks)


def test_build_verify_summary(stocks):
    d = _doc(stocks)
    assert d.verify() == []
    assert d.summary() == "verify: sheets=1 vertices=4 edges=5 faces=2 joins=0 errors=0 warnings=0"


def test_round_trip_and_digest(stocks):
    d = _doc(stocks)
    again = pliego.Document.from_json(d.to_json())
    assert again == d
    assert again.to_json() == d.to_json()
    assert d.data["pliego:meta"]["digest"] == d.digest()


def test_byte_stable(stocks):
    assert _doc(stocks).to_bytes() == _doc(stocks).to_bytes()
