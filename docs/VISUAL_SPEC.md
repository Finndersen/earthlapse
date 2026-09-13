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

> **v1 note (ADR-010).** Era-anchor conditioning is **not used in v1**. Two gates on the
> finals model showed a content-rich anchor leaking its content and a content-free style
> reference adding nothing the text did not already do. Final scenes render from text alone;
> composition discipline (§3) and the invariant spec (§2) carry continuity. The ban on
> chaining below still holds.

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

**Decision: Google AI Studio (Gemini) as the primary provider, two-tier.**

**For the MVP: `gemini-3-pro-image-preview` (Nano Banana Pro) for everything.** ~$0.13 per
image, token-priced at $120/M output. Expected MVP total **~$18**.

**Not** a two-tier split, despite the cost saving being available. The free tier
(`gemini-2.5-flash-image`, ~500/day) saves roughly $5 on a $100 project and buys two real
problems: prompt adherence differs between models, so prompts tuned on the cheap model may
behave differently on the one that ships; and it doubles the config surface — two model
entries, two price rows, two rate-limit regimes — in a pipeline being written by parallel
agents. Not worth $5.

**The anchor gate especially must run on Pro.** Its purpose is to validate anchor
conditioning *for the pipeline that generates the finals*. Run on a different model it
proves nothing: a failure might be that model's limitation, and a pass does not transfer.

**Where the free tier does pay off: Phase 3**, the art-direction taste loop, when prompts are
iterated by the hundred and the judgement is about composition rather than final quality.
Switch to it then, deliberately.

**Why Gemini rather than the cheaper FLUX ladder.** Cost is not a constraint at this scale —
the whole MVP is single-digit dollars on any provider. The deciding requirement is
**multi-reference conditioning for era anchors** (§4): holding a style across 14 scenes from
an approved reference image. That is the hardest thing in the visual pipeline and the most
likely to fail, and Nano Banana Pro is the strongest available at it. Starting here tests the
risky thing first rather than building the whole harness and discovering the anchors don't
hold.

**Fallback if that reasoning doesn't survive contact:** the FLUX ladder on fal.ai — FLUX.1
Schnell $0.0005 for drafts, FLUX.2 Pro $0.015 for finals, FLUX.2 Max $0.073 to escalate a
scene that won't come right. Roughly 5× cheaper overall and one key reaches the whole range.
Reference prices for the rest: FLUX.2 Dev $0.0084, FLUX.1 Pro $0.050, Imagen 4 Fast $0.020.

**Three operational cautions:**

1. `preview` in `gemini-3-pro-image-preview` is not decorative — the model can change
   behaviour or be withdrawn. Pin the id in config and expect to bump it.
2. The free tier has RPM limits and a daily token cap. A parallel fan-out generating
   concurrently **will** hit them. Keep generation concurrency low and treat 429 as backoff,
   never as failure.
3. Quota and pricing figures here come from third-party sources, not Google's own docs.
   Confirm against the live quota page before relying on them.

⚠️ **No provider name may appear outside `pipeline/generators/`.** Swapping vendors must be a
config change — this decision is explicitly expected to be revisited. `estimate_usd()` reads
a per-model price table so `earthtime plan` can cost a build before spending anything.

## 9. Honesty

The output is an artistic reconstruction and says so, visibly, in the UI. Photorealism
implies a claim to accuracy that generated deep-time imagery cannot support — paleoart in
particular will be wrong in ways specialists notice.

We are not claiming accuracy. We are claiming plausibility, and we say which is which.

---

## 10. Ancestor portraits (ADR-015)

The ancestor layer (DESIGN §10) shows a portrait of the lineage node alive at `t`. Its register
is a **photoreal specimen plate**: a natural-history monograph photograph of the whole organism
against a black backdrop. It is a second camera, independent of the scene camera. §2's scene
style split is unchanged; the same rule applies here: the plate camera is invariant, the
organism varies.

### Plate grammar

| Plate | For | Framing |
|---|---|---|
| `SPECIMEN` | multicellular organisms | whole organism, strict side profile facing right (head at right, tail at left); an attached or radial organism stands upright, base down; studio key light upper left, faint rim light; 120mm macro, everything in focus |
| `MICROSCOPE` | cells and small colonies | darkfield light micrograph, oil-immersion objective, one focal plane; the round field of view is the vignette; any flagellum trails left, so the cell faces right |

### Invariant portrait style — identical in every portrait

Stated once in `pipeline/prompts.py` (`PORTRAIT_STYLE`), before the plate type and subject:

- A real photograph: not concept art, painting, CGI, illustration, sculpture or museum model.
- One of a matched series photographed identically.
- Square 1:1 frame, subject exactly centred, its longest dimension about **70% of the frame
  width**, whatever the organism's real size. `pipeline/morph.py` normalises to the same fill.
- A seamless near-black backdrop falling off to black in a soft **circular vignette**. The
  viewer masks the plate to a feathered circle, so nothing important sits in the corners.
- A thin pale scale bar below the subject, left of centre, **with no numbers or letters**. It
  is a register cue, not a measurement; a real size, where a source gives one, goes into the
  subject text instead.
- No text, labels, watermark, border, grade, HDR, bloom or flare.

### Subjects — one record per lineage node in `data/portraits.yaml`

- `organism`, `anatomy`, `surface`, `size`, `absent`. They are rendered by one template, so
  plates differ only in values.
- Every anatomical clause rests on the record's `sources`. Primary literature is used where
  reachable, otherwise an authoritative page.
- Whatever the sources do not settle goes into `gaps` and is **never** filled with an unchecked
  claim.
- `evidence` is `fossil`, `extant-proxy` or `reconstruction`. A reconstruction or proxy must say
  so in its `organism` text (enforced on load), so a hypothetical ancestor such as LUCA or LECA
  is never prompted as a specimen.
- Colour is almost never known from fossils. `surface` says "no source gives its colour" and
  asks for muted natural tones.
- `absent` names the anachronisms and wrong body plans the model is likely to reach for (digits
  on Tiktaalik, a coiled shell on Kimberella).
- Every plate also excludes `PORTRAIT_ALWAYS_ABSENT`: labels, a handler's hand or pins, a label
  card, any other organism, a habitat.
- Hominin plates add "rendered as a scientific reconstruction and not sexualised" and exclude
  clothing, tools and modern grooming.
- A node may have no plate. The viewer then holds the nearest older plate.
  `deuterostomia` is omitted: its representative, Saccorhytus, is no longer
  considered a deuterostome.

### Size and cost

**1:1 at 1K.** On the model in use, 1K and 2K bill the same 1120 output tokens, so the smaller
size saves payload, not money; 4K bills 2000 tokens (ADR-015 has the figures). A portrait costs
the same as a scene.

### Morphing between plates

- Consecutive pinned plates are joined by a dense optical-flow field computed offline
  (`earthtime morph`, free).
- Both plates are normalised first: the subject box is taken from the dark backdrop, then centred
  and scaled to the 70% fill.
- The viewer warps each plate toward the other while it crossfades.
- Consistent framing is what makes this work: a plate that ignores the fill or the profile
  direction morphs badly.
- Morphs between very different body plans (a micrograph into a sponge, a fish into a tetrapod)
  read as a warped dissolve, not an anatomical correspondence. That is expected.

### Review

- Review a portrait between its **older and younger neighbours** (`earthtime review portraits
  sheet`), never alone. The morph runs between exactly those plates.
- Judge in order:
  1. Framing: centre, fill, facing right.
  2. Anatomy against the record's `sources`.
  3. Absences: nothing from `absent` appears.
  4. Register: a photograph, not art.
  5. Beauty.
- Pin with `earthtime review portraits pick`.

### Style gate

- Generate and approve four plates before the rest, one per register risk:
  - `leca` (micrograph)
  - `bilateria` (an Ediacaran animal)
  - `tetrapodomorpha` (a fossil vertebrate)
  - `homo-erectus` (a hominin)
- If the gate fails, change `PORTRAIT_STYLE` or `PLATE_TYPE`, not the subjects, and rerun it.
