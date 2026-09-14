# Earth Timeline — Design

> An interactive, immersive visualisation of Earth's history: a continuously evolving
> photoreal view of the planet's surface across 4.6 billion years, surrounded by live data
> layers, fully scrubbable.

**Status:** design agreed; ready for contract definition and a vertical slice.
Sections marked **NORMATIVE** are contracts. Changing one requires an ADR in
[`DECISIONS.md`](./DECISIONS.md), not a code change.

Companion documents:
- [`VISUAL_SPEC.md`](./VISUAL_SPEC.md) — art direction, prompt architecture, style contract
- [`DATA_SOURCES.md`](./DATA_SOURCES.md) — every dataset, how it's accessed and integrated
- [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) — phasing and agent work packages
- [`DECISIONS.md`](./DECISIONS.md) — ADR log

---

## 1. Product statement

A browser experience where a view of Earth's surface evolves across the whole of deep time.
The user can sit back and watch it play, or grab the timeline and explore — scrubbing across
the whole 4.6 Gyr span, hovering to open a density-adaptive fisheye lens that resolves
individual scenes and events down to whatever separates them, however close together, speeding
up, slowing down, toggling data layers.

Playback and exploration are the **same mechanism**: playback is just `t` advancing
automatically. There is no separate "video mode".

### Design pillars

1. **Continuity over comprehensiveness.** A coherent sense of one planet changing beats a
   complete catalogue of events. Artistic licence is granted; plausibility is the bar, not
   precision.
2. **Real data wherever real data exists.** Continents, climate, CO₂, population and
   phylogeny are measured things. Only the *view* is generated.
3. **Everything is a pure function of `t`.** One time cursor; every visual, datum and sound
   projects from it. This is what makes scrubbing, speed control and playback one feature
   instead of three.
4. **Nothing is pre-rendered that could be rendered live.** No video files for connective
   transitions. See §5.
5. **Contributable.** A new data layer is one directory and one PR, requiring no asset
   regeneration.

### Non-goals

- Scientific authority. A visible "artistic reconstruction" note ships with it.
- Exhaustive event coverage. ~200 curated events, not 5,000.
- A backend. The viewer is fully static.
- A 3D world. See §5 — the 3D is a thin parallax effect, nothing more.

---

## 2. Architecture

```
┌─ OFFLINE (Python) ──────────────────────────────────────────────┐
│                                                                 │
│  sources/*/ ──fetch──► data/raw/ ──normalise──► data/curated/   │
│                                                      │          │
│                                                      ▼          │
│                                              WorldState.at(t)   │
│                                                      │          │
│                      ┌───────────────┬───────────────┼────────┐ │
│                      ▼               ▼               ▼        ▼ │
│                prompt render   globe textures   layer series  captions
│                      │                                          │
│                      ▼                                          │
│               image generation                                  │
│                      │                                          │
│                      ▼                                          │
│              depth estimation                                   │
│                      │                                          │
│                      └──────────────┬───────────────────────────┘
│                                     ▼                            │
│                          manifest.json + media                   │
└─────────────────────────────────────┼───────────────────────────┘
                                      │ published to R2 + CDN
┌─ RUNTIME (browser, fully static) ───▼───────────────────────────┐
│  time store — a single `t`                                      │
│    ├─ Scene view    stills + depth, parallax + dissolve         │
│    ├─ Globe view    INDEPENDENT three.js sphere, real geodata   │
│    ├─ Timeline      warped scale, LOD events, scrubbing         │
│    ├─ Layer HUD     sparklines → expandable charts              │
│    └─ Audio         stem mixer + procedural score               │
└─────────────────────────────────────────────────────────────────┘
```

Two build systems, deliberately separate — their invalidation semantics differ:

- **Data build** — deterministic, cacheable by checksum, run occasionally. A `Makefile`.
- **Asset build** — nondeterministic, costly, needs human review and pinning. A custom
  content-addressed graph (§9).

---

## 3. Time model

### Representation

`t` = **years before present**, float, positive into the past. Present = 0.
Range `4.6e9 → 0`. Never store calendar dates for deep time; convert at the edges only.

Every event carries an uncertainty interval `[t_min, t_max]`, not a point. "First
multicellular life" is a contested range; rendering it as a band is both more honest and
more interesting than fake precision.

### Screen mapping — three scales, user-switchable

| Scale | Mapping | Purpose |
|---|---|---|
| `symlog` (default) | `log(1 + t)`, linear region near present | Legible across the full range |
| `density` | CDF of event density | Equal room per event; best for browsing |
| `linear` | true proportional | Deliberately useless — see below |

The `linear` toggle is a **feature**. Animating symlog → linear collapses all of human
history to sub-pixel width. It is the most effective educational moment available and the
most shareable thing in the product. Build it early.

### Level of detail (no user zoom)

~~Continuous zoom from a 4.6 Gyr span to a 1-year span.~~ Every event carries
`importance: 0..1`; events fade in as the visible span shrinks. A 1D quadtree — the same
idea as map tile LOD.

> **v1 note (ADR-019), superseding the paragraph above for rendering.** A global importance
> floor keyed only to the visible span left most of the axis empty at full zoom-out (few events
> clear a floor near 1) and hid markers a user had explicitly asked to see by hovering. Event
> markers are now **room-based**: every event overlapping the window is a candidate, and
> `importance` only breaks a collision between two whose displayed bands would otherwise overlap
> — see `timeline/declutter.ts` and ADR-019. Scene checkpoint pips get the analogous treatment
> (`timeline/checkpointLayout.ts`): pips too close to render individually merge into one cluster
> marker instead of stacking into vertical rows. Both run on the fisheye-distorted scale
> (ADR-017), so hovering the track reveals whatever lacked room at rest. Stepping (keyboard,
> transport buttons) is unaffected either way — it always reaches every event/checkpoint
> overlapping the window, never just what currently has room to draw.

> **v1 note, further superseding both paragraphs above.** Zoom (buttons, wheel/pinch, double-
> click, keyboard shortcuts, and window framing on event/cluster click) is removed outright, not
> just deferred: the timeline's visible window is now a fixed constant, `[0, EARTH_FORMATION]`,
> never state. Resolving events or checkpoints that sit arbitrarily close together in time —
> down to individually clickable, regardless of how dense the surrounding stretch of history is
> — is instead the job of the fisheye lens (ADR-017), whose magnification is density-adaptive
> rather than a fixed factor: it stretches further where the pointer sits over a denser run of
> markers. Clicking a checkpoint cluster (ADR-019) reports its members for a member-list surface
> rather than zooming into it, since there is no window left to zoom. This was a deliberate,
> human-directed product decision (the lens makes a second, separate "zoom" mechanism
> redundant), not a temporary v1 cut — there is no plan to bring zoom back.

> **v1 note (ADR-021), delivering on the density-adaptive promise above.** `Timeline` feeds the
> lens a `markers` list — every checkpoint's instant and every event's range endpoints — so gap
> insertion has every position on the track that might need room opened up around it, not only
> the plain bump under the pointer; the K-Pg trio (ADR-017's own worked example) resolves to
> individually hoverable, tappable scenes under it. The hover readout's own precision now
> adapts too (`formatGeoTimePrecise`), so a 1px move inside a resolved gap visibly changes the
> reading instead of both sides collapsing to the same rounded figure. The member-list surface a
> cluster click reports into is a small in-track popover the track opens itself
> (`ClusterPopover`): pick a member and it scrubs there and closes; Escape or a press elsewhere
> closes it. On touch/pen, pressing the track additionally shows a floating magnifier above the
> finger (`TouchMagnifier`, modelled on the mobile text-selection loupe) — a further-zoomed strip
> of the track around the touch point plus the same precision readout — so the same "reachable
> regardless of how close together" guarantee holds for a finger, which can't hover.

~~A persistent **linear-scale minimap** under the main axis keeps the warp legible and the
distortion honest.~~

> **v1 note (ADR-011), itself now superseded.** The minimap shipped as a **symlog overview**
> with a hairline linear strip beneath it (a "% of Earth's history" readout). It is removed
> alongside zoom above: with the window fixed to the full domain there is no window position
> left for a minimap to summarise, and the fisheye lens already shows, in place, how compressed
> or expanded the pointer's neighbourhood currently reads.

### Playback

Playback rate is **constant events-per-second** — the playhead moves at constant velocity in
*warped screen space*. A linear playthrough would spend 99.98% of its runtime in the
Proterozoic. Speed control is a scalar multiplier on that velocity; nothing else changes.

> **v1 note (ADR-016, superseding ADR-012's pacing bullet).** Two explicit modes share the one
> speed multiplier, picked with a segmented control next to the speed selector:
>
> - **Scenes** (default) — every scene gap takes the same wall-clock time to cross regardless
>   of how many years it spans: `SCENE_DWELL_SECONDS` split across the gap's two neighbouring
>   holds, plus `MIN_TRANSITION_SECONDS` through the dissolve band, plus a small bonus (up to
>   2 s, saturating) on the holds only for gaps that cover a lot of the timeline — so a vast
>   deep-time gap feels slightly longer, and the fast-moving playhead on the track itself
>   conveys the elapsed time, without breaking the rhythm of scenes closer together. Within a
>   segment the playhead moves at exactly the velocity its duration demands; there is no cap
>   against the ordinary rate (ADR-012's hybrid is gone). Outside every scene's span, and in
>   every segment `scene/pacing.ts` doesn't cover, the playhead moves at the ordinary flat rate.
> - **Steady** — constant velocity in the full-domain scale of whichever scale kind is
>   currently selected (symlog by default, linear when the linear toggle is on); no pacing at
>   all. Dense scene clusters are simply crossed as reached; `presentation.ts`'s existing
>   minimum-transition rate limiter remains the visual backstop against a crossing too fast to
>   read as a dissolve.
>
> See `scene/pacing.ts` (segment durations, the bonus) and `timeline/playback.ts`
> (`advancePlayhead`'s two modes) for the mechanism, and ADR-016 for the full rationale.

---

## 4. `WorldState` — the central abstraction (NORMATIVE)

Everything derives from a single sampled state function. Prompts, globe textures, layer
values, captions and audio are all *projections* of it. **Nothing else reads curated data
directly.**

```python
class WorldState(BaseModel):
    t: float                       # years before present
    plates:     PlateSnapshot      # continent positions, from gplately
    climate:    ClimateState       # global mean temp, ice extent, sea level, Köppen grid
    atmosphere: AtmosphereState    # O2 %, CO2 ppm, CH4, pressure
    biosphere:  BiosphereState     # dominant clades, land cover class, marine/terrestrial
    sky:        SkyState           # solar luminosity, moon distance, day length, obliquity
    anthropo:   HumanState | None  # population, land use, tech level, settlement density
```

`WorldState.at(t)` interpolates from curated data. Pure function, unit tested against known
checkpoints.

Two properties that justify the discipline:

- **Prompt continuity is free.** Consecutive prompts render from consecutive states, so they
  differ *only where the world differs*. No prompt chaining, no drift accumulation.
- **Transition semantics are explicit.** `diff(state_a, state_b)` says exactly what changed,
  so a caption or transition can describe it rather than infer it.

Prompts are **rendered from templates**, never free-written by an LLM at generation time.
An LLM may help draft a template; it does not author prompts per-event.

---

## 5. The scene view — what the "3D" actually is

**This is not a 3D world and there is no game-style scene graph.** Two distinct mechanisms
are involved and they should not be conflated:

> **v1 note (ADR-009).** The parallax described below is **deferred out of v1**. The first
> version renders a plain cross-dissolve between flat stills — no depth maps, no
> displacement. The upgrade is a genuine drop-in later: depth maps are generated offline and
> the renderer swaps a flat plane for a displaced one, changing nothing else and regenerating
> no assets. The rest of this section describes the eventual target.

### Within one image — parallax breathing

Each generated still is a flat plane in three.js whose vertices are displaced slightly by
its depth map. A bas-relief, like a pop-up book. Moving the camera a small amount produces
genuine parallax because near pixels sit closer than far ones.

The camera can only move a *little* — a slow push or lateral drift of a few percent of frame
width — before occlusion gaps appear where there is no data behind the foreground. This is
the "3D photo" effect. **Its only job is to stop the image feeling like a still.**

### Between images — cross-dissolve

Content change (ocean → shore → forest) is a depth-aware cross-dissolve between separately
generated images. A 2D operation. No camera continuity is involved.

### Therefore

The experience is honestly described as: *a sequence of stills, each breathing with slight
parallax, dissolving into one another.* The sense of continuity comes from consistent
framing, consistent style, and the dissolve — **not** from an actual continuous camera.

The real lever is **composition discipline**: if consecutive images share a horizon line and
rough mass layout, the dissolve reads as a morph rather than a cut. That is a prompting
constraint, handled in [`VISUAL_SPEC.md`](./VISUAL_SPEC.md), not a rendering one.

### Decision: no generated video for connective transitions (ADR-001)

Generated video for ~200 transitions costs $100–500 per pass and cannot be scrubbed. Both
disqualifying. Stills + depth, rendered live, gives exact scrubbing, one-multiplier speed
control, a ~150 MB payload instead of gigabytes, and instant iteration with no render step.

**Exception:** 3–5 genuinely generated video moments where motion carries real meaning
(Chicxulub impact, Snowball Earth thaw). These play as inline clips, not connective tissue.

Optional offline enhancement: [RIFE](https://github.com/nihui/rife-ncnn-vulkan) for baked
interpolation frames on selected transitions. Local, free.

### Vignette

The viewport is vignetted and blurred at the edges. Aesthetically motivated (HUD surround)
*and* technically motivated: displacement artefacts from depth-map occlusion edges appear
exactly at frame margins.

---

## 6. Vantage points

The vantage is **conceptual, not a real geographic location**. It flows through archetypes
as the interesting action relocates:

```
magma ocean → steaming shallow sea → Archean shore → Ediacaran seafloor
→ Devonian estuary → Carboniferous swamp → Permian interior → Jurassic floodplain
→ Cretaceous forest → [impact] → Paleocene recovery → Eocene jungle
→ Pleistocene steppe → Neolithic valley → river settlement → city → metropolis
```

Grouped into **chapters**, each a held composition (one shot, one framing). Within a chapter's
run of scenes, composition is held constant and only the world changes — that is where the
emotional weight lives. At a boundary between two different chapters the composition changes,
which reads as a cut. A chapter is not required to be a single contiguous stretch of the
timeline: it may **recur as several non-adjacent runs** wherever its framing suits the subject
again later (ADR-020) — e.g. a waterside chapter, an unrelated open-ground scene, then the
waterside chapter again. Each run still reads as continuous in itself; it is still a cut at
every boundary between runs of *different* chapters.

**Open question (§14):** the trade-off is few chapters (each held long → very continuous but
repetitive, less coverage) versus many chapters (better coverage of how Earth changed, but
more cuts). Sweet spot is empirical; test 8 vs 14 in Phase 1. Recurrence (ADR-020) doesn't
resolve this trade-off, only removes the structural penalty for forcing scenes into a framing
that doesn't fit them just to avoid it.

Because the vantage is conceptual, **there is no pin on the globe.** The globe shows
planetary state only. (ADR-007)

---

## 7. The globe view

**Fully independent of the scene view.** A separate three.js sphere driven by real
geographic data, with its own render path. The only thing it shares with the scene view is
`t`.

- Textures baked offline per timestep from PaleoDEM elevation/bathymetry plus derived
  biome, ice and land-use layers.
- At runtime, sample the two nearest timesteps and blend — genuinely continuous motion, not
  keyframe morphing.
- Slowly rotating, interactive (drag to spin, click to expand).

**Subordinate in the layout** — a persistent corner overlay, not a peer view. Clicking it
expands to fill; it is never the default focus.

---

## 8. Layout

```
┌──────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░ ┌────────┐ ╔══════════════════════════╗  ┌────────┐ ░  │
│  ░ │ GLOBE  │ ║                          ║  │ancestor│ ░  │
│  ░ └────────┘ ║      SCENE VIEWPORT      ║  │portrait│ ░  │
│  ░ ┌────────┐ ║   (2.5D, vignetted)      ║  └────────┘ ░  │
│  ░ │ CO2 ▁▃▅│ ║                          ║  ┌────────┐ ░  │
│  ░ │ O2  ▅▃▁│ ╚══════════════════════════╝  │ caption│ ░  │
│  ░ │ temp▂▄▆│                               └────────┘ ░  │
│  ░ └────────┘                                          ░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
├──────────────────────────────────────────────────────────┤
│  ◄◄  ▶  ►►   1×    [═══════════●══════════════════]      │
└──────────────────────────────────────────────────────────┘
```

> **v1 note (ADR-012):** the boxed layout above is superseded. The scene fills the window
> behind an elliptical lens vignette. The same slots float, unboxed, in the darkened periphery:
> - globe orb top-left, readouts beneath it
> - time/era title top-centre
> - ancestor top-right
> - caption as a subtitle above the timeline
>
> Scene checkpoints are marked on the timeline.

> **v1 note (ADR-017/ADR-021), further superseding the transport row above.** There is no
> minimap (the row shown above already dropped its "linear minimap" strip — ADR-011's symlog
> overview + hairline linear readout was removed with zoom itself, DESIGN §3) and no zoom
> controls: the timeline's window is fixed to the full `[0, EARTH_FORMATION]` domain and the
> single track shown is a density-adaptive **fisheye lens** (`timeline/fisheye.ts`) that stretches
> in place around the pointer (or a touch press) rather than a separate zoomed-in view. Scene
> checkpoints and event markers that sit arbitrarily close together in time still resolve to
> individually reachable — hovering (or, on touch, the press-and-drag magnifier) opens room for
> them locally; nothing outside the lens moves as it does.

Muted, blurred surround holding globe, metrics and overlays around a bright central
viewport. Scalar layers appear as sparklines that expand into full-width charts docked to
the timeline; because the chart shares the timeline's warped x-axis, the value under the
playhead is always directly above it. One chart component, N layers.

### Event feed

Surfaces events as playback reaches them, rather than only on a timeline hover — the roadmap's
"non-intrusive playback pop-up cards" and "event card (description + citation)". Lives in
`web/src/events` (`selectFeedEvents`, `<EventFeed>`), a self-contained prop-driven package like
`timeline`, `scene` and `layers`; `ShellLayout`'s `feed` slot sits below the readouts, on the
one stretch of the periphery that is never the globe orb, the ancestor panel or the scene
caption, at every breakpoint (a compact single-card strip directly above the timeline on a
phone).

Selection is a pure function of `t`, the animated `TimeScale` and the feed's own measured
pixel width — no timer decides what shows. An event is a candidate once it is "behind" the
playhead: its placement (`Event.placement_t`, ADR-022) has been reached on the forward march
from deep time toward the present, and its *displayed* distance behind `t` — measured in
pixels on the same warped scale the timeline itself draws against, not raw years — is within a
lookback constant. Because the lookback is a pixel budget on a nonlinear axis, it automatically
spans a handful of years near the dense present and hundreds of thousands of years in sparse
deep time, with no separate branch for either regime. Cards are freshest-first, capped (a
"+k more" line covers the rest of a dense cluster), each one's opacity and a small resting
offset a function of how close it sits to falling out of the window. An event the current
scene's caption already names (`Scene.events`, ADR-022) is skipped, never duplicated. The same
rule makes scrubbing backward well-behaved: revisiting a given `t` reproduces the exact same
feed regardless of which direction it was reached from, and a paused/hovering viewer sees the
same nearest-behind cards a playing one would.

A card expands in place to its full description and citation on click/tap/Enter, and scrubs
the timeline to that event via the same `onScrub` path `<Timeline>` itself uses — there is no
second selection mechanism. A single polite `aria-live` announcement per newly-freshest event
is throttled during fast playback rather than firing on every event a dense stretch crosses.
`EVENT_TAG_PALETTE` (`web/src/events/tagPalette.ts`) is the one place an `EventTag` maps to a
colour, so the timeline's own eventual colouring by tag (ADR-022, deferred) reuses it rather
than inventing a second legend.

---

## 9. Generation pipeline (NORMATIVE)

A content-addressed asset graph. Each asset's identity is
`hash(inputs + generator_config + generator_version)`. A rebuild recomputes hashes and
regenerates only stale nodes. Nix/Bazel semantics.

### Pinning approved outputs

Generation is nondeterministic, so a rebuild must **never silently replace an approved
image**:

1. Node is stale → generate `N` candidates.
2. Candidates surface in a local review UI.
3. Human picks one → chosen asset hash written into the scene record.
4. Future rebuilds honour the pin unless explicitly cleared.

Without this the project is unusable after week two.

### Budget guard

A `spend.json` ledger and a hard `--max-spend` ceiling; the generator refuses to proceed
past it. **Not optional** — an agent in a retry loop can consume the entire budget in
twenty minutes.

### CLI

```
earthtime plan                  # what is stale and what it will cost
earthtime build --only images   # generate, respecting pins and ceiling
earthtime review                # candidate picker
earthtime publish               # upload to R2, emit manifest.json
```

**Do not** reach for Dagster or Prefect (ADR-006). The DAG is small; the custom semantics
(candidates, review gates, pinning, spend ceiling) are the entire value. A ~400-line
resolver plus a `Generator` protocol per provider so vendors stay swappable.

---

## 10. Data layers

**Infrastructure:** atmospheric O₂, CO₂, global mean temperature, sea level, ice extent,
biodiversity (genus count with the Big Five marked), human population, energy use per capita.

**The ones that land:**

- **Your direct ancestor at `t`** — ~50 nodes from LUCA to *H. sapiens*, dated from TimeTree,
  one generated portrait each (~$5 total). A persistent corner portrait that changes as you
  scrub, expanding to a full lineage strip. Strongest hook in the product for the least
  effort in it.
- **Day length** — 21-hour Precambrian days, as a small rotating clock.
- **Moon's apparent size** — it was dramatically closer. Render it in the sky, not as a number.
- **Solar luminosity** — the faint young Sun and the genuine unsolved puzzle it poses.
- **What's under your feet** — user picks a modern city; gplately reconstructs its
  paleo-position, latitude and climate.
- **Galactic position** — ~20 laps of the galactic centre.
- **Impact craters** and **magnetic reversals** as event lanes.

### Layer interface (NORMATIVE)

```ts
interface Layer {
  id: string
  name: string
  timeDomain: [number, number]          // years BP
  surface: 'globe' | 'timeline-lane' | 'hud' | 'scene-overlay'
  source: CuratedRef                    // one of the four shapes
  sample(t: number): LayerValue         // PURE, interpolated
  render(value: LayerValue): ReactNode
}
```

Purity of `sample` is what makes scrubbing and speed control work. A layer reading anything
other than `t` is a bug.

---

## 11. Audio

Three tiers. Tier 1 is the highest value-per-effort item in the project.

1. **Layered ambience stems.** ~10 CC0 loops (wind, water, rain, insects, birds, mammals,
   fire, machinery, traffic, voices), each with gain driven by `WorldState(t)`. Insects fade
   in during the Devonian, birds in the Cretaceous, cities in the Holocene. Cost: zero.
   Because it is parameterised by `t`, it responds correctly to scrubbing and speed changes
   — a fixed soundtrack cannot.
2. **Procedural score** (Tone.js). Drone pitch and timbre from atmospheric composition,
   rhythmic density from biodiversity, brightness from temperature. Never loops, never ends.
3. **Narration** (optional toggle). Local TTS — Piper or Kokoro — over generated event
   descriptions. Free.

> **v1 note (ADR-023), making all three precise.** Sound is **off by default** and switched on
> per viewer through a HUD speaker toggle (persisted in `localStorage`, a master volume
> alongside it) — browsers require a gesture before audio anyway, and this also gates Tone.js
> itself: it is dynamically imported only after that first "on" click, never bundled eagerly.
>
> - **Tier 1** is ten stems (`wind`, `water`, `storm`, `volcanic`, `insects`, `birds`,
>   `mammals`, `fire`, `settlement`, `machinery`), each gained by a pure `stemGains(t)` built
>   from smooth raised-cosine ramps in `log1p(t)` (symlog) space between cited boundary dates —
>   several of them `events-core` event ids (`land-plants`, `first-forests`, `k-pg-impact`,
>   `control-of-fire`, `agriculture`, `industrial-revolution`, the flood-basalt events), so a
>   stem's fade lines up with the event feed instead of an independently-chosen date. Full curve
>   table: ADR-023 §1.
> - **Tier 2**'s mapping is restricted to what `WorldState` actually has curated data for today
>   (`co2`, `day_length`) plus `events-core`'s `catastrophe` tag — not the temperature/
>   biodiversity DESIGN sketched above, because `paleoclimate`/`hyde`/`pbdb` aren't built yet
>   (DATA_SOURCES.md). CO2 stands in for atmospheric brightness, day length drives pulse
>   density directly (a genuinely apt substitute — the planet's own rotation), and proximity to
>   a catastrophe-tagged event shifts the harmonic mood toward minor/dissonant. The score ducks
>   under an on-screen scene's own sound (§ below) rather than fighting it. Real temperature/
>   biodiversity mappings are additive follow-ups once those sources land (ADR-023
>   Consequences), not a redesign.
> - **A fourth thing DESIGN never named**: optional per-scene sound (`SceneRecord.sound`,
>   `data/scenes.yaml`) — a scene names a tier-1 stem id and a `mode`. `loop` ties the stem's
>   gain to the scene's own on-screen presentation weight (pure in `t`, scrub-safe). `once`
>   fires a single playback when the scene becomes the settled on-screen scene during playback
>   (not while scrubbing), at most once per arrival. Reuses the tier-1 stem catalogue rather
>   than a second asset pipeline — see ADR-023 §3.
>
> Full stem/score/pipeline/manifest design: ADR-023.
>
> **As-built web engine** (`web/src/audio/`, IMPLEMENTATION.md A6): `stemGains.ts`/`score.ts`/
> `sceneSound.ts` are pure (`stemGains(t, flatBasaltWindows)`, `scoreParams(t, series,
> catastropheWindows)`, `sceneSoundLoopGains(presented)`, the `nextOnceTriggerState`/
> `useSceneSoundOnceTrigger` arrival state machine), built on one shared `ramp.ts` helper
> (`rampLog`, `bump`) — none of the three import `tone`, so the math is unit-tested with no
> Tone.js in the test bundle. `engine.ts`'s `useAudioEngine` is the one stateful, Tone.js-owning
> hook: lazy `await import('tone')` behind the first "on" click, ten crossfade-looped
> `Tone.Player`s (missing/failed stems skipped with one deduped `console.warn`, never a throw),
> a small always-modulating drone/filter/tremolo score voice ducked under scene sound, an
> `AudioContext` suspend/resume on tab visibility change, and — a deliberate, documented
> departure from the drafted spec signature — ownership of the toggle's own persisted enabled/
> master-volume state (`persistence.ts`, `localStorage`, try/catch), so `Experience.tsx` needs
> exactly one hook call (`useAudioEngine`) and one component render (`<SoundToggle />`,
> `toggle.tsx`, fixed top-right in the HUD periphery, `M` to mute). Public surface: `web/src/
> audio/index.ts`.

---

## 12. Tech stack

**Pipeline:** Python 3.12, pydantic v2, `gplately`, xarray for rasters, `httpx` + `tenacity`,
Typer CLI, Parquet for curated data.

**Frontend:** Next.js (static export) + TypeScript, react-three-fiber for scene and globe,
`d3-scale` for the warp (no d3 DOM), zustand holding the single `t`, Tone.js for audio.

**Serving:** fully static. JSON manifest + media on Cloudflare R2 (zero egress — matters for
media), site on Cloudflare Pages. No backend in the viewer.

---

## 13. Budget

| Item | Estimate |
|---|---|
| Draft images (cheap model, ~600 gens) | $5–15 |
| Final images (premium, ~200 + retries) | $25–45 |
| Ancestor portraits (~50) | $5 |
| Marquee video moments (3–5 clips) | $10–25 |
| Depth maps, interpolation, audio, TTS | $0 (local) |
| Hosting | $0 (free tiers) |
| **Total** | **~$45–90** |

Against a $100 ceiling, enforced in code (§9).

---

## 14. Open questions

1. **Chapter count.** Few (continuous but repetitive) vs many (better coverage, more cuts).
   Test 8 vs 14 in Phase 1.
2. ~~**Does depth displacement hold up at wide-vista framing?**~~ Deferred out of v1 by
   ADR-009; revisit when the 2.5D phase begins.
3. `symlog` or `density` as the default scale for a first-time visitor?
4. Should the ancestor portrait be photoreal (matching the scene) or illustrated (clearly a
   diagram)? Mixed registers may read better than uniform ones.
5. Globe texture resolution vs payload — where is the knee?

---

## 15. On-demand generation (v2)

Users supply their own API key (localStorage) to generate a view for any (lat, lon, t). The
prompt is `WorldState` sampled at that point — gplately for paleo-coordinates, PaleoDEM for
elevation and land-vs-sea, Köppen dataset for climate. Falls out of §4 nearly for free,
which is a good sign the abstraction is right.

Direct browser→provider where CORS allows; otherwise a stateless Cloudflare Worker proxy
that stores nothing. This is what makes the project read as a *platform* rather than a film.
