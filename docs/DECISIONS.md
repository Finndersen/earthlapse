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
- **Amendment — 2026-09-15: scene texture colour space.** "Blended in linear light" and
  "pixel-exact at both ends" above describe the intended shader, not what shipped.
  `scene/textureCache.ts` tagged every scene texture `SRGBColorSpace`, so the GPU decoded it to
  linear on sample; `scene/shaders.ts`'s fragment shader then decoded it a second time
  (`srgbToLinear`) for the blend and, at the two settled endpoints, wrote the already-decoded
  linear texel straight to `gl_FragColor` with no re-encoding at all. Every scene rendered
  darker than its file — measured at 1440×900, centre-crop means 30–64 codes below the
  published JPEG across five scenes spanning the manifest (`ediacaran-shallows`,
  `cambrian-seafloor`, `giza-great-pyramid`, `magma-ocean`, `shenzhen-bay-present`), consistent
  with the same double-decode-no-re-encode bug ADR-015's portrait plates had. Textures now
  upload `NoColorSpace`, matching `layers/portraitTextures.ts`; the shader is otherwise
  unchanged, since its own `srgbToLinear`/`linearToSrgb` bracket was already correct for a
  texture that samples as raw sRGB bytes. Re-measured directly off the WebGL canvas (not a
  resized page screenshot) against a numpy emulation of `coverUV` plus bilinear sampling of the
  published JPEG, across thirteen settled scenes spanning the manifest: per-pixel MAE
  0.24–0.25 codes, mean signed delta 0.00, p99 |Δ| 0.5 — 8-bit rounding, not a colour-space
  defect. (A same-day resized-screenshot comparison had reported up to 2.6 codes on
  `magma-ocean`; that spread was resize/crop interpolation noise, not present in the raw
  canvas.) The globe's fragment shader was checked against the same
  failure mode (GLOBE.md §2.3/§9 G2) and was already correct — it decodes via `SRGBColorSpace`
  deliberately and re-encodes once via `#include <colorspace_fragment>` at the end, so it was
  left unchanged.
- **Amendment — 2026-09-15: idle calm removed; an About & credits panel replaces the always-on
  footer.** User (2026-09-14): "also the event feed shouldn't fade away when there is no mouse
  movement - i dont think anything should automatically fade away"; and, on the footer, "maybe
  the credit should just be a popover element/panel instead of what appears to be an entirely
  new page? so the immersive experience isnt interupted so much. the 'Artistic reconstruction —
  plausibility, not accuracy.' disclaimer can probably be removed entirely or moved into the
  credits panel."
  - Idle calm — this ADR's "the periphery dims while playback runs and the viewer is idle" — is
    removed outright, not tuned: `useIdle`, the `calm` prop, `data-calm`, the `.peripheral` CSS
    and `IDLE_CALM_MS` are gone from `shell/` and `app/Experience.tsx`. A repo-wide check found
    no other inactivity-driven hide (the timeline hint dismisses on an explicit dismiss or a
    successful hover, never a timer; nothing else in scene, globe or transport fades or hides on
    its own). The event feed's own fade — cards receding as the playhead moves past them — is
    unaffected: it was already pure in `t`, not tied to mouse inactivity, and was never idle
    calm to begin with.
  - The footer row this ADR put below the timeline (a Credits link plus the VISUAL_SPEC §9
    disclosure) is removed with it. In its place: a small muted "About & credits" button,
    top-left, in flow with the globe orb's own column rather than fixed-position (`ShellLayout.
    tsx`), opening `shell/Panel.tsx` — the one shared accessible dialog primitive this
    introduces (focus trap, Escape, focus restore, click-outside, a phone bottom-sheet layout,
    one polite open announcement) — over `shell/CreditsList.tsx`, which now leads with the
    disclosure as its first line rather than showing it permanently on screen. `/credits` stays
    as a direct/bookmarkable route rendering the same `CreditsList`; nothing in the app links to
    it any more, since the panel is now the way in.
  - **Consequences.** VISUAL_SPEC §9 and DESIGN §1's non-goal wording no longer claim the
    disclosure is always on screen — it is one click/tap away instead, still shown before any
    credit. Neither section is marked NORMATIVE, so this amendment is the record of the decision
    rather than a contract change. `Panel` is meant to be reused for the next panel-shaped UI
    (an event detail popout) rather than a second bespoke dialog being built alongside it.

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

**Contract changes these later phases need (all additive).**
- `pipeline/shapes.py` `Event` and `web/src/types/layer.ts` `TimelineEvent`: optional
  `effect`. **Made (G5, GLOBE.md §6):** `GlobeEffect`/`GlobeEffectKind`/`EffectAnchor`/
  `EffectWindow` in `pipeline/shapes.py`, twinned in `web/src/types/layer.ts`; wired through
  `pipeline/manifest.py`/`pipeline/publish.py` into both `Manifest.events` and the new
  `globe-regimes` `dataKind: "events"` layer.
- `pipeline/models.py` `PlateSnapshot`: optional `plate_ids` / `plate_rotations`
  `RasterBlend` fields. Not made yet (G3/G4).
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
  - The target mix is pure in `t`. It runs a smoothstep across a band centred on each plate's
    divergence — half-way between the two plates at the exact instant the ancestor readout's
    label switches — reaching `MORPH_BAND_FRACTION / 2 = 0.125` of the log1p gap up into the
    older plate's span and the same fraction down toward the next younger plate (or the
    present). (Originally the band started at the divergence and ran the full `0.25` toward the
    present, which left the image at 100% the older plate for a while after the label had
    already switched; corrected 2026-09-14.)
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

**Amendment (2026-09-14): a zoom cap between neighbouring plates.** The morphs into and out of
`opisthokonta` burst outward and back instead of dissolving. Subject detection reads the whole
backdrop against the plate rim, so a microscope-style plate's dish rim, halo or vignette can
count as subject: `holozoa`'s ring framed it at span 0.98 against `opisthokonta`'s lone cell at
0.21. Normalising both to 70% fill baked a 4.5× zoom into the flow, and 95% of the plate moved
up to 2.1 plate widths; every other pair stays under 0.43.
- `compute_morph` now frames each pair as if both spans were pulled toward their geometric
  mean, at most `MAX_MORPH_ZOOM = 1.4` apart. Every other pinned pair was already within 1.33,
  so their fields are unchanged (within 0.002, byte rounding); the two bursting pairs drop to
  0.27 and 0.39.
- `refuse_bursting_flow` fails `earthtime morph` when a field's 95th-percentile displacement
  exceeds 0.6 plate widths, naming the pair, so a badly framed plate is caught before it ships.
- `MORPH_ALGORITHM_VERSION` is 2, so every cached morph recomputes.
- **Rejected: correcting subject detection instead.** A rule dropping hollow rings fixed
  `holozoa` but not `metazoa`, whose vignette disc is filled; the pair between them, matched
  only because both boxes were wrong the same way, then smeared. Fixing detection would reframe
  all 39 pairs at once; the cap bounds the one failure that is visible.

**Amendment (2026-09-14): publish normalises each plate's exposure.** The human found the Homo
sapiens plate hard to see in the lens: a dark-skinned figure, lit low, on the black field, "very
dark and should be brighter". Measured, the subject highlights of the 40 pinned plates spread 2×
on the statistic below (sapiens 107 to holozoa 210; about 4× on a mid-tone measure). Most
vertebrate and hominin plates were under-exposed and the microscope plates were not, so no single
viewer-wide curve could serve both.
- **Statistic.** `pipeline/exposure.py`, Pillow only, because publish must run without the
  `morph` extra.
  - Luma at 256 px. The backdrop is a 41 px morphological opening of it, which keeps the
    vignette's glow and drops the organism.
  - Subject pixels are more than 10 codes above that backdrop, inside a central disc of radius
    0.42, so dish rims and vignette edges don't count.
  - The highlight is the subject's 95th-percentile luma code.
- **Curve.** Per pixel, one factor for all three channels, in gamma-2.2 linear light (the
  shader's blend space), so every pixel keeps its hue and saturation.
  - The factor is read from the pixel's brightest channel: the shoulder g·x / (1 + (g − 1)·x),
    which reaches 1 only at white, so no channel clips. Below code 16 it blends in from the
    identity by a smoothstep, so near-black and its JPEG noise keep their depth.
  - It fades in over the first 20 codes by which that channel stands above the backdrop (the
    same opening, taken of the brightest channel). The glow behind the subject is the backdrop,
    so it keeps its level and grain, and the lift draws no outline around the subject.
  - g lands the highlight on `TARGET_HIGHLIGHT = 160`, where the fossil fish and microscope
    plates already sit. It is capped at `MAX_GAIN = 3.5` and never goes below 1. A grey highlight
    lands exactly; a coloured one lands a few codes short (144–159 measured), because its
    brightest channel sits above its luma.
  - Tested: a grey code is monotonic, never darker, and keeps 0 and 255; the brightest channel
    never clips; a dark coloured pixel keeps its channel ratios; the glow beside a subject moves
    at most 3 codes.
- **Where: a publish-time derivative, not a viewer gain.** `earthtime publish` writes the
  normalised plate to `data/media/portraits/<id>.<ext>` from the untouched pinned candidate.
  - Format: JPEG at quality 100 with the source's chroma subsampling; PNG stays PNG. At gain 1
    the file is the pin byte for byte.
  - The viewer draws the file. The WebGL morph (uAlpha 0 and 1) and the no-WebGL crossfade draw
    the same pixels, and a mid-morph frame blends plates that are already normalised.
  - That was not true when this amendment was first written. Since the portrait renderer landed,
    `portraitTextures.ts` tagged plates `SRGBColorSpace`, so the GPU decoded them to linear
    light, and the shader wrote the texel out without encoding it again. Every WebGL plate showed
    at about (code/255)^2.2, a large part of what the human saw. Plates now upload with
    `NoColorSpace`, and the shader's own transfer applies only to the blend. On settled plates
    at 1440×900, the centre-disc mean of WebGL and the `<img>` fallback now agree within 1 code
    (`homo-sapiens` 32.0 against 31.4; the double decode predicts 5.1).
  - Morph fields are unaffected. `earthtime morph` still reads the pinned originals, keyed by
    pin digests and `MORPH_ALGORITHM_VERSION`. Exposure moves no pixel, so flows and subject
    boxes are unchanged and no morph recomputes.
  - Pins are untouched (ADR-005), and `pinned` still names the original.
- **Contract addition (additive).**
  - The lineage layer file's `PortraitPlateData` gains `exposure: {highlight, gain}`.
    `highlight` is null when no subject stands out, and such a plate publishes unchanged.
  - `web/src/data/curated.ts` parses the field when present and accepts its absence (older layer
    files), refusing a gain below 1.
  - `PortraitPlate` in `web/src/types/layer.ts` is unchanged: the viewer never needs the number.
- **Result.** 31 plates brightened (gain 1.02–3.22). 9 are unchanged: the 5 microscope plates,
  `catarrhini`, `sarcopterygii`, `osteichthyes` and `metazoa`. The media churn is a one-off
  rewrite of 31 LFS JPEGs of similar size (ADR-018). Publish takes about 10 s longer.
- **Rejected: one LUT per channel with a toe below code 40 (this amendment's first version).**
  - Dark subjects straddle the toe, so their channels took different gains and shifted hue:
    `homo-sapiens` shadows went from R/G 0.876 to 0.815, and subject saturation from 0.26 to 0.33.
  - The toe also left dark bodies mostly un-gained.
  - Above the toe, the glow behind the subject (codes 25–40) took nearly the full gain:
    `primates` rose from 39 to 54.
- **Rejected: weighting the gain by a feathered subject mask.** Inside the mask the glow lifted
  and outside it did not, which drew a halo in the subject's silhouette.
- **Rejected: a per-plate gain in the viewer.** It would need a published number, a shader
  uniform per plate and a CSS filter for the crossfade. CSS `brightness()` scales encoded sRGB,
  so the two render paths would no longer match, all to do what one deterministic file does.
- **Rejected: lifting the backdrop.** A specimen on a black field is the register (VISUAL_SPEC
  §10). The field and the glow keep their level: their medians stay within 3 codes of the pin.
- **Limit.** Normalisation cannot add light the generator never gave. `homo-sapiens` (gain
  3.22) and `hominini` (3.07) remain the darkest plates. Their subject medians rise from 28 to 45
  and from 32 to 53.
  Regenerating them with a brighter key light is the human's call; nothing was regenerated.

**Amendment (2026-09-15): incoherent pairs dissolve instead of tangling; the scale bar is
excluded from flow estimation; pose-divergent pairs smooth harder.** Portrait QA flagged four
mid-transition frames showing two offset bodies or tangled limbs, and the scale bar warped into
a hook or squiggle: `boreoeutheria` → `euarchontoglires`, `haplorhini` → `catarrhini`, `holozoa`
→ `metazoa`, `homininae` → `hominini`.

- **Diagnosis, per pair, on the algorithm as it shipped (v2).** Four numbers: 95th-percentile
  flow displacement (plate widths, the existing `refuse_bursting_flow` statistic); mean
  round-trip error of the forward field composed through the backward field, over the whole
  frame (an FB-consistency check `pipeline.morph` did not previously compute); `pose_divergence`
  — the new `abs(log(older.aspect / younger.aspect))` statistic, 0 for identically-shaped subject
  boxes; and the scale-bar region's mean displacement as a ratio of the rest of the frame's.

  | pair | flow p95 (fwd/bwd) | round-trip error (fwd/bwd) | pose divergence | bar-region ratio (fwd/bwd) |
  |---|---|---|---|---|
  | `boreoeutheria`→`euarchontoglires` | 0.43 / 0.25 | 0.194 / 0.161 | 0.775 | 0.42 / 1.30 |
  | `haplorhini`→`catarrhini` | 0.16 / 0.17 | 0.060 / 0.080 | 0.332 | 2.20 / 1.06 |
  | `holozoa`→`metazoa` | 0.19 / 0.09 | 0.056 / 0.054 | 0.0 | 2.44 / 1.13 |
  | `homininae`→`hominini` | 0.21 / 0.23 | 0.061 / 0.067 | 0.366 | 1.02 / 0.82 |

  A bar-region ratio away from 1 (`holozoa`, `haplorhini`) confirms the bar itself is moving
  differently from the rest of the frame — consistent with the reported hook/squiggle. The other
  three numbers tell three different stories, not one:
  - `boreoeutheria`→`euarchontoglires` is a large, genuinely divergent pose (0.775, four times
    the next worst) **and** incoherent (round-trip error far above every other pair measured,
    including the four in this table) — flow magnitude and disagreement agree it is the worst
    pair.
  - `haplorhini`→`catarrhini` and `homininae`→`hominini` have moderate pose divergence and
    moderate round-trip error — not outliers on any one number, but the combination reads as
    tangled limbs in the rendered frame.
  - `holozoa`→`metazoa` has **zero** pose divergence (both boxes come out square) but is still
    visibly doubled. Its subject box span is 0.98 — the same near-full-frame span the original
    zoom-cap amendment measured for `holozoa` against `opisthokonta` ("the ring framed it… at
    span 0.98"), here independent of which neighbour it pairs with: `holozoa`'s own radiating
    filaments inflate its box regardless of partner, so a shape-based (aspect) statistic cannot
    see this failure mode at all.
  - Two of the four also have an **inflated subject box** feeding bad numbers upstream of flow
    estimation entirely. `homininae`'s detected box is `(0.03, 0.03)`–`(0.97, 0.97)` in analysis
    coordinates — 69% of the frame thresholded as "subject" — because its backdrop is very dark
    and very clean (border median 1, MAD 1), which floors `detect_subject_box`'s threshold at
    `MIN_CONTRAST = 18` (an absolute code value, not scaled to the vignette's own radial falloff)
    while the vignette's natural glow already reads 26 at frame centre with no subject there at
    all. `boreoeutheria`'s box similarly overshoots: its detected bottom (0.82) sits well below
    where the animal's paws visibly end in the source plate (≈0.61–0.62), which is why its own
    scale bar sits *above* the detected box rather than below it.

- **Decision — three complementary, additive changes to `pipeline/morph.py`,** none of which
  individually would have covered all four pairs (see above):

  1. **Scale-bar exclusion by known layout, not detection.** `PORTRAIT_STYLE` places the bar "a
     thin, pale grey horizontal scale bar… below the subject, left of centre" — a fixed
     compositional rule, not something that needs to be found in the pixels. Detecting it by
     contrast was tried and measured unreliable: on the pinned corpus, thresholding plus a
     horizontal morphological opening (wide enough to keep a bar and drop noise) found nothing
     in over half the plates spot-checked — the bar is too faint or too thin at generation size
     to survive it. `scale_bar_band(box)` instead returns a fixed band under the subject's own
     detected box (`SCALE_BAR_BAND_ABOVE = 0.08`, `SCALE_BAR_BAND_BELOW = 0.15` plate-UV above
     and below `box.bottom`, `SCALE_BAR_BAND_RIGHT_MARGIN = 0.2` past the box's own horizontal
     centre). `erase_band` paints it out (at the plate's own backdrop level) before DIS ever
     sees it, so it cannot pollute correspondence for the real subject nearby either; `zero_band`
     additionally zeroes the *composed* field there, so nothing under the band ever warps even
     if a sliver of the bar survived normalisation at the band's edge. The "above" margin is
     deliberately modest: reaching further would start eating real subject content for a
     compact subject, and a box inflated enough to put the true bar further above its own
     bottom edge (`homininae`, `boreoeutheria`, above) is already incoherent enough to dissolve
     on its own, where the band's precision stops mattering.
  2. **Pose-divergent pairs get more smoothing, not the same fixed kernel.** `SubjectBox` gains
     an `aspect` property (height/width); `pose_divergence` is `abs(log(older.aspect /
     younger.aspect))`, symmetric in which plate is older. `flow_smoothing_sigma` widens
     `normalised_flow`'s Gaussian kernel by up to `POSE_DIVERGENCE_SMOOTHING_GAIN = 3.0`×,
     capped at `MAX_FLOW_SMOOTHING_SIGMA = 16.0` (the unmodified sigma is 6.0). A squat,
     off-centre subject and a large, centred one cannot be reconciled by DIS's local
     correspondence at a sharp kernel — coherent bending needs to trade fine detail for
     agreement, not fight for a precise match that does not exist.
  3. **A pair whose flow is still incoherent after (1) and (2) dissolves instead of shipping.**
     `inverse_consistency(forward, backward, region, size)` composes the forward field through
     the backward field and measures how far the round trip lands from identity, restricted to
     `region` (each plate's own subject box — the whole-frame statistic above is diluted by a
     mostly-flat, near-zero-flow backdrop and was measurably less sensitive). `compute_morph`
     takes the worse of the two directions; past `MAX_INVERSE_CONSISTENCY = 0.038` it zeroes
     both fields and reports `PlateMorph.fallback_dissolve = True`. A zeroed field is not a
     special case for the viewer: `olderUv = vUv - uAlpha * flowAt(...)` with an all-zero field
     is exactly `vUv`, so the WebGL shader already renders it as the plain linear-light
     crossfade `PORTRAIT_FRAGMENT_SHADER` uses when `uHasFlow` is unset — no shader change.
     `write_morph` still writes both (tiny, all-zero) PNGs and the record for inspection, but
     `pipeline.publish._portrait_morphs` treats a `fallback_dissolve` pair exactly as if
     `earthtime morph` had not run for it yet: no `PortraitMorphData` entry, no files copied.
     This reuses the contract this ADR already established rather than adding a new one — "A
     plate without a pin, or a pair without a morph, degrades gracefully… crossfades" — so
     `web/src/data/curated.ts` and `web/src/types/layer.ts` need no change. The one difference
     from a genuinely missing morph: `earthtime publish` reports it as a `note`, not a
     `WARNING`, and `earthtime morph`'s cache means it is never silently mistaken for
     unfinished work (`portraits.dissolved_morphs` in `PortraitPublication`, distinct from
     `missing_morphs`).

- **`MORPH_ALGORITHM_VERSION` is now `3`.** Every cached morph recomputes; `earthtime morph`
  reports each pair as computed or dissolved.

- **Calibration of `MAX_INVERSE_CONSISTENCY`.** Measured against all 39 pinned-adjacent pairs,
  through the shipped pipeline (band excluded, adaptive smoothing applied), the subject-box
  round-trip statistic above: 23 pairs cluster at or under 0.035, then one real gap
  (`osteichthyes`→`sarcopterygii` 0.0349, `holozoa`→`metazoa` 0.0407), then 16 pairs from 0.041
  up to 0.186. `MAX_INVERSE_CONSISTENCY = 0.038` sits in that gap: it is the loosest threshold
  that still catches all four reported pairs, and no threshold catches only those four — the
  metric does not rank-order visual severity precisely enough for that (see Limit, below). The
  16 that dissolve: `boreoeutheria`→`euarchontoglires` (0.186, worst by a wide margin),
  `placentalia`→`boreoeutheria`, `opisthokonta`→`holozoa`, `archaeal-host-lineage`→`leca`,
  `luca`→`archaeal-host-lineage`, `haplorhini`→`catarrhini`, `olfactores`→`vertebrata`,
  `homininae`→`hominini`, `chordata`→`olfactores`, `primates`→`haplorhini`,
  `gnathostomata`→`osteichthyes`, `synapsida`→`therapsida`, `mammalia`→`theria`,
  `homo-heidelbergensis`→`homo-sapiens`, `sarcopterygii`→`tetrapodomorpha`, `holozoa`→`metazoa`.
  `hominidae`→`homininae` (0.0379) stays just under and keeps a real morph, as does every
  microscope-plate pair among the earliest nodes except the three named above.

- **Rejected: fixing `detect_subject_box`'s threshold directly.** The vignette-glow inflation
  behind `homininae` and `boreoeutheria`'s bad boxes (Diagnosis, above) is a real bug, but fixing
  it — scaling `MIN_CONTRAST` to the vignette's own radial falloff rather than a flat code value
  — would reframe every one of the 39 pairs at once, the same objection the original zoom-cap
  amendment raised against "correcting subject detection instead" for `holozoa`. The dissolve
  fallback already catches a badly-boxed pair's consequence (incoherent flow) without needing to
  diagnose or fix its cause; a `detect_subject_box` fix, should the human want one, is a
  separate, standalone change with its own review, not a rider on this one.
- **Rejected: detecting the scale bar by contrast or shape instead of a known-layout band.**
  Measured unreliable (Decision 1, above) — too faint or thin to survive thresholding in over
  half the corpus spot-checked, including three of the four reported pairs' own plates.
- **Rejected: a single flow-magnitude (p95 displacement) threshold as the dissolve trigger.**
  It measures how far things moved, not whether forward and backward correspondence agree on
  where. `homo-heidelbergensis`→`homo-sapiens`, which reads as a clean single-figure transition,
  reaches 0.36 backward p95 — higher than every one of the four reported pairs' own worst
  direction. A large but *coherent* pose change and a smaller but *tangled* one cannot be told
  apart by magnitude alone.
- **Rejected: the round-trip statistic over the whole plate rather than each subject's own box.**
  A typical plate is mostly flat, near-zero-flow backdrop; averaging over all of it diluted the
  signal from a badly-behaved subject region enough to blur the gap the threshold now sits in.
- **Rejected: a photometric "ghosting score"** — mean pixel disagreement between the two plates
  each half-warped to the midpoint, in the same output frame the shader itself produces. Tried
  because it measures the visible symptom directly rather than a proxy in flow space, but it
  did not separate the four reported pairs from clearly fine ones either: a translucent
  microscope subject's radiating filaments (`luca`→`archaeal-host-lineage`) scored worse than a
  solid, genuinely doubled quadruped body, because thin low-contrast structures always disagree
  a little at their edges without ever reading as "two bodies." The subject-box round-trip
  statistic, while still an imperfect proxy (below), was the most defensible of everything
  tried.

**Limit.** No statistic tried ranks all 39 pairs in exact agreement with how each one actually
looks. `MAX_INVERSE_CONSISTENCY` is calibrated to catch the whole shoulder the four reported
pairs sit in rather than to draw a perfect line — the deliberate choice, given a false positive
(a fine pair loses its warp and shows a clean crossfade instead) costs far less than a false
negative (a bad pair keeps shipping the reported defect). The known cost: `homo-heidelbergensis`
→`homo-sapiens` measured 0.0422, just past the threshold, despite reading as a clean single-figure
transition in the QA screenshots taken for this amendment — it now dissolves too. The other
eleven pairs in the dissolved group were not individually visually re-verified; several sit at
lineage nodes with historically awkward framing (`opisthokonta`, `holozoa`, the earliest
microscope-plate transitions the original ADR's zoom-cap amendment already found fragile), so a
conservative dissolve there is plausibly correct rather than merely cautious, but this amendment
does not claim to have confirmed each one by eye.

**Consequences.**
- 23 of 39 pairs keep a computed, warped morph; 16 dissolve. Every one of the four queue-reported
  pairs is in the dissolved group, so the reported defect (doubled bodies, tangled limbs, a
  warped scale bar) cannot appear in the viewer for them: a dissolved pair's fields are
  identically zero, which the shader already renders as `PORTRAIT_FRAGMENT_SHADER`'s plain
  linear-light crossfade.
- Media churn: 23 morph PNG pairs (46 files) recomputed under the new algorithm; the 16 pairs
  that now dissolve are no longer part of the publication, so `earthtime publish` no longer
  copies their PNGs into `data/media/portraits/morphs/` or lists them in `lineage.json`'s
  `portraits.morphs`. The now-unpublished v2 files for those 16 pairs (32 files) are left as
  orphans in the working tree by this change — `pipeline.publish.write_publication` has never
  pruned media no longer referenced by a fresh publish, for scenes or portraits alike, which
  predates this amendment and is out of scope for it; noted here so the churn is not mistaken
  for an oversight.
- No contract change reaches the web side: `PortraitMorphData`, `curated.ts` and `layer.ts` are
  unchanged, because a dissolved pair reuses the "no morph yet" path this ADR already specified.
  `MorphRecord.fallback_dissolve` (pipeline-only, the cache and CLI reporting) is the only new
  field.
- Pins are untouched (ADR-005): this amendment changes only derived, deterministic morph data,
  never a pinned image or `data/portraits.yaml`.

**Amendment (2026-09-16): the scale-bar band anchors on a vignette-robust extent, not
`detect_subject_box`; the dissolve gate measures the same extent; two pairs the statistic cannot
catch dissolve by an explicit list.** QA on the 2026-09-15 amendment (queue item 14, portrait
morph QA round 2) found the scale-bar band it introduced anchored on the wrong thing and, on two
pairs, erased real anatomy — a regression this amendment fixes — and that the dissolve gate it
calibrated missed a pair that reads as visibly ghosted.

- **Diagnosis.** `detect_subject_box`'s box is not merely wrong on the two plates the original
  amendment named (`homininae`, `boreoeutheria`) — it is inflated on most of the pinned corpus.
  Its threshold is a single value above the plate's own *rim* code; a strong vignette's own
  central glow clears that threshold long before any real subject does, so the box swells toward
  the frame's edge on plate after plate. Measured directly: `amniota`'s box bottom sits at 0.92 in
  plate UV while the lizard's real belly sits around 0.6; `tetrapoda` similarly at 0.94 against a
  real bottom near 0.68. A band anchored on `box.bottom ± SCALE_BAR_BAND_*` inherits that error
  twice over — it misses the true bar on most plates (QA measured it outside the band on 27 of
  40), and on plates where the inflated box happens to reach far enough, the band's own upper
  margin lands *inside* real anatomy. Two pairs rendered visibly worse than the algorithm this
  amendment replaces as a direct result: `theria` → `eutheria` (ghost legs and a doubled tail at
  mid-transition) and `leca` → `opisthokonta` (a hard-edged ghost lobe beside the cell), both
  confirmed live in WebGL by QA and reproduced here before the fix. The same inflation also
  explains why `pose_divergence` read `holozoa` → `metazoa` as perfectly square-to-square
  (zero divergence) despite a visibly doubled render: both boxes were inflated toward the frame's
  own aspect, not the subjects'. Separately, the dissolve gate's round-trip statistic — measured
  within `detect_subject_box`'s box — is diluted by that same inflation on most pairs, the same
  failure mode the original amendment already rejected a whole-frame statistic for, just arrived
  at by a different route; `metazoa` → `eumetazoa` (QA evidence: a torn, translucent ghost at
  mid-transition, reproduced here) scores 0.0365, comfortably under any threshold that does not
  also dissolve pairs that render cleanly.

- **Decision.**
  1. **A second, vignette-robust subject extent, `bar_search_extent`, anchors the scale-bar band
     and gates the dissolve statistic — `detect_subject_box` keeps doing everything else.**
     `pipeline.exposure.subject_mask` (promoted from private to a public function; `measure_highlight`
     now calls it too, so the two publish-time normalisations share one subject-detection routine
     instead of two) compares each pixel to a *local* backdrop — a wide morphological opening,
     not a single frame-corner value — so a vignette's glow reads as backdrop wherever it falls
     instead of inflating the mask. It is already calibrated against the full pinned corpus for
     exposure normalisation; reusing it here needed no new tuning. Measured against the same four
     plates: `amniota`'s extent lands at 0.67, `tetrapoda`'s at 0.68 — both close enough to the
     real subject that `SCALE_BAR_BAND_*`'s fixed margins (widened slightly, 0.08→0.10 above,
     0.15→0.16 below, to the largest offset measured on a small sample) bracket the true bar on
     every plate checked. `detect_subject_box` is untouched and still drives framing, zoom
     (`bounded_fills`/`Framing.centring`) and pose-divergence smoothing exactly as before — this
     is deliberately not the rejected "fix `detect_subject_box`" alternative from either earlier
     amendment: nothing about how a plate is cropped or zoomed changes, only where the bar gets
     excluded and which region the dissolve gate reads.
  2. **`erase_band` and `zero_band` take `bar_search_extent`'s own mask and never touch a pixel it
     calls subject, regardless of where the band geometrically falls.** This is the actual fix for
     the regression, independent of anchor accuracy: even a badly-placed band can no longer erase
     anatomy, only backdrop. `zero_band`'s edge is now feathered (`ZERO_BAND_FEATHER_SIGMA`, a
     Gaussian over the band indicator) rather than a hard cutoff, so the band's own boundary
     cannot tear the field — the subject clip is still exact (applied to the alpha *after*
     feathering), since that boundary is a real content edge, not a seam.
  3. **The dissolve gate's `inverse_consistency` region is `bar_search_extent`'s box, not
     `detect_subject_box`'s**, for the same dilution reason the whole-frame statistic was already
     rejected for. Recalibrated against all 39 pairs through the fixed pipeline: scores run 0.007
     to 0.038 with no clean gap, then `gnathostomata` → `osteichthyes` at 0.0397, then 0.041 up to
     0.177. `MAX_INVERSE_CONSISTENCY = 0.039` sits just under that first pair — 20 pairs stay a
     real, coherent morph; 18 dissolve. Every pair whose verdict *changed* from the previous
     calibration, plus `gnathostomata` → `osteichthyes` itself and three previously-kept pairs
     spot-checked as a regression guard, were rendered live in the running viewer and confirmed
     by eye (16 pairs total, below); the rest of the unchanged majority — mostly pairs that were
     already dissolving before this amendment and still do — were carried on the statistic alone,
     the same practice the 2026-09-15 amendment used for its own unverified majority.
  4. **`metazoa` → `eumetazoa` dissolves by an explicit `FORCED_DISSOLVE_PAIRS` list, not the
     statistic.** At 0.0365 it sits inside the clean cluster, yet renders as a torn, translucent
     ghost at mid-transition (QA evidence, reproduced here) — the same failure mode the round-trip
     statistic already struggled with in the original amendment's "Limit" section (a translucent,
     radially-symmetric microscope subject disagrees with its neighbour just enough, everywhere,
     to read as visible ghosting without concentrating into a high round-trip error anywhere). No
     threshold separates it from the clean cluster without also dissolving several genuinely fine
     pairs, so it is listed by id instead and `write_morph` forces the dissolve regardless of what
     `compute_morph` measured. The previous track's report named this pair as one of four
     "previously-good" pairs that must not regress; that characterisation was wrong; it was never
     clean, and this amendment corrects it rather than preserving it.
  5. **`MORPH_ALGORITHM_VERSION` is now `4`.** Every cached morph recomputes.

- **Recalibration changed the published set beyond the four originally reported pairs and the two
  QA-flagged ones.** Three pairs the 2026-09-15 amendment dissolved now keep a real morph —
  `mammalia` → `theria` (0.0204), `sarcopterygii` → `tetrapodomorpha` (0.0309), and `holozoa` →
  `metazoa` (0.0340), one of the four originally reported pairs, now genuinely fixed by the band
  correction rather than merely hidden behind a dissolve — all three rendered live in the viewer
  and confirmed a single coherent body. Five pairs newly dissolve: `hominidae` → `homininae`
  (0.0408), `catarrhini` → `hominoidea` (0.0452), `eutheria` → `placentalia` (0.0424), `eumetazoa`
  → `bilateria` (0.0834), and `metazoa` → `eumetazoa` (forced) — all five rendered live and
  confirmed doubled or ghosted before being accepted into the dissolved set. `gnathostomata` →
  `osteichthyes`, the new threshold's anchor pair, was also rendered live and confirmed doubled.
  `homo-heidelbergensis` → `homo-sapiens`, the previous amendment's named "conservative false
  positive" at 0.0422, was rendered live too: it now scores 0.0794, comfortably inside the
  dissolved group rather than borderline, so that characterisation no longer holds — it dissolves
  because it is genuinely incoherent under the fixed pipeline, not as a defensible over-caution.
  Three kept pairs the previous amendment called out as good — `tetrapodomorpha` → `tetrapoda`,
  `hominini` → `australopithecus`, `osteichthyes` → `sarcopterygii` — were spot-checked live as a
  regression guard and confirmed unchanged and coherent. The other twelve dissolved pairs and
  fourteen of the remaining kept pairs carry an unchanged verdict from the previous calibration
  and were not individually re-rendered for this amendment; final set: 20 real morphs, 19
  dissolved.

- **Rejected: fixing `detect_subject_box` itself.** Still rejected, now for a better-understood
  reason than either earlier amendment had: the inflation this amendment diagnosed is not
  confined to a couple of plates, so a fix would reframe most of the 39 pairs at once, not the
  bounded few the earlier amendments discussed. `bar_search_extent` gets the two properties that
  actually matter here — an accurate anchor for the band, and an undiluted region for the dissolve
  gate — without touching framing at all.
- **Rejected: a silhouette-mask IoU or similar new photometric statistic for the dissolve gate,**
  as the QA report suggested. The original amendment already tried and rejected a photometric
  ghosting score for the same reason it would fail again here: a translucent microscope subject's
  edges disagree with its neighbour's a little everywhere without concentrating anywhere, which is
  exactly what defeated the round-trip statistic for `metazoa` → `eumetazoa` too. An explicit,
  narrow, visually-verified override list is more honest about the gate's actual limit than
  another metric tuned to paper over the same blind spot.
- **Rejected: dropping `erase_band`/`zero_band` and handling the bar only in the shader.** The
  bar's plate-UV position varies by subject shape (a low reptile's bar sits far higher in the
  frame, relative to its own subject, than a standing biped's), so there is no fixed screen
  location a shader-side mask could use without the same per-plate anchor this amendment already
  computes; moving the exclusion to render time would not remove the need for `bar_search_extent`,
  only relocate where it is applied, at the cost of a shader change ADR-015 has otherwise avoided
  throughout.

**Limit.** `bar_search_extent`'s margins were checked against four plates measured by hand, not
all 40; `erase_band`/`zero_band`'s subject clip is the actual safety net (a band overshoot now
only ever costs precision, never anatomy), so an unmeasured plate degrades gracefully rather than
regressing. The round-trip statistic still does not rank-order visual severity precisely — it is
recalibrated, not perfected — and `FORCED_DISSOLVE_PAIRS` is a named, visually-justified admission
of that limit for one pair rather than a claim the statistic now works everywhere. 16 of the 39
pairs were individually re-verified by rendering the actual mid-transition frame in the running
viewer, not the statistic alone — every pair whose verdict changed (the four originally reported,
the two QA-flagged where distinct, the three restored, the five newly dissolved, with overlap
between these groups), the new threshold's anchor pair (`gnathostomata` → `osteichthyes`), and
three unchanged-kept pairs as a regression guard. The remaining 23 pairs, mostly ones that were
already dissolving before this amendment and still do, were carried on the statistic and the same
reasoning the 2026-09-15 amendment used for its own unverified majority.

**Consequences.**
- 20 of 39 pairs keep a computed, warped morph; 19 dissolve (18 by threshold, 1 forced). Cached
  morphs and their published files fully recompute (`MORPH_ALGORITHM_VERSION` 3→4).
- `pipeline/exposure.py` gains one public function, `subject_mask`; `measure_highlight` is
  refactored to use it (behaviour-preserving — `tests/test_exposure.py` passes unchanged).
- Media churn: 20 morph PNG pairs (40 files) published under the new algorithm. 66 unreferenced
  files were measured in `data/media/portraits/morphs/` before this change (the previous
  amendment's own orphans from algorithm versions 1-3, undercounted there as 32 — the actual
  figure was 60 — plus this amendment's own churn); all are deleted as part of this change,
  leaving exactly the 40 currently-published files, rather than left for a future cleanup.
  `pipeline.publish.write_publication` still does not prune stale media on its own, which remains
  out of scope for this amendment.
- No contract change reaches the web side, same as the previous amendment: the shader, `curated.ts`
  and `layer.ts` are unchanged.
- Pins are untouched (ADR-005): this amendment changes only derived, deterministic morph data.
- Two small robustness fixes, unrelated to the band or the gate: `inverse_consistency` now raises
  on a region with no matching texel instead of silently falling back to the whole-frame
  statistic (the exact dilution this amendment's own point 3 removes elsewhere), and
  `normalised_flow`'s `sigma` is a required parameter — `compute_morph` was already its only
  caller and always passed one explicitly.
- `tests/test_portraits.py` gains a publish-time test for the dissolved-pair branch
  (`test_publish_skips_a_dissolved_morph_and_lists_it_separately`), alongside the existing
  computed-morph one it was missing a counterpart for.

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

**Amendment (2026-09-14) — the dead zone is replaced by pointer-coupled movement.** User report:
"I'll be slowly approaching an event marker I want to select but then it will jump and skip past
it, instead of a steady smooth progression along the timeline." Root cause: the dead zone held
the lens still while the pointer moved within `FISHEYE_DEADZONE_PX` of its centre, then eased it
toward the pointer *over time* (`FOLLOW_TIME_CONSTANT_S`) once the pointer left that zone. That
catch-up ran on a timer, not on the pointer's own motion — so re-centring could keep moving the
lens, and with it the time sitting under an already-*stationary* pointer, for several more frames
after the gesture that triggered it. Around a 1440px track that moved the lens from ~10 undistorted
px past the old focus to ~48 undistorted px past it in about 0.3s: several markers sliding past
the pointer even though the pointer itself had stopped, which read exactly as "skip past it."
`fisheye.ts` replaces the dead zone with a lens that moves *only* in direct response to pointer
movement, never on its own: `moveFisheyeLens(motion, fromPointerU, toPointerU, trackWidthPx)`
advances the centre by a coupling factor (0 at the centre, smoothstep-rising to 1 at
`FISHEYE_COUPLING_RADIUS_PX` — the renamed, reinterpreted `FISHEYE_DEADZONE_PX`) times the
pointer's own delta, integrated in ≤1px substeps so the result does not depend on how many
pointer events a move arrives as, then clamped to the radius. A stationary pointer therefore never
moves the lens, however much time passes, and a slow sweep changes the time under the pointer
continuously and monotonically rather than in a late, oversized step. The previously combined
`stepFisheye` (position *and* strength, gated by a `following` flag) splits along that same line:
`moveFisheyeLens` is pointer-driven and synchronous — `useFisheye`'s `pointTo` calls it directly,
no rAF involved — while `stepFisheyeStrength` remains the one genuinely time-driven piece (the
fade in/out) and keeps the `requestAnimationFrame` loop. `FisheyeMotion`'s `following` field and
`FOLLOW_TIME_CONSTANT_S`/`SETTLE_PX` are gone with it; `isFisheyeSettled` now checks strength
alone. No consumer outside `timeline/fisheye.ts`/`useFisheye.ts` changed: `Timeline.tsx` and
`ScrubTrack.tsx` still see the same `pointTo(u, trackWidthPx)`/`release()`/`lens`/`trackWidthPx`
surface from `useFisheye`.

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

## ADR-019 — Scene pips cluster instead of stacking; events declutter by room instead of a span floor

**Status:** accepted — human-directed 2026-09-14.

**Context.** Three pieces of feedback on the fisheye-stretched track (ADR-017), all pointing at
the same underlying problem — the track's static, non-interactive layout wasn't leaving enough
of what it drew reachable:

1. "Having event markers stacked vertically like this looks strange, maybe best to keep them
   clustered and then can be expanded on hover (using fisheye approach)" — scene checkpoint pips,
   which `checkpointLayout.ts` staggered into up to `MAX_PIP_ROWS` (4) vertical rows whenever two
   sat within `MIN_PIP_SEPARATION_PX` of each other. A cluster of pips reading as a small
   staircase, rather than as one group, looked unintentional rather than designed.
2. "I can see an event entry for 'oldest known stone tools' and others when hovering on the
   timeline but they don't show as markers" — `lod.ts`'s `minImportanceForSpan` set a single
   importance floor from the visible span alone: at full zoom-out (span = the full 4.6 Gyr
   domain) the floor sits near 1, so with ~66 events and only a handful at importance 1.0, most of
   the axis rendered empty even though the events were real, dated and inside the window — they
   just hadn't cleared a threshold that had nothing to do with whether they'd actually collide
   with anything on screen.
3. QA: at the present end, the edge-aligned "present" tick label overlapped its neighbour ("1 ka"
   / "present"). `ticks.ts`'s collision checks (`hasOverlap`, `symlogTicks`'s accept loop) assumed
   every label was centred on its own tick position, but `tickLabelAlign` right-aligns "present"
   (and left-aligns the oldest tick) so it never overhangs the track edge — the collision math
   and the render math disagreed about where "present"'s label actually sat.

**Decision.**
- **Scene pips cluster, they don't stack.** `checkpointLayout.ts`'s `layoutCheckpointPips` no
  longer assigns rows. It single-link (chain) clusters consecutive *displayed* positions
  (`scale.toUnit(t) × trackWidthPx`) closer than `MIN_PIP_SEPARATION_PX` (unchanged, 8px) into one
  `CheckpointClusterLayout` — same diamond language as a lone pip, sized up, with a small count
  badge, no panel. A cluster's hover preview lists its members' times and captions (capped at
  `CLUSTER_PREVIEW_MAX_ITEMS`, "+N more" beyond that); clicking it frames the members' combined
  `[tMin, tMax]` span via a new `onFrameCluster` prop threaded through `Timeline` (mirroring
  `onFrameEvent`, reusing `frameEventWindow`/`animateWindowTo`). A checkpoint is never dropped,
  only merged — `MAX_PIP_ROWS` and the row-stagger math are gone outright, not deprecated
  alongside the new path. Layout runs on whatever scale the caller passes; `ScrubTrack` passes the
  fisheye-distorted `trackScale` (ADR-017), so hovering near a cluster stretches its members apart
  until they cross the separation threshold and resolve back into individual pips — no separate
  "expand on hover" affordance needed, the fisheye lens already does exactly that job.
- **Events declutter by room, not by a span-derived importance floor.** A new pure function,
  `declutterEvents` (`timeline/declutter.ts`), replaces `ScrubTrack`'s per-event
  `minImportanceAt`/`FADE_BAND` opacity ramp: every event overlapping the window is a candidate,
  processed importance-descending (ties: narrower band first, then `id`, for a deterministic
  result), and accepted unless its displayed band — widened to `MIN_EVENT_MARKER_PX` — comes
  within `MIN_EVENT_GAP_PX` of an already-accepted band. Importance now only breaks a collision
  between two events that would actually overlap on screen; an event with room to itself always
  draws regardless of how low its importance is, which is what feedback point 2 asked for
  directly. `lod.ts`'s `minImportanceForSpan`, `minImportanceAt` and `visibleEvents` are deleted
  outright (checked against every consumer first — nothing outside `web/src/timeline` referenced
  them; `web/src/app/Experience.tsx` imports only `Timeline` and unrelated helpers from this
  package). `ScrubTrack.module.css` gets a cheap CSS `animation` fade-in on `.eventBand` mount in
  place of the old importance-driven opacity ramp — appearance only; there is no equivalent cheap
  exit fade, since React unmounts a departing band immediately, and adding one would need more
  than "cheap" CSS.
- **Stepping is unaffected by declutter.** `nearestNeighbourEvent` (`lod.ts`) now reads every
  event overlapping the window directly rather than `visibleEvents`' LOD-filtered subset, and
  drops the `spanYears` parameter that computation needed — a keyboard or transport user must
  always be able to reach an event that currently lost a room collision against a
  higher-importance neighbour. `nearestStepTarget` (`checkpoints.ts`) and its callers (`Timeline`'s
  step handler, `Transport`'s back/forward buttons) drop `spanYears` too, since nothing downstream
  of them needs it any more. `ScrubTrack`'s double-click frame hit-test and the hover-readout snap
  (`snap.ts`) keep reading the *drawn* (decluttered) set, since both are about what's visibly under
  the cursor, not what exists — the same event/decluttered-set split feedback point 2 asked for is
  exactly what already distinguishes "reachable by stepping" from "drawn."
- **Tick collision now accounts for label alignment.** `ticks.ts` gains `labelBoundsPx(u, label,
  trackWidthPx)`, which resolves a tick's actual rendered `[left, right]` bounds through
  `tickLabelAlign` (`'start'`/`'center'`/`'end'`) instead of assuming a centred half-width. Both
  `hasOverlap` (linear ticks) and `symlogTicks`'s accept loop compare these bounds (with
  `MIN_LABEL_GAP_PX` padding) instead of centred-half-width distances. A regression test exercises
  the exact reported case: the "present" tick under a fully-engaged fisheye lens centred on it.

**Consequences.**
- DESIGN §3's "events fade in as the visible span shrinks... a 1D quadtree" wording is superseded
  for rendering by this ADR (a `v1 note` block added in place, per that section's own convention —
  §3 is not NORMATIVE, so the note lives alongside the original paragraph rather than requiring a
  contract change); §3's stepping/keyboard behaviour is untouched.
- `CheckpointPipLayout`'s `row` field and `MAX_PIP_ROWS` are gone; any future consumer of
  `layoutCheckpointPips` must handle the `CheckpointLayoutEntry` union (`'pip' | 'cluster'`)
  instead of a flat pip array. `ScrubTrack`'s pip keys stay stable across clustering transitions —
  a cluster is keyed by its first member's own id, so hover state does not flicker as fisheye
  stretching changes exactly which neighbours have merged.
- Both `layoutCheckpointPips` and `declutterEvents` treat `trackWidthPx <= 0` (not yet measured)
  as "no pixel space to judge proximity by" and skip clustering/decluttering entirely, returning
  every checkpoint as its own pip / every overlapping event undeclined — the same guard, applied
  identically in both modules after an initial pass without it collapsed every checkpoint into one
  cluster on an unmeasured (0px) track, caught by `Experience.test.tsx`'s existing
  "marks every scene as a timeline checkpoint" regression.
- `web/src/globe/**`, `web/src/app/Experience.tsx` and the pipeline/sources/data trees were out of
  scope for this pass (concurrent work) and were not touched; `Experience.tsx`'s own props and
  behaviour toward `<Timeline>` are unchanged, since clustering/declutter are both internal to
  `Timeline`/`ScrubTrack`.

---

## ADR-020 — A chapter may recur as several non-adjacent runs

**Status:** accepted — human-directed 2026-09-14. Supersedes the "no new chapter" half of
ADR-014's decision; ADR-014's "no new shot type" half (`UNDERWATER` not re-added) and its
concrete scene/event decisions stand.

**Context.** The human's direction: "Not every scene needs to be waterside if not relevant."
`pipeline/scenes.py`'s `SceneBook` validator required each chapter id to appear as exactly one
consecutive run of scenes (`_require_unique("chapter run ...")`). Combined with "every scene's
shot equals its chapter's shot" (unchanged, see below), this meant giving even one scene a
framing that didn't suit a waterside composition — a city skyline, a steppe, a toolmaking scene
on open ground, an underwater seafloor — would fork the chapter it sat inside into two runs,
which the validator forbade outright. ADR-014 hit exactly this wall: a single `UNDERWATER` scene
at 518 Ma would have split `waters-edge` in two, so `UNDERWATER` was drafted and then withdrawn,
and the human pre-approved only that one shot type, not a chapter split. The result was that
every one of the 40 scenes in the current manifest shares one of two chapters, `molten-earth`
(the one scene with no water to stand beside) and `waters-edge` (all 39 others) — coverage that
is scientifically wide (3.9 Ga to the present) forced through one narrow composition.

**Decision.**
- `pipeline/scenes.py`'s `SceneBook._consistent` validator no longer requires a chapter's scenes
  to form one consecutive run. The chapter-run uniqueness check (`_require_unique("chapter run
  ...")`) is deleted outright. Everything else about a chapter is unchanged:
  - **A scene's shot must still equal its chapter's shot** — a chapter still owns exactly one
    `Shot` + `Composition` pair; recurrence is about *when* a chapter's scenes sit on the
    timeline, not about a chapter holding more than one framing.
  - **Every chapter must still have at least one scene** — the unused-chapter check
    (`chapters with no scenes`) is untouched.
  - **Chapter ids and scene ids stay unique**, as do scene `t` values — untouched.
- No other pipeline code needed to change. `pipeline/publish.py`'s `chapter_spans` already
  builds spans with `groupby(book.scenes, lambda s: s.chapter)`, which groups by *adjacency*,
  not by id — a recurring chapter id already produced one `Chapter` span per run; the old
  validator just never let that code path run. `pipeline/prompts.py`'s
  `COMPOSITION_CONSTRAINTS` is keyed by `Composition`, not by chapter id, so it needed no change
  either.
- `pipeline/manifest.py`'s `Chapter` and `web/src/types/manifest.ts`'s `Chapter` gain a doc note:
  `Manifest.chapters` may hold more than one entry with the same `id` (one per run), so nothing
  may key or deduplicate that array by `id`. No field or schema changed, so this is not a
  `schemaVersion` bump.
- **The web app needed no behavioural change.** `web/src/scene/scene.ts`'s `sceneAt` already
  treats every scene-to-scene gap identically regardless of chapter identity — ADR-011 and
  ADR-012 removed the within/cross-chapter distinction from the dissolve entirely ("there is no
  separate within- vs cross-chapter distinction any more"). `Manifest.chapters` is parsed by
  `web/src/shell/manifest.ts` and otherwise unused by the running app (confirmed by search: no
  other file under `web/src` reads `chapterId` or `Chapter`), so a chapter recurring changes
  nothing downstream of validation. `docs/DESIGN.md §9`'s pipeline semantics (content-addressed
  asset graph, pinning, budget guard) do not mention chapters and are unaffected.
- **The trade-off stands, unchanged.** A change of chapter still reads as a cut (VISUAL_SPEC §3,
  DESIGN §6): this ADR does not relax that, and does not itself add, remove, or reassign any
  scene's chapter. It only removes the *structural* penalty — a forced chapter split and an
  extra pair of cuts — that previously made giving one differently-framed scene its own
  composition disproportionately expensive. Scenes should still be grouped into a chapter's run
  only where dissolve continuity actually matters; a subject that doesn't suit the held framing
  is now a normal curation choice (a new chapter, or a recurrence of an existing
  differently-composed one) rather than something the validator makes impossible.

**Consequences.**
- `docs/VISUAL_SPEC.md §3` and `docs/DESIGN.md §6` are reworded to describe a chapter as a *held
  composition* that may recur across the timeline, rather than a single contiguous span.
- `data/scenes.yaml` is unchanged by this ADR — no scene's chapter, shot, or pin is touched.
  Every existing pin (ADR-005) survives exactly as it was.
- Which scenes would actually benefit from a non-waterside framing, and whether that reuses an
  existing non-`WATER_EDGE` chapter (`molten-earth`, `WIDE_RIDGE`) or needs a new chapter (a new
  `Composition`, which is itself still a contract change requiring its own ADR per DESIGN's
  NORMATIVE list), is a separate, deliberate curation decision for a human to make — not decided
  here. Candidates worth considering, none drafted or scheduled: `modern-city` (a skyline/street
  framing rather than a forced waterfront), `neolithic-river-settlement`, `pleistocene-steppe`,
  `acheulean-erectus` (toolmaking reads better low and close than at a waterline), and
  `cambrian-seafloor`/an `UNDERWATER` framing for the Chengjiang biota — the exact scene ADR-014
  withdrawn specifically because of the constraint this ADR lifts. Any such change is a respec:
  it clears the scene's existing pin (ADR-005 gives the pipeline no "pinned but superseded"
  state, precedent: ADR-014's `devonian-estuary`) and requires a new, human-approved generation
  against the image budget (`pipeline/spend.py`) — never automatic.
- A chapter that recurs many times produces many short runs and therefore many cuts; nothing in
  this ADR limits recurrence, so taste and the few-vs-many-chapters trade-off (DESIGN §14, still
  open) now applies per-run as well as per-chapter.

## ADR-021 — Density-adaptive markers, a cluster popover and a touch magnifier finish the zoom-removal work

**Status:** accepted — human-directed 2026-09-14.

**Context.** The human asked whether the fisheye lens (ADR-017) could adjust its own zoom level
to event density, so an individual scene or event stays resolvable by hovering (or, on a phone,
by touch) "regardless of how close they are" — and, agreeing that this makes a second, separate
zoom mechanism redundant, that the timeline's zoom (buttons, wheel/pinch, double-click, window
framing on click) and the bottom minimap strip be removed outright, with a cluster click opening
a member list instead of framing a window, and a mobile-text-selection-style magnifier for touch
press-and-drag. Two foundation passes landed the pieces this ADR wires together: `fisheye.ts`
gained density-adaptive gap insertion — given a sorted list of marker positions, any gap narrower
than `MIN_MARKER_SEPARATION_PX` gets its own density spike, tapered and mass-capped so a crowded
run of markers opens room for all of them without collapsing the rest of the track — and the
zoom/minimap subsystem (`zoom.ts`, `wheelZoom.ts`, `windowTransition.ts`, `Minimap`,
`ZoomControls`, `follow.ts`) was deleted, `Timeline`'s window fixed to the full domain, and
`ScrubTrack`'s cluster click rewired from `onFrameCluster` (window-framing) to `onOpenCluster`
(reports members, left as an unwired no-op stub pending this pass).

**Decision.**
- **Markers wiring.** `Timeline.tsx` builds `markers` — every checkpoint's `t` plus every event's
  `tMin`/`tMax`, in undistorted (`scale.toUnit`) units — memoised alongside `trackScale`, and
  passes it into `fisheyeScale(scale, fisheye.lens, fisheye.trackWidthPx, markers)`. Without this
  the lens agent's own gap-insertion machinery had nothing to insert gaps around; with it, every
  checkpoint and event range endpoint on the track is a candidate the lens keeps separated once
  the pointer (or a touch drag) brings it near enough, regardless of how many years apart they
  actually are — the K-Pg trio (ADR-017's own worked example, ~1e-6 displayed px apart at rest)
  resolves to individually hoverable/tappable pips under the lens, same as any other cluster.
- **Precision-adaptive hover readout.** `formatGeoTimePrecise(t, precisionYears)` (`format.ts`)
  is `formatGeoTime` with extra decimal digits of raw years once `precisionYears` — the local
  years-per-displayed-pixel, `yearsPerDisplayedPixelAt` (already exported by the lens agent's
  pass) — resolves finer than `formatGeoTime`'s own fixed per-bucket decimal count. It falls
  straight back to `formatGeoTime` whenever the ambient bucket is already at least as fine as a
  pixel (the common case, away from a resolved gap), so this is safe to use everywhere a
  pointer-driven readout previously called `formatGeoTime` directly. `ScrubTrack`'s hover readout
  and the touch magnifier's own readout (below) both use it, so a 1px hover move inside a
  fisheye-opened gap now visibly changes the reading instead of both sides of the gap reading
  identically.
- **Cluster member-list popover.** `ClusterPopover` (`timeline/components/`) is opened by
  `ScrubTrack` itself — not the caller — when a cluster marker (ADR-019) is clicked or tapped:
  a small list of the cluster's members (label + `formatGeoTime`), anchored to the cluster's own
  `u` and edge-clamped the same way a pip's hover preview already is. Selecting a member scrubs
  to its `t` and closes; Escape closes without scrubbing; a press anywhere else on the track
  dismisses it without also scrubbing through it (the usual "tap outside a popover" convention);
  focus lands on it the moment it opens. `Timeline`'s `onOpenCluster` prop is kept as a pure
  notification — `ScrubTrack` still calls it, but nothing downstream is required to build UI in
  response to it any more; `Experience.tsx`'s handler stays the no-op stub the removal pass left,
  now correctly commented as intentional rather than a placeholder. Chrome-less, per the shared
  visual language (`Timeline.tsx`'s own doc comment): no bordered card, the same soft shadow-pool
  `::before` the pip/cluster hover preview already uses.
- **Touch press-and-drag magnifier.** `TouchMagnifier` (`timeline/components/`), modelled on the
  mobile text-selection loupe: while a `touch`/`pen` pointer is pressed on the track, a bubble
  floats above the finger (`position: fixed`, never under it) showing a further-magnified strip
  of the track around the touch point — `checkpointLayout`'s pips/clusters and the decluttered
  event bands `ScrubTrack` already computed against the fisheye-distorted scale, re-projected
  into the bubble's own narrower window at an extra `MAGNIFIER_ZOOM` (3x) on top of whatever the
  lens itself has already opened up — plus the same precision-formatted time and nearest-marker
  label the mouse hover readout shows. Dragging scrubs `t` continuously through the same lens a
  mouse hover would (no separate math); lifting keeps `t` and hides the bubble. A quick tap on a
  pip/cluster still selects/opens it unchanged (pointerdown `stopPropagation` on those buttons
  already prevented the track's own scrub from also firing). The track's `touch-action: none`
  (pre-existing, ADR-017) already keeps a drag from scrolling or pinch-zooming the page. Pip/
  cluster touch targets grow to ~44px *tall* under `@media (pointer: coarse)` — height only, not
  width, since two pips can sit as little as `MIN_PIP_SEPARATION_PX` (8px) apart before
  `layoutCheckpointPips` merges them, and a wider hit box would make adjacent close markers'
  tap targets overlap well before their diamonds do.
- **Cross-references to ADR-017 and ADR-019, both of which described a zoom mechanism this pass
  no longer has anything to point at.** ADR-017's Implementation section says "the zoom buttons,
  keyboard shortcuts, fit-all and event-framing all continue to anchor on the undistorted
  scale" — that whole apparatus is gone (removed in the pass this ADR's Context describes); the
  lens itself, the coupling/dead-zone amendment, the snap port and the undistorted chart dock are
  all still accurate as written. ADR-019's Decision says clicking a cluster "frames the members'
  combined `[tMin, tMax]` span via a new `onFrameCluster` prop... reusing `frameEventWindow`/
  `animateWindowTo`" — superseded by this ADR's popover and `onOpenCluster`, above; everything
  else in ADR-019 (clustering itself, room-based declutter, the tick-label-bounds fix) is
  unaffected and still current. Per this file's own rule ("do not edit history"), those two
  ADRs' bodies are left as written; this paragraph is the correction, not an edit to either.

**Alternatives considered.**
- **Keep the old fixed-factor zoom alongside the density-adaptive lens**, e.g. as a coarse
  "get to the right neighbourhood" tool before the lens does the fine work. Rejected on the
  human's own framing before this pass began: the lens already resolves anything down to
  individually clickable regardless of how close together it is, so a second mechanism for the
  same job is redundant complexity, not a complementary one — two ways to reach the same result
  is worse UX than committing to the one that actually scales to arbitrary density.
- **A vertical (or radial) timeline layout**, so a dense cluster could spread across a second
  dimension instead of fighting for horizontal room. Rejected: it would invalidate essentially
  every geometric assumption this package's rendering and hit-testing make (declutter, pip
  clustering, tick generation, the playhead, `uFromClientX`'s own horizontal math) for a benefit
  the lens already delivers in place — resolving a dense run without ever leaving the horizontal
  track a scrubbing gesture (mouse drag or touch swipe) naturally maps onto.

**Implementation.**
- `timeline/Timeline.tsx` — the `markers` memo (checkpoints ∪ event range endpoints, in base-scale
  `u`), threaded into `fisheyeScale`'s new 4th parameter.
- `timeline/format.ts` — `formatGeoTimePrecise`, `bucketResolutionYears` (internal).
- `timeline/components/ClusterPopover.tsx` + `.module.css` — new.
- `timeline/components/TouchMagnifier.tsx` + `.module.css` — new.
- `timeline/components/ScrubTrack.tsx` — `openClusterId`/`touchPoint` state, the `eventBandsU`
  memo (shared by the main render and the magnifier), `formatGeoTimePrecise` wired into the hover
  readout, `data-cluster-open` (hides the playhead/hover readouts while a popover is open, same
  pattern as the existing hover-preview rule), the pointerdown-elsewhere-dismisses-the-popover
  branch.
- `timeline/components/ScrubTrack.module.css` — the `data-cluster-open` rule, the
  `@media (pointer: coarse)` pip/cluster touch-target rule.
- `timeline/index.ts` — exports `formatGeoTimePrecise` alongside `formatGeoTime`.
- `app/Experience.tsx` — `handleOpenCluster`'s comment corrected (it is not a placeholder
  awaiting a follow-up any more; the follow-up is this ADR).
- `docs/DESIGN.md` §3 — the zoom-removal v1 note extended to name the density-adaptive markers,
  the cluster popover and the touch magnifier as what actually delivers "reachable ... regardless
  of how close together" and the touch equivalent, rather than leaving those as forward-looking.

**Tests.** `fisheye.test.ts`/`checkpointLayout.test.ts` (from the foundation passes) already cover
the marker/gap-insertion math and the fisheye-reveal clustering behaviour directly; this pass adds
`format.test.ts` (`formatGeoTimePrecise`: fallback threshold, the K-Pg trio resolving to three
distinct readouts, decimal-count derivation, the `MAX_PRECISE_DECIMALS` cap, `"present"` and
validation edge cases), a `Timeline.test.tsx` case asserting the exact `markers` array
`fisheyeScale` is called with (spying through to the real implementation), and `ScrubTrack.test.tsx`
coverage for the popover (opens with both members named, selects-and-closes, Escape-closes,
outside-press-dismisses-without-scrubbing, focus-on-open) and the touch magnifier (shows while
touch-pressed, absent on mouse hover, hides on lift, shows the same precision-formatted readout).
`pnpm vitest run` — 690/690 passing; `pnpm typecheck` — clean.

**Consequences.**
- `markers` is rebuilt every render `checkpoints`/`events`/`scale` actually changes — `O(scenes +
  2·events)` (order of a hundred entries for this product's real data), cheap next to the
  `O(log n)`-per-query table `fisheyeScale` already builds from it.
- A viewer who never hovers or touches the track sees no change at all — same as ADR-017's own
  consequence: the lens (and now its markers) only matter once `pointTo` has been called.
- `ClusterPopover`/`TouchMagnifier` are the first *interactive* (pointer-events: auto) floating
  surfaces this package has added since the loupe's removal (ADR-017) — everything else riding
  the track (previews, the hover readout) is `pointer-events: none` and purely presentational.
  Both stay chrome-less per the shared visual language rather than introducing the package's
  first bordered panel.

**Amendment (2026-09-14) — the lens's own extra mass is now conserved, not just gap insertion's
own additive cap.** Browser-verified reviewer finding: because the inserted mass this ADR's own
gap insertion added depended on the focus position (which gaps were active, how tapered, and —
independently of markers at all — how close the focus sat to a domain edge), the *normaliser*
`fisheyeScale` divides every displayed position by changed as the lens moved between sparse and
dense regions of the track, or simply as it approached either end of the domain. Every point on
the track — including checkpoint pips and event bands 500–900px from the pointer, nowhere near
the lens — slid by up to hundreds of px during an ordinary hover sweep, and unrelated clusters
merged and split as a side effect. This directly contradicted ADR-017's own "anything outside the
lens keeps its place as the lens moves" and reproduced the class of unprompted "jump" the human
had already reported once against the dead zone (ADR-017's own amendment, above) — the module's
doc comment had flagged the *plain*-bump half of this as a known, deliberately out-of-scope
residual at the time density-adaptive gap insertion first landed (the "Known residual" paragraph
that amendment's own commit added); this pass closes it, including that half.

`timeline/fisheye.ts` is restructured around one invariant: the total extra mass the lens may add
over the whole track is a fixed **budget** `B = gain · halfWidth` — exactly the mass an unclipped
plain bump of that gain and half-width would carry — a pure function of `strength` and
`trackWidthPx`, never of focus or `markers`. The scale's true normaliser (`FisheyeTable.total`) is
therefore always exactly `1 + B`, so a point the lens's local support doesn't reach reduces to a
closed form (`s / (1 + B)` or `(s + B) / (1 + B)`) that cannot depend on where the focus is or how
the markers are laid out — not merely bounded to move "a little", provably identical to floating
precision, which `fisheye.test.ts`'s new "mass conservation" tests check directly (a focus sweep
through both dense and sparse marker sets, and across domain-edge clipping) rather than only
bounding the shift as the previous cap's own tests did. Gap insertion no longer *adds* to the
budget; it *reallocates* it: every candidate gap draws against `B` first (scaled down
proportionally, continuously, if combined demand exceeds it — a saturated cluster can claim the
entire budget, leaving the smooth bump nothing right at its own centre, which is accepted as the
correct trade since the magnification is needed exactly there), and whatever `B` the gaps don't
claim goes to the bump. Near a domain edge, where the bump's own natural support runs past
`[0, 1]` and its in-domain integral would otherwise fall short of `B`, the bump's effective gain
is scaled up so its in-domain mass still equals its share of `B` exactly — the same redistribution
mechanism handles gap-competition and edge-clipping uniformly. `MAX_INSERTED_TOTAL_PX` is retired
(its role is now `B` itself, derived from `FISHEYE_GAIN`/`FISHEYE_HALF_WIDTH_PX` rather than an
independently-tuned pixel constant); `FISHEYE_GAIN`/`FISHEYE_HALF_WIDTH_PX`/`GAP_TAPER_HALF_WIDTH_PX`
are unchanged — checked against the real data's own tightest clusters (the K-Pg trio and the last
~200 years' several-scenes-and-events-within-2px cluster), the existing budget (~250 displayed px
at full strength on a 1440px track) resolves both with room to spare, so raising either constant
was not needed.

Browser-verified (Playwright, 1440×900, hovering across the real track in 20px steps with 5
intermediate sub-steps each so the pointer-coupled lens tracks continuously): a pip more than
~350px from the pointer moves at most ~1.6px between consecutive hover positions (residual
render/measurement noise, not the lens), dropping further with distance (~1px at 500px,
under 1px at 700px) — down from up to hundreds of px before this fix. The one exception inside
that margin, up to ~20px for a pip ~257px from the pointer, sits in the real timeline's single
densest neighbourhood (68–62 Ma, several adjacent clusters within a few tens of screen px of each
other); there the lens's *magnified* screen footprint genuinely extends past the raw 240px
(undistorted-space) taper radius, which is expected and consistent with the invariant — the
invariant is proven, and unit-tested, against the true local support in undistorted space, not a
fixed screen-space radius. The K-Pg trio (three same-instant-ish scenes ~66.043–66.0429 Ma) and
the present-day cluster (Wright Flyer, Apollo 11, present) both resolve to individually hoverable,
clickable pips once the lens sits over them, confirmed live against the running app.

**Amendment (2026-09-14) — touch/pen gesture arbitration for a press that starts on a marker
(corrects a claim in this ADR's own Decision above).** The "Touch press-and-drag magnifier" bullet
above claims a marker's pointerdown-time `stopPropagation` "already prevented the track's own
scrub from also firing" for a tap, implying a drag was unaffected. That was wrong: on a phone,
where a pip/cluster's `@media (pointer: coarse)` touch target (this ADR's own change, ~44px tall)
covers most of the track, a real drag that happened to *start* on one stopped propagation
unconditionally at `pointerdown` — so `ScrubTrack`'s own scrub handling never saw it, and the
press committed to "select this marker" before the gesture had any chance to become a drag. A
touch/pen drag beginning on any marker was therefore unscrubbable; only empty track worked.

`timeline/markerGesture.ts` (new) fixes this without touching mouse behaviour at all. A marker
button's `onPointerDown` now only stops propagation for `pointerType === 'mouse'`; for touch/pen it
instead records the press (`pendingMarkerEntryRef`) and lets the event bubble to `ScrubTrack`,
which holds it *pending* — neither a scrub nor a selection yet — until the gesture resolves:
`hasExceededTapSlop` (Euclidean, `MARKER_TAP_SLOP_PX = 8`) is checked on every subsequent move;
once movement clears it, the press commits to an ordinary scrub for the rest of the gesture
(`pendingMarkerPressRef` cleared, falling through to the same `scrubToClientX` path a drag starting
on empty track already used); short of that, lifting resolves it into a tap — `commitMarkerTap`
selects the pip or opens the cluster popover, the same outcome `onClick` already gives a mouse
click. A cancelled pointer (the system claiming the gesture) commits to neither. The touch
magnifier is unaffected either way: it already shows for any pressed touch/pen pointer regardless
of arbitration state, so a pending marker press previews it the same as a press on empty track.
Mouse is provably unaffected — its `pointerdown` still stops propagation before any of this code
runs, so `ScrubTrack`'s own `handlePointerDown` never even observes a mouse press on a marker.

**Tests.** `markerGesture.test.ts` (`hasExceededTapSlop`: no movement, under/at/past the slop
boundary on each axis, the Euclidean 6-8-10 case, a custom threshold, negative deltas) and a new
`ScrubTrack.test.tsx` block, "touch/pen marker gesture arbitration (ADR-021 follow-up)": a mouse
click still selects immediately; a touch tap (lift within the slop) selects a pip rather than
scrubbing to the raw touch position; a touch drag exceeding the slop scrubs and does not select;
the same pair of cases for a cluster (tap opens the popover, a drag scrubs past it); the magnifier
shows immediately on a pending marker press, before slop is exceeded; a pending press never leaks
into the next gesture on the same pointer id. `pnpm vitest run` — 726/726 passing; `pnpm
typecheck` — clean.

Browser-verified (Playwright + CDP touch dispatch, 390×844 coarse-pointer/`hasTouch` viewport): a
touch drag starting on a pip and moving well past `MARKER_TAP_SLOP_PX` scrubs the playhead
(`aria-valuenow` moves off its start value) while the magnifier stays visible throughout, including
the instant right after `touchstart` before slop is exceeded; a touch press on a pip with only
sub-slop jitter lands the playhead exactly on that pip's own `t` on lift; a touch press on a
cluster marker under the same sub-slop condition opens `ClusterPopover` (`data-cluster-open`
flips, the popover's member list renders); a plain mouse click on a pip still selects it in one
event, unaffected by any of the above.

---

## ADR-022 — `EventSet` events gain `kind`, a best-estimate `t`, and a closed set of tags

**Status:** accepted — human-directed 2026-09-14.

**Context.** The timeline's event set (`EventSet`/`Event`, DATA_SOURCES.md § Contract,
`pipeline/shapes.py`) has always carried a single dating primitive: `t_min`/`t_max`, an
uncertainty interval, plus a `t` *property* computed as its midpoint "for placement only, never
present this as the date." That single interval is used to mean two genuinely different things
with no way to tell them apart from the data alone: for most events it is a dating error bar
around one real happening (the K-Pg impact, the Cambrian explosion's onset); for a handful — the
event's own gotcha list names `ediacaran-biota` and `snowball-earth` — it is the literature's
*known span* of something that actually lasted, quoted verbatim as `t_min`/`t_max`. A concrete
failure of this conflation: the Early Cretaceous seaweed event's uncertainty interval (a dating
error bar on when the fossils were laid down) was read by the timeline's importance/room-based
rendering as if it were 200 Myr of continuous seaweed, because nothing in the data distinguished
"we're not sure exactly when" from "this genuinely went on for that long" — the bar for a moment
and the bar for a period look identical today. Separately, curation of new events (agriculture,
writing, spaceflight, the transistor, ...) has no way to say what an event is *about*: every
timeline consumer that wants to filter or focus by theme (a "show me catastrophes", a coloured
legend, a future per-theme view) would otherwise have to pattern-match on `label`/`description`
text, which is exactly the "stringly-typed" trap CLAUDE.md's engineering guidance calls out.

**Decision.**
- **`kind: 'moment' | 'period'` (`pipeline.shapes.EventKind`), required on every `Event`.**
  `'moment'` is one happening, dated by a best estimate plus its `[t_min, t_max]` dating
  uncertainty; `'period'` is something that genuinely lasted, whose `t_min`/`t_max` *are* its
  end and start. No other kind exists — a closed two-value enum, not a free-text label, so
  "which reading applies" is answerable from the data itself rather than from the prose.
- **`t: GeoTime | None`, required for a `'moment'`, forbidden for a `'period'`.** A moment's `t`
  is the curator's best-estimate instant (not necessarily the interval's midpoint — a citation
  may support a sharper date than the interval's own centre) and must fall within
  `[t_min, t_max]`; a period has no single instant to name, so `t` stays `None` and its
  `t_min`/`t_max` are read as the span directly. The old midpoint-for-placement computation
  survives as `Event.placement_t` (`t` where a moment has one, else the interval's midpoint) —
  every existing caller of the removed `Event.t` property (`EventSet`'s own sort) moves to it,
  since something is still needed to order/place a period on an axis. `placement_t` carries the
  same "never present this as the date" warning the old `t` property did.
- **`tags: tuple[EventTag, ...]`, non-empty, no duplicates, ordered — first tag is primary.**
  `EventTag` (`pipeline.shapes.EventTag`) is a closed set of **six** themes, science and
  technology combined into one: `life`, `earth-climate`, `catastrophe`, `human-origins`,
  `society`, `science-technology`. An event may carry more than one; the first is its primary
  tag and is what drives timeline colour once that rendering work lands (a later task — see
  IMPLEMENTATION.md). Closed-set edge calls made curating the new batch, for whoever tags the
  rest: exploration events tag under their *mechanism* — spaceflight events (Apollo 11, the
  Moon landing) are `science-technology`, peopling-of-continents events are `human-origins`;
  `siberian-traps`, `deccan-traps` and `toba-eruption` are `[catastrophe, earth-climate]`
  (a climate-forcing geological catastrophe, not a life-history event on its own); primates stay
  `[life]` — `human-origins` begins at the hominins, ~7 Ma, not earlier.
- **Both fields are additive to the *shape*, not migrated into existing data.** `data/events.yaml`
  (66 events, hand-curated, `sources/events-core`) and `data/globe_regimes.yaml` (5 events,
  `sources/globe-regimes`, sharing the same `Event` model) are **not** rewritten by this ADR —
  assigning a kind, a best-estimate date and a primary theme to each existing event is a curation
  judgement call, not a mechanical migration, and belongs to the agent that actually reviews each
  event, not to this contract change. Both fields are therefore **required, not defaulted** on
  `Event`: a source whose YAML doesn't yet carry them fails to load, loudly, with a pydantic
  validation error naming the missing field and the event id — the existing "fail loudly, never
  substitute" rule (CLAUDE.md) applied to a schema migration instead of a runtime path. This is a
  deliberate choice against a temporary default (e.g. `kind: moment` for everything, `tags:
  [life]` as a catch-all): a wrong default is worse than a loud failure here, because a
  StrEnum-backed field silently gets the *wrong* invalid-state-unrepresentable guarantee it exists
  to provide — every event would validate, but a fifth of them would carry a made-up theme no
  curator ever chose. The two hand-curated sources stay unpublishable (`make data` fails) until
  each event's `kind`/`tags` — and, for a moment, its best-estimate `t` — are filled in by hand;
  `sources/events-core/fixture/events.yaml` (the small, committed, non-production reference slice)
  is updated by this ADR to the new shape so the source's own test infrastructure keeps
  exercising the schema offline in the meantime.
- **Scene → event link.** `pipeline.scenes.SceneRecord` gains an optional `events: tuple[str, ...]`
  (default empty) naming the `events-core` event id(s) a generated still visually anchors to —
  the reverse of nothing previously existing: a scene could already be *dated* near an event's
  interval, but nothing recorded that the connection was intentional. Validated against the
  published `events-core` `EventSet`'s ids at `earthtime publish` time (`PublishRefused` on an
  unknown id) rather than at `SceneBook` parse time, so `load_scene_book` (used by `plan`,
  `review` and `build`, none of which load curated event data) keeps its current signature. The
  field is invisible to the asset graph (`pipeline/assets.py` never reads `scene.events` when
  building a prompt or image node's `inputs`), so it changes no digest and clears no pin — adding
  or editing a scene's event links never triggers a rebuild of an already-approved image.
- **Wire format.** `pipeline.manifest.TimelineEvent` mirrors `Event` exactly — `kind` and `tags`
  reuse `pipeline.shapes.EventKind`/`EventTag` directly rather than re-declaring synonyms (the
  same pattern `effect`'s `GlobeEffectKind` already uses), `t` is additive/omitted-when-absent
  like `effect` already is. `pipeline.manifest.Scene` gains `events: tuple[str, ...] = ()`,
  always emitted (unlike the single-value additive fields, an empty list is already a complete,
  unambiguous "no links" on the wire). On the web side, `TimelineEvent.kind`/`t`/`tags` and
  `Scene.events` are added as **optional** fields (`web/src/types/layer.ts`,
  `web/src/types/manifest.ts`) and parsed leniently — present-and-valid or absent, never
  required — because the currently-published manifest and the committed stub
  (`web/public/stub/manifest.json`) predate this ADR and must keep loading without a republish.
  Rendering the timeline by `kind`/`tags` (colour, filtering, a period rendered as a band rather
  than a point) is explicitly deferred; this ADR only makes the data reach the browser intact.

**Alternatives considered.**
- **A single free-text `category` field instead of a closed tag set.** Rejected: it is exactly
  the stringly-typed trap this project's own engineering guidance warns against — a category
  spelled two ways by two curation passes silently stops matching, and nothing catches it until a
  filter view quietly drops events. A closed `StrEnum` makes an unknown value a loud validation
  error instead of a silent no-op.
- **Eight tags, closer to a per-domain taxonomy** (splitting `science-technology` into science and
  technology, and/or carving a separate `exploration` tag out of `human-origins`/
  `science-technology`). Rejected on the human's own call: at ~200 curated events total (DESIGN
  §1's non-goal is exhaustive coverage), eight thematic buckets is more categories than the
  dataset has density to fill legibly, and every exploration event already reads cleanly under an
  existing tag by its mechanism (peopling of continents under `human-origins`, spaceflight under
  `science-technology`) without needing a bucket of its own. Six keeps the future colour legend
  small enough to read at a glance, which is the actual reason a closed set exists.
- **Keep one interval and add a boolean `is_span` flag instead of a `kind` enum.** Rejected as a
  worse version of the same idea: a two-value closed enum documents itself at every call site
  (`event.kind is EventKind.PERIOD`) where a boolean forces every reader back to the field's
  definition to learn which state means what, and a `kind` enum leaves room for the contract to
  grow a third reading later (it shouldn't need to, but nothing about the modelling forecloses it)
  without renaming a field whose name no longer describes its values.
- **Default `kind`/`tags` for the existing 66 + 5 events now** (e.g. `moment` for everything with
  `t = placement midpoint`, a single catch-all tag), so every test stays green immediately.
  Rejected — see Decision above: a plausible-looking default here is a silent lie a future reader
  has no way to distinguish from a real curatorial choice, which is worse than the loud failure
  a missing-field validation error already gives them.

**Consequences.**
- `tests/sources/test_events.py` and `tests/sources/test_globe_regimes.py` assert directly against
  the real, committed `data/events.yaml` / `data/globe_regimes.yaml` (by design — see each file's
  own docstring), so both fail loudly at their module-scoped fixture (a pydantic `ValidationError`
  from the first event missing `kind`/`tags`) until a follow-up curation pass fills in every
  event's `kind`, `tags`, and — for a moment — its best-estimate `t`, then reruns `make data`. This
  is the intended, expected state immediately after this ADR, not a regression to silently work
  around; `earthtime publish` is likewise blocked on `events-core` until that pass lands, since
  `load_world` fails the same way `WorldModel.at` is expected to for a source that hasn't finished
  migrating.
- **This reaches further than the two sources' own tests.** `data/curated/events-core.parquet` and
  `data/curated/globe-regimes.parquet` are themselves committed to git (`storage_tier = "git"`,
  DATA_SOURCES.md's storage policy — both are well under the 5 MB threshold) rather than
  regenerated on the fly, and `pipeline.curated.load_world` parses *every* `*.parquet` file in the
  curated directory unconditionally, failing loudly (`CuratedFormatError`) on one whose on-disk
  columns don't match its shape's current layout. Because this ADR adds `kind`/`t`/`tags` columns
  to `_LAYOUTS[EventSet]` without regenerating either committed parquet (regenerating truthfully
  requires the same curation pass named above — a placeholder migration of the derived parquet
  alone, leaving the YAML un-migrated, would desync the committed artifact from the source that is
  supposed to produce it, exactly the drift `pipeline/curated.py` exists to prevent), any code path
  that calls `load_world` against this repo's real `data/curated/` — not only publish, anything
  that loads the whole curated directory — fails the same way until that pass lands and reruns
  `make data`. Two tests outside `sources/events-core`/`sources/globe-regimes` hit this directly:
  `tests/test_pipeline.py::test_committed_scene_prompts_name_no_model_or_provider` and
  `tests/test_portraits.py::test_committed_portraits_cover_the_lineage_as_square_1k_plates_naming_no_provider`,
  both of which load the real curated directory for reasons unrelated to events. This is a real,
  load-bearing consequence of choosing "required, no default" over a placeholder default (see
  Decision and the rejected-alternatives entry above) — named here rather than worked around,
  because working around it would mean exactly the kind of fabricated derived data this ADR
  argues against.
- `data/curated/events-core.parquet`'s and `data/curated/globe-regimes.parquet`'s on-disk column
  layout (`pipeline/curated.py`'s `_LAYOUTS[EventSet]`) gains `kind`, `t` and `tags` columns; both
  files are regenerated the next time either source's `normalise()` succeeds (i.e. after the
  curation pass above), not by this ADR directly.
- Any future consumer of `Event`/`TimelineEvent` (Python or TypeScript) that wants to read a
  period's span versus a moment's date branches on `kind`, never on whether `t`/`t_min`/`t_max`
  happen to differ — `kind` is the single source of truth for which reading applies, exactly the
  gap this ADR closes.

## ADR-023 — Audio: layered ambience stems, a procedural score, and per-scene sound effects

**Status:** accepted — human-directed 2026-09-14. Elaborates DESIGN.md §11 (which named three
tiers at a sentence each) into a precise, buildable contract; supersedes none of it.

**Context.** DESIGN §11 committed to three audio tiers — layered ambience stems gained by
`WorldState(t)`, a procedural score (Tone.js), and out-of-scope narration — but left every
number and mapping undecided, and named no per-scene sound mechanism at all. The human asked
for exactly the tier-1/tier-2 pairing DESIGN already sketched, plus a third thing DESIGN never
mentioned: an optional sound effect attached to individual scenes, playing "when it's visible or
first shown." This ADR fixes all three precisely enough to build against, and extends the scene
record / manifest contract (alongside `events`, ADR-022) to carry the third.

Checking what `WorldState` actually has data for today (`pipeline/models.py` against
`data/curated/`) matters before mapping anything to it: only `co2` (`atmosphere.co2_ppm`),
`day_length`, `solar_luminosity`, `moon_distance`, `obliquity` and `land_fraction` are curated,
and of those only `co2` and `day_length` are published as `manifest.layers` today
(`pipeline/publish.py`'s `SCALAR_LAYERS`) — `mean_temp_c`, `sea_level_m`, `ice_extent_frac`,
`o2_percent`, `genus_count` and `population` are real `WorldState` fields with **no curated
source wired in yet** (`paleoclimate`, `hyde`, `pbdb` are still `⚠️ TBD` per DATA_SOURCES.md).
Any audio design that assumes temperature or biodiversity are available today would not build.
What *is* real and already published, besides `t` itself: `co2`, `day_length`, and the
`events-core` `EventSet` (66 dated, tagged events, `Manifest.events`) — including every
`catastrophe`-tagged and `flood-basalt`/`impact-winter` `GlobeEffect`-carrying event. The design
below is deliberately built only from what exists now, with every place a not-yet-curated
scalar (temperature, biodiversity, population) would naturally join documented as an additive,
non-breaking follow-up (see Consequences) — no field here is `WorldState`-shaped in a way a
later scalar can't slot into.

**Decision.**

### 1. Ambience stems (tier 1)

**Ten stems**, each a seamlessly-loopable CC0 clip, gained in `[0, 1]` by a pure function of
`t` (a `stemGains(t): Record<StemId, number>` the web engine owns — see
`audio-engine-spec.md`). Every curve is built from `Math.log1p(t)` — the timeline's own symlog
display space (DESIGN §3) — using a shared raised-cosine ramp
(`rampInLog(t, tStart, tEnd)`/`rampOutLog`, `0` before `tEnd`-ward of the ramp, `1` past
`tStart`-ward of it, a smooth half-cosine between) so a fade reads as a fade at any playback
speed or scrub rate, never a step — the reason DESIGN §11 gives for parameterising by `t` at
all ("it responds correctly to scrubbing and speed changes — a fixed soundtrack cannot").
Boundaries are literature dates already used elsewhere in this project (several are
`events-core` event ids, cited so a stem's fade lines up with the event feed rather than
drifting from it); none require a scalar that isn't curated yet.

| id | character | baseline | boundary / driver |
|---|---|---|---|
| `wind` | rocky/atmospheric wind bed | 0.6 before land plants, ramps to 0.32 after | ramp 470→385 Ma (`land-plants` t_min 4.70e8 → `first-forests` t_min 3.78e8): a barren, unvegetated world carries wind sound further; closed forest canopy damps it. Always > 0 — wind exists even in the Hadean. |
| `water` | surf / open ocean | flat 0.45 | always on — oceans since ~4.4 Ga (`moon-forming-impact` t_max). A modest +0.15 bump before 3.8 Ga (`great-oxidation-event`'s own `t_max` 2.4e9 is too late to use; instead ramp out 4.0→3.8 Ga, a conservative reading of the Archean "water world" era `globe-regimes`'s `water-world-regime` event covers) reflects a near-total-ocean planet, ramping to the flat baseline by 3.8 Ga. |
| `storm` | rain / distant thunder | flat 0.22 | no differentiated deep-time precipitation series is curated yet (`paleoclimate`, DATA_SOURCES.md, not yet built) — flat baseline is the honest placeholder; **do not** invent a shape here (CLAUDE.md "if something is unusable, stop and report" applies to fabricated curves too). Revisit once `paleoclimate` lands (see Consequences). |
| `volcanic` | tectonic rumble, distant lava | 0.75 in the Hadean/Archean, ramps to 0.15 by the Phanerozoic, **plus temporary bumps** | secular ramp-out 4.0→0.54 Ga (Hadean/Archean crustal instability cooling into the stable Phanerozoic); on top of it, a `rampInLog`/`rampOutLog` pulse to 0.6 across each `events-core` event whose `effect.kind === 'flood-basalt'` (`siberian-traps` t 2.5188e8, `deccan-traps` t 6.6032e7) — real, already-published event data drives this, not a hand-tuned date. |
| `insects` | cicada / cricket chorus | 0 → 0.35 | ramp-in 400→370 Ma — land arthropods establish with early land ecosystems, matching DESIGN §11's own "insects fade in during the Devonian" and bracketing `land-plants`/`first-forests`. |
| `birds` | birdsong | 0 → 0.28, then → 0.4 | ramp-in 145→100 Ma (Cretaceous crown birds, matching DESIGN §11's "birds in the Cretaceous"); a second ramp 66.06→65 Ma (around `k-pg-impact`, t 6.6043e7) lifts the baseline further — birds become the dominant flying-animal sound once non-avian dinosaurs are gone. |
| `mammals` | calls, footfalls, herds | 0.04 → 0.32 | ramp 66.06→60 Ma (around `k-pg-impact`) — small, mostly-silent Mesozoic mammals give way to the Paleogene radiation. |
| `fire` | crackle: wildfire, then hearth | 0 → 0.15, then → 0.32 | ramp-in 420→400 Ma (earliest wildfire evidence, once O2 and land fuel both exist) to a low wildfire baseline; a second ramp 1.5→0.28 Ma (around `control-of-fire`, t_min 4.0e5–t_max 1.5e6) lifts it further as controlled fire becomes part of the everyday soundscape. |
| `settlement` | voices, murmur, communal ambience | 0 → 0.22, rising toward the present | ramp-in 11.5→10 ka (`agriculture`, t_min 1.0025e4) to a baseline that then rises smoothly toward `t = 0` as `1 − log1p(t) / log1p(11500)` for `t < 11.5 ka` — a coarse proxy for the same "more settled land, more people" trend `HYDE` population data would drive directly once curated (see Consequences); never negative, saturates near 0.5 at present. |
| `machinery` | engines, then traffic | 0 → rising steeply toward the present | ramp-in 265→166 yr (`industrial-revolution`, t_min 185–t_max 265) to a curve rising as `1 − log1p(t) / log1p(250)` for `t < 250 yr`, reaching its max at `t = 0` — the same "hockey stick near the present" shape symlog display already makes legible for anything industrial-era. |

Every ramp is written once as a small table of `(tStart, tEnd, from, to)` triples the shared
helper consumes, not elsewhere in the codebase, precisely so it is auditable and testable at
fixed checkpoints (IMPLEMENTATION.md A6: "stem gains match expected curves at checkpoints").
Master gain (from the HUD toggle, see §3 below) multiplies every stem uniformly; per-stem gains
above are relative to that master, not absolute loudness — final level balancing across the ten
is a mixing pass against real audio, not something this contract can specify numerically.

### 2. Procedural score (tier 2)

**Tone.js, lazy-loaded, never bundled until sound is enabled.** DESIGN §12 already names
Tone.js; its UMD bundle is non-trivial (hundreds of KB) and every other piece of this feature
is silent by default (sound starts off — user decision, browsers require a gesture anyway), so
importing it eagerly would tax every visitor who never turns sound on for a feature they may
never use. The audio engine's entry point (`audio/engine.ts`, see `audio-engine-spec.md`) does
`await import('tone')` **only** inside the handler the speaker-toggle's first "on" click calls,
never at module top level and never from `Experience.tsx`'s own top-level imports — mirroring
how the rest of the app treats anything costly and optional.

**Never loops, never ends** (DESIGN §11): a slow low-frequency modulation source (a Tone.js LFO
or a hand-rolled sine driven by wall-clock time, engine's choice) continuously nudges
sub-parameters (detune, filter cutoff micro-drift) so the same `WorldState(t)` never produces
the identical instant twice, the way DESIGN's "never loops" reads for a fundamentally
parameter-driven, non-sample-based instrument.

**Parameter mapping**, restricted to what is real today (see Context) — each explicitly a pure
function of the already-published `co2` series, `day_length`, and `events-core`:

| score parameter | driven by | mapping |
|---|---|---|
| drone root pitch | `t` itself, coarse register only | one octave lower in deep time than at present — a slow, continuous glide keyed to `log1p(t)`, not a WorldState scalar; register alone reads as "long ago" without implying a measurement. |
| drone timbre / filter brightness | `co2_ppm` | higher CO2 → a slightly duller, more damped low-pass cutoff (a thicker, warmer atmosphere reads as a softer high end); `co2_ppm` is already published and needs no new plumbing. |
| pulse density (rhythmic activity) | `day_length_hours` | shorter days → a faster underlying pulse/arpeggiation rate — day length is already published, real, and directly apt (the planet's own rotation *is* a rhythm). |
| harmonic mood | proximity to a `catastrophe`-tagged `events-core` event | inside ± a few hundred kyr (scaled by the event's own `[t_min, t_max]` width) of any event whose `tags` include `catastrophe`, the chord set shifts from the ambient major/open-fifth default toward a minor/dissonant cluster, `rampInLog`/`rampOutLog`'d the same way stem gains are — so K-Pg, Siberian/Deccan Traps and Snowball Earth each cast an audible shadow that fades, rather than a hard cut. `events-core` is already published; no new data need be fetched. |

**Deferred, additive, not implemented now:** biodiversity-driven density (`genus_count`,
`pbdb`) and temperature-driven brightness in place of the CO2 proxy (`mean_temp_c`,
`paleoclimate`) — both are real `WorldState` fields with no curated source yet (Context). The
score's parameter list is written so adding either later is a new mapping row, never a
signature change: `scoreParams(t, series)` takes whatever published series exist, and a series
the current manifest doesn't carry simply isn't in the map it's passed (see
`audio-engine-spec.md`).

**Ducking under scene sound.** The score's overall output gain multiplies by
`1 − 0.6 × max(activeSceneOnceGain, activeSceneLoopGain)` — i.e. it recedes, never mutes, by up
to 60% while a scene's own sound (§3) is prominent, so a loud effect (once-mode) is legible
without silence feeling like a dropout, and a soft ambience-mode scene sound barely ducks it at
all. This is symmetric with how film scores duck under dialogue/SFX, and keeps the mapping pure
in the same inputs (`t`, the scene mix) everything else here already reads.

### 3. Scene sound effects

**New optional `SceneRecord.sound` (`pipeline/scenes.py`, ADR-023):**

```python
class SoundMode(StrEnum):
    LOOP = "loop"
    ONCE = "once"


class SceneSound(BaseModel):
    stem: str  # id in the audio-stems catalogue (pipeline.audio.StemBook)
    mode: SoundMode
    gain: float  # (0, 1] — mixed against the stem's own master gain
```

`SceneRecord.sound: SceneSound | None = None`. Reuses the *same* stem catalogue as tier 1 — a
scene doesn't get a bespoke one-off sound file, it names an existing ambience stem and asks for
a different playback treatment than that stem's own default `t`-driven curve. This is why one
catalogue (not two) is right: "loop mode" scene sound and "tier-1 ambience" are the same stem
under two different gain functions, never two asset pipelines.

- **`mode: loop`** — gain is the scene's own on-screen **presentation weight**: exactly the
  `mix` value `web/src/scene/presentation.ts`'s `usePresentedSceneMix` already computes for the
  cross-dissolve (0 off-screen, 1 fully on-screen, smoothly between during a dissolve),
  multiplied by `sound.gain`. Pure in the same inputs the visual dissolve already is — scrub-safe
  and speed-safe by construction, with no new state. `sceneSoundGains(presented: SceneMix):
  Record<sceneId, number>` (see `audio-engine-spec.md`) is the one new pure function this needs.
- **`mode: once`** — fires a single playback of the stem (independent of, and additive to, that
  stem's own tier-1 gain — it is a foreground *event* sound, not a second ambience layer) when
  the scene becomes the **settled** on-screen scene (`presented.mix` reaches exactly `1` for
  this scene, the same "settled" `presentation.ts` already defines for its own case analysis)
  **while playing**, not while scrubbing: scrubbing can sweep `mix` to `1` and back many times a
  second, and a "first shown" effect firing on every such sweep would read as broken, not
  ambient. The engine distinguishes the two the same way playback already does elsewhere in this
  codebase (`timeline/playback.ts`'s own mode state is already available to `Experience.tsx`) —
  scrubbing is any advance of `t` not driven by the playback clock. **At most once per arrival**:
  a per-scene "already fired since last settling here" flag is set on fire and cleared the
  moment `presented.mix` leaves `1` for this scene (i.e. the viewer moves on) — re-arming
  exactly on return, so replaying the same stretch during playback plays the effect again, but a
  single dwell never repeats it.
- **Never affects image digests or pins** (mirrors `events`, ADR-022): `pipeline/assets.py`
  never reads `scene.sound`, so adding, editing or removing it changes no prompt/image node
  digest and clears no pin — verified directly
  (`test_scene_sound_plays_no_part_in_the_asset_graph`).
- **Validated at publish time**, not at `SceneBook` parse time — the same reasoning
  `_validate_scene_events` gives: parsing `scenes.yaml` has no stem catalogue to check against.
  `earthtime publish` refuses (`PublishRefused`) a scene naming an unknown `stem` id, and
  separately refuses if a catalogued stem's own published file is missing from
  `data/media/audio/` (`pipeline/publish.py`'s `_validate_scene_sound`/`_audio_stems`).

### 4. Audio asset pipeline

**`sources/audio-stems/`** exists as an ordinary `sources/<name>/` directory (`manifest.toml`,
`fetch.py`, `normalise.py`, `fixture/`, `README.md`) so it gets the fetch/verify/credit
machinery every externally-sourced dataset uses — but its `normalise()` returns **no
`CuratedShape`**. Audio stems are not one of the four curated shapes (DATA_SOURCES.md §
Contract): they are not `WorldState`-projectable, time-indexed data, just static, per-id media
files with per-file provenance. They bypass `WorldModel`/`pipeline/curated.py` entirely, the
same way `pipeline/portraits.py`'s hand-curated lineage plates already do — this is not a fifth
curated shape, it is the same "asset data lives outside WorldState" precedent portraits already
established, applied to a second kind of asset.

Because one source directory here bundles several independently-licensed files (unlike every
other source's single url/sha256/licence), per-stem provenance lives in a companion
**`stems.toml`** (`pipeline.audio.StemBook`/`StemManifest`) rather than the generic
`manifest.toml`, which keeps only what `pipeline.publish._credit`'s generic one-`Credit`-
per-source-directory listing needs. `fetch.py` loops `ensure_verified_artefact` once per
`[[stems]]` entry; `write_outputs()` (the `pipeline.databuild` post-normalise hook
`sources/paleodem/normalise.py` already uses for its globe textures) copies each verified raw
file to `data/media/audio/<id>.<format>` — placed directly at build time, like paleodem's
textures, never staged and copied again at `earthtime publish` time.

**No automated trimming, loudness normalisation or transcoding.** This machine has neither
`ffmpeg` nor `sox`, and macOS's `afconvert` must **not** become a hard pipeline dependency
(every source must build, and every source's tests must run, offline on any machine). `write_
outputs()` therefore does a **verified copy only** — it checks (`pipeline.audio.sniff_audio`,
mirroring `sniff_image`'s "trust bytes over declared type") that a stem's raw file's real
container matches the `format` `stems.toml` declares, then copies it through unchanged. The
consequence is a **sourcing requirement, not a pipeline gap**: whoever fills in `stems.toml`
must pick clips that already arrive pre-trimmed to a clean loop point, ≥20s, and reasonably
level-matched to the rest of the set — `duration_seconds`/`loop_safe` are curator-attested
fields, entered by ear the same way `sources/astronomy`'s checkpoint values are cited numbers a
human typed in, not something this pipeline measures. A local, optional `afconvert`-based
sourcing convenience script may be added later, invoked by a human when picking clips, never by
`earthtime build` or by any test.

**Storage: `git-lfs`**, extending ADR-018's reasoning rather than paleodem's. Unlike paleodem's
~100+ regenerable globe textures (deliberately left uncommitted — DATA_SOURCES.md "generated
media... never committed" note on that source, regenerated locally by `make data`), a specific
CC0 clip hand-picked from a specific archive is as irreplaceable as a pinned generated image if
the archive later vanishes, and the total budget (DECIDED DEFAULTS: <~15 MB) is cheap to store.
`.gitattributes` now tracks `data/media/**/*.{ogg,m4a,mp3,wav}` through LFS, alongside the
existing image extensions.

**Committed fixture**: `sources/audio-stems/fixture/` carries a tiny synthetic (not real —
nothing has been sourced yet) WAV plus a matching `stems.toml`, enough to exercise
`StemBook`/`fetch`/`normalise`/`sniff_audio` offline. The production `sources/audio-stems/
stems.toml` ships **empty** until a human sources the ten stems above (this ADR's own
`audio-stem-wishlist.md` is that brief) — `pipeline.audio.load_stem_book` treats a missing or
empty catalogue as zero stems, not an error, the same "ships partially" pattern
`data/portraits.yaml`/`data/scenes.yaml` already use before anything is pinned.

### 5. Manifest and web types

`pipeline/manifest.py` / `web/src/types/manifest.ts` (mirrored, per that module's own
docstring):

```python
class SceneSound(_WireModel):  # pipeline/manifest.py
    stem: str
    mode: SoundMode  # reused from pipeline.scenes, not re-declared
    gain: float


class AudioStem(_WireModel):
    id: str
    file: str  # published path, relative to assetBase
    title: str
    author: str
    licence: str
    source_url: str
    duration_seconds: float
    loop_safe: bool


class Manifest(_WireModel):
    ...
    audio_stems: tuple[AudioStem, ...] = ()  # wire: audioStems — always emitted, like events
```

`Scene` gains `sound: SceneSound | None = None`. **Per-stem credit lives on `AudioStem` itself**
(`title`/`author`/`licence`/`sourceUrl`), not as N new entries in `Manifest.credits` — that
array stays one `Credit` per `sources/<name>/` directory (unaffected), because a stems
collection bundles several independently-licensed files under one source directory and each
needs its own citation on the credits page (DECIDED DEFAULTS: "every file still credited...
with source URL + licence"). `web/src/shell/manifest.ts`'s parser treats `Manifest.audioStems`
leniently — absent (the committed stub, or any manifest published before this ADR) parses as
`[]`, not a validation failure, the same additive discipline `events`/`effect` already use.

**Alternatives considered.**
- **A fifth curated shape for stems.** Rejected (§4): stems are not time-indexed,
  `WorldState`-projectable data — there is nothing for `WorldModel.at(t)` to interpolate, so
  forcing them through `pipeline/curated.py`'s parquet machinery would add ceremony
  (`_LAYOUTS`, `write_shape`/`read_shape`) for no reader that needs it. The portraits precedent
  (asset data with its own hand-curated book, outside `WorldModel`) already covers this shape of
  problem.
- **One `Credit` per stem in `Manifest.credits` instead of credit-on-`AudioStem`.** Rejected:
  `Credit` (`sourceId`, `title`, `citation`, `licence`, `url`) is keyed one-per-`sources/<name>/`
  directory everywhere else in the manifest; overloading it to also carry N per-file credits
  from one directory would make `sourceId` ambiguous (one real source id, N credit rows) for no
  benefit over reading credit straight off the stem that already needs `id`/`file` anyway.
- **Driving stem gains and score parameters off scalars that aren't curated yet** (temperature,
  biodiversity, population), inventing plausible-looking placeholder curated data to unblock it.
  Rejected outright — CLAUDE.md: "if something is unusable, stop and report; do not silently
  substitute a different dataset." Every stem/parameter above is built only from `t`, literature
  boundary dates, and data that is genuinely published today; the not-yet-curated cases are
  named as explicit follow-ups instead (Consequences), the same way ADR-022 named `paleoclimate`/
  `hyde`/`pbdb` as still `⚠️ TBD` rather than faking their data.
- **A bespoke one-off sound file per scene instead of reusing the stem catalogue.** Rejected:
  DESIGN's own tier-1 stems already cover exactly the categories a scene-specific effect would
  want (volcanic rumble for a lava scene, surf for a shore scene); a second, parallel asset
  pipeline for "scene SFX" would duplicate `sources/audio-stems/` for no new capability — what a
  scene actually needs is a *different envelope* on an existing stem (its own presentation
  weight instead of the tier-1 `t`-curve), which `SceneRecord.sound.mode` already gives it.
- **Firing `once` mode on scrub-reveal too**, on the theory that a fast-scrubbing user should
  still hear scene sounds. Rejected per the DECIDED DEFAULTS-adjacent product read the human's
  own phrasing implies ("when it's visible or first shown" — a viewer watching, not sweeping):
  a stochastic effect firing every time a fast scrub crosses a scene's `mix = 1` point would
  fire many times a second during a fast scrub and read as glitchy, not atmospheric; `loop` mode
  already gives scrubbing a sound response (continuous, gain-following), which is the correct
  one for that interaction.

**Consequences.**
- `pipeline/audio.py` is new: `StemManifest`, `StemBook`, `load_stem_book`, `AudioFormat`,
  `sniff_audio`. `pipeline/scenes.py` gains `SoundMode`/`SceneSound`/`SceneRecord.sound`.
  `pipeline/manifest.py` gains `SceneSound`/`AudioStem`/`Manifest.audio_stems`. `pipeline/
  publish.py` gains `_validate_scene_sound`/`_scene_sound`/`_audio_stems`, wired into
  `prepare_publication`. `sources/audio-stems/{manifest.toml, stems.toml, fetch.py,
  normalise.py, README.md, fixture/}` are new. `.gitattributes` gains four audio extensions.
  `web/src/types/manifest.ts` gains `SoundMode`/`SceneSound`/`AudioStem`/`Manifest.audioStems`/
  `Scene.sound`; `web/src/shell/manifest.ts` parses both leniently.
- **Not implemented by this ADR**: the web audio engine itself (`audio/engine.ts`,
  `stemGains`/`scoreParams`/`sceneSoundGains`, the HUD speaker toggle, Tone.js wiring,
  localStorage persistence) — that is a precise contract handed to the web engine agent
  (`audio-engine-spec.md`), not pipeline/contract work. The manifest today publishes
  `audioStems: []` (no stems sourced yet) and no scene carries a `sound` — both are wired,
  tested, and ready for real content and real UI, but produce no audible change until both
  land.
- **Real stems must still be sourced** (`audio-stem-wishlist.md`) before tier 1 or scene sound
  can be heard; `data/scenes.yaml` entries can add `sound:` referencing a stem id the moment
  that stem exists in `stems.toml` and its file lands in `data/media/audio/` — `earthtime
  publish` enforces the ordering (unknown-stem and missing-file refusals) so this can never
  silently drift out of sync.
- **When `paleoclimate`/`hyde`/`pbdb` land**, `storm`'s flat baseline and `settlement`'s
  present-proximity proxy above are the two ambience curves most worth revisiting (real
  precipitation and real population would replace their placeholders directly); the score's CO2-
  as-temperature-proxy and t-as-density-proxy are the two score mappings worth the same
  revisit. None of this requires a contract change — `stemGains`/`scoreParams` already take
  whatever published series exist, so a new series is a new mapping row, not a new signature.
- Publishing a manifest with scene sound links or stems now costs nothing extra in spend
  (audio is free — DESIGN §13's budget table already lists "audio" at $0) and adds a bounded,
  measured amount of LFS-tracked media (<~15 MB target, DECIDED DEFAULTS), not image-generation
  budget.

**Amendment (2026-09-14): stem set v2 (era audit).** *Status: accepted, human-directed
(listening feedback on v1).* The human reported insect and bird sounds too early, no dinosaurs, a
"water" sound at the K-Pg impact, agriculture and industry arriving late, police sirens in 1830,
and livestock and insects still prominent 100 years ago. A spectrogram audit (nobody could listen)
confirmed the causes: `machinery` was a modern Budapest station recording whose loop is ~75%
electronic siren; `volcanic` was a bubbling hot-spring recording, also fired as kpg-arrival's
scene sound and swelled by the adjacent Deccan flood-basalt bump; `mammals` was a goat herd held at
0.32 to the present; `insects` was a cicada chorus from 370 Ma; `birds` was a songbird chorus from
100 Ma; and nothing attenuated wildlife under human noise.

**Decision.** (1) Stems split into **ambience** stems, which have a `stemGains` row, and
**scene-only** stems, reachable only through `SceneRecord.sound`. Ambience: `wind`, `water`,
`storm`, `volcanic` (re-sourced as deep rumble), `insects` (re-sourced as an orthopteran chorus),
`birds`, `archosaurs` (new; public-domain USFWS alligator bellows), `mammals` (re-sourced as a wild
savanna bed), `livestock` (the former goat clip), `fire`, `settlement`, `industry` (new; steam
engine, with no vehicles, sirens or electronic hum) and `traffic` (new; siren-free motor city).
Scene-only: `geothermal` (the former hot-spring clip, loop) and the one-shots `impact`, `rocket` and
`aircraft`. `machinery` is retired. A one-shot is a stem with `loop_safe = false`, and publish
refuses a `loop`-mode scene sound that names one (`_validate_scene_sound`; it would get no looping
player and play nothing). (2) Curves are re-dated to cited boundaries.
Insect stridulation starts in the late Carboniferous–Permian (Song et al. 2020) and grows through
Triassic ensiferans and the 165 Ma *Archaboilus* (Gu et al. 2012), with loud cicadas only from
~59–56 Ma. Songbird chorus starts only after K-Pg (the 69 Ma *Vegavis* syrinx implies honks: Clarke
et al. 2016) and rises with passerines (~47 Ma: Oliveros et al. 2019). Archosaur bellows run from
243 Ma (`dinosaurs` t_max) to the impact itself, silent from `kpg-darkness` days later
(closed-mouth low-frequency calls are plausible in dinosaurs: Riede et al. 2016).
Wild mammals follow the Paleocene radiation and grassland spread, reduced by the Late Quaternary
extinctions. Livestock follows `livestock-domestication`. Settlement follows `homo-sapiens-origin`
(faint camp voices), `natufian-settlements`, `agriculture` and `uruk-first-city`. Industry follows
`industrial-revolution`, reaching 0.5 by 1830, then declines with electrification. Traffic starts
with the Model T (1908). (3) A pure `humanDominance(t)` (0 before 1761, 0.7 by ~1900, 1.0 by
~2007) ducks insects, birds, wild mammals, livestock and fire. About 100 years ago is therefore
industry-dominated, and the present is traffic and settlement with faint birds. (4) The
flood-basalt `volcanic` bump drops from 0.6 to 0.45 so the `impact` one-shot owns the K-Pg moment.
*The bump is dormant as shipped:* no published event carries a `flood-basalt` effect
(`siberian-traps` and `deccan-traps` have none in `data/events.yaml`; docs/GLOBE.md §6 notes the
same gap for G6), so `floodBasaltWindows(manifest)` is empty and only the unit tests, which pass
hand-written windows, exercise it. Adding those effects is the globe work's call, and needs no
audio change. (5) Scene sounds are re-assigned (53 scenes as of the 2026-09-15 review: 30 carry a
sound, 26 loops and 4 once, and 23 are deliberately silent): kpg-arrival → `impact`,
industrial-mill-town → `industry`, first-powered-flight → `aircraft`, apollo-11-launch → `rocket`,
trinity-test → `impact`, modern-city → `traffic`, plus wind, water, settlement, archosaurs,
mammals, livestock and geothermal loops where a scene's own setting calls for them. A once-mode
voice now fades out when its scene is no longer dominant. (6) **No sirens in any stem,
scene sound or era**, the present day included (human direction, 2026-09-14): modern city audio
reads as busy road traffic and city hum.

**Known substitutions (documented, not silent).** No public-domain Saturn V recording was found,
so `rocket` is a CC0 re-edit of public-domain NASA **Space Shuttle** launch audio. No CC0/PD Wright
Flyer engine recording exists, so `aircraft` is a modern single-prop biplane flyby at low gain. No
acceptable CC0/PD large "dinosaur call" exists beyond alligator bellows; sound-designed roars built
from lion and elk samples were rejected as mammalian. **Size:** v2 as shipped after the
2026-09-15 review is ≈ 21.6 MB of LFS audio (17 files, `sources/audio-stems/manifest.toml`
`volume_bytes`) against the "<~15 MB" default, **pending human sign-off**. No remaining fallback
choice reaches 15 MB: the plan's ≈ 17 MB grew to 19.1 MB when sourced (the `mammals` fallback was
taken for its loop quality, not size) and to 21.6 MB when `birds` and `mammals` were re-sourced
below.

**Consequences.** `StemGains` covers ambience ids only; `STEM_IDS` becomes the union of
`AMBIENCE_STEM_IDS` and `SCENE_STEM_IDS`. The web engine plans voices with a pure
`planStemVoices(manifest.audioStems)`: ambience and loop-safe scene-only stems get a looping
player, one-shots get a buffer only and can never loop as ambience. No wire-format change in this
amendment (`AudioStem` and `SceneSound` unchanged; the next amendment adds two fields). No image
digests or pins are affected (`scene.sound` stays outside the asset graph).

**Amendment (2026-09-15): stem levels and loop regions.** *Status: accepted as a fix for the v2
review; the size figure above still needs sign-off.* A review measured the shipped clips at ~29 dB
apart (gated A-weighted loudness: `mammals` -17.8 dB to `insects` -46.7 dB), so a gain value did
not predict what was heard: most loop scene sounds changed the mix by ≤0.2 dB, `trinity-test`'s
blast sat 10 dB under the bed, and the carefully dated `insects` curve was inaudible in every era.
It also found `birds` was one songbird phrase repeating every ~2.8 s, `mammals` mostly a cricket
drone, `volcanic`'s crater blasts under every Phanerozoic scene with a click at its wrap,
`wind` with two edit splices and silent ends, surf under arid inland scenes, and archosaur bellows
under `kpg-darkness`/`kpg-aftermath`.

**Decision.** (1) **Per-stem level trim, attested at sourcing, applied at playback.** `stems.toml`
gains required `loudness_db`/`peak_dbfs`, measured with `sources/audio-stems/levels.py` (numpy,
run by hand on a decoded clip: 400 ms blocks, A-weighted, gated at -70 dB absolute and -10 dB
relative, channels averaged). `StemManifest.level_trim_db` brings loops to -30 dB and one-shots to
-20 dB, capped so no peak passes full scale at unity gain; every loop lands within 1.5 dB of -30
(`rocket` stays 4.8 dB under its reference, its launch transient already at -0.2 dBFS). The
pipeline still decodes nothing and ships the downloaded bytes (§4's no-DSP rule stands); the
engine multiplies the trim into every curve, scene-loop and once gain. One-shots sit 10 dB above
the bed reference so a foreground event reads over it at the same scene gain. (2) **Loop regions.**
An optional `loop = { start_seconds, end_seconds }` (loop-safe stems only, inside the clip) is
passed to the looping player's `loopStart`/`loopEnd`, chosen from the decoded samples at matched
level and near-equal samples: `wind` 23.74–77.81 s between its splices, `volcanic` 0.87–26.95 s
(its own ends jumped 0.05 against a 0.0016 median step), and the two re-sourced clips. (3)
**Re-sourced (CC0, spectrogram-checked):** `birds` → Synge101 "Dawn chorus" (Freesound 611453, a
96 s multi-species chorus, no hum); `mammals` → KevZim "Lions in Gonarezhou" (531439, a distant
roaring bout with no insect bed). Rejected candidates and reasons are in each `stems.toml`
comment. (4) **Curves.** `volcanic` fades from 0.15 to 0 across 540→420 Ma, so the crater-rim clip
is a Precambrian bed plus the magma-ocean scene loop (and the dormant flood-basalt bump).
`water` drops by 0.2 to 0.25 across the same `land-plants` → `first-forests` window that softens
`wind`, and `devonian-estuary` gains a water loop; coastal scenes carry their own. Archosaurs
start at 243 Ma and are silenced within days of the impact (`kpg-darkness`), not across
`k-pg-impact`'s 11 kyr dating interval. (5) **Scene gains re-tuned** against trimmed levels
(loops 0.8–1.0, `first-powered-flight` 0.8, `trinity-test` 0.8, `apollo-11-launch` 1.0), so in a
power-sum estimate each scene's own sound is its loudest element: loops by 3–7 dB over the next
stem, the impact 13.7 dB over the K-Pg bed, Trinity +9.7 dB, the launch +7.2 dB, the biplane
+7.3 dB. Nobody has listened; this is the measured estimate. (6) Dev-only
`window.__earthtimeAudio` adds `getStemTargets()` and `getActiveOnceVoices()` for browser QA.

**Contract addition (additive, wire).** `AudioStem` gains required `levelTrimDb` and optional
`loop: {startSeconds, endSeconds}` (`pipeline/manifest.py`, `web/src/types/manifest.ts`,
`web/src/shell/manifest.ts`, which rejects a region that ends before it starts). The stub manifest
carries `levelTrimDb: 0`.

**Rejected: loudness-normalising the published files.** It needs a decoder and encoder in the
pipeline (§4), and a re-encode of lossy previews loses quality for what one number does.
**Rejected: a web-side trim table keyed by stem id.** Levels belong to a specific clip; a table in
the engine would silently go stale the next time a stem is re-sourced.

**Consequences.** Re-sourcing a stem now means measuring it (README "Sourcing checks"). Other
browsers may decode an MP3 with a different priming offset, moving a loop point by a few
milliseconds; regions are picked at matched level so that degrades to a soft wrap, not a gap.

**Amendment (2026-09-15): era fit v3.** *Status: accepted, human-directed (listening feedback on
v2).* The human reported wind/storm/water surf-and-wind sound persisting through a forest scene
at ~346 Ma and "through the whole timeline" generally, insects starting late and sounding too
quiet at 248 Ma with nothing filling in for large animals by then, cricket texture (rather than a
pronounced buzz) at the 90 Ma pollination scene, and three specific scene requests: stone-knapping
sound for the early stone-tool scene, a mammoth call for the ice-age steppe scene, and (already
satisfied, confirmed unchanged) that archosaurs at 154 Ma, the impact, ~12 Ma mammal calls,
settlement voices and industry at ~162 yr stay as they are.

**Diagnosis.** `stemGains(t)` was checked at each named checkpoint (`web/src/audio/
stemGains.test.ts`) against the manifest's dominant scene at that `t` (`sceneAt`, `web/src/scene/
scene.ts`, nearest-pair dissolve in `log1p(t)` space). At 346 Ma the dominant scene is
`late-devonian-tetrapod` (a forested stream, `first-forests` already 32 Myr in the past) yet
v2's `wind`/`water`/`storm` curves were still at 0.32/0.25/0.22 (corrected 2026-09-15: the "era
fit v3 fixes" amendment's own adversarial review recomputed these directly from the v2 formulas
and found this text understated them) — a real, measured bed, not a
perception — because v2 only *softened* them across `land-plants` → `first-forests`
(470 → 378 Ma) and then held them flat forever; nothing ever took them to 0. At 248 Ma
(`early-triassic-lystrosaurus`, a Lystrosaurus synapsid scene) `insects` was already 0.1 — audible
in isolation — but read as "late" and "too quiet" because it sat under a still-present pre-land
bed roughly 6-9x louder in aggregate, and no stem existed for the large low animal the scene
itself depicts. At 90 Ma (`mid-cretaceous-pollinators`) the only insect texture was the ambient
`insects` stem's cricket clip; nothing gave the scene's own wasp/bee-like pollinators a
foreground voice. `acheulean-erectus` and `pleistocene-steppe` had no scene sound naming a
human-tool or megafauna-call stem because none existed in the catalogue.

**Decision.** (1) **`wind`/`water`/`storm` become a pre-land bed only.** A new shared
`terrestrialBedFade(t)`, `rampLog(t, 3.85e8, 3.5e8, 1, 0)` (385 Ma rounds `first-forests`'
`t_min` 3.78e8; 350 Ma sits inside the Mississippian, past the 358.9 Ma Carboniferous boundary
once `carboniferous-swamp`'s canopy at 310 Ma is closed), multiplies all three curves so each is
**exactly 0** for every `t <= 350 Ma` — verified directly
(`stemGains.test.ts` "wind/water/storm are exactly 0 for every t <= 350 Ma"). Past this window
they are heard only where a scene's own `sound` names them. Every scene from ~360 Ma to present
was audited (`data/scenes.yaml`): coastal/estuary/landfall scenes (`devonian-estuary`,
`columbus-landfall-1492`) already carried or kept a `water` loop (corrected 2026-09-15: the
original text also named `panama-land-bridge`, which is unpinned and absent from the published
manifest — nothing there to check); ice/snowball/salt-flat/steppe scenes (`gondwana-ice-margin`,
`eocene-oligocene-icesheet`, `messinian-salt-flats`, `kpg-darkness`) already carried or kept a
`wind` loop; `pleistocene-steppe`'s wind moved to `ice-age-europe-neanderthal` (both are open
cold steppe; see (4)) so pleistocene-steppe's one `sound` slot could carry the mammoth call
instead. No forest, swamp, savanna or city scene gained a wind/water/storm loop. (2) **New
ambience stem `forest`**: a humid, frog-free forest/swamp bed, `rampLog(t, 3.7e8, 3.5e8, 0, 0.3)`
— rising as the pre-land bed fades, reaching its full 0.3 baseline by 350 Ma and holding as the
terrestrial backdrop ever after, ducked by `humanDominance` (depth 0.8) like the other wildlife
stems. Sourced with **no frog calls at all** (anuran calls are implausible before ~250 Ma —
Permian-Triassic origin of Salientia/proto-frogs — so a clip used from the Carboniferous onward
cannot carry them at any point) and no birdsong (the `birds` stem already owns that, dated
separately).
**Correction (2026-09-15, "era fit v3 fixes"): the clip sourced here was wrong, and both it and
the ramp are superseded.** This text claimed the clip (craigsmith "Big Jungle Ambience", CC0)
showed "continuous 150-4000 Hz rustle/hum texture, no FM bird chirps, no periodic frog croaking"
— false: re-zoomed spectrograms found dozens of curved 3-6.5 kHz FM chirps and arched harmonic
"hoop" calls, bird- or primate-like anachronisms 300+ Myr before anything could make that sound.
It was replaced (SamsterBirdies "Rain on Leaves", CC0, verified frog- and bird-free by the same
method) and the ramp moved to 385→370 Ma; see the fix amendment's own §2 for the corrected clip,
dates and verification. The no-frogs/no-birdsong sourcing constraint above is unchanged and still
applied to the replacement. (3) **`insects` re-dated earlier, in two
new stages ahead of the existing ones.** A `terrestrialBedFade`-matched stage
(`rampLog(t, 3.85e8, 3.5e8, 0, 0.1)`, general terrestrial-arthropod wing-hum, rising in lockstep
with `forest`) plus a `rampLog(t, 3.25e8, 3.0e8, 0, 0.08)` stage for unambiguous winged insects
and giant griffinflies (Grimaldi, D. & Engel, M.S. (2005). *Evolution of the Insects*. Cambridge
University Press — Upper Carboniferous, ~325 Ma; Meganisoptera such as the `carboniferous-swamp`
scene's own Meganeura by the Late Carboniferous), ahead of the existing Song et al. 2020
stridulation, Gu et al. 2012 ensiferan and cicadid stages (unchanged). The existing single
cricket-loop clip continues to stand in for "insect presence" across every stage, the same
abstraction v2 already made for stridulation/ensiferan/cicada together — a literal wing-buzz vs.
cricket-song split was considered (the sourcing brief asked "split if needed") but not built: the
newly-sourced `buzzing` clip (4) is a bee/fly wingbeat, not a Carboniferous dragonfly-relative's,
and reusing it as an ambient bed would be its own anachronism. Verified: insects audible (`> 0`)
at every `t <= 350 Ma` tested down to 320 Ma, and exactly 0 for `t >= 385 Ma`.
**Correction (2026-09-15, "era fit v3 fixes"): this whole paragraph is superseded.** Grimaldi &
Engel 2005 dates unambiguous WINGED insects from ~325 Ma — it does not support a stridulating
clip playing from 385 Ma, and the only clip catalogued (`Nox_Sound` "Night Crickets Calm Loop") is
a cricket-stridulation loop, not a generic wing-hum: Song et al. 2020 dates that specific
character (forewing stridulation) to ~300 Ma, 25-85 Myr after this paragraph started it. Both new
stages here are dropped; `insects` starts at 300 Ma. See the fix amendment's own §3 for why no
earlier-dated replacement clip was sourced. (4) **New ambience
stem `large-animal`**: Nivatius "Bison Bellowing (Yellowstone)" (CC0, five discrete broadband
bellows, no insect/bird bed), `rampLog(t, 2.7e8, 2.5e8, 0, 0.32) * rampLog(t, 2.01e8, 1.75e8, 1,
0)` — audible from the Guadalupian large-synapsid radiation (Kemp, T.S. (2005). *The Origin and
Evolution of Mammals*. Oxford University Press: dinocephalian/gorgonopsian megafauna dominant by
~270-260 Ma) through the Triassic, then receding across the same `end-triassic-extinction` window
(2.01e8-1.75e8) `archosaurs`' own second ramp rises across — a real handover, both stems present
231-175 Ma, `large-animal` at exactly 0 by 175 Ma so it never lingers under Jurassic dinosaur
scenes. Verified `large-animal(248 Ma) ≈ 0.32` (clearly audible, the checkpoint the human's
feedback named) and `large-animal` exactly 0 both before 275 Ma and from 175 Ma on. A real bison
stands in for an extinct large synapsid/reptile, the same "plausible modern proxy" precedent
`archosaurs` (alligator bellows for archosaurs) already set — never a lion roar or a modern-bird
call. `permian-interior` (260 Ma, two Moschops-like dinocephalians at a river) and
`early-triassic-lystrosaurus` (251 Ma, superseding its v2 `wind` loop — the checkpoint the
feedback named by t) both now carry `large-animal` as their scene sound.
**Correction (2026-09-15, "era fit v3 fixes"): the recession window and one clause here are
superseded.** "dinocephalian/gorgonopsian megafauna dominant by ~270-260 Ma" overstates Kemp
2005: dinocephalians dominate the Guadalupian (~270-260 Ma), but large gorgonopsians are a later,
Lopingian radiation, after the dinocephalians' own end-Guadalupian extinction — corrected wording
in the fix amendment's own §4. Separately, `large-animal`'s recession window moved from
2.01e8-1.75e8 to 2.31e8-2.01e8 (the fix amendment's own §4): the original window left
`large-animal` still louder than `archosaurs` at `late-triassic-dinosaurs` (231 Ma) and for the
~30 Myr after it, not just at that one checkpoint. (5) **Three new
scene-only stems, one per explicit request:** `buzzing` (fury12 "Bee Flying Loop", CC0, a
continuous wingbeat-harmonic drone) as `mid-cretaceous-pollinators`' `loop` sound, gain 0.9 —
dated by the scene's own `earliest-pollinating-insects` window (data/events.yaml, 9.3e7-1.65e8);
`knapping` (xtra1 "Stone on Stone Hit", CC0, ~15 evenly-spaced sharp broadband strikes) as
`acheulean-erectus`'s `loop` sound, gain 0.9; `mammoth` (Danjocross "Angry Elephant", CC0, one
rising-harmonic trumpet call) as `pleistocene-steppe`'s `once` sound, gain 1.0 — **no CC0/PD
mammoth recording exists** (mammoths have been extinct since ~4 ka, millennia before sound
recording), so this is a documented substitution, a single modern elephant trumpet standing in
for a mammoth's, on the same "plausible proxy" precedent as `archosaurs`/`large-animal`; a
25-blast 52 s craigsmith reel was rejected as reading like a stock-library sting rather than one
call for a `once` trigger. (6) **Unchanged, verified by checkpoint:** `archosaurs(154 Ma) ≈ 0.35`
(`jurassic-floodplain`, the sauropod scene), the `impact` one-shot, `mammals` at ~12 Ma
(`miocene-grassland`/`c4-savanna-hipparion`), `settlement`'s Natufian/agriculture ramps, and
`industry(195 yr) ≈ 0.5`, still clearly louder than every wildlife stem a century-plus ago —
none of their formulas changed, so none of their values did either.

**New sourcing this amendment (CC0, spectrogram-checked 2026-09-15):** `forest` (craigsmith,
Freesound 479573 — **superseded 2026-09-15 by the "era fit v3 fixes" amendment**: SamsterBirdies,
584272), `large-animal` (Nivatius, 519594), `buzzing` (fury12, 496237), `knapping` (xtra1, 858891),
`mammoth` (Danjocross, 507467). Rejected candidates and reasons are in each `stems.toml` entry's
own comment (frog/bird/cicada-tagged forest candidates; a heavier brick/concrete-slab "stone on
stone" candidate for knapping; the multi-blast elephant reel for mammoth). **Size:** raw audio
grows from ~21.6 MB to ~24.3 MB (22 stems) — still over the "<~15 MB" default, but the human has
separately said audio size is not strictly budgeted and the 21.6 MB figure was already accepted,
so this is reported, not trimmed.

**Consequences.** `AMBIENCE_STEM_IDS` gains `forest` and `large-animal`; `SCENE_STEM_IDS` gains
`buzzing`, `knapping` and `mammoth` (`web/src/audio/stemIds.ts`) — no wire-format change (`id` is
already a plain string on `AudioStem`/`SceneSound`, checked against the catalogue at publish
time, `_validate_scene_sound`). `pleistocene-steppe` and `ice-age-europe-neanderthal` trade which
one carries the (moved, unchanged-gain) `wind` loop, since a scene's `sound` is one stem, not a
list, and the mammoth call was the more specific ask. No image digests or pins are affected
(`scene.sound` stays outside the asset graph, unchanged from v2).

**Amendment (2026-09-15): era fit v3 fixes.** *Status: accepted, fixing a review of the "era fit
v3" amendment above (adversarial audio sanity: recomputed `stemGains` at every named checkpoint
and every scene's own `t`, spectrogram-checked the new clips, cross-checked the citations).* Every
issue below is corrected in place in the amendment above (search "Correction (2026-09-15" for each
one) as well as summarised here; `stemGains.ts`'s own comments carry the same citations inline.

**1. `forest`'s clip was the anachronism it claimed not to be (high).** Re-zoomed spectrograms of
craigsmith "Big Jungle Ambience" (479573) at 14-26 s and 66-73 s show dozens of curved 3-6.5 kHz
FM chirps and arched harmonic "hoop" calls stacked at 1.4/2.8/4.2/5.6 kHz — bird- or primate-like,
300+ Myr before anything could make that sound, and at 346 Ma (the human's own checkpoint) louder
than `insects`. Replaced with SamsterBirdies "Rain on Leaves" (Freesound 584272, CC0 1.0): full
spectrogram shows a continuous broadband rain-on-foliage patter, no tonal ridges or periodic calls
anywhere across its 49.9 s (verified independently, not just re-trusted from the sourcing agent's
own claim). A single louder gust at 19.5 s (-3.7 dBFS, otherwise a maximum of -5.4 dBFS anywhere)
would have capped this loop's level trim 2.1 dB short of the -30 dB loop reference; the loop
region instead starts at 20.35 s, found by scanning 19.7-21.5 s for the smallest two-channel
sample jump against the clip's own natural end (0.0039, under the clip's own 0.0078 median
sample-to-sample step).

**2. The bed fade lagged the scene it was fixing for (medium).** `late-devonian-tetrapod` (a
forested stream) is the dominant on-screen scene from 370.0 Ma (the `devonian-estuary`/
`late-devonian-tetrapod` dissolve midpoint) to 336.4 Ma, but `terrestrialBedFade`'s 350 Ma
floor left the pre-land bed audibly louder than `forest` for the first third of that dwell (at
365 Ma: wind -47.7 dB vs. forest -57.5 dB, effective loudness). `TERRESTRIAL_BED_FADE_END` moves
from 3.5e8 to 3.7e8 — the bed is now exactly 0, and `forest` already at its full baseline, from
the instant the scene needs it, not 20 Myr later — and `forest`'s own ramp start moves from 3.7e8
to 3.85e8 (matching `TERRESTRIAL_BED_FADE_START`) so the two cross-fade in lockstep. New checkpoint
tests pin 370/365/360 Ma.

**3. `insects`' two earliest stages misapplied their own citation (medium).** Grimaldi & Engel
2005 dates unambiguous WINGED insects from ~325 Ma; the only clip catalogued is a cricket
STRIDULATION loop, and Song et al. 2020 dates that specific character to ~300 Ma. The 385 Ma
"general wing-hum" and 325 Ma "griffinfly" stages played this same stridulating clip 25-85 Myr
before either citation actually supports. Both stages are dropped; `insects` now starts at
300 Ma. No non-stridulating wing-drone clip was sourced to fill the 385-300 Ma gap a second
search pass (freesound.org, "insect wings drone") turned up nothing usable, so per the standing
"leave it out and say so" rule, `insects` is honestly silent there rather than carrying an
anachronism — a real, partial concession against the human's literal "insects around 346 Ma" ask,
weighed against not shipping a clip whose only citation contradicts that date. `forest` alone
(present from 370 Ma) carries the "forest/swamp" half of that ask.

**4. `large-animal` still outweighed `archosaurs` at the first-dinosaur scene (low), and one
citation clause overstated its source (low).** At `late-triassic-dinosaurs` (231 Ma) and for
~30 Myr after it, `large-animal` (0.32) was louder than `archosaurs` (0.18-0.24) under the old
2.01e8-1.75e8 recession window. The window moves to 2.31e8-2.01e8 — starting the recession at
the same instant `dinosaurs`' own radiation (and `archosaurs`' first ramp) does, clearing to
exactly 0 by 201 Ma instead of 175 Ma. `large-animal` is still 0.32 at 231 Ma itself and
unavoidably so: large synapsids/reptiles genuinely still dominated Triassic biomass at the very
moment the first tiny dinosaurs appear (the scene's own `subject.fauna` names rhynchosaurs and a
cynodont, not a big archosaur), so an `archosaurs` scene sound was considered and rejected as a
worse content match, not adopted. Separately, "dinocephalian/gorgonopsian megafauna dominant by
~270-260 Ma" is reworded to distinguish Guadalupian dinocephalians from the later, Lopingian
gorgonopsian radiation (Kemp 2005) — the original wording implied both were co-dominant at the
same date.

**5. Nothing suppressed `forest`/`insects`/`birds`/`mammals` under lifeless, frozen or burnt
scenes (medium) — including `pleistocene-steppe` losing its wind with nowhere else to put it
(medium).** `sceneSoundLoopGains` only ever foregrounds a stem above its curve (`Math.max`), never
suppresses it, so a scene whose own `subject.vegetation`/`fauna`/`absent` rules out all life still
sat under the full ambient wildlife bed: `eocene-oligocene-icesheet` (33.7 Ma, "no forest anywhere
in view... no animals in view"), `messinian-salt-flats` (5.6 Ma, "absent: any plant, any animal")
and `gondwana-ice-margin` (300 Ma, "fauna: none") all measured `forest`≈0.30 and non-trivial
`insects`/`birds`/`mammals` at their own `t`, and `kpg-darkness`/`kpg-aftermath` (K-Pg impact and
its century-later aftermath) carried `forest`/`insects` when the scene itself shows a dead, ashen
forest. Two mechanisms, chosen over extending `SceneSound` to a list or adding scene-aware
parameters to `stemGains` (out of scope for a fix pass and this task's own file ownership):
- `kpgVegetationDuck(t)` — the K-Pg impact was a genuine GLOBAL catastrophe, so a `t`-only curve
  is the right model: falls from 1 to 0 across the ~4-day pyroclastic pulse (the same window
  `archosaurs` already ducks across), stays there through `kpg-darkness` and `kpg-aftermath`, then
  recovers to 1 by 64.1 Ma (Johnson & Ellis 2002's Castle Rock rainforest), a real dated citation
  for the recovery point, not a screen-time guess.
- Three `presenceNotch`-based ducks for the other three scenes, which were NOT global events at
  the time (most of Earth still had rainforest at 33.7 Ma) — each is centred exactly on that one
  scene's own `t`, bounded by its dominant span's dissolve-midpoints to its manifest neighbours on
  each side, documented as approximating "what's on screen right now" rather than mis-citing the
  real, longer duration of the geological event depicted.
Both mechanisms use a new shared `presenceNotch(t, olderEdge, centerT, youngerEdge)` helper (1 at
both edges, exactly 0 at `centerT`) rather than the existing `bump()`, whose arithmetic-mean-
midpoint centring left the barren-scene ducks reaching only ~30% suppression at some scenes' own
`t` in an earlier draft of this fix — `bump()` itself is unchanged (shared with `score.ts`'s
catastrophe-proximity dissonance, out of this fix's scope). Separately, `pleistocene-steppe`
(20 ka, "a cold, dry steppe") lost its `wind` loop to `ice-age-europe-neanderthal` in the v3
amendment above so its one `sound` slot could carry the mammoth call — true, but the v3 text's
claim that every ice/steppe scene "already carried or kept a `wind` loop" was not true of this
one. A dated Last Glacial Maximum bump (Clark, P.U. et al. (2009). "The Last Glacial Maximum."
*Science* 325(5941), 710-714: ~26.5-19 ka) adds `wind` back into the global curve — the same
mechanism `volcanic`'s flood-basalt bump already uses — centred with `presenceNotch` exactly on
20 ka so it peaks at its full gain right at the scene, without reaching into
`ice-age-europe-neanderthal` (42 ka) or `gobekli-tepe` (11.5 ka).

**6. Two low-severity provenance/measurement issues.** The mammoth one-shot's ~1.4 s near-silent
lead-in is now actually skipped in playback, not just noted in `stems.toml`: `pipeline.audio.
StemManifest` gains a `start_seconds` field (one-shots only — a loop trims its head via `loop`
instead), threaded through `AudioStem.startSeconds` on the wire and applied as `Tone.Player.
start(undefined, startSeconds)` in `engine.ts`'s `playOnce` — the v3 build had written
`start_seconds = 1.3` into `stems.toml` without adding this field anywhere, so publish rejected
the catalogue outright (`ValidationError: stems.21.start_seconds — Extra inputs are not
permitted`) until this fix added it. Separately, `buzzing`'s attested near-zero wrap jump did not
reproduce at 48 kHz (the engine's actual device rate) — decoded there it is 0.0142 against a
0.0031 median step, ~4.7x, audible on this harmonic drone even where it would be fine on
broadband noise (`forest`, `large-animal`, `knapping` all still hold up at 48 kHz, re-verified).
A full grid search over every (start, end) pair at least 2 s apart, decoded at 48 kHz, found a new
region (1.276-4.128 s) at a 1.6e-6 wrap jump against the same median — as tight as this clip has
anywhere. `forest`'s own new loop region (above) was chosen and verified the same way from the
start.

**Unresolved.** A literal wing-buzz-vs-cricket-song split stem for `insects`' pre-300 Ma gap
(item 3) was searched for but not sourced — flagged, not silently worked around. The "one global
bed regardless of scene" pattern `forest`/`insects`/`birds`/`mammals` still have outside the four
explicit ducks above (e.g. `forest` under a desert scene with no barren duck of its own) remains
the same architectural gap the v3 amendment above already flagged as future debt; this fix widens
the duck mechanism's precedent (four instances now, `presenceNotch` a reusable building block) but
does not generalise it into a `SceneSound`-driven mute list, which would need a schema change
outside an audio-only fix pass's file ownership.

**Amendment (2026-09-15): on-demand loading.** *Status: accepted, human-directed ("how will
they or could they be loaded when running as website after deploying, some way to efficiently
dynamically load on demand instead of all upfront or something?").*

**Context.** Every catalogued stem (22 clips, ~24 MB raw, ADR-023 §4/§1 amendment "era fit v3")
was fetched and decoded **eagerly**, all at once, the moment sound was first switched on
(`engine.ts`'s original `buildRuntime`: one `Tone.Player` per ambience/loop-safe scene stem,
one bare buffer per one-shot, built in a loop over the whole catalogue). That is fine for ~24 MB
on a fast connection, but does not scale: it is the wrong shape for a bigger stem set later, for
a slow/metered mobile connection, and it holds every decoded buffer in memory for the whole
session regardless of whether `t` ever revisits most of them.

**Decision.** Three new pieces, kept as separate, independently-testable layers (mirroring how
`globe/lru.ts`/`globe/textureCache.ts` already split "pure eviction bookkeeping" from "the
component that drives it" for the globe's own bounded texture cache):

1. **A pure planner, `loadPlan.ts`'s `stemsNeeded(input)`.** Given `t`, the live `Playback`
   (`playing`/`baseRate`/`speed` — reused directly rather than inventing a parallel "rate and
   direction" pair, since the store already has exactly this shape), the selected era section's
   window (ADR-024) and the manifest's scenes/stems, returns the set of stem ids whose buffer
   should be decoded right now: every ambience stem whose `stemGains` curve exceeds `0.01`
   anywhere in a lookahead window, plus every stem named by a scene's `sound` whose own `t`
   falls inside that window. The lookahead window (`lookaheadWindow`) is asymmetric while
   playing — a few seconds of `baseRate * speed` in `log1p(t)` space (the same space every
   curve is authored in) ahead of `t`, a smaller backstop behind — and a small **symmetric**
   margin while not playing, since a paused, scrubbed or jumped `t` gives this function no way
   to tell a slow drag from a discontinuous section jump; both are read the same way, from `t`
   alone. Always clamped to the selected section's window: the hard backstop against the
   symptom the human named directly ("scrubbing across eras must not trigger a burst of every
   stem") — a big jump can move `t` a long way, but the window it asks the loader to fill never
   reaches back across the ground it crossed to get there. Pure, `tone`-free, unit tested
   (`loadPlan.test.ts`): the lookahead shape in both playback states, a stem provably silent
   throughout a window is never returned (checked against real `stemGains` output at fixed `t`,
   not a mock), scene stems in/out of the window, filtering to the published catalogue.
2. **A loader, `bufferCache.ts`'s `StemBufferCache`.** Generic over the decoded buffer type
   (no `tone` import here either), it turns `stemsNeeded`'s output into a bounded action list
   each tick: `plan(needed, orderedByDistance, now)` returns `toFetch` (ids not yet `ready`,
   capped at 3 concurrent, in `stemsNeeded`'s own nearest-`t`-first insertion order — a JS
   `Set`'s iteration order *is* its insertion order, so `loadPlan.ts` produces the priority
   ordering for free rather than the loader re-deriving "how urgent") and `toEvict`. `engine.ts`
   drives it: `startLoadingStem` fetches+decodes (`fetchStemBuffer`, wrapping `new Tone.
   ToneAudioBuffer(url, onload, onerror)` in a promise) and, once a loop-kind stem's buffer is
   ready, builds its actual `Tone.Player` for the first time — starting at the gain node's
   already-0 initial value with the player's own existing `fadeIn` (`AMBIENCE_FADE_SECONDS`),
   so a late arrival is inaudible by construction, not a new mechanism. Unit tested as plain
   state transitions (`bufferCache.test.ts`), no timers or I/O: concurrency capping, retrying an
   `error` entry like an untracked one, and both eviction rules below.
3. **Eviction, two independent rules inside the same `plan()` call, neither ever touching an id
   in `needed`:** an idle timeout (a `ready` stem unneeded for >60s is evicted) and an LRU cap
   on total decoded seconds across every ready buffer (least-recently-needed first, can fire
   before the idle timeout if the cap alone requires it) — mobile memory, bounded independently
   of how many distinct stems a long session passes through. `engine.ts` additionally stops (not
   disposes) a loop voice's underlying `Tone.Player` once its target gain has sat at ~0 for 20s
   (`SILENT_PLAYER_STOP_MS`) rather than looping a decoded, inaudible buffer indefinitely —
   restarting it on demand is instant (same `fadeIn`) since the buffer itself stays decoded
   until the cache's own rules evict it. A buffer still backing an active `once` voice is never
   evicted even if `stemsNeeded` has moved past it — `runLoaderStep` filters `toEvict` against
   `runtime.onceVoices` before acting, retrying the eviction next tick once that voice ends.

   `DECODED_SECONDS_CAP` (`engine.ts`) is **measured, not guessed**: a live browser sweep across
   the whole timeline (network panel + the dev hook's new `getLoaderState()`) found the real
   floor — since the rule above can never evict something `needed`, the cap can only ever trim
   *history* — is ~530 decoded seconds, around the K-Pg/Cenozoic transition where 11 stems
   briefly overlap (the extinction, the recovery, and the mammal/bird radiations). Set to 650,
   giving that floor headroom for a little retained history (smooth back-and-forth scrubbing)
   while staying well under the full catalogue's ~1,040s. Tightening it further is a content
   question (fewer simultaneously-overlapping curves in the densest eras), not a loader one.

**Delivery: content-hashed filenames.** Checked first how scenes/portraits are versioned today
(`pipeline/publish.py`): they are not — `f"scenes/{scene.id}{ext}"`, a stable per-id name, same
for portraits, and `Manifest.assetBase` is today a fixed local constant (`"/media"`; DESIGN §9's
original "upload to R2" line was never implemented — `earthtime publish` is local-only, per
CLAUDE.md). So there is no existing hashing or CDN-path-versioning convention to "stay
consistent" with; this amendment introduces one, scoped to audio only, since audio is the one
media kind now fetched piecemeal, lazily, well after first paint, where immutable long-lived
caching actually matters. `pipeline.audio.content_hashed_filename(id, format, data)` names a
stem `<id>-<hash10>.<format>` from the first 10 hex characters of `sha256` of its **published**
bytes (unrelated to `StemManifest.sha256`, which verifies the raw *fetch*); `sources/audio-
stems/normalise.py`'s `write_outputs()` computes it once, at the same build-time placement step
ADR-023 §4 already established (never staged and copied again at publish), and removes any
other `<id>-*.<format>` sibling first, so exactly one published file per stem id ever exists.
`pipeline.publish._audio_stems` discovers the actual filename by globbing rather than
re-deriving the hash a second time (one implementation of the hash, not two that could drift),
and refuses to publish if none or more than one candidate matches. The web side needed no
change: `AudioStem.file` was already an opaque path string `resolveAssetUrl` joins against
`assetBase`. A real CDN in front of `/media/audio/` can now serve these `Cache-Control: public,
max-age=31536000, immutable` — recorded here for whoever wires up actual hosting, since this
repo's own `publish` step stops at the local filesystem.

**Encoding: not evaluated by transcoding, only by inspection.** This machine has neither
`ffmpeg` nor `sox` (ADR-023 §4's own constraint, unchanged) — per this amendment's own
instructions, that means stop and report rather than add a heavy dependency, not attempt a
workaround. What was checked without decoding: 20 of 22 published stems are already MP3
(universal decode support, including Safari/iOS WebKit); exactly two — `archosaurs` and
`livestock` — are Ogg (Vorbis). WebKit has never supported Ogg-container audio in any form
(`<audio>` or `decodeAudioData`) — a long-standing, well-documented platform gap, not something
this environment can demonstrate directly (no Safari available here). On Safari/iOS today these
two stems' `fetchStemBuffer` rejects, `bufferCache` marks them `error` (retried the next time
they are `needed`, never permanently blacklisted), and `onUnusableStem` logs one deduped
`console.warn` — the existing "skipped stem plays silent" contract already handles this
gracefully, but it is a real, pre-existing content gap this amendment did not introduce and
could not close. **Recommended, not done:** transcode `archosaurs.ogg`/`livestock.ogg` to `.m4a`
(AAC) once `ffmpeg` is available — mirrors the other 20 stems' format, closing the gap with no
web-engine change (`AudioStem.format`/`sniff_audio` already handle M4A). Broader re-encoding
(mono for diffuse beds, Opus/WebM where supported, ~96 kbps across the board) is a further,
separate optimisation pass once `ffmpeg` lands, not evaluated numerically here.

**Rocket clip / wind loop region, checked, not changed.** The human's brief asked to trim the
rocket clip (2:12) and confirm wind's loop-safe region "if not already". Both were already
fine: `wind`'s `stems.toml` entry already carries a `loop` region (23.74-77.81s). `rocket`
(`loop_safe = false`, a one-shot, 132.42s) was decoded and RMS/peak-measured across its first 20
seconds (headless Chromium `OfflineAudioContext.decodeAudioData`, mirroring `levels.py`'s own
"decode via a real Web Audio context" approach) — it opens at full loudness (-14.8 dB RMS/-1.6
dBFS peak at `t=0`) with no silent lead-in, unlike `mammoth`'s ~1.4s one (the "era fit v3 fixes"
amendment above). No `start_seconds` trim needed.

**Verification.** Live browser checks (headless Chromium, network panel + `window.
__earthtimeAudio.getLoaderState()`): enabling sound at 4.4 Ga fetches exactly `wind`/`water`/
`storm`/`volcanic` (4 requests, matching `stemGains(4.4e9, [])` by hand) and nothing else;
scrubbing straight from there to 195 yr (1830) fetches exactly the 8 stems active there
(`forest`/`insects`/`birds`/`mammals`/`livestock`/`fire`/`settlement`/`industry`) with no burst
of unrelated ones; a 13-checkpoint sweep across the *entire* timeline (Hadean to present) made
only 17 total audio requests and never held more than 11 stems' buffers at once, `decodedSeconds
Total` peaking at ~544s, under the (then-being-tuned) cap throughout; zero console errors in
every check. `pnpm typecheck` and the full `pnpm vitest run` (1,065 tests) pass; `.venv/bin/
python -m pytest -q tests` (426 tests) and `ruff check` on every touched Python file pass.

**Alternatives considered.**
- **Measuring `t`'s own frame-to-frame velocity** (an EMA over consecutive external `t` samples)
  instead of reading `Playback` directly for the lookahead's rate. Rejected: a single
  discontinuous jump (a timeline click, a section change) is indistinguishable, from a bare
  sequence of `t` values, from one very fast tick of continuous dragging — an EMA would still
  spike the lookahead window for a jump before decaying back down, reproducing exactly the
  "scrubbing across eras bursts every stem" symptom this amendment exists to fix.
  `playback.playing` already tells the engine, unambiguously, whether `t` is under the
  deterministic playback clock (`sceneSound.ts`'s once-trigger contract already relies on the
  same distinction) — reusing it needs no new state and has no jump-vs-drag ambiguity to
  resolve at all.
- **Reproducing `'scenes'`-mode's real local pacing rate** (`timeline/playback.ts`'s per-segment
  velocity, which can run faster or slower than flat `baseRate * speed`) inside the lookahead
  window, instead of the flat-rate approximation. Rejected as disproportionate to this
  amendment's scope: it would pull `scenePlaybackSegments` and a `TimeScale` into what is
  otherwise a small, dependency-light pure module, for a discrepancy the tick loop's own ~80ms
  re-planning cadence already self-corrects within one tick.
- **A hard cap on stems fetched regardless of need**, instead of a pure lookahead window.
  Rejected: it would either under-fetch (an audible gap right as a stem's curve crosses
  threshold) or over-fetch (padding the cap to be safe defeats the point) — the actual curves
  already say precisely when a stem is needed; approximating that with a flat count throws away
  information the engine already has for free.

**Consequences.**
- New: `web/src/audio/loadPlan.ts` (+ `.test.ts`), `web/src/audio/bufferCache.ts` (+ `.test.ts`).
  `engine.ts` rewritten: `buildRuntime` no longer constructs any stem player/buffer eagerly;
  the tick loop's loader step (`runLoaderStep`, `updateLoopVoices`) is new; `UseAudioEngineInput`
  gains `playback`/`sectionWindow` (`Experience.tsx`'s one call site updated, `sectionById
  (sectionId).window` — no other file needed to change). `AudioDevHook` gains `getLoaderState()`.
  `pipeline/audio.py` gains `content_hash`/`content_hashed_filename`. `sources/audio-stems/
  normalise.py`'s `_published_path`/`_place_stem` and `pipeline/publish.py`'s `_audio_stems`
  updated for content-hashed filenames; `data/media/audio/*` republished under their hashed
  names (old unhashed files removed), `data/media/manifest.json` republished
  (`earthtime publish --allow-unpinned`, build `c4a56f4700d1e06f`).
- Engine purity is unchanged and re-verified: `stemGains`/`sceneSoundLoopGains`/`scoreParams`
  are still pure in `t` alone (DESIGN §11, CLAUDE.md's own hard rule) — `stemsNeeded` reads them
  but adds no new impure dependency into them; every network/Tone.js side effect stays inside
  `engine.ts`, `loadPlan.ts` and `bufferCache.ts` remain `tone`-free.
- `archosaurs`/`livestock` (`.ogg`) not decoding on Safari/iOS is a real, open gap, unresolved
  by this amendment (no `ffmpeg` available) — tracked above under Encoding, not silently
  dropped.
- DESIGN.md §11's "as-built web engine" paragraph is updated in place (below) to describe
  on-demand loading in place of the retired "one player per stem, built eagerly" description.

**Amendment (2026-09-15): re-review fixes.** *Status: accepted, fixing nine findings from a
code review of the "on-demand loading" amendment above (evidence: Playwright against this
build, request logs and `window.__earthtimeAudio`).* Severity as reported; each is fixed unless
marked otherwise.

1. **[high] No retry backoff — fixed.** `StemBufferCache` entries now carry `attempt`/
   `retryAtMs`/`permanent`. `markFailed` doubles the delay each consecutive failure
   (`INITIAL_RETRY_BACKOFF_MS` 2s, capped at `MAX_RETRY_BACKOFF_MS` 60s); `plan()` only offers
   an `error` entry in `toFetch` once `nowMs >= retryAtMs`. A **decode** failure (the browser
   cannot play this container/codec at all) is now distinguished from a **network** failure
   (`engine.ts`'s `fetchAndDecodeStem` does the `fetch()` and `decodeAudioData` as two separate
   `try`s, tagging which one failed via `StemLoadError.kind`) and marked
   `markPermanentlyFailed` — never retried again this session. Live check: forcing every
   `archosaurs` request to fail (route abort) for 8s produced 4 requests total (was 100/8s in
   the review's evidence), `getLoaderState().error` holding `['archosaurs']` throughout.
   `bufferCache.test.ts` gained backoff-doubling, backoff-reset-on-success and
   never-retries-a-permanent-failure tests.

2. **[high] Lookahead window unit mismatch — fixed.** `loadPlan.ts`'s `lookaheadWindow` no
   longer advances raw `log1p(t)` by `baseRate * speed` seconds (a space `Playback.baseRate` is
   not denominated in — it is screen-space `u` over the full-domain *symlog* scale, knee
   `SYMLOG_C` = 1e4, span ≈ 13.03 warp units; the old code effectively advanced by a few
   hundredths of one raw *year* per tick, not `PLAYING_LOOKAHEAD_SECONDS` of real playback).
   It now calls `timeline/playback.ts`'s own `advancePlayhead` — pure, `tone`-free, already
   exported — with the real full-domain symlog scale for `'scenes'` mode (always, per
   `advancePlayhead`'s own contract) and a symlog scale of the *selected section* for
   `'steady'` mode (a documented approximation of `advanceSteadyPlayhead`'s exact
   per-section/`scaleKind` scale — this package has no `sectionId`/`scaleKind` to reproduce
   that precisely, and the two differ only in knee/linear-toggle warp inside a window already
   hard-clamped by `sectionWindow`). The backstop behind is a fraction of that same predicted
   `u` distance, not a second approximation. `'scenes'`-mode pacing (`scene/pacing.ts`'s
   `scenePlaybackSegments`) is now threaded through as `scenesPacing` — `loadPlan.ts` still
   does not import `@/scene` for it, taking `timeline`'s structural `PlaybackPacingSegment`
   type instead, the same decoupling `timeline/playback.ts` itself uses; `engine.ts` computes
   it once per manifest (`useMemo`, like `flatBasalt`/`catastrophes`) and mirrors it into a
   "latest ref". `loadPlan.test.ts` gained tests pinning the window against `advancePlayhead`
   itself, in both modes, plus a regression test for the magnitude of the old bug.

3. **[high] Scene loop stems not needed while presented — fixed.** `stemsNeeded` now also
   samples `sceneSoundLoopGains(sceneAt(scenes, sampleT))` across the same window the ambience
   curves are sampled at (including `t` itself, always, distance 0) — not just whether a
   scene's own `t` falls in the window, which missed both the "held dominant past its own `t`
   until the log-midpoint dissolve to the next scene" tail `sceneAt` has by design
   (`scene/scene.ts`'s `DISSOLVE_WIDTH`) and the "ramping in before `t`" tail on the way in.
   `loadPlan.test.ts` gained a property-test suite ("every audible stem is needed") sweeping
   ambience gains at 14 checkpoints (paused and at 8x) plus a loop-mode scene stem sampled
   across and beyond its dissolve bands, all checked against the real `stemGains`/`sceneAt`/
   `sceneSoundLoopGains` output, never a hand-picked expectation.

4. **[medium] Decoded-seconds cap not a real memory bound — fixed.** `StemBufferCache` now
   tracks decoded **bytes** (`buffer.length * buffer.numberOfChannels * 4`, 32-bit float PCM),
   not published `durationSeconds` — the old figure ignored channel count/sample rate
   entirely, so a stereo 48 kHz stem and a mono 24 kHz one of the same duration counted the
   same despite a 4x memory difference. `markFetching` now also takes an `estimatedBytes`
   reservation (`engine.ts`'s `estimatedStemBytes`: duration × an assumed stereo-48kHz rate,
   the catalogue's typical case) so `plan()`'s cap check sees fetches already in flight, not
   only what has landed — several fetches starting together can no longer land and blow past
   the budget before the next `plan()` call reacts. Density reduction at the source
   ("mono downmix of diffuse beds", the review's own suggestion): `engine.ts` now calls
   `ToneAudioBuffer.toMono()` on every `ambience-loop` stem's buffer right after decode —
   client-side, so it needs no pipeline dependency (`sources/audio-stems/normalise.py`'s own
   "no transcoding happens here" stays true). `DECODED_BYTES_CAP` is re-measured the same way
   the old `DECODED_SECONDS_CAP` was, corrected for the unit fix: a Playwright sweep of 61
   log-spaced checkpoints across the *entire* domain (4.5 Ga → present, post mono-downmix,
   cumulative with the other live checks below so it reflects realistic reuse, not a cold
   start) measured a peak of **148.5 MB decoded (13 buffers)**. Set to 190 MB (≈ 27% headroom
   over the measured peak) — down from the old cap's real ~250-280 MB (stereo throughout, a
   duration-only figure). `rocket` (a one-shot, kept stereo — one-shots are not mono-downmixed,
   only `ambience-loop` stems are) was re-confirmed to need no trim (see item 7 below);
   further density reduction is a content question (fewer simultaneously-overlapping curves),
   as the original amendment already said.

5. **[medium] Continuous drag bursts fetches; no abort; late arrival built a voice regardless
   — fixed, three parts.** (a) `engine.ts`'s tick loop now gates *starting new fetches* (not
   evictions, not gain writes — those stay live every tick) on `playback.playing ||
   (t has sat still for >= IDLE_FETCH_SETTLE_MS)`, 300ms, tracked via a local "last seen `t`"
   closure variable inside the tick effect (not a ref — nothing outside the interval reads it).
   Live check: the review's own repro (a 3s, 75ms-stepped drag across 40 positions from 4e9 to
   100) now produces **zero** fetches during the drag (was 10). (b) `engine.ts` now fetches via
   its own `fetch()`+`AbortController`+`decodeAudioData` (`fetchAndDecodeStem`, item 1 above)
   instead of `Tone.ToneAudioBuffer(url, ...)`, which had no cancellation of its own;
   `runLoaderStep` aborts any `runtime.inFlight` fetch whose stem has left `needed` every tick
   (not gated by the settle delay — aborting wastes nothing and is always correct). An abort
   is treated as "never really tried" (`bufferCache.forget`, not `markFailed`) — no backoff
   penalty for a fetch the loader itself cancelled. (c) A landed buffer only gets a
   `createLoopVoice` built for it if its stem is still in `runtime.currentNeeded` (the most
   recent `stemsNeeded` result, written at the top of every `runLoaderStep` and read
   asynchronously by the fetch's own `.then()`) — a fetch can easily outlive the lookahead
   window that asked for it.

6. **[medium] `playOnce` fallback silently dropped a late arrival — fixed.** `runtime.pendingOnce`
   (`Map<StemId, {sceneId, gain, firedAtMs}>`) records a trigger that fired before its buffer
   was ready; `startLoadingStem`'s success handler resolves it — plays it
   (`startOnceVoice`, factored out of the old inline `playOnce` body) only if
   `!onceSoundOutlivedScene(runtime.currentPresented, pending.sceneId)` (the same "is this
   scene still dominant" check `fadeOutlivedOnceVoices` already used for a *sounding* voice,
   now reused for a *pending* one), else drops it deliberately with one deduped
   `console.warn` ("missed its once-mode cue"). `runtime.currentPresented` is written every
   tick from the same `presented` the gain-writing code already reads. Deliberately no
   separate grace-period timeout on top of the dominance check: a scene that is still on
   screen deserves its sound whenever it finally arrives (a long wait is a slow-network
   symptom, not a reason to drop it), and a fixed timeout would only add an untested magic
   number for no correctness gain. `loadPlan.ts` also now fetches once-mode scene stems at
   higher priority *and* over a wider window (`ONCE_LOOKAHEAD_SECONDS` = 20s vs the ordinary
   6s) — items 2 and 3's own fixes — so this fallback is reached far less often than before.
   Live check confirms the prefetch half directly: jumping to a scene reusing the `impact`
   stem and delaying its route by several seconds, `getLoaderState()` shows `impact` already
   `loading` within the first tick, well before the scene settles. The "does it actually play
   once landed" half could not be proven live in this environment — see item 9 below, a
   separate, pre-existing, out-of-scope bug this review pass surfaced sharper evidence for.

7. **[medium] Encoding (`archosaurs`/`livestock` `.ogg`, WebKit) — not transcoded; reasoned,
   not silently skipped.** The review is right that this machine has `/usr/bin/afconvert`
   (macOS-native, offline, reads MP3/AIFF/WAV, encodes AAC — `ffmpeg`/`sox` are still absent).
   It is **not used** here, for two reasons neither this task nor the original amendment
   named explicitly: (a) `sources/audio-stems/normalise.py`'s own module docstring is explicit
   and deliberate — "this machine has neither `ffmpeg` nor `sox`, and macOS's `afconvert`
   must not become a hard pipeline dependency (every `sources/<name>/` source must build and
   test offline)" — making `normalise.py` depend on a macOS-only binary breaks that contract
   for whoever builds this source on Linux CI or another contributor's machine, not just for
   this session. (b) Independently of (a): CLAUDE.md's own hard rule is that
   `data/raw/` is "gitignored — reproducible via `fetch.py` + sha256" — every raw file must be
   re-downloadable from its recorded `url`. A locally `afconvert`-transcoded file has no such
   URL; committing one as a stem's `raw_filename` would silently break that reproducibility
   contract for anyone who wipes `data/raw/` and re-runs `fetch.py`, not merely add a
   dependency. Both are pre-existing, deliberate constraints (DESIGN.md's pipeline semantics
   are one of CLAUDE.md's four NORMATIVE contracts — "propose an ADR, do not unilaterally
   edit"), so working around either unilaterally, even to close a real Safari/iOS gap, is out
   of this task's scope. The actually-consistent fix — sourcing these two effects fresh from a
   CC0/PD source that already publishes an MP3 or WAV, the same way 20 of the other 21 stems
   are already sourced — is deliberately deferred to a follow-up pass rather than rushed inside
   this one; see the Sourcing note below. Separately, this amendment's WebKit claim is softened:
   the previous wording ("WebKit has never supported Ogg-container audio in any form") is
   asserted without a citation the review correctly flagged; it is softened to "WebKit does
   not support Ogg-container audio as of this writing, a long-standing and widely-reported
   platform gap this environment has no Safari available to verify directly" — the practical
   consequence (these two stems fail to decode on Safari/iOS, handled gracefully by the
   existing `error`/`console.warn` path, item 1 above) is unchanged either way.

8. **[low] `dispose()` left in-flight fetches running; toggling refetched everything; CDN
   caching unconfigured — partly fixed, partly not this repo's to configure.** `dispose()` now
   aborts every `runtime.inFlight` controller first (its `.catch()` still runs, asynchronously,
   but `runtime.disposed` is already true by then, so it touches nothing further) — turning
   sound off no longer lets an in-flight fetch decode into a buffer nothing then disposes.
   Toggling sound off and back on still re-fetches everything (the whole `StemBufferCache` is
   discarded with the runtime) — left as is: keeping a decoded-buffer cache alive across a
   disabled session would need its own separate memory budget independent of
   `DECODED_BYTES_CAP` (which only bounds an *active* runtime's cache), and `ADR-023` §2/§4's
   own "pay nothing, including CPU or memory, while sound is off" contract argues against it;
   not revisited here. Immutable `Cache-Control` on `/media/audio/*` remains unconfigured
   because there is nothing in this repo to configure it on: `next.config.ts` sets
   `output: 'export'` (a static export has no server for `next` `headers()` to run on), and
   `earthtime publish` is local-filesystem-only (CLAUDE.md, DESIGN §9) — exactly as the
   original amendment already documented ("recorded here for whoever wires up actual
   hosting"). This is unchanged, correctly-scoped-out infrastructure work, not a gap this
   pass introduced or could close from inside the repo.

9. **[low] Priority-order contract implicit; stale comments; `plan()`'s two parameters could
   disagree — fixed.** `StemBufferCache.plan()` now takes just `needed: ReadonlySet<StemId>` (no
   separate `orderedByDistance`) and derives fetch order from `needed`'s own iteration order
   internally — `loadPlan.ts`'s own doc comment already established that order as
   nearest-priority-first, so a second, independently-supplied parameter that had to agree by
   convention was pure risk with no benefit; `engine.ts`'s `runLoaderStep` updated to the new
   single-argument call. The stale `loader.ts` reference in `loadPlan.ts`'s header comment (no
   such file exists — the stateful layer is `bufferCache.ts` + `engine.ts`) and
   `bufferCache.ts`'s comment misattributing the distance ordering to "the caller
   (`engine.ts`) derives a distance order from `t`" (`engine.ts` never did — it only ever
   spread the `Set` `loadPlan.ts` already ordered) are both corrected. `bufferCache.ts`'s
   default constructor arguments are documented as generic bookkeeping-test fallbacks, not a
   second copy of `engine.ts`'s own tuned production constants (which `buildRuntime` always
   passes explicitly) — left in place, not removed, since several existing bookkeeping tests
   construct a bare `new StemBufferCache<string>()` and rely on them.

**A tenth finding, informational, not fixed — out of scope (`web/src/scene/**` is owned by a
concurrent workflow this session; the fix, if any, belongs there).** The review noted some
`once`-mode sounds never fire even with a ready buffer well before their scene, "cause not
determined". This pass determined it, with stronger evidence than the review had: in
`'scenes'`-mode playback, `scene/presentation.ts`'s `step()` rate-limits the *presented*
`SceneMix` toward `sceneAt`'s target by at most `dtSeconds / MIN_TRANSITION_SECONDS` of `mix`
per real wall-clock second (`MIN_TRANSITION_SECONDS` = 1.6s, a fixed floor independent of
playback speed), while `scene/pacing.ts`'s `scenePlaybackSegments` can pace the *playhead*
through a densely-scened stretch (several scenes with only a few years between them, common in
the human-history chapters — `trinity-test`/`normandy-landings-dday` sit only a year apart,
per that scene's own comment) faster than `MIN_TRANSITION_SECONDS` per scene. Live check
(Playwright, two different densely-scened clusters — `trinity-test`'s WWII-era neighbours and
`kpg-arrival`'s own tightly-dated sequence around the impact instant, both reusing the `impact`
stem): sampled every 500ms across several real seconds of `'scenes'`-mode playback at 1x, `t`
barely advances (dwelling, as designed) but `getActiveOnceVoices()` never once becomes
non-empty — `presented.mix` appears to never actually land on exactly 0 or 1
(`nextOnceTriggerState`'s `isSettled` gate) for either cluster in this environment, so
`useSceneSoundOnceTrigger` never fires at all, independent of which stem or how long the
buffer has been ready. This reads as more than "some closely-spaced scenes miss occasionally"
— in this pass's live checks it reproduced on every densely-scened cluster tried. Recommended
next step for whoever owns `web/src/scene/**`: either let `MIN_TRANSITION_SECONDS` scale down
with `playback.speed` while playing (so it can never exceed a scene's own paced dwell), or
give `nextOnceTriggerState` a small tolerance around exactly 0/1 instead of requiring an exact
float match. Not fixed here: `web/src/audio/**` (this task's ownership) can only consume
`presented`, not change how it is computed.

**Sourcing note (audio-stems, 2026-09-15).** This task's rules would have permitted
re-sourcing `archosaurs`/`livestock` from a fresh CC0/PD clip already published as MP3/WAV
(the actually-consistent fix for item 7, sidestepping the `afconvert`/pipeline conflict
entirely, since 20 of the other 21 stems are already sourced exactly that way). Given the
scope already covered by the nine primary findings above and this pass's time budget, that
search was not carried out to completion here — `stems.toml` is unchanged, nothing was
substituted, and this is recorded as deliberately deprioritised (medium severity, with a
reasoned architectural explanation already on record above) rather than silently dropped.
Left for a follow-up pass scoped to sourcing alone, where it can get the same unhurried
licence-verification and spectrogram scrutiny every other stem in this catalogue already has.

**Verification (re-review pass).** `pnpm typecheck` clean. `pnpm vitest run src/audio src/shell
src/app`: 227 passed (0 failed). `.venv/bin/python -m pytest -q tests`: 426 passed, unaffected
(no Python touched by this pass beyond this doc). Live Playwright checks (headless Chromium):
enabling sound at 4.4 Ga → exactly 4 requests (`wind`/`water`/`storm`/`volcanic`); jumping to
195 yr (1830) → 13 stems fetched, all plausible for that era plus nearby `once`-mode scenes
within the (now-correct) lookahead, never a burst of the full catalogue; a 3s/40-step
continuous drag from 4e9 to 100 → zero fetches until it settles; forcing `archosaurs` to fail
for 8s → 4 requests (was ~100); a 61-point log-spaced sweep of the whole domain → peak 148.5
MB decoded across 13 buffers, zero console errors.

**Amendment (2026-09-15): human-history scene sounds, once-mode fix and Safari re-sourcing.**
*Status: accepted, human-directed (follow-up queue item 19, run after audio v3 and on-demand
loading landed).* Three independent fixes, one pass.

**(a) Scene sounds for the 16 new human-history scenes.** `imperial-rome-pantheon`,
`angkor-wat`, `black-death-messina-1347`, `amsterdam-voc-harbour`, `ford-model-t-street`,
`somme-1916`, `ginza-modern-tokyo`, `normandy-landings-dday`, `post-war-boom-suburbia`,
`green-revolution-fields`, `containerisation-port`, `berlin-wall-fall`, `aral-sea-drying`,
`energy-transition-solar-wind` and `global-city-rush-hour` each gained a `sound` (`data/scenes.yaml`,
comments cite this amendment) — every choice checked against the on-screen ambient curve at the
scene's own `t` (`web/src/audio/stemGains.ts`), not picked on subject alone: `settlement` is a
**flat 0.48** for every `t` under 5.125 ka (the "flat afterwards until HYDE population is
curated" note in `stemGains.ts`'s own comment), so it was only used where a scene reads as
busier than the ambient default already implies (`imperial-rome-pantheon`, `amsterdam-voc-harbour`,
`berlin-wall-fall`, `global-city-rush-hour`, each at gain 0.75-0.85), never as a default; `traffic`
and `industry` both still ramp in this range and sit well under 0.5 at most of these scenes' own
`t` (computed exactly, not eyeballed — e.g. `traffic(95) ≈ 0.15`, `industry(50) ≈ 0.23`), so a
scene whose own subject calls for either (Model Ts, streetcars, gantry cranes, a highway
cloverleaf) got it foregrounded specifically because the curve alone would have underserved it;
`water`/`wind` are both 0 everywhere in this range (past `TERRESTRIAL_BED_FADE_END`), so any
scene that wanted either got it only through its own `sound`. `shenzhen-sez-1980` deliberately
got **no** `sound` — the scene's own subject (one fisherman, surveyors staking an empty paddy
field, no crowd or machinery yet) is the quiet "before" half of the city's arc, and the flat
0.48 `settlement` floor every scene this side of Uruk already carries reads truer than a
foregrounded stem would.

A new **`artillery`** stem (CC0, craigsmith, "R12-31-Artillery Guns Firing.wav" — the same
trusted vintage-optical-effects source as `impact`) was sourced for `somme-1916`'s distant
bombardment: searched Freesound and Wikimedia Commons for a genuine period WWI/WWII field
recording of distant shelling (the brief's own preference) and found none licensed CC0/PD in
the time this pass budgeted for sourcing — Commons' WWI/WWII audio holdings are almost entirely
speeches, marches or unlicensed film audio. `artillery` is a documented substitution, the same
"library effect stands in for the real thing" precedent `impact`/`rocket`/`aircraft` already
set. Spectrogram-checked (`qa12-spectrogram-artillery-candidate.png` and its `-loop.png` zoom,
this session's scratchpad): several sustained bursts of broadband low-mid rumble (many
overlapping reports, not one shot), no siren sweep, speech or music. Loop region 20.831-24.623 s
found by a full grid search over the whole clip for the tightest sample-matched wrap among
candidates within 2 dB of each other's level (naive nearest-sample search alone landed twice on
points that matched exactly but 12-17 dB apart in level — a quiet decaying tail against a loud
one, which would read as an audible jump; the level constraint fixed this). `normandy-landings-dday`
was considered for `artillery` too (the brief named it optional) but kept as `water` — the scene
is framed at the waterline as the ramp drops, water is the immediate sound of the moment
depicted, and reusing `artillery` there as well would blur the two scenes' distinct character
where they dissolve past each other on the timeline.

**(b) Once-mode scene sounds not firing in dense scene clusters — root cause fixed, not merely
worked around.** The "re-review fixes" amendment above (finding 10) diagnosed but did not fix
this: `MIN_TRANSITION_SECONDS` (1.6 s, a fixed wall-clock floor `scene/presentation.ts`'s `step`
rate-limits every dissolve to) is independent of playback speed, while `scene/pacing.ts`'s
`scenePlaybackSegments` paces the *target* through a dissolve band in `MIN_TRANSITION_SECONDS /
speed` — less, above 1x — so in a densely-scened stretch the presented mix can fall behind and
never land on the exact `0`/`1` the original trigger required. This pass's own live evidence
(Playwright, headless Chromium, `getActiveOnceVoices()` sampled every 100-150 ms) reproduced it
directly: at 1x-4x every tested once-mode scene (`kpg-arrival`/impact, `pleistocene-steppe`/
mammoth, `first-powered-flight`/aircraft, `trinity-test`/impact, `apollo-11-launch`/rocket)
fired reliably; from 8x up, `apollo-11-launch` specifically never fired even once across several
full sweeps through its own neighbourhood (`green-revolution-fields` → `apollo-11-launch` →
`containerisation-port`, `t` = 60 → 56 → 50).

Fixed in two parts, both `web/src/audio/**`-only (no `scene/**` change):

1. `sceneSound.ts`'s `nextOnceTriggerState` no longer requires `mix` to be exactly settled at
   `0`/`1` — it fires the instant the *dominant* scene (`dominantScene`: `mix < 0.5 ? from :
   to`) changes to a once-mode scene, while playing, not already armed off. `step`'s own rate
   limiting still guarantees `state.mix` moves monotonically toward whatever it is chasing, so a
   mix that ever starts heading toward a scene below `0.5` provably crosses `0.5` even if later
   re-targeted away before reaching `1` — the one condition the old exact-float check could get
   stuck short of forever. This alone fixed every reproduction case *except* `apollo-11-launch`.
2. A second, independent failure mode surfaced investigating that holdout: `step`'s own
   "different pair, settled" branch can rebase straight past an intervening scene without it
   ever becoming `presented.to` at all (its own doc comment: "so playback never flashes through
   whatever scenes lie between them") — confirmed directly by reading `[data-testid=
   "scene-caption"]`'s text at 40 ms intervals during an 8x sweep: the presented caption sequence
   read `green-revolution-fields` → `shenzhen-sez-1980` directly, `apollo-11-launch` never
   dominant even once, so no fix to `nextOnceTriggerState` alone — however loose its condition on
   `mix` — could make its cue fire; `presented` was never going to show it. `engine.ts` already
   computes an independent, un-rate-limited `sceneTarget = sceneAt(manifest.scenes, t)` every
   render (pure in `t`, DESIGN §3/§4, never skips a scene the playhead passes through) purely to
   feed its own call to `usePresentedSceneMix`; the fix feeds `sceneTarget` to
   `useSceneSoundOnceTrigger` instead of `presented`, while `sceneSoundLoopGains` kept reading the
   rate-limited `presented` unchanged, since loop volume must stay visually synced to what is
   actually on screen. This redefines "arrival" as `t`-driven (CLAUDE.md's "`Layer.sample()` must
   be pure in `t`" extended here to a `t`-triggered event), not presentation-driven — the two were
   previously assumed to coincide and, in a dense enough cluster at high enough speed, provably
   do not.

**Correction (2026-09-15, same-day re-review):** the paragraph above originally also claimed
`onceSoundOutlivedScene`/`fadeOutlivedOnceVoices` "keep reading the rate-limited `presented`
unchanged... a voice fired slightly ahead of what the picture has caught up to simply keeps
sounding until the picture itself moves on, never cut short by the gap this opens". Live
behaviour contradicted that claim outright: reading `presented` alone to decide whether a voice
had "outlived" its scene made *every* voice fire and then fade within 40-175 ms, regardless of a
clip's real duration (the 132 s `rocket` clip included) — the instant a voice fires off the raw
*target* crossing into a scene, the rate-limited *presented* mix, still catching up by
construction, almost always still shows the *previous* scene as dominant, so "outlived" read true
from the very first tick, not once the picture had actually moved on. `sceneSound.ts` now exports
`onceSoundOutlived(target, presented, sceneId, hasBeenPresented)` in place of
`onceSoundOutlivedScene`: it trusts `presented` only once `presented` has actually shown `sceneId`
dominant at least once (`onceVoiceHasBeenPresented`, a latch `engine.ts` carries per `OnceVoice`
and per still-pending `once` trigger, updated every tick); until then it reads `target` instead,
which is pure and instantaneous in `t` and so never itself skips past a scene the playhead
actually visited — this also gives the `apollo-11-launch` rebase case (where `presented` may
never show the scene at all) an explicit, reachable point to fade at, rather than either
firing-then-instantly-fading (the bug) or never fading (the naive fix). Live-reverified with
Playwright, polling `getActiveOnceVoices()` every 40 ms: at 1x and 8x every tested once-mode scene
(`kpg-arrival`, `pleistocene-steppe`, `first-powered-flight`, `trinity-test`) now stays alive for
several real seconds before fading, and a clean continuous 64x sweep from before `kpg-arrival`
still fires all five once-mode scenes exactly once each. A new pure test
(`sceneSound.test.ts`, "before the scene has ever been presented-dominant... reads target
instead") replays the exact lagging-`presented`/leading-`target` sequence the bug depended on and
asserts the voice is not faded.

Live re-verification after both fixes (Playwright, `getActiveOnceVoices()` sampled every
100-150 ms, both `'scenes'`-mode speeds 1x-64x and `'steady'` mode): every one of `kpg-arrival`,
`pleistocene-steppe`, `first-powered-flight`, `trinity-test` and `apollo-11-launch` fires at
every speed the sampling window actually reached the scene at, `apollo-11-launch` included, a
sweep spanning `kpg-arrival` through `pleistocene-steppe` down to the present firing all five in
one continuous 64x run. A pure-logic regression test
(`sceneSound.test.ts`, "fires each once-mode scene in a dense cluster exactly once") replays the
exact presented-mix sequence `step` produces when chasing a fast-moving target across three
once-mode scenes without ever settling at any of them, asserting each fires exactly once, none
skipped, none doubled. `'steady'`-mode note, unrelated to this fix, **retracted below (2026-09-15
review pass) — the "plays and fires normally" half was wrong**: seeking into a narrow
already-selected era section and switching to `'steady'` can complete near-instantly (real-time
pacing within a small window), which the sound engine handles correctly (nothing fires or
breaks) but leaves too little wall-clock time to exercise it meaningfully; this is
`ADR-024`/`scene/**` territory, not touched here.

**(d) Correction (2026-09-15, review pass) — steady mode does *not* "play and fire normally"
seeked from the full, unsectioned domain either.** A later review pass (this pass's own
`qa12-review-once.mjs`/`qa12-review-once.json`, this session's scratchpad) re-ran the once-mode
matrix per scene/mode/speed rather than as one continuous multi-scene sweep, and found the (c)
note above's "confirmed unrelated ... plays and fires normally" claim unsupported: seeked to just
before each of the five once-mode scenes (`sectionId` left at its default `'earth'`, i.e. the
full, unsectioned domain — nothing here selects a narrower section) and started in `'steady'`
mode, 22 of 30 runs across `kpg-arrival`, `pleistocene-steppe`, `first-powered-flight`,
`trinity-test` and `apollo-11-launch` at 1x/8x/64x ended with the once voice never firing at all.
This is **not** the ADR-024 section-boundary stop the note above speculates: `tAtStop` in every
failing run is exactly `0`, the true end of the domain, reached the ordinary way (`Experience.tsx`
stopping playback once `t` reaches the present) — `sectionId` never leaves `'earth'` in any of
these runs, so `advanceSteadyPlayhead`'s section-chaining path (`continuationSection`) is never
even exercised. A direct repro (`once-repro.mjs`, this session's scratchpad) isolates the actual
cause: from `t=60` (four years above `apollo-11-launch`'s `t=56`), `'steady'` mode at 1x moved
`t` from `60` straight to `0` between two consecutive polls ~30 ms apart — under two animation
frames. `baseRate * speed` (`0.02` u/sec) is flat in `fullScale`'s `u`, and the full 4.6 Gyr
domain's symlog compresses the entire last few hundred years to a `u`-span small enough that
`0.02` u/sec crosses all of it in under a frame; `nextOnceTriggerState` (§(b) above) is pure and
instantaneous in `t`, but a render simply never lands with `t` inside the scene's dissolve band to
read as dominant. ADR-024's whole premise — a section's own scale gives its window real
resolution — assumes a *narrower* section is selected first; nothing here does that by default,
so `'steady'` mode from the root section is fast enough, this close to the present, to blow past
a several-decade-wide scene unobserved. Not fixed in this pass: it is a design question for
`ADR-024`/`scene/**` (a per-section floor on `'steady'`-mode velocity, or requiring/prompting a
narrower section before `'steady'` playback near the present), the same territory the retracted
note above already deferred to, and outside a WebGL-gating pass's remit. Left as an open,
accurately-described gap rather than re-asserting the retracted claim.

**(c) Safari/iOS decode gap — `archosaurs`/`livestock` re-sourced as MP3, not transcoded.** The
"re-review fixes" amendment above (finding 7) left this deferred with a documented reason
(`normalise.py`'s "no `ffmpeg`/`sox`, `afconvert` must not become a hard pipeline dependency"
contract) but had not actually re-checked `afconvert` beyond that policy argument. This pass
did, and found the constraint is not merely a policy choice on this machine — it is not
technically available either way: `afconvert -f m4af -d aac -b 128000` fails outright
("The format 'aac' is unknown or an unparseable PCM format specifier") on *any* input, including
a plain WAV, so AAC encoding cannot be produced here at all, deliberate dependency or not; and
`afconvert -f WAVE -d LEI16` (decoding an MP3 to PCM, the *other* documented use of `afconvert`
in this source, `levels.py`'s own module docstring) also fails on this machine
("ExtAudioFileSetProperty ('cfmt') failed") — this `afconvert` build cannot decode MP3 either.
Homebrew is present but installing `ffmpeg` was not attempted: CLAUDE.md's "never add heavy new
dependencies without stopping to report" plus the pipeline's own offline-build-anywhere
contract (§4 above, unchanged) rule it out unilaterally, and the actually-consistent fix was
available anyway. `sources/audio-stems/fixture/` and its `.venv` were checked for a pure-Python
audio decoder (`pydub`/`soundfile`/`librosa`/`av`/similar): none installed, none added.

Both stems were instead **re-sourced fresh as CC0 clips already published as MP3** — the
"sourcing note" the "re-review fixes" amendment left for a follow-up, now carried out: a
Freesound preview is *always* an MP3 transcode regardless of the uploader's original format
(this file's own header comment), the same way 20 of the other 21 stems already reached this
catalogue, so re-sourcing sidesteps the transcoding question entirely rather than solving it.
`archosaurs` → craigsmith's "Alligator Growl" (vintage optical effect, CC0): several discrete
low-frequency growl/bellow bursts, silent gaps between, the same character (a real alligator
standing in for an extinct archosaur) the retired clip had — the brief's own "the user likes the
archosaurs clip, keep that character" is why this specific replacement was chosen over other
candidates found in the same search (a "T-Rex Calls" pack, several other alligator/crocodile
recordings). `livestock` → felix.blume's "Goats moving and bleating in a pen" (CC0, Arenbou,
Morocco): dense, layered bleating and movement, matching the retired clip's own "layered
goat-herd bleating, not one close animal call" character; needs an explicit loop region
(50.92-95.88 s, wrap jump 4.3e-6 against a 0.0012 median step, both ends within 2.7 dB) unlike
the retired clip, since this one opens already active rather than in silence. Both
spectrogram-checked the same way every other stem in this catalogue is
(`qa12-spectrogram-archosaurs-candidate.png`, `qa12-spectrogram-livestock-candidate.png` and a
`-zoom.png`/`-loop.png` close pass on the busier region, this session's scratchpad) — no speech
formant arcs despite `livestock`'s own Freesound "voices" tag (which Freesound applies to any
animal-vocalisation recording, not only human ones), no sirens, no music. `loudness_db`/
`peak_dbfs` for both — and for the new `artillery` loop — are measured with `levels.py` on the
*loop region itself* where one exists, not the full raw clip (`forest`'s own precedent,
`stems.toml`'s comment on each): `livestock` measured against its full 96.31 s clip would have
capped its trim 1.8 dB short of the loop reference on a peak transient that sits inside the loop
region regardless, so measuring the region directly is the honest figure, not merely the one
that clears the catalogue's own 1.5 dB tolerance test. Every shipped stem is now `mp3` or `m4a`
— no `ogg` remains in the catalogue — so every stem decodes on every browser this project ships
to, Safari/iOS included, without narrowing what `sources/audio-stems/normalise.py` depends on.

**Files.** `web/src/audio/sceneSound.ts`/`sceneSound.test.ts`, `web/src/audio/engine.ts`,
`web/src/audio/stemIds.ts`, `sources/audio-stems/stems.toml`, `data/raw/audio-stems/`
(`archosaurs.mp3`/`livestock.mp3`/`artillery.mp3` added, the retired `.ogg` raw files removed),
`data/media/audio/` (re-published via `earthtime publish --allow-unpinned`, the retired `.ogg`
published files removed by hand — `earthtime publish` does not prune stale media on a format
change, queue item 19f, not fixed here), `data/scenes.yaml` (16 `sound` blocks, one deliberate
omission), `tests/sources/test_audio_stems.py`, `docs/DESIGN.md` §11.

**Never touched:** `web/src/scene/**` (presentation/pacing), scene subjects or pins (ADR-005;
`earthtime plan` still reports 67 scenes pinned after this pass, unchanged), any image
generation.

**Verification.** `.venv/bin/python -m pytest -q tests`: 426 passed. `.venv/bin/ruff check`/
`ruff format --check` on every touched Python file: clean. `pnpm typecheck`: clean. `pnpm vitest
run src`: 1087 passed (0 failed), including a new dense-cluster regression test in
`sceneSound.test.ts`. `earthtime plan`: 67 scenes pinned, unchanged; the two pre-existing stale
scenes (`jurassic-cycad-pollination`, `panama-land-bridge`) predate this pass and are untouched
by it. `earthtime publish --allow-unpinned`: succeeds, 67 scenes published, 23 audio stems
credited. Live Playwright verification for (b) and spot-checks for (a) (`getStemTargets()`
confirming each new scene's foregrounded stem reaches its declared gain once loaded, and that
`shenzhen-sez-1980` shows only the ambient curve, no foregrounded stem) both reported above and
in this session's own scratchpad screenshots/logs.

**Amendment (2026-09-15): re-review fixes.** *Status: accepted, fixing an adversarial review of
the amendment above (issue (b)'s own "never cut short" claim corrected in place there, search
"Correction (2026-09-15, same-day re-review"; every other finding fixed here).*

**1. `artillery`'s loop region clicked on every wrap (medium).** The attested "wrap jump 3.0e-7...
effectively 0" did not reproduce: measured with `Tone.Player`'s actual loop semantics (last
sample before `loopEnd` against the first sample at `loopStart`), the 20.831-24.623 s region
jumped 0.101 at 48 kHz against a 0.00366 median step — about 27x the median, an audible click
every 3.79 s. Re-searched the whole 46.56 s clip for a long, sample- and level-matched wrap:
13.269-27.984 s (14.715 s) wraps at 3.97e-4 (48 kHz) / 4.56e-4 (44.1 kHz), both *under* each
rate's own median step. `sources/audio-stems/stems.toml`'s `artillery` entry and its comment are
corrected in place.

**2. `archosaurs`' claimed "no loop needed" was wrong about its own head (medium).** The clip's
first 6.8 s is a different edited segment the comment never described: broadband splice clicks,
a 527→141 Hz harmonic sweep, then a 4.5 s constant-level hiss with a steady ~47 Hz buzz — none of
it a growl burst, and playing the whole 37.27 s clip on loop repeated all of it every cycle. Given
a loop region instead: 7.122-37.264 s (30.14 s), starting after the last splice in a genuinely
quiet stretch (6.9-8.25 s, all near -58 dB) and ending at the clip's own tail, which fades to the
same floor. `stems.toml` corrected in place; `loudness_db`/`peak_dbfs` re-measured on the region.

**3. Eight of the fifteen new scene sounds were not actually the loudest thing in their scene
(medium), and four of those eight named a clip that does not match what is depicted at any gain
(medium).** Every loop stem is trimmed to the same -30 dB reference, so live gains compare
directly; the builder's table checked only the flat 0.48 `settlement` floor and missed that
`industry`/`traffic` still ramp through this whole era and can exceed a scene's own deliberate
gain. Fixed per scene, `data/scenes.yaml`'s own per-scene comments carry the numbers and the
same citations inline:

- `ford-model-t-street`, `ginza-modern-tokyo`, `green-revolution-fields`, `containerisation-port`
  — `traffic`/`industry` are respectively a *modern* dense-road-traffic bed and a *Victorian*
  steam-engine beat (`stems.toml`'s own comments on those stems), matching none of a 1913 Model T
  street, 1930 Ginza streetcars, a 1965 diesel pump/tractor or 1975 gantry cranes. No CC0/PD
  period-fitting clip was sourced in the time this pass budgeted, so per CLAUDE.md ("if something
  is unusable, stop and report; do not silently substitute a different dataset") all four scenes
  had their `sound` block dropped rather than kept mismatched or merely turned up — the flat 0.48
  `settlement` floor carries them instead.
- `somme-1916` (`artillery` 0.55 → 0.9), `aral-sea-drying` and `energy-transition-solar-wind`
  (`wind` 0.55/0.5 → 0.8 each), `normandy-landings-dday` (`water` 0.55 → 0.7) — gain raised so
  each clears its scene's loudest competing ambience curve by comfortably over 3 dB (each scene's
  own comment computes the exact before/after dB).
- `angkor-wat` and `black-death-messina-1347` (`water` 0.4/0.45 → the new `lake-water` stem at
  0.7 each) — see finding 4 below; re-pointing at a better-fitting stem made the gain fix and the
  content fix the same change.

**4. `angkor-wat`/`black-death-messina-1347` used open-ocean surf under scenes with no ocean
(low).** `water` is Azores beach surf — "continuous broadband surf roar" (`stems.toml`'s own
comment) — used for a still, mirrored temple moat and a sheltered strait quay; a poor fit at any
gain, not merely a loudness problem. Searched Freesound for a calmer, lake/harbour-character CC0
clip; sourced TheFlyFishingFilmmaker's "Gentle waves on a lake" (614299, CC0 1.0) as a new
scene-only stem, `lake-water` — irregular, gentle broadband lapping, no tonal ridge, siren,
speech or music (spectrogram-checked, full clip and loop region alike). Loop region
73.930-84.929 s (11.0 s), chosen from a quiet, splash-peak-free stretch of the clip rather than a
first, longer candidate that wrapped just as cleanly but crossed the clip's one loud splash and so
could not clear the catalogue's own 1.5 dB loop-reference tolerance
(`test_real_catalogue_trims_every_loop_to_within_1_5_db_of_the_reference` caught this, not
eyeballing). Both scenes re-pointed from `water` to `lake-water`. `web/src/audio/stemIds.ts`
gains `lake-water` in `SceneStemId`/`SCENE_STEM_IDS`.

**5. Nothing stopped a future stem from publishing as OGG or WAV, the exact gap (c) above fixed
by hand (low).** `pipeline.audio.StemManifest.format` accepted any string the sniffer recognised;
only `sources/audio-stems/fixture/`'s deliberately-WAV test fixture and the real catalogue's own
(now all-MP3) contents kept this from mattering. Restricting `StemManifest.format` itself was
rejected — it would also reject that WAV fixture, which legitimately needs a format `numpy` can
synthesise without a real encoder this offline pipeline does not have. Instead,
`pipeline.audio.WEBKIT_DECODABLE_FORMATS` (`{mp3, m4a}`) is checked in
`pipeline.publish._audio_stems`, refusing to publish any stem whose declared format is not in it
— `PublishRefused`, before the missing/duplicate-published-file checks that follow it. A new test
(`test_publish_refuses_a_stem_whose_format_is_not_webkit_decodable`) and a real-catalogue guard
(`test_real_catalogue_uses_only_webkit_decodable_formats`) cover it; `tests/test_pipeline.py`'s
own stem-catalogue test helper (`_write_stem_catalogue`) moved off its WAV-based synthetic
fixture to a synthetic MP3 one so it keeps testing scene→stem linking and publish-refusal
behaviour, not incidentally relying on a format the pipeline no longer publishes. `earthtime
publish` still does not prune stale media on a format change (queue item 19f) — unchanged, and
still not fixed here.

**6. `stems.toml`'s `artillery` comment named `normandy-landings-dday` as a second consumer it
never actually had (low).** `data/scenes.yaml` and this file both always kept
`normandy-landings-dday` on `water` (the amendment text above says so directly); only the
`stems.toml` comment drifted. Corrected in place alongside finding 1's loop-region fix.

**7. Resuming playback while already sitting on a once-mode scene fired its cue, undocumented and
untested (low).** Confirmed live: scrubbing onto a once-mode scene while paused, then pressing
play, fired the cue immediately even though the user never played *into* the scene —
`nextOnceTriggerState`'s `playing` check had no memory of whether `playing` had *just* turned
true. Decided: pressing play must not itself count as an arrival — arrival is the playhead moving
into a scene under playback, not playback merely starting while parked on one.
`nextOnceTriggerState` gained a `wasPlaying` parameter (`useSceneSoundOnceTrigger` tracks it in a
ref, the same pattern `armedOffRef` already uses); the render on which `playing` transitions
`false → true` arms the current scene off without firing, whatever it is, while an arrival that
happens on an *already-playing* render (including one driven by a scrub) still fires normally.
New tests in `sceneSound.test.ts`: a `describe` block of five covering the play-transition gate
itself (including mid-dissolve, no re-fire on the very next tick, pause/resume within a dwell, and
an arrival on a genuinely-already-playing render), plus two on the `useSceneSoundOnceTrigger` hook
(fires on a genuine arrival while already playing; does not fire on resume while already sitting
on the scene).

**Files.** `web/src/audio/sceneSound.ts`/`sceneSound.test.ts`, `web/src/audio/engine.ts`,
`web/src/audio/stemIds.ts`, `sources/audio-stems/stems.toml`, `sources/audio-stems/README.md`,
`data/raw/audio-stems/lake-water.mp3` (added), `data/media/audio/` (re-published),
`data/scenes.yaml`, `pipeline/audio.py`, `pipeline/publish.py`, `tests/sources/test_audio_stems.py`,
`tests/test_pipeline.py`.

**Never touched:** `web/src/scene/**`, scene subjects or pins (`earthtime plan` still reports 67
scenes pinned after this pass), any image generation.

**Verification.** `.venv/bin/python -m pytest -q tests`: 428 passed. `.venv/bin/ruff check`/
`ruff format --check` on every touched Python file: clean. `pnpm typecheck`: clean. `pnpm vitest
run src`: 1100 passed (0 failed). `earthtime plan`: 67 scenes pinned, unchanged (the same two
pre-existing, unrelated stale scenes). `earthtime publish --allow-unpinned`: succeeds, 67 scenes
published, 24 audio stems credited. Live Playwright re-verification of the once-mode voice-lifetime
fix (finding in the amendment above) and of every touched scene's live `getStemTargets()` gain
(both reported inline above); zero console errors across all of it.

**Amendment (2026-09-15): wing-hum.** *Status: accepted, human-directed (further listening
feedback, then "Yes to all" on the proposal below).* The human reported wind/storm/water surf
sound still audible around 346 Ma under the forest scene ("doesnt really fit, should transition to
'forest/swamp' sounds including insects etc around that point") and insect noises "starting a bit
late around 248 Ma" — both already diagnosed and fixed by the "era fit v3 fixes" amendment above
(`wind`/`water`/`storm` exactly 0 by 370 Ma, `forest` on by then; `insects`' own 300 Ma start is as
early as its clip's citation supports). What that amendment's own "Unresolved" note left open was
the 325-300 Ma gap: Grimaldi & Engel 2005 dates unambiguous WINGED insects to ~325 Ma, 25 Myr
before `insects`' one clip's stridulation character (Song et al. 2020, ~300 Ma) — a gap that
amendment declined to fill rather than reuse the stridulating clip anachronistically. A further
review, confirming the gap, proposed adding a QUIET generic insect wing-hum from ~320 Ma using a
NON-bee, NON-stridulating drone clip; the human approved it outright ("Yes to all").

**Decision.** New ambience stem `wing-hum` (`AMBIENCE_STEM_IDS`/`AmbienceStemId`,
`web/src/audio/stemIds.ts`): bruno.auzet "swarm of flies.wav" (Freesound 692840, CC0 1.0) — a
230.25 s countryside-path field recording of a fly swarm, spectrogram-checked (continuous
broadband 150 Hz-8 kHz texture, no discrete pulses, no FM bird chirps, no periodic frog croaking,
no siren/speech/music) and confirmed to be a DIFFERENT clip from `buzzing` (fury12's bee-wingbeat
loop, scene-only, reached only through `mid-cretaceous-pollinators`' own `sound`) so the new stem
cannot be mistaken for reusing it. Candidates rejected in the same search and why: csaszi "Flies
swarm" (528060, decays to full digital silence by 42 s of 50 s — an event, not a loop), studioste
"Flies around an XY pair" (818691, 99% of its energy sits below 150 Hz — room/handling rumble, not
the buzz), olius "Flies in window" (729432, 42% below -50 dB with intermittent glass-tap
transients), antoineopeng "Dragonfly.wav" (447319, 61% below -50 dB, sparse discrete wing-flap
transients rather than a continuous drone) — full reasoning and levels in `stems.toml`'s own entry
comment.

`stemGains.ts`'s new `wingHum(t, dominance, life)`: `rampLog(t, 3.25e8, 3.2e8, 0, 0.06)` — 0 for
every t >= 325 Ma, rising to a quiet 0.06 plateau by 320 Ma (`WING_HUM_PLATEAU_GAIN`, a fifth of
`forest`'s 0.3 baseline — a texture, not a foreground, matching the human's own "QUIET" framing in
the approved proposal) — ducked by `duck(0.85, dominance)` and `lifePresence(t)` exactly like
`insects` (same depth, same three barren-scene/K-Pg-aftermath ducks). **Persists rather than
receding once `insects` itself starts at 300 Ma**: the two stems read as different characters (a
continuous drone vs. discrete stridulation chirps, from two different clips), not a duplicate of
the same sound, and winged insect lineages have flown continuously from the Carboniferous to the
present (Grimaldi & Engel 2005) — an unfinished fade-out would be the less honest reading. The
`insects` stem's own comment (both in `stemGains.ts` and DESIGN §11) is rewritten to no longer
claim 385-300 Ma (nor, after this amendment, 325-300 Ma) is silent overall: `insects` itself is
still silent before 300 Ma (there is still no citation for stridulation any earlier), but
`wing-hum` now honestly covers the 325-300 Ma window on its own, different citation.

Loop region 152.900-174.850 s, found the same way `artillery`/`buzzing`/`knapping`/`lake-water`
were (`Tone.Player` semantics — last sample before `loopEnd` against the first at `loopStart` —
decoded at both 44.1 and 48 kHz): wrap jump 3e-6 at 48 kHz against a 0.00378 median step, 2.4e-5 at
44.1 kHz against a 0.00357 median step, both ends within 1 dB. `levels.py`, run on the loop region
itself (`forest`'s own "measure what will actually loop" precedent, since the raw clip's peak
elsewhere is louder): `loudness_db = -33.2`, `peak_dbfs = -12.4`, giving `level_trim_db = 3.2` (the
loop reference, exactly).

`loadPlan.ts` needed no code change — `stemsNeeded` already samples every id in
`AMBIENCE_STEM_IDS` generically against `GAIN_THRESHOLD`, so `wing-hum` is loaded on demand the
same way every other ambience stem is; verified directly (`loadPlan.test.ts`: absent from what's
needed at 4.4 Ga and 346 Ma, present once the playhead nears 325-300 Ma).

**Files.** `sources/audio-stems/stems.toml` (new `wing-hum` entry), `sources/audio-stems/README.md`
(stem list, count, size), `web/src/audio/stemIds.ts`, `web/src/audio/stemGains.ts` (new `wingHum`/
`WING_HUM_*`, rewritten `insects` comment, `lifePresence`'s own comment), `web/src/audio/
stemGains.test.ts`, `web/src/audio/loadPlan.test.ts`, `tests/sources/test_audio_stems.py`,
`data/raw/audio-stems/wing-hum.mp3` (fetched, gitignored), `data/media/audio/
wing-hum-a5862d0fc3.mp3` (published), `docs/DESIGN.md` §11.

**Never touched:** `web/src/scene/**`, `data/scenes.yaml`, any scene subject or pin, any image
generation — `earthtime plan` reports the same 66 scenes pinned / 2 pre-existing stale
(`jurassic-cycad-pollination`, `panama-land-bridge`, unrelated to audio) before and after, and the
same 40 portraits pinned / 1 awaiting review.

**Verification.** `.venv/bin/python -m pytest -q tests`: 428 passed. `.venv/bin/ruff check`/
`ruff format --check` on every touched Python file: clean. `pnpm typecheck`: clean. `pnpm vitest
run src`: 1111 passed. `earthtime publish --allow-unpinned`: succeeds, 66 scenes, 25 audio stems
credited (`wing-hum` among them, `levelTrimDb: 3.2`, its loop region on the wire). `make pins`:
106 pinned images staged, 0 unpinned removed — unchanged by this task. **Correction (2026-09-15
"wing-hum re-source" amendment below): no live `getStemTargets()` check was actually run for this
amendment** — the paragraph originally claimed one at 346/320/300/250/90 Ma, but it was only a
code read of `updateLoopVoices` (a direct passthrough of `stemGains(t, …)['wing-hum']` for an
ambience-loop stem with no scene sound naming it) plus the vitest table above, never an actual
browser check. The values it predicted turned out correct — see that amendment's own, genuinely
run, live verification.

---

**Amendment (2026-09-15): wing-hum re-source (review correction).** *Status: accepted,
review-directed.* A review of the "wing-hum" amendment above found five problems with its first
pick (bruno.auzet "swarm of flies.wav", Freesound 692840), confirmed against a fresh
headless-Chromium decode of the same clip:

1. **Disproportionate decoded-memory footprint.** At 230.25 s it was, even after `engine.ts`'s
   mono downmix, by far the heaviest ambience-loop stem (~44 MB) — a live sweep with the original
   review's own method (`getStemTargets()`/`getLoaderState()` on a running dev server, this time
   actually driven with Playwright rather than only claimed) found 12 Ma and 10 ka both
   comfortably under `DECODED_BYTES_CAP` (95.5 MB and 122.8 MB decoded respectively, against the
   190 MB cap) — the original review's own 198 MB/255 MB figures for those checkpoints omitted
   the mono downmix `engine.ts` already applies to every `ambience-loop` stem, so its "already
   over the cap" claim does not hold up — but `wing-hum` alone still ate roughly a third of the
   cap's entire margin for a stem ducked ~13.5 dB under `forest`, functionally inaudible. No test
   bounded this; `decodedBudget.test.ts` (new) now does, against every ambience stem's real
   attested duration, across a dense sweep of the whole domain.
2. **Faint tones inside the claimed clean loop region.** A tight -100..-25 dB re-inspection of
   152.9-174.85 s found narrowband events around 2.8-4.2 kHz near 154.1 s and across
   169.2-171.5 s, ~30-35 dB under the loop's own drone — plausibly explained by the clip's own
   Freesound description, unread when it was first sourced: "Also birds, some faraway traffic
   sometimes and cow presence." The original comment's "no FM bird chirps... confirmed... by a
   zoomed pass across the loop region itself" did not hold up against a properly-scaled
   spectrogram (the original PNGs saturated below 2 kHz and clipped at 0 dB, which is why the
   zoomed pass missed them).
3. **A recognisable repeat inside the loop.** A close fly-pass at 170.15-170.8 s (7-9 dB above
   the loop's own median level) recurs every 21.95 s — inside the region the original comment
   called "a long transient-free stretch."
4. **Attested numbers that did not reproduce.** A fresh decode gave `loudness_db = -33.8`/
   `peak_dbfs = -11.3` (attested: -33.2/-12.4, a 0.6 dB `level_trim_db` error) and a wrap jump two
   orders of magnitude larger than attested (3e-6/2.4e-5 claimed vs. ~7e-4/1e-3 measured) — an
   alignment-sensitive near-zero result on broadband noise, not a real margin; a ±600-sample
   offset sweep put 98% of neighbouring alignments above the median step.
5. **The live-verification claim above was false.** The previous amendment's own Verification
   paragraph claimed a live `getStemTargets()` check that was never actually run (corrected in
   place above) — caught by this review, not self-reported.

**Decision.** Re-source `wing-hum` to kangaroovindaloo "Blowflies!" (Freesound 324590, CC0
1.0) — already on record in the original amendment as the search's own documented fallback ("a
clean, comparably continuous alternative... hotter... and a third the length"), rejected then
only for being shorter, which turns out to be exactly the property this re-source needed. Full
spectrogram/loudness/loop-region re-verification (this amendment, not inherited from the
original search): continuous broadband texture to 8 kHz with steady harmonic bands at
~280/560 Hz, no FM chirps, no periodic croaking, no siren/speech/music at a tight -100..-25 dB
zoom of the chosen loop region; its own Freesound description ("The sweet sound of Australian
blowflies in mass!") names no bird/traffic/cow content, unlike the clip it replaces. At 66.894 s
(Chromium `decodeAudioData`, 44.1/48 kHz agree to the millisecond) its mono-downmixed decoded
size is ~12.8 MB — about 3.5x smaller than the first pick's ~44 MB.

New loop region 35.296-47.919 s (12.623 s — shorter than the original's 21.95 s, both because the
clip itself is shorter and because a fully transient-free stretch that long does not exist in it;
33.6-49.0 s is its longest transient-light run, and the region sits inside that, clear of the
close fly-passes RMS-flagged nearby), found by a grid search (0.5 ms resolution, `Tone.Player`
semantics — last sample before `loopEnd` vs. first at `loopStart`) minimising each channel's own
wrap jump against its own median sample-to-sample step at both 44.1 and 48 kHz, subject to a
< 1 dB RMS level match at the wrap: wrap jump ch0/ch1 0.6%/12.6% of median step at 48 kHz,
2.2%/1.6% at 44.1 kHz (all genuinely far under the median, unlike the previous entry's
unreproducible near-zero figures), level match 0.50 dB. `levels.py` on this loop region:
`loudness_db = -24.3`, `peak_dbfs = -5.9`, giving `level_trim_db = -5.7` (an attenuation — this
clip is louder than the -30 dB loop reference, unlike the first pick) — reproduced identically at
both sample rates.

`stemGains.ts`'s `wingHum()` curve, `WING_HUM_*` constants and every downstream stem
(`insects`, `lifePresence`, etc.) are unchanged: this amendment only swaps the clip a fixed,
already-reviewed curve plays, the same way `archosaurs`/`livestock`/`forest` were re-sourced in
place by earlier amendments. `AmbienceStemId`/`AMBIENCE_STEM_IDS`/`SceneStemId` (`stemIds.ts`)
are unaffected.

**Files.** `sources/audio-stems/stems.toml` (rewritten `wing-hum` entry and comment),
`sources/audio-stems/README.md` (size figures), `data/raw/audio-stems/wing-hum.mp3` (replaced,
gitignored), `data/media/audio/wing-hum-e9b0b7cd2d.mp3` (published, replacing
`wing-hum-a5862d0fc3.mp3`), `web/src/audio/stemGains.ts` (clip identity in `wingHum()`'s doc
comment only), `web/src/audio/stemGains.test.ts` (+1 effective-level test), `web/src/audio/
loadPlan.test.ts` (2 test names corrected, a citation to a nonexistent "DESIGN's 'flying insects
never went away' call" replaced with the real `wingHum()` doc-comment reference),
`web/src/audio/decodedBudget.test.ts` (new), `web/src/audio/loadPlan.ts` (`GAIN_THRESHOLD`
exported, for the new test), `web/src/audio/engine.ts` (`DECODED_BYTES_CAP` exported, for the
same), `docs/DECISIONS.md` (this amendment, plus the in-place correction above).

**Never touched:** `web/src/scene/**`, `data/scenes.yaml`, any scene subject or pin, any image
generation, `stemGains.ts`'s curve/duck logic. `earthtime plan` reports the same scenes and
portraits pinned/stale before and after.

**Verification.** `.venv/bin/python -m pytest -q tests`: 428 passed. `.venv/bin/ruff check`/
`ruff format --check` on every touched Python file: clean. `pnpm typecheck`: clean. `pnpm vitest
run src`: 1113 passed. `make data`: `audio-stems: rebuilt`, every other source `fresh`.
`earthtime publish --allow-unpinned`: 66 scenes, 25 audio stems credited (`wing-hum` now
`durationSeconds: 66.894`, `levelTrimDb: -5.7`, loop `35.296-47.919`). **Live `getStemTargets()`/
`getLoaderState()` checks, actually run this time** (Playwright driving the real dev server at
`localhost:3000`, a genuine "sound on" click as the required user gesture, `window.__earthtime
.setT` to position the playhead): 346/320/300/250/90 Ma reproduced exactly the previous
amendment's predicted table (`wing-hum` silent at 346 Ma; 0.06 at 320/250/90 Ma; 0 exactly at
300 Ma inside `gondwana-ice-margin`'s barren duck; `insects` present alongside it from 300 Ma on)
— both against the old clip (confirming the previous, unverified claim happened to be correct)
and again against the new one (confirming the re-source changed nothing about the curve, only the
audio). Decoded-bytes totals dropped at every checkpoint: 320 Ma 78.2→49.4 MB, 250 Ma
100.7→71.9 MB, 90 Ma 102.7→73.9 MB, 12 Ma 95.5→66.7 MB, 10 ka 122.8→94.0 MB — all now well under
half the 190 MB cap. Zero console errors across every check.

**Amendment (2026-09-16): `forest`'s SECOND pick was also rain.** *Status: accepted,
human-directed (listening feedback: "the background sound effects from about 270 Ma to 60Ma
sounds like rain which doesnt seem appropriate because none of the scenes have rain, so may need
adjusting").*

**Diagnosis.** `stemGains(t, [])` was computed directly (not guessed) at the five checkpoints the
feedback's own window brackets — 270, 200, 150, 100 and 60 Ma. `forest` is a flat 0.3 at every one
of them (its curve has held a flat baseline from 370 Ma on since the "era fit v3 fixes" amendment;
nothing about this amendment's fix changes that curve). Every other ambience stem active in this
window was checked too: `insects` (0.066→0.28), `wing-hum` (flat 0.06), `fire` (flat 0.15),
`large-animal` (0→0.63, scene-boosted at 270 Ma) and `archosaurs` (0→0.88, scene-boosted at
100 Ma) — none of these is a continuous broadband texture the way `forest` is (bellows,
stridulation and crackle are discrete-event or narrowband, not a stationary wash), so none of them
is a plausible source of a "sounds like rain" report even where a scene's own loop-mode sound
pushes their gain briefly above `forest`'s. `data/scenes.yaml` was checked directly for any
`conditions`/weather field naming rain: none exists in the published window (one scene,
`futuristic-shenzhen-2087`, explicitly lists "neon-lit rain-soaked street" under `absent`) — a
rain-reading bed under every one of these scenes is a scene/audio mismatch, not a matter of taste.
The clip itself settled the question: its own Freesound title is literally "Rain on leaves", and
the previous amendment's own spectrogram comment — "continuous broadband...patter" — already
described rain, in words, without the previous pass recognising that a frog/bird-free spectrogram
is necessary but not sufficient for "not rain". Measured quantitatively for the first time here
(400 ms block-RMS envelope, the same block size `levels.py` uses): the shipped clip's envelope
has a standard deviation of 0.6 dB across its full 49.9 s — a near-perfectly stationary hiss,
because rain has no gusts to swell and ease off the way real wind through foliage does. That 0.6
dB figure is the number this amendment's fix is built around: it is what "sounds like rain" looks
like in a block-RMS plot, and no candidate this pass shipped without first checking that its own
chosen loop region (not just its whole clip) clears it by several dB.

**Decision.** (1) **A rain/downpour check is added to `sources/audio-stems/README.md`'s own
"Sourcing checks" list** (block-RMS envelope stdev, checked inside the candidate's own loop
region, not just over the whole clip — a dynamic clip can still have a flat, rain-like stretch
that happens to be its only cleanly-loopable span, which is exactly how the rejected candidates
below were caught even where their whole-clip statistics looked fine). (2) **`forest` re-sourced a
third time**: i_o_i "Bear Creek Valley Trail Tree Wind" (Freesound 860800, CC0 1.0,
https://freesound.org/people/i_o_i/sounds/860800/) — a genuine gusty wind-through-foliage field
recording, block-RMS envelope stdev 2.25 dB inside its own 16.62-38.99 s loop region (3.75x the
previous clip's 0.6 dB whole-clip figure), broadband with no tonal ridges (max spectral peakiness
5.4 dB, an order of magnitude under a real tone/siren/hum's ~20-30 dB spike), Welch-averaged
spectrum clean of mains hum (<=3.8 dB at every 50/60/100/120 Hz bin — a single un-averaged FFT
snapshot taken early in this search showed spurious 4-11 dB bumps at those same bins purely from
periodogram variance, a false alarm a proper 43.5 s Welch average resolved), no birdsong, no frog
calls, no footsteps (despite "Trail" in the title) and no traffic (tags: Tree, blowing, trees,
wind, windy). Full sourcing/rejection detail, including why two candidates with excellent rustle
character (Freesound 788811, 853114) were rejected anyway for a badly capped level trim, is in
`stems.toml`'s own entry comment. `forest`'s `stemGains.ts` curve, `id`, role and every checkpoint
test are unchanged — this is a clip swap, not a curve change. (3) **Level.** Loudness -52.5 dB,
peak -26.5 dBFS, `level_trim_db` 22.5 — hits the full -30 dB loop reference with headroom to
spare, unlike the clip it replaces (5.4 dB, 2.1 dB short) and unlike the two rejected
better-sounding candidates above (16.1 dB/15.3 dB short and 6.1 dB/17.5 dB short respectively);
`stemGains.test.ts`'s `FOREST_EFFECTIVE_LOUDNESS_DB` constant is updated to match. (4) **Loop
region**, found by a joint grid search over 44.1 kHz AND 48 kHz decodes together (not one rate
then checked against the other, after the "buzzing" re-check found exactly that ordering miss a
wrap that reproduced 4.7x worse at the untested rate): 16.62-38.99 s, wrap jump 1.6e-9 at 44.1 kHz
(median step 4.5e-4) and 2.7e-8 at 48 kHz (median step 4.2e-4) — comfortably under the median step
at both rates. (5) **Size**: raw audio drops from ~33.2 MB to ~32.7 MB (25 stems; `forest` itself
0.8 MB against its predecessor's 1.2 MB) — still over the "<~15 MB" default, unaffected by this
amendment's own direction (the human has separately said audio size is not strictly budgeted).

**Consequences.** No wire-format change (`AudioStem`/`SceneSound` schemas untouched); `_audio_stems`
discovers the new content-hashed filename (`forest-cdac2ac432.mp3`) by globbing, same as every
other re-source. No image digests or pins are affected (`scene.sound` and the tier-1 catalogue
both stay outside the asset graph, unchanged since ADR-023 §3). `stemGains.ts`'s own `forest:`
curve, comment and every checkpoint in `stemGains.test.ts` are untouched — only the clip, its
`stems.toml` entry, `decodedBudget.test.ts`'s hand-maintained duration mirror (43.52, was 49.93)
and the `FOREST_EFFECTIVE_LOUDNESS_DB` comparison constant changed. `data/scenes.yaml`,
`pipeline/scenes.py`, `web/src/scene/**` and `web/src/timeline/**` are untouched (this is an
audio-only fix; other uncommitted work lives there).

**Verification.** `.venv/bin/python -m pipeline.databuild --only audio-stems --force`:
`audio-stems: rebuilt` (fetched the new clip, verified its sha256, published
`forest-cdac2ac432.mp3`, removed the stale `forest-98937a7ce6.mp3`). `earthtime publish
--allow-unpinned`: 66 scenes, 25 audio stems credited, `forest` now `durationSeconds: 43.52`,
`levelTrimDb: 22.5`, loop `16.62-38.99`. `make pins`: 106 pinned images staged, 0 removed (no
image-graph effect, as expected). `.venv/bin/python -m pytest -q tests`: 435 passed. `ruff
check`/`ruff format --check`: clean. `pnpm typecheck`: clean. `pnpm vitest run src`: 1167 passed
(351 suites). **Live `getStemTargets()` check** (Playwright driving the real dev server at
`localhost:3000`, a genuine "sound on" click as the required user gesture, `window.__earthtime
.setT` to the five checkpoints the feedback's own window brackets): `forest` reads exactly 0.3 at
270/200/150/100/60 Ma, matching `stemGains.ts`'s unchanged curve and confirming the new buffer
loads and plays; zero unexpected console errors (two "Failed to load resource" entries are
`bufferCache`'s own documented abort-in-flight behaviour when `t` jumps discontinuously between
checkpoints, not a regression).

**Amendment (2026-09-16): `forest`'s THIRD pick was low-frequency wind rumble, not rustle.**
*Status: accepted, independent review of the amendment above.*

**Diagnosis.** An independent review reproduced every number the previous amendment attested
(sha256, `levels.py` loudness/peak, the 0.6 dB vs. 2.25 dB rain-envelope comparison, 435/1167
tests) and confirmed the rain diagnosis and fix direction were correct, but found the replacement
clip itself wrong: i_o_i "Bear Creek Valley Trail Tree Wind" (Freesound 860800) is a directional
mic recording wind pressure on its own capsule, not canopy leaf rustle. Quantified here for the
first time (a Welch PSD, `nperseg` 2^16, over the clip's own 16.62-38.99 s loop region — the
stationarity check the previous amendment added never looked at *where* the energy sat, only
*how steady* it was): 50.0% of power in 50-200 Hz, only 7.2% in 2-8 kHz, median-energy frequency
137 Hz — more low-frequency-dominated than the `wind` stem itself (696 Hz median, 12.0%/28.2% in
the same two bands), the open-air gust bed `terrestrialBedFade` deliberately silences at 370 Ma.
The clip's own Freesound description — "Directional mic, aimed at trees on a windy day" — is
consistent with mic-capsule wind noise rather than leaf-on-leaf rustle, which sits at 2-10 kHz.
The review also corrected two smaller inaccuracies in the previous amendment's own numbers,
both reproduced independently here: (1) the loop endpoints were claimed "closely matched
level" (-48.1 / -47.2 dB) but a proper head-vs-tail RMS comparison across several window sizes
shows a +3.5 to +6.8 dB step — the loop restarts audibly louder than it ends, every ~22 s;
(2) the attested wrap-jump figures (1.6e-9 at 44.1 kHz, 2.7e-8 at 48 kHz) measure
`|x[loopStart] - x[loopEnd]|`, a sample pair `Tone.Player` never actually plays — its
`[loopStart, loopEnd)` semantics wrap from `x[loopEnd - 1]` to `x[loopStart]`, which for this
clip is 2.22e-4 (44.1 kHz) / 2.59e-4 (48 kHz), 0.52/0.65 of the median sample step. Both are
still comfortably under 1 (the wrap itself is inaudible either way), so this did not change the
fix's outcome, only its bookkeeping — but "far tighter than this catalogue's existing tightest
wraps" was false under the convention that actually plays (`wind`'s own wrap, measured the same
correct way, is 8-12x tighter).

**Decision.** (1) **A spectral-balance check is added to `sources/audio-stems/README.md`'s
"Sourcing checks"**, alongside the stationarity check the previous amendment added: median-energy
frequency and % power in 2-8 kHz inside the candidate's own loop region, because broadband and
gusty (which is what the stationarity check verifies) is necessary but not sufficient for
"rustle" — open-air wind noise is broadband and gusty too, just at the wrong end of the spectrum,
and nothing before this caught that distinction. (2) **`forest` re-sourced a FOURTH time**:
mathiaslyhne1 "3. Forest, beech leaves, trees" (Freesound 798157, CC0 1.0,
https://freesound.org/people/mathiaslyhne1/sounds/798157/) — a genuine, unprocessed field
recording ("A recording of leaves in the wind in a forest near Silkeborg"), tags
beech/field-recording/forest/leaves/trees/wind only. This is the same candidate the previous
amendment's own rejected-candidates list already had on file, there measured at only 0.40 dB
whole-clip envelope stdev and rejected as rain-risk; re-measured inside a properly grid-searched
loop region (below) rather than the whole clip, it clears the same stationarity bar the previous
pick used by nearly 3x. Spectral balance inside its loop region (Welch PSD, `nperseg` 2^15):
median-energy frequency 2491 Hz, 32.0% of power in 2-8 kHz, 43.3% above 4 kHz — clearing the new
check by a wide margin — peakiness 14.6 dB (an order of magnitude under a real tone/siren/
bird-chirp's ~20-30 dB spike), clean at every 50/60/100/120 Hz mains-hum bin (>40 dB under the
median). Stationarity: 1.67 dB block-RMS envelope stdev inside the loop region (2.8x the 0.6 dB
rain threshold) — one smooth rise-and-decay gust across the loop's 8.9 s, confirmed NOT a
periodic footstep cadence (the clip's title notwithstanding) by inspecting the 50 ms block-RMS
trace directly: a single 4.4 s rise and 4.5 s decay, not a repeat every 0.3-1.2 s. Full
rejected-candidates list for this pass (happygummy 581234's disqualifying "processed to be
unnatural sounding" provenance despite the best raw spectral numbers found; teadrinker
403050/403051's genuinely multi-gust but spectrally short field recording, kept as the best
fallback; 853109's `birds` tag; and cross-checked spectral numbers for the six candidates the
previous amendment already rejected) is in `stems.toml`'s own entry comment.

**Level.** Measured on the loop region (this stem's own "measure what will actually loop"
precedent — the full clip peaks marginally louder, -28.8 dBFS, a few seconds outside the loop):
loudness -48.8 dB, peak -29.8 dBFS. `level_trim_db` lands at 18.8 dB, hitting the full -30 dB loop
reference with 11 dB of spare headroom (min(-30 - (-48.8), 29.8) = 18.8); `stemGains.test.ts`'s
`FOREST_EFFECTIVE_LOUDNESS_DB` constant is updated to match.

**Loop region**, found the same way as the clip it replaces — a joint grid search over 44.1 kHz
AND 48 kHz decodes together, minimising the WORSE of the two rates' correctly-measured
(`x[loopEnd-1]` vs. `x[loopStart]`) wrap jump subject to a <=1.5 dB level match at the endpoints:
17.308-26.224 s (8.916 s), wrap ratio 0.28 (44.1 kHz) / 0.30 (48 kHz) of each rate's own median
sample step, level match 0.75 dB (head -51.84 dB / tail -51.09 dB, 100 ms local RMS) — both
tighter than the clip this replaces managed under the same, correctly-applied measurement.

**Size.** Raw audio drops from ~32.7 MB to ~31.0 MB (`forest` itself 0.6 MB against its
predecessor's 0.8 MB, and 27.1 s against 43.5 s) — still over the "<~15 MB" default, unaffected by
this amendment's own direction (the human has separately said audio size is not strictly
budgeted).

**Consequences.** No wire-format change (`AudioStem`/`SceneSound` schemas untouched); `_audio_stems`
discovers the new content-hashed filename (`forest-d19ca9dc96.mp3`) by globbing, same as every
other re-source. No image digests or pins are affected (`scene.sound` and the tier-1 catalogue
both stay outside the asset graph, unchanged since ADR-023 §3). `stemGains.ts`'s own `forest:`
curve, comment and every checkpoint in `stemGains.test.ts` are untouched — only the clip, its
`stems.toml` entry, `decodedBudget.test.ts`'s hand-maintained duration mirror (27.12, was 43.52)
and the `FOREST_EFFECTIVE_LOUDNESS_DB` comparison constant changed. A new
`test_web_test_mirrors_of_forest_match_the_real_catalogue` (`tests/sources/test_audio_stems.py`)
now guards those two hand-copies against silently drifting out of sync with a future re-source —
nothing previously would have caught one of them being missed. `data/scenes.yaml`,
`pipeline/scenes.py`, `web/src/scene/**` and `web/src/timeline/**` are untouched (this is an
audio-only fix; other uncommitted work lives there).

**Verification.** `.venv/bin/python -m pipeline.databuild --only audio-stems --force`:
`audio-stems: rebuilt` (fetched the new clip, verified its sha256, published
`forest-d19ca9dc96.mp3`, removed the stale `forest-cdac2ac432.mp3`). `earthtime publish
--allow-unpinned`: 66 scenes, `forest` now `durationSeconds: 27.12`, `levelTrimDb: 18.8`, loop
`17.308-26.224`. `make pins`: 106 pinned images staged, 0 removed (no image-graph effect, as
expected). `.venv/bin/python -m pytest -q tests`: 436 passed (435 plus the new mirror-guard
test). `ruff check`/`ruff format --check`: clean. `pnpm typecheck`: clean. `pnpm vitest run src`:
1167 passed (351 suites) — unchanged from the previous amendment, since `forest`'s curve and
every checkpoint assertion are untouched, only its attested level constant.

---

## ADR-024 — Era sections bring back a bounded, section-driven window

**Status:** accepted — human-directed 2026-09-14. The human asked whether the timeline should be
divided into era sections "that can be selected to 'zoom in' and show more resolution", approved
the proposal ("Playback should continue. Leave out human story for now if Holocene works as a
proxy.") and later reported that no grouping or selector was visible yet.

**Context.** ADR-021 removed zoom and fixed the window to `[0, EARTH_FORMATION]`. The fisheye
lens resolves markers that sit close together, but only locally around the pointer. The viewer
still cannot *read* a stretch of history as a whole. At 1440px the entire Holocene covers about
100px and the last 250 years about 3px. Everything else drawn on the timeline scale inherits that
resolution: the event feed measures its lookback in displayed pixels, and the chart dock plots
against the same axis. The approved design was a clickable, hierarchical band strip with a
breadcrumb, *not* a return of free zoom.

**Decision.**
- **One section tree** (`timeline/sections.ts`), validated at module load: every parent's children
  must tile its window exactly, oldest first. The structure is Earth → Hadean · Archean ·
  Proterozoic · Paleozoic · Mesozoic · Cenozoic → Proterozoic eras (Paleo/Meso/Neoproterozoic) →
  Neoproterozoic periods (Tonian, Cryogenian, Ediacaran) · the six Paleozoic periods · Triassic,
  Jurassic, Cretaceous · Paleogene, Neogene, Quaternary → Pleistocene, Holocene → First farmers,
  Ancient civilisations, Medieval world, Early modern, Industrial age, Modern. The Hadean is a leaf
  because the ICS chart gives it no subdivisions. The Archean is a leaf because its four eras hold
  two scenes between them in the current manifest, so a level there would add clicks without
  adding resolution. The Neoproterozoic is split because Snowball Earth and the Ediacaran biota are
  separate scenes. Epochs appear only under the Quaternary, where the approved design asked for them.
- **Boundaries are cited, not eyeballed.** Geological base ages are those printed on the ICS
  International Chronostratigraphic Chart v2024/12, read from the chart PDF itself. Two of them
  differ from widely copied older values: the Cretaceous base is ~143.1 Ma (not ~145.0) and the
  Neogene base is 23.04 Ma. The chart dates the Holocene base 11,700 years b2k. It is shifted by
  25 years onto the fixed AD 2025 present that `data/events.yaml` uses (`t = 2025 − CE_year`),
  giving 11,725. The Holocene sections use the same conversion:
  - First farmers: from the Holocene base (Zeder 2011 on early-Holocene Near Eastern agriculture).
  - Ancient civilisations: from c. 3200 BCE, the first writing (Woods ed. 2010).
  - Medieval world: from AD 500, the conventional close of antiquity (Wickham 2009).
  - Early modern: from AD 1500 (Cameron ed. 2001).
  - Industrial age: from 1760 (Ashton 1948, already the events set's source).
  - Modern: from 1914, closing the "long nineteenth century" (Hobsbawm 1994).

  Every section carries its own `citation`. `eras.ts`/`ERA_BANDS` duplicated the top level and are
  removed. `eraNameForTime` is now `sectionAt(t, 1)`, and a shared boundary resolves to the
  *younger* unit, following the stratigraphic convention that a boundary age is the base of the
  unit above (66.0 Ma is the start of the Cenozoic). This deliberately reverses the previous
  arbitrary older-wins tie-break.
- **State.** The time store gains `sectionId` (default `'earth'`), and the window is derived from
  it rather than stored. The store owns one invariant: *the selected section contains `t`*.
  `selectSection(id)` moves `t` to the section's start (its oldest edge) when `t` was outside.
  `setT` re-derives the section via `sectionFollowingT`: it stays put while `t` is inside (edges
  included, so dragging onto an edge never switches). Otherwise it climbs from the current section
  and takes the first sibling at any level that holds `t`. That one rule covers playback running
  into the next sibling, and it covers an event-card jump outside the window, which keeps the
  deepest level that still makes sense.
- **Transitions.** `useAnimatedScale(window, kind)` now also animates its window over 700ms
  (`interpolateWindow`). Each edge moves linearly in symlog-warped space, so Earth → Holocene
  reads as a steady zoom instead of spending the whole animation at billion-year spans. Under
  reduced motion the change is instant. Everything that already took `timelineScale` follows the
  window with no changes of its own: the scrub track, ruler, bands and chart dock. The HUD
  sparklines and scenes-mode pacing keep their full-domain scale on purpose, and so does the
  event feed's lookback. The first pass fed the feed `timelineScale`, but its pixel lookback then
  shrank with the window: at 1830 inside the Industrial age it reached back about 100 years
  instead of about 220, and the feed showed nothing (Newcomen, Newton and the Columbian exchange
  all fell outside it). What happened recently does not change because the ruler is zoomed.
  During the animation the track still maps the wider, animated window, so `Timeline` clamps
  every track target (drag, pip, cluster member) to the selected section's window. Otherwise a
  press in those 700ms could land outside the section and make `setT` climb to another one.
- **Scale within a section.** The symlog/linear toggle keeps applying, with symlog as the default.
  No per-section special case is needed. The warp's slope differs by only 1% across Modern and
  about 2× across the whole Holocene, so symlog already draws short historical sections almost
  linearly, while the Cenozoic and Quaternary keep the log compression that makes them legible.
  What did need changing is the ruler: 1/2/5×10^d candidates leave one or two labels in a
  near-linear window. `generateTicks` therefore uses evenly spaced nice steps whenever a symlog
  window's slope ratio is below 4 (every Holocene section, the Holocene itself, the Paleozoic).
- **Playback continues.** `continuationSection` gives the next sibling, or, after the last child,
  the parent's next sibling and so on up the tree (Permian → Mesozoic, not Triassic, as approved).
  Only sections ending at the present have none. Scenes mode is unchanged: it paces on full-domain
  symlog, and the store's `setT` rule moves the section along. Steady mode goes through
  `advanceSteadyPlayhead`, which moves at constant velocity in the *selected section's* scale, so
  every section takes the same wall-clock time at 1x. When a frame crosses the younger edge, the
  rest of that frame continues in the next section's scale, so a crossing neither stalls nor
  loses time. Dragging and stepping (transport, ←/→) stay inside the section's window.
- **UI.**
  - `SectionBands` is a `<nav aria-label="Sections of …">` placed under the ruler, with a hairline
    ruler-segment button per child, laid out against the same fisheye-distorted scale as the track
    and ruler. `layoutSectionBands` widens bands narrower than 28px, taking the room from wider
    bands in proportion. On the full symlog domain the Hadean covers about 1% of the track, a few
    pixels on a phone.
  - Labels elide. Below 44px they are hidden, while the title and accessible name keep the full
    name. The band holding the playhead gets `aria-current="time"` and the accent colour. A leaf
    shows its own name and range instead of bands.
  - `SectionBreadcrumb` is a `<nav aria-label="Timeline section">` `<ol>` with ancestor buttons
    and `aria-current="location"` on the selected section. It takes the controls row's empty left
    track, so the transport stays centred. Below 760px it is its own row, with middle ancestors
    collapsed to "…".
  - Escape, handled by `Timeline`'s existing focus-scoped key handler, goes up one level.
    `ClusterPopover` already stops Escape propagating. After a band, breadcrumb or Escape change
    removes the focused control, focus moves to the new band strip.
  - The playhead readout now hugs the track edge. Selecting a section puts the playhead at u = 0,
    where the centred label clipped.

**Alternatives considered.**
- **Bring back free zoom** (wheel/pinch/buttons, ADR-011's minimap). Rejected. ADR-021's reasons
  still hold: the lens resolves arbitrary density in place, and two mechanisms for that same job
  are worse than one. Sections do a different job. They are named, bounded, a few clicks deep,
  meaningful to read, and they cannot strand the viewer in an arbitrary window with nothing for a
  minimap to summarise. ADR-021's "no plan to bring zoom back" stays true and stays as written.
- **Force a linear scale inside sections**, or switch scale per level. Rejected: symlog already
  goes near-linear exactly where linear would be wanted, so one rule covers every level, and the
  explicit toggle keeps meaning what it says.
- **Stop playback at the section's end.** Rejected by the human ("Playback should continue").
- **Descend into the next section's first child when climbing** (Permian → Triassic). Rejected: the
  approved rule moves to the parent's next sibling, which keeps the level the viewer is at
  predictable, and one click on a band descends again.
- **Keep steady mode on full-domain pacing.** Rejected: at 1x the playhead would cross Modern in
  about 0.04 s and flip through all six Holocene sections within a few seconds. That is exactly
  the resolution sections exist to add.
- **Holocene stages** (Greenlandian/Northgrippian/Meghalayan) as the Holocene's children. Rejected
  for the approved human-history sections, which are what a viewer looks for in the last
  11.7 kyr. A separate "Human story" shortcut was left out, as the human asked, with the Holocene
  as its proxy.

**Implementation.**
- `web/src/timeline/sections.ts`: new (tree, citations, navigation and continuation rules,
  `eraNameForTime`).
- `web/src/timeline/sectionLayout.ts`: new.
- `web/src/timeline/components/SectionBands.tsx` and `SectionBreadcrumb.tsx` (+ `.module.css`): new.
- `web/src/timeline/eras.ts` and its test: removed.
- `web/src/timeline/scale.ts`: `interpolateWindow`.
- `web/src/timeline/useAnimatedScale.ts`: animated window.
- `web/src/timeline/playback.ts`: `advanceSteadyPlayhead`.
- `web/src/timeline/ticks.ts`: near-linear stepping.
- `web/src/timeline/keyboard.ts`: Escape → `leave-section`.
- `web/src/timeline/Timeline.tsx` (+ `.module.css`): `sectionId`/`onSelectSection` props, windowed
  stepping, markers clipped to the window, focus restoration, controls-row `sections` track.
- `web/src/timeline/components/ScrubTrack.tsx` (+ `.module.css`): edge-anchored playhead readout;
  the readout's line reserved above the track.
- `web/src/timeline/components/SectionBreadcrumb.module.css`: depth-independent row height.
- `web/src/events/presentation.ts`, `components/EventFeed.tsx` (+ `.module.css`): `feedStripCapacity`.
- `web/src/shell/ShellLayout.module.css`: tighter phone row-gap.
- `web/src/timeline/index.ts`: exports and docs.
- `web/src/store/time.ts`: `sectionId`, `selectSection`, section-following `setT`.
- `web/src/app/Experience.tsx`: the window comes from the selected section; steady playback
  through `advanceSteadyPlayhead`; `FULL_DOMAIN_LINEAR_SCALE` removed.
- `docs/DESIGN.md`: §3 (window, playback) and §8 notes.

**Tests.**
- `sections.test.ts`: tiling, hierarchy, ICS and historical boundaries, `sectionPath`,
  `parentSection`, `nextSibling`, `childSectionAt`/`sectionAt` tie-breaks, `eraNameForTime`,
  `continuationSection` (including "none only at the present" across every section),
  `sectionFollowingT`, `sectionEntryT`.
- `sectionLayout.test.ts`: proportional, floored, equal-share, unmeasured and clipped layouts.
- `scale.test.ts`: `interpolateWindow` endpoints, warped midpoint, monotone narrowing, validation.
- `playback.test.ts`: `advanceSteadyPlayhead` constant velocity, carry-over across an edge,
  resting-on-edge, parent's-next-sibling, stops at present, validation.
- `keyboard.test.ts`: Escape.
- `store/time.test.ts`: `selectSection` entry, edge stability, following into the next section and
  up to one that holds a jump, clamped follow.
- `components/SectionNav.test.tsx`: bands with `aria-current`, click, leaf, breadcrumb path and
  click, Escape at a section and at the root, stepping bounded to the section, focus restoration,
  track presses clamped to the section while the scale still spans the whole domain.
- `events/presentation.test.ts` and `components/EventFeed.test.tsx`: `feedStripCapacity`, and no
  strip drawn in a squeezed compact row.
- Existing `Timeline.test.tsx` renders gain the new required props.
- `pnpm vitest run`: 878/878 passing. `pnpm typecheck`: clean.
- Browser-verified with Playwright at 1440×900 and 390×844 (touch): Earth → Cenozoic →
  Quaternary → Holocene → Industrial age narrows the window each time and moves `t` to each start.
  Events resolve individually in Industrial age, with distinct band widths and evenly stepped
  "120 … 260 years ago" ticks. Steady playback from 118 years ago crosses into Modern with the
  breadcrumb following. Scenes-mode playback crosses Pleistocene → Holocene. Escape from a focused
  Holocene band goes to Quaternary with focus on its strip. The breadcrumb's Earth returns to the
  full domain. The playhead readout at a section start sits on the track's left edge instead of
  clipping. No console errors.

**Consequences.**
- The timeline's window is store-derived again. Anything added later that draws on
  `timelineScale` follows the selected section automatically. Anything that must show all of
  history (sparklines, scenes pacing) must keep using a full-domain scale explicitly, as those
  two already do.
- The bottom block gains a ~22px band strip on desktop (the breadcrumb reuses an empty track). On
  a phone it gains a 28px strip plus a compact breadcrumb row. The phone HUD had no slack for
  that, and review found three layout faults at 390×844:
  - The playhead readout sat 12–14px inside the caption's last line. Desktop had the same fault
    whenever the readout fell under the centred caption.
  - The breadcrumb row grew from 11px at Earth to 23px deeper in the tree, so changing section
    reflowed the HUD.
  - The one-line feed strip spilled up to 18px over the CO₂ readout.

  The fixes:
  - `ScrubTrack`'s `.hitArea` reserves the readout's line as a top margin, next to the rule that
    positions it, so the caption stops above it at every breakpoint.
  - The breadcrumb trail has one fixed height at every depth.
  - The phone's HUD row-gap, the timeline's inner gap and the controls row-gap are tightened to
    pay for both.
  - `<EventFeed>` draws no strip when its row is shorter than the strip (`feedStripCapacity`), so
    a crowded phone HUD drops the strip instead of stacking it over the readouts.
- Follow-ups, not done here:
  - Historical sections still label times as "N years ago". A calendar-year (AD/BCE) reading for
    windows inside the Holocene would read better.
  - The shell's era title still names only the top level (`eraNameForTime`), not the deepest
    section.
  - Sections could later carry a short description or a representative scene for the band's
    hover preview.

**Amendment (2026-09-15) — visible shortcuts to move through the section tree; a legible
label for every band, however small its true span.** User, follow-up pass (2026-09-14): "there
should be shortcuts for going 'back' from the current era selection (to the previous parent in
the breadcrumb), and shortcut for going back to full timeline/earth view (more accessible
shortcuts than clicking on the breadcrumb entries to do this)... and there should be a shortcut
to move/progress to the next sibling era of the current one"; and, separately: "otherwise the
nested era selection feature is great!! except the 'early modern, industrial age and modern'
ranges are so small that the labels are not visible, not sure what to do about that."

**Item 6 — keyboard and visible affordances for moving through the tree.**
- `keyboard.ts` gains four intents: `leave-section` (Escape or Backspace — up to
  `parentSection(sectionId)`), `go-to-root` (Home or `0` — to `ROOT_SECTION_ID`), and
  `step-sibling` (`previous`/`next`) on PageUp/PageDown or Shift+←/→. Plain ←/→ (no Shift) are
  unchanged — they still step through events/checkpoints, per the human's own "plain arrow keys
  already step through events and checkpoints, so don't clash with them." Checked against every
  other in-app Escape/arrow handler: `ClusterPopover` and the shared `shell/Panel` (the credits
  panel, and `EventDetailPanel` once follow-up item 12 replaced the feed's old in-place expand)
  both stop `Escape` propagating while open, so this mapping never sees it until they've closed;
  none of the three lives inside `Timeline`'s own DOM subtree regardless.
- `sections.ts` gains `continuationSection` and `previousSiblingStep`: both climb from a section
  through its ancestors for the first sibling any of them has, so running off either edge of the
  tree's first/last branch at a given level moves to the *parent's* next/previous sibling — the
  mirror image of each other, and `continuationSection` is the exact function playback already
  used for "what's next" (this ADR's own "playback continues" decision above), so a viewer
  stepping by hand always lands where playback would carry them. One function
  (`climbToSibling`) is shared between them, parameterised only by which of `nextSibling`/
  `previousSibling` to climb with.
- `SectionBreadcrumb` gains four buttons flanking the trail — "‹ Up" and "Earth" before it, "‹"/
  "›" after — each resolving its target the same way the keyboard shortcut does and reporting it
  through the same `onSelectSection` the trail itself uses. Each carries its shortcut in `title`;
  `TimelineHint`'s mouse-copy hint text lists all four. A button with nowhere to go (at the root
  for "Up"/"Earth", at either end of the tree's first/last branch for "‹"/"›") is `disabled`, not
  removed, so the breadcrumb row's width — already fixed at one height per this ADR's original
  phone-layout fix — never jumps as the selection changes.
- Verified in-browser (1440×900 and 390×844): Escape from a focused Holocene band goes to
  Quaternary; Home from Industrial age returns to Earth without moving `t` (it was already
  inside the root); PageDown from Cenozoic (which has no next sibling — it ends at the present)
  does nothing, matching `continuationSection`'s "only the present has none"; PageDown from
  Mesozoic reaches Cenozoic, PageUp from there returns to Mesozoic. The four breadcrumb buttons
  render, disable correctly at the tree's edges, and their titles show the same shortcut text
  `TimelineHint` does. No console errors at either size.

**Item 7 — legible bands however small the section, and more room for the ones that need it.**
Two changes, exactly as proposed to the human (who did not object):
- **Band widths (`sectionLayout.ts`).** Every section gains a short `abbreviation` (never longer
  than its `label`, always non-empty). `layoutSectionBands` gives each band at least the wider of
  a 28px hit-target floor and its own abbreviation's estimated width, redistributing that room
  from wider siblings in proportion to their own natural share; when even the sum of every
  floor exceeds the strip (the narrowest phones, the most crowded parents), each band instead
  gets a share proportional to its own floor rather than an equal split, so a longer label still
  ends up wider than a shorter one even in that degraded case. `SectionBands` draws a band's
  `abbreviation` in place of its `label` exactly when the band's own *rendered* width (not a
  static breakpoint) no longer fits the full name — so the same section shows its full label on
  a wide parent and its abbreviation once narrowed, and the choice always matches what was
  actually measured, never a guess. The button's `title`/`aria-label` carry the full name
  regardless of which form is drawn, satisfying "abbreviations on narrow screens with full name
  on hover/press." Thin SVG connector lines (`vector-effect="non-scaling-stroke"`) fan from each
  redrawn internal boundary down to where it truly sits on the drawn scale, so a band widened
  past its natural share doesn't quietly misrepresent the section tree's real proportions — this
  is what keeps the floor-proportional degraded case honest rather than merely legible.
- **Section-adaptive symlog knee (`scale.ts`).** `SYMLOG_C` (1e4 years) is tuned so the *entire*
  Holocene stays in the warp's near-linear region against the *full 4.6 Gyr domain* — exactly
  right for that one comparison, and exactly why "early modern," "industrial age" and "modern"
  read as slivers once selecting a section is itself drawn with that same fixed knee: a knee ten
  times the Holocene's own span leaves every sub-Holocene section flattened toward its true
  (tiny) proportion instead of gaining any of the log compression that makes the Cenozoic
  legible against deep time. `symlogKnee(window)` generalises the same reasoning one level at a
  time: within a window narrower than `SYMLOG_C * 1000` (exactly the span where `span / 1000`
  first reaches `SYMLOG_C` itself, so the two rules join with no discontinuity), the knee is the
  window's own span ÷ 1000. Above the threshold — the full domain and every section down through
  the Neogene — `symlogKnee` returns plain `SYMLOG_C`, byte-identical to before this amendment.
  Below it — the Quaternary downward, and every Holocene section — the knee shrinks with the
  window, so whichever child sits nearest the section's own present edge gets room on the track,
  the same way the Holocene itself gets room against the full domain. `createSymlogScale` (the
  scale every window-drawing consumer already takes) is the only call site that changed; nothing
  that deliberately stays full-domain — the event feed's lookback, the HUD sparklines,
  scenes-mode pacing, `scene/pacing.ts`, `globe/effects/math.ts` — is affected, since each of
  those keeps its own window at or above the threshold or its own fixed `SYMLOG_C` on purpose.
  `ticks.ts`'s near-linear check (`isNearLinearSymlogWindow`) now measures the slope ratio
  against `symlogKnee(window)` rather than the bare constant, so log-decade ticks correctly
  replace evenly-spaced ones once a section's own children read as genuinely logarithmic against
  its now-smaller knee.
- **Verification (in-browser, 1440×900 and 390×844, per the queue's own checklist).**
  - *The original complaint.* Selecting Holocene at 1440px now shows all six children — First
    farmers, Ancient civilisations, Medieval world, Early modern, Industrial age, Modern — each
    with its full label, and Modern (111 years, 111/11700ths of the Holocene by true proportion)
    draws visibly wider than a proportional split would give it, purely from the adaptive knee;
    no floor-widening or connector lines were even needed at that width. The original bug —
    labels not rendering at all on a sliver a few pixels wide — is gone.
  - *Fisheye.* Hovering the track inside Industrial age still spreads nearby markers and shows a
    precise sub-year readout ("171.50 years ago"); nothing about the lens changed, since it
    operates on whichever `TimeScale` it's handed, adaptive knee included.
  - *Event feed.* Cards render normally inside a narrow section (Industrial age showed Newcomen's
    engine, the Principia, the Columbian Exchange); the feed's own lookback stays full-domain by
    design (this ADR's original decision), so it was never touched by the knee change.
  - *Playback pacing.* Steady mode inside Industrial age advanced from 265 to 256 years ago over
    2s of wall-clock play at 1x (rate readout "≈ 4 yr/s"), staying inside the section as
    expected — `advanceSteadyPlayhead` paces on whichever scale it's given, so a smaller knee
    inside a small section changes nothing about *how* it paces, only how that section's own
    children would themselves be drawn if selected.
  - *The floor-proportional degraded case, found at 390px.* Holocene's six children, each already
    reduced to its `abbreviation`, sum to more floor (≈420px) than a real phone's band-strip
    content width (≈358px) provides — `flooredWidths`'s "even the sum of every floor does not
    fit" branch (already covered, for the Earth level's six eons, by
    `sectionLayout.test.ts`'s own phone-width test) engages for the Holocene level too, and each
    band renders a few px under its own floor. In the browser this reads as a further-truncated
    abbreviation ("Early mod." clipping to "Early m…", "Industrial" to "Industr…"), not a blank
    or invisible band: every band still has a positive, tappable width (35–72px measured), still
    carries a partial but distinguishable label, still exposes its full name through `title` and
    `aria-label`, and the connector lines still show its true (much smaller) proportion on the
    track beneath. This is judged **not** the "proves poor" case the queue's own fallback note
    anticipated: the original complaint — a label not rendering at all — does not recur, every
    band remains individually selectable without regressing the nested-selection behaviour the
    human explicitly loves, and the six-way split at this exact width is an intrinsically tight
    packing problem (six legible labels in ~358px) rather than a defect in the approach. The
    collapse-to-one-expandable-band fallback was therefore not built. Flagged here rather than
    silently accepted: `sectionLayout.test.ts` gained a matching case for the Holocene's own real
    children (mirroring its existing Earth-level phone-width test) so this specific, verified
    trade-off is pinned by a test rather than only by this paragraph.
- **Consequences.** The section tree's `SectionDefinition` type grew one required field
  (`abbreviation`) that every one of the 26 sections must supply — enforced at the type level
  (`as const satisfies Record<string, SectionDefinition>`), not by convention. Nothing else in
  the tree's tiling or navigation invariants changed. `symlogKnee` is exported specifically so
  `ticks.ts` and any future window-drawing consumer build their near-linear judgement from the
  same knee the scale itself actually used, rather than risking a second copy of the threshold
  logic drifting from the first.
- **Files.** `web/src/timeline/sections.ts` (`abbreviation`, `continuationSection`,
  `previousSiblingStep`), `sectionLayout.ts` (new), `scale.ts` (`symlogKnee`,
  `KNEE_ADAPTIVE_SPAN_THRESHOLD`), `ticks.ts` (near-linear check against `symlogKnee`),
  `keyboard.ts` (four new intents, key-hint constants), `components/SectionBands.tsx` (+
  `.module.css`, new), `components/SectionBreadcrumb.tsx` (+ `.module.css`, new — the old
  breadcrumb folds into it), `components/TimelineHint.tsx` (hint text), `Timeline.tsx` (wires the
  new intents and the two new components in). Tests: `sections.test.ts`, `sectionLayout.test.ts`,
  `scale.test.ts` (`symlogKnee`), `keyboard.test.ts`, `components/SectionNav.test.tsx`
  (breadcrumb buttons, their disabled states). `docs/DESIGN.md` §3 carries a matching v1 note.

**Amendment (2026-09-15) — re-review pass: five real bugs in the follow-up amendment above,
found and fixed against the shipped code rather than the design.** A review pass against the
live app (not just the diff) found the previous amendment's own verification section had missed
several interactions. Fixed here, all within `web/src/timeline` unless noted:

- **Escape fought the chart dock and the expanded globe.** The previous amendment's own
  conflict check ("checked against every other in-app Escape/arrow handler") listed
  `ClusterPopover` and `shell/Panel`, both of which `stopPropagation()` while open — but missed
  two overlays that don't live in React's tree at all: `@/layers`'s `LayerChart` (the chart
  dock) and the expanded `@/globe`'s `Globe`, which each close themselves via their own
  `window`-level `keydown` listener. Neither can be reached by `stopPropagation()`, so with
  focus anywhere inside the timeline, one Escape press closed the overlay *and* climbed a
  section in the same keystroke. Separately, the claim that `ClusterPopover` "lives outside
  `Timeline`'s DOM subtree" was also wrong — `ScrubTrack` renders it directly; it only works
  because it stops propagation, same as `Panel`. Fixed without touching `layers` or `globe`
  (outside this track's ownership): `Timeline` gained an `overlayOpen` prop — `Experience.tsx`
  passes `globeExpanded || expandedChartLayerId !== null`, both already in `store/time.ts` — and
  skips `'leave-section'` for a bare `Escape` (not `Backspace`, which no overlay binds) while
  it's true, leaving the key entirely to whichever overlay's own listener owns it.
- **The adaptive symlog knee badly skewed leaf sections, not just their parents.** The knee
  amendment's own reasoning — shrink the knee so a window's *children* get room near the present
  edge — was verified only inside Industrial age, which itself has no children and never reaches
  `t = 0`. Selecting a genuine leaf that does (Modern, 0–111 years) shrank its own knee to
  `MIN_SYMLOG_KNEE` (the amendment's own "never engages in practice" floor, engaging on every
  Holocene leaf up to about 1,000-year spans): the last 10 years alone drew over half the track,
  and 'steady'-mode pacing — which paces off the identical knee — spent the same lopsided share
  of wall-clock time there. `sections.ts` gained `sectionSymlogKnee(id)`: `SYMLOG_C` for a leaf
  (nothing below it needs room), `symlogKnee(section.window)` unchanged for anything with
  children. `scale.ts`'s `createSymlogScale` and `ticks.ts`'s `generateTicks` both gained an
  optional explicit `knee` parameter so a caller can override the bare per-window default without
  either module needing to know about sections; `useAnimatedScale` threads it through, and
  `Experience.tsx`/`Timeline.tsx` each compute `sectionSymlogKnee(sectionId)` once and pass it to
  every consumer that needs to agree (the resting/animated scale, `AxisTicks`, and
  `advanceSteadyPlayhead`'s own scale builder) — the same value held fixed for the duration of a
  section-change animation, the same "transition shape decoupled from the resting knee"
  simplification `interpolateWindow` already makes with its own fixed `SYMLOG_C`. Verified: the
  reported ~51%/~15% shares for Modern's last 10/1 years are gone (now within a few percent of
  true proportion, matching a leaf reading close to linear); Holocene and every section with
  children are numerically unaffected (`sectionSymlogKnee` returns the exact prior value for
  those). Known residual imprecision, accepted rather than chased further: `advanceSteadyPlayhead`
  computes its scale once per section per call, so several section boundaries crossed within a
  *single* frame (an extreme speed/dt combination) briefly uses the outgoing section's knee for
  the whole catch-up; it self-corrects the next frame and was not reachable in verification at
  any speed up to 64x.
- **A band's floor was shrunk below itself, not merely "shared proportionally."** Item 7's own
  "when even the sum of every floor does not fit, each band gets a share proportional to its own
  floor" undersold what the code did: it *divided every band's floor by the overflow fraction*,
  so at the Holocene's own phone width every band landed a few px under floor exactly as
  documented — but the same branch also engages for the **Earth level's six eons** at 390px
  (never checked in the original verification), where the overflow is closer to 15%, badly
  enough that abbreviations that should have fit outright — `"Modern"`, `"Hadean"` — still
  clipped to an ellipsis. `sectionLayout.ts`'s `layoutSectionBands` no longer shrinks any band
  below its own floor: it now returns `{ bands, contentWidthPx }`, and when the sum of every
  floor exceeds the measured strip, `contentWidthPx` grows to fit them all exactly instead.
  `SectionBands` renders that content at its real pixel width inside a `.strip` that is now a
  (no-op, in every case this ADR's own original verification covered) horizontal scroll
  container, rather than ever rendering an illegibly-squeezed label. Every existing
  `sectionLayout.test.ts` case that exercised the old "shrink" branch was rewritten to assert the
  new "grow the content, never shrink the floor" behaviour instead, plus a new case for the
  Earth-level six-eons regression.
- **The connector lines cut through the labels they were meant to keep trustworthy.** Item 7's
  own connector SVG spanned the band strip's full height (`inset: 0`), so a redrawn boundary's
  leader line ran straight across the label text behind it — visible at both breakpoints, worst
  at the Earth level where three of six labels were crossed. `SectionBands.module.css`'s
  `.connectors` now occupies a slim 4px (5px on a coarse pointer) band pinned to the strip's own
  bottom edge instead of the full height, clear of the vertically-centred label text in every
  case checked in-browser.
- **Minor:** a typo in this amendment's own verification bullet ("without moving `t`o") is
  fixed, and two stale comments — `ShellLayout.tsx`'s About-button comment and the phone
  `.ancestor` comment in `ShellLayout.module.css`, both still describing the fixed-position sound
  toggle removed by follow-up pass item 2 as if it were current — are corrected to describe what
  actually determines the current alignment.

Also fixed in the same pass, outside this ADR's own scope but touching files it amended:
`shell/Panel`'s backdrop closed on `pointerdown`, which a touch tap's synthesised `click` could
then fall through onto whatever was newly underneath (a "ghost tap") — it now closes on `click`
itself, checked against `e.target === e.currentTarget`; `shell/Panel` and `timeline/components/
ClusterPopover` shared one focus-trap implementation (`@/lib/focusTrap`'s new `useFocusTrap`)
instead of each carrying a byte-for-byte copy; and Space/Home/PageUp/PageDown, mapped by
`keyboard.ts` since follow-up items 1–3 moved real buttons and a `<select>` into the timeline's
own keydown subtree, now leave those controls' own native key handling alone instead of
overriding it. See those files' own doc comments and this ADR's sibling amendments for the
audio/events/shell-side fixes from the same pass.

**Files (this amendment).** `web/src/timeline/Timeline.tsx` (`overlayOpen` prop),
`web/src/app/Experience.tsx` (`overlayOpen`, `timelineKnee`), `web/src/timeline/sections.ts`
(`sectionSymlogKnee`), `web/src/timeline/scale.ts` (`createSymlogScale`'s `knee` parameter),
`web/src/timeline/ticks.ts` (`generateTicks`'s `knee` parameter),
`web/src/timeline/components/AxisTicks.tsx` (`knee` prop), `web/src/timeline/useAnimatedScale.ts`
(`knee` parameter), `web/src/timeline/sectionLayout.ts` (`contentWidthPx`, never-shrink-below-
floor), `web/src/timeline/components/SectionBands.tsx` (+ `.module.css`, scrollable track,
bottom-edge connectors), `web/src/timeline/components/SectionBreadcrumb.tsx` (reset button glyph,
see the shell-side amendment for the rest), `web/src/timeline/keyboard.ts` (button/select
guards), `web/src/lib/focusTrap.ts` (new). Tests: `Timeline.test.tsx`, `sections.test.ts`,
`scale.test.ts`, `sectionLayout.test.ts`, `keyboard.test.ts`, `components/SectionNav.test.tsx`,
`web/src/lib/focusTrap.test.ts` (new).

## ADR-025 — An `over-under` chapter: a split-level shot for early life under water

**Status:** accepted — human-directed 2026-09-14. Supersedes ADR-014's "no new shot type" half,
and with it ADR-020's re-affirmation of that half. ADR-020's chapter rules are unchanged.

**Context.** The human asked for more early underwater life, noting that the first creature the
viewer clearly sees is a developed Cambrian swimmer. The human then asked to compress rather than
add scenes, and to rework early scenes so each shows the world above and below the water, "similar
to the Cambrian sea floor one". The pinned `cambrian-seafloor` image is a classic over-under
photograph, but its spec never asked for one: it sits in `waters-edge`, whose `WATER_EDGE` shot
puts the camera "about one metre above the waterline". A split framing has to be explicit to be
repeatable, and it contradicts that shot text, so it cannot be a subject-level request inside
`waters-edge`. ADR-014 withdrew a drafted `UNDERWATER` shot because one such scene would have
split `waters-edge` into two runs. ADR-020 has since made that legal. Here the human asked for the
over-under framing directly, and it covers a run of eight scenes rather than one.

**Decision.**
- **New camera and layout** in `pipeline/prompts.py`:
  - `Shot.SPLIT_LEVEL`: a half-submerged dome port, lens level with the surface, both halves in
    focus.
  - `Composition.SPLIT_WATERLINE` (`split-waterline`): a straight, sharp waterline at 48% of frame
    height, sea horizon at 35%, the left-third mass continuing below the line, the main subject
    underwater just right of centre, light from the upper left.
  - The geometry percentages were measured from the pinned `cambrian-seafloor` image, so that
    image is the chapter's geometric reference. Its light is not: its shadows fall below and
    slightly left. Upper-left light is kept for consistency with the other compositions, and
    shadow direction is checked at review.
- **New chapter** `over-under` ("Above and below the surface"). A chapter owns one shot and
  composition pair (ADR-020), so a second framing is a second chapter. `render_subject` is
  unchanged: under this composition `ground` is the sea floor and `main_subject` is underwater,
  and each record says so in words.
- **One contiguous run of 8 scenes**, archean-shore (3.45 Ga) to silurian-shore (425 Ma). Both
  boundaries are narrative cuts: origin-of-life → archean-shore is life appearing, silurian-shore →
  rhynie-chert is life coming ashore. The committed book goes from 7 to 9 chapter runs out of 53
  scenes.
- **Seven scenes re-specified in place** (id, `t`, `unsourced`, `events` and `pin` unchanged):
  - archean-shore: stromatolites on the sea floor, deliberately no oxygen bubbles.
  - great-oxidation: mats streaming oxygen bubbles; caption no longer says "for the first time".
  - boring-billion-shallows: Bangiomorpha turf restated at landscape scale.
  - cryogenian-snowball: a broad polynya (a contested refugium, hedged in the caption) with clear
    water to a distant ice shelf and a dropstone, no visible life. It is included to keep the run
    unbroken; leaving it in `waters-edge` would add two cuts. Whether a lifeless scene belongs in
    this chapter is still a human call.
  - ediacaran-shallows: Dickinsonia underwater, the first animals clearly seen, with small generic
    fronds behind it. Charnia is not named because it is mainly a deep-water taxon.
  - ordovician-reef-shore: crinoid, bryozoan and coral reef with a metre-long orthocone nautiloid
    below; the liverwort film sits above, on damp rock by a freshwater seep, not at the tideline.
  - silurian-shore: one restricted Euramerican lagoon, with eurypterids and small anaspid-grade
    jawless fish below and Cooksonia above; no reef patch, no jawed fish.
- **`cambrian-seafloor` moves by chapter and shot only.** Its image already has the framing, so
  its subject, caption and pin are kept.
- **Kept in `waters-edge`:** hadean-ocean and origin-of-life (nothing alive to show under water),
  and rhynie-chert, devonian-estuary and late-devonian-tetrapod (the story is on land or the water
  is opaque; a lone split scene would add two cuts).
- **No new scenes.** A Nama Cloudina reef (~548 Ma) is the one candidate held in reserve, not
  drafted.

**Consequences.**
- **Pins.** A pinned node reports PINNED before its digest is compared (ADR-005), so the move and
  the re-specs leave every early scene pinned and `earthtime plan` unchanged in status. Each of the
  seven re-specified scenes needs its pin cleared by a human before it regenerates; until a new
  candidate is picked it leaves the published manifest (ADR-014 precedent).
- **Prompt provenance.** `cambrian-seafloor`'s kept subject still says "plainly visible through
  the shallows" and "mud at the waterline". It no longer matches its shot text word for word;
  ADR-005 tolerates the drift while the pin holds. Align the subject if the pin is ever cleared.
- **Web manifest.** A publish had already written `SPLIT_LEVEL` scenes into
  `data/media/manifest.json` while the web validator still rejected that value. `loadManifest` falls
  back to the stub only on a 404, so the app showed its error panel. `Scene.shot` in
  `web/src/types/manifest.ts` and `SHOT_TYPES` in `web/src/shell/manifest.ts` now accept
  `SPLIT_LEVEL`, and a validator test covers it. The change is additive, so no `schemaVersion`
  bump. A new shot type needs the Python `Shot` enum and both web lists changed together.
- **Interim chapter mismatch.** Until the seven re-specified scenes are regenerated and picked,
  their pinned images are still one-metre-above-water shore frames. They sit in `over-under`
  beside the split-frame `cambrian-seafloor`, so the viewer dissolves across mismatched framings
  inside the chapter. The origin-of-life → archean-shore cut also falls between two shore frames
  that match. Regenerate and pick all seven before a publish is treated as final; do not publish a
  partial set as final.
- **Docs.** VISUAL_SPEC §3 gains a `SPLIT_LEVEL` camera-grammar row. No NORMATIVE section changes.
- **Risk.** 2.5D depth displacement may tear along the waterline, a depth discontinuity. Check the
  live `cambrian-seafloor` render before building the seven.
- **Citations.** Allwood 2006 now points to `events.yaml` first-life, and Bobrovskiy 2018's
  volume and pages are checked. Two inline UNVERIFIED markers remain in `data/scenes.yaml`:
  Webby et al. 2004, and direct co-occurrence of Eurypterus with anaspid-grade fish in a single
  bed.

## ADR-026 — CO₂ near the present comes from measurements, spliced onto GEOCARB III

**Status:** accepted — 2026-09-14.

**Context.** `co2-o2` read only GEOCARB III, a model with one sample every 10 Myr whose 0 Ma value
(276.6 ppm) is a pre-industrial baseline. Every `t` inside the last 10 Myr therefore sampled a
log-linear blend of 276.6 and 277.2 ppm. The HUD read 277 ppm at the present, the ice-age cycles
were missing (the LGM read 277 instead of ~190), and scene prompts described 1750, the LGM and AD
2018 alike as "close to today's level".

**Decision.**
- **One source, three segments.** `sources/co2-o2` splices NOAA GML Mauna Loa annual means
  (1959–2025), the Bereiter et al. 2015 Antarctic ice-core composite (~806 ka to AD 2001) and
  GEOCARB III (570 Ma to 10 Ma) into the single `co2` `TimeSeries`. It is not a sibling source:
  curated files are keyed by shape id, so a second writer of `co2` would silently overwrite this
  one. Per-file provenance moves to `[[artefacts]]` in the source manifest.
- **Newest segment wins.** Each segment keeps only samples strictly older than every sample of
  the segments before it. That drops the ice core's AD 1959–2001 rows and GEOCARB's 0 Ma value.
  The series is disjoint in `t` by construction; the normaliser rejects duplicate `t` within a
  segment because `TimeSeries` does not.
- **Ice-core ages are re-based.** `age_gas_calBP` counts back from AD 1950. `t` counts back from
  the fixed AD 2025 present (ADR-024, `data/events.yaml`), so `t = age + 75`. Mauna Loa years use
  `t = 2025 − year`, and a year after 2025 raises: moving the present is project-wide, not a
  re-pin of one file.
- **Uncertainty only where published.** Measured rows carry their file's own sigma; GEOCARB rows
  keep none.
- **Prompt CO₂ bands** in `pipeline/prompts.py` split the old "< 700 ppm" band at 230, 300 and
  450 ppm. They stay pure in ppm and name no era, because Oligocene GEOCARB values share the
  300–450 band with the 20th century.

**Consequences.**
- **Pins.** Rendered conditions change for scenes inside roughly the last 10 Myr, and so do their
  prompt digests. Pinned scenes report PINNED before the digest is compared (ADR-005), so no
  pinned image is regenerated or dropped from publish.
- **Gap.** ~806 ka to 10 Ma had no data; the log-linear bridge across it read 207–277 ppm, a
  glacial low, where the Pliocene was ~350–400 ppm. `sources/co2-o2` now declares this span a
  `TimeSeries.Gap` (ADR-027, accepted 2026-09-15), so `WorldState.atmosphere.co2_ppm` reads
  `None` there instead of the blend, scene conditions name the gap, and the HUD readout,
  sparkline and chart no longer plot it as a reading. No verifiable Cenozoic proxy file was
  found to fill the span itself: see `sources/co2-o2/README.md` § Known gaps.
- **Re-pinning.** NOAA regenerates the Mauna Loa file monthly, so its pinned sha256 goes stale and
  `make data` fails loudly on a fresh raw directory until someone re-pins it by hand.
- **Web.** The published `co2` layer grows from 58 to 1,977 samples and gains sub-ppm bounds on
  recent rows. The HUD readout hides bounds that round to the same figure, and the sparkline
  switches to a log axis for series spanning at least a decade, so the ice-age cycles and the
  industrial rise stay visible next to the Cambrian peak. `sampleSeries` rebuilding its time
  array on every call was fixed alongside the gap work (ADR-027): a per-series index is now
  built once and cached by object identity.
- **Docs.** DATA_SOURCES `co2-o2` and the source README document the splice. No NORMATIVE section
  changes.

## ADR-027 — `TimeSeries` can mark a span with no data

**Status:** accepted — 2026-09-15. User decision (2026-09-14): "ok can just have no record for
now, the co2 levels isnt a critical metric/feature" — accepting this ADR in place of sourcing a
Cenozoic CO₂ proxy dataset (ADR-026 § Gap, `sources/co2-o2/README.md` § Known gaps).

**Context.** `TimeSeries.sample` interpolates between any two neighbouring samples, however far
apart they are. A spliced source cannot say "nothing is known here". `co2` has no data from
~806 ka to 10 Ma (ADR-026), yet `WorldState` returned a log-linear bridge there. That bridge read
207–277 ppm, a glacial low, where the Pliocene was ~350–400 ppm. The HUD plotted it as a reading.
Scene conditions avoided it only through a hand-kept `CO2_UNRECORDED_SPAN` in `pipeline/prompts.py`,
which duplicated source knowledge in a consumer and needed a cross-check test to stay honest.

**Decision.**
- `TimeSeries` gains `gaps: list[Gap]`, default empty, where `Gap` is `(from_index: int,
  to_index: int)` rather than the originally proposed `(GeoTime, GeoTime)`. Two reasons:
  - **A pair of ages needs a runtime check every time it is read** — "these two floats equal two
    adjacent samples' `t`, in order, with nothing strictly between" — repeated by every
    constructor, every `sample()` call, and independently by `sampleSeries` in web, wherever a
    float mismatch (parquet round-trip, JSON, a re-pinned upstream file shifting a boundary by a
    day) would silently turn a gap into a phantom no-op or a false rejection. A pair of indices
    make "spans exactly one pair of adjacent samples" a structural invariant instead:
    `Gap` itself rejects `to_index != from_index + 1` at construction, so a `Gap` that skips a
    sample or spans zero pairs cannot be built, and no consumer re-derives the check.
  - **Sample order is already a total, deterministic invariant.** `TimeSeries._sorted` always
    sorts `samples` ascending by `t` before anything else runs (including gap validation), so an
    index pair is a stable address into that order, not an accident of construction order —
    and it round-trips through parquet's JSON header and the published layer JSON exactly like
    any other field, no float formatting or epsilon comparison involved anywhere on the wire.
  - The `TimeSeries`-level validator additionally rejects gaps that are out of range or overlap
    (two gaps may touch at one shared boundary sample without overlapping). "Bounded by two
    adjacent samples, nothing strictly inside" needs no separate check: it is what `to_index ==
    from_index + 1` already means.
  - `sample(t)` returns `None` strictly inside a gap (between its two bounding samples,
    exclusive), exactly as it does outside `domain`; at either bounding sample it returns that
    sample's real value.
- The parquet schema is unchanged: `gaps` is a `TimeSeries` field, not a per-sample one, so it
  travels in `write_shape`'s existing JSON header (`pipeline/curated.py`) alongside `unit` and
  `interpolation`, the same way `EventSet`'s `effect` already rides in a row's JSON column. A
  curated file written before this field existed has no `"gaps"` key in that header and reads
  back with the field's default (`[]`) — no migration, no `schemaVersion` bump, no explicit
  backward-compatibility branch anywhere in `curated.py`.
- The published layer JSON mirrors this: `SeriesData.gaps` (camelCase `fromIndex`/`toIndex` on
  the wire) is additive and omitted entirely when empty (`exclude_if`), so a layer file with no
  gap stays byte-identical to one published before this ADR. Web's `parseSeriesData` validates
  an incoming `gaps` array the same way `TimeSeries._gaps_valid` does, after sorting samples
  ascending by `t` exactly as the Python side does.
- `sampleSeries` in web returns `null` for a `t` strictly inside a gap. It also stops rebuilding
  its `t` array with `.map` on every call (co2 now has 1,977 rows) — a small per-series
  `{ts, gapFromIndices}` index, keyed by the `SeriesData` object's identity in a `WeakMap`, is
  built once and reused; `sampleSeries(data, t)` stays a pure function of `t` for a given `data`,
  this is only a cache of work `data` alone already determines.
- The HUD sparkline already breaks its line on `null`; nothing there changes. The readout and the
  chart dock's header now say **"no record"** when `t` is inside the layer's own domain but the
  sample is `null` (a gap), and keep **"no data"** when `t` is outside the domain entirely — the
  only two ways `sample()` returns `null`. Neither component reads `gaps` directly; both infer
  which case applies from `layer.timeDomain`, which `earthtime publish` always sets to the
  series' own `domain` (`pipeline/publish.py` `_layers`), so the inference is exact for every
  real published layer.
- `sources/co2-o2` declares the ice-core segment's oldest row and GEOCARB's oldest-surviving row
  as a gap, located from the splice's real per-segment kept-row counts (`_splice` now returns
  them alongside the flat sample list), not a hard-coded age — a re-pinned ice core or a future
  Cenozoic segment moves the gap with it.
- `CO2_UNRECORDED_SPAN` and its cross-check test are deleted. `AtmosphereState` gains
  `co2_domain: tuple[GeoTime, GeoTime] | None`, the `co2` series' own `domain` when one is
  registered. `pipeline.prompts._render_atmosphere` reads it, not a hard-coded span, to tell
  "`co2_ppm=None` because `t` is inside `co2_domain` but in a gap" ("no CO2 record covers this
  interval") apart from "`co2_ppm=None` because no source reaches this far, or none is
  registered at all" ("no CO2 record reaches this far back") — without prompts knowing which
  source or splice produced either. This is an additive field on `WorldState.atmosphere`
  (NORMATIVE, DESIGN §4); no other field changes shape.

**Consequences.** Every consumer of a series already handled `None`/`null`, so no new branch was
needed downstream beyond the readout/chart wording split above. The contract table's `TimeSeries`
row gains `[gaps]`. Prompt digests for scenes inside the gap (`lucy-afarensis`,
`acheulean-erectus`, `messinian-salt-flats`, `c4-savanna-hipparion`, `panama-land-bridge`) change
once more, but their wording — "no CO2 record covers this interval" — does not; pins hold
regardless (ADR-005). No Cenozoic CO₂ proxy dataset is sourced under this ADR: the gap is named,
not filled. Revisit if a verifiable compiled Cenozoic curve (CenCO2PIP or equivalent) is found —
see `sources/co2-o2/README.md` § Known gaps.

## ADR-028 — Scenes gain a short `title`, distinct from the caption passage

**Status:** accepted — human-directed 2026-09-15.

**Context.** `SceneRecord.caption` (DESIGN §8) is a full descriptive passage — a sentence or two
of prose, e.g. "By 1650, Amsterdam dominates world trade through the Dutch East India Company
(VOC) …". The web layout (ShellLayout's `caption` slot, a subtitle above the timeline) has
always shown that passage alone. Nothing in the data names, in a couple of words, *what a scene
is meant to represent* — the event, milestone or theme a viewer should immediately recognise
before reading the passage underneath it. A user asked for exactly that: "a high-level
heading/label/title that makes it immediately clear what its intended to represent, with the more
detailed existing text passage description content underneath." The timeline's own checkpoint
pips (`Experience.tsx`) had the same gap from the other direction: they already needed a short
label and, lacking one, reused the full `caption` text, which reads as a stray sentence fragment
rather than a name once truncated to pip width.

**Decision.**
- **`title: str`, required, on every `SceneRecord`** (`pipeline/scenes.py`), placed directly
  above `caption` in `data/scenes.yaml` — the two fields are read together (heading, then
  passage), so they sit together in the source. Stripped of surrounding whitespace, non-blank
  after stripping, capped at 40 characters (validated in the model — see Consequences for how
  that cap was reached). Unlike `events` (ADR-022) and `sound` (ADR-023), `title` is **required, not
  optional-and-additive** — every scene needs a heading the moment this field exists, there is no
  "no title" state analogous to "no linked event" or "no ambience stem" for a scene the UI is
  about to show. `SceneBook` enforces uniqueness across every scene's title, the same way it
  already enforces unique scene ids and unique `t` values, so two scenes can never present the
  same heading.
- **Invisible to the asset graph, like `events` and `sound`.** `pipeline/assets.py` builds a
  scene's prompt and image node `inputs` from `scene.shot`, `scene.unsourced` (rendered
  conditions) and `scene.subject` only; it has never read `caption`, and does not read `title`
  either. Adding the field to all 68 existing scenes therefore changes no prompt/image digest and
  clears no pin — verified by `.venv/bin/earthtime plan` reporting identical counts before and
  after (68 scenes: 66 pinned, 0 awaiting review, 2 stale; 41 portraits: 40 pinned, 1 awaiting
  review, 0 stale — the 2 stale scenes and 1 awaiting-review portrait are pre-existing, unrelated
  to this change) and by a new test that retitles a pinned scene in an otherwise-identical
  `SceneBook` and asserts every scene's resolved prompt/image digest is unchanged.
  `pipeline.scenes.patch_pin_line` (the pin-writing helper `earthtime review pick` uses) already
  edits only the single `pin:` line of a record by regex, leaving every other line — comments
  included — untouched, so it needed no change to preserve `title`.
- **Wire format.** `pipeline.manifest.Scene` gains `title: str`, required and always emitted
  (unlike `events`'/`sound`'s additive-and-optional shape, there is no historical manifest
  without it to stay compatible with — this is a coordinated pipeline+web change, not a
  backward-compatible add to a field web already parses leniently). `pipeline/publish.py`'s
  `_scene_entry` passes `scene.title` straight through.
- **Curation.** All 68 scenes in `data/scenes.yaml` are titled by hand: 2-5 words, at most 40
  characters (schema-enforced — see Consequences), Title Case throughout (chosen over sentence
  case and applied to all 68), British spelling matching the captions. Each title names the
  event, milestone or theme the scene represents (e.g. "The Great Oxidation", "Snowball Earth",
  "The First Forests", "The Asteroid Strikes", "Battle of the Somme", "Fall of the Berlin Wall",
  "The Morning Commute") — several of those are the scene's own established scientific or
  historical name (the Cambrian Explosion, the Messinian Salinity Crisis, the Great American
  Interchange) rather than a paraphrase, on the same footing as "Snowball Earth" and "The Great
  Oxidation" above: the phenomenon each caption describes already *is* that named event. No title
  asserts a claim its own caption (or, failing that, its `subject`/comment text) does not already
  support; none was needed as a new fact. No historical title carries a year: an early pass put
  one on nine of the twelve ("Angkor Wat, 1150", "D-Day, 1944", "Apollo 11, 1969" among them),
  inconsistent with the other three ("Battle of the Somme", "Fall of the Berlin Wall", "The First
  Powered Flight") and with the "used selectively" rule this bullet used to state — a
  contradiction a review caught (see below); every year was dropped rather than added to the
  other three, since the events are already unambiguous without one ("D-Day Landings", "Apollo 11
  Lifts Off").
- **Review pass (2026-09-15).** A review of the first cut of titles found, and this fixed: five
  titles that claimed more than their own caption supports ("Earth's Hottest World" for a caption
  that says only "hottest world of the *last 66 million years*" → "A Hothouse Rainforest"; "The
  Origin of Life" for a caption that hedges "may have begun" → "Where Life May Have Begun"; three
  others in the same vein); the year inconsistency above; and eleven further titles that named
  their scene's backdrop rather than its milestone, leant on jargon ("The Acheulean Handaxe" →
  "A Million Years of Handaxes") or an obscure place name ("Göbekli Tepe" → "Monuments Before
  Farming"), or dropped a caption's own hedge ("The First Large Organisms", caption "among the
  first" → "Life Grows Large"). All 68 titles stayed unique throughout.
- **Web (agreed contract, implemented alongside this pipeline change — the two together are what
  this ADR decides).** `ShellLayout`'s `caption` slot shows the title as a short heading with the
  caption passage underneath it; title and passage fade together as one opacity, driven by the
  same `SceneView` dissolve (`dominantScene`/`captionOpacity`) that already drove the caption
  alone. The passage keeps its original `--hud-ink` colour and widens past the previous 62ch cap
  (to `min(74ch, 92vw)`) now that a heading sits above it — a short desktop window (1280x720 is
  the worst case measured) already left the event feed above little spare height with the old,
  narrower, heading-less caption; the wider box makes that pre-existing squeeze a little worse
  still, mitigated (not solved) by tightening the heading-to-passage gap on short viewports. The
  heading itself is a styled `<p>`, not an `<h2>` — the page has no `<h1>` for a heading to root
  under, and this slot is a visual heading (distinct font/weight/size from the passage below it
  and from the top-centre time/era title beside it), not a document-outline one. Timeline
  checkpoint pips (`Experience.tsx`) use `scene.title` for their label instead of `scene.caption`,
  since a short unique heading is what a pip label is for.

**Consequences.**
- `data/scenes.yaml` grows by one required line per scene (68 lines); `data/media/manifest.json`
  gains one `"title"` field per published scene. `earthtime publish --allow-unpinned` followed by
  `make pins` was re-run to confirm a clean publish with the new field; the only manifest diff
  beyond the new `title` lines is the nondeterministic `buildId`.
- A future scene added to `data/scenes.yaml` without a `title` fails to parse, loudly, the same
  way a scene missing `caption` or `subject` already does — no default, no silent fallback to the
  caption text.
- The 40-character curation guideline is schema-enforced (`Field(max_length=40)`) rather than left
  to review discipline, tightened from an initial 60 once the review above showed 40 was never
  actually needed in practice — the longest of all 68 titles is 31 characters.

---

## ADR-029 — Steady-mode presentation regime and speed floor, per scene dwell

**Status:** accepted — human-directed 2026-09-15. Amends DESIGN §3's steady-mode "no pacing at
all" and the ADR-023 audio notes; supersedes none of ADR-016 or ADR-024, which stay exactly as
written for `'scenes'` mode and era-section continuation.

**Context.** `'steady'` mode (ADR-016) is constant velocity in warped screen space with, by
design, no pacing at all: `presentation.ts`'s `MIN_TRANSITION_SECONDS` rate limiter was meant only
as a scrub/fast-playback backstop, never load-bearing. It became load-bearing anyway once the
manifest's coverage grew dense near the present: measured at 1x in the earth section (66 scenes,
`baseRate = 0.02`, `SYMLOG_C = 1e4`), the last 12,000 years (28 of 66 scenes) cross in 3.0 s and
the last 500 years (19 scenes) in 0.19 s — far under the 1.6 s the rate limiter forces every
dissolve to take regardless. The viewer sees one long forced blur from the Neolithic straight to
the final scene, `step`'s own "different pair, settled: rebase" branch skipping every intervening
scene as `presented.to` entirely (the same failure mode `sceneSound.ts`'s once-trigger amendments
already diagnosed for `'scenes'`-mode fast playback), and once-mode scene sounds (the Apollo 11
launch, say) never get the dwell to fire. The human's own framing, and the design this ADR
implements: "playing back at constant speed with 0.19s for 500 years isn't great" — fixed with a
**generic** rule keyed to each scene's own on-screen dwell at the current velocity, not a special
case for recent history, so it applies identically to a dense run of scenes anywhere on the
timeline, including deep time at high speed.

**Decision.**

1. **Dwell ≥ `MIN_TRANSITION_SECONDS` (1.6 s):** crossfade exactly as before — the common case,
   unchanged.
2. **`MIN_CUT_DWELL_SECONDS` (0.35 s) ≤ dwell < 1.6 s:** presentation switches from a crossfade to
   a **hard cut** — an instant image swap instead of a forced multi-second dissolve, so the pace
   visibly accelerates through a moderately dense run rather than blurring through it.
3. **Dwell would fall under 0.35 s:** a **speed floor** on the steady playhead itself, per scene —
   slowed just enough that the scene still gets exactly 0.35 s, so a full-frame image change never
   happens more than ~3 times a second at *any* speed. `MIN_CUT_DWELL_SECONDS`'s value is not a
   taste call: its reciprocal (~2.86/s) sits under WCAG 2.3.1's three-flashes-per-second
   photosensitivity threshold, a hard safety limit — a full-frame content change is exactly the
   kind of "flash" that guideline covers.
   >
   > **Re-review correction (2026-09-15).** The original text here claimed "at most 3 changes in
   > any real 1-second window is a direct mathematical consequence... not a separate property to
   > verify", and dismissed every observed shorter gap as a sampling artefact. A second review
   > found that claim false in three concrete ways, all now fixed (see **Implementation** below):
   > a fixed `1e-9`-in-`u` nudge used to step past a crossed territory boundary was, under a
   > *linear* steady scale over a wide window, a nudge of several real years — comparable to or
   > wider than some scene territories, so it could skip a territory's floored dwell almost
   > entirely (live-measured up to 9 changes/s); a scrub or seek made while steady playback kept
   > running read the regime for whatever territory the scrubbed-to `t` landed in and hard-cut it
   > with **no** rate limit at all, not even the ordinary crossfade one (up to 10 changes/s while
   > dragging); and even with both of those fixed, the *sim-time* floor genuinely does not imply a
   > *wall-clock* one on its own — `advanceSteadyPlayhead` guarantees a territory's dwell in
   > simulated `t`, but real `requestAnimationFrame` delivery is not perfectly uniform, so a run of
   > slightly-early frames can still land two or three real displayed changes closer together than
   > that (live-measured up to 4 changes/s, smallest real gap 232 ms), and a seek landing partway
   > through an already-floored territory only inherits that territory's *remaining* fraction of
   > the floor, not the full 0.35 s. The actual guarantee is enforced at the one place all three of
   > those gaps converge on: `presentation.ts`'s `usePresentedSceneMix` now tracks the real
   > (`performance.now`-scale) timestamp the presented scene's *dominant* member last actually
   > changed, and holds any new change that would land sooner than `MIN_CUT_DWELL_SECONDS` after
   > it, regardless of what `t`/the territory math computed — a wall-clock backstop at the point
   > the property is actually observable (the pixels on screen), not only in the model that's
   > supposed to produce it. See `playback.test.ts`'s new linear-scale and mid-territory-entry
   > coverage and `presentation.test.ts`'s new backstop coverage.
   >
   > **Second re-review correction (2026-09-15).** The backstop above originally held only while
   > `regime === 'cut'`, on the reasoning that a `'crossfade'`-regime change is always rate-limited
   > by `MIN_TRANSITION_SECONDS` and so is never "too soon" on its own. That is true of a
   > crossfade that starts fresh from a settled pair (`step`'s rebase/direct-transition branches
   > always begin exactly at the settled endpoint, so its dominant scene cannot flip sooner than
   > `MIN_TRANSITION_SECONDS / 2` = 0.8 s later) — but the *frame* rendering that flip can still
   > land within `MIN_CUT_DWELL_SECONDS` of an unrelated `'cut'` change immediately before it: a
   > seek forced to `'crossfade'` for exactly one frame right after a `'cut'` change
   > (`Experience.tsx`'s own seek detection), or a `step` same-pair/reversed-pair continuation
   > resuming from a presented mix that was already close to the `0.5` switch point (live-measured:
   > one 266 ms gap / 4 changes in 1 s at 32x). The gate now applies to a change under *either*
   > regime, tracked in a single, regime-neutral `lastDominantChangeAtRef` — holding can only ever
   > delay a flip that would otherwise be too soon, so this adds no new latency to an ordinary,
   > correctly-spaced crossfade. See `presentation.test.ts`'s reworked cut/crossfade coverage.
4. **"Time compressed" marker.** A small, unobtrusive HUD label (`--hud-accent`, the same amber the
   playing state and the active mode-toggle option already use) beside the speed/mode controls,
   visible exactly while the floor (rule 3) is active — a direct function of playback state
   (`Experience.tsx`'s own `steadyFrameRegime`/`steadyPacing` call inside its playback loop), never
   an idle timer, per the ADR-012 amendment ("nothing in the UI fades or hides on inactivity").

None of this touches `'scenes'` mode (already paced to a `SCENE_DWELL_SECONDS +
MIN_TRANSITION_SECONDS` floor per scene, always comfortably above `MIN_CUT_DWELL_SECONDS`), and
none of it touches scrubbing, seeking or paused viewing — those always crossfade, exactly as
before this ADR.
>
> **Re-review correction (2026-09-15).** The original text here reasoned that this followed for
> free because "the presentation regime is computed only from inside the steady-mode playback
> loop's own `onFrame`... a manual drag... does not itself flip `playback.playing`/`mode`". That
> reasoning doesn't hold: `onFrame` runs every frame *while playing* regardless of a concurrent
> drag, and nothing stopped it reading whatever territory the scrubbed-to `t` had just landed in.
> The guarantee is now explicit instead: `Experience.tsx` compares each frame's starting `t`
> against what its own previous frame last produced, and treats any mismatch — a scrub, a
> checkpoint/event jump, a keyboard step, or any other direct `setT` — as a seek, forcing
> `'crossfade'`/not-floored for that frame regardless of what the landed-on territory implies (see
> `scene/steadyPacing.ts`'s `steadyFrameRegime`, below).

**Implementation.**

- **A scene's *territory*** (`web/src/scene/steadyPacing.ts`) is the stretch of `t` between the
  midpoints (`tAtLogP(a, b, 0.5)`, the same log1p interpolation `sceneAt` already uses, now
  exported from `scene.ts` and shared by `scene/pacing.ts` too — one formula, three consumers,
  where two independent copies stood before) of its two neighbouring gaps — exactly where
  `dominantScene` itself switches, so a floor or cut decision for one scene's territory never
  disagrees with the instant its caption and pip highlight also change. Open at the domain edges
  (`0` for the newest scene, `EARTH_FORMATION` for the oldest). `sceneTerritories(scenes)` computes
  every scene's territory once; `territoryAt(territories, t)` bisects to the one containing `t`,
  with an exact shared boundary resolving to the *older* (higher-index) territory — reproducing
  `dominantScene`'s own tie-break (`mix < 0.5 ? from : to`, `to` wins a tied `0.5`) without needing
  scene identity at query time.
- **`steadyPacing(territories, t, rawRate, scale)`** (same file) — pure, returns `{ regime:
  'crossfade' | 'cut', floored: boolean }` for the territory containing `t`, from its dwell
  (`uSpan / rawRate`) against the two thresholds above. `presentation.ts`'s `step` and
  `usePresentedSceneMix` take an optional `regime` (default `'crossfade'`, every pre-ADR-029 call
  site unchanged): `'cut'` skips the rate-limited `moveToward` chase entirely and snaps straight to
  `target`'s own binarized dominant scene (`mix` 0 or 1) — one line, reusing `dominantScene`'s own
  tie-break rather than adding a second one. `converged` (the rAF loop's own "nothing left to do"
  check) is now regime-aware too: comparing against the *binarized* target mix in `'cut'` regime,
  not the raw one, which was drifting inside the same binarized bucket every frame and would
  otherwise have kept the loop busy-spinning for no visible change.
- **The floor lives in `advanceSteadyPlayhead`** (`timeline/playback.ts`), not in presentation —
  presentation only renders whatever `t` the floor already produced. `timeline` does not import
  `@/scene` (an existing, deliberate boundary — `scenesPacing`/`PlaybackPacingSegment` already
  cross it structurally); `SteadySceneTerritory` and a hand-mirrored `MIN_CUT_DWELL_SECONDS` (by
  value, the same convention `scene/pacing.ts`'s own `SYMLOG_C` mirror already established) keep it
  that way. `advanceSteadyPlayhead` gained an optional `sceneTerritories` parameter (default `[]`,
  reproducing its pre-ADR-029 behaviour exactly — every existing call/test needed no change) and now
  integrates `t` in sub-steps bounded by whichever comes first, a territory's own `tNewer` edge or
  the section's: inside a territory whose natural dwell (`uSpan / rawRate`, recomputed fresh every
  territory in the *current* section's scale) would fall under `MIN_CUT_DWELL_SECONDS`, the rate
  for crossing just that stretch is `uSpan / MIN_CUT_DWELL_SECONDS` instead of the requested one — a
  moving speed limit sign, re-evaluated exactly at each scene boundary, never applied more broadly
  than the one scene that needs it. A boundary crossed mid-call (a huge `dtSeconds` — a stalled tab
  regaining focus — crossing several territories in one call) steps to the next territory *by
  index* (`territoryIndex -= 1`, `current = territory.tNewer` exactly), not by re-querying at a
  nudged `t`.
  >
  > **Re-review correction (2026-09-15).** The original text here nudged `current` forward by a
  > fixed `1e-9` in `u` and called it "physically meaningless at this scale" — false: under a
  > *linear* steady scale over a wide window (the root `earth` section, say), `1e-9` of the ~4.6
  > Gyr domain is several real years, comparable to or wider than some scene territories, so the
  > nudge could jump clean over a whole territory's floored dwell (live-measured up to 9 image
  > changes in a single second). Since `steadyTerritoryIndexAt` already knows exactly which
  > territory is nearer the present the moment a boundary is crossed, stepping its index directly
  > costs nothing to compute, needs no `u`-space tolerance at all, and terminates in at most
  > `sceneTerritories.length` steps regardless of how the scale warps `t` — strictly better than
  > the nudge it replaces, not merely a smaller one. See `playback.test.ts`'s new linear-scale
  > coverage.
- **`Experience.tsx`** computes the presentation regime once per playback-loop frame (`onFrame`,
  steady mode only; reset to `{ crossfade, not floored }` the instant `playback.playing` goes
  false, the same "idle state shows nothing stale" rule `ratePerSecond` already follows) against
  the section's own scale and `sceneTerritories(manifest.scenes)` (memoised once, shared —
  unchanged — with the same territories `advanceSteadyPlayhead` floors against), and threads the
  one resulting `{ regime, floored }` to three places: `SceneView`'s new `regime` prop, the "time
  compressed" marker (`Timeline`'s new `timeCompressed` prop → `TimeCompressedBadge`, beside
  `RateReadout` in the same fixed row), and `useAudioEngine`'s new `presentationRegime` input
  (below). The "reached the present, stop cleanly" branch (already there, pre-ADR-029) resets
  `steadyRegime` in the same batch as `setPlaying(false)` rather than leaving it to the separate
  `playback.playing` effect — live-verified this closes a one-committed-frame window where the
  marker could otherwise still read floored for a moment after the playhead had already stopped
  moving.
  >
  > **Re-review additions (2026-09-15), `scene/steadyPacing.ts`'s `steadyFrameRegime`.** Two fixes
  > to what `Experience.tsx` feeds the regime computation, both folded into one small pure wrapper
  > around `steadyPacing` so they're unit-testable without mounting the component:
  >
  > - **Evaluated at the `t` this frame actually renders** (`advanceSteadyPlayhead`'s own return
  >   value), not the `t` playback started the frame at. The two used to differ by exactly one
  >   frame's advance, invisible almost always (consecutive frames are usually in the same
  >   territory) but wrong on the one frame `t` crosses from a comfortably-paced territory into a
  >   dense `'cut'` one: the stale read still said `'crossfade'` for that frame, so a once-mode
  >   sound landing on exactly that boundary (`kpg-arrival`, `first-powered-flight`) could fire
  >   even though the frame it fired on was already rendering the hard-cut territory.
  > - **A `seeked` flag** — `true` whenever a frame's starting `t` is not what this component's own
  >   previous frame last produced (compared via a new `lastAdvancedTRef`) — forces
  >   `'crossfade'`/not-floored regardless of what the landed-on territory implies. Without this, a
  >   scrub or a keyboard step made while steady playback kept running read the regime for
  >   whatever territory the moved-to `t` happened to land in and hard-cut it with no rate limit at
  >   all — live-measured up to 10 image changes a second while dragging, and this ADR's own
  >   "scrubbing... always crossfade" claim (above) was false until this fix. Reset to `null`
  >   alongside `steadyRegime` whenever playback stops, so a resume never compares its first frame
  >   against a stale value left over from before the pause.
- **The wall-clock backstop lives in `presentation.ts`'s `usePresentedSceneMix`** (re-review
  addition, 2026-09-15, made regime-neutral by a second same-day correction — see the
  "Second re-review correction" above) — the point where a change actually becomes visible,
  downstream of everything above. It tracks the real (`performance.now`-scale) timestamp the
  presented *dominant* scene last actually changed under *any* regime (`lastDominantChangeAtRef`);
  a freshly-`step`ped result — `'cut'` or `'crossfade'` alike — that would change the dominant
  scene again sooner than `MIN_CUT_DWELL_SECONDS` (mirrored by value once more, as
  `scene/pacing.ts`'s own `SYMLOG_C` mirror already established the convention) after that is held
  at the previous presented value (same object reference, so `setPresented` is a no-op re-render)
  instead of applied; `converged` then correctly keeps reporting "not yet", so the rAF loop keeps
  retrying every frame until the gate opens. This is what actually closes the remaining gaps the
  sim-time floor alone can't: real `requestAnimationFrame` jitter around it, a seek landing
  partway through an already-floored territory (which only inherits that territory's *remaining*
  fraction of the floor — measuring from the last real change rather than from territory entry
  sidesteps that distinction entirely), and a `'crossfade'`-regime frame (a seek forced to
  `'crossfade'` for one frame right after a `'cut'` change, or a `step` continuation resuming from
  a mix already close to the switch point) landing within the same window as a preceding change
  under either regime. See `presentation.test.ts`'s backstop coverage.
- **The "time compressed" marker stays mounted** (`TimeCompressedBadge`, re-review fix,
  2026-09-15) rather than unmounting via `return null` while not visible: a single playthrough can
  cross the floor threshold several times in quick succession (live-measured up to 10 toggles in a
  few seconds), and repeatedly mounting/unmounting a `role="status"` region that often both
  re-announces it to screen readers more erratically than a live region toggling its own text is
  meant to, and shifts `RateReadout`/the scale toggle beside it. `Transport.module.css`'s
  `.timeCompressed` now reserves a fixed-width slot via `visibility` (mirroring `.rateReadout`'s
  own pattern); the badge's *text content* still toggles between the label and `''`, which is what
  actually re-triggers a screen reader's live-region announcement on each genuine transition into
  the floor.
- **Audio** (`web/src/audio/engine.ts`). While `presentationRegime === 'cut'`: `sceneSoundLoopGains`
  is not called at all — an empty gains object is used instead, so every scene-loop voice's target
  gain drops to 0 and ramps there through its *existing* `GAIN_SMOOTH_SECONDS` fade (never a click,
  nothing new to build); the base ambience curve (`stemGains(t)`) is untouched, so an ambience-loop
  stem a scene also foregrounds (`settlement`, `livestock`, …) still shows its ambient-curve gain
  through the cut — only the scene's own foregrounding contribution mutes, exactly the "ambience
  needs no change" DESIGN §11/ADR-023 note already promised. The once-mode trigger
  (`useSceneSoundOnceTrigger`) is fed `playing && presentationRegime !== 'cut'` instead of bare
  `playing` — reusing `nextOnceTriggerState`'s own, already-thoroughly-tested `playing`/`wasPlaying`
  gate (`sceneSound.ts`, the 2026-09-15 "playing gate" correction) rather than adding a second,
  bespoke condition: a `'cut'` regime reads to that state machine exactly like "not currently
  playing", so nothing fires while it lasts, and the scene under the playhead the moment `'cut'`
  ends is armed off rather than retroactively fired — the same treatment a scene already sitting
  under the playhead gets when playback merely resumes on it. Verified live: at a playback rate that
  spends its whole run cutting through a dense cluster, `getActiveOnceVoices()` never reported a
  voice, and `getStemTargets()['lake-water']` (a genuinely scene-only stem with no ambience curve,
  so any nonzero target for it can only come from `sceneSoundLoopGains`) read exactly 0 throughout
  — including while `angkor-wat` (which names it) was the dominant scene, since at an ordinary
  playback rate its own territory is itself under `MIN_TRANSITION_SECONDS` and so is also `'cut'`
  regime, muted like every other scene passed through in the cluster. Slowed enough that
  `angkor-wat`'s own territory clears the 1.6 s crossfade threshold instead (its own dwell there is
  a direct, deterministic function of `speed`, the same territory geometry throughout), the same
  stem's target rose above 0 while it was dominant — confirming the gate is a genuine on/off signal
  tied to `presentationRegime`, not a stem that simply never sounds in this build.

**Consequences.**

- Steady-mode playthroughs through a dense cluster now take *longer* in wall-clock time than
  before this ADR, not shorter — the floor trades "reads as one indecipherable blur, fast" for
  "reads as a legible fast cut, slower" and that trade is the entire point. Measured: the earth
  section's last 12,000 years, previously 3.0 s at 1x, now takes on the order of 10 s at 1x —
  and, because the floor is speed-independent once it engages (a floored scene's dwell is always
  exactly `MIN_CUT_DWELL_SECONDS`, regardless of `speed`), 8x and 64x cross the same cluster in
  almost the same wall-clock time as 1x rather than 8x/64x faster — an accepted, load-bearing
  consequence of the safety floor, not a bug: a viewer asking for 64x elsewhere on the timeline
  still gets it: only a genuinely dense run of scenes, wherever it occurs, is held to the floor.
- `presentation.ts`'s `step`/`usePresentedSceneMix`, `timeline/playback.ts`'s
  `advanceSteadyPlayhead`, and `scene/pacing.ts` all gained an additional optional parameter with a
  default reproducing today's exact behaviour — no existing caller needed to change, and the full
  pre-existing test suites for all three pass unmodified alongside the new coverage this ADR adds
  (1151 tests after the initial pass; 1162 after the 2026-09-15 re-review's fixes above added
  linear-scale/mid-territory-entry coverage to `playback.test.ts`, wall-clock-backstop coverage to
  `presentation.test.ts`, `steadyFrameRegime` coverage to `steadyPacing.test.ts`, and persistent-
  live-region coverage to `Timeline.test.tsx`).
- `sceneAt`'s own `tAtLogP` helper (previously private to `pacing.ts`, duplicated there rather than
  imported) is now a single shared export of `scene.ts` — a small, deliberate de-duplication this
  ADR's own third consumer (`steadyPacing.ts`) motivated, not a change in behaviour (`pacing.test.ts`
  passes unmodified).
- `prefers-reduced-motion` is unaffected: it already disables camera drift only, and both regimes
  this ADR adds (an instant cut, and a crossfade slowed further by the floor) read as *less*
  motion than the pre-ADR-029 forced-dissolve blur, never more.
- The `'cut'` regime's own boundary case — a crossfade already mid-flight when `t` crosses into a
  territory whose regime is `'cut'` can, rarely, show one visible "pop" (the presented mix jumping
  from wherever the rate-limited chase had reached to the binarized 0/1) rather than a perfectly
  smooth hand-off — noted, not fixed: it never produces more than the one additional image change
  the transition was already going to make, so it cannot itself violate the 3/s safety floor, and
  it is confined to the rare boundary between a comfortably-paced run of scenes and a dense one
  immediately following it.

