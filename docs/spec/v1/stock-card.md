# Stock card v1 — paper (and other sheet) materials

> Last Updated: 2026-10-10
> Boundary: public-safe specification. Policy: [`../../PUBLIC_REPO_BOUNDARY.md`](../../PUBLIC_REPO_BOUNDARY.md).

A stock card (`materials/<slug>/stock.json`) describes one sheet material once, for every use:
fabrication (cutting, scoring, folding), physics (the engine), rendering, and the encyclopaedia.
It keeps Fashion Cabinet's honesty split (`rsC_report.md` §d): **measured** values carry a source and
test method; **estimated** values carry a basis; **derived** values are computed by
`pliego.stock.derive()` — the only implementation of the mapping — and committed so the engine and
the studio never re-derive (CI fails if a committed `derived` block drifts from a fresh derivation).

Schema: [`packages/schemas/stock-card.schema.json`](../../../packages/schemas/stock-card.schema.json).

```json
{
  "stock": {
    "slug": "copy-80",
    "name": {"en": "Copy paper 80 g/m²", "es": "Papel bond 80 g/m²", "fr": "Papier ramette 80 g/m²", "pt": "Papel sulfite 80 g/m²"},
    "class": "text",
    "fiber": ["wood-pulp"],
    "finish": "uncoated",
    "color": "#f7f7f2",
    "grain": "long"
  },
  "physical": {
    "gsm":        {"value": 80,  "status": "nominal",   "source": "grade designation"},
    "caliper_um": {"value": 100, "status": "estimated", "basis": "typical 0.8 g/cm³ office grade"},
    "E_md_gpa":   {"value": 5.5, "status": "estimated", "basis": "rsE §b, TSI × density"},
    "E_cd_gpa":   {"value": 2.5, "status": "estimated", "basis": "MD/CD ≈ 2.2 (Baum et al. 1981)"},
    "nu":         {"value": 0.293, "status": "estimated", "basis": "√(ν12·ν21) = 0.293 (Baum et al. 1981)"},
    "bending_stiffness_mNm": {"md": null, "cd": null, "method": null},
    "crease_length_scale_t": {"value": 200, "status": "estimated", "basis": "L* ≈ 200·t measured on Mylar (Lechenault 2014); paper unmeasured"},
    "crease_yield_deg": {"value": 35, "status": "estimated", "basis": "rest opening 27–43° (Lechenault 2014)"},
    "tear_strain": {"value": 0.02, "status": "estimated", "basis": "typical elongation at break, office grade"},
    "friction":    {"value": 0.4, "status": "estimated", "basis": "paper on paper 0.3–0.6"}
  },
  "fabrication": {
    "min_feature_mm": 1.0,
    "score": "recommended above 160 g/m²",
    "laser": null,
    "plotter": null,
    "glue": ["pva", "glue-stick", "double-sided-tape"]
  },
  "appearance": {"front": "#f7f7f2", "back": "#f7f7f2", "translucency": 0.15, "roughness": 0.9},
  "derived": { "…": "spec sheet-document.md §5.2 keys, engine units, written by pliego.stock.derive()" },
  "derived_basis": "pliego.stock.derive v1",
  "provenance": {"author": "Innovaciones MADFAM", "license": "CERN-OHL-W-2.0", "sources": ["…"]}
}
```

**Rules**

- `status` ∈ `measured` (requires `source` and, for mechanical values, `method`, e.g. `ASTM D1388
  cantilever`, `ISO 5628`), `nominal` (a grade designation), `estimated` (requires `basis`).
- Measured `bending_stiffness_mNm` overrides `E·t³/12(1−ν²)` in `derive()`.
- Heritage stocks (amate, papel de china, washi) record their tradition and makers in `provenance`
  with cited sources; no uncited cultural claims (RFC 0039 citation bar).
- `name` is quadrilingual (en/es/fr/pt), Spanish register is the quality bar.
- The commons licence of a stock card is the commons licence (two agreeing fields as for cartridges,
  once ruled).
