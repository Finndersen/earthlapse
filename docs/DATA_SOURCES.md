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

### The four curated shapes (NORMATIVE)

Every source normalises to exactly one of these. Adding a fifth requires an ADR.

| Shape | Fields | Used for |
|---|---|---|
| `TimeSeries` | `t, value, [uncertainty]` + interpolation policy | scalar layers, `WorldState` fields |
| `EventSet` | `t_min, t_max, label, importance, description, citation` | timeline events |
| `RasterSequence` | `t, georeferenced grid` | globe textures, gridded layers |
| `Tree` | `node, parent, t_divergence, label` | ancestor lineage |

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
| generated media | **git-lfs**: pinned images + `data/media/` | unpinned candidates stay local; `make pins` after pinning (ADR-018) |

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

## `co2-o2` — Phanerozoic atmospheric composition

Small, easy, and the ideal first layer for the vertical slice.

| | |
|---|---|
| **Source** | GEOCARBSULF / Berner; plus Foster et al. compilations |
| **Access** | **VERIFIED.** `https://www.ncei.noaa.gov/pub/data/paleo/climate_forcing/trace_gases/phanerozoic_co2.txt` (NOAA Paleo, plain HTTP, no auth) |
| **Format** | fixed-width text, long human-readable header, 58 rows |
| **Coverage** | 570 Ma → present, exactly 10 Myr spacing, no gaps |
| **Volume** | tiny — < 100 KB |
| **Licence** | US public domain (NOAA); cite Berner GEOCARB III / Royer |
| **Shape** | `TimeSeries` × 2 (CO₂ ppm, O₂ %) |
| **Storage** | **git**, committed parquet |

**Processing** — parse, unit-normalise, attach uncertainty envelopes (these proxies have
wide error bars and the chart should show them), define interpolation policy (linear in
log-CO₂ is probably right ⚠️ VERIFY).

**Integration** — `WorldState.atmosphere`; two HUD sparklines; drives sky haze and colour in
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
`t_min`/`t_max` and a citation.

⚠️ **Do not let an LLM be the source of truth for dates.** It drafts and normalises; the
citation is what makes a date real. Cross-check deep-time dates against the ICS chart and
PBDB.

---

# Tier 2 — needed for the full experience

## `hyde` — Population and land use

The sleeper. Gridded, so it animates civilisation spreading across the globe from real data.

| | |
|---|---|
| **Source** | [HYDE 3.3, PBL Netherlands](https://www.pbl.nl/en/image/links/hyde) |
| **Access** | Direct download from PBL; also mirrored on Kaggle |
| **Format** | ASCII grid / netCDF, gridded at 5 arcmin |
| **Coverage** | 10,000 BC → present, sub-millennial early then decadal |
| **Volume** | ⚠️ VERIFY — **large**, plausibly several GB for the full gridded set |
| **Licence** | ⚠️ VERIFY — believed CC BY, confirm on PBL site |
| **Shape** | `RasterSequence` (gridded) + `TimeSeries` (global population total) |
| **Storage** | raw not committed; **derived low-res textures → R2**; global total → git |

**Processing** — heavy downsampling is essential. We do not need 5 arcmin for a corner
globe. Extract: (a) global population as a `TimeSeries` for the HUD, (b) heavily downsampled
cropland/pasture/population-density grids as globe overlay textures.

⚠️ **Scope risk:** it is easy to spend a week here. The global total alone is a day's work
and delivers most of the value. Do that first, treat the gridded overlay as a stretch.

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
| `seshat` | Seshat Databank, CSV/API | `EventSet` | Polities and civilisations. ⚠️ VERIFY licence — has had restrictions |
| `craters` | Earth Impact Database | `EventSet` | Impact events as a timeline lane. Small |
| `magnetic` | Geomagnetic polarity timescale | `TimeSeries` | Reversals as a striped lane. Small, visually striking |
| `astronomy` | computed, not sourced | `TimeSeries` | Day length, Moon distance, solar luminosity, galactic orbit — all **analytic formulae**, no dataset needed. Cheapest layers in the project |

`astronomy` is worth calling out: day length, lunar recession and solar luminosity are all
closed-form approximations. No fetch, no storage, no licence. An afternoon's work for three
of the best layers.

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
