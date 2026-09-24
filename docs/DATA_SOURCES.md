# Data Sources

Every dataset the project uses, at the level currently known. Each entry is deliberately
*shallow* — enough for an agent to pick it up, verify, and implement the integration
without re-deriving context.

**How to use this document.** One agent per source. The agent's job is to fill in every
`⚠️ VERIFY` and `⚠️ TBD` marker, then implement `sources/<name>/` against the contract in
§ Contract below. Do not start until the contract in
[`DESIGN.md §4`](./DESIGN.md#4-worldstate--the-central-abstraction-normative) and
§ Curated shapes here are frozen.

**All volume figures marked ⚠️ VERIFY are estimates from documentation, not measured.**
Measure before committing to a storage strategy.

---

## Contract

### The five curated shapes (NORMATIVE)

Every source normalises to exactly one of these. Adding another requires an ADR.

| Shape | Fields | Used for |
|---|---|---|
| `TimeSeries` | `t, value, [uncertainty]` + interpolation policy + `[gaps]` | scalar layers, `WorldState` fields |
| `EventSet` | `t_min, t_max, label, kind, t (moments only), tags, importance, description, citation` | timeline events |
| `RasterSequence` | `t, georeferenced grid` | globe textures, gridded layers |
| `Tree` | `node, parent, t_divergence, label` | ancestor lineage |
| `FeatureSet` | `id, name, country, lat, lon, certainty, estimates: [(t, population\|area_km2, [t_end])]` | labelled, dated geographic points (ADR-035) — e.g. `sources/cities`' major historical cities. `population`/`area_km2`/`t_end` generalised, additively, by ADR-037 for `sources/cliopatria`'s polity extents, which have no population reading |

### Directory layout per source

```
sources/<name>/
  manifest.toml     # url, sha256, licence, citation, time_domain, output_shape, volume
  fetch.py          # → data/raw/<name>/          (gitignored)
  normalise.py      # → data/curated/<name>.parquet
  fixture/          # small REAL slice, committed, for tests
  README.md         # findings from the deep dive: gotchas, schema, caveats
```

`manifest.toml` may also declare `outputs`, repo-relative glob patterns for side-effect
files an optional `write_outputs(raw_dir, repo_root)` hook in `normalise.py` writes outside
`data/curated/` (e.g. paleodem's globe textures). See CONTRIBUTING.md "Optional
write_outputs hook".

### Storage policy (NORMATIVE)

| Size | Where | Notes |
|---|---|---|
| < 5 MB curated | **git** | committed parquet, versioned with code |
| 5–100 MB curated | **git-lfs** | still reproducible from a clone |
| > 100 MB curated | **R2**, hash-manifested | `make data` downloads. *Not used in the MVP — everything stays local until deployment lands.* |
| any raw | **never committed** | `data/raw/` is gitignored; reproducible via `fetch.py` + sha256 |
| generated media | **git-lfs**: `data/pins/` + `data/media/` | candidates stay local; a pick copies its image into `data/pins/` (ADR-018, ADR-055) |

Rationale: a fresh clone must be able to run tests and build the frontend without
downloading anything. Fixtures guarantee that. Full data is a `make data` away.

---

# Tier 1 — needed for the vertical slice

## `paleodem` — Paleotopography

The backbone of the globe view.

| | |
|---|---|
| **Source** | PALEOMAP PaleoDEMs, Scotese & Wright (2018) |
| **Access** | [Zenodo record 5460860](https://zenodo.org/records/5460860) — direct HTTP download, no auth |
| **Format** | netCDF and GeoTIFF rasters |
| **Coverage** | 0–540 Ma at ~5 Myr steps (117 rasters); a 0–750 Ma extension exists |
| **Volume** | **414.7 MB** across 6 files — but the MVP needs only the **1° netCDF at 9.3 MB zipped** |
| **Licence** | **CC BY 4.0**, verified against DataCite metadata and the shipped License.txt |
| **Shape** | `RasterSequence` |
| **Storage** | raw not committed; **derived globe textures → R2** |

**Processing required**
1. Read with `xarray` / `rioxarray`.
2. Downsample to target globe texture resolution (⚠️ TBD — see DESIGN §14 open question 5).
3. Colour-map elevation + bathymetry into an equirectangular RGB texture.
4. Composite with `paleoclimate` (ice, biome) and `hyde` (land use) into the final texture stack.
5. Emit one texture per timestep + a manifest of `(t, texture_url)`.

**Integration** — feeds `WorldState.plates` (land/sea mask, elevation) and the globe
renderer directly. At runtime the globe blends the two nearest timesteps.

**Gotchas to check** — ⚠️ VERIFY: are timesteps evenly spaced? What is the vertical datum
and sea-level convention? Is there a no-data sentinel value? What projection are the rasters
actually in?

---

## `plates-neoproterozoic` — Merdith et al. 2021 continents, 1000–540 Ma

The globe's second raster source (GLOBE.md §4.1, G7): continents reconstructed from plate
polygons, with stylised (non-elevation) relief, crossfaded against `paleodem` across a
540–550 Ma seam band. Not a `gplately`/`plate-model-manager` fetch — the pinned Zenodo zip is
downloaded directly and verified against a recorded sha256, the same pattern `paleodem` uses.

| | |
|---|---|
| **Source** | Merdith, A.S. et al. (2021), *Earth-Science Reviews* 214, 103477 |
| **Access** | [Zenodo record 4485738](https://zenodo.org/records/4485738) (v1.1b) — direct HTTP download via the Zenodo API's file-content URL, no auth |
| **Format** | GPML (GPlates Markup Language) continent/craton shape files + a GPlates `.rot` rotation file |
| **Coverage** | 1000–540 Ma (rotation samples reach 1140 Ma; the model is published as 1000–0 Ma) |
| **Volume** | 13.9 MB zip (sha256-pinned); extracts 3 of 37 members (continents 9.1 MB, cratons 5.1 MB, rotations 0.6 MB) — the rest (topologies, palaeomagnetic poles, a GPlates project file, an animation) is unused, per G7's "no G4 plate-rotation shader" scope |
| **Licence** | CC BY 4.0 |
| **Shape** | `RasterSequence`, id `"plates_neoproterozoic"` — 47 generated textures (10 Myr spacing, 1000–550 Ma, plus one extra 540 Ma seam frame), never committed (generated media) |
| **Storage** | curated parquet: **git** (well under the 5 MB threshold); textures: gitignored, regenerated locally |

**Processing required**
1. `pygplates.PlatePartitioner` against the reconstructed `ContinentalPolygons`/`Cratons`
   layers assigns a land/craton mask per target pixel at each frame age (`relief.py`).
2. Stylised relief only — no elevation data exists this far back: land mask, cratons raised,
   shelves from a `scipy.ndimage.distance_transform_edt` distance-to-coast transform,
   per-plate-id-seeded procedural noise, uniform abyssal depth offshore.
3. Coloured with the same hypsometric palette as `paleodem` (`pipeline/palette.py`, factored
   out of `sources/paleodem/normalise.py` so both sources can't drift apart), so the two
   sources' textures read as one continuous look across the seam.

**Integration** — feeds `web/src/globe/blend.ts`'s `globeMultiBlendAt`/
`globeMultiPreloadUrls`/`globeMultiCaptionFor`, which pick between this source and `paleodem`
by domain and crossfade the shared 540–550 Ma seam band. `regimeEventsWithRasterFallback`
covers "this source is unusable": the globe shows the `globe-regimes` "geography unknown"
look for 540–1000 Ma instead of faking continents.

**Gotchas** — `gplately`/`pygplates` are GPL-2.0 and stay in the pipeline only (never shipped
to the browser). `write_outputs()` (the only code path that imports `pygplates`/`scipy`) is
never exercised by the pytest suite, matching the "tests never import gplately" rule
(§3.4); the committed fixture (`sources/plates-neoproterozoic/fixture/`, ~816 KB) is a real,
narrow slice (one plate id whose features are valid across the full target range) used only
to check `normalise()`'s fixed-age-list `RasterSequence` shape. Full detail, measurements and
the visual spot-check against real data: `sources/plates-neoproterozoic/README.md`.

---

## `gplately` — Plate rotations and paleo-coordinates

| | |
|---|---|
| **Source** | [GPlates/gplately](https://github.com/GPlates/gplately), `pip install gplately` |
| **Access** | Python library; downloads reconstruction models on first use |
| **Format** | Python API over GPML/rotation files |
| **Coverage** | 0–1000 Ma depending on the chosen model |
| **Volume** | ⚠️ VERIFY — model files cached locally, estimated < 200 MB |
| **Licence** | GPLv2 (library). Reconstruction models have their own citation requirements ⚠️ VERIFY |
| **Shape** | not a curated file — a **computation** used by other sources |
| **Storage** | library dependency; cached models gitignored |

**Processing required** — none as a dataset. Wrap it in a thin service used by:
- the "what's under your feet" layer (present-day lat/lon → paleo lat/lon at `t`)
- on-demand generation (§15 of DESIGN)
- coastline overlays on the globe

**Install risk — RESOLVED, no longer a blocker.** `pip install gplately` completes in ~33
seconds, wheels only, no compilation, no conda, no system GDAL/PROJ/GEOS. pygplates 1.0.0
publishes first-party `macosx_11_0_arm64` wheels for cp38–cp313. Install footprint ~1.0 GB
for full gplately; `pip install pygplates` alone is 78 MB installed and sufficient if only
rotations are needed. Model data is fetched separately by `plate-model-manager` — the
Merdith 2021 deposit is 13.9 MB (Zenodo 4485738, CC-BY-4.0). No multi-gigabyte download
anywhere in this source.

⚠️ Two residual caveats: (1) verified on Linux x86_64 — the arm64 claim rests on wheel
availability plus gplates.org's stated macOS 11.0+ ARM64 support, so confirm once on the
target Mac; (2) **gplately and pygplates are GPL-2.0** — fine for the offline pipeline, but
must not be vendored into the shipped frontend. Licences for EarthByte models other than
Merdith 2021 are unconfirmed; check each deposit before republishing derived rasters.

---

## `co2-o2` — Atmospheric CO₂, 570 Ma → AD 2025

Small, easy, and the ideal first layer for the vertical slice.

| | |
|---|---|
| **Source** | Spliced, newest first: NOAA GML Mauna Loa annual means (1959–2025); Bereiter et al. 2015 Antarctic ice-core composite (~806 ka–AD 2001); GEOCARB III (Berner & Kothavala 2001, 570–0 Ma) |
| **Access** | **VERIFIED.** `https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_annmean_mlo.txt`; `https://www.ncei.noaa.gov/pub/data/paleo/icecore/antarctica/antarctica2015co2composite.txt`; `https://www.ncei.noaa.gov/pub/data/paleo/climate_forcing/trace_gases/phanerozoic_co2.txt` (plain HTTP, no auth; per-file sha256 in `manifest.toml` `[[artefacts]]`) |
| **Format** | three text files: whitespace columns (GML), tab-separated with BOM + CRLF (ice core), fixed-width with prose header (GEOCARB) |
| **Coverage** | annual 1959–2025; ~1–700 yr spacing back to ~806 ka; then 10 Myr spacing from 10 Ma to 570 Ma. **806 ka–10 Ma has no data** and is declared a `TimeSeries.Gap` (ADR-027) rather than left for `sample()` to bridge log-linearly — that bridge read 207–277 ppm, a glacial low, where the Pliocene was ~350–400 ppm. `sample()` returns `None` inside it, scene conditions name the gap, and the HUD readout, sparkline and chart render it as absent rather than plot it. No verifiable Cenozoic proxy file was found to fill the span itself (see the source README) |
| **Volume** | measured 59 KB raw; 1,977 curated rows |
| **Licence** | NOAA NCEI paleo files US public domain; NOAA GML freely available with credit requested. Cite Lan/Keeling (GML/SIO), Bereiter 2015, Berner & Kothavala 2001 |
| **Shape** | `TimeSeries` × 1 (`co2`, ppm). No O₂: none of the files has it |
| **Storage** | **git**, committed parquet |

**Processing** — parse each file, convert to years before the fixed AD 2025 present
(GML `t = 2025 − year`, raising on a later year; ice core `t = age_BP1950 + 75`; GEOCARB
`t = |Ma| × 1e6` and `ppm = RCO2 × 280`). Splice newest first: each segment keeps only samples
strictly older than everything before it, which drops the ice core's AD 1959–2001 rows and
GEOCARB's 0 Ma pre-industrial value. Uncertainty comes from each file's own sigma column;
GEOCARB rows have none. Interpolation is **log-linear**. Splice points and the monthly
re-pinning of the GML file are documented in `sources/co2-o2/README.md`.

**Integration** — `WorldState.atmosphere.co2_ppm`; one HUD CO₂ sparkline and readout (an O₂
layer needs a separate source); drives sky haze and colour in
the variant half of the style spec (see `VISUAL_SPEC.md`).

---

## `events-core` — The curated event set

The spine of the timeline. **Partly hand-authored — this is not purely a scrape.**

| | |
|---|---|
| **Source** | Wikidata SPARQL (`point in time`), Wikipedia timeline articles, plus manual curation |
| **Access** | Wikidata Query Service (public SPARQL endpoint, rate-limited) |
| **Format** | JSON → hand-edited YAML |
| **Coverage** | full range |
| **Volume** | small — ~200 events, < 1 MB |
| **Licence** | Wikidata CC0; Wikipedia CC BY-SA (paraphrase, don't copy) |
| **Shape** | `EventSet` |
| **Storage** | **git**, as YAML — this is *source*, not derived data |

**Processing** — SPARQL gets you a candidate pool. An LLM pass drafts normalised
descriptions and importance scores. **A human curates the final ~200.** Every event needs
`t_min`/`t_max` and a citation, plus (ADR-022) a `kind` (`moment`, dated by a best-estimate `t`
inside `[t_min, t_max]`, or `period`, whose `t_min`/`t_max` are its own span with no single `t`)
and a non-empty, ordered `tags` list drawn from a closed set of six themes (`life`,
`earth-climate`, `catastrophe`, `human-origins`, `society`, `science-technology`) — the first tag
is primary and drives timeline colour. Both fields are required, not defaulted: a source whose
YAML doesn't yet carry them fails to load loudly rather than being silently guessed at.

⚠️ **Do not let an LLM be the source of truth for dates.** It drafts and normalises; the
citation is what makes a date real. Cross-check deep-time dates against the ICS chart and
PBDB.

---

## `globe-regimes` — Pre-1 Ga globe regime captions

A second, small, hand-curated `EventSet` (GLOBE.md §4.2, §6) — **not** an extension of
`events-core`. It exists only so the globe has something to caption before any plate
reconstruction exists (older than Merdith et al. 2021's 1 Ga start); `pipeline/publish.py`
publishes it as an ordinary `dataKind: "events"` layer, never through `Manifest.events`, so
it is never listed on the timeline. See `sources/globe-regimes/README.md` "Why a separate
source from events-core" for the full reasoning.

| | |
|---|---|
| **Source** | primary literature already cited in GLOBE.md §4.2/§References, hand-curated directly into YAML |
| **Access** | none — no upstream file, `fetch.py` is a no-op (mirrors `sources/astronomy`) |
| **Format** | hand-edited YAML |
| **Coverage** | ~1.0–4.52 Ga |
| **Volume** | tiny — 5 events, a few KB |
| **Licence** | N/A — no dataset redistributed, only cited |
| **Shape** | `EventSet`, id `"globe-regimes"` |
| **Storage** | **git**, as YAML (`data/globe_regimes.yaml`) — this is *source*, not derived data |

**Processing** — none: `normalise.py` parses `data/globe_regimes.yaml` directly, exactly like
`events-core`'s `normalise.py` parses `data/events.yaml`. Every event carries a `GlobeEffect`
(`effect`, docs/GLOBE.md §6) — a regime without one would be curated for nothing.

---

# Tier 2 — needed for the full experience

## `basemap` — Human-era globe base (Natural Earth II)

Replaces the PaleoDEM reconstruction for the recent past, where continental drift is
imperceptible (ADR-030). Idealised pre-modern land cover by design, so it doesn't
double-count the `hyde` cleared-land overlay below.

| | |
|---|---|
| **Source** | Natural Earth II, "with Shaded Relief, Water, and Drainages", 1:10m — [naturalearthdata.com](https://www.naturalearthdata.com/downloads/10m-raster-data/10m-natural-earth-2/) |
| **Access** | **VERIFIED.** The download page's own links are broken (resolve to a doubled-origin URL, a template bug); the real file is served from Natural Earth's CDN, `naciscdn.org/naturalearth/10m/raster/NE2_LR_LC_SR_W_DR.zip` — see `sources/basemap/README.md` "What was and wasn't downloaded" |
| **Format** | GeoTIFF, 16200×8100, plain equirectangular WGS84 |
| **Coverage** | temporally flat (not per-epoch data); published domain `[0, 2,580,000]` years BP (the Gelasian/Quaternary-Pleistocene boundary, ICS chart) — informational, not the product's own paleodem↔basemap crossfade band (300–400 ka, fixed by the user, web-side only — see `sources/basemap/README.md` "Time domain vs. the crossfade window") |
| **Volume** | measured: 194,338,220 bytes (194.3 MB) raw zip; 1,711,130 bytes (1.71 MB) published across both tiers — see `sources/basemap/README.md` "Measured volume" |
| **Licence** | **Public domain** (confirmed live: "All versions of Natural Earth raster + vector map data found on this website are in the public domain") |
| **Shape** | `RasterSequence` × 2 (`basemap_t0` 2048×1024, `basemap_t1` 4096×2048 — two resolution tiers, each its own curated id rather than a shape change — see `sources/basemap/README.md` "Why two curated ids") |
| **Storage** | raw not committed (gitignored); curated parquet → git; textures → generated media, committed via git-lfs into `data/media/` |

**Processing** — the source GeoTIFF is resized (Lanczos) directly to each tier's target
resolution and saved as lossy WebP (imagery, not a data layer, so CONTRIBUTING.md's higher
accuracy bar for data layers doesn't apply). Full detail: `sources/basemap/README.md`.

## `hyde` — Cleared land (curated, not published), and population density (published)

The sleeper. Gridded, so it animates civilisation spreading across the globe from real data.

**Population density is implemented and published** (`sources/hyde/`, id
`hyde_population_density`, ADR-031 amendment "population density"). **Cleared land is
implemented but no longer published** (id `hyde_cleared_land`; the human found it not
discernible on the globe — ADR-031 amendment) — it stays curated (fetch/normalise/tests all
still run, the parquet still builds) so it can be re-published later by re-adding one
`LayerSpec` line to `pipeline/publish.py`'s `RASTER_LAYERS`. **Global population as a
`TimeSeries` for the HUD is now implemented and published** (id `population`, ADR-031 amendment
"global population total") — the world total at each of the same 73 timesteps, a HUD readout and
sparkline/chart alongside `co2`.

| | |
|---|---|
| **Source** | **HYDE 3.2 only** (Klein Goldewijk et al. 2017), DANS: [doi:10.17026/DANS-25G-GEZ3](https://doi.org/10.17026/dans-25g-gez3). **HYDE 3.3 is CC BY-NC-SA 4.0 (confirmed via DataCite) and must NOT be used** — corrected from an earlier draft of this entry, which named 3.3 with an unverified "believed CC BY" licence |
| **Access** | **VERIFIED.** Selective HTTP Range extraction directly against the DANS access endpoint (`archaeology.datastations.nl/api/access/datafile/5490328`, `HYDE3_2_1-baseline.zip`) — see `sources/hyde/README.md` "Fetch strategy" for why the whole 5.3 GB archive is never downloaded, and its Deflate64/`unzip` platform dependency |
| **Format** | ASCII grid (`.asc`), 5 arcmin (4320×2160) |
| **Coverage** | 10,000 BCE → 2015 CE, 73 real timesteps at HYDE's own native spacing (millennial → centennial → decadal → annual) — same 73 timesteps for cleared land and population density |
| **Volume** | measured — see `sources/hyde/README.md` "Measured volume" (cleared land: cropland + pasture + rangeland + conv_rangeland) and "Population density encoding" (population: `popc`, plus the downsampled-texture `D_MAX` measurement) |
| **Licence** | **CC0-1.0** (DANS deposit); the dataset's own bundled readme separately states CC BY 3.0 for the data itself — both recorded, both permissive |
| **Shape** | `RasterSequence` × 2 + `TimeSeries`. `hyde_cleared_land` (curated only): R = cropland fraction, G = (pasture + conv_rangeland) fraction, B = rangeland fraction, per-cell, analytically area-weighted — see `sources/hyde/README.md` "Which HYDE variable is 'pasture'" for two sequential corrections: (1) `grazing` alone, used in an earlier revision, wrongly painted natural rangeland as cleared land; (2) `conv_rangeland`, initially left unfetched, was confirmed against the primary source (Klein Goldewijk et al. 2017) to be forest-biome grazing land the authors themselves define as assumed-cleared, so it is now fetched and summed into G. `hyde_population_density` (published): R = 8-bit log-scale-encoded people/km² (G = B = 0), decoded via this layer's own published `RasterEncoding` metadata (`channel`, `unit`, `dMax`) — see `sources/hyde/README.md` "Population density" for the encoding formula, how `D_MAX` (15,000) was measured from the real downsampled data, and why the area-weighted downsample sums people and area separately rather than averaging per-cell densities. `population` (published, id `population` — not `hyde_population_total`, so it slots directly into `WorldModel.at()`'s existing `self._s("population", t)` lookup and `HumanState.population`): a scalar `people` `TimeSeries`, `log-linear` interpolation, one sample per real HYDE timestep — a plain sum of the full-resolution `popc` grid (no area weighting: `popc` is already people per cell, so summing every valid cell directly *is* the world total, unlike the density raster above) |
| **Storage** | raw not committed (gitignored, selectively re-fetched); curated parquet → git; textures → generated media, committed via git-lfs into `data/media/` |

**Processing (cleared land)** — per timestep, `cropland<yr>.asc`, `pasture<yr>.asc`,
`rangeland<yr>.asc` and `conv_rangeland<yr>.asc` (km² per cell) are each converted to a fraction
of each cell's true (latitude-dependent) surface area, with ocean/no-data cells folded to 0,
then downsampled to a 1024×512 lossless WebP: R = cropland, G = pasture + conv_rangeland
(clipped to 1), B = rangeland (meant to be rendered fainter than R/G — it is natural,
non-forest-biome grazing land HYDE's own authors say was not cleared). Full detail:
`sources/hyde/README.md`.

**Processing (population density)** — `popc<yr>.asc` (inhabitants per cell, fetched from a
differently-shaped in-archive path than the land-use variables — confirmed directly from the
archive's own central directory, not assumed) is divided by the same true per-cell surface area
used for cleared land, then downsampled to 1024×512 *area-correctly*: total people divided by
total area per output pixel's footprint (Pillow's `BOX` filter applied separately to the raw
people-count and area grids, then divided), not a mean of already-computed per-cell densities,
which would under-weight the small-area cells that hold most of a dense city's population.
Encoded 8-bit per `pipeline/density_encoding.py`'s shared log-scale formula (documented in the
layer's own published metadata so the web can decode an exact density, not just a relative
shade). World totals sanity-checked directly against the full-resolution `popc` sums: 4.4M at
10,000 BCE, 232M at 1 CE, 7.26B at 2015 CE — all within the expected order of magnitude. Full
detail: `sources/hyde/README.md` "Population density".

**Processing (global population total)** — for each of the same 73 timesteps, the
full-resolution `popc<yr>.asc` grid (people per cell) is summed directly, with ocean/no-data
folded to 0 and the handful of cells carrying small negative rounding noise clipped to 0 —
matching the population-density raster's own two conventions exactly, so the two outputs can
never silently disagree about what counts as "no people here". No area weighting: `popc` is
already an absolute count per cell, so a plain sum over every valid cell is the world total.
World totals sanity-checked directly against the full-resolution sums: 4.4M at 10,000 BCE, 232M
at 1 CE, 943M at 1800 CE, 1.6B at 1900 CE, 6.1B at 2000 CE, 7.26B at 2015 CE — monotonically
increasing and within the expected order of magnitude at every checkpoint (Klein Goldewijk et al.
2017; UN World Population Prospects). Published as an ordinary `SCALAR_LAYERS` HUD entry
(`pipeline/publish.py`), chartable like `co2`. **Out-of-domain treatment** (ADR-031 amendment
"global population total"): the series' own domain is `[10, 12025]` years BP (2015 CE →
10,000 BCE), same as the two rasters. Older than 10,000 BCE the readout reads absent ("no data"),
same as every other scalar layer — never fabricated. Nearer than 2015 CE (`t < 10`, i.e. today)
the web-side `<ScalarReadout>` holds the 2015 CE total rather than reading "no data", mirroring
the population-density globe overlay's own "data simply ends, hold" convention
(`web/src/globe/density.ts`'s `densityBlendAt`) — but annotates it "as of <year>" (`web/src/layers
/components/ScalarReadout.tsx`), since silently freezing the number would misrepresent a 2015
total as a live reading for right now. This hold is driven by the layer's own declared domain,
not a special case for this one layer id, so it applies identically to any future scalar layer
whose data ends before the present.

---

## `cities` — Major historical cities

| | |
|---|---|
| **Source** | Reba, M., Reitsma, F. & Seto, K.C. (2016), "Spatializing 6,000 years of global urbanization from 3700 BC to AD 2000", *Scientific Data* 3:160034, doi:10.1038/sdata.2016.34 |
| **Access** | **VERIFIED.** SEDAC's own listing (doi:10.7927/H4ZG6QBX) is a dead end — it gates bulk downloads behind a NASA Earthdata login and ships no direct CSV. The paper's own "Data Records" section names the real distribution: three CSVs (Chandler, Modelski Ancient, Modelski Modern) independently deposited on figshare, downloadable via `ndownloader.figshare.com` with no auth (`sources/cities/README.md` "Licence and access") |
| **Format** | three wide CSVs (latin-1 encoded), one row per city, one column per dated population estimate (`BC_<year>`/`AD_<year>`) |
| **Coverage** | 3700 BCE → 2000 CE (curated); published (notable-only) layer's actual domain follows whichever notable cities' own estimates span |
| **Volume** | measured: 1,448,474 bytes raw (three CSVs); 1,736 curated features; 283 published (see "Significance roster" below) |
| **Licence** | **CC BY 4.0** — each of the three figshare deposits independently, confirmed via the figshare API's own `license` field |
| **Shape** | `FeatureSet` (ADR-035), id `cities` — one record per city: stable slug id, name, modern country, lat/lon, source certainty (`FeatureCertainty`, mapped from the raw dataset's 1/2/3 geocoding-confidence code), and a list of dated population estimates |
| **Storage** | raw not committed (gitignored, re-fetched from figshare); curated parquet → git (small) |

**Processing** — Chandler (the only dataset spanning the full range) is the base layer; Modelski
Ancient is merged on top, then Modelski Modern on top of that, overwriting Chandler's
coordinates/certainty/estimate for any (city, country) match and any exact-year estimate
conflict — the paper's own stated precedent for the Chandler/Modelski-Ancient overlap, applied
uniformly to both Modelski files (`sources/cities/README.md` "Dedupe policy"). Rows without
valid coordinates or with no population estimate at all are dropped (0 and 1 rows respectively,
in the real data). The curated `FeatureSet` keeps all 1,736 cities that survive the merge.

**Significance roster (published layer only, ADR-038)** — `sources/cities/roster.toml` is a
hand-curated list of 283 cities (an `id` plus a short `reason` each), intersected with the curated
`FeatureSet` by `pipeline.publish.apply_city_roster` in `pipeline/publish.py`'s `FEATURE_LAYERS`
loop. An entry that matches no curated feature raises `CityRosterError` naming every offender, so a
typo fails the build rather than silently shrinking the globe.

This replaced a population-rank filter (`pipeline.notability.notable_features`, now deleted), which
took each 100-year bucket's top 12 by peak attested population. That rule published 164 cities with
**zero** in sub-Saharan Africa, **zero** in Australia/NZ/the Pacific, 4 in South-East Asia and 3 in
South America — 150 of 164 in Europe, the Mediterranean, the Near East, India and China, heavy on
ancient Mesopotamian tells. The defect is structural: ranking by population inside a gazetteer whose
population *coverage* is geographically uneven can only rank what the sources happened to measure.
See ADR-038 for the full reasoning.

Measured spread of the 283: Europe 45, Middle East 43, sub-Saharan Africa 33, East Asia 26, South
Asia 24, South-East Asia 21, South America 18, North America 15, Russia 12, Central Asia 11,
Caribbean/Central America 10, North Africa 8, Oceania/Pacific 8, Mexico 6, Caucasus 3; by era, 49
first attested pre-1 CE, 34 in 1–1000 CE, 103 in 1000–1800 CE, 97 in 1800–2000 CE.
`tests/sources/test_cities_roster.py` asserts per-region and per-era minimums against the real
roster and real curated data. Full detail: `sources/cities/README.md` "Significance roster".

**What the roster cannot reach.** Chandler and Modelski are "largest cities in the world at each
snapshot year" datasets ending at AD 2000, not gazetteers, so a city that was never among the
world's largest is simply absent from the curated 1,736 and no roster entry can summon it. This
is most visible in modern sub-Saharan Africa and the Gulf: Kampala, Kigali, Brazzaville,
N'Djamena, Niamey, Nouakchott, Gaborone, Windhoek, Yaoundé, Mogadishu, Doha, Dubai, Abu Dhabi and
Manama have no record here, as do Tirana, Vientiane, San José and Tegucigalpa. Closing that gap
means adding a gazetteer source, not loosening the roster.

**Integration** — the published `FeatureSetData` layer file is a self-contained, typed contract
(`pipeline/manifest.py`, mirrored in `web/src/types/layer.ts`/`web/src/data/curated.ts`). Rendering
was out of scope for this ADR but has since been built (ADR-036): `web/src/globe/cities.ts` culls
the 242 published cities to whichever are largest at the current `t` for the on-screen marker
field, with names on hover only, in the same shared tooltip arrival arcs and inhabited markers use.

---

## `cliopatria` — Historical empire/polity territory

| | |
|---|---|
| **Source** | Cliopatria (Seshat Global History Databank / Complexity Science Hub Vienna / Alan Turing Institute / Oxford); Chalstrey, E., Bennett, J. & Mutch, E. (2024), Zenodo doi:10.5281/zenodo.13363121 (v0.0.1); methods paper Bennett, J. et al., SocArXiv preprint osf.io/24wd6 |
| **Access** | **VERIFIED.** A single Zenodo file-content URL (`zenodo.org/api/records/13363121/files/.../content`), no auth — the Zenodo deposit is a snapshot of the `cliopatria` GitHub repo, containing one doubly-nested zip whose only real payload is `cliopatria.geojson` |
| **Format** | one GeoJSON `FeatureCollection`, CRS84 (lon/lat WGS84) |
| **Coverage** | curated domain 3400 BCE → 1900 CE (the raw dataset itself runs to 2024 CE; a provisional per-user cutoff excludes everything after 1900 CE — see "Processing" below and `sources/cliopatria/README.md` "Domain cutoff: 1900 CE"), ~508 distinct attested map years in the raw data |
| **Volume** | measured: 49,215,745 bytes raw zip; 186,488,764 bytes extracted GeoJSON; 14,945 total features (14,108 `Type == "POLITY"`); curated (2026-09-18, after the label-normalisation and 1900-cutoff amendment) to 114 notable polities across 1,803 surviving windows, 842 raster frames (`sources/cliopatria/README.md` "Measured volume") |
| **Licence** | **CC BY 4.0** — confirmed both via the Zenodo record's own `license.id` and the repository's committed `LICENSE.md` |
| **Shape** | `RasterSequence` (id `cliopatria_extent`, territorial coverage) + `FeatureSet` (id `cliopatria_polities`, one label-anchor `Feature` per surviving polity-window — ADR-037) |
| **Storage** | raw not committed (gitignored, re-fetched from Zenodo); both curated parquets → git (small); textures → generated media, git-lfs |

**Processing** — `Type != "POLITY"` rows (`LEADER`/`GROUP`/`EVENT`/`ARMY`) are dropped first;
Cliopatria's own precomputed `Area` (km², spot-checked against known peak empire sizes) feeds
an objective, era-relative "top 6 by peak area per 100-year bucket" subset rule
(`sources/cliopatria/subset.py`), applied inside `normalise.py` itself (curated data already
holds only the notable subset — a deliberate departure from `sources/cities`' "curate
everything, filter at publish" precedent, since the full world political map at ~508 map years
is a different, much larger product than what was asked for). Every raw `Name`'s wrapping
`"(...)"` pair is stripped unconditionally — a merge into an existing bare name when one exists
(e.g. `"(Roman Empire)"` → `"Roman Empire"`, stopping the same physical empire consuming two
ranking slots) or a plain rename when it doesn't (e.g. `"(Delhi Sultanate)"` →
`"Delhi Sultanate"`) — plus a small explicit alias (`"(British Empire)"` →
`"British Colonial Empire"`, two literal Names for one empire that paren-stripping alone can't
unify) and a small explicit exclusion list (`"Greek Dark Ages"`, a historical period Cliopatria
carries as a `POLITY` row despite not being an attested governing polity) — see
`sources/cliopatria/README.md` "Duplicate aggregate entries and label normalisation" for the
full account and every name affected. **Domain cutoff (added 2026-09-18, per-user, provisional):**
`normalise.CUTOFF_CE_YEAR = 1900` drops any polity-window material after that year and truncates
a straddling window to end there, applied before the subset rule runs — "largest by area" ranked
all the way to the present had selected modern nation-states (Canada, the PRC, Brazil, the
Russian Federation, the USA) rather than the historical empires this layer exists to show; see
`sources/cliopatria/README.md` "Domain cutoff: 1900 CE". 114 polities selected, spanning every
millennium 3400 BCE → 1900 CE and every inhabited continent — full list, peak areas and spans in
`sources/cliopatria/README.md` "Subset rule".

**Integration** — the raster is a plain coverage mask (R = antialiased territorial coverage
0–255, G = B = 0; which named polity a pixel belongs to is left to the `FeatureSet`'s label
anchors, the same split `sources/hyde` draws between its population-density raster and
`sources/cities`' named markers). Each `Feature`'s single-element `estimates` list carries
`area_km2` and `t_end` (ADR-037's additive extension to `PopulationEstimate`, not `population`
— a polity has no population reading), because a polity's own representative point moves as its
territory does, which the existing "one `Feature`, one fixed `lat`/`lon`" shape can only express
at the granularity of one `Feature` per attested window, not one per polity — see
`sources/cliopatria/README.md` "FeatureSet: one row per window, not per polity" for the full
account of why this doesn't fit `FeatureSet` as cleanly as `sources/cities` does. Rendering is
out of scope for this source, matching `sources/cities`' own original ADR-035 scoping.

**Certainty and honesty** — `FeatureCertainty` is mapped from whether a window's row carries a
Seshat databank cross-reference (`SeshatID`) — `HIGH` if present, `MEDIUM` otherwise, no `LOW`
tier — a genuine data-provenance signal, not a border-accuracy one. The Cliopatria authors'
own stated caveat that steppe/nomadic polities' borders (their example: the Avar Khaganate) are
materially more contested than settled agrarian empires' is **not** encoded as per-feature data
(doing so would mean hand-classifying which selected polities count as "nomadic" from
historical knowledge — exactly what the objective subset rule exists to avoid doing for
*selection*) — it is carried instead as explicit prose in `sources/cliopatria/README.md`
"Certainty".

---

## `lr04` — Benthic δ¹⁸O stack, ice volume and sea level, 0–5.32 Ma

| | |
|---|---|
| **Source** | LR04 global Pliocene-Pleistocene benthic δ¹⁸O stack (Lisiecki & Raymo 2005, Paleoceanography 20, PA1003) |
| **Access** | **VERIFIED.** `https://www.ncei.noaa.gov/pub/data/paleo/contributions_by_author/lisiecki2005/lisiecki2005-d18o-stack-noaa.txt` (NOAA NCEI study 5847, DOI 10.25921/k88j-0106), plain HTTPS, sha256 in `manifest.toml` |
| **Format** | NOAA template text file: `#` header, then a tab-separated `age_calkaBP / d18O_benthic / d18O_error` table, CRLF |
| **Coverage** | 0–5.32 Ma; 1 kyr spacing to 600 ka, 2–5 kyr beyond |
| **Volume** | measured 40,651 bytes raw; 2,115 rows per curated series |
| **Licence** | CC-BY-3.0 via the identical PANGAEA publication (doi:10.1594/PANGAEA.701576, compared row by row); NCEI's own copy states no licence, citation requested |
| **Shape** | `TimeSeries` × 3: `benthic_d18o` (‰, with its standard error), `sea_level` (m), `ice_volume` (LGM = 1) |
| **Storage** | **git**, committed parquet |

**Processing** — `t = age_ka × 1000 + 75` (LR04 counts from AD 1950). `sea_level` and
`ice_volume` are one linear scaling of δ¹⁸O anchored on the stack itself: its 0 ka value → 0,
its 19–23 ka (EPILOG LGM chronozone) mean → −134 m (Lambeck et al. 2014). Rough by design —
benthic δ¹⁸O also carries deep-water temperature — and documented as such in
`sources/lr04/README.md` § Calibration.

**Integration** — `WorldState.climate.sea_level_m` (`sea_level`); `ice_volume` and `sea_level`
are published as `globe`-surface scalar layers driving the globe's schematic ice sheets and
glacial lowstand (docs/GLOBE.md §5.1). Not on the HUD.

---

## `paleoclimate` — Temperature, Köppen classes, sea level

| | |
|---|---|
| **Source** | [Scotese et al. Phanerozoic Köppen dataset](https://pmc.ncbi.nlm.nih.gov/articles/PMC9278035/); Westerhold 2020 CENOGRID for the Cenozoic; EPICA/Vostok ice cores for the last 800 kyr |
| **Access** | ⚠️ TBD per component — journal supplements, NOAA Paleo, PANGAEA |
| **Format** | mixed: gridded (Köppen) + CSV (CENOGRID, ice cores) |
| **Coverage** | stitched: 540 Ma → present, resolution improving toward the present |
| **Volume** | Köppen gridded ⚠️ VERIFY (est. 100s of MB); CSVs tiny |
| **Licence** | ⚠️ VERIFY per component |
| **Shape** | `RasterSequence` (Köppen) + `TimeSeries` (temp, sea level) |
| **Storage** | CSVs → git; gridded → R2 |

**Key challenge — stitching.** Three sources at wildly different resolutions covering
overlapping ranges. Needs an explicit, documented splice policy with crossfades at the
boundaries, not a naive concat. **Document the splice points in the source README** — this
is the kind of decision that becomes invisible and then wrong.

---

## `pbdb` — Fossil record and biodiversity

| | |
|---|---|
| **Source** | [Paleobiology Database](https://paleobiodb.org) |
| **Access** | Public REST API, no auth, generous limits |
| **Format** | JSON / CSV over HTTP |
| **Coverage** | Phanerozoic, ~540 Ma → present |
| **Volume** | full occurrence dump is large ⚠️ VERIFY; **we only need aggregates** |
| **Licence** | CC BY 4.0 |
| **Shape** | `TimeSeries` (genus count) + `EventSet` (first appearances, extinctions) |
| **Storage** | **git** — aggregates are small |

**Processing** — query aggregate diversity by stage rather than pulling occurrences. Derive
first-appearance dates for key clades (feeds `events-core` and the ancestor layer) and the
diversity curve with the Big Five extinctions marked.

⚠️ Cache aggressively — hitting the API on every build is rude and slow. Snapshot to raw,
checksum, and normalise from the snapshot.

---

## `timetree` — Divergence dates for the ancestor lineage

| | |
|---|---|
| **Source** | [TimeTree 5](http://timetree.temple.edu/resources) |
| **Access** | ⚠️ VERIFY — bulk downloads available on the resources page; may need a form |
| **Format** | Newick trees / CSV |
| **Coverage** | all life |
| **Volume** | full tree is large; **we need ~50 nodes** |
| **Licence** | ⚠️ VERIFY — academic use terms |
| **Shape** | `Tree` |
| **Storage** | **git** — our extracted subtree is a few KB |

**Processing** — this is *small*. Extract the ~50-node path from LUCA to *H. sapiens*, pick
a representative genus per node, attach divergence dates. Mostly a curation task, not an
engineering one. Cross-check against OneZoom / Open Tree of Life for topology.

**Integration** — the ancestor layer. `sample(t)` returns the deepest node with
`t_divergence ≥ t`. Each node also gets one generated portrait.

---

# Tier 3 — nice to have

| Source | Access | Shape | Notes |
|---|---|---|---|
| `paleocoastlines` | [Zenodo 4297693](https://zenodo.org/records/4297693), shapefiles | `RasterSequence` | Sharper coastlines than PaleoDEM thresholding. ⚠️ VERIFY overlap/conflict with `paleodem` |
| `ics-chart` | ICS chronostratigraphic chart, machine-readable | `EventSet` | Period/epoch boundaries for timeline chrome. Small, authoritative, easy |
| `craters` | Earth Impact Database | `EventSet` | Impact events as a timeline lane. Small |
| `magnetic` | Geomagnetic polarity timescale | `TimeSeries` | Reversals as a striped lane. Small, visually striking |
| `astronomy` | computed, not sourced | `TimeSeries` | Day length, Moon distance, solar luminosity, galactic orbit — all **analytic formulae**, no dataset needed. Cheapest layers in the project |

`astronomy` is worth calling out: day length, lunar recession and solar luminosity are all
closed-form approximations. No fetch, no storage, no licence. An afternoon's work for three
of the best layers.

The `seshat` placeholder this table previously listed here (`EventSet`, "⚠️ VERIFY licence —
has had restrictions") is superseded by `sources/cliopatria` (Tier 2, above) — the real
dataset is CC BY 4.0, not restricted, and its own natural shape is `RasterSequence` +
`FeatureSet` (territory and label anchors), not `EventSet`.

---

## Cross-cutting concerns

**Citation and credits.** Every `manifest.toml` carries `licence` and `citation`. A credits
page is generated from those manifests at build time. This is not optional — most of these
datasets are academic and citation is the price of use.

**Reproducibility.** `fetch.py` records a sha256 of what it downloaded into the manifest.
`make data` re-runs any source whose raw checksum or normaliser hash changed. A source whose
upstream URL has rotted must fail loudly, not silently serve stale data.

**Interpolation policy is per-source and explicit.** Linear, log-linear, step, or
nearest — declared in the manifest, not implied by the consumer. Getting this wrong produces
subtly wrong charts that nobody notices.

**Fixtures.** Every source commits a small *real* slice under `fixture/`. No test may
download a large file or hit a live API.

---

## Agent brief template

When dispatching one agent per source:

> Implement `sources/<name>/` per `docs/DATA_SOURCES.md`.
> 1. Resolve every `⚠️ VERIFY` and `⚠️ TBD` in that source's section; record findings in
>    `sources/<name>/README.md`.
> 2. Write `manifest.toml` with real url, sha256, licence, citation, measured volume.
> 3. Implement `fetch.py` and `normalise.py` emitting the declared curated shape.
> 4. Commit a small real fixture and a validator test that runs against it offline.
> 5. Report measured volume and recommend a storage tier per the storage policy.
>
> Do not change the curated shapes. Do not add a dependency without noting it in the README.
> If the source turns out to be unusable (licence, rot, volume), stop and report rather than
> substituting a different dataset.
