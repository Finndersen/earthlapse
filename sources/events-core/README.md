# Source: events-core

The curated event set behind the scrubbable timeline. 65 events, `EventSet` id
`"events-core"`. **Hand-curated — `data/events.yaml` is the source of truth, not derived
data.** See its header comment for the full time convention.

## Schema

`data/events.yaml` is a YAML document with one top-level key, `events`, a list of records:

| Field | Type | Meaning |
|---|---|---|
| `id` | str | stable slug, unique |
| `label` | str | short display name |
| `t_min` | float | years BP, **nearer the present** |
| `t_max` | float | years BP, **further into the past** |
| `importance` | float, 0..1 | drives zoom LOD (planetary milestones ~0.9-1, minor ~0.3-0.5) |
| `description` | str | 1-2 sentences; says "contested" explicitly where the date is disputed |
| `citation` | str | a specific, checkable source — author/year/venue, or the ICS chart with its boundary age |

`normalise.py` parses this directly into `pipeline.shapes.Event`/`EventSet`, which is where
`t_min <= t_max` and `0 <= importance <= 1` are actually enforced (pydantic validators) — the
YAML itself carries no schema enforcement beyond being well-formed.

## The present-day reference year

Deep-time dates (radiometric, biostratigraphic) are already expressed as years-before-present
and need no conversion. Historical dates (agriculture onward) are calendar dates, and had to
be converted to the same `GeoTime` axis (`t`, years BP, present = 0). Per the work-package
brief for this source, that conversion uses a **fixed** reference year rather than the actual
run date:

```
t = 2025 - CE_year          (a BCE year is negative: 3400 BCE -> CE_year = -3400)
```

This is deliberate: if `t` were computed against the pipeline's run date, `data/events.yaml`
(and the derived parquet) would silently drift by one unit of `t` every time the pipeline is
rebuilt on a later real-world date, even though nothing about the underlying scholarship
changed. Pinning the reference year makes the file's numbers stable and reviewable. It also
means the `industrial-revolution`, `writing`, `agriculture`, `moon-landing` and `present`
events are *not* exactly "years before today" once enough real time has passed — the drift is
small (single-digit years) relative to every interval in this file, so it doesn't matter for
the timeline's purpose, but it is worth knowing it exists.

## Verification method

Every date was checked against its cited source with WebSearch, not asserted from model
knowledge (per the hard rule: an LLM must not be the source of truth for dates). Stratigraphic
boundaries (Cambrian base, Ediacaran top, Cryogenian bounds, Permian-Triassic boundary,
K-Pg boundary) are checked against the **ICS International Chronostratigraphic Chart v2024/12**
(`stratigraphy.org/ICSchart/ChronostratChart2024-12.pdf`), fetched by `fetch.py` and hashed in
`manifest.toml`. First-appearance dates for clades use the primary literature that established
them (with DOI/journal where available) rather than PBDB directly — PBDB's occurrence API
returns raw specimen records, not a curated "first appearance" figure, so for a ~30-event
set the primary paper for each landmark specimen is the more precise and more easily
spot-checked citation. This is noted here as a deliberate deviation from "PBDB or primary
literature" in favour of the primary-literature half of that instruction.

The 16 events added under ADR-014 were verified the same way in spirit — against a citable
primary source, never from model memory — but by a different mechanism: live web search was
unavailable for that work (its session-wide budget had already been spent by other concurrent
work before this file was touched), so each date and citation was instead verified by fetching
the actual source page (an encyclopaedia summary in most cases) and cross-checking the primary
citation it names, rather than by search. Two citations in that batch carry narrower
verification than the rest, flagged as such in their own comment in `data/events.yaml`:
`first-seed-plants`' full bibliographic detail (journal, volume, pages) for Rothwell et al.
1989 was reconstructed from training knowledge and only partially confirmed live (the author
and year were); `gymnosperm-radiation`'s Looy & Duijnstee (2020) citation likewise lacks a
live-confirmed journal and volume.

**Contested dates** get a wide `t_min`/`t_max` interval and the word "contested" (or an
explanation of the disagreement) in the description, rather than a single invented number.
Contested in this file: `moon-forming-impact` (4.35 vs 4.51-4.52 Ga), `first-life` (3.4 vs
4.1 Ga), `origin-of-photosynthesis` (2.0 vs disputed ~3.4 Ga biomarker claims),
`eukaryotes-origin` (1.6 vs 2.1 Ga), `insects` (possible myriapod misidentification),
`amniotes` (318-307 Ma uncontroversial vs a 2025 claim pushing crown Amniota to ~358.9-354 Ma),
`dinosaurs` (231 vs 243 Ma), `flowering-plants` (undisputed ~130 Ma vs a disputed Triassic
pollen claim), `earliest-pollinating-insects` (Melittosphex burmensis, originally described as
the oldest bee, now reassessed as an aculeate wasp of uncertain position), `primates` (stem vs
crown), `hominins` (contested classification), `control-of-fire` (sporadic vs habitual use
span over 1 Myr), and `k-pg-aftermath` (the fern spike's own duration is not precisely
bounded, so the scene's interval is kept deliberately narrow and conservative). Also contested, among the 19
events added for the Cenozoic scene work package: `india-asia-collision` (59-34 Ma, one of
the most debated timing questions in Earth science), `antarctic-circumpolar-current` (34 Ma
classic view vs a 2023 study arguing for the late Miocene), `isthmus-of-panama` (~2.8 Ma
final closure vs biological evidence for a complex emergence up to ~10 Ma earlier),
`messinian-salinity-crisis` (well-dated onset and end, but how dry the basin got and how
catastrophic the refill was remain disputed), and `toba-eruption` (well-dated eruption, but
its "volcanic winter" severity and effect on contemporary humans is heavily contested and
increasingly doubted).

## Event selection and density

The 21 minimum-coverage topics from the work-package brief are all present, each as its own
event with a matching id (`earth-formation`, `moon-forming-impact`, `first-life`,
`great-oxidation-event`, `snowball-earth`, `ediacaran-biota`, `cambrian-explosion`,
`land-plants`, `insects`, `tetrapods`, `amniotes`, `permian-extinction`, `dinosaurs`,
`flowering-plants`, `k-pg-impact`, `primates`, `hominins`, `agriculture`, `writing`,
`industrial-revolution`, `present`). Nine more filled out the original set to 30 and produce
the deliberately uneven, present-clustered density the brief asked for:
`eukaryotes-origin`, `multicellularity-sexual-reproduction`, `mammals-origin`, `birds-origin`
(deep-time, filling the life-to-dinosaurs gap), and `homo-sapiens-origin`,
`out-of-africa-migration`, `control-of-fire`, `last-glacial-maximum`, `moon-landing` (all
within the last ~1.5 Myr, where density is highest). `last-glacial-maximum` was added after
the first browser review so the ice-age scene (t = 20 ka) has a matching event.

A further 16 events were added under ADR-014, ahead of a richer set of deep-time scene specs
(`data/scenes-draft-deep.yaml`, older than 66 Ma) so each new scene has a matching event to
anchor to: `origin-of-photosynthesis`, `banded-iron-formations`, `first-seaweeds`,
`great-ordovician-biodiversification`, `end-ordovician-extinction`, `first-forests`,
`first-seed-plants`, `late-devonian-extinction`, `carboniferous-rainforest-collapse`,
`gymnosperm-radiation`, `siberian-traps`, `end-triassic-extinction`,
`earliest-pollinating-insects`, `angiosperm-radiation`, `deccan-traps`, `k-pg-aftermath`.
Three topics from that same work-package brief were deliberately *not* added as new events,
because an existing event already covers the same ground with a citation that already
supports the claim: "first eukaryotic algae" (`eukaryotes-origin`'s own citation, Bengtson et
al. 2017, already describes 1.6 Ga crown-group red algae), "first vascular plants"
(`land-plants`'s upper bound is already Cooksonia, ~425 Ma), and "first flowers"
(`flowering-plants`, already present).

A further 19 events were added by the "get the foundation right" Cenozoic scene work package
(human-directed 2026-09-13, ADR-014), bringing the total to 65 and filling what had been the
single largest gap in the set: 56 Ma (`primates`) to 6 Ma (`hominins`) held only two events
across 50 Myr, and 6 Ma to 400 ka (`control-of-fire`) held none at all. All 19 sit strictly
inside that same 66 Ma-present range this source already covers, in time order:
`paleocene-mammal-radiation`, `petm`, `india-asia-collision`, `eocene-oligocene-transition`,
`antarctic-circumpolar-current`, `grassland-spread`, `hipparion-dispersal`, `c4-expansion`,
`isthmus-of-panama`, `messinian-salinity-crisis`, `lomekwi-stone-tools`,
`australopithecus-afarensis`, `quaternary-glaciation-begins`, `homo-erectus`,
`acheulean-technology`, `toba-eruption`, `earliest-cave-art`, `neanderthal-sapiens-overlap`,
`younger-dryas`. Ten of these back a matching new scene in `data/scenes-draft-cenozoic.yaml`
(not yet merged into `data/scenes.yaml`); the other nine (`india-asia-collision`,
`antarctic-circumpolar-current`, `hipparion-dispersal`, `isthmus-of-panama`,
`lomekwi-stone-tools`, `quaternary-glaciation-begins`, `toba-eruption`, `earliest-cave-art`,
`younger-dryas`) stand alone, either because no single vantage suits them (a plate-tectonic
process, an ocean current) or because this work package judged a dedicated scene redundant
with a neighbouring one (see the work-package report for the reasoning per event). One
citation in this batch is weaker than the rest and is flagged inline in
`paleocene-mammal-radiation`'s own citation field: its Pantolambda detail rests on a
paraphrased Wikipedia summary rather than primary literature, the one point in this batch
where the session's WebSearch budget ran out before a stronger source could be found. Five
topics named in that work package's brief — domestication of dogs, first cities, the Bronze
Age, the start of the Holocene, and a broad "megafauna extinctions" event distinct from
`younger-dryas` — were **not** added: the session's WebSearch budget (a session-wide cap
shared across concurrent agents) was exhausted before they could be verified, and per this
project's "verify, don't assert from memory" rule they were left out rather than guessed.
They remain open follow-up work, not a judgement that they don't belong.

## Gotchas

- **`t_min`/`t_max` is not always "measurement uncertainty about one moment."** For a few
  events (`ediacaran-biota`, `snowball-earth`) it is the fossil/geological record's known
  *span* — e.g. Ediacara biota are known from ~571 Ma to the end of the Ediacaran at 538.8 Ma.
  The description says so explicitly in each case; don't assume every interval is a plus/minus
  error bar.
- **`Event.t` (the midpoint property in `pipeline/shapes.py`) is for placement only.** Never
  present it as "the date" in the UI — several of these midpoints (e.g. `ediacaran-biota`,
  `control-of-fire`) fall in the middle of a real span or a genuine scientific disagreement,
  not at a meaningful instant.
- **`EventSet.domain` is `(events[0].t_min, events[-1].t_max)` after sorting by midpoint**
  (see `pipeline/shapes.py`). Because `present` has the smallest midpoint and
  `earth-formation` the largest, this works out to `(0.0, 4.59e9)` here, but that is a property
  of this specific event set, not a guarantee — a future event with a very wide interval could
  make the true min/max span wider than `domain` reports if it weren't also the extremal
  midpoint. Not an issue today; flagged for whoever next edits this file.
- **YAML scientific notation.** PyYAML's default (non-safe-adjacent) float regex requires a
  sign or digit immediately around the exponent — `4.49e9` parses fine, but if you ever write
  something like `4.49E+9` by hand, double-check it still parses as a float rather than a
  string. All values in this file were written to parse cleanly with `yaml.safe_load`, and the
  test suite would catch a regression (`Event.t_min` is a pydantic `float`, so a str would
  fail validation loudly rather than silently).
- **`interpolation` in `manifest.toml` is `"n/a"`.** `EventSet` has no interpolation policy —
  it's discrete events, not a continuously sampled series — but the manifest schema (shared
  across all four curated shapes) requires the field to be present.

## Measured volume

`data/curated/events-core.parquet`: **25,921 bytes** (25.3 KB) for 46 events, regenerated from
the current `data/events.yaml` via `normalise.main()`. `data/events.yaml` itself (the actual
source of truth, git-tracked separately): **36,672 bytes** (35.8 KB).

## Storage tier chosen

**git.** Far under the 5 MB threshold for the git tier (`docs/DATA_SOURCES.md` storage
policy). `data/events.yaml` is committed as source (not gitignored, unlike `data/raw/`),
consistent with its "this is source, not derived data" status in `docs/DATA_SOURCES.md`.

## Licensing note

Per `docs/DATA_SOURCES.md`, this source's licence is a mix:

- **Wikidata (CC0).** The work-package brief allows an optional Wikidata SPARQL pass to
  generate a candidate pool of events. That pass was **not used** for this build — all 29
  events were selected and dated directly against primary literature and the ICS chart, which
  gives more precise and more easily verified citations than a SPARQL "point in time" query
  would for a curated set this small. `fetch.py` therefore does not query Wikidata. If a future
  agent adds a Wikidata-sourced candidate pool, it inherits Wikidata's **CC0** dedication.
- **ICS International Chronostratigraphic Chart.** Used as the boundary-age reference for
  every stratigraphic-boundary event. The chart is **not CC-licensed** — ICS's own terms
  (`stratigraphy.org/ICSchart/Permissions_ICS_2017_v2.pdf`) grant free use for research,
  education and non-commercial reproduction, provided the chart is not modified beyond
  resizing and its copyright notice is retained. This project only cites specific boundary
  ages from it (in `data/events.yaml`'s citation fields) and keeps a local copy in
  `data/raw/events-core/` for reference; it does not redistribute or embed the chart image
  itself anywhere in `web/` or the published site.
- **Per-event literature citations.** Each event's own citation (Nature, Science, PNAS, PLOS,
  etc. papers) retains that publisher's copyright. `data/events.yaml`'s descriptions are
  original paraphrase, not copied text, consistent with the "paraphrase, don't copy" rule for
  Wikipedia-adjacent sourcing in `docs/DATA_SOURCES.md`.
