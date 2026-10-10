# The Pliego engine — design, physics and verification contract

> Last Updated: 2026-10-10
> Boundary: public-safe design document. Policy: [`../PUBLIC_REPO_BOUNDARY.md`](../PUBLIC_REPO_BOUNDARY.md).

`packages/engine` (`@pliego/engine`, private, zero runtime dependencies) loads a
[sheet document](../spec/v1/sheet-document.md) and simulates it: rigid kinematics for mechanisms
and rigid-foldable patterns, and compliant XPBD physics with the real stiffness of the paper stock.
It runs unchanged in the browser (the studio) and in Node ≥ 20 (tests, CI benchmarks, headless
bakes). It is written as **plain ES modules with JSDoc types** (`// @ts-check`), no build step, so the
studio serves it directly under a strict CSP and Node runs it directly with `node --test`.

Research behind every choice below:
`claudedocs/pliego-2026-10-10/research/rsE_report.md` (physics memo, citations) and `rsC_report.md`
§c (why Fashion Cabinet's cloth solver cannot be reused for paper: it diverges at paper stiffness).

---

## 1. Two tiers

| Tier | State | Use | Module |
|---|---|---|---|
| **R — rigid/kinematic** | fold angle per crease; rigid panels | pop-up linkages, rigid origami (Miura), flexagons, kinematic boards, "does it fold" checks, warm starts | `src/kinematics/*` |
| **C — compliant** | vertex positions (Float64Array) | real paper: bending, springback, crease memory, contact, wind, page turns, drape, kirigami opening | `src/xpbd/*` |

Tier R gives Tier C its drive targets and consistent initial states; Tier C gives the realism. A
document's `pliego:sequence.mode` chooses which tier runs the fold program; mechanisms
(`pliego:mechanisms`) move kinematic sheets exactly in both modes.

---

## 2. Mesh (from the document)

1. **Per sheet**, take its faces (simple polygons, CCW, in sheet-local coordinates).
2. **Split every original edge** into segments of length ≤ `h` (target edge length; default from
   the document size, typically 4–8 mm; caller can override). Splits on shared edges are computed
   once per edge so both faces agree (conforming).
3. **Triangulate each face** by ear clipping over its split boundary.
4. **Refine** by longest-edge bisection (Rivara) until every triangle edge ≤ `h` and no triangle has
   an angle < ~20° where avoidable. Bisection of an edge that lies on an original edge stays on it, so
   crease and cut lines remain exact mesh edges.
5. **Cut edges** (`C`): vertices along a cut polyline are duplicated so the two sides are
   topologically separate (cut tips keep one shared vertex).
6. **Hinges**: every interior mesh edge shared by two triangles becomes a hinge with a kind:
   `panel` (inside a face or across `F`/`J`/`U` edges), `crease`, `score`, `perforation` (from the
   original edge's treatment). Each hinge stores its four vertex indices `(p0, p1 | w0, w1)`, rest
   length, the two rest triangle areas, and the in-plane angle φ between MD (grain) and the hinge's
   curvature direction (perpendicular to the edge in sheet-local coordinates).
7. **Mass**: lumped — each triangle gives a third of `area × areal_density` to each vertex.
8. **Render mesh**: vertices are split again along crease/score/perforation hinges into smoothing
   groups (sharp shading at folds, smooth inside panels). Each render vertex carries sheet-local UV
   (`u/width, v/height` of the sheet bbox) and its sheet index. The renderer computes normals from the
   simulated positions every frame.

All arrays are typed (Float64Array for state, Int32Array/Uint32Array for topology), structure-of-
arrays, allocated once at load. No per-step allocation.

---

## 3. Tier C — XPBD

### 3.1 Integrator (small steps)

Fixed substep `Δt = 1/(60·S)` with `S` substeps per 60 Hz frame (default 20; settings 8–60).
`world.step(frameDt)` accumulates real time and runs whole substeps only — **never** a variable Δt.
Per substep (Macklin, Müller, Chentanez 2016; Macklin et al. 2019):

```
v ← v · exp(−c_air·Δt)                                  (substep-independent damping)
x̃ = x + Δt·v + Δt²·M⁻¹·f_ext                           (gravity −9810 mm/s², wind, grabs)
for each constraint j (fixed order, one iteration):
    α̃ = α_j / Δt²
    Δλ = (−C_j(x) − α̃·λ_j) / (Σ_i w_i |∇_i C_j|² + α̃)      λ_j reset to 0 at substep start
    x_i += w_i ∇_i C_j Δλ
v = (x − x_prev) / Δt
```

`w_i = 1/m_i`; kinematic and pinned vertices have `w = 0` and move along their driver's path.
After the constraint sweep, a **strain-limit pass** projects any membrane edge whose strain exceeds
0.5 % back to 0.5 % (paper must never visibly stretch; the pass also guards against divergence).

### 3.2 Constraints and stiffness (engine units: mm, g, s)

| Constraint | C(x) | Stiffness k (α = 1/k) | Source |
|---|---|---|---|
| **Membrane (default: per-edge)** | `|x_i − x_j| − l₀` | `k = E(φ_e)·t·w_e / l₀` with `w_e` the Voronoi width ≈ `(A₁+A₂)/(1.5·l₀)` (or 2A/l₀ for boundary edges) | rsE §a3.1 cheap mode |
| Membrane (quality mode, optional) | Green strain per triangle, 3×3 block | `t·A·Q` orthotropic plane stress | rsE §a3.1 |
| **Panel bending** | `θ − θ̄` (signed dihedral) | `k_b = c_b · D(φ) · |e|² / (A₁+A₂)`; `c_b` **calibrated by test E1** (start at 6, Grinspun's normalisation) | rsE §a3.2 |
| **Crease** | `θ − θ_rest` (or `θ − θ_target` while driven) | `k_c = (D(φ)/L*)·|e|`, `L* = D / crease_k` from the stock (`crease_k` is per mm) ⇒ `k_c = crease_k · |e|` | Lechenault et al. 2014 |
| Score / perforation hinge | as crease | `k_c × score_factor` / `× perf_factor` | stock |
| **Fold limit** | `|θ| ≤ π − θ_t` (unilateral) | hard | rsE §a3.5 |
| **Glue weld** | `x_a − Σ β_k x_bk = 0` (vector; point on triangle of sheet b, barycentric β) | hard (α = 0) | doc §5.3 |
| Pivot | `x_a(β) − x_b(β′) = 0` | hard | doc §5.3 |
| String | `|x_a − x_b| − L ≤ 0` (unilateral) | hard | doc §5.3 |
| Pin | vertex `w = 0`, position follows the pin | — | doc §5.3 |
| Slider | point stays on track segment: distance to the line = 0 and 0 ≤ s ≤ |track| | hard | doc §5.3 |
| Ground | `y − r ≥ 0` with friction | hard | — |
| Contact (layers) | vertex–triangle `s·n·(x − x_t) − t_c ≥ 0`, sidedness `s` memorised from the previous substep (seeded from `faceOrders` when present) | hard | rsE §a3.5 |
| Grab (user) | `x_i − target = 0` | soft (α from a "hand stiffness" setting) | — |

**Signed dihedral.** For hinge edge `(p0, p1)` with wing vertices `w0` (triangle `p0 p1 w0`) and `w1`
(triangle `p1 p0 w1`), unit normals `n0`, `n1`, unit edge `ê`:
`θ = atan2((n0 × n1)·ê, n0·n1)` — valid on the full range (−π, π], robust near ±π where acos-based
PBD bending fails. Sign convention matches FOLD: **valley positive** for the front side (+normal side
of a sheet lying flat with its front up).

**Gradient** (Bridson et al. 2003 / Ghassaei et al. 2018 eqs. 3–6; port the latter's MIT-licensed
formulation **with attribution in a source comment**): with `h0`, `h1` the heights of `w0`, `w1` over
the edge line,

```
∂θ/∂w0 = −n0/h0 · s            ∂θ/∂w1 = −n1/h1 · s          (s = ±1 from the sign convention)
∂θ/∂p0 = cot-weighted combination; ∂θ/∂p1 = cot-weighted combination; Σ gradients = 0
```

**Test it against central finite differences** (test `dihedral-gradient`) on random well-shaped
configurations including θ near 0, ±90°, ±179°; relative error < 1e-6. Fix the sign convention once
and pin it with a test on a hand-built valley fold.

**Anisotropy.** `φ` is the angle between MD and the in-plane curvature direction of the hinge
(perpendicular to the edge). With `Q11 = E_md/(1−ν²)`, `Q22 = E_cd/(1−ν²)`, `Q12 = ν·√(Q11·Q22)`,
`Q66 = G12 = 0.387·√(E_md·E_cd)` (Baum et al. 1981), `D_ij = Q_ij t³/12`:
`D(φ) = D11 cos⁴φ + 2(D12 + 2D66) sin²φ cos²φ + D22 sin⁴φ`.
The stock's `D_md`/`D_cd` are D11/D22 (the kernel derives them; measured values override). The
membrane edge modulus uses `E(φ_e) = 1/(cos⁴φ/E_md + sin⁴φ/E_cd + (1/G12 − 2ν/E_md) sin²φ cos²φ)`
with φ_e the angle between MD and the edge direction.

### 3.3 Crease plasticity and memory

Per crease/score/perforation hinge: `θ_rest` (init from `pliego:edges_restAngle`, default 0),
`θ_target` (set while a sequence step drives it), `memory ∈ [0, 1]`.

- **Driving** (sequence step active on this hinge): the constraint uses `θ_target(t)` (eased from the
  angle at step start to the target over `duration_ms`) and stiffness `k_c × hand_factor`
  (`hand_factor` default 50 — a folding hand overpowers paper).
- **Plastic set** (rate-independent, Narain et al. 2013): after each substep, if
  `|θ − θ_rest| > θ_y` then `θ_rest ← θ − sign(θ − θ_rest)·θ_y`, `θ_y = crease_yield_deg`
  (default 35° for paper: a crease pressed flat and released rests ~35° open, matching Lechenault's
  measured 27–43°). `memory ← 1` once a hinge has yielded.
- **Release** (`release` list of a step): `θ_target` is cleared; the hinge relaxes to `θ_rest` with its
  normal stiffness — "crease and unfold" leaves a visible crease.
- **Panel hinges** use the same rule with a much larger yield (`θ_y,panel = 60°` default) so paper can
  take a permanent curl only under extreme bending; virgin paper never folds sharply except where
  forced (a fold made by grabbing produces a soft roll, as real paper does without a bone folder).
- Slow logarithmic relaxation (Thiria & Adda-Bedia 2011) is a later option (`relaxation: true`), off
  by default until measured stock data exists.

### 3.4 Contact

- Broad phase: uniform spatial hash, cell = 2 × max mesh edge, rebuilt each frame (not each substep)
  with an inflated query radius.
- Narrow phase: vertex–triangle (point to closest point on triangle), skip triangles that contain the
  vertex or share a vertex with it. Contact distance `t_c = max(collision_thickness, 0.05 mm)`.
- Sidedness: each active pair memorises which side the vertex was on; the projection pushes toward
  that side (prevents pass-through when layers are nearly coplanar). When the document has
  `faceOrders`, seed sidedness for pairs of faces that overlap in the flat-folded state.
- Friction: position-level Coulomb with the stock's `friction`.
- Ground plane `y = 0` with friction (pop-up books sit on a table).
- Inter-sheet and self contact both use this path; it can be switched off per world (`contact: false`)
  for speed in documents that do not need it (single page turns).

### 3.5 Air and wind

Per triangle: `f = −½ ρ_air C_d A (v_rel·n)|v_rel·n| n`, `ρ_air = 1.2e-6 g/mm³`, `C_d = 1.2`,
`v_rel = v_tri − v_wind`. Wind velocity comes from a `wind` control (m/s) plus deterministic
turbulence (sum of sines with phases from a seeded PRNG — never `Math.random`). Tissue
(`papel de china`, ~17 g/m²) is air-dominated; cardstock is not — this is what makes papel picado
flutter and pop-up cards stand still.

---

## 4. Tier R — kinematics

- **Face tree pose.** Spanning tree of the face-adjacency graph from a root face; each child face's
  transform = parent transform ∘ rotation about the shared crease line (in the flat state) by its fold
  angle. Exact for consistent angle sets.
- **Loop-closure solver** (rigid origami, Tachi 2009 / Belcastro–Hull): residual per interior vertex
  `r_v = vee(log(R(e1,ρ1)⋯R(ek,ρk)))`; Jacobian columns are the current crease directions; drive
  step projected onto the null space with damped least squares `C⁺ = Cᵀ(CCᵀ + λ²I)⁻¹`, then Newton
  correction until `‖r‖ < 1e-10`. Report `DOF = m − rank(C)`.
- **Closed forms** used as fast paths and test oracles: degree-4 flat-foldable vertex (Foschi, Hull,
  Ku 2022, Thm 1), Miura-ori, V-fold and parallel-fold pop-ups (degree-4 vertex on the gutter;
  planar parallelogram four-bar).
- **Kinematic sheets** (`sheet.kinematic`) follow their mechanism transforms exactly in both tiers.

---

## 5. Public API (initial)

```js
import { loadDocument, buildMesh, World, kinematics, materials } from '@pliego/engine';

const doc = loadDocument(json);              // validates (§8 of the spec), throws DocumentError listing every problem
const world = new World(doc, {
  meshEdge: 6,            // mm, target edge length
  substeps: 20,           // per 60 Hz frame
  contact: true, ground: true, gravity: true,
  seed: 1,                // turbulence PRNG
});
world.setControl('open', 120);               // any pliego:controls id
world.step(1/60);                            // advances whole substeps only
world.positions;                             // Float64Array xyz (simulation vertices)
world.render();                              // { positions: Float32Array, normals, uvs, sheetIds, indices } (render mesh, reused buffers)
world.grab(vertexIndex, [x,y,z]); world.moveGrab([x,y,z]); world.release();
world.pick(rayOrigin, rayDir);               // → { vertex, triangle, point, sheet } | null
world.stats();                               // { maxStrain, energy: {stretch, bend, crease}, contacts, substepsRun }
world.snapshot(); world.restore(snap);       // bit-exact
```

Errors are explicit and fail closed: a document that violates the spec never half-loads.

---

## 6. Determinism contract

Same document + same `World` options + same sequence of `setControl/grab/step` calls ⇒
**bit-identical** `positions` (Float64) on the same JS engine. Rules: fixed substeps only; fixed
constraint order (authored); no `Math.random` (seeded PRNG); no `Date`/`performance` inside `step`;
no iteration over object keys whose order could vary; typed arrays only in the hot loop. Test
`determinism-replay` runs a 600-frame scripted session twice and compares bytes.

---

## 7. Verification suite (`node --test packages/engine/test`)

Numbers are from the physics memo (§e there) unless stated. Every test prints a read-proof line
(`bench <id>: measured=… expected=… tol=… PASS|FAIL`).

| id | What | Pass condition |
|---|---|---|
| dihedral-gradient | analytic vs finite-difference gradient | rel. error < 1e-6 incl. θ ≈ ±179° |
| sign-convention | hand-built valley fold of a flat square | θ > 0 for valley, < 0 for mountain |
| E1-peirce | copy paper 80 g/m² strip, MD then CD, self-weight; find the overhang where the tip chord droops 41.5° | MD overhang 172 mm ± 3 % after calibrating `c_b`; then **CD 132 mm ± 5 % with no recalibration** |
| E2-cantilever | 50 mm strip, small tip load | δ = PL³/(3D·w) within 2 % at δ/L < 0.05 |
| inextensible | hanging A5 sheet pinned at two corners; page turn | max membrane strain < 0.5 % every frame |
| crease-drive | single valley crease driven to 180°, then released | reaches 180 ± 2° while driven; after release rests at 180 − θ_y ± 5° (≈145°) |
| crease-unfold | drive to 180°, then drive to 0°, release | leaves a visible memory: rest angle ≠ 0, sheet not flat |
| E5-degree4 | vertex α = (70, 80, 110, 100)°, Tier R | mode 1 at ρ1 = 90° → |ρ2| = 29.13°; mode 2 at ρ2 = 90° → |ρ1| = 10.31° (error < 1e-6°); Tier C with stiff panels within 0.5° |
| E6-miura | Miura sheet (γ, θ) ∈ {(60,60), (45,45), (60,30)}° | ν_SL = −cos²θ·tan²γ: −0.75, −0.50, −2.25 (Tier R exact to 1e-9; Tier C within 2 %) |
| E9-vfold | card + V-fold piece glued across the gutter, open 0→180° | 1 DOF; flat at 0° and 180°; piece angle follows the degree-4 closed form within 0.5° |
| E10-parallel | parallel (box) fold | flat at both extremes when opposite links are equal; unequal links flagged as a lock |
| E12-substeps | halve Δt (double S) on E2 and crease-drive | equilibrium shift < 0.5 % |
| contact-stack | two sheets dropped onto each other and onto the ground | no interpenetration (min gap ≥ 0.9·t_c), no NaN |
| mesh-sweep | E2 and a page turn at h ∈ {10, 6, 4, 3} mm | no NaN, bounded energy, max strain < 0.5 %, results converge |
| wind-tissue | 17 g/m² flag pinned along its top edge, wind 2 m/s | stable 3000 frames, flutters (rms displacement > 1 mm), no NaN |
| determinism-replay | 600 scripted frames twice | byte-identical positions |
| perf-budget | 1500-vertex sheet with creases, S = 20, Node on the dev machine | report ms/frame (target < 8 ms); report, do not fail, on slower hardware |

Calibration constants (`c_b`, default `hand_factor`, panel yield) live in one file
(`src/constants.js`) with the test that fixed them named next to each value.

---

## 8. Out of scope for v0.1 (tracked)

WebGPU coloured Gauss–Seidel; quality-mode orthotropic membrane; logarithmic crease relaxation;
stress-driven tearing (cuts only; perforations may separate at `tear_strain`); developable page
upsampling; edge–edge contact; Python XPBD reference for cross-implementation parity (E16).
