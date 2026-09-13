# Visual Specification

The art-direction contract. Its job is to make ~200 independently generated photoreal
images read as one continuous world.

This is the document most likely to change through iteration, and the one an agent should
change least. Prompt and style tuning is a **taste loop** — the harness is built by agents,
the dials are turned by a human.

---

## 1. The core problem

Photoreal per-image is easy. Photoreal **and consistent across 200 images** is the whole
difficulty. Three mechanisms solve it, in descending order of importance:

1. **Composition discipline** — makes dissolves read as morphs rather than cuts
2. **Invariant style spec** — makes every frame look shot on the same camera
3. **Era-anchor conditioning** — keeps neighbours coherent without chaining

---

## 2. Style spec: invariant and variant halves (NORMATIVE)

The style splits in two. Conflating them was an early design error.

### Invariant — never changes, stated identically in every prompt

- Focal length and perspective (a single lens across the whole project)
- Film stock / sensor character, grain structure
- Degree of realism (photoreal documentary, not cinematic-graded, not painterly)
- Aspect ratio and resolution
- Colour grade — see §5, applied in post rather than prompted

### Variant — **should** change, and is driven by `WorldState`

| Condition | Driven by |
|---|---|
| Sky colour and clarity | `atmosphere.O2`, `atmosphere.CH4`, particulates |
| Haze and atmospheric depth | `atmosphere.CO2`, temperature |
| Light quality and warmth | `climate.temp`, `sky.solar_luminosity` |
| Weather | `climate` regime + Köppen class at the vantage |
| Time of day | held constant within a chapter, may shift between |
| Season | `plates` latitude of the vantage + obliquity |

A hothouse Cretaceous should look hazy, warm and heavy. A Snowball Earth should look hard,
blue and clear. An Archean sky under low O₂ should not be the blue we know. **This variation
is what makes it feel alive**, and it is motivated by data rather than by taste.

The rule: if it describes *the camera*, it is invariant. If it describes *the world*, it
varies and comes from `WorldState`.

---

## 3. Composition discipline

The single strongest continuity lever, and it costs nothing.

**Within a chapter**, consecutive images must share:
- horizon line height (±5% of frame height)
- rough mass layout — where the large forms sit
- camera height and angle
- focal subject placement

When those hold, a cross-dissolve reads as the world *morphing*. When they don't, it reads
as a cut. This is enforced in the prompt template as explicit composition constraints, and
verified by eye at review time.

**At a chapter boundary** composition changes deliberately. See
[`DESIGN.md §6`](./DESIGN.md#6-vantage-points) — how many such boundaries is an open
question.

### Camera grammar

A small closed set of shot types, reused throughout. Repetition of framing does most of the
perceived-consistency work.

| Shot | Description |
|---|---|
| `WIDE_RIDGE` | elevated three-quarter vista, horizon at upper third |
| `WATER_EDGE` | low, near the waterline, water occupying lower third |
| `CANOPY` | mid-height, looking through vegetation, layered depth |
| `GROUND` | low and close, detail-forward, shallow depth |

⚠️ **Open risk:** `WIDE_RIDGE` may not survive depth displacement — distant vistas have
little depth variation and produce weak parallax, while foreground edges produce the worst
occlusion artefacts. Test this in Phase 1 before committing. See
[`DESIGN.md §14`](./DESIGN.md#14-open-questions) question 2.

---

## 4. Era anchors, not chaining (ADR-004)

**Never condition a scene on its predecessor.** Two failure modes: aesthetic drift
accumulates, and it makes the asset graph a chain so scene 57 cannot be regenerated without
touching 58–200.

Instead:

```
        ┌─ era anchor (hand-approved) ─┐
        │                              │
   scene  scene  scene  scene  scene  scene
```

~12 anchors, one per era, each generated and approved by hand first. Every scene within an
era conditions on its era anchor plus the invariant style spec. A tree, not a chain —
localised regeneration works.

---

## 5. Post: one LUT

A single colour grade applied uniformly to every output does more unifying work than any
amount of prompt iteration, and it is free and instantly reversible.

Apply at publish time, not at generation time, so the grade can be changed without
regenerating anything. Store the ungraded original.

---

## 6. Prompt architecture

Prompts are **rendered from templates**, never free-written by an LLM at generation time
(see [`DESIGN.md §4`](./DESIGN.md#4-worldstate--the-central-abstraction-normative)).

```
prompt = INVARIANT_STYLE
       + SHOT_TYPE[scene.shot]
       + COMPOSITION_CONSTRAINTS[scene.chapter]
       + render_conditions(WorldState.at(scene.t))     # the variant half
       + scene.subject                                  # the curated content
```

Because `render_conditions` is a pure function of `WorldState`, consecutive prompts differ
**only where the world differs**. That is the continuity property, and it is why the
`WorldState` abstraction earns its cost.

An LLM may help author `scene.subject` and the templates themselves. It does not assemble
prompts at generation time.

---

## 7. Review loop

Generation is nondeterministic, so every scene goes through candidates → human pick → pin
(see [`DESIGN.md §9`](./DESIGN.md#9-generation-pipeline-normative)).

Review criteria, in order:
1. **Does it dissolve cleanly from its predecessor?** Review adjacent pairs, never single
   images in isolation. This is the criterion that matters most and the one most easily
   forgotten.
2. Is the composition within chapter constraints?
3. Are the conditions consistent with `WorldState`?
4. Is it plausible? (Not accurate — plausible.)
5. Is it beautiful?

The review UI **must** show the predecessor and successor alongside the candidate. A
candidate picker showing one image at a time will produce a beautiful, incoherent sequence.

---

## 8. Model selection

⚠️ **TBD — decide in Phase 1 with a bake-off.** Requirements, in priority order:

1. Multi-reference conditioning (for era anchors)
2. Photorealism at landscape scale
3. Prompt adherence for composition constraints
4. Cost per image at draft quality vs final quality

Candidates as of writing: Nano Banana Pro, FLUX.2, GPT Image 2. The `Generator` protocol
(see DESIGN §9) keeps this swappable — **do not** hard-code a provider anywhere outside
`pipeline/generators/`.

Strategy: cheap model for drafts and composition iteration, premium model for finals only.
This is most of the budget headroom.

---

## 9. Honesty

The output is an artistic reconstruction and says so, visibly, in the UI. Photorealism
implies a claim to accuracy that generated deep-time imagery cannot support — paleoart in
particular will be wrong in ways specialists notice.

We are not claiming accuracy. We are claiming plausibility, and we say which is which.
