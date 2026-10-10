"""Dielines (pliego.dieline + box and carton styles): outline, folds, compensation, programs."""

from __future__ import annotations

import pytest

import pliego
from pliego import dieline, dieline_boxes, dieline_cartons, kinematics
from pliego.space import quat_rotate


def posed_extent(pack: dieline.Packed, spec: dict) -> tuple[list[float], list[float]]:
    """World bounding box (size, minimum) of a sheet posed face by face (no vertex sharing)."""
    sheet = pack.sheet
    arr = sheet.build()
    s = spec[sheet.id]
    angles = {e: a for m, a in s["angles"].items() for e in m.edges()}
    root = kinematics.root_face(arr, pliego.P(*s["root"]))
    tr = kinematics.face_transforms(arr, angles, root)
    pts = []
    for fi, f in enumerate(arr.faces):
        for v in f:
            q = arr.vertices[v]
            pts.append(quat_rotate(sheet.placement.rotation,
                                   kinematics._apply(tr[fi], (q.x, 0.0, -q.y))))
    lo = [min(p[k] for p in pts) for k in range(3)]
    hi = [max(p[k] for p in pts) for k in range(3)]
    return [h - lo_ for lo_, h in zip(lo, hi, strict=True)], lo


def build(pack: dieline.Packed, **kw):
    doc = dieline.assemble([pack], **kw).build()
    errors = [i for i in doc.verify() if i["level"] == "error"]
    assert errors == [], errors
    return doc


def test_union_outline_slots_and_named_folds():
    pack = dieline_boxes.slotted(300, 200, 150, "corrugated-b-flute")
    t = pack.block["caliper_mm"]
    assert t == pytest.approx(3.06)
    doc = build(pack)
    names = set(n for n in doc.data["pliego:edges_name"] if n)
    assert {"front-end-1-fold", "glue-flap-fold", "front-top-flap-fold", "glue-flap"} <= names
    # slot notches: the outline has 4 vertices per slot on each flap row
    assert len(pack.sheet.outline) > 30
    treat = {t_ for t_, a in zip(doc.data["pliego:edges_treatment"], doc.data["edges_assignment"],
                                 strict=True) if a == "M"}
    assert treat == {"score"}


@pytest.mark.parametrize("flaps, height_factor", [("regular", 0.5), ("half", 0.5),
                                                  ("full", 1.0)])
def test_slotted_closes_to_inside_plus_caliper(flaps, height_factor):
    L, W, D = 300.0, 200.0, 150.0
    pack = dieline_boxes.slotted(L, W, D, "corrugated-c-flute", flaps=flaps)
    t = pack.block["caliper_mm"]
    size, lo = posed_extent(pack, pack.closed)
    assert size[0] == pytest.approx(L + t, abs=1e-5)     # lying on its front panel
    assert size[1] == pytest.approx(W + t, abs=1e-5)
    assert lo[1] == pytest.approx(0.0, abs=1e-6)          # on the table, folding up
    # outer flaps rest on inner flaps: they rise by at most t at each closed end
    ends = 1 if flaps == "half" else 2
    assert D + t <= size[2] <= D + t + ends * t + 1e-5
    build(pack)


def test_telescope_lid_fits_over_base():
    base, lid = dieline_boxes.telescope(300, 200, 100, 40, "corrugated-b-flute")
    t = base.block["caliper_mm"]
    sb, _ = posed_extent(base, base.closed)
    sl, _ = posed_extent(lid, lid.closed)
    assert sl[0] - sb[0] == pytest.approx(2 * t, abs=1e-5)
    assert sl[1] - sb[1] == pytest.approx(2 * t, abs=1e-5)
    doc = dieline.assemble([base, lid]).build()
    assert not [i for i in doc.verify() if i["level"] == "error"]
    assert len(doc.data["pliego:dielines"]) == 2
    # placed: the closed lid caps the base's open end from outside
    def world(pack):                 # posed_extent applies the rotation; add the origin
        size, lo = posed_extent(pack, pack.closed)
        o = pack.sheet.placement.origin
        return ([a + b for a, b in zip(lo, o, strict=True)],
                [a + s_ + b for a, s_, b in zip(lo, size, o, strict=True)])
    (_b0, b1), (l0, l1) = world(base), world(lid)
    assert l0[0] == pytest.approx(-t, abs=1e-5) and l0[1] == pytest.approx(-t, abs=1e-5)
    assert l0[2] < b1[2] < l1[2]


@pytest.mark.parametrize("roll", ["ends", "front"])
def test_mailer_closes_and_rests_on_its_base(roll):
    L, W, D = 250.0, 180.0, 60.0
    pack = dieline_boxes.mailer(L, W, D, "corrugated-e-flute", roll=roll)
    t = pack.block["caliper_mm"]
    size, lo = posed_extent(pack, pack.closed)
    assert size[0] == pytest.approx(L + t, abs=1e-5)
    assert size[2] == pytest.approx(W + t, abs=1e-5)
    tab = 2 * t + 2.0
    if roll == "ends":                       # lock tabs drop through the base slots
        assert lo[1] == pytest.approx(-(tab - t), abs=1e-5)
    assert size[1] + lo[1] == pytest.approx(D + t, abs=1e-5)
    # the preview root is pre-folded so the base starts and stays on the table
    start, lo0 = posed_extent(pack, pack.initial)
    assert lo0[1] >= -tab
    assert len(pack.sheet.holes) >= (4 if roll == "ends" else 3)   # slots through the folds
    build(pack)


@pytest.mark.parametrize("style", dieline_cartons.STYLES)
def test_carton_styles_close(style):
    L, W, D = 120.0, 60.0, 180.0
    pack = dieline_cartons.carton(L, W, D, "folding-boxboard-300", style=style)
    t = pack.block["caliper_mm"]
    size, lo = posed_extent(pack, pack.closed)
    assert size == pytest.approx([L + t, W + t, D + t], abs=1e-5)
    assert lo[1] == pytest.approx(0.0, abs=1e-6)
    assert pack.initial["carton"]["angles"] == {}       # the front panel is the preview root
    doc = build(pack)
    steps = doc.data["pliego:sequence"]["steps"]
    assert doc.data["pliego:sequence"]["mode"] == "kinematic" and len(steps) >= 5
    for st in steps:
        assert set(st["label"]) == {"en", "es", "fr", "pt"}


def test_crash_lock_diagonal_is_drawn_but_not_driven():
    pack = dieline_cartons.carton(120, 60, 180, style="crash-lock")
    assert pack.final["side-1-glue-triangle-fold"] == 0.0
    doc = build(pack)
    driven = {e for st in doc.data["pliego:sequence"]["steps"] for e, _ in st["targets"]}
    names = doc.data["pliego:edges_name"]
    diag = [e for e, n in enumerate(names) if n == "side-1-glue-triangle-fold"]
    assert diag and not set(diag) & driven
    assert any(g["id"] == "side-1-crash-glue" for g in pack.block["glue"])


def test_window_and_block_contents():
    pack = dieline_cartons.carton(100, 50, 150, style="straight-tuck", window=True)
    assert len(pack.sheet.holes) == 1
    blk = pack.block
    assert blk["family"] == "folding-carton" and blk["inside"] == {
        "length": 100.0, "width": 50.0, "depth": 150.0}
    front = next(p for p in blk["panels"] if p["name"] == "front")
    assert len(front["safe"]) == 4 and len(front["bleed"]) == 4
    glue = next(p for p in blk["panels"] if p["name"] == "glue-flap")
    assert glue["print"] is False and "bleed" not in glue
    assert blk["grain"]["kind"] == "grain"
    assert dieline_boxes.slotted(300, 200, 100).block["grain"]["kind"] == "flute"


def test_builder_errors():
    d = dieline.Dieline("x", "test", "folding-carton", {"length": 10}, "kami", 0.1)
    d.rect("a", 0, 0, 10, 10)
    d.rect("b", 20, 0, 30, 10)
    d.hinge("a", "b")
    with pytest.raises(ValueError, match="one connected piece"):
        d.build("a")
    d2 = dieline.Dieline("y", "test", "folding-carton", {"length": 10}, "kami", 0.1)
    d2.rect("a", 0, 0, 10, 10)
    d2.rect("b", 10, 0, 20, 10)
    d2.rect("c", 20, 0, 30, 10)
    d2.hinge("a", "c")
    with pytest.raises(ValueError, match="share no edge"):
        d2.build("a")
    with pytest.raises(ValueError):
        dieline_boxes.slotted(100, 200, 50)            # W > L
    with pytest.raises(ValueError):
        dieline_cartons.carton(100, 50, 100, style="pillow")
