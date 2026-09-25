# Earthlapse — Design

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

- Scientific authority. An "artistic reconstruction" disclosure ships with it, one click/tap
  away in the About & credits panel (ADR-012 amendment) rather than pinned on screen throughout.
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
│    ├─ Layer HUD     readouts + growing sparklines               │
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

> **v1 note (ADR-024): the window is bounded again, by era section rather than by zoom.** The
> timeline is divided into a fixed tree of **era sections** (`timeline/sections.ts`): Earth → the
> six eons/eras (Hadean, Archean, Proterozoic, Paleozoic, Mesozoic, Cenozoic) → ICS periods where
> subdividing helps (Proterozoic eras and the Neoproterozoic periods; every Phanerozoic period)
> → Quaternary → Pleistocene/Holocene → six Holocene human-history sections (First farmers,
> Ancient civilisations, Medieval world, Early modern, Industrial age, Modern). Geological
> boundaries come from the ICS International Chronostratigraphic Chart v2024/12, and each
> historical boundary carries its own citation. The selected section is store state, and the
> visible window is that section's window, animated in symlog-warped space when it changes.
> There is still **no free zoom**: a clickable band strip under the ruler shows the current
> section's children, and a breadcrumb (Earth › Cenozoic › Quaternary › Holocene › Industrial
> age) or Escape zooms back out. The scrub track, ruler and bands all draw against
> the windowed scale. Dragging and stepping stay inside the window, including mid-animation (track
> targets are clamped to the section). Scenes-mode pacing and the event feed's lookback stay
> full-domain. Within a section the symlog/linear toggle
> still applies. Symlog stays the default, because `log(1 + t/10⁴)` already draws close to
> linearly across a short historical section while still compressing the Cenozoic usefully. A
> near-linear window gets evenly stepped ruler ticks.

> **v1 note (ADR-024 amendment, follow-up pass items 6-7): reachable without a pointer, and
> legible however small the section.** Escape/Backspace leaves the selected section for its
> parent, Home/`0` returns to Earth, and PageUp/PageDown (or Shift+←/→) step to the previous/next
> sibling section — wrapping to the parent's own next/previous sibling at either end of a branch,
> the same rule playback's own section-continuation already used. The breadcrumb carries matching
> "‹ Up"/"Earth"/"‹ ›" buttons, each disabled (not hidden) with nowhere to go, and a bare Escape
> defers to the expanded globe instead when it is open (`Timeline`'s own
> `overlayOpen` prop). Separately, every section now carries a short `abbreviation`, drawn once a
> band's own rendered width no longer fits its full name, with a floor under every band's width
> (fit to its abbreviation, redistributed from wider siblings) that is never shrunk below itself:
> when even the sum of every floor exceeds the strip, the strip's own content grows past it and
> becomes horizontally scrollable instead, so a label is never truncated below its abbreviation.
> Thin connector lines, confined to a slim band along the strip's own bottom edge rather than the
> full height, keep each band's true proportion legible regardless. The symlog knee itself is
> section-adaptive (`symlogKnee`) for any section *with children* — a window narrower than 10⁷
> years takes a knee scaled to its own span rather than the fixed constant tuned for the full
> domain, so a section's youngest children (Modern within the Holocene, for instance) draw with
> real width instead of collapsing toward their true, tiny proportion — but a **leaf** section
> (Modern itself, say) draws with the fixed constant instead (`sectionSymlogKnee`), since there is
> nothing below a leaf for the adaptive shrink to make room for. See the ADR-024 amendment and its
> own re-review follow-up for the verification (fisheye, event feed, playback pacing) and the
> full history of what changed and why.

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

> **v1 note (ADR-016, superseding ADR-012's pacing bullet).** Two explicit modes ~~share the one
> speed multiplier~~ each keep their own rate (ADR-050, note below), picked with a segmented
> control beside the transport:
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
> - **Steady** — ~~constant velocity in the full-domain scale~~ ~~the selected era section's scale
>   (ADR-024, note below) of whichever scale kind is currently selected (symlog by default,
>   linear when the linear toggle is on)~~ a literal rate in years per second, the same anywhere
>   on the timeline (ADR-050, note below); no pacing at all. ~~Dense scene clusters are simply
>   crossed as reached; `presentation.ts`'s existing minimum-transition rate limiter remains the
>   visual backstop against a crossing too fast to read as a dissolve.~~ Superseded by ADR-029
>   below — that unconditional backstop is exactly what turned a dense crossing into one long
>   forced blur; steady mode now switches presentation regime and, only where even that isn't
>   enough, floors its own rate, per scene.
>
> See `scene/pacing.ts` (segment durations, the bonus) and `timeline/playback.ts`
> (`advancePlayhead`'s two modes) for the mechanism, and ADR-016 for the full rationale.

> **v1 note (ADR-024): playback continues across era sections.** When the playhead runs off the
> younger edge of the selected section, the timeline moves into its next sibling. If the
> section is the last child, it moves up to the parent's next sibling (Permian → Mesozoic), and
> so on until the present, with the same animated window transition as a click. Any other jump
> out of the window (an event card, say) climbs to the nearest section that holds the new `t`.
> Scenes mode keeps its full-domain pacing. ~~Steady mode moves at constant velocity in the
> *selected section's* scale, so each section takes the same wall-clock time at 1x, carrying the
> rest of a frame across an edge (`advanceSteadyPlayhead`).~~ Steady mode keeps its chosen years
> per second across the edge (ADR-050).

> **v1 note (ADR-029): steady mode's "no pacing at all" needs one exception — how long a scene
> is actually looked at.** Measured: at 1x in the earth section, the last 12,000 years (28 of 66
> scenes) crossed in 3.0 s and the last 500 years (19 scenes) in 0.19 s — `presentation.ts`'s
> `MIN_TRANSITION_SECONDS` floor, applied unconditionally, forced every one of those crossings
> into a multi-second dissolve regardless, which reads as a single blur skipping straight from
> the Neolithic to the present; once-mode scene sounds (a rocket launch, say) never got the
> chance to fire either. A generic rule, keyed to each scene's own on-screen dwell at the current
> velocity — not a special case for recent centuries, and it applies identically in deep time at
> high speed if a run of scenes is ever that dense there too:
>
> 1. Dwell ≥ `MIN_TRANSITION_SECONDS` (1.6 s): crossfade exactly as before.
> 2. `MIN_CUT_DWELL_SECONDS` (0.35 s) ≤ dwell < 1.6 s: a hard cut instead of a dissolve — the
>    pace visibly accelerates rather than blurring.
> 3. Dwell would fall under 0.35 s: a **speed floor** — the steady playhead's own rate is slowed
>    just enough that the scene still gets 0.35 s, so a full-frame image change never happens
>    more than about 3 times a second at any speed. That figure is not just a comfortable
>    round number: it is WCAG 2.3.1's three-flashes-per-second photosensitivity threshold, so
>    the floor is a hard safety limit, not a taste call. The numeric year readout is unaffected —
>    it is still exactly `t`, and this floor only ever engages for the genuinely dense stretch
>    that needs it, not the whole playthrough.
>
> ~~A small "time compressed" marker beside the speed/mode controls shows~~ The rate readout turns
> amber, and a status region announces the slowdown, exactly while the floor is active (ADR-050;
> a direct function of playback state, per the ADR-012 amendment above — never an idle timer).
> Scrubbing, seeking, paused viewing and `'scenes'`-mode playback are untouched:
> they always crossfade, exactly as before this ADR — a frame whose starting `t` wasn't produced
> by the steady playhead's own previous advance (a scrub, a checkpoint/event jump, a keyboard
> step) always reads as `'crossfade'`/not-floored for that frame, regardless of what the landed-on
> scene's territory implies. Real `requestAnimationFrame` delivery is not perfectly uniform, so a
> wall-clock backstop (`presentation.ts`) additionally never lets an actual displayed change land
> sooner than `MIN_CUT_DWELL_SECONDS` after the last one, whatever `t`/the territory math say — the
> floor above guarantees the dwell in *simulated* time, this is what guarantees it in the
> wall-clock time a viewer actually experiences. See `scene/steadyPacing.ts` (the regime/floor
> rule, keyed to each scene's *territory* — the stretch of `t` between the midpoints of its two
> neighbouring gaps, exactly where `dominantScene` itself switches — and `steadyFrameRegime`, the
> seek-aware wrapper `Experience.tsx` actually calls) and `timeline/playback.ts`'s
> `advanceSteadyPlayhead` (which applies the floor to the playhead's own rate, stepping territory
> by territory rather than by a numeric nudge in `u`) for the mechanism, and ADR-029 for the full
> rationale, the audio consequences (§11) and the live-measured numbers.

> **v1 note (ADR-050): steady mode is a literal years-per-second rate.** Steady mode no longer
> moves at a velocity in any scale's warped `u`: the viewer picks a rate in years per second on a
> 1-2-5 log scale from 1 yr/s to 1 Gyr/s, and `t` advances by exactly that many years per second
> wherever it is, in any section and under either scale kind. Entering steady mode before a rate
> has been chosen picks a context default: the detent that crosses the selected section — or the
> distance to the present, if shorter — in about two minutes (1 yr/s in Modern or near the present
> at the root, 10–20 yr/s in the medieval and ancient sections, ~50 Myr/s from the Hadean at the
> root). Once chosen, each mode's rate is kept for the session. ADR-029's floor is unchanged in
> meaning and now computed in years: a territory `span` years wide dwells `span / rate` seconds,
> and below 0.35 s the rate is slowed across that territory alone. It only ever slows; the readout
> shows the actual rate, amber while the floor holds. Scenes mode keeps a multiplier on its paced
> velocity, now 1/16× to 64× in powers of two. Both rates are set on one vertical picker beside the
> transport (swipe, drag, wheel, arrow keys, or `[`/`]`/`-`/`=`), which snaps to its detents.

---

## 4. `WorldState` — the central abstraction (NORMATIVE)

Everything derives from a single sampled state function. Prompts, globe textures, layer
values, captions and audio are all *projections* of it. **Nothing else reads curated data
directly.**

```python
class WorldState(BaseModel):
    t: float  # years before present
    plates: PlateSnapshot  # continent positions, from gplately
    climate: ClimateState  # global mean temp, ice extent, sea level, Köppen grid
    atmosphere: AtmosphereState  # O2 %, CO2 ppm, CH4, pressure
    biosphere: BiosphereState  # dominant clades, land cover class, marine/terrestrial
    sky: SkyState  # solar luminosity, moon distance, day length, obliquity
    anthropo: HumanState | None  # population, land use, tech level, settlement density
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

### Cropping to the viewport (ADR-045, ADR-047)

A still is cover-fitted to the viewport — cropped, never letterboxed. Stills are 2752×1536
(aspect 1.79), so a narrow viewport shows only a band of the width: a 390×844 phone in portrait
sees ~26% of it, a 768×1024 tablet in portrait ~42%. Where that band sits is per scene: a scene's
optional `framing.focus` (image fractions, origin top-left) is the point the window centres on,
clamped so it never leaves the image; without one the crop is centred. A wide viewport crops
height instead, the same way along y.

A subject low in the frame still lands under the caption and timeline on a phone, because the
window spans the full height and so `focus.y` has nothing to move. A scene may therefore set
`framing.portrait_zoom` (1–1.5, default 1; `portraitZoom` in the manifest, ADR-047): in a portrait
viewport only, the window shrinks by that factor in both dimensions, and `focus` then places it
vertically as well as horizontally, still clamped to the image. Landscape viewports ignore it.

The v1 drift (`web/src/scene/drift.ts`) moves inside that window, zoomed or not: a push-in of up to 1.05× about
the window's centre plus a lateral pan within the margin the push-in crops off, so it never
reveals anything outside the window. The pan travels in the scene's `framing.pan` direction
(degrees, 0 = toward the image's right edge, 90 = toward the bottom), or a direction hashed from
the scene id without one. Framing is presentation only: it never enters a prompt, a candidate or
an asset digest, so setting it never makes an image stale.

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

**Narrow exception (ADR-034):** a scene may optionally name a genuinely known real place it
depicts — Giza, the Somme, Lucy's discovery site at Hadar — never a plausible-sounding stand-in
for a generic environment. For such a scene, the globe centres on and briefly pulses that
location: present-day coordinates directly inside the human-era basemap domain (`t <= 2.58 Ma`,
§7/ADR-030), a plate-reconstructed paleo position for an older scene, or no marker at all where
no plate model covers it. This does not change ADR-007's default for every other scene, which
remains conceptual and pin-free.

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
> Scene checkpoints are marked on the timeline. Below 760px the ancestor panel stays in that
> same top-right corner rather than claiming a wide band of its own — the portrait shrinks to
> the globe orb's own size and its name/since text collapses to short right-aligned caps lines
> under it, the same treatment the globe orb gives its own label.

> **v1 note (ADR-028).** The caption slot is two parts, not one: `scene.title`, a short heading
> (2-5 words) naming what the scene represents, above `scene.caption`, the detailed passage this
> section originally described — both fade together as one opacity, driven by the same dissolve.
> The passage's text box may be wider than an earlier fixed measure now that a heading sits above
> it. Timeline checkpoint pips are labelled by `scene.title`, not `scene.caption` — a short unique
> heading is what a pip label needs; the full passage stays in the caption slot only.

> **v1 note (ADR-017/ADR-021), further superseding the transport row above.** There is no
> minimap (the row shown above already dropped its "linear minimap" strip — ADR-011's symlog
> overview + hairline linear readout was removed with zoom itself, DESIGN §3) and no zoom
> controls: the timeline's window is fixed to the full `[0, EARTH_FORMATION]` domain and the
> single track shown is a density-adaptive **fisheye lens** (`timeline/fisheye.ts`) that stretches
> in place around the pointer (or a touch press) rather than a separate zoomed-in view. Scene
> checkpoints and event markers that sit arbitrarily close together in time still resolve to
> individually reachable — hovering (or, on touch, the press-and-drag magnifier) opens room for
> them locally; nothing outside the lens moves as it does.

> **v1 note (ADR-024).** The timeline's window is now the selected era section's (DESIGN §3).
> Under the ruler, a strip of hairline-bounded **section bands** (the current section's
> children) sits aligned with the track. Bands too narrow to aim at are widened to a minimum,
> and long labels are elided. The band holding the playhead is accent-coloured. The
> **breadcrumb** takes the controls row's left track, opposite the speed/mode/scale controls,
> so the transport stays centred. Below 760px it becomes its own row above the transport, with
> middle ancestors collapsed to "…". At the root section there is no trail and no navigation
> landmark: on a phone (portrait or short landscape) the row goes entirely; on desktop the
> controls row keeps its height, so entering a section moves nothing.

> **v1 note (ADR-012 amendment, 2026-09-15).** The periphery no longer dims on idle — nothing in
> the UI fades or hides on inactivity, only as a direct function of `t` or a direct user action.
> The always-on footer row (the artistic-reconstruction note plus a Credits link) below the
> transport is gone too: a small muted "About & credits" button sits above the globe orb,
> top-left, opening an in-experience panel (VISUAL_SPEC §9) instead of navigating to `/credits`.

> **v2 note (ADR-033).** The expanded globe (§7) gains a "Globe / Map" segmented toggle,
> top-left of the fullscreen panel — not top-centre, which is the time/era title's own spot,
> lifted above this panel's backdrop while expanded. It unfolds the sphere into an Equal Earth
> map over ~0.8s eased; see `docs/GLOBE.md`'s own v2 note and ADR-033 for the mechanism.

> **v2 note (ADR-048).** A window under 500px tall and wider than it is tall — a phone held
> sideways — takes a third layout, exclusive of the phone-portrait and desktop ones. The time title
> stays centred at the top with an era shortcut either side of it, About top-right. The globe orb
> and ancestor portrait fill the top corners as far down as the height allows; the layer readouts
> are hidden (the orb still expands the globe). One row holds the one-line event strip on the left
> and the caption's title on the right, as a button that opens the passage in a panel. The timeline
> has the breadcrumb on its own row above the track, and the transport with the playback-mode,
> scale and volume controls in a column left of it. Expanded, the globe splits the screen: a left
> column of chrome, the sphere or map to its right (`docs/GLOBE.md`, "Expanded-view chrome").
>
> On desktop the controls row sits midway between the section bands and the window's bottom edge,
> with the play button on the track's centre (the rate picker hangs off the transport's left, the
> rate readout off its right, or under it in a window narrower than 1200px so the mode, scale and
> volume controls keep one line), and the globe orb's top sits on the top inset beside the About
> button. The caption's shade fades to nothing at every edge in every layout.

Muted, blurred surround holding globe, metrics and overlays around a bright central
viewport. Scalar layers appear as a readout over a sparkline of the story so far: linear time
from the layer's first sample to `t`, linear value from zero to the peak reached, so the playhead
is always the trace's right end (ADR-053). One sparkline component, N layers.

### Event feed

Surfaces events as playback reaches them, rather than only on a timeline hover — the roadmap's
"non-intrusive playback pop-up cards" and "event card (description + citation)". Lives in
`web/src/events` (`selectFeedEvents`, `<EventFeed>`), a self-contained prop-driven package like
`timeline`, `scene` and `layers`; `ShellLayout`'s `feed` slot sits below the readouts, on the
one stretch of the periphery that is never the globe orb, the ancestor panel or the scene
caption, at every breakpoint (a compact single-card strip directly above the timeline on a
phone).

Selection is a pure function of `t` alone — no timer decides what shows, and nothing is measured
off the rendered layout. The unit of selection is the *cluster* (`web/src/events/cluster.ts`,
ADR-040), not the raw event: `clusterEvents` partitions the whole event list into bursts of
near-simultaneous events, sorted by `Event.placement_t` (ADR-022). A candidate event joins the
current cluster only when **both** its gap to the immediately preceding event and its gap back to
the cluster's own first (freshest) member are below `CLUSTER_SPAN` — bounding the cluster's total
extent, not merely each adjacent step, so "one cluster" always means "these happened at
essentially the same time" as a whole, not just pairwise. A gap —
`log2((newer + RECENCY_FLOOR_YEARS) / (older + RECENCY_FLOOR_YEARS))` — is a fixed property of the
two events' own placements, independent of `t`, so cluster membership never re-forms or flickers
as playback scrubs and can be computed once per event list. A cluster is a candidate once any of
its members is "behind" the playhead (reached on the forward march from deep time toward the
present); its own freshness is its **freshest reached member's**. Candidates are ordered
freshest-first and the most recent `DEFAULT_MAX_VISIBLE` of them show (one on a phone). **A card
therefore leaves only when a newer cluster arrives to take its slot** (ADR-039, extended to
clusters by ADR-040), never because it aged out while the feed had room — an under-full feed
evicts nothing. A single-member cluster looks exactly like a lone event card always has; a
multi-member one shows its freshest member as the headline plus a "+k more" badge, growing
monotonically as playback reaches further into that same burst — never evicting a member already
shown, only gaining more as `t` advances. So **every event behind the playhead always shows,
full stop, now possibly inside a digest card alongside the rest of its burst** rather than
evicting its neighbours one at a time.
`DEFAULT_LOOKBACK_AGE_RATIO` (10, plus a 25-year floor) is a far outer bound, not the working
rule: it stops "200 years ago" reaching back into the Neolithic if the intervening centuries
happen to be empty, and on the published event set it almost never binds. It still applies
per event, so an individual member can age out of a digest independently of its clustermates. The
bound deliberately ignores the selected era section (ADR-024) — scaled to a zoomed-in window it
would shrink to a few decades inside the Industrial age and empty the feed exactly where the
viewer zoomed in to read history.

Presentation is scaled separately from selection, by `FRESH_AGE_RATIO` (2): a card's opacity and
small resting offset follow how far behind the playhead it sits, relative to that reference
rather than to the lookback bound. Opacity floors at `MIN_CARD_OPACITY` instead of reaching zero,
since a retained card can legitimately sit far past the reference age and an invisible card is
the same defect as an evicted one. The freshest card alone carries a "just reached" emphasis —
an accent bar, wash and title glow in its primary tag's colour — that eases away across the
first third of its window, derived from the same distance, so it too reproduces on a scrub back;
fast playback through a dense stretch hands the one highlight to each newly reached event
rather than strobing several. Under reduced motion the highlight stays, static, and the arrival
slide-in and drift are dropped. Revisiting a given `t` reproduces the exact same feed regardless
of which direction it was reached from, and a paused/hovering viewer sees the same nearest-behind
cards a playing one would — selection reads only `t`, nothing else. **No event is excluded because the current scene's caption already names it.** An earlier
pass tried that (`Scene.events`, ADR-022) and it back-fired (W-followup item 4): `kpg-arrival`
and `kpg-darkness` both link `k-pg-impact`, so the event stayed hidden from the feed for the
entire span either scene was on screen — including well past the moment the impact itself was
reached, exactly when a viewer would expect to see it surface. Every event behind the playhead
always shows, full stop.

`EVENT_TAG_PALETTE` (`web/src/events/tagPalette.ts`) is the one place an `EventTag` maps to a
colour and a name. Each card shows its primary tag as a small muted label in that colour next to
the date — never colour alone, the label text is what actually distinguishes tags for a viewer
who can't see colour — read straight from the palette so the card, the detail panel and the
legend below can never disagree with each other. Colouring the timeline's own event markers by
tag is still deferred (ADR-022); until it happens, `EventTagLegend` (a plain six-dot key, mounted
inside the About & credits panel rather than claiming any of the feed's own tight vertical
budget permanently) stays scoped to what the feed shows.

Clicking, tapping or Enter-ing a card opens `EventDetailPanel` (ADR-054): the event's full label,
date or range, *every* tag it carries (not only the primary one), the full description and the
citation. For a digest card (ADR-040) it lists every reached member of the cluster in full, not
only the headline the card shows. The card docks where the "All events" list does (`EventDock`),
above the timeline, with no backdrop, so the timeline stays visible and usable. Opening it moves
`t` to the event, through the same store path `<Timeline>`'s own `onScrub` uses; an arrival opened
on the expanded globe leaves `t` alone. Its Previous and Next buttons, or a horizontal swipe, step
to the neighbouring events in the list's order; its back button opens the list, and × closes both.
Opening the card or the list pauses playback if it was running, and closing the last of them (×
or Escape) resumes it, as a direct consequence of the click that opened or closed it, never an
idle-driven change (§8's ADR-012 amendment: nothing in the UI fades or hides on inactivity, only
as a direct function of `t` or a direct user action).
A timeline event marker (the room-decluttered uncertainty band, ADR-019) does **not** open the
same panel: unlike a checkpoint pip, an event band is deliberately `pointer-events: none` so the
scrub track's hit area stays one continuous drag surface across a dense stretch of overlapping
bands rather than acquiring a field of tiny dead zones; making bands clickable would fight that
on purpose without a larger restructure, so the feed stays the one place a viewer opens an
event's detail from. A single polite `aria-live` announcement per newly-freshest event is
throttled during fast playback rather than firing on every event a dense stretch crosses.

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
earthlapse plan                  # what is stale and what it will cost
earthlapse build --only images   # generate, respecting pins and ceiling
earthlapse review                # candidate picker
earthlapse publish               # upload to R2, emit manifest.json
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
- **Day length** — 21-hour Precambrian days. Published (`day_length`, not chartable) and read
  by the audio score, but not shown on the HUD: it reaches ~24 h early and then barely moves,
  so its readout gave way to a larger event feed (2026-09-14).
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
  source: CuratedRef                    // one of the five shapes (DATA_SOURCES § Contract)
  sample(t: number): LayerValue         // PURE, interpolated
  render(value: LayerValue): ReactNode
}
```

Purity of `sample` is what makes scrubbing and speed control work. A layer reading anything
other than `t` is a bug.

---

## 11. Audio

Three tiers. Tier 1 is the highest value-per-effort item in the project.

1. **Layered ambience stems.** ~~~10 CC0 loops (wind, water, rain, insects, birds, mammals,
   fire, machinery, traffic, voices)~~ (thirteen stems as built, no `machinery`: v1 note
   below), each with gain driven by `WorldState(t)`. ~~Insects fade in during the Devonian,
   birds in the Cretaceous~~ (re-dated by the ADR-023 amendment), cities in the Holocene. Cost: zero.
   Because it is parameterised by `t`, it responds correctly to scrubbing and speed changes
   — a fixed soundtrack cannot.
2. **Procedural score** (Tone.js). Drone pitch and timbre from atmospheric composition,
   rhythmic density from biodiversity, brightness from temperature. Never loops, never ends.
3. **Narration** (optional toggle). Local TTS — Piper or Kokoro — over generated event
   descriptions. Free.

> **v1 note (ADR-023, amended 2026-09-18).** Sound is **on by default** and switched off per
> viewer through a HUD speaker toggle (persisted in `localStorage`, a master volume alongside
> it). A stored preference always wins, so a viewer who has turned sound off stays off; the
> default applies only when nothing is stored.
>
> Browsers still require a gesture before any audio, so "on" is a preference, not a claim about
> what is audible: the toggle carries a distinct **pending** state (on, but waiting for the
> first click or key press) so it never shows sound that cannot yet be heard. What the default
> costs on cold load is the Tone.js chunk — **79 KB gzipped**, now fetched at page load rather
> than on a first "on" click, since `loadTone()` runs as soon as `enabled` is true. It remains a
> separate dynamic chunk, not part of the main bundle. The sixteen ambience stems (~31 MB) are
> **not** affected: `buildRuntime` only runs once `Tone.start()` has resolved, and stem buffers
> load after that, so they still cost nothing until a viewer interacts.
>
> - **Tier 1** is sixteen ambience stems (`wind`, `water`, `storm`, `volcanic`, `forest`,
>   `wing-hum`, `insects`, `large-animal`, `birds`, `archosaurs`, `mammals`, `livestock`, `fire`,
>   `settlement`, `industry`, `traffic`), each gained by a pure `stemGains(t)` built from smooth
>   raised-cosine ramps in `log1p(t)` (symlog) space between cited boundary dates — most of them
>   `events-core` event ids (`land-plants`, `dinosaurs`, `k-pg-impact`, `livestock-domestication`,
>   `agriculture`, `industrial-revolution`, the flood-basalt events, …), so a stem's fade lines up
>   with the event feed instead of an independently-chosen date. `wind`/`water`/`storm` are a
>   **pre-land bed only**, fading to exactly 0 by 370 Ma — inside the post-`first-forests` window,
>   once land is vegetated enough for `forest` (a terrestrial rustle bed) to carry the bed in their
>   place, rather than the Carboniferous boundary itself; `insects` only starts at 300 Ma, the date its
>   one cricket-stridulation clip's own citation (Song et al. 2020) actually supports —
>   `wing-hum`, a quiet, generic (non-stridulating, non-bee) wing-drone clip, instead covers the
>   325 → 300 Ma gap on its own citation (Grimaldi & Engel 2005's unambiguous winged insects, not
>   Song et al.'s stridulation date) and persists, rather than receding, once `insects` itself
>   starts (2026-09-15 "wing-hum" amendment, closing the "era fit v3 fixes" amendment's own
>   "Unresolved" item); two isolated, scene-local "nothing living is on screen" windows
>   (`eocene-oligocene-icesheet`, `messinian-salt-flats`) and a
>   K-Pg-impact-and-aftermath window silence `forest`/`wing-hum`/`insects`/`birds`/`mammals`
>   together; `large-animal` bridges the Permian-Triassic gap (~270 → 201 Ma) before handing off to
>   `archosaurs`; a dated Last Glacial Maximum bump (Clark et al. 2009) restores `wind` for
>   `pleistocene-steppe` alone, which has no free `sound` slot for it (era-fit v3, ADR-023
>   amendment 2026-09-15, corrected by its "era fit v3 fixes" amendment, also 2026-09-15). A pure
>   `humanDominance(t)` (0 before 1761, 1 at present) ducks `forest`, `wing-hum`, `insects`,
>   `birds`, `mammals` and `livestock` as industry and traffic take over, the wild stems already
>   receding to 0.7 of it as farms and cities spread (11.5 → 5 ka); scene-local dips drop the
>   humid bed under the glacial steppe, the crowd, hearth and traffic under scenes with nobody in
>   them, and goats under the pre-1492 Americas; a scene's own sound ducks the rest of the bed by
>   up to 40% (ADR-023 amendment "the bed follows the scene"); `fire` is a late
>   Palaeozoic wildfire window and a hearth layer that ends with agriculture (ADR-023 amendment
>   "fire is not a permanent bed"). Twenty-one further
>   **scene-only** stems have no curve and are reached only through a scene's
>   `sound`: `geothermal`, `buzzing`, `knapping`, `artillery`, `lake-water`, `geiger-counter`,
>   `chainsaw`, `howler-monkeys`, `hippo`, `wall-chiselling`, `church-bell`, `ship-rigging` (loop)
>   and the one-shots `impact`, `rocket`, `aircraft`, `mammoth`, `steam-whistle`, `ship-horn`,
>   `klaxon-horn`, `tram-bell`, `sauropod` (a one-shot is a stem published with
>   `loopSafe: false`, and
>   may name a `startSeconds` offset to skip a silent lead-in). `archosaurs`/`livestock` (both
>   ambience stems) were re-sourced in place, same ids and curve, after their original Wikimedia
>   Commons `.ogg` files were found not to decode in Safari/iOS (WebKit has no Ogg-container
>   support); every published stem is now MP3, decoded by every shipped browser. Full curve
>   table and citations: ADR-023 §1 and its 2026-09-14 and 2026-09-15 amendments.
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
>   fires a single playback the instant the scene becomes **dominant** during playback (not
>   while scrubbing), at most once per arrival — redefined from "becomes the *settled* on-screen
>   scene" (as first built) by two 2026-09-15 amendments ("once-mode arrival is dominance, not
>   settle", then a same-day "target-driven" follow-up): a wall-clock-rate-limited presentation
>   can fail to ever fully settle in a densely-scened stretch at higher playback speeds, so the
>   arrival trigger no longer waits for that. Reuses the tier-1 stem catalogue rather than a
>   second asset pipeline — see ADR-023 §3.
>
> Full stem/score/pipeline/manifest design: ADR-023.
>
> **As-built web engine** (`web/src/audio/`, IMPLEMENTATION.md A6): `stemGains.ts`/`score.ts`/
> `sceneSound.ts` are pure (`stemGains(t, flatBasaltWindows)`, `scoreParams(t, series,
> catastropheWindows)`, `sceneSoundLoopGains(presented)`, the `nextOnceTriggerState`/
> `useSceneSoundOnceTrigger` arrival state machine — `engine.ts` feeds this one the raw,
> un-rate-limited target `SceneMix` rather than the visually-throttled presented one everything
> else here uses, so it can never miss a scene the playhead actually passes through), built on
> one shared `ramp.ts` helper
> (`rampLog`, `bump`) — none of the three import `tone`, so the math is unit-tested with no
> Tone.js in the test bundle. **Stem buffers load on demand, not eagerly** (ADR-023 amendment
> "on-demand loading", 2026-09-15, re-review fixes also 2026-09-15): `loadPlan.ts`'s pure
> `stemsNeeded(input)` says which stems the next few seconds of *real, playback-paced* time (or
> a small margin around a paused/scrubbed `t`) call for — calling `timeline/playback.ts`'s own
> `advancePlayhead` rather than approximating its math — including a scene's own loop-mode gain
> sampled across the window (not just its arrival `t`) and a wider, priority-ordered window for
> scene stems (`once` ahead of everything else). `bufferCache.ts`'s `StemBufferCache` — also
> `tone`-free, unit tested as plain state transitions — turns that into a bounded set of fetches
> (nearest-priority-first, capped at 3 concurrent, a fetch not started until a paused/scrubbed
> `t` has actually settled for ~300ms) and evictions (a 60s idle timeout, an LRU cap on total
> *decoded bytes*, not seconds — channel count and sample rate vary per stem). A failed fetch or
> decode backs off exponentially before retrying; a decode failure (an unsupported
> container/codec on this browser) is never retried again this session. `engine.ts`'s
> `useAudioEngine` is the one stateful, Tone.js-owning hook that drives it: lazy `await
> import('tone')` behind the first "on" click, its own `fetch`+`AbortController`+
> `decodeAudioData` (not `Tone.ToneAudioBuffer`'s own un-abortable fetch) so a fetch for a stem
> that stops being needed is cancelled rather than left running, an ambience stem's decoded
> buffer downmixed to mono client-side (roughly halves its memory, no pipeline dependency
> needed), a `Tone.Player` built only once a loop-kind stem's buffer is actually decoded *and*
> still needed — starting at the gain node's already-0 initial value with the player's own
> existing `fadeIn`, so a late arrival is inaudible — and a bare buffer for a one-shot, read
> straight from the loader by `playOnce`, which records a pending trigger and resolves it against
> whatever is presented once the buffer actually lands, rather than assuming it always will be
> the same scene (`stemVoices.ts`'s pure `planStemVoices` still decides ambience-loop vs
> scene-loop vs one-shot vs unusable; missing/failed stems skipped with one deduped
> `console.warn`, never a throw), each looping player confined to its stem's published `loop`
> region when it has one, stopped (not disposed) once its target gain has sat at ~0 for 20s rather than looping silently,
> every curve, scene-loop and once gain multiplied by the stem's published `levelTrimDb` (so a
> gain means the same loudness whichever clip it drives: loops at a -30 dB reference, one-shots
> 10 dB above), once-mode voices that fade out when their scene leaves the screen, a
> development-only `window.__earthlapseAudio` snapshot (context state, the gain the last tick
> wrote per looping stem, the once voices still playing, and the loader's own ready/loading/error
> state), a small always-modulating drone/filter/tremolo score voice ducked under scene sound, an
> `AudioContext` suspend/resume on tab visibility change, and — a deliberate, documented
> departure from the drafted spec signature — ownership of the toggle's own persisted enabled/
> master-volume state (`persistence.ts`, `localStorage`, try/catch), so `Experience.tsx` needs
> exactly one hook call (`useAudioEngine`, now also passed `playback` and the selected section's
> window) and one component render (`<SoundToggle />`, `toggle.tsx`, inline in the timeline
> transport's secondary controls since the 2026-09 follow-up pass moved it there from a fixed
> top-right corner, `M` to mute anywhere). Published stem filenames are content-hashed
> (`<id>-<hash>.<format>`, same amendment) so a CDN can cache them `immutable`. Public surface:
> `web/src/audio/index.ts`.
>
> **ADR-029 amendment (2026-09-15).** `useAudioEngine` takes one further input,
> `presentationRegime` (`'crossfade' | 'cut'`, default `'crossfade'` — `Experience.tsx`'s own
> steady-mode `steadyPacing` result, §3's speed floor). While `'cut'`: `sceneSoundLoopGains` is not
> called (every scene-loop voice's target gain drops to 0 and fades through its existing
> `GAIN_SMOOTH_SECONDS` ramp, never a click) and the once-mode trigger is fed `playing &&
> presentationRegime !== 'cut'` rather than bare `playing`, reusing `nextOnceTriggerState`'s own
> `playing`/`wasPlaying` gate so a hard-cut stretch neither triggers a new one-shot nor piles up
> several under images that are each on screen for a fraction of a second. The ambience curve
> (`stemGains(t)`) is untouched either way — stretched over a slowed, floored playhead it reads as
> a natural, unbroken settlement→industry→traffic build, exactly the "needs no change" this
> section already promised for it.

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
