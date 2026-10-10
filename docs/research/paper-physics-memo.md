# Paper physics design memo — origami, kirigami, papercut, pop-up, page turning

> Last Updated: 2026-10-10
> Boundary: public-safe research memo (citations to public papers, specs and licences only).
> Policy: [`../PUBLIC_REPO_BOUNDARY.md`](../PUBLIC_REPO_BOUNDARY.md).
>
> **Editor's note.** This is the research memo the engine and kernel were designed from. It
> proposed a `madfam:` FOLD namespace; the shipped contract uses `pliego:` — see
> [`../spec/v1/sheet-document.md`](../spec/v1/sheet-document.md) and
> [`../strategy/engine.md`](../strategy/engine.md). Material values marked [E] are estimates
> until measured.

Design research, 2026-10-10. Scope: browser engine (TypeScript; WebGL2 baseline, WebGPU optional), a pure-stdlib Python reference kernel, and a public commons of hyperobjects. Platform code is AGPL-3.0 and commons objects are CERN-OHL-W-2.0.

Evidence labels used below:
- **[V]** I checked this against a primary source in this session (a paper PDF, a spec, or the repo's LICENSE through the GitHub API).
- **[L]** This comes from the literature as I know it, but I could not fetch the source in this session.
- **[E]** This is an engineering estimate and needs measurement.

---

## 0. Decisions in one screen

1. **Use a two-tier solver.**
   - **Tier R** is a rigid/kinematic solver over fold angles, using Belcastro–Hull/Tachi loop closure. It covers rigid origami, pop-up linkages, flexagons and design-time "does it fold" checks.
   - **Tier C** is an XPBD compliant solver over vertex positions. It has membrane, bending, crease, plasticity, contact, cut and tear constraints, with compliances derived from the paper stock in SI units.
   - Tier R supplies crease targets, warm starts and design validation to Tier C. Tier C supplies realism: floppiness, springback, contact and page flutter.
2. **Do not adopt Origami Simulator's explicit integrator.** Its stability limit makes physical stiffness ratios impossible (§a4). Use it as a reference, and port its MIT-licensed dihedral-gradient formulation with attribution.
3. **Use FOLD 1.2 as the canonical geometry and topology format.** Add a namespaced extension (`madfam:`) for material, grain direction, crease state (rest angle, plastic memory), mechanisms (pivots, slides, glue) and provenance. FOLD is MIT [V]. Its `C`/`J` edge assignments and `faceOrders` already cover cuts and layering [V].
4. **License position.**
   - **Depend on or port (MIT/ISC/BSL/Apache):** FOLD, Origami Simulator pieces, flat-folder (Jason Ku), Oriedita, Box Pleating Studio, cp-editor, Gary Choi's kirigami code (Apache-2.0), Clipper2, earcut, cdt2d and three.js.
   - **Oracles only, no core dependency:** Rabbit Ear (GPL-3.0), ORIPA (GPL-3.0) and TreeMaker (GPL-2.0-or-later). These are legally combinable with AGPL-3.0, but keeping them out of the core keeps the SDK relicensable.
   - **Implement from papers:** Tachi's tools, MERLIN, and unlicensed repos (§d).

---

## (a) Recommended solver architecture

### a1. Data model

```
PaperObject (FOLD 1.2 frame tree)
 ├─ frame 0: creasePattern (2D, frame_unit "mm"), edges_assignment ∈ {B,M,V,F,U,C,J}
 ├─ frames k: foldedForm states (3D coords, edges_foldAngle, faceOrders), frame_parent/inherit
 └─ madfam:* extension (FOLD allows custom namespaced keys)
     madfam:stock        → id in material table (§b) + overrides (E_MD,E_CD,ν,t,gsm,L*)
     madfam:grain        → unit vector of machine direction (MD) in the CP frame
     madfam:edges_restAngle, madfam:edges_creaseState (virgin|scored|creased|cut|torn), madfam:edges_memory
     madfam:mechanisms   → pivots (revolute), slots (prismatic), glue (J-like bonds between sheets), tabs
     madfam:assembly     → multiple sheets + glue map (pop-up card = base sheet + pieces)
     madfam:provenance   → author, tradition, license (CERN-OHL-W-2.0), source citation
```

FOLD facts I checked against the spec ([spec.md](https://github.com/edemaine/fold/blob/main/doc/spec.md)) [V]:
- The current version is 1.2.
- `edges_foldAngle` is in degrees in [−180, 180]: positive for valley, negative for mountain, zero for flat/border/unassigned.
- `C` means cut/slit (treat it as two `B` edges) and `J` means join (merge the incident faces).
- `faceOrders` holds triples `[f,g,s]`. s=+1 means f lies above g on the side of g's normal, −1 means below, and 0 means unknown.
- `file_frames` together with `frame_parent` and `frame_inherit` encode a tree of states, so an animation or a fold sequence is a chain of frames that override `vertices_coords` and `edges_foldAngle`.
- The repo is MIT ([LICENSE](https://github.com/edemaine/fold), checked via the GitHub API) [V].

### a2. Tier R: rigid-origami kinematic solver

**State.** The state is the vector of fold angles ρ ∈ ℝ^m, one per crease. Facet diagonals of non-triangular panels are included, with ρ pinned to 0 when the panel is rigid.

**Vertex loop closure.** Take an interior vertex v whose incident creases e₁…e_k are in counter-clockwise order. Write R(eᵢ,ρᵢ) for the rotation about the *flat-state* line of crease eᵢ by angle ρᵢ. Rigid foldability then requires:

  F_v(ρ) = R(e₁,ρ₁) R(e₂,ρ₂) ⋯ R(e_k,ρ_k) = I

This is Belcastro & Hull 2002, as restated in Foschi, Hull & Ku ([arXiv:2206.12691](https://arxiv.org/abs/2206.12691)) [V]. Tachi 2009 uses it to build a simulator ("Simulation of Rigid Origami", Origami⁴, pp. 175–187) [L].

**Residual and Jacobian.**
- The residual is r_v = vee(log F_v) ∈ ℝ³, three scalar equations per interior vertex.
- To first order around the current state, ∂r_v/∂ρᵢ = ℓᵢ, where ℓᵢ is the current 3D unit direction of crease i expressed in the frame of the vertex's reference face. This is the angular-velocity sum Σ ρ̇ᵢ ℓᵢ = 0 [L, standard].
- Patterns with holes (kirigami, pop-up cards with cuts, frames) need extra closure around every independent hole loop. Use rotation Σρ̇ᵢℓᵢ = 0 and translation Σρ̇ᵢ (pᵢ × ℓᵢ) = 0, written in Plücker/screw form, giving 6 equations per loop.
- Stacking these gives C(ρ) ∈ ℝ^{(3V+6H)×m}.

**Motion step (Tachi-style projection).**
- Let ρ̇_drive be the user's intent: a dragged crease, a target-angle schedule, or the opening angle of a pop-up card.
- Project it onto the null space: Δρ = (I − C⁺C) Δρ_drive · h.
- Then Newton-correct: ρ ← ρ − C⁺ r(ρ), repeating until ‖r‖ < 1e-10 rad.
- Use damped least squares, C⁺ = Cᵀ(CCᵀ + λ²I)⁻¹, because the flat state is a singular configuration where every mode crosses.
- Track the singular values of C. A singular value crossing zero marks a bifurcation (mode switch). At ρ = 0, pick the branch by the sign of the drive.

**Pose reconstruction.** Traverse a spanning tree of the face-adjacency graph from a fixed root face and compose the crease rotations.

**DOF diagnostic.** DOF = m − rank(C). For a generic triangulated disk this equals E_int − 3V_int [L]. Report it in the editor: 1-DOF means a single mechanism such as a V-fold or a Miura sheet; 0 means locked; more than 1 means floppy.

**Closed forms for tests and fast paths** [V, Foschi–Hull–Ku Thm 1]. Take a developable, flat-foldable degree-4 vertex with sector angles α₁ ≤ α₂ < α₃ = π−α₁ and α₄ = π−α₂. It has two modes:
- Mode 1: ρ₁ = ρ₃, ρ₂ = −ρ₄, and tan(ρ₂/2) = −[cos((α₁+α₂)/2) / cos((α₁−α₂)/2)] · tan(ρ₁/2).
- Mode 2: ρ₁ = −ρ₃, ρ₂ = ρ₄, and tan(ρ₁/2) = [sin((α₁−α₂)/2) / sin((α₁+α₂)/2)] · tan(ρ₂/2).

For a non-flat-foldable degree-4 vertex, Huffman's relation for opposite folds is sin²(ρᵢ/2) = [sin αᵢ₊₁ sin αᵢ₊₂ / (sin αᵢ sin αᵢ₊₃)] · sin²(ρᵢ₊₂/2).

**Pop-ups in Tier R.** A pop-up card is a multi-sheet rigid origami with glue joints:
- A V-fold is a degree-4 vertex on the gutter, so its closed form above applies.
- A parallel (box) fold is a planar parallelogram 4-bar.

Lee, Tor & Soo modelled pop-ups this way (["Mathematical modelling and simulation of pop-up books", Computers & Graphics 20(1):21–31, 1996](https://ixdf.org/literature/author/e-l-soo)) [V for citation]. The card opening angle is the drive ρ_spine.

**Thickness accommodation (for board and engineering stock in Tier R).** Supply offset-panel and offset-crease variants:
- Tachi 2011, "Rigid-foldable thick origami" [L].
- Chen, Peng & You, Science 2015, "Origami of thick panels" [L].
- The survey by Lang, Tolman, Crampton, Magleby & Howell, Appl. Mech. Rev. 2018, "A review of thickness-accommodation techniques in origami-inspired engineering" [L].

For paper (t ≤ 0.4 mm), use the zero-thickness kinematics plus a layer-offset render. Thickness matters only in Tier C contact.

### a3. Tier C: XPBD compliant paper solver

**Integrator.** Use XPBD (Macklin, Müller & Chentanez, MIG 2016, "XPBD: position-based simulation of compliant constrained dynamics") with substepping and one iteration per substep (Macklin et al. 2019, "Small steps in physics simulation") [L]. Per substep of length Δt:

```
x̃ = x + Δt v + Δt² M⁻¹ f_ext          (gravity, air drag, user grabs)
λ ← 0
for each constraint j (colored Gauss–Seidel on WebGPU; Jacobi+averaging on WebGL2):
   α̃_j = α_j / Δt²,  γ_j = α̃_j β_j / Δt          (β_j: Rayleigh-like damping in s)
   Δλ_j = ( −C_j(x) − α̃_j λ_j − γ_j ∇C_j·(x − xⁿ) ) / ( (1+γ_j) Σ_i w_i |∇_i C_j|² + α̃_j )
   x_i += w_i ∇_i C_j Δλ_j ;  λ_j += Δλ_j
v = (x − xⁿ)/Δt
```

Here wᵢ = 1/mᵢ, and mᵢ = (gsm/1000) × (lumped vertex area) in kg. Compliance α has units of inverse stiffness. The defining property of XPBD is that the stored energy is ½ α⁻¹ C², so **setting α from physical stiffness gives timestep-independent physical behaviour**. This is the reason to choose XPBD over explicit integration.

**Constraint set.**

1. **Membrane (stretch and shear), orthotropic.** Paper is nearly inextensible at the scales we render, but its MD/CD anisotropy matters for kirigami opening and for tearing.
   - For each triangle T with rest area A_T, take the deformation gradient F in the 2D material frame (u = MD, v = CD). Green strain is ε = ½(FᵀF − I), in Voigt form e = (ε_uu, ε_vv, 2ε_uv).
   - Use three coupled constraints C_T = e with block compliance α_T = (t·A_T·Q)⁻¹, where Q is the plane-stress orthotropic stiffness:
     Q₁₁ = E_MD/(1−ν₁₂ν₂₁), Q₂₂ = E_CD/(1−ν₁₂ν₂₁), Q₁₂ = ν₁₂E_CD/(1−ν₁₂ν₂₁), Q₆₆ = G₁₂.
   - Solve the 3×3 block jointly (a strain-based-dynamics style block solve).
   - For defaults use Baum's paper-physics relations, which I checked in the source PDF ([Baum, Habeger & Fleischman 1981](https://bioresources.cnr.ncsu.edu/resources/measurement-of-the-orthotropic-elastic-constants-of-paper/)) [V]:
     - G₁₂ ≈ 0.387·√(E_MD·E_CD)
     - √(ν₁₂ν₂₁) ≈ 0.293. The same source shows lower values (around 0.09–0.2) for highly oriented or wet-strained sheets.
     - E_MD/E_CD is "typically" about 2.
   - A cheap mode for low-end devices: per-edge distance constraints C = |xᵢ−xⱼ| − l₀ with α = l₀/(Y·w_e), where Y = E·t and w_e is the Voronoi width. This loses the anisotropy and fixes ν at about 1/3.

2. **Facet bending (smooth panel bending)** on every interior non-crease edge e with adjacent faces (i, j, k) and (j, i, l).
   - Constraint: C_b = θ_e − θ̄_e.
   - Signed dihedral: θ = atan2((n₁×n₂)·ê, n₁·n₂). This is robust where acos-based PBD bending (Müller et al. 2007) fails near ±π.
   - Gradients, as given in Ghassaei et al. eqs. 3–6 [V, from the OSME 2018 PDF]. Use h₁ and h₂, the heights of the opposite vertices over the edge, and the in-plane angles α at the edge endpoints:
     - ∂θ/∂p₁ = n₁/h₁ and ∂θ/∂p₂ = n₂/h₂ for the two wing vertices.
     - The two edge endpoints receive the cotangent-weighted negative combinations, for example ∂θ/∂p₃ = −[cot α₄,₃₁/(cot α₃,₁₄+cot α₄,₃₁)]·n₁/h₁ − [cot α₄,₂₃/(cot α₃,₄₂+cot α₄,₂₃)]·n₂/h₂.
   - Stiffness, from discrete shells (Grinspun et al. 2003): E_e = ½k_b(θ−θ̄)², with k_b = c·D(φ_e)·|e|²/A_e. Here A_e is the summed area of the two triangles and c ≈ 6 in Grinspun's normalisation [L]. **Calibrate c with validation test E1 (the cantilever / Peirce bending length) rather than trusting it.** Tamstorf & Grinspun 2013 discuss the exact discretisation constants [L].
   - Compliance: α_b = 1/k_b.
   - **Anisotropic bending.** D(φ) = D₁₁cos⁴φ + 2(D₁₂+2D₆₆)sin²φcos²φ + D₂₂sin⁴φ, with D_ij = Q_ij t³/12. The angle φ is measured between MD and the in-plane direction perpendicular to edge e, which is the direction of curvature.
   - The isotropic special case is D = Et³/(12(1−ν²)).

3. **Crease hinge** on every M/V edge, after the edge is subdivided into crease segments of length L_e.
   - Constraint: C_c = θ_e − θ̄_c(t).
   - The crease is a material line much softer than the panel. Model it as an elastic hinge with stiffness per unit length κ = D/L*, so k_c = κ·L_e and α_c = L*/(D·L_e).
   - This L* is the same length scale as in Lechenault, Thiria & Adda-Bedia ([PRL 112, 244301 (2014); arXiv:1404.1243](https://arxiv.org/abs/1404.1243)). They measured M = κW(φ−φ₀) and found **L* ≈ 200·h for Mylar** [V]. Their rest opening angles were 27–43° in mechanical tests and 30–40° after free relaxation, with a weak dependence on thickness [V].
   - Bar-and-hinge models use the same form, K_F = L_F·E t³/(12(1−ν²))/L* (Filipov et al. 2017) [V for the form, via search; I could not fetch the PDF to confirm their recommended L* range].
   - Default: L* = 200 t for virgin hand creases. For machine-scored paperboard, use L* = 50–100 t, because scoring and delamination soften the hinge [E] (Beex & Peerlings, [IJSS 2009](https://orbilu.uni.lu/handle/10993/17431)) [V for the qualitative claim].
   - The quantity l/L* sets the behaviour: panels much smaller than L* behave like rigid origami, while panels much larger bend before the crease opens [V, Lechenault Eq. 5]. Tier C therefore converges to Tier R for small panels, which is test E4.

4. **Crease plasticity and memory** (rest-angle evolution).
   - *Formation.* A virgin edge becomes a crease when its local curvature exceeds the yield curvature, κ_loc > κ_y ≈ 2ε_y/t with ε_y ≈ σ_y/E [E]. Alternatively, the user's fold tool marks it.
   - *Rate-independent update* (as in the plastic bending of Narain, Pfaff & O'Brien, [TOG 32(4) 2013](https://history.siggraph.org/?p=108325)) [V for citation]: if |θ − θ̄| > θ_y, then θ̄ ← θ − sign(θ−θ̄)·θ_y. This captures springback, since an unloaded crease relaxes to θ̄, not to the angle it was pressed to.
   - *Slow relaxation.* Opening force decays logarithmically in time, an Arrhenius-type process (Thiria & Adda-Bedia, [PRL 107, 025506 (2011)](https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.107.025506), for both Mylar and paper) [V]. Model: θ̄(t) = θ̄₀ + A·ln(1 + t/τ) toward flat, with stock-specific A and τ [E, needs calibration].
   - *Memory.* Each crease edge carries m ∈ [0,1]. Re-folding along an existing crease uses k_c, while folding a virgin area uses k_b plus plastic yield. This makes "pre-creasing" and "collapse along existing creases" emerge naturally.
   - The same rest-angle update applied to facet edges gives crumpling and curl set, for example a page that stays curled.

5. **Fold-limit and contact.**
   - *Per crease:* a unilateral constraint |θ| ≤ π − θ_t, where θ_t ≈ 2·atan(t·n_layers/L_panel). This stops the solver from folding through itself at the flat state.
   - *Self-collision:* use vertex–triangle and edge–edge unilateral constraints with thickness gap t_c = max(t, t_min), where t_min ≈ 0.05 mm is a numerical floor. Use swept-volume tests (Bridson, Fedkiw & Anderson 2002, "Robust treatment of collisions, contact and friction for cloth animation") [L].
   - *Multilayer flat folds* are the hard case, because 5–50 layers are coplanar within micrometres. Seed the contact sidedness from `faceOrders`, computed with flat-folder or our port of it. For each overlapping face pair, the constraint s_fg·(n_g·(x − x_g)) − t ≥ 0 has a fixed sign s_fg, so contact never has to rediscover sidedness from a degenerate configuration.
   - If tangling happens anyway, use global intersection analysis to recover (Baraff, Witkin & Kass 2003, "Untangling cloth") [L].
   - For the offline Python reference, consider IPC / codimensional IPC (Li et al. 2020/2021) as a guaranteed intersection-free oracle on small meshes, implemented from the papers [L].
   - *Friction:* Coulomb friction in the position-level XPBD form. Use μ ≈ 0.3–0.6 for paper on paper [E].

6. **Cutting and tearing.**
   - *Cuts* are FOLD `C` edges. At load time, split vertices along the cut polyline to duplicate topology. Papel picado and kirigami cuts come from 2D boolean operations on the sheet outline (Clipper2, BSL-1.0 [V]), followed by constrained Delaunay triangulation (cdt2d, MIT [V]) with refinement near cut tips. Cut tips concentrate stress, so a tear criterion is needed there.
   - *Tearing:* when the membrane principal stress on an edge, normalised by stock tear strength (MD/CD-dependent; paper tears more easily along MD), exceeds a threshold, split the edge. Then propagate along the max-stress direction, and add procedural fibre detail at render time (Schreck, Rohmer & Hahmann, ["Interactive paper tearing", CGF 36(2) 2017](https://diglib.eg.org/handle/10.1111/cgf13110)) [V for citation]. For adaptive remeshing, see Pfaff et al. 2014, "Adaptive tearing and cracking of thin sheets" [L].

7. **Air.** For each triangle, apply the normal drag f = −½ρ_air C_d A (v·n)|v·n| n. This matters a lot for tissue and papel de china, where the areal mass is only about 17 g/m². It is standard cloth practice [L].

8. **Glue and mechanisms.**
   - Glue (`J`-like) bonds between sheets are zero-compliance attachment constraints.
   - Pivots (volvelles) are revolute pins: a shared vertex plus coplanarity.
   - Pull-tabs are prismatic slot constraints, a point on a line segment with limits.
   - All of these are ordinary XPBD constraints, so mechanisms and paper flexing coexist.

### a4. Mapping paper stock to compliances, with a worked example

Inputs come from §b: gsm, t, E_MD, E_CD, ν₁₂, L*, the yield strain and the tear indices.

The compliances are as follows. Recall that α̃ = α/Δt² is what the solver sees.

| Constraint | Stiffness | Compliance α |
|---|---|---|
| Membrane, per triangle | t·A_T·Q (3×3) | (t·A_T·Q)⁻¹ |
| Edge stretch (cheap mode) | Y w_e / l₀, Y = E t | l₀/(Y w_e) |
| Facet bending | k_b = c·D(φ)·\|e\|²/A_e | A_e/(c·D(φ)·\|e\|²) |
| Crease | k_c = (D/L*)·L_e | L*/(D·L_e) |
| Glue, pin, slot | ∞ | 0 |

**Worked example: copy paper, 80 gsm, t = 0.1 mm, E_MD = 5.5 GPa, 2 mm mesh** [E for the stock values].
- D_MD = 5.0×10⁻⁴ N·m.
- Vertex mass ≈ 0.08 kg/m² × 3.5×10⁻⁶ m² ≈ 2.8×10⁻⁷ kg.
- Facet bending: k_b ≈ 6·D·|e|²/A_e ≈ 3.5×10⁻³ N·m/rad, so α_b ≈ 290.
- Crease (L* = 20 mm): k_c ≈ 5×10⁻⁵ N·m/rad, so α_c ≈ 2×10⁴, about 70 times softer than the panel per edge.
- Membrane edge stiffness ≈ 2.4×10⁵ N/m.

What this means for each integrator:
- **Explicit integration (Origami Simulator)** would need Δt < 1/(2π√(k/m)) ≈ 1.7×10⁻⁷ s, which is about 10⁵ steps per frame. That is why Origami Simulator uses non-dimensional EA = 20, k_fold = 0.7 and k_face = 0.2, and states that it disregards the stiffnesses' physical meaning [V, from the paper PDF]. Its integrator is forward Euler with viscous damping c = 2ζ√(k_axial m) and ζ ∈ [0.01, 0.5] [V].
- **XPBD** handles these SI values directly. With 10 substeps per 60 Hz frame, α̃_stretch ≈ 1.4, which is much smaller than wᵢ|∇C|² ≈ 7×10⁶. The membrane is therefore effectively inextensible, which is physically right for paper, and bending and crease forces remain correctly proportioned.

### a5. Page turning and book structures

- **Option 1: Tier C on a mid-resolution page mesh.** About 24×36 vertices per A5 page, with a high membrane stiffness so the page stays near-isometric and developable. The binding is a pinned hinge strip at the gutter.
- **Page stacks.** Pages in a codex have a strict 1D order. Replace general self-collision between pages by a pairwise ordered contact constraint between neighbouring pages i and i+1, plus collisions only against the two immediate neighbours. This scales to hundreds of pages.
- **Reference work.** Wolf, Cornillère & Sorkine-Hornung, ["Physically-based Book Simulation with Freeform Developable Surfaces", CGF 2021](https://diglib.eg.org/handle/10.1111/cgf142646) [V for citation] runs a dynamic developable model for book pages in real time on mobile, mixing 2D and 3D. It builds on discrete orthogonal geodesic nets (Rabinovich, Hoffmann & Sorkine-Hornung, TOG 2018) [L].
- **Visual upsampling.** Map the simulated low-resolution mesh onto a ruled or developable surface for crisp rendering, as in the nonsmooth developable crumpling work of Schreck et al., [TOG 2015](https://research.manchester.ac.uk/en/publications/nonsmooth-developable-geometry-for-interactively-animating-paper-/) [V for citation].
- **Lightweight fallbacks:** cone and cylinder page-curl models (Hong, Card & Chen 2006, "Turning pages of 3D electronic books") [L], and the Waikato survey of page-turning techniques ([Liesaputra/Witten, "Computer graphics techniques for modeling page turning"](https://researchcommons.waikato.ac.nz/entities/publication/5202cfa3-335c-4f74-903e-22877dd688d9)) [V for citation].
- **Book structures** are assemblies:
  - A codex has signatures with a hinge strip.
  - An accordion or leporello, including the Mesoamerican screenfold, is one long strip with alternating M/V creases. The Dresden Codex is amate, about 20 cm high, 39 leaves and about 3.6–3.7 m unfolded ([Wikipedia: Dresden Codex](https://en.wikipedia.org/wiki/Dresden_Codex)) [V, secondary source].
  - Tunnel books, flexagons and carousel books are covered in §f.

### a6. Implementation split

- **TS/WebGPU.** Store constraints in structure-of-arrays buffers, partitioned by graph colouring into independent sets. Run one compute dispatch per colour per substep, with contact broad-phase on a uniform grid or BVH.
- **WebGL2 fallback.** Use Jacobi XPBD with constraint averaging in fragment shaders over float textures, the pattern Origami Simulator uses.
- **Python reference kernel (pure stdlib, float64, deterministic):**
  - Tier R: loop closure with a small dense SVD written in stdlib.
  - Tier C: XPBD in serial Gauss–Seidel. It is fine up to roughly 5k vertices for validation and for exporting a "settled" state.
  - Exact geometry predicates with `fractions.Fraction`. **Exact Kawasaki check:** with rational crease directions (a, b), the reflection matrix (1/(a²+b²))·[[a²−b², 2ab], [2ab, b²−a²]] is rational. The vertex is flat-foldable locally iff the composition of reflections across its creases in cyclic order is the identity. That makes the check exact in rationals, with no trigonometry.
  - Maekawa |M−V| = 2 is an integer check.
  - Python is the arbiter: CI runs the same FOLD through TS and Python and compares states within tolerance.

---

## (b) Material default table

Formulas:
- ρ = gsm/t.
- D = E t³/(12(1−ν₁₂ν₂₁)), with √(ν₁₂ν₂₁) = 0.293 for paper [V, Baum].
- Peirce bending length c = (D/q)^{1/3}, with q = gsm·g. This is the cantilever "41.5°" test, where the overhang equals 2c [L, ASTM D1388/BS 3356].
- L* = 200t [V, for Mylar only; E for paper].

The table was computed from the formulas above with a short standard-library script. **Every E value is an estimate [E] unless a source is cited.** They come from typical specific tensile stiffness (TSI ≈ E/ρ) of machine-made papers, with MD around 2 times CD [V, Baum], checked against one reported pair, 6.83/3.11 GPa (MD/CD) for a printing grade [L, via search snippet].

| Stock | gsm | t (µm) | ρ (g/cm³) | E_MD / E_CD (GPa) | D_MD / D_CD (N·m) | c_MD / c_CD (mm) | L* default (mm) | Notes and sources |
|---|---|---|---|---|---|---|---|---|
| Tissue / papel de china (MG tissue) | 17 | 40 | 0.42 | 2.0 / 0.9 [E] | 1.2e-5 / 5.3e-6 | 41 / 32 | 8 | Very air-dominated. Cut in stacks of 40–50 with chisels for papel picado ([Wikipedia](https://en.wikipedia.org/wiki/Papel_picado)). gsm range 15–30 is the tariff class ([HTS 4805.91](https://tariffs.wove.com/us/tariff/4805.91.70.00)). |
| Washi, kozo (thin) | 30 | 80 | 0.38 | 1.5 / 1.0 [E] | 7.0e-5 / 4.7e-5 | 62 / 54 | 16 | Long bast fibres, so tear resistance is high. Handmade, so near-isotropic. UNESCO ICH 2014 ([01001](https://ich.unesco.org/en/RL/01001)). |
| Kami | 63 | 72 | 0.88 | 5.0 / 2.3 [E] | 1.7e-4 / 7.8e-5 | 65 / 50 | 14 | gsm and thickness are a user measurement: 63 gsm, 72 µm ([origami.me](https://origami.me/paper/)). Holds creases well. |
| Tant | 80 | ~105 [E] | 0.76 | 5.0 / 2.3 [E] | 5.3e-4 / 2.4e-4 | 88 / 68 | 21 | Measured around 80.7–81.7 gsm (origami.me). |
| Copy paper | 80 | 100 | 0.80 | 5.5 / 2.5 [E] | 5.0e-4 / 2.3e-4 | 86 / 66 | 20 | The canonical calibration stock. Measure it first (E1). |
| Elephant hide (Zanders) | 110 | ~120 [E] | 0.92 | 6.5 / 3.2 [E] | 1.0e-3 / 5.0e-4 | 98 / 78 | 24 | Dense, parchment-like, good for wet folding. 110 gsm is a sold grade ([Talas](https://www.talasonline.com/Elephant-Hide-Paper)). |
| Kraft | 120 | 160 | 0.75 | 6.5 / 2.8 [E] | 2.4e-3 / 1.1e-3 | 127 / 96 | 32 | Tensile index around 90–110 MD and 55–60 CD N·m/g on sack-kraft datasheets ([Mondi TDS](https://www.mondigroup.com/globalassets/mondigroup.com/products--solutions/sack-kraft-paper/tds-update-2025/flat/mondi-skp-tds-advantage-kraft.pdf)). |
| Amate, Otomí bark paper (thin) | ~120 [E] | 150–400 | ~0.3–0.6 | 1–3 isotropic, heterogeneous [E] | ~2e-3 | ~120 | 50 | Beaten jonote/ficus bark laid in a grid, so near-isotropic but non-uniform ([LAM Museum](https://lammuseum.wfu.edu/2022/10/otomi-bark-paper/)). **No mechanical data found; needs measurement.** |
| Cardstock | 160 | 200 | 0.80 | 4.5 / 2.0 [E] | 3.3e-3 / 1.5e-3 | 128 / 98 | 40 (scored: 10–20) | Canson Mi-Teintes (160 gsm) measured at E ≈ 1.22 GPa in one study ([arXiv:2408.01889](https://arxiv.org/pdf/2408.01889)). This suggests textured art papers sit well below office-grade E. |
| Cardstock | 250 | 300 | 0.83 | 4.5 / 2.0 [E] | 1.1e-2 / 4.9e-3 | 165 / 126 | 60 (scored: 15–30) | Pop-up base stock. Score it; use the delamination model. |
| Cardstock | 300 | 360 | 0.83 | 4.5 / 2.0 [E] | 1.9e-2 / 8.5e-3 | 187 / 142 | 72 (scored: 18–36) | Use thick-crease geometry; crease width is about 1–2 t. |
| Foil paper (Al ~7–9 µm + tissue) | ~60–70 | ~60 | ~1.1 | effective 3–8 [E] | — | — | ≈∞ (fully plastic) | The aluminium layer yields almost immediately, so springback is near zero. Model it as θ_y → 0 with the crease rest angle equal to the pressed angle. |
| PET / Mylar (125 µm) | 174 | 125 | 1.39 | 3.6–4.1 MD/TD (Mylar A) | 7.2e-4 / 7.6e-4 | 75 / 76 | 25 (200 h, measured) | Datasheet modulus 3.6–3.8/3.8–4.1 GPa and density about 1.39–1.40 ([Mylar A datasheet](https://media.easycomposites.co.uk/datasheets/Mylar_A_50_to_125mic.pdf)) [V via search]. L* ≈ 200 h is measured on Mylar [V]. |
| PP sheet (300 µm) | 270 | 300 | 0.90 | 1.3–2.5 [E]; BOPP ≥ 2.5 | 4.1e-3 | 116 | 60 | Living-hinge capable. Its fatigue behaviour differs from paper. |

**Humidity.** Paper stiffness peaks near about 6% moisture content and decreases at higher RH. Hygroexpansion is much larger in CD than in MD, and it scales with an inverse power of the elastic modulus (bioresources/Cellulose literature, via search) [L]. Implementation:
- Carry an `rh` environment parameter.
- Scale E(RH) = E₅₀·f(RH), with f(80%) ≈ 0.6–0.7 [E].
- Add a CD hygro-strain to the membrane rest metric. This yields cockling and curl, which is an optional effect.

**Tear.** Store Elmendorf tear indices for MD and CD per stock. They are currently unknown for the craft papers, so default to "kraft high, tissue low, washi very high" [E].

**Measurement protocol for upgrading [E] to [V]** (cheap, and repeatable in the MADFAM lab):
- Cantilever bending length in MD and CD gives D (ASTM D1388).
- Calipers and a balance give t and gsm.
- Hang a single fold, measure its opening angle under small weights, and fit κ and φ₀ (the Lechenault protocol). This gives L* and the rest angle.
- Record a time-lapse of free crease relaxation and fit A and τ of the log law.

---

## (c) Algorithm inventory

Difficulty: S = days, M = 1–3 weeks, L = 1–2 months, XL = research-grade.

| Area | Algorithm and reference | Use | Difficulty |
|---|---|---|---|
| Local flat-foldability | Maekawa (\|M−V\| = 2); Kawasaki–Justin (alternating sum = π); big-little-big lemma; crimp/fold single-vertex algorithm (Demaine & O'Rourke, *Geometric Folding Algorithms*, 2007) [L] | Editor lint, exact Python check | S |
| Global flat-foldability | NP-hard in general (Bern & Hayes, SODA 1996, "The complexity of flat origami") [L]; box pleating is also hard (Akitaya et al. 2016) [L]; layer-order solving via flat-folder (Ku), which is MIT [V] | Compute `faceOrders`, seed contact sidedness | M (port) |
| Axioms | Huzita–Justin (7 one-fold axioms; Huzita 1989, Justin 1989, Hatori 2001); Alperin & Lang 2009 on multi-fold axioms [L] | Construction tools in the editor | S |
| Fold-and-cut | Demaine, Demaine & Lubiw 1998 straight-skeleton method; Bern, Demaine, Eppstein & Hayes disk-packing method [L] | "Fold, one cut" papercut mode (papel picado, jianzhi symmetry) | L (skeleton) / XL (robust) |
| Symmetric papercut | Fold the sheet n times (wedge or mirror groups), draw on the fundamental domain, then unfold by reflection (exact) | Jianzhi, wycinanki, scherenschnitte, papel picado | S |
| Tree method | Lang 1996 (SoCG, "A computational algorithm for origami design"); TreeMaker (GPL-2.0+) [V for license] | Uniaxial base design | L |
| Box pleating | Lang's box-pleating methods; Box Pleating Studio (MIT) [V] | Design | M (port) |
| Origamizer | Tachi 2010 (IEEE TVCG, "Origamizing polyhedral surfaces"); Demaine & Tachi SoCG 2017 [L] | Polyhedron to crease pattern | XL |
| Freeform origami | Tachi 2010, constraint projection keeping developability, flat-foldability and panel planarity [L] | Variation of tessellations | M (it shares Tier R) |
| Rigid origami | Belcastro–Hull, Tachi 2009, Foschi–Hull–Ku closed forms [V] | Tier R | M |
| Tessellations | Miura-ori (Schenk & Guest PNAS 2013) [V]; Yoshimura, Kresling (bistable, non-rigid: needs Tier C), waterbomb, Resch, square/hex twists (Lang, *Twists, Tilings, and Tessellations*, 2018) [L] | Generators plus commons seeds | S each |
| Curved-crease folding | Kilian et al., "Curved folding", TOG 27(3) 2008; Demaine, Demaine, Koschitz & Tachi review 2011; Woodruff & Filipov bar-and-hinge for curved creases 2020 [L] | Tier C with discretised creases and fine meshes; rulings for render | L |
| Kirigami, rotating units | Grima & Evans 2000 rotating squares (ν = −1) [L]; Konaković-Luković et al., "Beyond developable", TOG 35(4) 2016 [L]; Choi, Dudte & Mahadevan, Nat. Mater. 18 (2019) [L]; Choi's code is Apache-2.0 [V]; Castle et al., "Making the cut: lattice kirigami rules", PRL 113 (2014) [L]; Rafsanjani & Bertoldi 2017 (buckling kirigami) [L] | Cut generators, inverse design | M (forward) / L (inverse) |
| Pop-ups | Lee, Tor & Soo 1996 [V citation]; Glassner 2002 [L]; Mitani & Suzuki 2004 (origamic architecture) [L]; Li et al., "Popup", TOG 2010 [L]; Li et al., "A geometric study of v-style pop-ups", SIGGRAPH 2011 [V citation]; Abel et al., STACS 2013 [L]; Ruiz et al., CGF 33(2) 2014 [V citation]; Xiao et al., "Computational design of transforming pop-up books", TOG 2018 [V] | Tier R mechanisms plus design assistants | M (sim) / L (auto-design) |
| Flexagons | Trihexaflexagon (strip of 10 triangles, one glued); Tuckerman traverse; Gardner 1956 [L] | A discrete state graph plus Tier R animation of the pinch-flex | M |
| Bar-and-hinge (reference) | Schenk & Guest 2011; Filipov et al. IJSS 2017 [V form]; MERLIN/MERLIN2 (Liu & Paulino) [V description] | Validation cross-check (Tier C should agree in small-strain statics) | M (Python oracle) |
| Discrete shells | Grinspun et al. 2003; Tamstorf & Grinspun 2013 [L] | Bending energy calibration | S |
| Developable pages | Wolf et al. 2021 [V citation]; Rabinovich et al. 2018 [L] | Page-turn quality mode | L |
| Plastic creasing | Narain et al. 2013 [V citation]; Thiria & Adda-Bedia 2011 [V]; Lechenault et al. 2014 [V]; Jules et al., "Local mechanical description of an elastic fold" (arXiv:1808.04892) [L] | Crease memory and relaxation | M |
| Tearing | Schreck et al. 2017 [V citation]; Pfaff et al. 2014 [L] | Tear tool | L |
| Contact | Bridson et al. 2002; Baraff et al. 2003; IPC 2020 [L] | Multilayer robustness | L |
| Thickness accommodation | Lang et al. 2018 review; Chen, Peng & You 2015; Tachi 2011 [L] | Board and engineering stock | M |

---

## (d) License map and recommendation

All entries were checked via the GitHub API (SPDX field and LICENSE text) on 2026-10-10 unless noted.

| Tool | License (verified) | AGPL-3.0 compatible? | Recommendation |
|---|---|---|---|
| FOLD spec and JS lib ([edemaine/fold](https://github.com/edemaine/fold), npm `fold` 0.12.0) | MIT | Yes | **Depend on it** for I/O and conversions, or reimplement the subset. FOLD 1.2 is the canonical format. |
| Origami Simulator ([amandaghassaei/OrigamiSimulator](https://github.com/amandaghassaei/OrigamiSimulator)) | MIT, © 2018 Ghassaei | Yes | **Port selectively** with attribution: FOLD triangulation, dihedral gradients, GPGPU patterns. Do not adopt the explicit solver. Bundled deps (three.js MIT, earcut ISC, cdt2d MIT, numeric.js) need individual checks. **The example crease patterns are third-party designs** (Lang, Miyamoto, Gardner and others): do not import them into the commons. |
| Rabbit Ear ([rabbit-ear/rabbit-ear](https://github.com/rabbit-ear/rabbit-ear), v0.9.4) | GPL-3.0 | Combinable with AGPL-3.0 under §13 of both licenses | **Oracle and test harness only.** A core dependency would stop us offering the TS SDK under anything but GPL-family terms, and would complicate any future dual licensing. |
| ORIPA ([oripa/oripa](https://github.com/oripa/oripa), Java) | GPL-3.0 | Combinable, as above | **Oracle** for folded-shape estimation and `.opx` import tests. |
| Oriedita ([oriedita/oriedita](https://github.com/oriedita/oriedita), Java fork of Orihime) | MIT, plus the original Orihime author's statement placing no conditions on use or redistribution (quoted in LICENSE.md) | Yes | Portable. Useful for `.cp`/`.ori` import and fold estimation ideas. |
| Flat-Folder ([origamimagiro/flat-folder](https://github.com/origamimagiro/flat-folder), Jason Ku; plus `c-flat-folder`) | MIT | Yes | **Port it.** It is the best available layer-order and `faceOrders` solver, and it feeds Tier C contact sidedness. |
| TreeMaker 5 ([bugfolder/TreeMaker](https://github.com/bugfolder/TreeMaker), C++) | GPL-2.0-or-later; the bundled `wnlib` is unrestricted | Yes, via the GPLv3 upgrade path | Oracle. **Implement the tree method from Lang's papers.** |
| Box Pleating Studio ([MuTsunTsai/box-pleating-studio](https://github.com/MuTsunTsai/box-pleating-studio)) | MIT; active (pushed 2026-10-09) | Yes | Port or reference for TreeMaker-style design in TS. |
| Crease Pattern Editor ([edemaine/cp-editor](https://github.com/edemaine/cp-editor)) | MIT | Yes | Reference UI. |
| Gary Choi kirigami repos (`inverse-kirigami-design`, `additive-kirigami`, `PyKirigami` and others) | Apache-2.0 (`kirigami_sim` has no license) | Yes, one-way: Apache-2.0 into (A)GPLv3 | Port inverse-design ideas and keep the NOTICE files. Avoid `kirigami_sim`. |
| Freeform Origami, Rigid Origami Simulator, Origamizer (Tachi) | Freeware binaries with no OSS license [L] | No code reuse | **Implement from papers.** |
| MERLIN / MERLIN2 (Liu & Paulino, MATLAB) | "Free for researchers" ([Princeton page](https://paulino.scholar.princeton.edu/software/origami-mechanics)); no OSI license found | Unclear | Implement from papers; use as a numerical cross-check only. |
| zzhuyii/OrigamiSimulator (SWOMPS lineage, MATLAB) | No license, so all rights reserved | No | Do not copy. Read the papers. |
| Clipper2, earcut, cdt2d, three.js | BSL-1.0, ISC, MIT, MIT | Yes | Depend on them. Artem-ogre/CDT is MPL-2.0, which is file-level and compatible, but avoid it unless needed. |

**Commons note.** The CERN-OHL-W-2.0 objects must contain only designs we author or that are contributed with rights. Crease patterns by origami designers are generally treated as copyrighted works. Every commons object should carry `madfam:provenance` with author and license, and contributions should be gated. Traditional papercut *motifs* such as papel picado or jianzhi are cultural heritage, not anyone's licensed asset. They still deserve attribution of community and tradition, and the provenance schema should support that.

---

## (e) Validation suite (benchmarks with expected values)

Tolerances are for the TS GPU solver against the Python reference. The Python reference is checked against analytic values.

| # | Test | Setup | Expected | Tier |
|---|---|---|---|---|
| E1 | Peirce cantilever (calibrates c in k_b) | Copy-paper strip, MD, self-weight. Find the overhang where the tip chord droops 41.5° | Overhang = 2c, with c = (D/q)^{1/3}. With D = 5.0×10⁻⁴ N·m and q = 0.785 N/m², overhang ≈ 172 mm. Within 3% after calibration, then check CD (≈ 132 mm) **without recalibrating**, which tests anisotropy | C |
| E2 | Small-deflection cantilever | L = 50 mm, tip load P | δ = PL³/(3D·w), within 2% at δ/L < 0.05 | C |
| E3 | Single crease opening (Lechenault protocol) | Mylar strip 30×200 mm, h = 350 µm, pull ends | Moment linear in opening, M = κW(φ−φ₀), with κ = 0.27 N and φ₀ = 43° as published [V]. Reproduce the published (κ, φ₀) for h = 130, 350 and 500 µm | C |
| E4 | Rigid limit | Accordion strip with panel length l ≪ L* | Share of extension from crease opening = 1/(1 + l/(3L*)) [V, Lechenault Eq. 5]. Sweep l/L* from 0.1 to 10 | C vs R |
| E5 | Degree-4 vertex kinematics | α₁ = 70°, α₂ = 80°, α₃ = 110°, α₄ = 100° | Mode 1 at ρ₁ = 90° gives \|ρ₂\| = 29.13°. Mode 2 at ρ₂ = 90° gives \|ρ₁\| = 10.31°. Fold-angle multipliers are −0.2598 and −0.0902 [computed from the V formula]. Error < 1e-9 (R), < 0.5° (C, stiff panels) | R, C |
| E6 | Miura-ori in-plane Poisson ratio | Sector γ, facet–plane angle θ | ν_SL = −cos²θ·tan²γ [V, Schenk & Guest]. For (γ, θ) = (60°, 60°) that is −0.75; (45°, 45°) gives −0.50; (60°, 30°) gives −2.25. Out-of-plane bending is saddle-shaped, equal in magnitude and opposite in sign [V] | R exact, C within 2% |
| E7 | Flat-foldable fold angles | Square twist, waterbomb base, Miura | Kawasaki and Maekawa hold exactly in Python (rationals). Folded state has all \|ρ\| = 180° and the layer order matches flat-folder | R, Python |
| E8 | Rotating-square kirigami | Ideal-hinge square lattice | ν = −1 throughout deployment, and the area grows with cos-dependence of the opening angle [L, Grima & Evans] | R, C |
| E9 | Pop-up V-fold | Card plus V-piece with flat-foldable vertex | 1 DOF. Lies flat at 0° and at 180° card opening. Piece fold angle follows the degree-4 closed form | R |
| E10 | Parallel (box) fold | Parallelogram linkage | Opposite links equal implies flat at both extremes. Unequal lengths give a lock or tear, detected as rank change or constraint violation | R |
| E11 | DOF counts | Miura n×m, Kresling, square twist, eggbox | Miura = 1 DOF (rigid). Kresling = 0 rigid DOF (needs panel strain; bistable in C). Report the rank of C | R |
| E12 | Energy and time-step invariance | Any of the above, Δt halved or substeps doubled | Static equilibrium shifts < 0.5%. This is XPBD's key promise | C |
| E13 | Multilayer contact | Fold copy paper 6× in half, which gives 64 layers | No interpenetration. Stack thickness ≈ 64t = 6.4 mm, minus compression [E]. Order matches `faceOrders` | C |
| E14 | Crease springback and relaxation | Fold to 180°, release | The rest angle relaxes logarithmically. Fitted A and τ reproduce the lab time-lapse within 5° over 1–1000 s | C |
| E15 | Page turn | A5 page, 80 gsm, grab corner | No stretch above 0.1%. Developability defect (angle deficit at interior vertices) < 1°. Lands flat on the opposite stack. Real time on a mid-range phone: 60 Hz with 4 pages active | C |
| E16 | Cross-implementation | 50 commons FOLD files | Python vs TS vertex RMS < 1e-4 × sheet size after settling | both |
| E17 | Bar-and-hinge cross-check | Miura sheet in-plane stiffness, small strain | Agrees with an independent N5B8 implementation (our Python oracle) within 5% | C |

---

## (f) Mechanism and tradition catalog seeds

**Paper-engineering mechanisms.** Each entry gives the engine primitive and the seed source.

| Mechanism | Primitive | Source |
|---|---|---|
| V-fold (angle fold) | Degree-4 vertex on gutter, Tier R | Lee, Tor & Soo 1996; Li et al. 2011 v-style; Carter & Diaz, *The Elements of Pop-Up* (1999) [L] |
| Parallel or box fold (90° pop-up, origamic architecture) | Planar parallelogram 4-bar; cut and fold from one sheet | Li et al. 2010; Mitani & Suzuki 2004; Chatani's origamic architecture [L] |
| Floating layer | Parallel or V-piece mounted on another piece (nested linkage) | Birmingham, *Pop-Up Design and Paper Mechanics* (2010) [L] |
| Angle folds (non-90°, e.g. 45° and 135° opening) | Degree-4 vertices with non-symmetric sectors | Same as above |
| Pull-tab slider | Prismatic slot plus lever linkage | [Smithsonian, "Paper Engineering: Fold, Pull, Pop & Turn"](https://library.si.edu/digital-library/exhibition/paper-engineering) |
| Wheel or volvelle | Revolute pivot (grommet); windows as cuts | Smithsonian exhibit (16th-c. volvelles onward) |
| Pivot | Revolute joint between flaps | Smithsonian |
| Lift-the-flap | Single hinge crease | Smithsonian |
| Tunnel book (peepshow) | Two leporello side walls plus cut panels in depth order | [Smithsonian blog on folding mechanisms](https://blog.library.si.edu/2010/08/the-fascinating-art-of-paper-engineering-folding-mechanisms) |
| Carousel or star book | Codex opened 360°, covers tied; each spread is a pop-up chamber | [L] |
| Accordion or leporello | Strip with alternating M/V creases | Smithsonian; Mesoamerican screenfolds below |
| Flexagon (tri- and hexa-hexaflexagon) | Triangle-strip state machine; Tuckerman traverse | Gardner 1956 [L] |
| Jacob's ladder | Panels plus crossed tapes; a flip-cascade mechanism | Toy tradition [L] |

**Papercut and paper traditions.** Each entry is a seed for commons collections with provenance.

- **Papel picado** (Mexico).
  - Considered to originate in San Salvador Huixcolotla, Puebla.
  - Made from tissue (papel de china) cut with *fierritos* (chisels) and a mallet through stacks of about 40–50 sheets.
  - Declared state cultural heritage of Puebla in 1998.
  - Used on Día de Muertos ofrendas, at fiestas and at weddings.
  - Sources: [Wikipedia](https://en.wikipedia.org/wiki/Papel_picado) and [México Desconocido](https://www.mexicodesconocido.com.mx/papel-picado-huixcolotla.html). FONART dates the transformation of tissue into decorative pieces to the mid-19th century and the first workshop to the 1930s (via search summary) [V, secondary].
  - Engine needs: tissue stock, a stack-cut tool (boolean through N layers), a banner string (a line constraint with sag), and wind.
- **Amate** (Otomí, San Pablito, Pahuatlán, Puebla).
  - Bark of jonote/ficus is boiled with ash and lime, laid in a grid and beaten with stones.
  - Otomí ritual cut-paper figures are made from it.
  - Source: [Wake Forest LAM Museum](https://lammuseum.wfu.edu/2022/10/otomi-bark-paper/).
  - Amate is also the substrate of the Dresden Codex screenfold (amate, about 20 cm × 3.7 m, 39 leaves: [Wikipedia](https://en.wikipedia.org/wiki/Dresden_Codex)). Mesoamerican screenfolds are strips of skin or paper coated with gesso and folded accordion-style ([Smarthistory/LibreTexts, Codex Borgia](https://human.libretexts.org/Bookshelves/Art/SmartHistory_of_Art_2e/SmartHistory_of_Art_XIa_-_The_Americas_before_1500/03%3A_Mesoamerica/3.14%3A_Aztec_(Mexica)_art/3.14.12%3A_Codex_Borgia)).
- **Jianzhi** (China): Chinese paper-cut, UNESCO Representative List 2009 ([ich.unesco.org RL 00219](https://ich.unesco.org/ar/RL/-00219)). Engine needs: fold-symmetric cuts on red xuan or tissue.
- **Washi** (Japan): UNESCO 2014; practised in Misumi (Hamada), Mino and Ogawa/Higashi-chichibu; made from kozo fibre ([ich.unesco.org RL 01001](https://ich.unesco.org/en/RL/01001)). Gives the stock for kirie and origami.
- **Kirie** (Japanese cut-paper pictures), **wycinanki** (Polish folk papercut, with regional Łowicz and Kurpie styles), **scherenschnitte** (Swiss and German silhouette cutting) and **sanjhi** (Krishna-temple stencil papercut of Mathura and Vrindavan). These are [L, secondary sources only]. **Find primary or heritage-registry sources** before publishing tradition pages. The general overview is at [Wikipedia: Papercutting](https://en.wikipedia.org/wiki/Papercutting).
- **Origami bases and tessellation seeds**, generated so we author them: Miura, Yoshimura, Kresling, waterbomb, Resch, square and hex twists, and Huffman-style curved creases. All are CERN-OHL-W-2.0 originals.

---

## (g) Risks and unknowns

1. **Material data is mostly estimated.** No primary mechanical data was found for amate, papel de china, washi or tant, and the E values in §b are [E]. *Mitigation:* run the lab protocol in §b (cantilever, single crease, relaxation time-lapse) on about 10 stocks before calling the presets "real paper". This is cheap, and its results are original commons data.
2. **The crease constants for paper are unknown.** L* ≈ 200h is measured for Mylar only. Paper creases involve fibre and bond damage and delamination, so L* and the rest angle depend on how the crease was made (bone folder, score, wet fold). Filipov's recommended L* range was not confirmed because the PDF fetch was blocked.
3. **The bending discretisation constant c** and its mesh dependence need calibration (E1). Isotropic discrete shells under-represent the ν-coupling, and the anisotropic D(φ) per edge is an approximation that must be validated against E1 in both MD and CD.
4. **Multilayer contact** at flat-folded states is the main robustness risk (E13). Seeding sidedness from `faceOrders` assumes a valid flat-folded state exists, which is NP-hard to find in general (Bern & Hayes). For large patterns, flat-folder may be slow, so cache layer orders in the FOLD object.
5. **Explicit-GPU expectations.** Users know Origami Simulator's look. XPBD with physical compliances will look stiffer and "papery", and that difference needs explaining. Keep an "Origami Simulator-like" preset with non-dimensional stiffness for design exploration.
6. **WebGL2 vs WebGPU.** Coloured Gauss–Seidel needs compute shaders. The Jacobi fallback converges more slowly, so more substeps are needed on WebGL2 devices. Headless CI browsers may lack WebGL, so CI must run the solvers headless, in Node with a WebGPU polyfill or in the Python reference.
7. **Licensing traps.**
   - The example crease patterns inside MIT repos are not MIT-licensed designs.
   - GPL oracles must stay out of the shipped bundle.
   - Unlicensed MATLAB code is off-limits.
   - Cultural-heritage motifs need community attribution, and possibly consultation, for example with Huixcolotla and San Pablito artisans. This is ethics rather than law.
8. **Tearing realism.** Fibre-scale tearing is research-grade. Ship cuts first and tears as visual-only, and add a stress-driven tear later.
9. **Humidity and wet folding.** Effects such as elephant hide wet-folding and cockling are second-order. Expose an RH parameter but do not promise accuracy.
10. **Curved-crease and Kresling** need Tier C with fine meshes. They are not rigidly foldable, so Tier R reports 0 DOF. The UX must explain why.
11. **Unverified citations.** Some citations in this memo are [L] (from recollection; not fetched during this research pass). Before the memo is published as a commons page, a citation pass should verify every [L] entry against DOIs.

---

### Sources I fetched or checked in this session (primary)

- Ghassaei, Demaine & Gershenfeld, OSME 2018 PDF: https://erikdemaine.org/papers/OrigamiSimulator_Origami7/paper.pdf (equations, damping, time step, parameters).
- Lechenault, Thiria & Adda-Bedia, PRL 2014: https://arxiv.org/abs/1404.1243 (κ, φ₀, L* ≈ 200h, Eq. 5).
- Baum, Habeger & Fleischman 1981: https://bioresources.cnr.ncsu.edu/resources/measurement-of-the-orthotropic-elastic-constants-of-paper/ (G₁₂ = 0.387√(E_xE_y), mean ν = 0.293, MD around 2× CD).
- Foschi, Hull & Ku 2022: https://arxiv.org/abs/2206.12691 (closure condition, degree-4 flat-foldable equations, Huffman relation).
- Schenk & Guest PNAS 2013: https://pmc.ncbi.nlm.nih.gov/articles/PMC3587190 (ν_SL).
- FOLD spec: https://github.com/edemaine/fold/blob/main/doc/spec.md.
- Licenses via the GitHub API: the repos listed in §d.
- Thiria & Adda-Bedia 2011: https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.107.025506.
- UNESCO: https://ich.unesco.org/en/RL/01001 and https://ich.unesco.org/ar/RL/-00219.
