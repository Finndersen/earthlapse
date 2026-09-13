# Architecture Decision Records

Anything marked **NORMATIVE** in the design docs is governed by an ADR here. To change one,
add a new ADR that supersedes the old — do not edit history.

Format: context → decision → consequences. Keep them short.

---

## ADR-001 — No generated video for connective transitions

**Status:** accepted

**Context.** The original concept called for AI-generated transition video between every pair
of scene images, forming a continuous film. ~200 transitions at 5s costs $100–500 per pass
at current API rates, against a $100 total budget. Generated video also cannot be scrubbed,
and the product requires scrubbing.

**Decision.** Ship stills plus depth maps and render motion live in the browser: per-image
2.5D parallax displacement, depth-aware cross-dissolve between images. Reserve 3–5 genuinely
generated video clips for moments where motion carries meaning (Chicxulub, Snowball Earth
thaw); these are inline clips, not connective tissue.

**Consequences.**
- Scrubbing is exact and speed control is a single multiplier.
- Payload ~150 MB instead of gigabytes; free hosting tiers suffice.
- Iteration is instant — no render step between changing a scene and seeing it.
- Continuity must come from composition and style discipline, not camera continuity.
- **Risk:** depth displacement may look poor at wide-vista framing. Test in Phase 1.

---

## ADR-002 — `WorldState` is the sole projection source

**Status:** accepted

**Context.** Prompts, globe textures, layer values, captions and audio all need to know the
state of the planet at time `t`. Letting each read curated data directly guarantees drift
and duplicated interpolation logic.

**Decision.** A single `WorldState.at(t)` pure function. Nothing else reads `data/curated/`.

**Consequences.**
- Consecutive prompts differ only where the world differs — continuity for free.
- `diff(state_a, state_b)` gives explicit transition semantics.
- On-demand generation at arbitrary (lat, lon, t) falls out nearly free.
- Every new data source must be plumbed into a `WorldState` field, which is extra ceremony
  for one-off layers. Accepted.

---

## ADR-003 — Exactly four curated data shapes

**Status:** accepted

**Context.** Contributors need a stable target to normalise into, and the frontend needs a
bounded set of things to render.

**Decision.** `TimeSeries`, `EventSet`, `RasterSequence`, `Tree`. A fifth requires an ADR.

**Consequences.** A contributor writes one adapter and the frontend needs no changes. This is
the plugin seam. Some sources will fit awkwardly; awkward is preferable to unbounded.

---

## ADR-004 — Era-anchor conditioning, never sequential chaining

**Status:** accepted; the era-anchor conditioning half is superseded for v1 by ADR-010. The
ban on sequential chaining stands.

**Context.** Chaining each generated image off its predecessor accumulates aesthetic drift
and makes the asset graph a chain — scene 57 cannot be regenerated without touching 58–200.

**Decision.** ~12 hand-approved era anchors. Every scene conditions on its era anchor plus
the invariant style spec. A tree, not a chain.

**Consequences.** Localised regeneration works. Anchors become a hand-curated bottleneck,
which is correct — they are the highest-leverage images in the project.

---

## ADR-005 — Approved generations are pinned by hash

**Status:** accepted

**Context.** Generation is nondeterministic. A content-addressed rebuild would otherwise
silently replace an approved image with a different one.

**Decision.** Candidates → human pick → chosen asset hash written into the scene record.
Rebuilds honour the pin unless explicitly cleared.

**Consequences.** The project remains usable past week two. Adds a review step to the loop,
which is the point.

---

## ADR-006 — Custom asset-graph resolver over Dagster/Prefect

**Status:** accepted

**Context.** The generation pipeline is a DAG with caching and staleness — superficially a
job for an orchestration framework.

**Decision.** A ~400-line custom resolver plus a `Generator` protocol per provider.

**Consequences.** The DAG is small; the custom semantics (candidates, review gates, pinning,
spend ceiling) are the entire value and would have to be built on top of any framework
anyway. Less machinery to learn, fewer dependencies. If the DAG grows beyond a few hundred
nodes, revisit.

---

## ADR-007 — No location pin on the globe

**Status:** accepted

**Context.** An earlier design anchored the scene vantage to real geographic locations, with
a pin on the globe showing where you were, reconstructed via gplately.

**Decision.** The vantage is conceptual (a swamp, a shore, a city), not a real place. There
is therefore no pin. The globe shows planetary state only.

**Consequences.** Scene generation is unconstrained by real geography, which is the right
trade given artistic licence. The globe and scene views become fully independent, sharing
only `t`. A pin over a conceptual vantage would have been fiction presented as fact.

---

## ADR-008 — Style spec splits into invariant and variant halves

**Status:** accepted

**Context.** An early framing treated "consistent style" as a single fixed spec applied to
every image. But weather, light and sky *should* change over 4.6 Gyr, and freezing them
would look dead and be scientifically wrong.

**Decision.** Invariant half (lens, film stock, grain, realism, grade) never changes.
Variant half (weather, light, haze, sky colour, season) is driven by `WorldState`.

**Rule of thumb:** if it describes the camera, it is invariant. If it describes the world, it
varies.

**Consequences.** Frames feel alive and the variation is data-motivated rather than
arbitrary. Adds coupling between `WorldState` and the prompt renderer, which ADR-002 already
establishes.

---

## ADR-009 — 2.5D parallax deferred out of v1

**Status:** accepted

**Context.** ADR-001 replaced generated video with stills plus depth-map displacement giving
2.5D parallax. That coupled two things unnecessarily: the *dissolve* (which carries the
experience) and the *parallax* (which makes each still feel alive). The parallax also carried
the project's main open technical risk — whether displacement survives wide-vista framing —
and pulled a depth-estimation dependency into the critical path.

**Decision.** v1 renders a plain cross-dissolve between flat stills. No depth maps, no
displacement, no Depth Anything dependency. The 2.5D effect is a later phase.

**Consequences.**
- The largest open technical risk leaves the critical path entirely.
- One fewer dependency and one fewer offline pipeline stage in the MVP.
- Upgrade is a genuine drop-in: depth maps are generated offline and the renderer swaps a
  flat plane for a displaced one. No other component changes, no assets are regenerated.
- v1 scenes will feel more like a slideshow. Accepted — composition discipline and the
  dissolve are what carry continuity anyway (DESIGN §5), and the parallax was always
  garnish rather than structure.
- The `WIDE_RIDGE` framing risk (VISUAL_SPEC §3) is deferred with it.

---

## ADR-010 — Final scenes are generated from text only (Approach B)

**Status:** accepted. Supersedes ADR-004's era-anchor conditioning for v1.

**Context.** ADR-004 assumed an approved reference image would hold a photographic look across
scenes. Two gates tested it on `gemini-3-pro-image-preview`, the model the finals use.

- **Gate v1** ($0.56, 4 images). One content-rich Middle Jurassic anchor, then three Mesozoic
  scenes (Late Triassic, Late Jurassic, Late Cretaceous) conditioned on it, text before image.
  The anchor's content leaked: the first scene came back as a near re-edit of the anchor, and
  across 150 million years the world showed no visible change. Conditioning on content
  transfers content, not style.
- **Gate v2** ($0.98, 7 images). An A/B across three consecutive chapters (Devonian estuary,
  Carboniferous swamp, Permian interior), all held to one `WATER_EDGE` composition. Variant A
  conditioned each scene on a content-free style reference (grey rock, flat sky, placed before
  the text); variant B sent the identical prompt with no image. A added no meaningful
  difference: the text did nearly all the work in both. Three very different worlds read as
  one camera in one place, and the held framing dissolved between them as a morph. B's
  Carboniferous frame did drift toward a concept-art register.

**Decision.**
- A final scene is rendered from text alone: invariant style spec + shot + composition
  constraints + `WorldState`-rendered conditions + curated subject. No reference or anchor
  image is sent.
- The invariant style spec opens with an explicit register, "a real photograph: not concept
  art, not digital painting, not CGI, not illustration", against the drift B-02 showed. It
  stays camera-only (ADR-008).
- One image model, `gemini-3-pro-image-preview`, through the existing generator. The pipeline
  selects it through `pipeline/generators/registry.py`; nothing outside `pipeline/generators/`
  names a provider or model.
- Reference-image conditioning stays supported in the generator (`ImageRequest.reference`) but
  is unused. The gate entry points are removed now that this ADR records their results.

**Consequences.**
- No anchor bottleneck: every scene is independent, regenerable alone, and costs one text
  prompt. The graph is a PROMPT node and an IMAGE node per scene, never a chain.
- Continuity rests entirely on composition discipline and the invariant spec, so composition
  defines chapters. A chapter is a run of scenes sharing one composition (DESIGN §6), and the
  viewer (web/src/scene) dissolves across a wide window within a chapter and a narrow,
  cut-like one across a boundary. v1 therefore has **14 scenes in 2 chapters**, not one
  chapter per scene, which would turn every transition into a cut: `molten-earth` (the magma
  ocean, a `WIDE_RIDGE` vista, because it has no water to stand beside) and `waters-edge` (the
  other 13, 4.3 Ga to the present, all on the `WATER_EDGE` composition gate v2 validated).
- Register drift is guarded only by wording; review catches the rest (VISUAL_SPEC §7).
- `Chapter.anchorImage` in the manifest schema is now always absent.

---

## Pending

Decisions deferred to Phase 1, to be recorded here once answered:

- ~~**Image model selection**~~ **RESOLVED by ADR-010:** `gemini-3-pro-image-preview` for
  every final scene, text only, selected in `pipeline/generators/registry.py`.
- **Chapter count** — 8 vs 14 (DESIGN §14 q1). v1 ships 14 scenes in 2 composition-defined
  chapters (ADR-010); revisit once the finals can be scrubbed.
- **Does depth displacement survive wide-vista framing** — deferred with ADR-009, revisit
  when the 2.5D phase begins
- **Default timeline scale** — symlog vs density (DESIGN §14 q3)
- **Globe texture resolution** (DESIGN §14 q5)
- **Ancestor portrait register** — photoreal vs illustrated (DESIGN §14 q4)
- ~~**`gplately` viability**~~ **RESOLVED.** A clean `pip install gplately` completes in
  ~33 seconds, wheels only, no conda and no system GDAL/PROJ/GEOS. pygplates 1.0.0 ships
  first-party `macosx_11_0_arm64` wheels for cp38–cp313; every binary dependency (cartopy,
  shapely, rasterio, netcdf4) also ships cp312 macOS arm64 wheels. The precomputed-rotation
  fallback is not needed. Two caveats: verified on Linux x86_64, so arm64 rests on wheel
  availability rather than a test — confirm once on the target Mac; and gplately/pygplates
  are GPL-2.0, fine for the offline pipeline but **must not be vendored into the shipped
  frontend**.
