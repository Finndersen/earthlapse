# Source: cliopatria

Historical empire territory, 3400 BCE – 1900 CE (curated domain; the raw dataset itself runs to
2024 CE — see "Domain cutoff: 1900 CE"): the hand-picked lineages of `roster.toml` (ADR-059),
each over its full lifespan, as a `FeatureSet` of territory snapshots (id `cliopatria_polities`:
label anchor, area, half-open time span) plus one content-hashed geometry file of their
simplified polygons (`data/media/vectors/cliopatria_territories-<hash>.json`). Published as the
`empires` layer (`dataKind: "territories"`), drawn on the globe under the "Human civilisation"
legend row.

## Licence and access

**Cliopatria** — Seshat Global History Databank / Complexity Science Hub Vienna / Alan Turing
Institute / Oxford. Repo: `github.com/Seshat-Global-History-Databank/cliopatria`. Zenodo
record [10.5281/zenodo.13363121](https://doi.org/10.5281/zenodo.13363121) (v0.0.1, published
2024-08-22, creators Chalstrey/Bennett/Mutch). Paper: Bennett, J. et al., "Cliopatria: a
geospatial dataset of world historical polities", SocArXiv preprint osf.io/24wd6.

**Licence: CC BY 4.0 — confirmed two ways, not assumed from the task brief:**

1. The Zenodo record's own metadata: `"license": {"id": "cc-by-4.0"}` (fetched directly via
   the Zenodo REST API, `api.figshare.com`-style verification `sources/cities` already sets
   precedent for).
2. The repository's own committed `LICENSE.md`, unzipped and read directly: *"This data is
   licensed under a Creative Commons Attribution 4.0 International License..."*

Both agree. No login, no API key, no scriptable barrier — a plain HTTPS GET against the
Zenodo file-content URL in `manifest.toml`.

**Access.** The Zenodo deposit is a snapshot of the GitHub repository at release v0.0.1: a zip
containing `.gitignore`, `LICENSE.md`, `README.md`, a `notebooks/` folder, and the one file
this source needs, `cliopatria.geojson.zip` — itself a zip holding the single real data file,
`cliopatria.geojson`. `fetch.py` downloads the outer zip (sha256-pinned in `manifest.toml`),
extracts the nested zip's one member, and writes `cliopatria.geojson` into `raw_dir`, discarding
both zips and every other repository file — the same "extract only what's needed" shape
`sources/paleodem/fetch.py` already uses for its own single-artefact Zenodo download.

## Format and schema

One GeoJSON `FeatureCollection`, CRS `urn:ogc:def:crs:OGC:1.3:CRS84` (plain WGS84, lon/lat
order) — confirmed directly, not assumed. **14,945 features**, five distinct `Type` values
(confirmed by direct count):

| `Type` | Count | Kept by this source? |
|---|---:|---|
| `POLITY` | 14,108 | yes — the only `Type` that is a territorial extent |
| `LEADER` | 397 | no |
| `GROUP` | 359 | no |
| `EVENT` | 56 | no |
| `ARMY` | 25 | no |

Every feature's `properties` carries exactly: `Name`, `FromYear`, `ToYear` (signed integers,
negative = BCE — no separate era flag, unlike `sources/cities`' `BC_<year>`/`AD_<year>` column
names), `Area` (float, **km², already computed by the dataset's own authors** — spot-checked
directly against known history and found accurate: Roman Empire peak 5,261,057 km² at 117–126
CE against a commonly cited ~5,000,000 km²; Mongol Empire peak 27,426,675 km² at 1279–1284
against commonly cited ~24,000,000 km²; British Empire peak 36,818,002 km² in 1918 against
commonly cited ~35,500,000 km² — all in the right ballpark, so this source uses `Area` directly
rather than recomputing geodesic area itself), `Type`, `Wikipedia` (article title, 100% filled
for `POLITY` rows), `SeshatID` (a stable code into the Seshat databank's own polity records,
e.g. `eg_dynasty_1` — filled for 8,192 of 14,108 `POLITY` rows, blank for the rest), `MemberOf`
and `Components` (cross-references between polities, e.g. `Jin`'s `MemberOf` is `"(Spring and
Autumn States)"`; not used by this source beyond the dedupe rule below). Geometry is `Polygon`
(6,905 features) or `MultiPolygon` (8,040 features) — no `Point`/`LineString`, confirmed.

**1,613 distinct `Name` values among `POLITY` rows** (1,544 after the canonicalisation below —
1,613 minus one excluded non-polity entry minus 68 parenthesised names that merge into an
already-existing bare/aliased name; a further 28 parenthesised names are relabelled, not merged,
so they still count separately), matching the task brief's "~1,600 political entities" closely.
**508 distinct `FromYear`
values** across `POLITY` rows, matching "~508 distinct attested map years" exactly. Windows
per polity: median 4, max 132 (e.g. long apparently-continuous dynasties); confirmed directly
that no polity's own windows overlap or touch in time (sorted, contiguous, gap-free per name)
— they read as one continuous lineage of successive attested extents, the same shape a city's
population readings have in `sources/cities`, just for territory instead of population.

**This schema matches what the task brief described, with one addition the brief didn't
mention**: `Area` is already computed, which simplified the subset rule (no geodesic-area
computation needed) — and one thing the brief undersold: the parenthesised-name duplication
below, discovered only by checking the real data.

## Duplicate aggregate entries and label normalisation

**Amended 2026-09-18** (ADR-037 amendment), after the user spotted three label artefacts in the
originally-selected subset: `"(British Empire)"` and `"British Colonial Empire"` duplicating one
empire, several selected names left wrapped in parentheses (`"(Delhi Sultanate)"`,
`"(Five Dynasties and Ten Kingdoms)"`), and `"Greek Dark Ages"` — a historical period, not an
attested governing polity — presented as if it were one. The whole raw `Name` field (not just
the three reported examples) was re-examined before choosing a rule; the findings and fix below
generalise instead of hardcoding the three cases.

**The parenthesis pattern, confirmed across the whole dataset, not just the selected subset.**
96 of the 1,613 distinct `POLITY` `Name` values are wrapped in parentheses, e.g. `"(Han
Dynasty)"` alongside a bare `"Han Dynasty"`. **67 have a bare counterpart** (the "same entity,
temporal-succession aggregate" case — e.g. `"(Roman Empire)"` aggregates `"Roman Empire"`'s own
successive named periods; checked directly, their `Area` and, spot-checked, geometry are
identical for every window they share) and **29 do not** — a genuinely different thing, a
multi-state grouping with no single "the" bare name (e.g. `"(Spring and Autumn States)"`, whose
`Components` field lists eighteen separately-named, simultaneously-existing states). One name
has embedded, non-wrapping parentheses (`"Kingdom of Naples (Napoleonic)"`) and is correctly left
alone by a rule that only matches a pair wrapping the *entire* string.

**`normalise._canonical_name(name)` now strips every wrapping `"(...)"` pair unconditionally**,
not only when a bare counterpart already exists — a general rule, not a hardcoded fix for the
three reported names. When the stripped form already names another row, this is a merge (as
before); when it doesn't, it's a plain rename — the parenthesis was never part of the polity's
own name, so `"(Spring and Autumn States)"` now displays as `"Spring and Autumn States"` even
though nothing merges into it. Checked directly: no two of the 29 "no bare counterpart" names
strip to the same string, and none collides with an existing bare name (both would be silent
data-corruption risks a purely mechanical strip could introduce) — confirmed against the full
1,613-name list, not assumed.

Because two rows can still both exist for the *identical* (canonical name, FromYear, ToYear)
window after canonicalisation (one bare, one parenthesised), `normalise._dedupe_rows` also
collapses them — keeping the bare-labelled row when both exist for the same window (arbitrary
but deterministic; their data is identical in every case checked for the has-bare-counterpart
group), and keeping whichever single row exists when only one label reports a given window (the
same "fill gaps from whichever source has them" precedent `sources/cities`' Chandler/Modelski
dedupe already sets). This dedupe is what keeps the *curated* data (not just the ranking) from
carrying the same physical territory twice.

**`"British Colonial Empire"` / `"(British Empire)"`: not caught by paren-stripping.** Both are
the same real-world empire, but under two literal `Name`s that do not share a bare form —
stripping `"(British Empire)"` yields `"British Empire"`, a third string, not `"British Colonial
Empire"`. Checked directly: both carry the identical `SeshatID` pair (`gb_british_emp_1`/
`gb_british_emp_2`) across their full 1706–1999 span, and their `Area` readings agree exactly for
the earliest window (1706–1708, both 174.36 km²) before diverging from 1709 onward — two area
-accounting methodologies for one empire, not two empires. This one pair is genuinely a residual
limitation of a *general* rule (catching it mechanically would need either fuzzy name-matching
or a synonym table, per the original ADR-037 text) — but the fix for exactly *this* one known,
confirmed pair is a small, explicit, commented alias, not a broad synonym table:
`normalise._NAME_ALIASES = {"(British Empire)": "British Colonial Empire"}`, applied before
paren-stripping so the existing "prefer the non-parenthesised row's data" dedupe convention
still governs which of the two divergent `Area` readings survives for any window both report.

**`"Greek Dark Ages"`: excluded, not renamed.** A historical-period label for the Aegean's
post-Mycenaean collapse (c. 1100–800 BCE), not an attested governing polity — Cliopatria carries
it as a `POLITY` row regardless (three small windows, -1100..-801). Re-checked every `POLITY`
`Name` in the full raw dataset for the same "period, not polity" pattern (a regex over `dark
ages|period|era|age|interregnum|epoch`): the only other match, `"Early Dynastic Period of
Egypt"`, is not excluded — unlike `"Greek Dark Ages"`, it names a specific, continuous, unified
pharaonic state (the same sense `"Old Kingdom of Egypt"`/`"Middle Kingdom of Egypt"`/`"New
Kingdom of Egypt"` are already selected polities under period-style names), not a fragmented era
with no single governing entity. `normalise._EXCLUDED_NAMES = frozenset({"Greek Dark Ages"})` —
a small, explicit, commented list, checked against a canonical name (post paren-stripping/alias)
in `_dedupe_rows`, deliberately not a broader "is this a real polity" heuristic that would
reintroduce hand-curated historical judgement into a rule built to avoid exactly that.

**Every name that changed or was dropped** by this amendment (independent of the 1900 cutoff
below, which separately removes seven modern nation-states — see "Domain cutoff: 1900 CE"):

| Raw name | Outcome |
|---|---|
| `(British Empire)` | merged into `British Colonial Empire` (alias) |
| `(Delhi Sultanate)` | renamed to `Delhi Sultanate` (no bare counterpart existed) |
| `(Eighteen Kingdoms)` | renamed to `Eighteen Kingdoms` (no bare counterpart existed) |
| `(Five Dynasties and Ten Kingdoms)` | renamed to `Five Dynasties and Ten Kingdoms` (no bare counterpart existed) |
| `(Personal union of Spanish Empire with Habsburg Monarchy)` | renamed to `Personal union of Spanish Empire with Habsburg Monarchy` (no bare counterpart existed) |
| `(Spring and Autumn States)` | renamed to `Spring and Autumn States` (no bare counterpart existed) |
| `(Warring States China)` | renamed to `Warring States China` (no bare counterpart existed) |
| `Greek Dark Ages` | dropped (excluded — a period, not a polity) |

The other 89 parenthesised names in the full dataset (67 with a bare counterpart, 22 of the 29
without one) are stripped/merged the same general way but happened not to be in the originally
-selected 121-polity subset, so their labels were never wrong on screen; they are not listed
individually here. Two selection-side effects follow mechanically from these fixes, not from
any further hand-picking: with `"Greek Dark Ages"` removed from its era bucket, `"Phoenicia"`
newly qualifies there; with the British Empire duplicate resolved to one merged entry (a lower
peak area than either original reading, since the divergent `Area` readings are no longer
double-counted) plus the 1900 cutoff, a `"Brazilian Republic"` window newly qualifies in the
bucket the cutoff-truncated `"Empire of Brazil"`/former `"Republic of Brazil"` windows vacated.

## Domain cutoff: 1900 CE

**Added 2026-09-18** (ADR-037 amendment), per-user direction after reviewing the originally
-selected subset: ranking "largest by area" within each era bucket, run all the way to the
present, put five modern nation-states in the selected list — Canada, the People's Republic of
China, Brazil, the Russian Federation and the USA — rather than the historical empires this
layer exists to show. The user's own words: *"hmm yeh maybe stop at 1900 for now and ill see
what that looks like."*

`normalise.CUTOFF_CE_YEAR = 1900` excludes every polity-window material after that year. 1900
itself is drawn through to its end, so the newest snapshot boundary (`Snapshot.t_end`) is 124.0 years
BP against the fixed 2025 present (see "Resolution and thinning" for the half-open spans). This is
explicitly **provisional** — the user will look at the layer at this domain before deciding
whether to move or lift the cutoff — so it is one named module-level constant, not scattered
through the pipeline.

**Applied to raw rows before dedupe** (`normalise._apply_cutoff`, immediately after loading).
When it was introduced this kept a modern nation-state's post-1900 growth out of the subset
rule's top-N ranking altogether; with the roster it simply bounds every member's lifespan:

- A window that starts strictly after 1900 (`FromYear > 1900`) is **dropped entirely**.
- A window straddling 1900 (`FromYear <= 1900 < ToYear`) is **truncated**, not dropped — its
  `ToYear` clips to 1900, so a polity still alive in 1880 still appears, its territory simply
  ending at 1900 rather than persisting to its own real, later end-year.
- A window entirely before or at 1900 (`ToYear <= 1900`) is kept unchanged.

**Effect on the selected subset**: three of the five nation-states the user flagged (Canada, the
People's Republic of China, the Russian Federation) vanish entirely — their only windows start
after 1900. `"Republic of Brazil"` and `"Republics of the Soviet Union"`/`"Union of Soviet
Socialist Republics"`/`"Russian Republic"` (all post-1900-only) vanish the same way. `"United
States of America"`, `"British Colonial Empire"`, `"Russian Empire"`, `"Ottoman Empire"`,
`"Spanish Empire"` and `"Qing Dynasty"` survive with their windows truncated at 1900 — they were
real polities already alive before 1900, so truncating (not dropping) them is the correct
reading of "stop at 1900", not an accident of the mechanism. `"Empire of Brazil"` needed no
truncation at all: its own last window already ends in 1889, before the cutoff.

## Empire roster

**Since ADR-059** a hand-picked roster, `sources/cliopatria/roster.toml`, replaces ADR-037's
subset rule (an era-relative top-6-by-area per 100-year bucket, `subset.py`, now deleted). The
subset rule was objective but produced a map nobody had chosen: 114 polities, many of them
short-lived regional kingdoms, and no notion that the Roman Republic, the Roman Empire and the
Byzantine Empire are one story. The roster instead names **28 lineages** — groups of Cliopatria
polities a general audience reads as one continuing power, drawn in one colour on the globe:

Egypt, Mesopotamia, Assyria, Hittites, Persia, Macedon, Carthage, Rome, Maurya & Gupta, China,
Xiongnu, Tibetan Empire, Khmer Empire, Caliphate, Franks, Holy Roman Empire, Ghana/Mali/Songhai,
Seljuks, Mongols, Timurids & Mughals, Ottoman Empire, Kush & Axum, Maya, Aztec, Inca, Spain,
Britain, Russia.

Each `[[lineage]]` has an `id`, a display `name`, a `colour_slot` (0..7, an index into the
web's palette), a one-line `reason`, and ordered `members`. A member is a canonical polity name
(after `_canonical_name`'s paren-stripping and alias), with optional inclusive `from`/`to` CE
clamps and an optional `label` shown on the globe instead of the polity name (e.g. `British
Colonial Empire` → "British Empire", `Sumerian City-States` → "Sumer"). `normalise.py` refuses
the build naming every member that matches no window up to 1900, and every member left with no
window after its clamp and the area floor; a polity may appear in only one lineage.

**Info card.** Each lineage also carries a `description` (2–3 plain sentences, at most 320
characters) and `events`, the `data/events.yaml` ids that concern it; each member carries
`wikipedia`, its English Wikipedia article title. The globe's empire tooltip and detail card
read them from the published layer. Titles are copied from the raw rows' own `Wikipedia`
property, so a few name a broader article than the member (`Sumerian City-States` → "History of
Sumer"). Two raw titles name something other than the polity and are overridden: `Kingdom of
Great Britain` says "Great Britain" (the island), which the roster replaces with "United
Kingdom", the state for most of the member's span; `British Africa` says "Scramble for Africa"
(a process), replaced with "British Empire". Two polities' rows disagree: the Carolingian
Empire's aggregate says "Francia" for 751–849 and "West Francia" for 850–887, and the roster
takes "Francia", the article on the whole Frankish realm; eight 1815–1879 `Spanish Empire` rows say
"History of Spain (1808–1874)" against 68 saying "Spanish Empire", which the roster takes. Publish refuses a lineage event that is
not a published `events-core` id, naming each. None of these fields reaches `normalise.py`'s
output, so editing them rebuilds the source to identical curated data and geometry.

**Clamps** trim members whose Cliopatria series runs on past the period the lineage is about, or
that overlaps its predecessor: Byzantium to 1453, the Abbasids to 1258, the Khmer to 1431, the
Holy Roman Empire from 962, the Carolingian Empire to 751–887 (the dynasty takes the throne in 751; its parenthesised aggregate
otherwise swallows the Kingdom of the Franks), the Mughals to 1526–1857, the Yuan to 1368, the
Golden Horde to 1502, Mali to 1462, Songhai to 1591, Later Mayan City-States to 1200.

**Left out**, from the investigation behind the roster: the Kingdom of France (its bare series
is the royal demesne, alternating with a much larger aggregate — unusable), the First French
Empire (only colonial scraps after 1815), `Assyrian Egypt` (wholly inside Neo-Assyrian), and for
crowding Portugal, Ethiopia, England, Moscow, the Marathas and the Kushans. More than 8 lineages
are active in 187 of the 5,301 years (max 10, 202–171 BCE).

**Colour slots** are assigned by a greedy graph colouring, most famous lineages first (Rome,
China, Persia, Mongols, Caliphate, Ottoman, Britain, Spain, Russia, …): two lineages that are
ever active at the same time with member bounding boxes within 10° of each other never share a
slot. Eight slots suffice. The numbers are written into `roster.toml`, so inserting a lineage
later does not recolour the others. Lineage names, labels, colour slots and the info-card fields are
read again at publish, so changing them needs no data rebuild; membership, clamps and the polity list are
read by `normalise.py`, and `databuild`'s fingerprint covers `*.toml`, so editing them does.

## Resolution and thinning

**One geometry per member per year.** Bare and parenthesised windows of one canonical polity
overlap in time with different spans and, often, very different footprints (Kingdom of France
bare vs `(Kingdom of France)` over 1003–1017: IoU 0.04; Sasanian 627: 0.30M vs 4.41M km²). For
colonial empires `"(X)"` is metropole plus colonies and bare `"X"` the overseas part alone.
`_resolve_years` therefore draws each year of a member from a **bare** window wherever one
covers it, from a parenthesised one only in the gaps, and among several candidates takes the
latest `FromYear`. A window under **500 km²** (`MIN_AREA_KM2`) counts as absent: Cliopatria
carries degenerate slivers inside good series (Han 6–13 CE at 143 km², Sui 623–625, Safavid
1727–37, Spanish Empire 1877–79), while the smallest genuine roster window, the early Roman
Republic, is ~900 km².

**Thinning** (`_thin`, per member, in time order): a resolved segment starts a new snapshot when
its IoU with the last *kept* snapshot is below **0.9**, or their symmetric difference exceeds
**250,000 km²**, or after a real gap (`next.from > prev.to + 1`); otherwise the kept snapshot
extends over it. Both measures are computed in a Lambert cylindrical equal-area projection, so
areas are real km². IoU alone at 0.9 missed changes that are small relative to a vast empire
but obvious on screen (the Ottoman losses of 1699, the sale of Alaska — Russia kept only 5
snapshots); the symmetric-difference rule brings the Ottomans to 38 and Russia to 39. A
snapshot keeps its first window's geometry, `Area`, `SeshatID` and label anchor.

**Time semantics.** `t_start = 2025 − from_year`, `t_end = 2025 − (to_year + 1)`, and a
snapshot is active for `t_end < t ≤ t_start`: years are inclusive, so abutting snapshots share a
boundary and never overlap or leave a one-year hole. A snapshot clipped by the 1900 cutoff ends
at `t_end = 124`.

## FeatureSet: one row per snapshot

`cliopatria_polities` is the source's only curated shape: **one `Feature` per kept snapshot**.
`id` is `<polity slug>-<from year>` (e.g. `roman-empire-117ce`, suffixed `-2` on a collision),
`name` the canonical polity name, `country` always `""`, `lat`/`lon` the snapshot geometry's
`representative_point()`, `certainty` as under "Certainty", and a single estimate
`PopulationEstimate(t=t_start, area_km2=..., t_end=t_end)`.

`FeatureSet`/`Feature` (ADR-035) was built for `sources/cities`: one fixed point with several
dated readings. A polity's territory, and so any sensible anchor inside it, moves as its borders
change, so this source uses one `Feature` per snapshot instead of one per polity. The shape
extension this needed (ADR-037, additive) is `PopulationEstimate.area_km2` and `t_end`, inside
the JSON-encoded `estimates` blob, with no parquet schema change. `FeatureSet.sample(t)` knows
nothing of `t_end` and is not how this layer is read: publish turns each feature into a
`territories` snapshot and the web applies the half-open rule itself.

**Representative point, not centroid.** A centroid can fall outside a concave or multi-part
territory (an archipelagic empire's lands in open ocean); `representative_point()` is guaranteed
to fall inside the geometry.

## Geometry file

`write_outputs` writes one file, `data/media/vectors/cliopatria_territories-<hash10>.json`,
content-hashed with `pipeline.audio.content_hashed_filename` (the same scheme as audio stems,
ADR-057, so the CDN can cache it immutably) and removes any other `cliopatria_territories-*`
file there. Publish globs for exactly one match. Every snapshot's geometry is
`shapely.simplify(0.1°, preserve_topology=True)` (about one pixel of the web's 4096-wide
canvas), then `shapely.set_precision(0.01°)` — which, unlike rounding each coordinate, keeps
every polygon valid — then oriented with exteriors counter-clockwise and holes clockwise, so a
nonzero fill of several members in one path unions them and still cuts the holes. Compact JSON:

```json
{"precision":0.01,"snapshots":{"<feature id>":[[[lon,lat,lon,lat,...],[hole...]], ...]}}
```

`snapshots[id]` is a list of polygons, a polygon a list of rings with the exterior first, a ring
a flat `lon,lat` array without the repeated closing point. Cliopatria already splits polygons at
the antimeridian; the only edges lying on ±180° (Russian Empire, 1868–69) must not be stroked,
which is the web renderer's job.

This replaces ADR-037's `cliopatria_extent` coverage-mask `RasterSequence` and its 842 WebP
textures, which could not colour lineages or draw outlines.

## Certainty

Cliopatria's schema carries **no per-feature confidence/certainty field at all** — confirmed
directly (`Name`, `FromYear`, `ToYear`, `Area`, `Type`, `Wikipedia`, `SeshatID`, `MemberOf`,
`Components`, nothing else). `sources/cities`' own `FeatureCertainty` pattern maps a raw
1/2/3 geocoding-confidence code the dataset itself reports; Cliopatria reports nothing
equivalent, so there is no per-window signal to translate without inventing one.

What Cliopatria *does* report that plausibly correlates with data confidence: whether a window's
row carries a **`SeshatID`** — a stable reference into the Seshat Global History Databank's own
expert-curated polity records (`seshatdatabank.info`), versus a row present only in this
geospatial layer with no such cross-reference. This source maps that, directly and mechanically
(not from historical judgement): `HIGH` when `SeshatID` is non-blank, `MEDIUM` otherwise. There
is no `LOW` tier — the data offers only this one binary signal, not three grades — and this is
a *data-provenance* signal (has an expert-reviewed record been linked to this window), not a
*border-accuracy* signal, which is a materially different thing this source does not claim to
measure.

**The steppe/nomadic border-uncertainty caveat, which this per-feature signal does not
capture**: the Cliopatria authors themselves state (README.md excerpt, above) that "border
uncertainties... are common challenges facing historians", and the task's own brief names the
Avar Khaganate as the authors' example of a steppe/nomadic polity whose borders are materially
more contested than a settled agrarian empire's — a distinction Cliopatria's schema does not
encode in any field this source could map. Deriving it mechanically would require classifying
which roster polities are "nomadic" — the Xiongnu, the Mongol Empire, the Golden Horde and the
Chagatai Khanate are steppe polities by the ordinary sense of the term — but that classification
exists nowhere in the source data, so making it would mean inventing per-feature data. This
caveat is therefore carried as **prose, here, rather than as fabricated per-feature data**: a
consumer of this layer should treat every steppe/nomadic polity's territorial extent
as illustrative of scale and approximate reach, not as a precise, agreed border, regardless of
its `certainty` value — `certainty` here answers "is this window's row cross-referenced with
Seshat's own polity records", not "is this border agreed".

## Time convention

`t` = years before the fixed AD 2025 present, matching `sources/hyde`/`sources/cities`/
`sources/co2-o2`. Unlike `sources/cities`' `BC_<year>`/`AD_<year>` column-name parsing,
Cliopatria's `FromYear`/`ToYear` are already signed integers (negative = BCE), so one formula
covers every row: `t = 2025 - year` for a snapshot's start, and `t = 2025 - (year + 1)` for its
end, since `ToYear` is inclusive. The curated domain's newer edge is 124.0
(the end of 1900 CE) — see "Domain cutoff: 1900 CE" above — not the present.

## Measured volume

Raw (gitignored, `data/raw/cliopatria/`): the Zenodo repository-archive zip actually downloaded
is **49,215,745 bytes** (sha256-pinned in `manifest.toml`); the extracted `cliopatria.geojson` is
**186,488,764 bytes**, parsed once per build (~20 s for the whole normalise, cached between
`normalise` and `write_outputs`).

Curated, measured on the 28-lineage roster (ADR-059): **803 snapshots** in
`cliopatria_polities.parquet` (44 KB), from 1,755 resolved segments. At most 10 lineages are
active at once (202–171 BCE). Per lineage:

| Lineage | Snapshots | Lineage | Snapshots |
|---|---|---|---|
| rome | 109 | timurid | 34 |
| china | 104 | hre | 34 |
| persia | 60 | caliphate | 32 |
| spain | 59 | mesopotamia | 27 |
| britain | 48 | mongol | 23 |
| russia | 39 | franks | 22 |
| ottoman | 38 | assyria | 15 |
| egypt | 28 | seljuk | 14 |
| macedon | 28 | india, khmer, xiongnu | 11 each |
| carthage, tibet | 10 each | aztec | 9 |
| axum | 8 | inca, sahel | 6 each |
| maya | 4 | hittites | 3 |

Geometry file: **3,218,172 bytes** raw, **298,905 bytes** gzip -9, ~259k vertices; every polygon
valid after `set_precision`. The published `layers/empires.json` (snapshot metadata only) is
~208 KB, ~33 KB gzipped.

## Storage tier chosen

**git** for the curated parquet and for the geometry JSON (plain git, like the published
`layers/*.json`; `.gitattributes` puts only binary media in LFS). Raw `cliopatria.geojson` is
gitignored and re-fetched from Zenodo via `fetch.py`.

## Fixture

`sources/cliopatria/fixture/cliopatria.geojson` is twelve real, unmodified features (~48 KB)
from the real dataset, and `fixture/roster.toml` a three-lineage roster naming only fixture
polities (the tests inject it through `normalise_with`/`write_geometry`):

- `Han Dynasty` at (-202,-198 BCE) and (6–13 CE), plus `(Han Dynasty)` at the *identical* two
  windows — the parenthesis-merge dedupe's main case; the 6–13 CE window is a 143 km² sliver,
  the area floor's case;
- `(Han Dynasty)` at (224–237 CE), a window only the parenthesised label reports (`SeshatID`
  blank) — a paren window filling a gap, and a `MEDIUM`-certainty example;
- `Himyarite Kingdom` at (534–576 CE) — present in the data, absent from the fixture roster;
- `Goguryeo` at (612–616 CE) — a `MultiPolygon`, `SeshatID` present (`HIGH` certainty);
- `Atropates` (`Type = LEADER`) — dropped by the `Type` filter;
- `Montenegro`'s real windows (1880–1884), (1885–1910) and (1911) — abutting snapshots, a window
  straddling 1900 (clipped to end at `t = 124`) and one wholly after it (dropped);
- `Greek Dark Ages` at (-1100,-1001 BCE) — the non-polity exclusion.

Bare-over-paren resolution with differing spans and the thinning thresholds are tested on
synthetic windows, and the `British Colonial Empire`/`(British Empire)` alias on synthetic
`_RawPolityRow`s, since the real geometries involved are large.

## Gotchas

- **`Area` is already in km², not degrees² or some other unit** — confirmed by spot-checking
  three well-known empires' peak areas against commonly cited figures (see "Format and
  schema"), not assumed from the column name.
- **Parenthesised names mean two different things** — a temporal-succession aggregate or a
  genuinely distinct multi-state grouping; both are stripped for display (see "Duplicate
  aggregate entries and label normalisation"). For resolution the flag still matters: a bare
  window beats a parenthesised one year by year ("Resolution and thinning").
- **Not every same-empire duplicate is a parenthesis pair** — `British Colonial Empire`/`(British
  Empire)` are the one confirmed case, fixed with a small explicit alias.
- **Metropoles are separate polities.** `British Colonial Empire` excludes Great Britain, the
  Raj and British Africa; `Spanish Empire` excludes the Kingdom of Spain. A lineage therefore
  often has several members active at once, which the web fills as one path.
- **The 1900 cutoff (`CUTOFF_CE_YEAR`) is provisional** — see "Domain cutoff: 1900 CE".
- **No border-uncertainty field, and no population field, at all** — both are prose-only
  caveats here, not fabricated data.
- **`FeatureSet.sample(t)` is not the right way to read this layer** — it ignores `t_end`; read
  each feature's single estimate as the half-open span `t_end < t ≤ t`.

## New dependency: shapely

`shapely>=2.0` (`pyproject.toml`), used only in `normalise.py`: parsing `Polygon`/
`MultiPolygon` GeoJSON geometry, fixing an occasional self-intersecting polygon
(`geometry.buffer(0)`), the thinning IoU, simplification and precision snapping, and a
guaranteed-interior `representative_point()` for label anchors. BSD-licensed, GEOS-backed (bundled in the wheel — no system GDAL/PROJ/GEOS
installation needed, unlike `gplately`/`pygplates`), and not GPL — safe to import from the
pipeline without the `sources/gplately`-style licensing caveat. No other new dependency:
`httpx`, `tenacity`, `pydantic` and `numpy` are already declared.
