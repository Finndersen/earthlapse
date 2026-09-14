# Source: globe-regimes

The pre-1 Ga globe caption set (docs/GLOBE.md §4.2, §6). 5 events, `EventSet` id
`"globe-regimes"`. **Hand-curated — `data/globe_regimes.yaml` is the source of truth, not
derived data**, exactly like `events-core` (see `sources/events-core/README.md`).

## Why a separate source from events-core

`events-core` and `globe-regimes` are both `EventSet`s (DATA_SOURCES § Contract's four
curated shapes), but they serve different consumers with non-overlapping citations:

- `events-core` is the timeline's spine — every event there is meant to be listed and
  scrubbed to (`pipeline/publish.py`'s `_events()` feeds `Manifest.events` directly).
- `globe-regimes` exists only so the globe (DESIGN §7) has something to caption before any
  plate reconstruction exists (older than the Merdith et al. 2021 model's 1 Ga start,
  docs/GLOBE.md §4.1-§4.2). It is **never** listed on the timeline: `pipeline/publish.py`
  publishes it as an ordinary `dataKind: "events"` layer (`EVENT_LAYERS` /
  `GLOBE_REGIMES_ID`), not through `Manifest.events`.

A single merged file would force one set of curation rules (timeline importance, LOD) onto
data that doesn't need them, and would mix two different regions of the citation graph
(landmark biological/geological events vs. pre-plate-tectonic regime boundaries). Splitting
by directory keeps each `README.md` scoped to what its own citations actually cover — the
same reasoning DATA_SOURCES.md applies to every other source.

## Schema

Identical to `events-core`'s (`sources/events-core/README.md`'s own table), plus the
additive `effect` field every event here uses (docs/GLOBE.md §6, `pipeline.shapes.Event`):

| Field | Type | Meaning |
|---|---|---|
| `id` | str | stable slug, unique |
| `label` | str | short caption text |
| `t_min` | float | years BP, **nearer the present** |
| `t_max` | float | years BP, **further into the past** |
| `importance` | float, 0..1 | required by `Event`, but inert here — `globe-regimes` is never zoom-LOD filtered since it isn't on the timeline |
| `description` | str | 1-3 sentences; says "contested" explicitly where the date or extent is disputed |
| `citation` | str | a specific, checkable source |
| `effect` | object | `{kind, anchor?, windows: [{t_min, t_max}, ...]}` — see `pipeline.shapes.GlobeEffect`. Every regime here carries one, since a regime's whole reason for existing is its globe visual |

`normalise.py` parses this directly into `pipeline.shapes.Event`/`EventSet`, which is where
`t_min <= t_max` and `0 <= importance <= 1` are actually enforced (pydantic validators) — the
YAML itself carries no schema enforcement beyond being well-formed. Exactly mirrors
`sources/events-core/normalise.py`.

## The five regimes

Straight from docs/GLOBE.md §4.2's table, each given a matching `id` and `effect.kind`:

| `id` | Interval | `effect.kind` | Citation |
|---|---|---|---|
| `magma-ocean-regime` | 4.35-4.52 Ga | `regime-magma-ocean` | Barboni et al. 2017; Thiemens et al. 2019; contested by Nimmo, Kleine & Morbidelli 2024 |
| `hadean-water-world-regime` | 4.0-4.4 Ga | `regime-water-world` | Wilde et al. 2001 |
| `archean-haze-regime` | 2.4-4.0 Ga | `regime-archean` | Lyons, Reinhard & Planavsky 2014; Zerkle et al. 2012 (haze episodes, contested) |
| `paleoproterozoic-glaciation-regime` | 2.426-2.46 Ga | `ice-shell` | Gumsley et al. 2017 — global extent **contested**, unlike the Cryogenian glaciations |
| `proterozoic-unknown-geography-regime` | 1.0-2.4 Ga | `regime-unknown-geography` | Merdith et al. 2021 (model start); Gumsley et al. 2017 (GOE onset bounds the older edge) |

`magma-ocean-regime`'s date range intentionally matches `events-core`'s `moon-forming-impact`
event exactly (4.35-4.52 Ga): both describe the same contested dating question, one as a
timeline moment (the impact itself), the other as the globe's background state afterward
(the cooling crust and close Moon). This is not duplication — they are different consumers
of the same underlying dispute, one a point event, one a regime — but a reader should know it
is deliberate, not an oversight.

`paleoproterozoic-glaciation-regime` uses the `ice-shell` effect kind, not a `regime-*` kind,
per docs/GLOBE.md §4.2: "ice shell, same effect as §4.3" (Snowball Earth). Its
`t_min`/`t_max` covers only the onset dating uncertainty (2.426-2.46 Ga) — Gumsley et al.
2017 dates the glaciation's *onset*, not a termination, so no duration is asserted here that
the citation doesn't support.

## Verification method

Every date and citation was checked against the primary literature already cited in
docs/GLOBE.md §4.2 and §References, which that document's own author had verified while
researching the globe design — this source re-derives the `EventSet` records from those
citations rather than re-verifying them independently. Per this project's "an LLM must not
be the source of truth for dates" rule, no date here is invented or estimated from model
knowledge; every `t_min`/`t_max` traces to a specific paper cited in this file.

## Gotchas

- **`importance` is inert.** Every other `EventSet` (`events-core`) uses it to drive timeline
  zoom LOD (`EventSet.window`'s `min_importance` filter). `globe-regimes` is never fed
  through that path — it publishes as a globe layer, not a timeline one — but `Event`
  requires the field regardless, so a value is still supplied (`0.5`-`0.9`, mirroring
  `events-core`'s own scale for comparable events).
- **Soft boundaries are a rendering instruction, not a data one.** docs/GLOBE.md §4.2: "The
  boundaries between regimes are deliberately soft: long crossfades, never a hard switch."
  This file's `t_min`/`t_max` values are still hard numbers — the crossfade is the globe
  renderer's job (G7/G8), reading these intervals the same way it reads any other effect
  window.
- **`EventSet.domain` and this source's `time_domain`.** `EventSet.domain` in
  `pipeline/shapes.py` is `(events[0].t_min, events[-1].t_max)` after sorting by midpoint;
  for this file that happens to be `(1.0e9, 4.52e9)`, matching `manifest.toml`'s
  `time_domain`. See `sources/events-core/README.md`'s own note on why this is a property of
  this specific set, not a general guarantee.

## Measured volume

`data/curated/globe-regimes.parquet`: see `manifest.toml`'s `volume_bytes` (measured, not
estimated, via `normalise.main()` against the current `data/globe_regimes.yaml`).
`data/globe_regimes.yaml` itself (the source of truth, git-tracked separately) is a few KB.

## Storage tier chosen

**git.** Far under the 5 MB threshold for the git tier (`docs/DATA_SOURCES.md` storage
policy). `data/globe_regimes.yaml` is committed as source (not gitignored, unlike
`data/raw/`), consistent with its "this is source, not derived data" status, exactly like
`data/events.yaml`.

## Licensing note

No dataset is redistributed. Every regime interval is hand-curated directly into
`data/globe_regimes.yaml` from the primary literature cited above and in the file itself;
each citation retains its own publisher's copyright, and the descriptions here are original
paraphrase, not copied text (same "paraphrase, don't copy" rule as `events-core`).
