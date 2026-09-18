# Globe v2

The globe view (DESIGN §7): what it shows across all 4.6 Gyr, where each piece of data comes
from, and how it moves. The decisions are recorded in [ADR-013](./DECISIONS.md). This document
holds the detail, the measurements behind it and the build order.

**Status.** §2 (G1), G2 (§2.3's sRGB fix, §7's caption slot), G5 (§6's `effect` field and the
`globe-regimes` `EventSet`), G7 (§4.1's 1000–540 Ma Merdith continents) and G8 (§4.2's pre-1 Ga
regimes) are implemented, and the globe now covers all 4.567 Ga — see §9 for what's still
partial. §3 (motion-compensated plate rotation, G3/G4) and §5.1/§5.2 (ice sheets, clouds) are
still design, prototyped only where that was cheap. No image generation is involved anywhere in
this document; every item costs $0 of the image budget.

Honesty rule for the whole globe: **real data is shown as data; everything else is labelled on
the globe itself** ("stylised relief", "artistic reconstruction", "geography unknown"). The old
"No reconstruction before 540 Ma" label is gone — replaced by G7's per-span raster captions
(§7) and G8's per-regime captions, with `NO_RECONSTRUCTION_CAPTION`
(`web/src/globe/blend.ts`) as the generic fallback for a genuine gap (today, only the ~47 Myr
between Earth's formation and the oldest cited regime, 4.567–4.52 Ga — see §9's G8 note).

> **v2 note (ADR-033): the expanded globe unfolds into an Equal Earth map.** A "Globe / Map"
> toggle, only shown expanded, morphs the sphere into an Equal Earth projection (Šavrič, Jenny &
> Jenny 2018) over ~0.8s eased — the same mesh, the same textures/effects/captions, no second
> flat-map view to keep in sync. The morph is a **curvature unroll**, not a per-axis lerp of the
> two projections' xyz output (that faceted the sphere's silhouette into a hexagon one way and a
> literal square the other — ADR-033's amendment has the root cause and the frame-capture
> evidence): projection coordinates blend equirectangular→Equal Earth while curvature `k` eases
> 1→0, tangent to the camera-facing point at every `k`, so the silhouette stays a spherical cap
> throughout. It lives once in `web/src/globe/projection.ts` as a pure TS module with a GLSL twin
> (`lonLatToSphere`/`lonLatToMap`/`curvatureUnroll`/`unfoldedPosition`/`unfoldedLiftedPosition`,
> plus `splitAtAntimeridian` for lat/lon-placed overlays), consumed by `GLOBE_VERTEX_SHADER`'s
> `uUnfold` uniform (`shaders.ts`, `globeGeometry.ts`). **Anything drawn on the globe must go
> through this one shared twin** — every lat/lon-anchored geometry (§5.3's K-Pg impact flash's
> anchor dot, §10's arrival arcs, markers and city dots) projects through `unfoldedPosition`/
> `unfoldedLiftedPosition` directly and lands at the geographically correct point in both modes
> automatically, and can never drift from the mesh mid-unfold — including texture sampling: the
> vertex shader's `vUv` is computed straight from each vertex's own `aLonLat`, identically in both
> modes, so there is no separate map-mode uv term to keep in sync with the sphere's own (§10 has
> the chirality bug this replaced). N/S pole markers (`poles.ts`) fade out with the sphere rather
> than relocate: Equal Earth flattens each pole to a line, not a point, so there is no single
> correct map-mode position for them. Auto-rotate, the camera and the human-civilisation overlay
> (§10) all share one rotating scene-graph group rather than each tracking rotation independently.
> The camera's own mid-tween framing is sized against the unrolled mesh's real, numerically-sampled
> half-extents (`unrolledHalfWidth`/`unrolledHalfHeight`), not a linear lerp of the sphere's and
> map's own bounding boxes — that lerp overshot the real, slower-growing-at-first silhouette and
> read as a shrink-then-grow jump (ADR-033's amendment). Map mode disables rotation, enables pan,
> and clamps both pan and zoom so the map can never be lost off-screen (`camera.ts`). See ADR-033
> and its amendment for the full rationale, including why Equal Earth over equirectangular.

> **v2 note (ADR-030/ADR-031/ADR-032/ADR-035/ADR-036): the basemap and the human-civilisation
> layer are rendered.** See §10 below for the full write-up — base crossfade and tone grade, tier
> selection, mipmapped/byte-capped caches, arrival arcs, population density, city markers, the
> shared tooltip and the one "Human civilisation" legend toggle. The cleared-land tint ADR-031
> originally specified is built and curated but no longer rendered (ADR-031's amendment) —
> superseded on screen by population density.

---

## 1. Time coverage at a glance

| Interval | What the globe shows | Source | Label |
|---|---|---|---|
| 0–300 ka | Natural Earth II human-era basemap, tone-graded, crossfading in from 400 ka (§10) | Natural Earth II (public domain) | none (no special-case caption; same as plain PaleoDEM) |
| 300–400 ka | crossfade: PaleoDEM's 0 Ma frame → the basemap (§10) | as above, blended with the row below | as above |
| 0–540 Ma | PaleoDEM elevation + bathymetry, 109 epochs; plate-rotated interpolation (§3) | Scotese & Wright 2018 PaleoDEMs + plate model | none (data) |
| last 26 kyr | ICE-6G_C ice mask over the 0 Ma frame (§5.1) | Peltier et al. 2015 | none (data) |
| 540–1000 Ma | continents from plate polygons, stylised relief (§4.1) | Merdith et al. 2021 | "continents from plate model; relief stylised" |
| 635–717 Ma (inside the above) | Snowball Earth ice shell, two windows (§4.3) | Rooney et al. 2015; Tasistro-Hart et al. 2025 | "Snowball Earth — extent contested" |
| 1.0–~4.4 Ga | stylised regimes (§4.2) | literature-dated intervals, no geography | "geography unknown — artistic" |
| ~4.5 Ga | magma ocean + newborn Moon (§4.2) | Barboni et al. 2017 (contested) | "artistic reconstruction" |

---

## 2. Phase 1 — all 109 PaleoDEM epochs (implemented)

### 2.1 Payload

The 1° netCDF bundle has 109 epochs (0–540 Ma, mostly 5 Myr apart, plus 385.2 and 390.5 Ma).
Measured per-frame sizes (13 sampled epochs, then all 109 for the chosen format):

| Size | Encoding | Mean | All 109 |
|---|---|---|---|
| 1024×512 | PNG, optimised | 264 KB | 29.5 MB |
| 1024×512 | WebP lossless | 203 KB | 22.6 MB |
| 1024×512 | JPEG q88 | 53 KB | 5.9 MB |
| **1024×512** | **WebP q90** | **35 KB** | **3.91 MB** |
| 720×360 | WebP q90 | 22 KB | 2.5 MB |

**Chosen:** 1024×512 WebP q90, 3.91 MB for all 109. PSNR against the lossless render is
37.6 dB at 0 Ma (the busiest frame) and 42–44 dB for Pangaea-era and Cambrian frames. The
source has ~360 columns of information, so wider textures add bytes, not detail. PNG alone
would sit at the ~30 MB ceiling. Full measurement notes: `sources/paleodem/README.md`
"Texture encoding".

### 2.2 Loading

- **On demand, bounded.** `web/src/globe/textureCache.ts` wraps an LRU (`lru.ts`, unit tested)
  of 16 textures. At 1024×512 RGBA that is ~32 MB of GPU memory, against ~218 MB for all 109.
- **Never evict what is visible.** Eviction happens only in `trim(keep)`, which
  `useGlobeTexturePair` calls after a pair is bound. `keep` is the bound pair, the requested
  pair and the preload window.
- **Preload in the direction of travel.** `globePreloadUrls` (pure, unit tested) returns 4
  frames past the bracketing pair in the direction `t` last moved and 1 behind.
  `travelDirection` is sticky, so pausing keeps looking ahead. At 5 Myr spacing, 4 frames is
  20 Myr of runway.
- **Never blank.** The last bound pair and its mix stay on screen until the next pair has fully
  loaded. This behaviour predates v2 and is kept.
- **Off-main-thread decode.** Textures decode with `fetch` + `createImageBitmap`. An
  `HTMLImageElement` would decode synchronously at first GPU upload and hitch playback. Upload
  of one 1024×512 texture remains on the main thread, at a few ms.

### 2.3 Browser verification

Chrome headless shell (Metal ANGLE), dev server, all 109 textures served:

- **Sweep 540 → 0 Ma** in 20 s, driven by `requestAnimationFrame`:
  - 1,189 frames: p50 16.7 ms, p95 17.9 ms, p99 18.6 ms, max 51.9 ms. Three frames exceeded
    50 ms. A repeat run gave two over 50 ms and a 50.3 ms max.
  - Exactly 109 texture requests: every frame was fetched once, none twice.
  - No failures.
- **Real playback** from 540 Ma at 8×, then fast scrubbing across long-evicted frames
  (500 → 20 → 480 → 5 → 300 → 250 → 260 → 100 Ma, 60 ms apart):
  - 251 texture requests in total over the run: evicted frames were re-fetched, as a
    16-texture cache is designed to do.
  - No failures and no errors. The only console warning is three.js's pre-existing
    `THREE.Clock` deprecation.
- **Blank frames: 0 of 34 sampled** across the sweep, playback and scrub phases.
  - Method: each sample was compared against a reference screenshot of the neutral no-data
    sphere, captured at `t` = 600 Ma, out of domain. Its mean RGB is (26, 31, 40).
  - The darkest samples, open Panthalassa at ~137 Ma and 100 Ma right after the scrub, measure
    mean RGB (1, 4, 33). That is textured deep ocean, not the neutral sphere.
  - A first detector that keyed on low luminance spread alone mistook those ocean hemispheres
    for blank frames, which is why the reference comparison is used.

Observation, not changed here: the globe shader samples sRGB textures, which three.js decodes to
linear, and writes `gl_FragColor` without re-encoding to sRGB. Deep ocean therefore renders
darker than the texture's navy, and a Panthalassa-facing hemisphere reads almost black on the
small orb. The behaviour predates v2 and is flagged for the globe look pass (§9, G2).

**Fixed (G2).** `web/src/globe/shaders.ts`'s `GLOBE_FRAGMENT_SHADER` and `RIM_FRAGMENT_SHADER`
now end with `#include <colorspace_fragment>`. A plain `THREE.ShaderMaterial` (what both use,
via r3f's `<shaderMaterial>`) gets `linearToOutputTexel` made available in its compiled
fragment shader, but — unlike three.js's own built-in materials — never gets a call to it for
free; that chunk is the call. Confirmed against the installed three.js (0.186.0): the renderer
r3f's `<Canvas>` creates defaults to `outputColorSpace = SRGBColorSpace`, and
`textureCache.ts` already sets `texture.colorSpace = SRGBColorSpace` on every loaded PaleoDEM
texture, so before this fix linear-space colour was written straight to the sRGB canvas.

---

## 3. True continental motion — motion-compensated interpolation

### 3.1 Evaluation on this Mac (arm64, Python 3.12)

- **Install:** `uv pip install gplately` into `.venv`, wheels only. gplately 2.0.0, pygplates
  1.0.0, plate-model-manager 1.3.2. `pyproject.toml` already declares gplately under the
  `geo` extra, so no new `plates` extra was added; a second name for the same thing would be a
  synonym. Importing gplately logs a PyGMT error because the GMT C library is absent. It is
  harmless: nothing here uses PyGMT.
- **Licences:** gplately and pygplates are GPL-2.0 and stay offline (pipeline only); the
  frontend receives rasters and numbers.
- **Merdith et al. 2021** (Zenodo 4485738, CC-BY-4.0, v1.1b):
  - Size: a 13.9 MB zip, but **90 MB extracted** (Topologies 56 MB, StaticPolygons 22 MB,
    ContinentalPolygons 9.1 MB, Coastlines 1.8 MB, Rotations 0.6 MB). The "~14 MB" figure is
    the zip.
  - Fetch: ~24 s via plate-model-manager.
  - Rotation samples reach **1140 Ma**; the model is published as 1000–0 Ma.
  - 2,391 static polygons on 478 plate ids.
  - Continental polygons reconstruct at every probed epoch: 847 polygons on 427 plates at
    0 Ma, 733 on 367 at 100 Ma, 656 on 311 at 250 Ma, 406 on 149 at 540 Ma, 272 on 89 at
    750 Ma and 238 on 71 at 1000 Ma. Each reconstruction takes ≤ 10 ms.
- **The PaleoDEMs are not in Merdith's frame.** They are Scotese & Wright 2018 PALEOMAP
  reconstructions. plate-model-manager ships that model as `scotese_and_wright2018`: 0–540 Ma,
  StaticPolygons, Topologies, ContinentalPolygons and COBs. Its metadata points at Zenodo
  5348491 / 5460860, the PaleoDEM record itself, CC-BY-4.0. It also ships `paleomap`
  (PaleoAtlas v3, 0–750 Ma, Zenodo 10596610, CC-BY-4.0; 471 static polygons, 241 plate ids).
  **Rotating PaleoDEM texels with Merdith rotations would misalign them.** Use
  `scotese_and_wright2018` for 0–540 Ma.

### 3.2 Does rotating texels beat crossfading? (measured)

Method (`scratchpad` prototype; the method is summarised here so it can be re-run):
1. For epochs a (older) and b (younger), assign every 1° cell of b a plate id with
   `pygplates.PlatePartitioner` against the static polygons reconstructed to b.
2. Rotate each cell back to a with that plate's stage rotation.
3. Sample a's land mask there, as an inverse (gather) warp with no splat holes.
4. Compare with b's real land mask. Crossfade corresponds to the unwarped mask.

| Step | IoU crossfade | IoU warped (S&W 2018) | IoU warped (PaleoAtlas) | Mean land displacement |
|---|---|---|---|---|
| 60 → 55 Ma | 0.800 | 0.842 | 0.842 | 1.04° |
| 105 → 100 Ma | 0.789 | 0.838 | 0.838 | 1.77° |
| 255 → 250 Ma | 0.818 | 0.825 | 0.825 | 2.72° |
| 540 → 535 Ma | 0.859 | 0.915 | 0.915 | 1.93° |
| 110 → 100 Ma | 0.670 | 0.725 | 0.724 | 3.55° |
| 260 → 250 Ma | 0.706 | 0.723 | 0.723 | 4.08° |
| 50 → 0 Ma | 0.462 | 0.669 | 0.764 | 8.35° |

Reading:
- The warp wins at every step. At 5 Myr spacing it adds 0.7–5.6 IoU points; the gap grows with
  displacement.
- Land moves 1–3° per 5 Myr frame, which is 3–8 texels on a 1024-wide texture. Phase 1's
  109 frames already turn "fade out, fade in" into drift; the warp makes it glide.
- The residual mismatch is paleogeography that no rotation can express: sea-level flooding and
  coastlines redrawn between maps. The crossfade therefore stays part of the blend.
- Unassigned land (cells no static polygon covers) is 3–10% per epoch.

### 3.3 Algorithm

For `t` between frames A (age `t_A`, older) and B (`t_B`, younger), with `f = (t_A − t)/(t_A − t_B)`:

```
per frame K in {A, B}, per fragment with unit position p (in the t-frame):
  pid   = idsK(p)                         # first guess: displacement is only a few degrees
  q     = stage(K, pid, t)                # rotation taking frame-K geometry to time t
  pK    = conj(q) · p · q                 # where this point sat at t_K
  pid2  = idsK(pK)                        # one fixed-point step
  if pid2 != pid: pK = rotate by stage(K, pid2, t)⁻¹ ; pid = pid2
  colourK = texK(pK), validK = pid != NONE && idsK(pK) == pid
colour = mix(colourA', colourB', f)
  where colourK' = validK ? colourK : texK(p)   # unassigned/ocean: plain crossfade
```

- `stage(K, pid, t) = slerp(Q_A(pid), Q_B(pid), f) · Q_K(pid)⁻¹`. `Q_K(pid)` is the total
  rotation (present day → `t_K`) as a unit quaternion.
  - Slerp between frame times is enough, because rotation files are piecewise-constant stage
    poles sampled every few Myr.
  - A plate present in only one frame uses that frame's rotation, so it gets no motion and
    falls back to the crossfade.
- **Pure in `t`:** `f` and every quaternion are functions of `t` and published data only
  (DESIGN §10).
- **Plate boundaries.**
  - At divergent boundaries a gap opens between warped plates. The id check fails there, so the
    cell falls back to the crossfade, which is new ocean in both frames and looks right.
  - At convergent boundaries each frame's own id raster decides ownership. The gather is
    single-valued, so nothing is drawn twice.
  - A 1–2 texel feather where `validA != validB` hides the switch.
  - Terranes appearing or accreting between frames are carried by the crossfade.
- **Ocean floor.** Static polygons only cover crust that survives today: coverage at 720×360
  is 45% at 0 Ma and 32–36% at 250–540 Ma (measured). The rest is ocean and uses the plain
  crossfade. PaleoDEM bathymetry is smooth, so seams in open ocean are unlikely to read.
  Full-coverage topological plates (Topologies layer, via gplately's topology resolution) are
  the upgrade if they do.
- **Performance.**
  - Each frame costs two id lookups (NEAREST, lossless), one or two quaternion rotations and one
    colour fetch; roughly 8 texture fetches per fragment in total.
  - The orb is ~250 px across. Expanded fullscreen at DPR 2 is ~3–4 M fragments, comfortably
    inside an integrated GPU's frame.
  - Rotations are uploaded as a float `DataTexture` of 2 rows × ≤ 256 plates, ~8 KB, only
    when `t` crosses a frame boundary or `f` changes. The per-frame CPU work is ≤ 256 slerps,
    measured in microseconds.

### 3.4 Data and curated shapes (ADR-003: still four)

| Artefact | Shape | Id | Per frame | All 109 |
|---|---|---|---|---|
| colour texture | `RasterSequence` (exists) | `paleodem` | 35 KB WebP q90 | 3.91 MB |
| plate-id raster, 720×360, dense per-frame index in R (+G for >255) | `RasterSequence` | `paleodem_plates` | 3–5 KB **lossless** WebP (measured; PNG 8–11 KB) | ~0.5 MB |
| rotation table: `[plate_id u16, qx, qy, qz, qw f32]` per dense index | `RasterSequence` whose ref is a `.bin` | `paleodem_rotations` | ≤ 256 × 18 B ≈ 4.6 KB | ~0.5 MB |

- **Ids at 720×360.** Partitioning a frame takes 0.5–0.8 s offline (measured). Ids must never
  be encoded lossily or filtered linearly.
- **Rotation tables in a `RasterSequence`.** A table is not a "georeferenced grid", but the
  shape carries only `t` and `ref`, and ADR-003 accepts awkward fits. A fifth shape isn't
  justified for one consumer.
- **`WorldState`.** `PlateSnapshot` gains optional `plate_ids` and `plate_rotations`
  (`RasterBlend | None`), an additive change.
- **Frontend.** `web/src/app/buildLayers.ts` currently takes "the manifest's one raster layer"
  and must select raster layers by id. That change must be coordinated with the app shell.
- **Offline build.** `sources/plates/` (new) owns the plate model fetch (plate-model-manager,
  sha256-pinned) and emits both sequences for the PaleoDEM frame times.
  - Its fixture is two 1° id rasters and a rotation table for two epochs, a few KB.
  - Tests never import gplately: the extraction runs in `write_outputs` under the `geo` extra,
    and `normalise()` reads the committed or derived tables only.

---

## 4. Before 540 Ma

### 4.1 1000–540 Ma: plate polygons, stylised relief

- **Continents.** Merdith et al. 2021 `ContinentalPolygons`, reconstructed at any `t` in
  1000–540 Ma. Coverage was confirmed above. Reconstruction is geometry, so frames can be at
  any spacing: 10 Myr (46 frames, ~1.6 MB at WebP q90) is enough given §3's warp.
- **Relief is stylised and labelled:**
  - land from the polygon mask
  - older interiors raised from the `Cratons` layer (listed by plate-model-manager, not yet
    opened)
  - shelves from distance to coast
  - procedural noise, seeded per plate id so it moves with the plate
  - uniform abyssal depth offshore
  - the same hypsometric palette as PaleoDEM, so the look is continuous
- **Motion.** The same §3 mechanism, with Merdith rotations for this interval.
- **540 Ma seam.** The two reconstructions do not place continents identically. Crossfade
  across a 540–550 Ma band and label it; do not pretend to continuity.

### 4.2 Before 1 Ga: stylised regimes, no geography

No full-plate reconstruction exists before 1 Ga (Merdith et al. 2021 is the 1 Ga model). The
globe shows **regimes**: shader states with no implied positions, captioned on the globe.

| Regime | Interval (years BP) | Evidence | Visual |
|---|---|---|---|
| Magma ocean + newborn Moon | from 4.51 Ga (contested 4.35–4.52 Ga) | Barboni et al. 2017; Thiemens et al. 2019 (Hf-W ~4.51 Ga); contested by Nimmo, Kleine & Morbidelli 2024 (~4.35 Ga) — already in `events.yaml` `moon-forming-impact` | glowing crust cracks, no oceans, large close Moon in the expanded view |
| Hadean water world | by 4.4 Ga | Wilde et al. 2001: detrital zircon, "earliest evidence for continental crust and oceans" at 4.4 Gyr | global ocean, steam-veiled atmosphere, no continents drawn |
| Archean haze, scattered protocrust | ~4.0–2.4 Ga | anoxic atmosphere until the GOE (Lyons et al. 2014; onset 2.46–2.426 Ga, Gumsley et al. 2017); episodic organic haze proposed for the Neoarchean (Zerkle et al. 2012; **contested**) | ocean with small scattered crust flecks at procedural positions; orange-tan haze only as an episodic tint, labelled contested |
| Paleoproterozoic glaciation | onset 2.46–2.426 Ga | Gumsley et al. 2017 ("first Paleoproterozoic global glaciation") — global extent **contested** | ice shell, same effect as §4.3 |
| Proterozoic, geography unknown | ~2.4–1.0 Ga | no reconstruction used | dim land/sea noise field with a "geography unknown" caption |

The boundaries between regimes are deliberately soft: long crossfades, never a hard switch. The
underlying dates are contested, and the caption says so.

### 4.3 Snowball Earth

- **Sturtian:** ~717–661 Ma, a 56 Myr duration. Rooney et al. 2015, Geology 43:459–462;
  Tasistro-Hart et al. 2025 cite "56 Myr" from radioisotopic ages.
- **Marinoan:** termination 635 Ma. Its duration is **contested**: 4 to 15 Myr per
  Tasistro-Hart et al. 2025, whose Namibian record gives ~4 Myr, i.e. roughly 639–635 Ma.
  `events.yaml` carries the whole Cryogenian as one event (635–720 Ma, Prave et al. 2016).
- **Rendering:**
  - An ice shell, a bright, slightly translucent layer over the continents from §4.1, eases in
    and out at each window edge.
  - The "slushball" alternative, with open equatorial water, is **contested**. The caption says
    "extent contested", and the shell keeps a faint equatorial darkening rather than asserting
    either.
  - The easing widths are artistic and do not claim onset rates.
  - **The ease width is constant in the timeline's symlog warp space, not in years**
    (user-reported regression: at ~650 Ma a fixed-year ease is well under one screen pixel on
    the symlog timeline, so playback snapped the ice shell on and off instead of fading it).
    `web/src/globe/effects/overlays.ts`'s `windowEnvelope`/`ICE_SHELL_EASE_WARP` and
    `regimes.ts`'s crossfade/standalone-edge widths (`MIN_CROSSFADE_HALF_WIDTH_WARP`,
    `STANDALONE_EDGE_EASE_WARP`) all measure distance through `math.ts`'s `symlogWarp` — the
    same `log1p(t / SYMLOG_C)` warp as `web/src/timeline/scale.ts`'s `SYMLOG_C`, mirrored by
    value rather than imported (this package stays self-contained in its own `t` math, the
    convention `scene/pacing.ts` already follows) — so a fade reads the same width on screen at
    any era, and the interglacial between Sturtian and Marinoan is a gentle thaw/refreeze
    rather than a hard cut. Every target here stays pure in `t` (DESIGN §10); see below for the
    separate wall-clock limiter that fixes the same glitch's other half.
  - **A wall-clock presentation limiter** (`web/src/globe/effects/presentation.ts`'s
    `usePresentedGlobeEffectUniforms`, generalised from the ancestor portrait's
    `usePresentedMix`/`lib/presentedMix.ts`) holds a full 0 → 1 change in the ice shell (and
    every other effect intensity: impact veil/flash, regime weights) to at least
    `MIN_EFFECT_TRANSITION_SECONDS` (1.5 s) of real time, however fast `t` itself moves — a
    warped-space ease band is still a fixed span of `t`, and a fast scrub or playback tick can
    cross it in a handful of milliseconds regardless of how wide it reads on screen. The pure
    `t → intensity` targets above are untouched; only what `Globe.tsx` actually displays is
    rate-limited, the same "target stays pure, presentation catches up" split ADR-012 already
    uses for the scene dissolve.
- **Data.** The two windows become the `effect.windows` of `snowball-earth` (§6). No
  `events.yaml` date changes.

---

## 5. Data-driven effects

### 5.1 Ice sheets and polar caps

| Interval | Source | Licence | Shape | Status |
|---|---|---|---|---|
| 26 ka–0 | **ICE-6G_C (VM5a)**, PMIP4 distribution: 48 files, every 500 yr 0–21 ka then every 1 kyr to 26 ka, 10′ grid, `sftgif` ice mask %, `orog` | **not stated** on the PMIP4 page; it requires citing Argus et al. 2014 (GJI 198:537–563) and Peltier, Argus & Drummond 2015 (JGR Solid Earth 120:450–487) | `RasterSequence` `ice_mask`, lossless ice mask overlaid on the 0 Ma frame | licence must be confirmed before ice textures ship |
| 540–0 Ma | **Scotese et al. 2021**, "Phanerozoic paleotemperatures", Earth-Science Reviews 215:103503: global average and polar temperature curves; Scotese 2021 (Annu. Rev. Earth Planet. Sci. 49:679) ties large permanent ice caps to GAT below ~18 °C | journal article; curve values must be digitised from the supplementary data (licence to check) | `TimeSeries` `ice_line_latitude` (derived), a polar cap clipped to PaleoDEM land plus a sea-ice fringe | design; exact derivation rule to be chosen when implemented |
| 1000–540 Ma | Snowball windows only (§4.3) | — | effect | design |

Rejected for ice: Li et al. 2022 (Scientific Data, CESM 540 Myr at 10 Myr, CC-BY-4.0) prescribes
no ice sheets from 540 to 10 Ma and publishes no cryosphere fields. It uses PaleoDEMs as
boundary conditions, which would make it a good future temperature or precipitation layer.

### 5.2 Clouds and atmosphere

- **Clouds.** A procedural cloud shell (noise advected by `t`, at a slow constant rate). This
  is **not data** and is captioned as such only in the expanded view. Its opacity can be
  scaled by global temperature once a temperature `TimeSeries` exists; that scaling is
  artistic.
- **Atmosphere tint.** The rim colour (`RIM_COLOR` in `Globe.tsx`) becomes a uniform driven by
  `co2-o2` (already curated) and the regime:
  - pale blue after the GOE
  - hazier and paler before it
  - orange-tan only in the contested Neoarchean haze episodes

### 5.3 Short-lived events

Effects are functions of `Δ = t_event − t` in years, so they are pure in `t`. At deep-time zoom
a 15-year effect spans less than a pixel. Effects therefore only become visible when the
timeline window is narrow enough. Playback pacing (ADR-012's `scenePlaybackSegments`) should
gain an effect dwell so playback slows through them. That dwell is the timeline's change, not
the globe's. An effect timed from an event's own `[t_min, t_max]` dating-uncertainty window
(`impactWinterVeil`/`impactWinterFlash` in `overlays.ts`) treats the window's midpoint as the
instant and is strictly zero at and before it, never anticipating the event, so a scene placed
exactly on that midpoint — `kpg-arrival` sits exactly on `k-pg-impact`'s — always renders the
clear, pre-event globe.

| Event | Date (years BP) | Effect | Envelope (literature) |
|---|---|---|---|
| **Chicxulub** | 66.043 ± 0.011 Ma (Renne et al. 2013, in `events.yaml`); 66.016 ± 0.050 Ma Bayesian (Schoene et al. 2019) | `impact-winter`, anchored at present-day 21.3°N 89.5°W and reconstructed to 66 Ma | flash and ejecta curtain over hours to days (artistic); **soot** keeps light below the photosynthetic threshold for >20 months and surface shortwave recovers at ~70 months (Tabor et al. 2020, GRL 47:e60121); **fine silicate dust** shuts photosynthesis down for ~2 yr with a ~15 yr atmospheric lifetime (Senel et al. 2023, Nat. Geosci. 16:1033). The relative roles of soot and dust are **contested**, so the darkening is drawn as one global veil: near-black to ~2 yr, then recovery to ~15 yr |
| **Moon-forming impact** | 4.51 Ga, **contested** 4.35–4.52 Ga (`events.yaml`) | `giant-impact`, then the magma ocean regime | artistic; no literature envelope is claimed |
| **Siberian Traps** | main activity 252.3–251.4 Ma; extinction interval 251.94–251.88 Ma; ~⅔ of lava and pyroclastic volume in ~300 kyr before and during the extinction; sills continued ≥500 kyr after (Burgess & Bowring 2015, Sci. Adv. 1:e1500470) | `flood-basalt`: a glowing fissure field and volcanic haze at a Siberian anchor reconstructed to 252 Ma | intensity follows the volume timeline above |
| **Deccan Traps** | four pulses: ~66.3–66.15, ~66.1–66.0, ~65.9–65.8 and ~65.6–65.5 Ma (Schoene et al. 2019, Science 363:862–866, U-Pb). Pulsed tempo **contested** by Sprain et al. 2019 (Science, ⁴⁰Ar/³⁹Ar) | `flood-basalt` at a western-India anchor reconstructed to 66 Ma | four windows |

Anchors are present-day coordinates, intended to be reconstructed with the plate model at
build time. The Chicxulub coordinates above are the conventional crater centre. **Verify**
them and the Siberian and Deccan anchor coordinates against a citable source when `effects`
data is written; they are not yet in `events.yaml`.

**As shipped (G6), Chicxulub's anchor is not reconstructed.** `k-pg-impact`'s `effect.anchor`
in `data/events.yaml` is placed at its present-day lat/lon and used exactly there by
`web/src/globe/effects/overlays.ts`'s `impactWinterAnchor`/`anchorUv`, regardless of which `t`
the globe is showing — reconstructing it to the 66 Ma plate position was out of scope for this
pass (the same "no G4 plate-rotation shader" boundary that shaped G7). The Yucatán has moved
only a little since the K-Pg, so the visible error is small next to the effect's own artistic
license, but it is a known, flagged approximation, not an oversight — see that function's own
doc comment. Flood basalts (Siberian/Deccan) are unimplemented (§9 G6), so this doesn't yet
apply to them; whichever implements them should decide then whether to keep the same
approximation or spend the reconstruction.

---

## 6. How an event maps to an effect (ADR-013)

**Decision:** an optional, additive `effect` field on `EventSet` events. The alternative, a
separate effects table, was rejected.

```yaml
- id: k-pg-impact
  ...existing fields unchanged...
  effect:
    kind: impact-winter          # closed enum, one definition in pipeline/shapes.py + TS twin
    anchor: {lat: 21.3, lon: -89.5}   # present-day; reconstructed to t at build time
    windows:
      - {t_min: 6.6043e7, t_max: 6.6043e7}
```

As shipped (G5), `k-pg-impact`'s window is the event's own `[t_min, t_max]`
(`{t_min: 6.6032e7, t_max: 6.6054e7}`, `data/events.yaml`) rather than the single point shown
above — no narrower "flash duration" is claimed for it, so it reuses the event's own interval,
the same choice made for `moon-forming-impact`'s `giant-impact` window.

- **Why a field, not a table.** Every effect in §5.3 already is a timeline event with a date
  interval and a citation. A separate table would duplicate both and drift. An effect without a
  timeline presence (the §4.2 regimes) goes in a second `EventSet` (`globe-regimes`), which the
  timeline does not list: same shape, same field.
- **Kinds (closed):** `impact-winter`, `giant-impact`, `flood-basalt`, `ice-shell`,
  `regime-magma-ocean`, `regime-water-world`, `regime-archean`, `regime-unknown-geography`.
  Each kind owns its envelope curve in `web/src/globe/effects/`, as pure functions of `t`.
  Durations come from the table above.
- **Contract, implemented (G5):**
  - `pipeline/shapes.py`: `GlobeEffectKind` (closed `StrEnum`), `EffectAnchor`, `EffectWindow`,
    `GlobeEffect`, and `Event.effect: GlobeEffect | None = None`.
  - `web/src/types/layer.ts`: the same shapes (`GlobeEffectKind`, `GlobeEffectAnchor`,
    `GlobeEffectWindow`, `GlobeEffect`) and `TimelineEvent.effect?: GlobeEffect`.
  - `pipeline/manifest.py` mirrors them as wire models (camelCase) and `pipeline/publish.py`
    (`_timeline_event`/`_effect`) passes `effect` through into both `Manifest.events`
    (`events-core`) and any `dataKind: "events"` layer file (`globe-regimes`).
  - `pipeline/curated.py` stores `effect` as a JSON string column in the `events-core.parquet`
    layout (a storage detail — the NORMATIVE shape is the nested `GlobeEffect` model, not its
    on-disk encoding).

  Old manifests without the field stay valid: it is `None`/absent unless an event sets it.
  `sources/events-core`'s `data/events.yaml` sets it on `moon-forming-impact` (`giant-impact`),
  `snowball-earth` (`ice-shell`, two windows — the event's own `t_min`/`t_max` are unchanged)
  and `k-pg-impact` (`impact-winter`, anchored). `sources/globe-regimes` (`data/globe_regimes.yaml`)
  is the second `EventSet` this section promised: five pre-1 Ga regimes (§4.2), every one
  carrying an effect, published as a `dataKind: "events"` `LayerManifest` entry
  (`EVENT_LAYERS`/`GLOBE_REGIMES_ID` in `pipeline/publish.py`) rather than through
  `Manifest.events` — so it never reaches the timeline. On the web side,
  `web/src/data/curated.ts`'s `parseEventsData`/`sampleEvents` and
  `web/src/layers/factories.ts`'s `createEventsLayer` read it the same way any other layer is
  read (`useAppData` → `buildLayers` → `AppLayers.eventLayers`); nothing yet *renders* from it
  — that is G6/G7/G8.

**Arrivals (ADR-032).** A ninth kind, `arrival`, shows a
schematic Homo sapiens dispersal as an arc between a curated origin and destination region
centroid (never a real route). It does not fit the eight kinds above: they carry at most one
optional `anchor`, while an arrival needs a required *pair*. Rather than add two more optional
fields to `GlobeEffect` ("optional-field soup"), `kind: 'arrival'` is a separate shape
(`ArrivalEffect` in `pipeline/shapes.py` / `pipeline/manifest.py`, `ArrivalGlobeEffect` in
`web/src/types/layer.ts`), and `Event.effect`'s type is now the discriminated union of the two
(`pipeline.shapes.AnyGlobeEffect`, `web/src/types/layer.ts`'s `GlobeEffect` union) — dispatched
on `kind`, so a `GlobeEffect(kind='arrival', ...)` is a validation error rather than a
representable-but-wrong state. `ArrivalEffect` adds `origin`/`destination` (`EffectAnchor`,
required) and `established: GeoTime` — the best-estimate date the arc turns solid (dashed
before it) — independent of the owning event's own `kind`/`t` (ADR-022), since several events
this attaches to are `kind: 'period'` with no single instant of their own.

`windows` solves the "arc disappears once `t` leaves the interval" problem: `EventSet.sample(t)`
only returns events whose own `[t_min, t_max]` contains `t`, but an arrival should stay visible
from its earliest defensible date through to the present, long after that dating-uncertainty
window. Every `ArrivalEffect` therefore carries *exactly one* window reaching `t_min: 0`
(validated by both `pipeline.shapes.ArrivalEffect` and `web/src/data/curated.ts`'s own parser) —
not merely "at least one": `arcs.ts`'s `persistentWindow` needs a single, unambiguous
present-reaching window to read the arc's visible span from, e.g.:

```yaml
- id: out-of-africa-migration
  ...existing fields unchanged...
  effect:
    kind: arrival
    origin: {lat: 15.0, lon: 33.0}          # schematic NE-Africa centroid, route-neutral
    destination: {lat: 28.0, lon: 42.0}     # schematic Sinai/Red Sea gateway centroid
    established: 6.0e4                      # best estimate — arc solid from here
    windows:
      - {t_min: 0.0, t_max: 7.0e4}          # exactly one window must reach t_min: 0 (validated);
                                             # rendering itself is transient, not persistent — §10
```

Curated in `data/events.yaml`: about a dozen arrivals, attached to the four pre-existing
`human-origins` events that already represented one (`homo-sapiens-origin`,
`out-of-africa-migration`, `neanderthal-sapiens-overlap`, `peopling-of-americas`) plus nine new
events for arrivals not previously curated (Levant, South/Southeast Asia, Sahul, East Asia,
Beringia, Lapita/Remote Oceania, Madagascar, East Polynesia, Aotearoa New Zealand) — every date
traceable to a cited source, contested dates said so in the description. Rendering the arcs on
the globe (the transient fade/pulse/ripple, the arc geometry itself) is §10, not this section —
this section is the data/contract side only.

---

## 7. Labelling

A caption shows the current regime label, or nothing for plain PaleoDEM data. Examples:
"Continents from plate model · relief stylised", "Snowball Earth · extent contested",
"Geography unknown", "Impact winter". No caption repeats the shell's own bottom-of-screen note
("Artistic reconstruction — plausibility, not accuracy.", `ShellLayout.tsx`), which already
covers every still and reconstruction across the app. The expanded globe adds the citation
line from the event or source credit.

**It sits under the orb, never over it, in both states** (user follow-up: "don't want label
on top of the globe, only underneath it if anything"). `Globe` itself never draws this text at
all any more, in either state — it only reports it, via the `onCaptionChange` prop
(`web/src/globe/Globe.tsx`); `Experience.tsx` lifts that into state (`globeCaption`) and hands
it to `ShellLayout`, which places it:
- **Minimised:** in place of the existing "Paleogeography" label under the orb
  (`ShellLayout.tsx`) — replacing it while a caption is active, falling back to "Paleogeography"
  once it isn't, one single-line slot either way so nothing shifts the readouts below it as the
  caption appears or disappears (`ShellLayout.module.css`'s `.globeLabel`,
  `white-space: nowrap` + ellipsis rather than wrapping to a second line).
- **Expanded:** in the `.stage` cell above the timeline — the *scene* caption's own spot,
  which already sits clear of the timeline's playhead label (`ShellLayout.module.css`'s
  `.note` comment: "clears the playhead readout that rides above the scrub track at any
  playhead position") and already yields while the globe is expanded
  (`.expandedGlobeCaption`, shown only for `data-globe-expanded='true'`, in place of the scene
  caption and chart). This was a deliberate choice over having `Globe`'s own fullscreen
  backdrop position its own caption text: the backdrop has no way to know where the timeline's
  playhead label actually sits (that label rides with the scrub position and isn't part of
  `Globe`'s own layout), so a caption placed by `Globe` itself either collided with it
  (regression caught mid-build, browser-verified) or, once nudged clear of the timeline, still
  had nowhere reliably clear of the sphere itself: `.orbExpanded`'s own sizing formula centres
  the sphere in the *whole* viewport, not specifically within the gap between the title and the
  timeline, so at several real viewport sizes the sphere's own visible edge already reaches
  into that "clear" margin (`--expanded-size`'s own comment in `Globe.module.css` has the
  measured detail, including the constants this fix tightened). Routing through `ShellLayout`'s
  already-solved, already-clear slot sidesteps both problems at once. A short, narrow mobile
  viewport (~800px tall or less) is a documented residual: `ShellLayout`'s mobile layout stacks
  enough extra HUD rows that there is little room left for the sphere at all, caption or not.

**Implemented (G2, G7, G8; G6 partial).** Empty renders nothing — this replaced the old
internal `OUT_OF_DOMAIN_LABEL` mechanism (G2). `Globe` no longer takes a `caption` prop at all:
since G7/G8's integration, it derives the caption itself every frame, from
`web/src/globe/effects`'s `useGlobeEffects` (priority, highest first: impact winter, then the
ice shell, then the dominant pre-1 Ga regime, then `globeMultiCaptionFor`'s raster-domain
fallback, which itself carries the seam and continents-from-plate-model cases from §4.1).
Impact winter and the ice shell are both §6's closed "effect" kinds rather than a blended
regime, and the ice shell in particular can sit *inside* a regime's own span with no weight of
its own to out-compete it on — the Paleoproterozoic glaciation (2.426–2.46 Ga) is entirely
inside `archean-haze-regime`'s 2.4–4.0 Ga span — so both are checked, and can win, ahead of the
dominant-regime branch (`web/src/globe/effects/caption.ts`). All four examples above are
real now: "Continents from plate model · relief stylised" (plain Merdith data, 550–1000 Ma),
the same plus a seam note (540–550 Ma, `SEAM_BAND`), "Snowball Earth · extent contested" (and
the same convention for "Paleoproterozoic glaciation · extent contested"), "Geography unknown"
(`globe-regimes`' regimes, and — G7's fallback rule — the 540–1000 Ma span too if the Merdith
source is ever unusable), "Impact winter". Not yet captioned: flood basalts (G6's remaining
piece — see §9).

---

## 8. What stays out

- **No generated imagery on the globe.** Everything above is shaders over data.
- **No location pin (ADR-007).** Effect anchors mark a planetary event, not the scene's vantage.
- **gplately and pygplates never ship to the browser** (GPL-2.0).

---

## 9. Cost, effort, risk and order

Image budget for every item: **$0**. Effort is in focused agent-days.

| # | Item | Effort | Risk | Notes |
|---|---|---|---|---|
| G1 | Phase 1: 109 frames, LRU and preload | done | — | §2 |
| G2 | Globe look pass: sRGB output encoding, regime caption slot | done | — | fixed the too-dark ocean (§2.3); caption slot in §7 |
| G3 | `sources/plates`: S&W 2018 id rasters + rotation tables, fixture, `PlateSnapshot` fields | 2 d | medium: plate-model-manager fetch pinning, id raster edge cases | §3.4 |
| G4 | Motion-compensated shader + rotation `DataTexture`, `buildLayers` by id | 2–3 d | medium: seams at boundaries, fixed-point misses near fast plates | §3.3; verify visually against the IoU table |
| G5 | `effect` field (shapes, types, publish) + `globe-regimes` EventSet | done | — | §6 |
| G6 | Snowball ice shell + Chicxulub impact winter + flood basalts | **partial** | low–medium: effect timescales need the timeline dwell | §4.3, §5.3; ice shell, impact winter and the Moon-forming giant impact are wired (`web/src/globe/effects/overlays.ts`) and live in `Globe.tsx`; flood basalts (Siberian/Deccan Traps) are not — neither event carries an `effect` in `data/events.yaml` yet, and there's no `flood-basalt` overlay/shader term. Timeline dwell still coordinated separately |
| G7 | 1000–540 Ma Merdith continents, stylised relief, 540 Ma seam | done | — | §4.1; `sources/plates-neoproterozoic/`, curated id `plates_neoproterozoic`, published alongside `paleodem`. Web: `web/src/globe/blend.ts`'s `globeMultiBlendAt`/`globeMultiPreloadUrls`/`globeMultiCaptionFor` pick between the two raster sources by domain and crossfade `SEAM_BAND` (540–550 Ma); `regimeEventsWithRasterFallback` covers "Merdith unusable" with the geography-unknown regime rather than faking continents. No G4 plate-rotation shader — frames crossfade like PaleoDEM, per this ticket's brief |
| G8 | Pre-1 Ga regimes (magma ocean, water world, Archean, unknown) | done | — | §4.2; `web/src/globe/effects/regimes.ts` (crossfade weights) + `overlays.ts`/`shaders.ts` (the four regime looks) + `caption.ts`. One known residual: the oldest regime (`magma-ocean-regime`, citable from 4.52 Ga) eases to zero weight by ~4.54 Ga, so the ~27 Myr before that and Earth's 4.567 Ga formation shows the neutral sphere with `NO_RECONSTRUCTION_CAPTION` rather than a regime look — deliberate (the honesty rule: no citation covers that sliver), not a bug |
| G9 | Ice: ICE-6G_C last glacial cycle | 1 d | **licence unconfirmed** | §5.1; blocked on terms |
| G10 | Ice: Phanerozoic polar caps from Scotese et al. 2021 | 1.5 d | medium: digitising and derivation rule | §5.1 |
| G11 | Clouds + data-driven atmosphere tint | 1 d | low | §5.2 |

**Recommended order:** G2 → G5 → G6 → G3 → G4 → G8 → G7 → G11 → G10 → G9. G2, G5, G7 and G8 are
done; G6 is partial (see its row above). G7 and G8 ended up landing without G3/G4 (no
plate-rotation shader for either span — this ticket's brief explicitly excluded it), so the
globe now covers all 4.567 Ga on plain crossfades; G3/G4's motion-compensated interpolation
remains a quality upgrade over 0–1000 Ma, not a coverage gap.

- G2 and G5 were cheap and unlock the rest.
- G6 lands the most visible wins (Chicxulub, Snowball) without depending on the plate work.
- G3 and G4 are the largest technical step, and Phase 1 already delivers most of their
  perceived benefit (§3.2), so they don't need to come first.
- G7 needs G4's machinery.
- The ice items wait on data terms and digitising.

---

## 10. Human-era rendering: basemap, arrivals, population density, cities

Renders the data ADR-030 (basemap), ADR-031's amendment (HYDE population density; the original
cleared-land tint is curated but no longer rendered — see below), ADR-032 and its amendment
(arrivals, now transient), and ADR-035 (cities, published but not rendered until this pass).
ADR-036 records the "Human civilisation" layer these four are unified into: one legend toggle,
one shared hit-test and tooltip, one screen-space marker field. Image budget: **$0** (everything
here is shaders/geometry over already-published data, same as the rest of this document).
Web-only work — no pipeline/data change.

**Base crossfade (ADR-030).** `web/src/globe/blend.ts`'s `BASEMAP_CROSSFADE_BAND = [300_000,
400_000]` (years BP) and `basemapStrengthAt(t)`: 0 at and above 400 ka (PaleoDEM/Merdith
unchanged), 1 at and below 300 ka, linear between. The basemap is a single, time-invariant
texture per tier — not a dated sequence — so it is *not* folded into the existing
`uBefore`/`uAfter`/`uMix` pair `SEAM_BAND`'s crossfade reuses; it gets its own shader slot
(`uBasemapTex`/`uBasemapStrength`, `shaders.ts`) mixed *over* the ordinary PaleoDEM `dataColor`.
`Globe.tsx` only fetches/binds a basemap texture once `t` is within `BASEMAP_FETCH_MARGIN_YEARS`
(600 ka) of the present — a session that never scrubs that close never pays for a texture it
would never show. Tier selection (`web/src/globe/deviceTier.ts`): T0 (`basemap_t0`, 2048×1024)
for the minimised orb and for phone-expanded (`useIsPhoneViewport`, a thin re-export of the
shared `lib/useIsCompactViewport`, `events/useIsCompactViewport`'s own 760px breakpoint); T1
(`basemap_t1`, 4096×2048) only expanded on a non-phone device whose GPU reports
`MAX_TEXTURE_SIZE >= 4096` (`supportsBasemapT1`, a pure function fed by `lib/webgl.ts`'s
`probeWebgl()` — one throwaway WebGL context answers both "does WebGL work at all" and this,
rather than each opening its own). The basemap and HYDE textures load through a second,
byte-capped cache (`humanEraTextureCache.ts`, `ByteCappedCache` — `byteCappedCache.ts`), separate
from the PaleoDEM LRU (`textureCache.ts`): mipmapped + sRGB for the basemap (built with a manual,
high-quality mip chain — `buildHighQualityMipmaps`'s own doc comment on the Moiré artefact
`WebGLRenderer`'s own implicit `gl.generateMipmap()` produced on Natural Earth II's fine
bathymetric striations otherwise), un-mipmapped + `NoColorSpace` for HYDE (its R/G/B channels are
cropland/pasture/natural-rangeland *fractions*, not colour — an sRGB decode, or the browser's own
default `createImageBitmap` colour-space conversion/alpha premultiplication, would corrupt them
before the shader ever reads them, so HYDE's cache instance disables both at decode time). The
PaleoDEM LRU is trimmed *aggressively*
(`lru.ts`'s `LruCache.trim(keep, {aggressive:true})`, evicting below capacity, not only above it)
once `t` is at or below the crossfade band's near edge — `Globe.tsx`'s `wellInsideHumanEra` — so
idle deep-time frames don't sit resident once the basemap is the whole picture. On a WebGL
context loss, both human-era caches are cleared and every pair that reads them is forced to
re-fetch (`useGlobeTexturePair`'s `resetKey` option) rather than trying to re-upload from an
`ImageBitmap` this module has already closed (see below) — the PaleoDEM cache needs no such
handling, since its own textures keep their backing bitmap open for as long as they stay cached,
which three.js's own automatic re-upload-on-restore already relies on successfully. **No special-case caption.** An earlier
version showed "Idealised present-day terrain" once the basemap had loaded; that wrapper
(`HUMAN_ERA_BASE_CAPTION`/`globeBaseCaptionFor`) is gone — `Globe.tsx` now calls the ordinary
raster-domain fallback caption (`globeMultiCaptionFor`) across the basemap's own domain too,
which is empty there, exactly as it already is over plain PaleoDEM data (not "satellite" either
way — Natural Earth II is "deliberately idealized to a pre-modern land-cover baseline", chosen
over Blue Marble for exactly that reason, ADR-030).

**Tone-match grade (ADR-030's amendment).** Natural Earth II's photographic palette reads
markedly paler than PaleoDEM's stylised hypsometric tint once the crossfade brings it in — a real
tonal mismatch, checked first and confirmed *not* a colour-space bug: both textures decode
identically (`SRGBColorSpace`, plain `createImageBitmap`, the same `#include <colorspace_fragment>`
shader tail), and sampling the rendered globe against the source `basemap_t0.webp` file directly
matched within a few percent at four test points. Measured side by side at matched camera/regions:
ocean relative luminance ~9× brighter than PaleoDEM's, Sahara blown out to near-white, Amazon ~2×
brighter and desaturated. `gradeBasemapColor` (`blend.ts`, mirrored in `shaders.ts`'s GLSL) applies
a levels/gamma/saturation grade — `scale * pow(c, gamma)` per channel, then a saturation boost
around the result's luminance — to the basemap sample only, before it mixes into `baseColor`;
never to PaleoDEM or a regime look. Tuned against the sampled measurements above, not derived from
a physical model — land does not chase PaleoDEM's own arbitrary green tint, it just stops being
blown out.

**Tier-swap texture discipline.** The T0/T1 texture pair is bound through the *same*
`useGlobeTexturePair` hook the PaleoDEM pair already uses (parameterised by an options object —
cache instance, `aggressiveTrim`, `resetKey` — not positional booleans), so switching tiers on
expand/collapse gets the same "keep the old texture bound until the new one is ready" behaviour
for free — never a blank or flashed frame.

**Sphere/map geometry and texturing share one projection, with no map-mode-specific uv term.**
`web/src/globe/projection.ts`'s `lonLatToSphere`/`unfoldedPosition` is the one place the base mesh
(`globeGeometry.ts`) and every lat/lon-anchored overlay (arrival arcs, inhabited/city/scene-location
markers in `HumanCivilisation.tsx`/`MarkerField.tsx`, the K-Pg impact flash's anchor) derive a 3D
position from; `GLOBE_VERTEX_SHADER` computes its texture-sampling
`vUv` varying directly from each vertex's own `aLonLat`, identically whether `uUnfold` is 0, 1 or
between — there is no separate sphere-vs-map uv formula to keep in sync, and no per-fragment
`atan2` (which discontinuity at ±180° previously drove GPU mipmap-LOD selection into picking the
wrong mip right at the dateline, a visible seam line independent of the chirality bug below).
`lonLatToSphere`'s own `z = -radius*cos(lat)*sin(lon)` sign is load-bearing, not arbitrary: it is
the sign that pairs correctly with `globeGeometry.ts`'s triangle winding (inherited from
`THREE.SphereGeometry`'s own convention) to produce outward-facing normals — a same-magnitude,
wrong-sign `z` still builds a topologically valid sphere, just with every triangle's front face
pointing *inward*, which renders as a mirrored globe (east and west swapped) with dimmer lighting
(front-facing normals pointing away from the camera). `globeGeometry.test.ts` pins this
numerically (cross product of each triangle's own edges against its outward radius direction).

**One rotating scene-graph group owns the sphere's auto-rotate.** `Globe.tsx`'s
`GlobeRotatingGroup` wraps `GlobeSphere` and `HumanCivilisation` (the arcs/markers/tooltip
component that superseded the old, arrivals-only `ArrivalArcs.tsx`) in a single `<group>` and is
the only place `useGlobeAutoRotationY` is called; both children inherit its `rotation.y` through
three.js's own matrix composition, with no JS-level angle to read back out of a ref.
`useGlobeAutoRotationY` itself wraps its accumulated angle into `(-π, π]` every frame (`wrapAngle`)
rather than letting it grow without bound across a long session, and stops accumulating altogether
under `prefers-reduced-motion`; a scene with a real-world location (ADR-034) eases this same
accumulator to face it (`sceneLocation.ts`) rather than adding a second rotation source. `PoleAxisMarkers`
stays outside the group deliberately: both poles sit on the rotation axis itself, so spinning them
is a no-op. The camera (`GlobeCameraControls`) tweens from wherever the viewer actually left it —
direction, distance and pan target captured the instant a Globe/Map tween starts — rather than
snapping to a fixed starting pose first, restores the sphere's own pre-unfold distance on folding
back rather than always the default framing, and sizes its map-mode framing from the unrolled
mesh's own real half-extents, not a linear lerp (§1's v2 note, ADR-033's amendment).

**Cleared land — curated, no longer rendered (ADR-031's amendment).** The overlay this ADR
originally specified (HYDE cropland/pasture tinting, a curve/cap/colour retune of its own) was
built, then removed from `web/` entirely once rendered: the human found the tint indiscernible on
the globe, not a data or licence problem. `blend.ts`'s `hydeClearedLandBlendAt`/
`clearedLandTintAlpha`, `shaders.ts`'s cropland/pasture shader term, `humanEraTextureCache.ts`'s
dedicated HYDE cache instance, `Globe.tsx`'s wiring and its own legend row are all deleted; the
underlying `hyde_cleared_land` data stays curated and published-*able* (`pipeline/publish.py`'s
`RASTER_LAYERS` just no longer registers it — DATA_SOURCES.md's `hyde` entry). Population density,
below, tells the "what does the globe show about people" story instead.

**Population density (ADR-031's amendment).** `density.ts` decodes the published 8-bit log
encoding (`decodeLogDensity`, the TS twin of `pipeline/density_encoding.py`) back to real people/
km², then maps *that* — never the raw byte — through `DENSITY_RAMP`: seven stops, log10-spaced from
0.5 to 8,000 people/km², dark violet → magenta → red → orange → pale amber. That hue family and
that spacing are both direct responses to why the cleared-land tint failed: a *linear* fraction
spread thinly across a huge range, in ochre/olive hues that sit inside Natural Earth II's own
greens/tans. The alpha curve is tuned against real sampled 2015 CE texels, not by eye: remote
Amazon/Tibet fall at or under the floor and draw nothing; rural Iowa, the Argentine pampas and the
Congo sit around a third opaque; the Netherlands and Jiangsu are most of the way to opaque; Dhaka
is the ramp's own top. `densityStrengthAt` eases the overlay in from nothing across the 2,500 years
before HYDE's oldest (10,000 BCE) frame, and holds the newest (2015 CE) frame from there to the
present — data ends, held after, the same rule ADR-031 established for cleared land. Reuses HYDE's
own `'boxFilter'`-mip, `NoColorSpace` texture-cache instance (`humanEraTextureCache.ts`) for the
same reason cleared land needed it — population density is spatially sharper still, a city core
beside an empty hinterland — with one honest caveat: box-filtering the *encoded* log bytes means a
minified texel reads a little under the true area average (a geometric, not arithmetic, mean),
which errs toward under- rather than over-claiming. The legend's own colour key
(`DensityRampKey.tsx`, below) is generated from the same `DENSITY_RAMP` stops the shader
interpolates, so the two can never disagree.

**Arrivals — now transient, not permanent (ADR-032's amendment; the data/contract side is §6).**
Every arc used to be drawn for the whole span from its window's `tMax` to the present (dashed,
then solid at `established`), so by the present all twenty-five sat on screen together. An arc is
now drawn only while its migration is actually happening — `t` from the window's `tMax` through
`established` — with a bright head travelling `origin → destination` on a wall-clock loop
(`ARC_FRAGMENT_SHADER`'s `uTravelling`, looped rather than driven by `t` itself, since a dating
window is often a thousandth of the arc's own on-screen life). Past `established` a landing ripple
expands and fades at the destination, and the arc itself fades out over a tail (`arcs.ts`'s
`arrivalPresentationAt`); an `arrivalKind: peopling` leaves a small persistent "inhabited" marker
behind at the destination once the ripple settles, a `migration` leaves nothing. The tail's width
is not fixed in years: it is derived from the timeline's own playback-rate model
(`arrivalTimingFor`, in symlog-warp units) so every arrival gets at least `MIN_ARC_SECONDS` (1.1s)
of legible wall-clock life at the default rate regardless of how narrow its own dating window is —
a fixed year count would flicker at 60 ka and last forever at 700 BP. **Honest consequence:** near
the present the remaining timeline is narrower than that minimum, so a few of the most recent
arrivals are still partly drawn at `t = 0` — the fade simply runs out of timeline, not a bug to
clamp away. Rendered as camera-facing ribbons (`buildFatLineBuffers`, `HumanCivilisation.tsx`'s
`ARC_VERTEX_SHADER`), not `gl.LINE_STRIP`, through the shared `unfoldedLiftedPosition`/
`PROJECTION_GLSL` twin (§1's v2 note) rather than the arc's own separate `mix(spherePos, mapPos, ...)`
an earlier version used — so an arc can never drift from the mesh mid-unfold. **The parent chain
for trace-back is derived, not curated:** `findParentEventId` picks the strictly-older arrival
whose own destination sits nearest this one's origin (a DAG by construction, since only older
candidates count), and hovering a marker or feed card ghosts the whole chain back to the African
origin (`traceToOrigin`) at a dimmed alpha. **Labels are still not drawn** — the shared tooltip
(below) and the event feed cover the "what is this" need instead.

**Cities (ADR-035's data, rendered this pass).** `cities.ts`'s `selectCities` culls the 164
notability-filtered cities `FeatureData` publishes (DATA_SOURCES.md's own notability filter is a
separate, publish-time cut) down to whichever are largest *at the current `t`* — 10 on the orb, 45
expanded — so the late-modern frames don't turn solid; a scrub to 3000 BCE surfaces Uruk and
Memphis, to 1900 CE London and New York, with no separate ranking table. Marker radius is
`log10(population)`-mapped (2.4–9 CSS px), a legibility trade against area-true bubble sizing:
below about a million a proportional dot would be indistinguishable from the floor for most of
history. A city's size between two attested readings eases log-linearly (population is
multiplicative) rather than jumping; the tooltip always states the actual attested reading it sits
between, never the interpolated figure. **Names appear on hover only, in the shared tooltip below
— never as drawn labels:** the same call ADR-032 already made for arrival labels, for the same
reason (the labelled set overlaps constantly at globe scale, and a silent collision cull is worse
than a tooltip that always answers).

**One shared screen-space hit-test and tooltip (`GlobeTooltip.tsx`).** Every drawable in this
layer — arcs, inhabited/city/scene-location markers — registers a `GlobeHitCandidate` (a point or
a polyline, its own lift and pixel tolerance) rather than getting its own raycast target; none of
them has a real `position` geometry attribute for three.js's raycaster to hit; they are placed
entirely on the GPU from an `aLonLat` attribute. `useGlobeHitTest` projects every candidate to
screen space on each pointer move (cheap — it runs on pointer events, not frames) through the same
`unfoldedLiftedPosition`, and scores a hit by distance-over-tolerance, so a thin arc and a 2px city
dot compete on "how close, relative to how close it had to be" rather than raw pixels. One tooltip
component renders whichever target won, tracking it through `drei`'s `Html` with a clamp so it is
never cut off at the panel's own rounded edge.

**One instanced field for every dot (`MarkerField.tsx`).** Inhabited markers, city dots, arrival
landing ripples and the scene-location indicator are all one instance in a single
`InstancedBufferGeometry` — one draw call, not one mesh (and one `useFrame`) per marker, which is
what an earlier `ArrivalArcs.tsx` did and does not survive going from thirteen destinations to
forty-odd cities plus everything else. The one animated quantity, a sympathetic pulse for a marker
whose event card is on screen or is part of a traced chain, is a `uTime` uniform read on the GPU;
instance buffers are rewritten only when the marker *set* changes (a render), never per frame.

**Scene location on the orb (ADR-034; the single-toggle framing is ADR-036).** A scene naming a
real place eases the orb's own auto-rotation to face it and shows a small pulsing marker
(`sceneLocation.ts`'s `startFocusEase`/`stepGlobeRotation`, extending the same rotation accumulator
above rather than adding a second one). **Expanded or unfolded, the marker still shows but the
camera never moves** — the viewer is steering by then, so re-centring on their behalf would fight
their own input; this is a caller-side gate in `Globe.tsx` (no focus target is handed down while
expanded), not a branch inside `sceneLocation.ts` itself. **No marker at all** when the plate model
cannot place the scene (ADR-034's own Isthmus-of-Panama gap) — never a present-day fallback
position, which would be a specific, avoidable factual error on a paleo-textured globe.

**`ImageBitmap` closed only after a forced, synchronous GPU upload.** `humanEraTextureCache.ts`'s
`initAndCloseHumanEraTexture` calls `WebGLRenderer.initTexture` — a synchronous, forced GPU
upload three.js documents for exactly this "preload before first render" use case — before
closing the texture's backing `ImageBitmap`, so the close is provably safe rather than a
best-effort guess timed against a fixed frame count (which was tried first, and browser-verified
to race three.js's own deferred upload on a cold cache's first expand, leaving the globe
permanently blank). `GlobeSphere` (the one place in `Globe.tsx` with `useThree()` access to the
renderer) calls it once per texture, tracked by a `WeakSet` so a texture already handled is never
re-initialised — and that same `WeakSet` is cleared on `webglcontextrestored` (see above) so a
texture that *does* survive a context loss (freshly re-fetched into an already-cleared cache) is
force-uploaded again rather than skipped as "already handled".

**Legend — one "Human civilisation" toggle, not one per overlay (ADR-036).** `Legend.tsx`,
expanded-view only, same labelled-toggle idiom as `ViewModeToggle`/the timeline transport's own
controls, now shows a single row governing arcs, population density and cities together, per the
user's own framing ("a more global toggle for 'human civilisation' ... which covers that as well
as population density and cities") — not a toggle and a colour key per part. The row is shown only
when at least one of the three has data at the current `t` (`hasVisibleArrivals ||
densityHasDataAt || citiesHaveDataAt`) — omitted entirely rather than greyed out, the same rule
the old per-overlay rows already followed. **Arrivals carry no colour key at all** (their colour is
fixed, not a scale); **density gets one** (`DensityRampKey.tsx`, generated from `DENSITY_RAMP`),
shown in the row's own `footer` slot only while the layer is on and actually painting a density —
a key for a switched-off or out-of-domain overlay would be chrome explaining nothing. Toggle state
is local `Globe.tsx` state (not persisted to `localStorage` — a reasonable follow-up). Hidden
outright (not shown disabled) in the WebGL-off static-orb fallback, matching `ViewModeToggle`'s own
precedent. A row's own toggle can disappear out from under a keyboard user's focus the instant it
leaves the current `t`'s domain; the legend redirects focus back to its own container rather than
letting the browser drop it to `<body>` with no indication of where it went. On a phone viewport
(`compact`) rows are single-line with a short alternative hint rather than a truncated one, so an
honesty caveat ("modelled", "data ends 2015") is never the part that gets cut off.

---

## References

- Argus, D.F., Peltier, W.R., Drummond, R. & Moore, A.W. (2014). The Antarctica component of postglacial rebound model ICE-6G_C (VM5a)… *Geophys. J. Int.* 198, 537–563. doi:10.1093/gji/ggu140
- Barboni, M. et al. (2017). Early formation of the Moon 4.51 billion years ago. *Science Advances* 3, e1602365.
- Burgess, S.D. & Bowring, S.A. (2015). High-precision geochronology confirms voluminous magmatism before, during, and after Earth's most severe extinction. *Science Advances* 1(7), e1500470. doi:10.1126/sciadv.1500470
- Gumsley, A.P. et al. (2017). Timing and tempo of the Great Oxidation Event. *PNAS* 114(8), 1811–1816. doi:10.1073/pnas.1608824114
- Li, X., Hu, Y., Guo, J. et al. (2022). A high-resolution climate simulation dataset for the past 540 million years. *Scientific Data* 9, 371. doi:10.1038/s41597-022-01490-4
- Lyons, T.W., Reinhard, C.T. & Planavsky, N.J. (2014). The rise of oxygen in Earth's early ocean and atmosphere. *Nature* 506, 307–315.
- Merdith, A.S. et al. (2021). Extending full-plate tectonic models into deep time: Linking the Neoproterozoic and the Phanerozoic. *Earth-Science Reviews* 214, 103477. doi:10.1016/j.earscirev.2020.103477. Model: Zenodo 4485738 (CC-BY-4.0).
- Nimmo, F., Kleine, T. & Morbidelli, A. (2024). Tidally driven remelting around 4.35 billion years ago indicates the Moon is old. *Nature*. doi:10.1038/s41586-024-08231-0
- Peltier, W.R., Argus, D.F. & Drummond, R. (2015). Space geodesy constrains ice-age terminal deglaciation: The global ICE-6G_C (VM5a) model. *J. Geophys. Res. Solid Earth* 120, 450–487. doi:10.1002/2014JB011176
- Prave, A.R. et al. (2016). A new rock-based definition for the Cryogenian Period (circa 720–635 Ma). *Episodes* 39(2).
- Renne, P.R. et al. (2013). Time scales of critical events around the Cretaceous-Paleogene boundary. *Science* 339, 684–687.
- Rooney, A.D., Strauss, J.V., Brandon, A.D. & Macdonald, F.A. (2015). A Cryogenian chronology: Two long-lasting synchronous Neoproterozoic glaciations. *Geology* 43, 459–462. doi:10.1130/G36511.1
- Schoene, B. et al. (2019). U-Pb constraints on pulsed eruption of the Deccan Traps across the end-Cretaceous mass extinction. *Science* 363(6429), 862–866.
- Scotese, C.R. (2021). An Atlas of Phanerozoic Paleogeographic Maps: The Seas Come In and the Seas Go Out. *Annu. Rev. Earth Planet. Sci.* 49, 679–728.
- Scotese, C.R., Song, H., Mills, B.J.W. & van der Meer, D.G. (2021). Phanerozoic paleotemperatures: The earth's changing climate during the last 540 million years. *Earth-Science Reviews* 215, 103503. doi:10.1016/j.earscirev.2021.103503
- Scotese, C.R. & Wright, N.M. (2018). PALEOMAP Paleodigital Elevation Models (PaleoDEMS) for the Phanerozoic. Zenodo. doi:10.5281/zenodo.5460860 (CC-BY-4.0)
- Senel, C.B. et al. (2023). Chicxulub impact winter sustained by fine silicate dust. *Nature Geoscience* 16, 1033–1040. doi:10.1038/s41561-023-01290-4
- Sprain, C.J. et al. (2019). The eruptive tempo of Deccan volcanism in relation to the Cretaceous-Paleogene boundary. *Science* 363, 866–870. doi:10.1126/science.aav1446
- Tabor, C.R., Bardeen, C.G., Otto-Bliesner, B.L., Garcia, R.R. & Toon, O.B. (2020). Causes and climatic consequences of the impact winter at the Cretaceous-Paleogene boundary. *Geophys. Res. Lett.* 47, e2019GL085572 (article e60121 in Crossref). doi:10.1029/2019GL085572
- Tasistro-Hart, A.R., Macdonald, F.A., Crowley, J.L. & Schmitz, M.D. (2025). Four-million-year Marinoan snowball shows multiple routes to deglaciation. *PNAS* 122(18), e2418281122.
- Thiemens, M.M., Sprung, P., Fonseca, R.O.C., Leitzke, F.P. & Münker, C. (2019). Early Moon formation inferred from hafnium–tungsten systematics. *Nature Geoscience* 12, 696–700. doi:10.1038/s41561-019-0398-3
- Wilde, S.A., Valley, J.W., Peck, W.H. & Graham, C.M. (2001). Evidence from detrital zircons for the existence of continental crust and oceans on the Earth 4.4 Gyr ago. *Nature* 409, 175–178.
- Zerkle, A.L. et al. (2012). A bistable organic-rich atmosphere on the Neoarchaean Earth. *Nature Geoscience* 5, 359–363. doi:10.1038/ngeo1425
