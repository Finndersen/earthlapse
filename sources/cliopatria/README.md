# Source: cliopatria

Historical empire/polity territory, 3400 BCE – 1900 CE (curated domain; the raw dataset itself
runs to 2024 CE — see "Domain cutoff: 1900 CE" for why the curated data stops earlier): a
`RasterSequence` of the notable subset's territorial extent (id `cliopatria_extent`, what the
globe tints) plus a `FeatureSet` of per-window label anchors (id `cliopatria_polities`, what
labels/hover read). Curated data already holds only the "notable subset" the rule below selects
— not the full world political map (see "Scope", below, for why this departs from
`sources/cities`' own "curate everything, filter at publish" precedent).

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

`normalise.CUTOFF_CE_YEAR = 1900` (`CUTOFF_T = 125.0` years BP against the fixed 2025 present)
excludes every polity-window material after that year from **both** curated outputs. This is
explicitly **provisional** — the user will look at the layer at this domain before deciding
whether to move or lift the cutoff — so it is one named module-level constant, not scattered
through the pipeline.

**Applied to raw rows before dedupe and before the subset rule runs** (`normalise._apply_cutoff`,
called from `_select_active_windows` immediately after loading), not as a post-hoc filter on the
already-selected subset — so a modern nation-state's post-1900 growth never enters the top-N
ranking competition in the first place, rather than being selected and then hidden:

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
truncation at all: its own last window already ends in 1889, before the cutoff. Full effect on
frame/polity/window counts: "Measured volume", below.

## Subset rule

**The rule** (`sources/cliopatria/subset.py`'s `select_notable_polities`, applied inside
`normalise.py` itself): a polity qualifies if, within any **100-year-wide era bucket** (`t`
rounded to the nearest century, bucketed on each window's own midpoint), its **peak attested
area within that bucket ranks in that bucket's own top 6**. Exactly the same shape as
`pipeline.notability.notable_features`'s rule for `sources/cities` (era-relative ranking, not
a global cutoff — a Bronze Age city-state never has to out-rank the British Empire, only its
own contemporaries) but a **parallel, standalone implementation**, not a reuse of that
function: `notable_features` operates on an already-built `FeatureSet` of `Feature`s (each
needing placeholder `lat`/`lon`/`certainty` a pure numeric ranking has no use for), whereas the
raw Cliopatria rows are still plain `(name, years, area)` triples with no `Feature` built yet.

**Why curated, not published-only** (a deliberate departure from `sources/cities`, which keeps
its *full* 1,736-city dataset curated and only filters at publish time, ADR-035): Cliopatria's
raw data is ~14,108 polity windows covering the entire world's political history at ~508
distinct map years — rasterising *that* would mean thousands of frames of a dense, largely
redundant world map, an entirely different (and far more expensive) product than what was
asked for. The task's own framing ("the user chose a subset... for legibility") describes the
subset as this source's scope, not a display nicety layered on top of a complete dataset — so
`normalise.py` applies the rule directly, and the curated `cliopatria_polities`/
`cliopatria_extent` files hold only the selected ~114 polities' windows, not the full ~1,613.

**Parameter sweep** (bucket width fixed at 100 years, matching `sources/cities`, to keep both
`FeatureSet` sources' notability conventions consistent; `top_n` swept, after applying the
label normalisation and the 1900 cutoff above — re-measured 2026-09-18, both amendments shift
which windows compete for each bucket's slots and so shift every count below):

| `top_n` | distinct polities selected |
|---:|---:|
| 3 | 67 |
| 4 | 79 |
| 5 | 98 |
| **6** | **114** |
| 7 | 130 |
| 8 | 144 |
| 10 | 177 |

`top_n = 6` was kept unchanged by this amendment (still the smallest value that spans every
millennium — the two 2026-09-18 fixes changed *which* windows compete for a bucket's slots, not
the parameter itself). It lands close to `sources/cities`' own selected fraction of its total
(cities: 164/1,736 ≈ 9.4%; polities: 114/1,544 canonical names ≈ 7.4%), and — checked directly,
not assumed — the resulting set still spans every millennium from 3400 BCE to 1900 CE and covers
Mesopotamia, Egypt, the Levant, Anatolia, the Aegean, East Asia (China, Korea), South Asia,
Central Asia's steppe empires, Persia, Rome/Byzantium, the Islamic caliphates, the Mongol
successor states, Western Europe's colonial empires, Russia, and the Americas — not
concentrated in one region or era:

| Millennium (years BP) | Polities overlapping it |
|---|---:|
| 0–1000 | 36 |
| 1000–2000 | 37 |
| 2000–3000 | 37 |
| 3000–4000 | 19 |
| 4000–5000 | 10 |
| 5000–6000 | 4 |

**The full selected list**, oldest first, each with its peak attested area and the full span
its (deduplicated) windows cover:

<!-- CLIOPATRIA_SUBSET_TABLE_START -->
| Polity | Peak area (km²) | Span (years BP, nearer–older) |
|---|---:|---|
| Sumerian City-States | 106,576 | 3786–5425 |
| Elam | 215,100 | 2626–5225 |
| Early Dynastic Period of Egypt | 94,284 | 4526–5025 |
| Indus Valley Civilization | 755,121 | 3726–5025 |
| Old Kingdom of Egypt | 94,284 | 4226–4525 |
| Akkadian Empire | 526,534 | 4126–4325 |
| Lower Egypt | 73,893 | 4026–4225 |
| Upper Egypt | 20,418 | 4026–4225 |
| Gutian Dynasty | 131,488 | 4026–4125 |
| Middle Kingdom of Egypt | 432,787 | 3626–4025 |
| Hyksos | 134,311 | 3426–3825 |
| Assyria | 599,452 | 2926–3825 |
| Babylonia | 226,666 | 2626–3825 |
| First Sealand Dynasty | 15,392 | 3426–3725 |
| Fifteenth Dynasty of Egypt | 34,258 | 3526–3625 |
| Seventeenth Dynasty of Egypt | 33,588 | 3526–3625 |
| Hittites | 321,568 | 3176–3625 |
| Shang Dynasty | 154,175 | 3026–3625 |
| Mitanni | 189,149 | 3266–3525 |
| Mycenaean Greece | 69,485 | 3126–3525 |
| New Kingdom of Egypt | 708,712 | 2826–3525 |
| Phoenicia | 35,028 | 2526–3175 |
| Zhou Dynasty | 699,623 | 2776–3025 |
| Kingdom of Israel | 20,072 | 2726–3025 |
| Kingdom of Kush | 563,237 | 1679–3025 |
| Phrygia | 188,102 | 2701–2925 |
| Neo-Assyrian Empire | 1,400,806 | 2626–2925 |
| Twenty-second Dynasty of Egypt | 166,128 | 2726–2825 |
| Kingdom of Urartu | 161,552 | 2576–2825 |
| Spring and Autumn States | 1,008,534 | 2506–2775 |
| Wu | 193,430 | 2476–2775 |
| Chu | 588,901 | 2249–2775 |
| Macedonian Empire | 4,940,080 | 2317–2700 |
| Assyrian Egypt | 1,435,116 | 2641–2675 |
| Median Kingdom | 2,243,483 | 2576–2640 |
| Twenty-sixth Dynasty of Egypt | 464,287 | 2526–2640 |
| Neo-Babylonian Empire | 703,486 | 2556–2625 |
| Mahajanapadas | 802,102 | 2376–2625 |
| Achaemenid Empire | 5,623,180 | 2352–2575 |
| Roman Republic | 2,340,375 | 2057–2525 |
| Warring States China | 1,633,842 | 2244–2505 |
| Magadha - Shaishunaga dynasty | 796,690 | 2359–2429 |
| Nanda Empire | 1,558,417 | 2344–2358 |
| Ptolemaic Kingdom | 4,829,461 | 2053–2356 |
| Maurya Empire | 3,947,091 | 2196–2343 |
| Seleucid Empire | 2,975,692 | 2089–2343 |
| Parthian Empire | 3,053,439 | 1788–2264 |
| Qin Dynasty | 2,132,674 | 2234–2243 |
| Eighteen Kingdoms | 2,128,028 | 2229–2233 |
| Xiongnu | 5,610,773 | 1872–2233 |
| Han Dynasty | 4,582,951 | 1788–2227 |
| Indo-Scythians | 1,496,713 | 1743–2169 |
| Roman Empire | 5,261,057 | 1631–2056 |
| Xin Dynasty | 4,465,244 | 1996–2019 |
| Kushan Empire | 2,267,253 | 1788–1982 |
| Xianbei | 5,180,459 | 1788–1965 |
| Eastern Wu | 1,399,612 | 1743–1818 |
| Sasanian Empire | 4,998,054 | 1382–1810 |
| Cao Wei | 2,972,757 | 1761–1801 |
| Western Jin | 4,372,757 | 1600–1760 |
| Gupta Empire | 2,495,083 | 1471–1701 |
| Former Qin | 1,798,283 | 1632–1672 |
| Eastern Roman Empire | 2,600,677 | 1393–1630 |
| Rouran Khaganate | 3,872,480 | 1471–1623 |
| White Huns | 3,301,454 | 1465–1615 |
| Liu Song Dynasty | 2,738,149 | 1546–1599 |
| Liang Dynasty | 2,361,517 | 1465–1515 |
| Göktürk Khaganate | 6,381,231 | 1439–1470 |
| Western Göktürks | 4,096,615 | 1365–1438 |
| Tibetan Empire | 3,857,027 | 1176–1402 |
| Tang Dynasty | 8,722,412 | 1115–1402 |
| Rashidun Caliphate | 7,089,356 | 1360–1392 |
| Umayyad Caliphate | 9,878,026 | 1269–1369 |
| Türgesh | 4,032,061 | 1276–1333 |
| Uyghur Khaganate | 3,884,521 | 1176–1275 |
| Kimek-Kipchak confederation | 3,013,249 | 790–1275 |
| Abbasid Caliphate | 8,155,148 | 766–1275 |
| Tibetans | 1,864,703 | 766–1175 |
| Saffarid Dynasty | 2,436,220 | 1126–1165 |
| Samanid Empire | 3,099,600 | 1026–1139 |
| Five Dynasties and Ten Kingdoms | 2,988,580 | 1046–1114 |
| Fatimid Caliphate | 1,946,383 | 849–1114 |
| Northern Song | 2,765,819 | 998–1064 |
| Ghaznavid Empire | 2,995,257 | 816–1063 |
| Southern Song | 2,799,673 | 747–997 |
| Great Seljuk Empire | 4,142,465 | 824–985 |
| Almoravid Dynasty | 1,923,826 | 820–969 |
| Kara-Khitans | 2,559,097 | 806–899 |
| Great Jin | 2,118,396 | 790–899 |
| Ghurid Dynasty | 2,142,477 | 816–873 |
| Khwarezmid Empire | 4,017,724 | 790–823 |
| Mongol Empire | 27,426,675 | 732–819 |
| Delhi Sultanate | 2,449,527 | 497–815 |
| Ilkhanate | 3,941,393 | 682–731 |
| Yuan Dynasty | 14,211,504 | 651–731 |
| Chagatai Khanate | 2,452,139 | 563–731 |
| Golden Horde | 4,857,721 | 330–731 |
| Ottoman Empire | 4,253,949 | 125–720 |
| Timurid Empire | 5,137,112 | 519–650 |
| Ming Dynasty | 6,272,929 | 381–650 |
| Four Oirats | 3,962,325 | 510–623 |
| Khanate of Sibir | 4,409,949 | 414–596 |
| Mongol Khanate | 5,082,632 | 390–557 |
| Mughal Empire | 3,760,268 | 167–528 |
| Portuguese Empire | 8,087,194 | 202–523 |
| Spanish Empire | 11,354,381 | 125–509 |
| Personal union of Spanish Empire with Habsburg Monarchy | 5,298,529 | 462–506 |
| Tsardom of Russia | 14,257,113 | 305–478 |
| Qing Dynasty | 12,509,657 | 125–380 |
| British Colonial Empire | 13,658,903 | 125–319 |
| Russian Empire | 22,894,359 | 125–304 |
| United States of America | 9,905,096 | 125–249 |
| Empire of Brazil | 8,506,136 | 136–203 |
| Brazilian Republic | 8,357,043 | 125–135 |
<!-- CLIOPATRIA_SUBSET_TABLE_END -->

**Other artefacts of a purely mechanical rule, reported rather than smoothed over**:

- A handful of selected entries are not "named empires" in the ordinary sense but multi-state
  *aggregates* Cliopatria itself models as one polity — now displayed without their wrapping
  parentheses (see "Duplicate aggregate entries and label normalisation" above) but still
  genuinely a multi-state grouping, not a single realm: `Spring and Autumn States`, `Warring
  States China`, `Eighteen Kingdoms`, `Five Dynasties and Ten Kingdoms`, `Delhi Sultanate`,
  `Personal union of Spanish Empire with Habsburg Monarchy`. Excluding these would require a
  hand-authored "what counts as a real empire" judgement call — exactly what the objective rule
  exists to avoid — so they are left in and named here instead.
- `British Colonial Empire` / `(British Empire)` is no longer a residual near-duplicate — the
  2026-09-18 amendment's explicit alias merges them (see "Duplicate aggregate entries and label
  normalisation" above).
- `Brazilian Republic` and `Phoenicia` are new entrants versus the pre-amendment 121-polity list
  — mechanical side effects of the label fix and the 1900 cutoff freeing up ranking slots in
  their own era buckets, not a further hand-picked addition (see "Duplicate aggregate entries
  and label normalisation" and "Domain cutoff: 1900 CE" above).

Reproduce with `select_notable_polities` directly: `sources/cliopatria/subset.py` is pure and
carries no I/O — the sweep above was produced by loading the real `cliopatria.geojson`,
applying the 1900 cutoff, building `PolityWindow`s per the canonicalisation/dedupe rules, and
calling `select_notable_polities(windows, bucket_years=100.0, top_n=N)` for each `N`.

## FeatureSet: one row per window, not per polity — doesn't fit cleanly

`FeatureSet`/`Feature` (ADR-035) was built for `sources/cities`: one `Feature` per named place
with a single, fixed `lat`/`lon` and a list of dated *readings* at that one place. A polity's
label anchor cannot honestly be fixed like that — a polity's territory (and therefore any
sensible representative point inside it) moves as its borders change, sometimes drastically
(the Mongol Empire's early-13th-century core is nowhere near its 1279 peak-extent centroid).

This source therefore emits **one `Feature` per surviving (canonical name, FromYear, ToYear)
window** — the same granularity as one raw Cliopatria row — rather than one `Feature` per
polity. A polity that survived N windows becomes N separate `Feature`s sharing a `name` but
each with its own `id`, `lat`/`lon` and one-element `estimates` list. This is the most literal
way to express "an anchor per polity per timestep" inside the existing shape without touching
`Feature`'s own `lat`/`lon` (which the shape fixes once per `Feature`), but it is a genuine
departure from how `sources/cities` uses the same shape, and from what `FeatureSet.sample(t)`
(`pipeline/shapes.py`) actually computes: that method returns every feature whose one estimate
is at or before `t`, with **no awareness of `t_end`, and no removal once a window's own end has
passed** — the same "founded, then assumed to persist" reading that is *right* for a city (a
population reading holds until superseded, or to the present) but *wrong* for a fallen empire's
former territory. Whoever builds the eventual rendering pass for this layer must write its own
`(t)` selection, reading `estimates[0].t`/`estimates[0].t_end` directly and checking
`t_end <= t <= t_start` — exactly the situation `sources/cities` is already in: its own
renderer (`web/src/globe/cities.ts`) never calls the generic `.sample()` either, for the same
reason (a bespoke reading of the estimates list, not the shape's own generic method, is what
real consumption looks like).

**The shape extension this needed** (ADR-037, additive, `pipeline/shapes.py`): `PopulationEstimate`
gains `area_km2: float | None` (a polity has no population reading at all) and `t_end:
GeoTime | None` (a window's own real end of validity, unlike a city's open-ended "holds until
superseded"), and `population` becomes optional so an estimate can carry either metric. Both
new fields live inside the JSON-encoded `estimates` blob `pipeline/curated.py`'s parquet layout
already treats as opaque — **zero parquet schema change**, so every existing `cities.parquet`
file round-trips byte-for-byte identically (its estimates simply never set the two new fields,
which default to `None`). `Feature.country` is always `""` for this source: a supra-national
polity's centroid has no single "the modern country" the way a city's coordinates do, and
resolving one would need a new country-boundary dependency out of scope here.

**Representative point, not centroid.** A plain centroid can fall *outside* a concave or
multi-part territory (an archipelagic empire's centroid can land in open ocean; a crescent- or
ring-shaped realm's centroid can land outside its own border entirely). Every anchor is
`shapely`'s `representative_point()` instead — guaranteed to fall inside the geometry (inside
whichever part, for a `MultiPolygon`) — the same "guaranteed sane label position for a concave
shape" property the task asked for. `shapely` is this source's one new dependency
(`pyproject.toml`): a lightweight, BSD-licensed, GEOS-backed geometry library with no system
GDAL/PROJ dependency, used only for parsing the raw `Polygon`/`MultiPolygon` GeoJSON, fixing an
occasional self-intersecting polygon (`buffer(0)`, a standard GIS trick), and computing this
one guaranteed-interior point.

## Rasterisation

`cliopatria_extent` is a **coverage mask**, not a per-polity identity map: **R = antialiased
coverage fraction (0–255) of any selected polity's territory** at that frame, **G = B = 0**.
Deciding *which* named polity a pixel belongs to is deliberately left to the `FeatureSet`'s
label anchors (exactly the split `sources/hyde` already draws between its population-density
raster and `sources/cities`' named markers) rather than encoding a per-polity index into the
raster — this task's own framing puts "labels and hover tooltips" on the `FeatureSet`, not the
raster, and a coverage mask is the simplest, most honest thing that lets a later web pass tint
"there is imperial territory here" without this source making a colour-per-empire decision that
is explicitly not its job.

**Frame timing.** A frame is rendered at every selected window's own `t_start` (its `FromYear`),
plus every window's own `t_end` (`ToYear`) *unless* some other selected window's `t_start`
already coincides with it (i.e. something picks up right where this one left off) — this is
what stops a fallen empire's last-rendered extent silently persisting on screen indefinitely,
the way it would if frames were only ever added at `t_start`. At each frame time, every
surviving window whose own `[t_end, t_start]` range contains that instant is drawn onto one
shared canvas (`fill=255` per polygon, subsequent draws simply overwriting — a genuine overlap
between two selected polities, e.g. a vassal inside its suzerain, reads as one solid patch, not
two distinguishable shades, matching the "coverage, not identity" design above).

**Doesn't fit cleanly**: `RasterSequence.sample(t)` (`pipeline/shapes.py`) always **crossfades**
between the two bracketing frames — the right behaviour for something that genuinely changes
gradually (continental drift, population density) but not for a political border, which changes
*abruptly* at the exact instant a frame represents. Sampling `t` strictly between two frame
times will show a brief alpha-blended overlap of two different political configurations rather
than a hard cut. `RasterBlend`'s own `alpha` is available to a renderer that would rather
threshold it (snap to whichever frame `alpha` is closer to) than blend it — a rendering
decision, out of this source's scope, not something the curated shape itself can prevent.

**Rendering**: each `Polygon`/`MultiPolygon` (via `shapely`) is projected to plain equirectangular
pixel coordinates (`x = (lon+180)/360 * width`, `y = (90-lat)/180 * height`, matching
`sources/hyde`'s/`sources/paleodem`'s own convention: row 0 = north) and filled with Pillow's
`ImageDraw.polygon` — exterior rings `fill=255`, interior rings (holes) `fill=0` on the same
canvas. Rasterised at `2x` `TEXTURE_SIZE` (1024×512, the same texture size `sources/hyde` uses)
then bilinear-downsampled, for antialiased edges without the cost of a much larger working
canvas — the same "render sharp, then filter down" idea `sources/hyde`'s own
`_resize_fraction` bilinear downsample uses, just supersampled here rather than downsampled
from a higher-resolution *source* grid (there is no such grid for vector polygons). Lossless
WebP (`method=6`), the same bar `sources/hyde`'s data-layer textures are held to.

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
which selected polities are "nomadic" — the Xiongnu, Xianbei, Rouran Khaganate, Göktürk
Khaganate, Western Göktürks, Uyghur Khaganate, Kimek-Kipchak confederation, Mongol Empire,
Golden Horde, Chagatai Khanate, Mongol Khanate and Four Oirats in the selected list above are
all steppe polities by the ordinary sense of the term — but that classification exists nowhere
in the source data, so making it would mean hand-authoring a list from historical knowledge,
exactly the thing the subset rule itself was built to avoid doing for polity *selection*. This
caveat is therefore carried as **prose, here, rather than as fabricated per-feature data**: a
consumer of this layer should treat every selected steppe/nomadic polity's territorial extent
as illustrative of scale and approximate reach, not as a precise, agreed border, regardless of
its `certainty` value — `certainty` here answers "is this window's row cross-referenced with
Seshat's own polity records", not "is this border agreed".

## Time convention

`t` = years before the fixed AD 2025 present, matching `sources/hyde`/`sources/cities`/
`sources/co2-o2`. Unlike `sources/cities`' `BC_<year>`/`AD_<year>` column-name parsing,
Cliopatria's `FromYear`/`ToYear` are already signed integers (negative = BCE), so one formula
covers every row: `t = 2025 - year`. **Since 2026-09-18, `t` is further bounded below at
`normalise.CUTOFF_T = 125.0`** (1900 CE) — see "Domain cutoff: 1900 CE" above; the curated
domain's newer edge is this cutoff, not the present.

## Measured volume

Raw (gitignored, `data/raw/cliopatria/`): the Zenodo repository-archive zip actually downloaded
is **49,215,745 bytes** (sha256-pinned in `manifest.toml`) — close to, but not exactly, the
task brief's "~44 MB zipped" estimate; the extracted `cliopatria.geojson` is **186,488,764
bytes**. Curated (measured 2026-09-18, after the label-normalisation and 1900-cutoff amendment):
`cliopatria_polities.parquet` holds **114 canonical polities across 1,803 surviving windows**
(down from the pre-amendment 121 polities / 2,010 windows — "Domain cutoff: 1900 CE" and
"Duplicate aggregate entries and label normalisation" above account for the full difference;
comfortably under the git storage tier's 5 MB threshold, the same size class as `sources/cities`'
own 1,736-feature parquet), and `cliopatria_extent.parquet` holds **842 frame references** (`t`,
`ref` — down from 921 pre-amendment, since no frame now falls after `CUTOFF_T`). Generated media
(`data/media/textures/cliopatria_extent/`, git-lfs, matching `sources/hyde`'s storage tier for
its own generated textures): one lossless WebP per frame at 1024×512 — 842 files.

## Storage tier chosen

**git** for both curated parquet files (small, per above). Generated textures follow
`sources/hyde`'s own precedent: **git-lfs**, committed into `data/media/`. Raw
`cliopatria.geojson` is gitignored and re-fetched from Zenodo via `fetch.py`.

## Fixture

`sources/cliopatria/fixture/cliopatria.geojson` is thirteen real, unmodified features (~48 KB)
from the real dataset, chosen to exercise every mechanism this source's `normalise.py`
implements:

- `Han Dynasty` at (-202,-198 BCE) and (6–13 CE), plus `(Han Dynasty)` at the *identical* two
  windows (confirmed identical `Area`/`SeshatID`) — the parenthesis-merge dedupe's main case;
- `(Han Dynasty)` at (224–237 CE), a window only the parenthesised label reports (`SeshatID`
  blank) — the "keep it, nothing to prefer over it" dedupe case, and a `MEDIUM`-certainty
  example;
- `Himyarite Kingdom` at (534–576 CE) — a small, simple `Polygon`, `SeshatID` blank;
- `Goguryeo` at (612–616 CE) — a `MultiPolygon`, `SeshatID` present (a `HIGH`-certainty
  example);
- `Atropates` (`Type = LEADER`, not `POLITY`) — must be dropped by the `Type` filter entirely;
- `Kingdom of Monaco`'s real four windows, (1815–1847), (1848–1935), (1936–1938) and
  (1939–1939) — added 2026-09-18 to exercise the 1900 cutoff end to end with real data, one
  small polity covering all three cases: the first window is entirely before 1900 and survives
  unchanged, the second straddles 1900 and is truncated to end there, and the last two start
  strictly after 1900 and are dropped entirely;
- `Greek Dark Ages` at (-1100,-1001 BCE) — added 2026-09-18, a real row for the non-polity
  exclusion; the dataset's two later `Greek Dark Ages` windows were left out, one real row being
  enough to exercise `_EXCLUDED_NAMES`.

Every one of the fixture's surviving canonical windows lands in its own 100-year bucket under
the real `BUCKET_YEARS`/`TOP_N` constants (no two distinct polities compete for the same
bucket), so all of them clear the subset rule trivially — this fixture tests the mechanics
(`Type` filtering, dedupe, schema, rasterisation, the 1900 cutoff, the exclusion list), not the
subset rule's own ranking/exclusion-by-competition behaviour, which
`tests/sources/test_cliopatria_subset.py` covers directly with synthetic data built
specifically to exercise exclusion (mirroring how `tests/test_notability.py` tests
`pipeline.notability.notable_features` with synthetic data rather than the real `cities`
fixture). The `British Colonial Empire`/`(British Empire)` alias merge is likewise tested with
synthetic `_RawPolityRow`s rather than added to the GeoJSON fixture — its real geometry is large
(tens of KB per feature, a global colonial empire), and the mechanism (`_NAME_ALIASES` lookup,
then the existing dedupe preference) needs only plain data to verify, not real polygons.

## Gotchas

- **`Area` is already in km², not degrees² or some other unit** — confirmed by spot-checking
  three well-known empires' peak areas against commonly cited figures (see "Format and
  schema"), not assumed from the column name.
- **Parenthesised names mean two different things** — a temporal-succession aggregate (has a
  bare counterpart, so stripping the parens merges it) or a genuinely distinct multi-state
  grouping (no bare counterpart, so stripping the parens is a plain rename with nothing to merge
  into). Both are now stripped unconditionally (2026-09-18) — see "Duplicate aggregate entries
  and label normalisation" above for why treating them identically for *display* is safe even
  though they are handled differently for *merging*.
- **Not every same-empire duplicate is a parenthesis pair** — `British Colonial Empire`/`(British
  Empire)` are the one confirmed case, fixed with a small explicit alias rather than a general
  rule (same section above). A future duplicate under two unrelated literal names would not be
  caught automatically.
- **The 1900 cutoff (`CUTOFF_CE_YEAR`) is provisional** — a per-user decision to see how the
  layer reads with modern nation-states excluded, not a permanent design constraint. See "Domain
  cutoff: 1900 CE" above before moving or removing it.
- **No border-uncertainty field, and no population field, at all** — both are prose-only
  caveats in this README and in `docs/DECISIONS.md`'s ADR-037, not fabricated data.
- **`FeatureSet.sample(t)` is not the right way to read this layer** — see "FeatureSet: one row
  per window, not per polity" above. A future renderer needs its own `t`-window check against
  each `Feature`'s single estimate's `t`/`t_end`.
- **`RasterSequence.sample(t)` crossfades; political borders change abruptly** — see
  "Rasterisation" above.

## New dependency: shapely

`shapely>=2.0` (`pyproject.toml`), used only in `normalise.py`: parsing `Polygon`/
`MultiPolygon` GeoJSON geometry, fixing an occasional self-intersecting polygon
(`geometry.buffer(0)`), and computing a guaranteed-interior `representative_point()` for label
anchors. BSD-licensed, GEOS-backed (bundled in the wheel — no system GDAL/PROJ/GEOS
installation needed, unlike `gplately`/`pygplates`), and not GPL — safe to import from the
pipeline without the `sources/gplately`-style licensing caveat. No other new dependency:
`httpx`, `tenacity`, `pydantic`, `numpy`, `pillow` are already declared and used identically to
their existing roles in `sources/paleodem`/`sources/hyde`.
