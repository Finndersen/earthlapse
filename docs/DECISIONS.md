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
  defines chapters. A chapter is a run of scenes sharing one composition (DESIGN §6). v1 has
  **14 scenes in 2 chapters**: `molten-earth` (the magma ocean, a `WIDE_RIDGE` vista, because
  it has no water to stand beside) and `waters-edge` (the other 13, 4.3 Ga to the present, all
  on the `WATER_EDGE` composition gate v2 validated). Chapters no longer change how the viewer
  dissolves; see ADR-011.
- Register drift is guarded only by wording; review catches the rest (VISUAL_SPEC §7).
- `Chapter.anchorImage` in the manifest schema is now always absent.

---

## ADR-011 — Scenes hold clear and transition briefly; the minimap is a symlog overview

**Status:** accepted (human-directed during the one-shot build). The transition bullet is
superseded by ADR-012; the hold-clear and minimap decisions stand.

**Context.** The first viewer dissolved across the middle 40% of each gap between scenes (10%
across a chapter boundary). A 50/50 blend of two different generated worlds reads as a muddy
double exposure — doubled horizons, ghost animals — so most of the time the viewer would see
an unclear image instead of the scene. Separately, DESIGN §3's linear-scale minimap renders any
zoom window inside the last ~10 Myr at sub-pixel width, so it cannot show where the user is
zoomed in exactly the ranges people explore. A true frame-by-frame generative morph would
break scrubbing and cost against ADR-001's reasoning.

**Decision.**
- Each scene is shown clear for most of its gap. The transition is centred on the log-time
  midpoint between neighbours, with one tunable width everywhere
  (`DISSOLVE_WIDTH = 0.14` of the log gap in `web/src/scene`), independent of chapters.
- The transition is a WebGL noise-masked dissolve with a slight luminance bias and a gentle
  blur-through, pixel-exact at both ends; a two-image crossfade is the no-WebGL fallback.
- Each still carries a slow camera drift (bounded zoom and pan, never revealing an edge) that
  is a pure function of `t`, off under `prefers-reduced-motion`. This is 2D and does not
  revive the deferred depth parallax (ADR-009).
- The minimap is a **symlog overview** of the whole domain with eon/era bands, the playhead,
  and a visible-window bracket that never renders narrower than 8 px. A hairline linear
  strip beneath it keeps the warp honest. Zoom gains −/+/fit controls, ctrl-wheel and pinch,
  keyboard, eased window changes, and the window follows the playhead during playback until
  the user pans or zooms.

**Consequences.**
- Scrubbing and playback show the generated images as generated for most of the timeline;
  appearance stays a pure function of `t`, so the two remain the same mechanism.
- Denser checkpoints (more scenes sharing a composition) are the upgrade path to
  morph-like transitions; generated video remains out of scope for connective transitions.
- DESIGN §3's linear minimap is superseded; linear honesty survives as the hairline strip and
  the symlog↔linear toggle.

---

## ADR-012 — Smooth crossfade with a minimum duration; an immersive lens layout

**Status:** accepted (human-directed after the first browser review). Supersedes ADR-011's
transition bullet and DESIGN §8's boxed layout.

**Context.** In the browser the ADR-011 transition failed in two ways. Scenes that sit close
together on the symlog axis (roughly 500–200 Ma) sit only a few pixels apart, so a band that
is 14% of their gap passes in milliseconds during playback and reads as a hard cut. The
noise-masked dissolve revealed the incoming image patch by patch, which read as flashy
rather than gradual. Separately, the only timeline markers were events, so scenes with no
nearby high-importance event (the ice-age scene at 20 ka) had no marker at all. The boxed
instrument-panel layout (bordered columns around a rounded viewport) read as a web page, not
as a view into the world.

**Decision.**
- The transition is a uniform crossfade of the whole frame, blended in linear light. The
  noise mask and the blur-through are removed.
- `sceneAt(scenes, t)` stays pure in `t` and still defines the target. What is *displayed*
  is rate-limited toward that target, so a full transition never takes less than a fixed
  wall-clock minimum. Slower changes, such as slow scrubbing through a wide band, follow the
  target exactly. A jump across several scenes crossfades directly from the displayed scene
  to the target, never flashing through the ones in between. The caption fades in step with
  the displayed crossfade.
- Every scene is marked on the timeline and the minimap as a checkpoint, with no level-of-
  detail filtering, and stepping visits checkpoints as well as events.
- Layout: the scene fills the window behind an elliptical lens vignette. The globe, layer
  readouts, time/era title, ancestor, caption and timeline float in the darkened periphery
  with no panels or borders. The periphery dims while playback runs and the viewer is idle.
- **Playback pacing update (superseding this ADR's first playback attempt).** A first pass
  added a minimum on-screen *hold* downstream, in `presentation.ts` — wrong layer: it
  desynchronised the picture from `t`, so time/era/ancestor/CO2 readouts could sit hundreds of
  Myr ahead of a held image. Playback now paces the **playhead** instead
  (`scene/pacing.ts`'s `scenePlaybackSegments`, consumed by `timeline/playback.ts`'s
  `advancePlayhead`): at 1x, each scene dwells `SCENE_DWELL_SECONDS` (3 s, split across its
  two neighbouring gaps) and each dissolve band takes at least `MIN_TRANSITION_SECONDS`
  (1.6 s) before `t` is allowed past it — both divided by `speed` at faster rates. The picture
  stays a pure function of `t` throughout normal playback, because nothing downstream of `t`
  is being held back.
- `presentation.ts`'s rate limiter is unchanged and is now purely the backstop for scrubbing
  and for playback fast enough to still outrun the paced floor (at 8x a paced dissolve band
  takes only 0.2 s of playhead time, under the limiter's own 1.6 s floor, so the picture can
  lag `t` by up to ~1.6 s at high speed — acceptable, and no worse than before).

**Consequences.**
- A still frame is a pure function of `t` once the transition has settled, but not in the
  first ~1.6 s after a jump. Screenshot and test tooling must wait for the transition to
  settle.
- Layers are unaffected: `Layer.sample()` remains pure in `t`. The rate limit is confined to
  the scene view.
- DESIGN §8's diagram describes the pre-ADR-012 layout; the slots (globe, sparklines,
  ancestor, caption, timeline, chart dock) survive, and only their chrome and placement
  change.
- A full 1x playthrough is no longer a flat 50 s (`1 / baseRate` at the store's default
  `baseRate = 0.02`): across the current manifest's 14 scenes, most gaps are narrow enough in
  symlog `u` to hit the per-scene/dissolve floor (33 of 39 paced segments), so a full 1x
  playthrough of the current manifest takes about 87 s. A future manifest with wider gaps
  would take less; nothing is slowed below the ordinary `baseRate`.

---

## ADR-013 — Globe v2: every PaleoDEM epoch now, plate-rotated texels next, effects as data

**Status:** accepted — human-directed 2026-09-13. The Phase-1 bullets are implemented. The
design bullets set direction for later phases; the contract changes they need are listed
below and are not yet made. Detail and measurements: [`GLOBE.md`](./GLOBE.md).

**Context.** The globe published 12 PaleoDEM textures, one every 50 Myr, and crossfaded the two
nearest. Across a 50 Myr gap continents fade out and back in rather than move. The same 1°
netCDF bundle holds 109 epochs, roughly every 5 Myr. The globe also shows nothing before
540 Ma, and none of the planet's big states: ice ages, Snowball Earth, the magma ocean,
impacts, flood basalts.

**Decision — Phase 1 (implemented).**
- `sources/paleodem` publishes **all 109 epochs** as globe textures: 1024×512 lossy WebP at
  quality 90. Measured: 3.91 MB for all 109, against 29.5 MB as PNG. Refs are
  `textures/paleodem/<NNN.N>Ma.webp`, keeping the real age of the 385.2 and 390.5 Ma boundary
  maps.
- The globe loads textures on demand into an **LRU cache of 16** (≈32 MB of GPU memory). It
  preloads **4 frames ahead** in the direction `t` last moved and 1 behind, and decodes with
  `createImageBitmap`, which runs off the main thread. It trims the cache only after a pair is
  bound, never evicting the bound, requested or preloaded textures, and keeps the last bound
  pair on screen until the next pair loads.
- No contract changes: `RasterSequence`, `RasterFrameData` and `RasterValue` are unchanged,
  and only the frame count and the ref extension differ.

**Decision — design direction (later phases; see GLOBE.md §9 for order and cost).**
- **Continental motion is motion-compensated interpolation.** Each frame gets a lossless
  plate-id raster and a per-plate rotation table (unit quaternions). The shader samples each
  neighbouring frame at the texel's position rotated back from `t` to that frame's age, then
  crossfades the two. Plate ids and rotations for 0–540 Ma come from the **Scotese & Wright
  2018** plate model, the PaleoDEMs' own frame. Merdith et al. 2021 is not used there: its
  reference frame differs. Unassigned cells, mostly ocean floor, fall back to the plain
  crossfade.
- **1000–540 Ma** uses Merdith et al. 2021 continental polygons with stylised relief, labelled
  as such. It crossfades into PaleoDEM across a short band at 540 Ma, because the two
  reconstructions do not agree there.
- **Before 1 Ga** no reconstruction exists. The globe shows stylised **regimes**, each clearly
  labelled: magma ocean with the newborn Moon, Hadean water world, Archean haze with
  scattered protocrust, and "unknown geography". None of them implies real positions.
- **Curated shapes stay four (ADR-003).** Each id raster is a `RasterSequence`
  (`paleodem_plates`). The rotation tables are a second `RasterSequence`
  (`paleodem_rotations`) whose refs point at small binary tables. This is an awkward fit that
  ADR-003 explicitly accepts. Ice extent for the last glacial cycle is a `RasterSequence`
  (ICE-6G_C ice mask); Phanerozoic polar-ice extent is a `TimeSeries` (ice-line latitude).
- **An effect is an optional, additive field on an `EventSet` event**, not a separate effects
  table. The field is `effect: {kind, windows, anchor?}`, where `kind` is a closed enum
  (`impact-winter`, `giant-impact`, `flood-basalt`, `ice-shell`, `regime-*`), `windows` holds
  the dated intervals and `anchor` is an optional present-day lat/lon reconstructed to `t`.
  Timeline events that have a globe effect carry it, which keeps one date and one citation per
  event. The pre-1 Ga regimes live in a second `EventSet` (`globe-regimes`) that the timeline
  does not list. Envelopes are functions of `t` alone, so effects stay pure (DESIGN §10).
- Every stylised or artistic globe state is labelled on the globe itself, extending the
  existing "No reconstruction before 540 Ma" label into a per-regime caption.

**Contract changes these later phases need (all additive, not made yet).**
- `pipeline/shapes.py` `Event` and `web/src/types/layer.ts` `TimelineEvent`: optional
  `effect`.
- `pipeline/models.py` `PlateSnapshot`: optional `plate_ids` / `plate_rotations`
  `RasterBlend` fields.
- `web/src/app/buildLayers.ts` currently takes "the manifest's one raster layer". It must
  select raster layers by id once there are several. This is not a type change, but the
  globe's owner has to coordinate it with the app shell.

**Consequences.**
- Continents drift visibly now: land moves 1–3° between 5 Myr frames (measured), so the
  crossfade already reads as drift rather than fade. The payload shrank as the frame count
  grew ninefold.
- The warp raises land-mask agreement with the next real frame over a crossfade at every
  measured step, by +0.7 to +5.6 IoU points at 5 Myr and +20 to +30 at 50 Myr. Coastline
  redraws between epochs (sea level, new maps) remain, so the crossfade stays part of the
  blend.
- gplately and pygplates (GPL-2.0) stay offline under the existing `geo` extra. The frontend
  receives only rasters and numbers.
- The ICE-6G_C distribution (PMIP4) names required citations but states no licence. Confirm
  redistribution terms before ice textures ship.

---

## ADR-014 — Richer scene coverage in the one `waters-edge` chapter; no new shot type

**Status:** accepted — human-directed 2026-09-13.

**Context.** Before spending the image budget the human asked for much richer scene coverage:
organic evolution from the origin of life to the first land plants and animals, plant evolution
from spores to seeds to flowers and insect pollination, the K-Pg extinction as an arrival image
plus an aftermath image, and more events between 66 Ma and the present. Two work packages
drafted scenes (deep time older than 66 Ma; the Cenozoic) and events, and two reviewers checked
them against sources. ADR-014 was reserved for any new shot types or chapters this needed. One
exception was pre-approved: an `UNDERWATER` shot for the Cambrian sea floor.

**Decision.**
- **No new shot type or chapter.** Every new scene joins the existing `waters-edge` chapter
  (`WATER_EDGE` shot, `water-edge-series` composition), so `data/scenes.yaml` still holds two
  chapters: `molten-earth` then `waters-edge`.
- **`UNDERWATER` was drafted and then withdrawn** before any image was built. Two reasons:
  - A single `UNDERWATER` scene at 518 Ma would split `waters-edge` into two runs.
    `pipeline/scenes.py` forbids that, so it would force a chapter split and two extra
    near-cuts (DESIGN §6).
  - The Chengjiang biota lived on a shallow, muddy delta front, not a deep sea floor. It can be
    shown through the shallows at a shoreline, as `ediacaran-shallows` already shows its fauna.
  
  The enum members, composition text, VISUAL_SPEC §3 row and `Scene.shot` union member it added
  were removed in the same integration, so no contract changed. Re-adding it later would be
  additive, together with `web/src/shell/manifest.ts`'s runtime `SHOT_TYPES` list and a chapter
  split.
- **26 new scene records are merged directly into `data/scenes.yaml`, all unpinned:**
  - 16 older than 66 Ma, from `origin-of-life` (3.9 Ga, pool setting, contested) to the K-Pg
    pair.
  - 10 Cenozoic, from `paleocene-recovery` (62 Ma) to `ice-age-europe-neanderthal` (42 ka).
  
  The draft files are deleted. Publishing skips unpinned scenes with `--allow-unpinned`, so
  merging changes nothing in the published manifest until candidates are picked.
- **The K-Pg pair:**
  - `kpg-arrival` (66.043 Ma) is captioned as a composite. The Hell Creek-type landscape lies
    ~3,300 km from Chicxulub, and the steep trajectory (Collins et al. 2020) means the bolide
    could not have been seen from there.
  - `kpg-aftermath` sits ~100 years after impact, inside the fern spike: clear sky, dead trunks,
    a fern carpet.
- **`devonian-estuary`** is re-specified by diagnostic anatomy (a neck and no gill cover, not a
  "crocodile-like head"), with Archaeopteris forest on its far bank. Its pin is cleared. The
  pipeline has no "pinned but superseded" state, so the scene leaves the published manifest
  until a new candidate is picked.
- **Scientific review applied.** Both reviews' blockers and majors, and the minors that were
  clearly right, are applied to the scenes and to `data/events.yaml`.
  - `neoproterozoic-seaweed` is dropped as a near-duplicate of `boring-billion-shallows`.
  - Where the subject that carries the story is millimetres to centimetres long (pollinating
    insects, first flowers, algae), the scene's main subject is restated at landscape scale.
    Insect-scale co-evolution is left to the ancestor-portrait channel (ADR-015).
  - `absent` never lists `people` in a hominin scene, because the renderer would then forbid the
    main subject. `tests/test_prompts.py` guards this.
  - One event is added, `early-eocene-climatic-optimum`, so `data/events.yaml` holds 66 events.
  - Citations that could not be confirmed carry an inline UNVERIFIED marker.

**Consequences.**
- `earthtime plan` lists 27 unpinned scenes: the 26 new ones plus `devonian-estuary`.
- **Pacing:** `SCENE_DWELL_SECONDS` / `MIN_TRANSITION_SECONDS` (ADR-012) should be revisited
  once the new scenes are pinned. The checkpoint count rises from 14 to 40, and some neighbours
  sit very close in symlog time:
  - the K-Pg pair, ~100 years apart
  - `arctic-hothouse-forest` / `eocene-jungle`, 52 / 50 Ma
- **Coverage gaps left open** (not verified this session, so not drafted):
  - **Deep time:**
    - first jawed vertebrates / Devonian fishes
    - Calamophyton first forest (~390 Ma)
    - first mammals and first birds
    - end-Ordovician glaciation
  - **Cenozoic:**
    - an Oligocene scene
    - whales returning to the sea (Wadi Al-Hitan, ~40 Ma)
    - a Homo sapiens scene
    - Miocene apes
    - a post-100 Ma bee-and-flower scene
- `CANOPY` and `GROUND` remain `Shot` members with no composition text.

---

## ADR-015 — Ancestor portraits: photoreal specimen plates with offline flow morphs

**Status:** accepted — human-directed 2026-09-13. Resolves DESIGN §14 q4; supersedes DESIGN
§10's "~50 nodes … (~$5 total)" estimate and the text-only ancestor readout.

**Context.**
- DESIGN §10 promised a portrait for each lineage node, and §14 q4 left its register open. The
  human chose a **photoreal specimen plate** and asked for smooth morphing between portraits.
  They also asked for a lower resolution than scenes "for cost savings if possible".
- `data/lineage.yaml` has 42 nodes. The generation ceiling is $40, with $7.41 already spent.

**Decision.**
- **Register.** Two plate types, `SPECIMEN` and `MICROSCOPE`, share one invariant portrait style
  (VISUAL_SPEC §10). It is separate from the scene style, and VISUAL_SPEC §2 is unchanged.
  Portraits render from text only (ADR-010).
- **Subjects.** They live in `data/portraits.yaml`, keyed by lineage node id. Each record has
  `sources`, `gaps` and `evidence`. A `reconstruction` or `extant-proxy` must say so in the
  prompt text (enforced when loading).
  - 41 nodes have specs. `deuterostomia` is omitted because its lineage representative,
    Saccorhytus, was reinterpreted as an ecdysozoan (Liu et al. 2022, Nature,
    doi:10.1038/s41586-022-05107-z).
  - The human must decide that node's representative. Until then the viewer holds the older
    plate.
- **Size.** 1:1 at 1K, set in `pipeline/generators/image.py` (`PORTRAIT_ASPECT_RATIO`,
  `PORTRAIT_IMAGE_SIZE`). Scene size and aspect are unchanged.
  - Google's pricing page, checked 2026-09-13, shows $120/M image output tokens. Images from 1K
    up to 2K both use 1120 tokens (about $0.134 per image); 4K uses 2000 (about $0.24).
    Source: https://ai.google.dev/gemini-api/docs/pricing.
  - So **1K costs the same as 2K**: it saves payload, not money.
  - The pipeline's pessimistic estimate is about $0.154 per plate (it adds input and a thinking
    allowance). The latest ledgered actual was $0.141.
  - `1:1` as an accepted aspect ratio is confirmed only by third-party integration docs, not
    Google's own pages. The style gate's first response confirms it; the candidate sidecar
    records the returned dimensions.
- **Pipeline.** Portraits are a first-class image target built from existing machinery.
  - Each portrait is a PROMPT node plus an IMAGE node (`portrait.<node>.prompt` / `.image`).
    It uses the existing `AssetKind`s and `Resolver`, a candidate store at
    `data/candidates/portraits/`, and the same `Ledger` and ceiling. Generators still reserve
    before each call.
  - CLI:
    - `earthtime plan` shows every portrait and its estimate.
    - `earthtime build --only portraits [--node …] [--candidates N]`, default 1.
    - `earthtime review portraits [sheet|pick|clear]`, with pins written into
      `data/portraits.yaml`.
    - `earthtime publish` copies pinned plates to `data/media/portraits/`.
  - `build.py` now loops over any `ImageJob`, `plan.py` shares the standing computation, and
    `scenes.patch_pin_line` is public for reuse. Scene behaviour and CLI output are unchanged.
  - **No change** to `graph.py`, `models.py`, `spend.py` or `shapes.py`.
- **Contract additions (all additive, backward compatible).**
  - `pipeline/manifest.py`: `TreeData.portraits` holds `PortraitSetData` (plates and morphs).
    It is omitted from the JSON when absent, so existing layer files are byte-identical.
  - `web/src/data/curated.ts`: `TreeData.portraits`, validated in `parseTreeData`. Every plate
    must name a node, and every morph must join adjacent plates.
  - `web/src/types/layer.ts`: optional `NodeValue.portrait` (a `PortraitMix`), plus
    `PortraitPlate`, `PortraitMorph` and `PortraitPlateType`.
  - The `Layer` interface is unchanged, and `sample()` stays pure in `t`.
- **Morph.** Computed offline, deterministic and free, by `earthtime morph`. It needs the
  optional `morph` extra (`opencv-python-headless`); core dependencies are unchanged.
  - Per consecutive pinned pair: a subject box is taken from the dark backdrop, and the subject
    is centred and scaled to 70% fill.
  - DIS optical flow runs both ways, Gaussian-smoothed. It is composed back onto each plate's
    own grid, so no alignment transform ships.
  - Output is two 128×128 RGB PNG data textures, one per direction, encoded as byte =
    round(d / range · 127) + 128.
  - Cached by both pins' digests plus the algorithm version. Publish includes the cached morphs
    and warns about pairs without one, which the viewer crossfades.
- **Viewer.** `<AncestorPortrait layer t assetBase />` in `web/src/layers`.
  - The target mix is pure in `t`. It runs a smoothstep across a band that starts at each plate's
    divergence and covers `MORPH_BAND_FRACTION = 0.25` of the log1p gap down to the next
    younger plate (or the present).
  - The displayed mix is rate-limited to `MIN_PORTRAIT_TRANSITION_SECONDS = 1.2` by
    `web/src/lib/presentedMix.ts`: ADR-012's limiter, generalised over the item type so the
    layers package does not import the scene package.
  - WebGL warps each plate toward the other by α / 1−α and blends in linear light. Without
    WebGL it is a plain crossfade. The plate is round and feathered for the lens HUD.
- **Style gate first.** `leca`, `bilateria`, `tetrapodomorpha` and `homo-erectus`, then the
  remaining 37.

**Consequences.**
- All 41 plates at one candidate: about $6.30 estimated (about $5.80 at the ledgered actual).
  The gate at two candidates: about $1.23 estimated. Morphs cost nothing.
- A plate without a pin, or a pair without a morph, degrades gracefully: an older plate is held,
  or the pair crossfades. Portraits can therefore ship a few at a time.
- The limiter algorithm now exists twice: `scene/presentation.ts` and `lib/presentedMix.ts`.
  `lib/webgl.ts` and `lib/assetUrl.ts` also repeat scene helpers. The scene package can adopt
  the shared versions with no behaviour change; that is a follow-up.
- Morphs between very different body plans read as a warped dissolve, not anatomical
  correspondence. Plate framing discipline, not the flow algorithm, decides how good they look.
- Some subject texts rest only on secondary summaries, where the primary paper was unreachable.
  Those records say so in `gaps`, for review before pinning.

---

## ADR-016 — Two explicit playback modes replace the ADR-012 hybrid; a bounded gap bonus

**Status:** accepted — human-directed 2026-09-14. Supersedes ADR-012's pacing bullet only; the
smooth-crossfade and lens-layout bullets of ADR-012 stand.

**Context.** ADR-012's hybrid pacing — constant symlog velocity, capped downward per scene so
each dwell/dissolve takes at least a floor duration — reads as an irregular rhythm once the
manifest holds real coverage: some gaps sit exactly at the floor, others run faster or slower
depending on how their `u`-span happens to compare to it, with no single rule a viewer could
learn. Speed semantics were muddy for the same reason — "2x" meant different things depending
on how many segments a given stretch of playback happened to be capped in. With ADR-014's 40
scenes (up from 14), the cap dominates almost everywhere: 33 of the original 39 paced segments
were already floor-bound at 14 scenes, and denser coverage only pushes that fraction higher, so
the "constant velocity" playback rate promised in DESIGN §3 had, in practice, degenerated to
near-scene-mode already, just without being named as such or offering the honest alternative.

**Decision.** Two explicit modes (`Playback.mode: 'scenes' | 'steady'`, additive), sharing one
`speed` multiplier and a segmented control ("Scenes | Steady") next to the speed selector:

- **`'scenes'`** (default). Every scene gap takes the same wall-clock time to cross regardless
  of its span: `SCENE_DWELL_SECONDS` (3.0 s, split across the gap's two neighbouring holds, as
  before) plus `MIN_TRANSITION_SECONDS` (1.6 s) through the dissolve band, plus a **bonus** on
  the two holds only — never the dissolve — for a gap that covers a lot of the timeline: up to
  `MAX_GAP_BONUS_SECONDS` (2.0 s), split evenly across the gap's two holds, ramping as
  `2 · min(1, uSpan / 0.15)` where `uSpan` is the gap's span in full-domain symlog `u`. Chosen
  and calibrated against the current 40-scene `data/scenes.yaml`: the widest gap
  (`ice-age-europe-neanderthal` at 42 ka to `acheulean-erectus` at 1.76 Ma, `uSpan ≈ 0.27`) is
  the only one that saturates the bonus; the next two (`c4-savanna-hipparion` ->
  `miocene-grassland`, `≈0.072`, and `boring-billion-shallows` -> `great-oxidation`, `≈0.064`)
  land around 90% and 80% of it; the median gap (`≈0.011`) gets a small, proportionate sliver.
  The human's own framing: a fast-moving playhead on the track already conveys elapsed time
  during a vast gap, so a small bonus reinforces that read without breaking the rhythm scenes
  close together already establish. Inside a segment the playhead moves at *exactly* the
  velocity that spends the segment's duration — `advancePlayhead` no longer caps that velocity
  against the ordinary rate, so a sparse gap can now run faster than `'steady'` mode would for
  its `durationSeconds`, which is the point (ADR-012's hybrid specifically prevented this).
  Outside every scene's span — older than the oldest scene, newer than the newest — and outside
  every paced segment, the playhead moves at the ordinary flat rate, unchanged from before.
- **`'steady'`**. Constant velocity in the full-domain scale of whichever `ScaleKind` is
  currently selected (symlog by default; linear years when the linear toggle is on); no pacing
  at all. Dense scene clusters are simply crossed as reached, at whatever wall-clock speed the
  warp and the speed multiplier produce; `presentation.ts`'s existing `MIN_TRANSITION_SECONDS`
  rate limiter remains the visual backstop that keeps a too-fast crossing reading as a dissolve
  rather than a hard cut, exactly as it already was the backstop for fast scrubbing.
- **Speed** (0.25x–64x, unchanged range) applies identically to both: `'scenes'` divides every
  segment's duration by `speed`; `'steady'` multiplies its flat velocity by `speed`.

**Implementation.**
- `advancePlayhead` (`timeline/playback.ts`) branches on `playback.mode`, not a boolean or an
  "empty pacing array" convention — `scenesPacing` is ignored outright in `'steady'` mode. It
  stays exactly integrated across segment boundaries for a single large `dtSeconds` (a stalled
  tab regaining focus), matching the sum of many small steps to float precision — unchanged
  from ADR-012's own integrator, only the per-segment rate computation lost its cap.
- `scene/pacing.ts`'s `PlaybackSegment.minSeconds` is renamed `durationSeconds`: ADR-012's field
  held a floor; ADR-016's holds an exact figure, and the old name would have been actively
  misleading left as-is. `scenePlaybackSegments` now bakes each gap's bonus into its two hold
  segments' `durationSeconds` directly, so `timeline/playback.ts` needs no "hold vs dissolve"
  concept of its own — it only ever crosses segments at their exact duration, uniformly.
- The ADR-012 hybrid's `Math.min(baseRate, uSpan / minSeconds)` cap, and the tests written
  specifically to pin down capped-vs-uncapped behaviour, are deleted rather than left as dead
  paths alongside the new logic.
- The caller (`Experience.tsx`) selects `advancePlayhead`'s `fullScale` argument per mode:
  always the full-domain symlog scale for `'scenes'` (a scene's dwell/dissolve durations do not
  change when the user flips the linear toggle), and the full-domain scale matching the
  timeline's current `symlog`/`linear` toggle for `'steady'`.
- `Transport` (`timeline/components/Transport.tsx`) gained the segmented mode control, ghost
  style with an amber active state (the existing `--hud-*` lens visual language, not a new
  idiom), and an optional faint rate readout beside it while playing (`"≈ 40 Myr/s"`,
  `formatRate` in `timeline/format.ts`) — `Experience.tsx` computes the instantaneous
  years-per-second from the real per-frame `t` delta already available in the playback loop and
  smooths it (0.5 s time constant) so it doesn't flicker. Screenshotted at 1440×900 and 400×850;
  kept, since it reads as a small mono-font label beside the toggle at both sizes without
  crowding the speed selector — narrower than the minimap it sits beside even at 400 px, and it
  only ever appears while playing, so it adds nothing to the idle/scrubbing chrome.
- The wheel-listener defect (QA-reported, unrelated to pacing but fixed in the same pass since
  it lives in the same owned files): `ScrubTrack`'s wheel handling moved from React's `onWheel`
  (attached passively at the root, so `preventDefault` silently failed and logged "Unable to
  preventDefault inside passive event listener invocation" on every gesture) to a native
  `addEventListener('wheel', ..., { passive: false })` on the track element, added in an effect
  and kept current via a ref-mirrored closure. `AxisTicks`, `Minimap` and `Loupe` (the hover
  loupe this ADR's own track pips floated above — later removed outright by ADR-017, which
  replaced it with a fisheye stretch of the track itself) were audited and use only pointer
  events for their own drag gestures — none of them touch `onWheel`, so the fix is confined to
  `ScrubTrack`.

**Consequences.**
- A `'scenes'`-mode playthrough's length now scales with scene count, not just gap width: for
  the current `data/scenes.yaml` (40 scenes, 39 gaps, all counted whether pinned or not), a full
  1x playthrough takes **≈191 s** (`Σ(SCENE_DWELL_SECONDS + MIN_TRANSITION_SECONDS + bonus)`
  over every gap) — about 179 s of it the flat per-gap floor (`3.0 + 1.6` s × 39), the remaining
  ≈12 s the bonus, concentrated almost entirely in the one saturated gap above. This replaces
  ADR-012's own "≈87 s for 14 scenes" figure; recompute again whenever the scene count changes
  materially.
- `'steady'` mode makes dense scene clusters (500–250 Ma, or the Cenozoic's closely-spaced
  scenes) flash past at high speed, showing far fewer of them clearly than `'scenes'` mode would
  at the same speed — an accepted, named trade-off of "no pacing at all", not a bug: it is the
  literal, honest constant-velocity playback DESIGN §3 originally specified, now available
  alongside the paced default rather than instead of it.
- `PlaybackPacingSegment`/`PlaybackSegment`'s renamed `durationSeconds` field, and
  `advancePlayhead`'s now-mode-driven branch, touch every existing consumer of the old
  `minSeconds` name and the old "omit `pacing` for flat, pass it for capped" calling convention
  — confined entirely to files this ADR's author owns (`timeline/**`, `scene/pacing.ts`), so no
  cross-team coordination was needed.
- `Playback.mode` is additive to the `Playback` type (DESIGN §3, not itself NORMATIVE); every
  constructor of a `Playback` value in the codebase lived inside the same owned files and was
  updated alongside it.

---

## ADR-017 — A fisheye stretch of the scrub track replaces the hover loupe

**Status:** accepted — human-directed 2026-09-14.

**Context.** The hover loupe (ADR-016's own `Loupe.tsx`/`loupe.ts`) showed a *linear* window of
`mainWindow span / 12` centred on the cursor, floating independently above it. On the default
symlog track at full zoom-out (`mainWindow` = the full 4.6 Gyr domain) that window is
`4.567e9 / 12 ≈ 380` Myr wide — hovering at 73.9 ka, deep in the near-linear part of the symlog
warp, showed the loupe spanning roughly "200 Ma → present": no resolution gain at all where the
main track already has almost none. The loupe's own span was a fixed fraction of the *main*
window regardless of where in the (nonlinear) warp the cursor actually sat, so it helped least
exactly where the main track needed help most. The human's own framing: enlarge the main track
itself around the hover area, rather than bolt on a second, separately-scaled overlay that has
to be independently legible, positioned, and kept in sync with what it's magnifying.

**Decision.** The scrub track distorts in place (`timeline/fisheye.ts`, pre-existing in this
pass — see its own doc comment for the full derivation) instead of being duplicated into a
floating overlay:

- **Density/raised-cosine construction.** The distortion is a density over the undistorted
  track's own `0..1` space, `1 + gain · bump(s)`, where `bump` is a raised cosine
  (`(1 + cos(π·x / halfWidth)) / 2`) of half-width `FISHEYE_HALF_WIDTH_PX` (60 undistorted px)
  centred on the lens focus — zero outside that window, so nothing beyond it moves at all, and
  `C¹`-continuous at the window edge (a raised cosine's derivative vanishes at `±halfWidth`), so
  the transition into and out of the stretched region has no visible kink. A displayed position
  is that density's normalised integral: strictly increasing everywhere (the density is always
  positive), so the distorted scale always inverts, and closed-form (`primitive`/`bumpIntegral`
  are both elementary), so only `fromUnit` needs bisection, not `toUnit`. Peak magnification is
  `(1 + FISHEYE_GAIN) / normaliser`, about 5x on a typical 1440px-wide track — enough that a
  cluster of pips that used to be indistinguishable spreads to individually clickable, without
  the track visibly ballooning.
- **The dead zone.** A lens glued exactly to the pointer would make pointing *less* precise than
  no lens at all: content under a moving lens slides past the pointer at the magnification rate,
  so the very act of moving toward a target drags it sideways faster than the pointer approaches
  it. `stepFisheye` instead holds the lens still while the pointer moves within
  `FISHEYE_DEADZONE_PX` (48 displayed px) of the lens centre, and only eases the lens toward the
  pointer once it leaves that zone — small, precise movements (aiming at a specific pip) never
  perturb the magnified content at all; only a deliberate move to a new area of the track drags
  the lens along.
- **Magnification-aware LOD.** `lod.ts` gains `minImportanceAt(spanYears, magnification) =
  minImportanceForSpan(spanYears / max(1, magnification))`: a point under the lens is treated as
  though the visible span were narrower by exactly the local stretch factor, so the LOD floor
  drops (more events become visible) precisely where the lens has made room for them on screen,
  computed per event at its own uncertainty-band midpoint rather than once globally — two events
  a few pixels apart on screen can now sit on either side of the threshold depending on which
  one the lens happens to be centred over.
- **Snapping kept, relocated.** The loupe's snap-to-nearby-event/checkpoint behaviour survives
  as `timeline/snap.ts` (`snapCandidates`/`findSnapTarget`, a straight port of `loupe.ts`'s
  `loupeCandidates`/`findLoupeSnapTarget` minus the loupe's own window/position math) — a click
  or hover still resolves to an exact event/checkpoint within `SNAP_PX` (10 displayed px) when
  one is close enough, just measured against the track's own now-distorted pixel space instead
  of a separate loupe-local one.
- **The ruler stretches too.** `AxisTicks` is handed the same distorted `TimeScale` the track
  is, not the undistorted one, so tick spacing/labels spread apart in lockstep with the track
  content sitting above them — the two would otherwise visibly disagree about where a given
  time sits on screen.
- **The chart dock stays undistorted, deliberately.** `LayerChart` (`Experience.tsx`'s expanded
  chart) keeps reading the plain animated `scale`, never the fisheye one: a chart's x-axis
  encodes a fixed correspondence between screen position and time that the reader is meant to
  compare across the whole visible span (is this trend steeper here than there); a hover-driven
  local stretch would make that comparison actively misleading (a flat trend crossing the lens
  would visually flatten further, an already-steep one would visually steepen) for a component
  whose entire job is showing shape, not aiding a click target. Out of scope for this pass to
  change; noted here as a deliberate asymmetry rather than an oversight.

**Implementation.**
- `Timeline.tsx` owns the lens (`useFisheye`, a `requestAnimationFrame` loop around
  `stepFisheye`/`isFisheyeSettled` following the same ref-mirrored-closure idiom as
  `useAnimatedScale`/`useWheelZoomAccumulator`, snapping straight to the target with no rAF loop
  at all under `prefers-reduced-motion: reduce`) and derives `trackScale =
  fisheyeScale(scale, fisheye.lens, fisheye.trackWidthPx)`, memoised on the lens/track-width
  actually changing. `trackScale` goes to `<ScrubTrack>` (as `scale`) and `<AxisTicks>`;
  `<ScrubTrack>` also receives the undistorted `scale` back as `baseScale`. The zoom buttons,
  keyboard shortcuts, fit-all and event-framing all continue to anchor on the undistorted
  `scale` — the lens is a pointer-time reading of the window, never a new space to zoom in.
- `ScrubTrack` reports every pointer position over the track to the lens
  (`onLensPointer(u, trackWidthPx)`, `u` in the *displayed*, already-distorted space) and
  releases it on leave/touch-up, mirroring exactly the mouse-vs-touch/pen visibility rule the
  old loupe used (`activePointerTypeRef`: mouse gets a true hover, touch/pen only show for the
  duration of an active drag). Any conversion from a displayed anchor back to the underlying
  window's own space — the wheel-zoom anchor, the empty-track double-click zoom anchor — goes
  through `baseScale.toUnit(scale.fromUnit(u))`; scrubbing itself does not, since the time under
  a given screen position *is* `scale.fromUnit(u)` by construction.
- The loupe's floating readout (`position: fixed`, independently positioned via
  `loupePosition`/viewport clamping) is replaced by a small in-track readout riding the
  pointer's own displayed x, styled from the loupe's old `.snapLabel`/`.time` (moved into
  `ScrubTrack.module.css`) — no viewport math needed, since it now lives in the track's own
  percentage-based coordinate space alongside the playhead label and pip previews. It fades
  120ms, hides while a pip is hovered (`.hitArea:has(.pip:hover)`, extending the rule that
  already recedes the playhead label for the same reason) and edge-anchors via the same
  `previewAnchorClass` the pip preview already uses, so it never clips at either end of the
  track. The playhead's own `.timeLabel` fades out while the readout is visible
  (`.hitArea[data-hover-active='true']`), since the two would otherwise occupy the same spot.

**Consequences.**
- `loupe.ts`, `loupe.test.ts`, `components/Loupe.tsx` and `components/Loupe.module.css` are
  deleted outright rather than kept alongside the new mechanism — see the note added to
  ADR-016's own wheel-listener bullet, the only other place `Loupe` was mentioned by name.
- The scrub track's hit-testing, event LOD and snap candidates now all read a `FisheyeScale`
  (`TimeScale` plus `magnificationAt`) rather than a plain `TimeScale` — any future consumer of
  `ScrubTrack`'s `scale` prop must supply one (`fisheyeScale` returns a flat `magnificationAt:
  () => 1` with no lens, so a caller that wants no distortion still satisfies the type with
  `RESTING_FISHEYE`'s own resting lens).
- A viewer who never hovers the track (touch-primary, keyboard-only) sees no behavioural change
  at all beyond the loupe's disappearance: the lens only distorts anything once `pointTo` has
  been called, and every discrete window change still goes through the undistorted `scale`.

Decisions deferred to Phase 1, to be recorded here once answered:

- ~~**Image model selection**~~ **RESOLVED by ADR-010:** `gemini-3-pro-image-preview` for
  every final scene, text only, selected in `pipeline/generators/registry.py`.
- **Chapter count** — 8 vs 14 (DESIGN §14 q1). v1 ships 14 scenes in 2 composition-defined
  chapters (ADR-010); revisit once the finals can be scrubbed.
- **Does depth displacement survive wide-vista framing** — deferred with ADR-009, revisit
  when the 2.5D phase begins
- **Default timeline scale** — symlog vs density (DESIGN §14 q3)
- **Globe texture resolution** (DESIGN §14 q5)
- ~~**Ancestor portrait register**~~ **RESOLVED by ADR-015:** photoreal specimen plates.
- ~~**`gplately` viability**~~ **RESOLVED.** A clean `pip install gplately` completes in
  ~33 seconds, wheels only, no conda and no system GDAL/PROJ/GEOS. pygplates 1.0.0 ships
  first-party `macosx_11_0_arm64` wheels for cp38–cp313; every binary dependency (cartopy,
  shapely, rasterio, netcdf4) also ships cp312 macOS arm64 wheels. The precomputed-rotation
  fallback is not needed. Two caveats: verified on Linux x86_64, so arm64 rests on wheel
  availability rather than a test — confirm once on the target Mac; and gplately/pygplates
  are GPL-2.0, fine for the offline pipeline but **must not be vendored into the shipped
  frontend**.

## ADR-018 — Pinned images and published media are committed with Git LFS

**Status:** accepted — human-directed 2026-09-14. Amends the generated-media row of
DATA_SOURCES § Storage policy (NORMATIVE); the curated and raw tiers stand.

**Context.** The storage policy put generated media in R2 only, but no upload was ever built:
`earthtime publish` writes `data/media/` locally. A clone therefore had no images, and the pinned
originals — paid for, human-picked and nondeterministic, so impossible to recreate — existed on
one machine. The human asked for the images the app needs, and other relevant data, to be
versioned with the project.

**Decision.**
- Git LFS (`.gitattributes`) for `*.jpg`, `*.png` and `*.webp` under `data/media/` and
  `data/candidates/`.
- Committed: all of `data/media/` (scene stills, portraits and their morph flow maps and globe
  textures through LFS; `manifest.json` and `layers/*.json` as plain git), and every pinned
  candidate image. `data/candidates/` stays gitignored; `make pins` force-adds the image each
  pin in `data/scenes.yaml` and `data/portraits.yaml` points at and drops tracked candidates no
  longer pinned. Published scene and portrait files are byte-identical copies of their pins, so
  LFS stores each image once.
- `spend.json` is committed, so every clone enforces the spend ceiling against the same ledger.
- Not committed: unpinned candidates, candidate JSON sidecars, contact sheets, the morph cache and
  `data/raw/`. Sidecar prompts add nothing for regeneration: `pipeline/prompts.py` is pure
  templating over committed inputs, a regeneration only happens after one of those inputs
  changes (a new digest and a new prompt), and resending an old prompt would not reproduce an
  image anyway. Raw data stays reproducible through each source's `fetch.py` and sha256.

**Consequences.**
- A clone with `git lfs install` runs the frontend with every published image and can
  `earthtime publish` from committed pins without a paid call; portrait morphs need a free,
  local `earthtime morph` first (the cache is not committed).
- After `earthtime review pick` or `clear`, run `make pins` before committing.
- Republishing rewrites `data/media/`, which shows up as LFS object churn in history. Acceptable
  at ~110 MB; serving from a CDN, if deployment lands, is a copy of `data/media/`, not a change
  of where it is stored.
- Contributors still cannot add generated media; only its storage location changed.
