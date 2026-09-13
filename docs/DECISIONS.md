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

## ADR-014 — A fifth shot, `UNDERWATER`, and a draft of deep-time scenes older than 66 Ma

**Status:** accepted (human-directed 2026-09-13).

**Context.** The human asked, ahead of spending the image budget, for much richer scene
coverage of deep time: organic evolution from the origin of life through the first land
plants and animals, plant evolution from spore-bearers through seeds to flowers and
insect pollination, and the K-Pg extinction as an arrival-of-the-asteroid image plus an
aftermath image. The existing camera grammar (VISUAL_SPEC §3) has four shots, all of them
framed from land or a shoreline. The Cambrian explosion — trilobites, radiodonts,
Hallucigenia, our own lineage's Haikouichthys — happened entirely on the open sea floor;
no existing shot can honestly frame it, and forcing it into `WATER_EDGE` (a fish's-eye
view from the shallows, per the existing scenes' composition) would misrepresent a fauna
that lived below the photic shoreline, not at its edge.

**Decision.**
- A fifth shot, `UNDERWATER`: camera fully submerged at mid-water depth, looking
  horizontally across the sea floor, light shafts from above. Added to `Shot` and
  `SHOT_TYPE` in `pipeline/prompts.py`, the camera-grammar table in VISUAL_SPEC §3, and
  additively to `Scene.shot` in `web/src/types/manifest.ts` (the union gains
  `'UNDERWATER'`; every existing scene is unaffected). A matching `Composition.
  UNDERWATER_SERIES` and `COMPOSITION_CONSTRAINTS` entry hold its own frame layout,
  mirroring how `WATER_EDGE_SERIES` and `RIDGE_VISTA` are built.
- 17 new scene specs, unpinned, drafted into a new file, `data/scenes-draft-deep.yaml`
  (same schema as `data/scenes.yaml`, loads through the same `SceneBook` loader), spanning
  a contested ~3.9 Ga origin-of-life setting through a K-Pg aftermath scene a few
  thousand years after impact. Organised into three chapters: `primordial-seas`
  (`WATER_EDGE`, four scenes from origin-of-life to the first multicellular seaweeds),
  `cambrian-seafloor` (`UNDERWATER`, one scene), and `greening-world` (`WATER_EDGE`, the
  remaining twelve scenes from the Ordovician shore through the K-Pg pair). Every scene's
  date, organisms and environment are cited against primary literature or the ICS chart
  in a comment block above the record, per the existing file's convention; `unsourced`
  atmosphere/temperature figures follow that field's own documented convention (rounded,
  plausible, not citations, per `data/scenes.yaml`'s header and `UnsourcedConditions`'
  docstring) rather than being independently sourced.
- `data/scenes.yaml`'s `devonian-estuary` scene is fixed in place: its Tiktaalik
  description named "a crocodile-like head", which the SCENE SPEC RULES this brief
  operated under specifically call out as a failure mode (likeness to a modern animal
  gets drawn instead of the animal described) — the fix describes it by diagnostic fish
  anatomy (lobe fins with fin rays, overlapping scales, a gill region, a flattened head,
  a fish tail, mostly submerged) instead. Its pin is cleared so it regenerates; the
  cleared pin's digest and path are kept in a YAML comment for reference.
- 16 new events are added to `data/events.yaml`, verified against primary literature via
  live web fetches (WebSearch was unavailable for this run — its session budget was
  already spent by other concurrent work — so citations were verified by fetching the
  actual source page rather than from model memory), each inserted near its
  chronological neighbours: `origin-of-photosynthesis`, `banded-iron-formations`,
  `first-seaweeds`, `great-ordovician-biodiversification`, `end-ordovician-extinction`,
  `first-forests`, `first-seed-plants`, `late-devonian-extinction`,
  `carboniferous-rainforest-collapse`, `gymnosperm-radiation`, `siberian-traps`,
  `end-triassic-extinction`, `earliest-pollinating-insects`, `angiosperm-radiation`,
  `deccan-traps`, `k-pg-aftermath`. Three requested topics were skipped as already
  covered by an existing event, not added as duplicates: "first eukaryotic algae" (the
  existing `eukaryotes-origin` event's own citation, Bengtson et al. 2017, already
  describes 1.6 Ga crown-group red algae), "first vascular plants" (the existing
  `land-plants` event's upper bound is already Cooksonia, ~425 Ma), and "first flowers"
  (the existing `flowering-plants` event).

**Consequences.**
- No NORMATIVE contract changed non-additively: `Shot`/`Composition` are pipeline-internal
  enums (not NORMATIVE themselves), and the one NORMATIVE surface touched,
  `Scene.shot` in `web/src/types/manifest.ts`, only gained a union member.
- `web/src/shell/manifest.ts`'s runtime manifest validator has its own separate
  `SHOT_TYPES` literal array (`['WIDE_RIDGE', 'WATER_EDGE', 'CANOPY', 'GROUND']`) that
  this ADR's brief did not own and therefore leaves unchanged. **Before any published
  manifest can contain an `UNDERWATER` scene, that array needs `'UNDERWATER'` added too**,
  or the runtime will reject the manifest. Flagged for whoever wires the Cambrian scene
  into a build.
- `data/scenes-draft-deep.yaml` is a standalone, unpinned draft — not merged into
  `data/scenes.yaml`, not part of any chapter the manifest currently publishes, and not
  built by this ADR. Merging it means deciding how its three chapters interleave with the
  existing `molten-earth`/`waters-edge` pair (a chapter must be one consecutive run of
  scenes in time, per `pipeline/scenes.py`'s `SceneBook` validator) and running
  `earthtime review` to pin each generated candidate — deliberately left to whoever
  merges it and spends the budget, per this run's no-generation, no-build constraint.
- The devonian-estuary fix changes only prose (no field added or removed), so it is a
  content correction, not a contract change, and needed no ADR of its own beyond being
  recorded here per the brief's instruction.

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
