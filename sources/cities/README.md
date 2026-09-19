# Source: cities

Major historical cities, 3700 BC – AD 2000: `FeatureSet` (ADR-035), id `cities`. Curated data
keeps every city that survives the merge (1,736); the *published* layer is filtered down to a
much smaller "notable" set (164) by `pipeline.notability.notable_features`, applied in
`pipeline/publish.py` — see "Notability filter" below.

## Licence and access

Reba, M., Reitsma, F. & Seto, K.C. (2016), "Spatializing 6,000 years of global urbanization
from 3700 BC to AD 2000", *Scientific Data* 3:160034, doi:10.1038/sdata.2016.34.

**SEDAC is a dead end for scriptable access.** The dataset's own SEDAC listing
(doi:10.7927/H4ZG6QBX) redirects to `earthdata.nasa.gov/data/catalog/sedac-ciesin-sedac-uspat-hup-1.0`,
which lists only Excel/MOV/PDF/PNG assets — no direct CSV — and gates bulk downloads behind a
NASA Earthdata login.

**The real distribution is figshare, and it is fully open.** The paper itself
(`nature.com/articles/sdata201634`, open access) states its "Data Records" are three CSVs
deposited independently on figshare:

| Dataset | figshare DOI | Direct download |
|---|---|---|
| Chandler | 10.6084/m9.figshare.2059494 | `https://ndownloader.figshare.com/files/5407640` |
| Modelski Ancient | 10.6084/m9.figshare.2059497 | `https://ndownloader.figshare.com/files/5356132` |
| Modelski Modern | 10.6084/m9.figshare.2059500 | `https://ndownloader.figshare.com/files/5407637` |

Confirmed directly against the figshare API (`api.figshare.com/v2/articles/<id>`) for all
three: `"license": {"value": 1, "name": "CC BY 4.0", "url": "https://creativecommons.org/licenses/by/4.0/"}`.
**CC BY 4.0, permissive, redistributable in this public static site with attribution** — no
login, no scriptable barrier; `sources/cities/fetch.py` downloads all three directly.

## Format and schema

Three wide CSVs, latin-1 encoded (not UTF-8 — several accented place names fail to decode as
UTF-8; confirmed directly). Columns: `City, OtherName, Country, Latitude, Longitude, Certainty,
<one column per dated estimate>` — sparse (mostly blank), one row per city. Estimate columns are
named `BC_<year>` / `AD_<year>` (e.g. `BC_3700`, `AD_1000`), the same convention
`sources/hyde`/`sources/co2-o2` already use for calendar-year-to-`t` conversion.

- **Chandler**: 1,597 rows, 806 year columns spanning `BC_2250` → `AD_1975` (near-annual from
  the 16th century on).
- **Modelski Ancient**: 154 rows, 41 year columns spanning `BC_3700` → `AD_1000`.
- **Modelski Modern**: 293 rows, 1 year column (`AD_2000` only).

`Certainty` ∈ {1, 2, 3} — per the paper: "1" = geolocation confirmed by three independent
geocoding sources (most accurate), "2" = two sources agreed, "3" = required repeated attempts
(least reliable). Mapped to `pipeline.shapes.FeatureCertainty` (`HIGH`/`MEDIUM`/`LOW`) — a
closed enum, not the raw numeric code, so nothing downstream needs to know the dataset's own
numbering. No other codes appear in any of the three files (checked directly).

**Modern-name convention.** Historically-named cities are filed under their *modern* name, with
the historical name in `OtherName` — e.g. Chang'an is `Xian` (`OtherName: "Sian, Changan,
Xi'an"`), Constantinople is `Istanbul` (`OtherName: "Constantinople"`), Tenochtitlan is `Mexico
City` (`OtherName: "Tenochtitlan"`). `sources/cities` keeps the modern `City` value as `Feature.
name` and does not surface `OtherName` (not part of the curated shape) — a consumer wanting the
historical name would need it added as a future field.

## Dedupe policy

Chandler and each Modelski file overlap: **89** (city, country) pairs appear in both Chandler
and Modelski Ancient; **213** in both Chandler and Modelski Modern; **18** in both Modelski
files (measured directly by exact-match key). The paper's own text states its precedent for the
Chandler/Modelski-Ancient overlap: *"we selected Modelski's values, as his work focused on this
ancient time period... The final dataset retains both... values for users to select at their
discretion."* This source applies that same precedent uniformly to both Modelski files, rather
than inventing a separate rule for the modern overlap:

1. **Chandler is the base layer** (merged in first) — it alone spans the full 2250 BC – AD 1975
   range.
2. **Modelski Ancient is merged on top**, then **Modelski Modern on top of that.** For a (city,
   country) match, a Modelski file's own coordinates and certainty replace Chandler's, and any
   *exact-year* population estimate the two datasets both report is taken from Modelski, not
   Chandler (confirmed with a real conflict in the fixture: Rome's `AD_100`-equivalent year has
   Chandler reporting 450,000 and Modelski Ancient reporting 1,000,000 — the merged record keeps
   1,000,000). Estimates for years only one dataset reports are kept from whichever dataset has
   them — nothing is discarded just because its *city* was also seen elsewhere.
3. **Matching key**: exact-match, case-insensitive `(City, Country)`. This is a real, documented
   limitation — a city spelled or capitalised differently between datasets (there were none
   found in a direct check of the overlap sets) would be treated as two separate cities rather
   than merged. Not worth a fuzzy-matching pass for this dataset's actual overlap, which matched
   cleanly on this simple key throughout.
4. **Stable id**: an ASCII slug of `name-country` (e.g. `uruk-iraq`, `mexico-city-mexico`). No
   external stable id exists to key off (unlike, say, a Wikidata QID elsewhere in this project);
   a collision (two different (name, country) keys slugging to the same string) is resolved with
   a numeric suffix and would be a bug if it silently merged two different cities — verified
   directly that no such collision occurs in the real data.
5. **Dropped**: any row without valid `Latitude`/`Longitude` (0 rows, in practice — checked
   directly, none of the 2,044 raw rows across all three files is missing coordinates), and any
   row with no population estimate at all in every year column (1 row, in the real data).

**Measured (real data, full run, 2026-09-17):**

```
cities: 2044 raw rows across 3 datasets -> 0 dropped (no coordinates),
1 dropped (no estimates), 307 rows merged into an already-seen city,
1736 distinct cities kept
```

## Significance roster (published layer only)

The curated `FeatureSet` (`data/curated/cities.parquet`) keeps all 1,736 cities — nothing is
lost. **Publishing all 1,736 would overwhelm a globe view**, so the published layer is filtered
down to a much smaller set before `pipeline/publish.py` writes `layers/cities.json`.

**ADR-038 supersedes ADR-035's population-rank filter.** The original rule
(`pipeline.notability.notable_features`, now deleted) picked, within each 100-year era bucket,
whichever cities ranked in that bucket's own top 12 by peak attested population. That produced a
globe with catastrophically bad spread: **zero** cities in sub-Saharan Africa, **zero** in
Australia/New Zealand/the Pacific, only 4 in South-East Asia, 3 in South America and 7 in North
America — 150 of 164 published cities were Europe, the Mediterranean, the Near East, India and
China, dominated by ancient Mesopotamian city-states whose *attested* populations happened to
survive in this particular dataset even when tiny (per-user direction, 2026-09-18: "the cities
shown on the map shouldn't be based purely on population but perhaps significance").

**The mechanism is now a hand-curated roster, not a ranking rule.** `sources/cities/roster.toml`
is a checked-in, reviewable list — one `[[cities]]` entry per city, each an `id` (the `Feature.id`
this same source's `normalise()` assigns, e.g. `uruk-iraq`) and a short `reason` string.
`pipeline.publish.load_city_roster` parses it into a `CityRoster`; `pipeline.publish.
apply_city_roster` intersects it with the curated `FeatureSet`, keeping exactly the roster's
cities (in `FeatureSet`'s own sorted-by-id order) and **raising `CityRosterError`, naming every
offending entry, if any roster id has no match in the curated dataset** — a roster typo fails the
build loudly rather than silently shrinking the published globe. `pipeline/publish.py`'s
`_layers` applies this only to the `cities` `FeatureSet`, exactly where `notable_features` used
to be called.

**Selection criteria** (subjective, by design — this is a curated list, not a formula): imperial
and national capitals, great trading ports, religious centres, famous ancient sites, and modern
megacities, deliberately *not* every capital city (per-user direction: "not every single capital
city"). Every inhabited continent is represented, spanning eras from the 3rd millennium BC
(Uruk, Ur, Memphis) to the present (Lagos, Shanghai, São Paulo).

**Measured effect** (real data, 2026-09-18): **283 of 1,736 cities published** — widened from the
original 242 (see "2026-09-18 expansion" below); `MAX_ROSTER_SIZE` in
`tests/sources/test_cities_roster.py` was raised from 250 to 320 to accommodate. Region spread
(broad buckets, `tests/sources/test_cities_roster.py`'s own classification): sub-Saharan Africa
33, North Africa 8, Oceania/Pacific 8, South Asia 24, South-East Asia 21, Central Asia 11, East
Asia 26, Russia 12, Caucasus 3, Europe 45, Middle East 43, North America 15, Mexico 6, Caribbean/
Central America 10, South America 18 — every region the original population-rank filter left
empty now has real coverage. Every one of the ADR-035 era test cities is still published
(`uruk-iraq`, `memphis-egypt`, `babylon-iraq`, `rome-italy`, `xian-china`, `istanbul-turkey`,
`baghdad-iraq`, `mexico-city-mexico`, `london-united-kingdom`, `new-york-united-states-of-america`,
`tokyo-japan`).

**Cities the user asked for that the dataset cannot supply.** Checked directly against
`data/curated/cities.parquet`, not assumed: **Mombasa** has no entry under any name. Three others
the user believed absent are in fact present, filed under a different name than expected (see
"Modern-name convention" above) and are included in the roster: **Timbuktu** is `tombouctou-mali`
("Tombouctou"); **Benin City** is `benin-nigeria` ("Benin", coordinates match Benin City exactly);
**Great Zimbabwe** is `zimbabwe-zimbabwe` ("Zimbabwe", coordinates match the Great Zimbabwe ruins
near Masvingo, and its estimates span 1300–1450 CE — the historical Kingdom of Zimbabwe's own
era, not the modern capital Harare, which is a separate entry). Tenochtitlan and Saigon are not
missing either — both are filed under their modern names (`mexico-city-mexico`, `ho-chi-minh-
vietnam`), already this source's documented convention.

**2026-09-18 expansion.** A follow-up user report ("no cities in Africa in modern time, and some
missing from middle east and many from europe and russia") turned out to be two separate issues:
a rendering-side cull in `web/src/globe/cities.ts` (fixed separately, not in this source), and a
real roster gap, closed here by adding 41 cities: every Balkan and Baltic national capital
(Belarus, Bulgaria, Romania, Serbia, Bosnia and Herzegovina, Croatia, Slovenia, Slovakia, Malta,
Lithuania, Estonia, plus Latvia's Riga — filed under "Russian Federation" in this historical
dataset, not Latvia), the Caucasus (Tbilisi, Yerevan, Baku), the Maghreb (Casablanca, Marrakech,
Fez, Rabat, Algiers, Tunis, Carthage, Tripoli), six more Russian cities beyond Moscow/St
Petersburg/Novgorod/Kazan/Vladivostok (Yekaterinburg, Novosibirsk, Nizhny Novgorod, Volgograd,
Astrakhan, Sevastopol), Kuwait, Oman, Cyprus, Antioch, three more sub-Saharan capitals (Lusaka,
Ouagadougou, Port Louis), and a handful of Latin American/South-East Asian capitals sanity-checked
along the way (Montevideo, Asunción, San Salvador, Managua, Luang Prabang).

**Well-known cities that remain absent because the source has never heard of them** (checked
directly against the full curated `data/curated/cities.parquet`, not assumed — this is a
Chandler + Modelski "largest cities" dataset ending at AD 2000, not a gazetteer, so a city can be
famous today and simply not appear if it was never among the world's largest): **Kampala**
(Uganda), **Kigali** (Rwanda), **Bujumbura** (Burundi), **Dar es Salaam**'s neighbours aside,
**Brazzaville** (Republic of the Congo — only a mislabelled duplicate `kinshasa-congo` and the
historical `loango-congo` exist for that country), **N'Djamena** (Chad — only the historical
Bagirmi capital `masenya-chad` exists), **Niamey** (Niger — only the historical trade city
`agades-niger`, not added, exists), **Nouakchott** (Mauritania — only the historical
`oualata-mauritania` exists), **Porto-Novo**/**Cotonou** (Benin), **Gaborone** (Botswana),
**Windhoek** (Namibia), **Lilongwe**/**Blantyre** (Malawi), **Maseru** (Lesotho), **Mbabane**
(Eswatini), **Libreville** (Gabon), **Yaoundé** (Cameroon), **Malabo** (Equatorial Guinea),
**Bangui** (Central African Republic), **Juba** (South Sudan), **Asmara** (Eritrea), **Djibouti**
City, **Mogadishu** (Somalia); **Doha** (Qatar), **Dubai**/**Abu Dhabi** (UAE), **Manama**
(Bahrain) — Qatar, the UAE and Bahrain have no rows at all; **Tirana** (Albania — only the
historical `shkoder-albania` exists); **Vientiane** (Laos — only the historical royal capital
`luang-prabang`, which is what was added instead); **San José** (Costa Rica) and **Tegucigalpa**
(Honduras) — both countries have zero rows. None of these were substituted with invented
coordinates or a different dataset; they are simply not in Chandler/Modelski.

**Data-quality artefacts noticed.** The curated dataset carries a small number of duplicate
cities filed under differently-spelled or differently-named country values for the same
underlying place — a known limitation of the exact `(City, Country)` dedupe key documented above,
not something the 2026-09-18 pass introduced or corrected, and still not fixed (out of this
source's scope): `kinshasa-democratic-republic-of-the-congo` and `kinshasa-congo` are the same
city; `algiers-algeria` and `algiers-algiers` are the same city; `montevideo-uruguay` and
`montevideo-uraguay` are the same city (only the correctly-spelled id was added to the roster).
Separately, three confirmed exact-10x population misreadings *have* now been corrected — see
below.

**`montevideo-uruguay`'s published figure was wrong, and the error is upstream, not a merge
artefact — now corrected.** Its only estimate, `AD_2000` = 13,303,000, comes from a single row in
`modelskiModernV2.csv` (`Montevideo,,Uruguay,-34.817311,-56.158866,1,13303000`) — confirmed
directly against the raw file, so this was not something `merge_datasets`'s overwrite rule
introduced. Real Montevideo was on the order of 1.3 million people in 2000, roughly a tenth of
the published figure; the pattern (a single reading exactly 10x too large, with no such
distortion in the readings around it) recurs elsewhere in these same three CSVs — see below. This
was the largest population figure the whole `cities` FeatureSet published at `t=25` (year 2000),
ahead of Seoul, São Paulo and Mumbai, which is how it surfaced on the globe. The
`montevideo-uraguay` duplicate does not carry this error, but it also has no `AD_2000` reading of
its own (its newest is `AD_1975`, 1,430,000) — it is not a case of "the duplicate has the right
number for this year", it simply predates the bad reading. Note also that fixing the
`Uruguay`/`Uraguay` dedupe-key mismatch in `normalise.py` would not, by itself, have fixed this
figure — Modelski Modern is merged in with `overwrite=True`, so its `AD_2000` reading would still
land in the merged record even if the two rows keyed together.

**The same shape of error recurs at least three times more, two of them now also corrected.**
`philadelphia-united-states-of-america`'s `AD_1914` reading (`chandlerV2.csv`) was 17,600,000,
bracketed in the same row by 1,418,000 (`AD_1900`) and 2,085,000 (`AD_1925`) — again exactly 10x
an otherwise plausible trajectory, and again confirmed directly in the raw CSV, not introduced by
this source. Philadelphia is in the roster, so this was a second real bug affecting the published
globe (a marker that ballooned to 17.6 million people for one attested year, more than any city
has ever held, then dropped back). `delhi-india`'s `AD_1375` reading was 1,250,000, bracketed by
two readings of exactly 125,000 (`AD_1350`, `AD_1398`) either side, in the same `chandlerV2.csv`
row — the same exact-10x signature; Delhi is also in the roster. A fourth, lower-confidence
instance: the unpublished `algiers-algiers` duplicate's `AD_1925` reading (2,220,000) is roughly
8x its neighbours (140,000 in 1900, 430,000 in 1950) — the same shape, but a weaker match (not
exactly 10x) and not published, since the roster uses `algiers-algeria` instead.

**Three of these four are now corrected by `POPULATION_ERRATA`, an explicit errata table in
`sources/cities/normalise.py`.** Each entry names the feature id, the raw `AD_<year>` column, the
exact wrong value it expects to find, and the corrected value, with a one-line reason.
`normalise()` applies the table after feature ids are assigned: for any erratum whose feature is
present in the run, it first asserts the reading at that feature's column is *exactly* the
recorded wrong value, and only then substitutes the correction — raising `CitiesErratumError`
(not silently dividing) if a present feature's reading has already changed, e.g. because a
re-fetch fixed it upstream. (An erratum whose feature isn't present at all in a given run — such
as this source's own trimmed test fixture, which doesn't include any of these three cities — is
a no-op, not an error, since a partial dataset legitimately doesn't cover every named city.) The
fourth case, `algiers-algiers`'s `AD_1925` reading, is deliberately **not** in the table and
remains uncorrected: it is ~8x its neighbours rather than exactly 10x, its neighbours are a
weaker match, and it isn't published in the first place — not worth the same confidence bar as
the other three.

Re-run the measurement with `python -c "from pathlib import Path; from pipeline.curated import
read_shape; from pipeline.publish import apply_city_roster, load_city_roster; fs =
read_shape(Path('data/curated/cities.parquet')); roster =
load_city_roster(Path('sources/cities/roster.toml')); print(len(apply_city_roster(fs,
roster).features))"` after any upstream data or roster change.

## Time convention

`t` = years before the fixed AD 2025 present, matching `sources/hyde`/`sources/co2-o2`. For an
`AD_<year>` column: `t = 2025 - year`. For a `BC_<year>` column: `t = 2025 + year` (treating
"3700 BC" as exactly 3,700 years before 1 CE, the same simplification `sources/hyde` documents
for its own BCE tags — immaterial at this timescale).

## Measured volume

Raw (gitignored, `data/raw/cities/`): 1,448,474 bytes across the three CSVs (Chandler
1,416,656 + Modelski Ancient 16,764 + Modelski Modern 15,054 — exact figures, not estimates).
Curated `data/curated/cities.parquet`: 1,736 features, comfortably under the git storage tier's
5 MB threshold.

## Storage tier chosen

**git** for the curated parquet (small). Raw CSVs are gitignored and re-fetched from figshare
via `fetch.py`, matching every other source's `data/raw/` convention.

## Fixture

`sources/cities/fixture/{chandlerV2,modelskiAncientV2,modelskiModernV2}.csv` are the real
downloaded files, trimmed to 13/6/6 rows respectively (~28 KB total) — every column kept
unmodified (so `normalise()` never special-cases a narrower schema), rows selected to exercise
every merge case this source's dedupe policy handles: a city in all three datasets (Rome,
Aleppo), a city in Chandler + Modelski Ancient only (Babylon, Memphis, Uruk), a city in Chandler
+ Modelski Modern only (London, New York, Tokyo), and a city in exactly one dataset (Baghdad,
Istanbul, Mexico City, Xian, York from Chandler; Eridu from Modelski Ancient; Cairo from
Modelski Modern) — including a real, confirmed Chandler/Modelski-Ancient numeric conflict
(Rome's shared year) to test precedence, not just presence.

## Gotchas

- **SEDAC's own listing is a dead end** for scriptable, unauthenticated access — the real
  distribution is figshare (see "Licence and access" above). Confirmed directly, not assumed
  from documentation.
- **Latin-1 encoding, not UTF-8** — several accented place names in the raw CSVs raise a
  `UnicodeDecodeError` if opened as UTF-8.
- **Historically-named cities are filed under their modern name** (Xian, not Chang'an;
  Istanbul, not Constantinople; Mexico City, not Tenochtitlan) — `OtherName` carries the
  historical name but is not part of the curated shape.
- **`OtherName` is not curated.** A future pass wanting to surface a historical name (for a
  caption, say) would need to add it as a new `Feature` field — an additive, backward-compatible
  change to the shape, not a breaking one.

## No new dependencies

`httpx`, `tenacity`, `pydantic` are already declared (`pyproject.toml`, used identically to
`sources/co2-o2`'s own multi-artefact `fetch.py`). No new dependency introduced.
