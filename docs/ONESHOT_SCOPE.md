# One-Shot MVP Scope

The goal of the first build round: **a deployed page showing Earth's history as ~14
photoreal stills dissolving across 4.6 billion years, with a live paleogeographic globe, a
scrubbable warped timeline of ~30 events, and three data layers — all driven by one time
cursor.**

Concretely, when it's done you open a URL and see a large image of the Archean shore. You
drag the timeline and the image dissolves forward through the Cambrian seafloor, the
Carboniferous swamp, the Cretaceous forest, into a city. A globe in the corner shows the
continents assembling and rifting as you drag. A CO₂ sparkline, a day-length readout and
"your ancestor at this moment" update continuously. You press play and it moves on its own,
faster or slower. You hit the linear-scale toggle and all of human history collapses to
nothing.

That is the whole target. Everything below serves it.

---

## What's in

| | |
|---|---|
| **Scenes** | ~14 generated photoreal stills, one per chapter, depth-free cross-dissolve |
| **Globe** | three.js sphere, land/sea + elevation from PaleoDEM, blended between epochs |
| **Timeline** | symlog scale + true-linear toggle, zoom with importance LOD, scrub, play, speed |
| **Events** | ~30 curated events with real uncertainty intervals and citations |
| **Layers** | CO₂ (sparkline + chart), day length, ancestor-at-`t` |
| **Data sources** | `co2-o2`, `paleodem`, `astronomy`, `events-core`, `lineage` |
| **Deploy** | Cloudflare Pages, static, media on R2 or committed if small enough |

## What's explicitly out — and why that's fine

| Cut | Why |
|---|---|
| **2.5D parallax** | ADR-009. Drops the depth dependency and the wide-vista risk. Drop-in later. |
| **`gplately`** | **PaleoDEM rasters are already reconstructed — they *are* the globe.** gplately buys paleo-coordinates and finer time resolution; v1 needs neither. Install risk is resolved (see DATA_SOURCES) so this is a scope call, not a blocker. |
| **Generated video** | ADR-001. |
| **`hyde`, `pbdb`, `paleoclimate`, `seshat`** | Each is a real day of work for one more layer. The MVP proves the layer *mechanism* with three; the fourth through tenth are mechanical afterwards. |
| **Audio** | Cheap and high-impact, but pure addition. First fast-follow. |
| **Density timeline scale** | symlog + linear is enough to prove the warp. |
| **On-demand generation** | v2 (DESIGN §15). |
| **Review UI** | The candidate picker is a CLI listing in v1, not a web app. |

## Data sources for the MVP

Three have already been investigated by earlier agents; their findings are in
[`DATA_SOURCES.md`](./DATA_SOURCES.md) and are a **head start, not a substitute** for the
implementing agent verifying as it goes.

| Source | Shape | Access | Volume | Licence | Effort | Status |
|---|---|---|---|---|---|---|
| `co2-o2` | TimeSeries ×1 | [NOAA phanerozoic_co2.txt](https://www.ncei.noaa.gov/pub/data/paleo/climate_forcing/trace_gases/phanerozoic_co2.txt) | < 100 KB | public domain (NOAA) | 1.5 h | investigated ✅ |
| `paleodem` | RasterSequence | [Zenodo 5460860](https://zenodo.org/records/5460860), 1° netCDF file only | 9.3 MB zipped | CC BY 4.0 verified | 3 h | investigated ✅ |
| `astronomy` | TimeSeries ×3 | **no download** — closed-form formulae | 0 | n/a | 2 h | to investigate |
| `events-core` | EventSet | Wikidata SPARQL + ICS chart + curation | < 1 MB | CC0 / CC BY-SA | 4 h | to investigate |
| `lineage` | Tree | TimeTree 5 / Open Tree of Life | few KB | check | 3 h | to investigate |

**Two traps already found, do not rediscover them:**

- `co2-o2` column 2 is `RCO2`, a **dimensionless ratio, not ppm**. `co2_ppm = RCO2 * 280`.
  Getting this wrong is off by 280× and still looks plausible. Column 1 is **negative Ma**.
  Range check: min 0.988 @ 0 Ma, max 26.18 @ 520 Ma. No uncertainty column — leave it `None`
  rather than inventing a band. Coverage stops at 5.7e8 BP, which is 12.4% of the timeline;
  `WorldState` must return absent beyond it.
- `paleodem` — the record is 414 MB across 6 files but **only
  `Scotese_Wright_2018_Maps_1-88_1degX1deg_PaleoDEMS_nc.zip` (9.3 MB) is needed.** Variable
  `z`, dims (lat 181, lon 361), float32 metres, EPSG:4326 node-registered. Data range
  −11,000 to +10,500 m, so int16 repack is lossless.

## The event set

~30 events, deliberately uneven density — clustered toward the present because that is the
real distribution. Every event needs `t_min`/`t_max` (a real interval, not a point),
`importance` 0..1 driving zoom LOD, and a citation.

Minimum coverage: Earth formation · Moon-forming impact · first life · Great Oxidation ·
Snowball Earth · Ediacaran · Cambrian explosion · land plants · insects · tetrapods ·
amniotes · Permian extinction · dinosaurs · flowering plants · K-Pg impact · primates ·
hominins · agriculture · writing · industrial revolution · present.

⚠️ **Do not let an LLM be the source of truth for dates.** It drafts and normalises; the
citation makes a date real. Cross-check stratigraphic boundaries against the ICS chart and
first appearances against PBDB. Flag anything contested rather than picking a number.

## The ancestor lineage

~40 nodes from LUCA to *Homo sapiens*: node id, parent, label, representative organism,
divergence date, citation. This is a **path**, not a phylogeny — a curation task more than an
engineering one. `Tree.sample(t)` already implements the lookup.

v1 renders it as **text only** (label + representative + date). Portraits are a fast-follow;
10 of them for the major nodes costs about $1.50 and can land the same week.

## Scenes and budget

14 chapters, one final still each, plus ~10 optional ancestor portraits.

| Item | Count | Unit | Cost |
|---|---|---|---|
| Draft/composition iteration (cheap model) | ~56 | $0.02 | $1.12 |
| Final scenes (premium, 3 candidates each) | ~42 | $0.10 | $4.20 |
| Ancestor portraits (optional) | ~30 | $0.05 | $1.50 |
| **MVP total** | | | **~$7** |

Ceiling for the whole one-shot: **`--max-spend 25`**. That leaves 3× headroom for iteration
and keeps $75 of the project's $100 for later rounds. The ledger enforces it
(`pipeline/spend.py`); **no agent may raise it**.

## The serial spine — ALREADY BUILT

This is the part that normally sinks a one-shot fan-out, and it is done and committed. Agents
**import these; they do not reinvent or modify them.**

```
pipeline/shapes.py     TimeSeries · EventSet · RasterSequence · Tree, sampling, sort invariant
pipeline/models.py     WorldState, WorldModel.at(t), diff()
pipeline/graph.py      AssetNode, digest propagation, Pin, Resolver, Status
pipeline/spend.py      Ledger, BudgetExceeded, hard ceiling
web/src/types/layer.ts    Layer, LayerValue, TimeScale, Playback
web/src/types/manifest.ts Manifest, Scene, Chapter, LayerManifest, Credit
tests/test_contracts.py   18 tests, offline, no fixtures
```

**Run `pytest tests/test_contracts.py` first. If it fails, stop — the ground has moved.**

Changing any of these requires an ADR in `DECISIONS.md`, proposed and agreed, not edited in
passing. If a contract genuinely blocks you, **stop and report** rather than working around
it — a local workaround becomes an incompatibility with five other agents.

## Work packages

Every package's verification is a runnable command. "It renders" is not a verification.

| id | package | deliverable | verification | depends on | parallel-safe |
|---|---|---|---|---|---|
| **W1** | `sources/co2-o2` | fetch + normalise → TimeSeries, fixture | `pytest tests/sources/test_co2.py` — asserts RCO2→ppm conversion and the two range checkpoints | spine | ✅ |
| **W2** | `sources/paleodem` | fetch + normalise → RasterSequence, ~12 epoch textures | `pytest tests/sources/test_paleodem.py` — grid dims 181×361, land fraction at 0 Ma ≈ 0.29 | spine | ✅ |
| **W3** | `sources/astronomy` | 4 analytic TimeSeries, no download | `pytest tests/sources/test_astronomy.py` — day length @ 600 Ma ≈ 21–22 h, solar luminosity @ 4 Ga ≈ 0.75 | spine | ✅ |
| **W4** | `sources/events-core` | `data/events.yaml`, ~30 events | `pytest tests/sources/test_events.py` — every event has citation, `t_min ≤ t_max`, importance in 0..1, ≥ 20 events, spans > 4e9 | spine | ✅ |
| **W5** | `sources/lineage` | `data/lineage.yaml`, ~40 nodes | `pytest tests/sources/test_lineage.py` — parents resolve, dates monotonic, path LUCA→human intact | spine | ✅ |
| **W6** | `pipeline/generators` + prompt renderer + `earthtime` CLI | Generator protocol impls, prompt templates from WorldState, `plan`/`build`/`review`/`publish` | `pytest tests/test_pipeline.py` + `earthtime plan` prints a cost estimate without spending | spine | ✅ |
| **W7** | `web/timeline` | warped scale, LOD, scrub, play, speed, linear toggle | `pnpm test timeline` — `toUnit`/`fromUnit` round-trip to 1e-6 across the full domain; LOD drops low-importance events when zoomed out | spine | ✅ |
| **W8** | `web/globe` | three.js sphere, texture blending | `pnpm test globe` — samples correct blend pair and alpha at 5 known `t` values | spine, W2 shape only | ✅ |
| **W9** | `web/scene` | still display + depth-free cross-dissolve | `pnpm test scene` — correct scene pair and dissolve factor at chapter boundaries | spine | ✅ |
| **W10** | `web/layers` | HUD sparkline, expandable chart, ancestor readout | `pnpm test layers` — each layer's `sample()` is pure and returns null outside its domain | spine, W7 | ⚠️ after W7 |
| **W11** | `web` shell | layout, manifest loading, zustand `t` store, vignette | `pnpm build` succeeds; page renders against a stub manifest | spine | ✅ |
| **W12** | integration + deploy | real manifest, generated scenes, Cloudflare Pages | the Definition of Done checklist below | all | ❌ serial |

**Ownership is strict.** Each package owns its directory and writes nowhere else. If W7 needs
a change in `web/src/types/layer.ts`, that is an ADR, not an edit.

## Execution shape

```
   [ contracts already committed — verify with pytest, do not rebuild ]
                              │
        ┌────────┬────────┬───┴────┬────────┬────────┬────────┬────────┐
       W1       W2       W3       W4       W5       W6       W7      W11     ← fan out
        │        │        │        │        │        │        │        │
        └────────┴────────┴────────┴────────┴────────┴───┬────┴───┬────┘
                                            W8 ──────────┘        │
                                            W9 ───────────────────┤
                                            W10 ──────────────────┘
                                                     │
                                                    W12                      ← serial
```

Eight packages fan out immediately; W8/W9/W10 join as their prerequisites land; W12 is one
serial integration pass. Roughly **12 agents**, worktree-isolated where they touch shared
directories.

Each data-source agent does **investigate → implement → validate in one context**. Do not
split investigation from implementation: the handoff loses detail, and the agent that read
the file header is the one that should write the parser.

## Definition of done

A five-minute checklist. Every line must pass.

- [ ] `pytest` — all tests green, offline, no network
- [ ] `pnpm build` succeeds with no type errors
- [ ] `earthtime plan` prints a cost estimate and spends nothing
- [ ] `earthtime build --max-spend 25` completes; ledger total under $25
- [ ] `data/events.yaml` has ≥ 20 events, every one with a citation and `t_min ≤ t_max`
- [ ] `data/lineage.yaml` resolves LUCA → *Homo sapiens* with no orphan parents
- [ ] The deployed page loads and shows a scene image
- [ ] Dragging the timeline dissolves between scenes without flashing white or black
- [ ] The globe changes visibly between 400 Ma and 100 Ma
- [ ] The CO₂ readout shows ~280 ppm at `t=0` — **if it shows ~1.0, the RCO2 conversion was missed**
- [ ] The CO₂ layer renders as *absent*, not zero, before 540 Ma
- [ ] The ancestor readout changes at least 5 times across a full scrub
- [ ] Play works; the speed control changes the rate; nothing crashes at either extreme
- [ ] The linear-scale toggle animates and collapses human history to sub-pixel
- [ ] A credits page lists every source with its licence and citation

## Deliberately stubbed

These are expected to be missing. Do not "fix" them.

- Depth maps — `Scene.depth` is in the manifest schema but unpopulated (ADR-009)
- Review UI — CLI listing, not a web app
- Audio — silent
- Layers beyond the three named
- Density timeline scale
- Chapter anchor conditioning — v1 may generate scenes from the style spec alone if
  anchor-conditioning proves fiddly; note it and move on

## Budget

**`--max-spend 25`**, enforced in `pipeline/spend.py`. Expected actual ~$7. No agent may
raise the ceiling; if a build hits it, stop and report.
