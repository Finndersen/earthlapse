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

## Notability filter (published layer only)

The curated `FeatureSet` (`data/curated/cities.parquet`) keeps all 1,736 cities — nothing is
lost. **Publishing all 1,736 would overwhelm a globe view** (per-user direction, 2026-09-17):
"only need to include major notable cities, not everything." The published layer must therefore
apply a documented, data-driven notability rule, target roughly 100–200 cities, and ensure every
era has some (explicitly named test cases: Uruk, Memphis, Babylon, Rome, Chang'an [`Xian`],
Constantinople [`Istanbul`], Baghdad, Tenochtitlan [`Mexico City`], London, New York, Tokyo).

**The rule** (`pipeline.notability.notable_features`, applied in `pipeline/publish.py`'s
`FEATURE_LAYERS` loop): a city qualifies if, within any **100-year-wide era bucket** (`t` rounded
to the nearest century), its **peak attested population within that bucket ranks in that
bucket's own top 12**.

Two things this rule is deliberately *not*:

- **Not a literal per-exact-attested-date top-25.** The merged dataset has ~825 distinct
  attested years (near-annual for the last few centuries), and a literal per-date ranking churns
  through a slightly different set of ~25 cities almost every year as populations near the
  cutoff fluctuate — even at a much smaller N (5), the *union* across every date balloons past
  600 cities (measured directly), overshooting the 100–200 target by 3–4x regardless of N.
  Bucketing to a century is what keeps the same era-dominant cities in the set across most of
  their own bucket's span, rather than rewarding one dataset's finer year-sampling in the recent
  past with proportionally more "new" entrants.
- **Not a global cutoff.** Ranking happens *within* each bucket, not against the dataset's own
  all-time maximum — a Bronze Age city never has to out-rank a modern megacity; it only has to
  out-rank its own contemporaries. This is what "era-relative" means here, and it is what lets a
  city like Uruk (peak ~40,000) and Tokyo (peak ~37,000,000) both qualify from the same rule.

**Measured effect** (real data, `CITIES_NOTABLE_BUCKET_YEARS = 100`, `CITIES_NOTABLE_TOP_N =
12`, both in `pipeline/publish.py`): **164 of 1,736 cities published** — squarely inside the
100–200 target. All eleven named test cities are present (`uruk-iraq`, `memphis-egypt`,
`babylon-iraq`, `rome-italy`, `xian-china`, `istanbul-turkey`, `baghdad-iraq`,
`mexico-city-mexico`, `london-united-kingdom`, `new-york-united-states-of-america`,
`tokyo-japan`), and every era bucket back to the oldest (the 4th millennium BC) has at least one
member (Uruk/Eridu-era Mesopotamian cities).

`N=12`/`100y` was chosen empirically (`N` values of 5/8/10/12/15/20/25 with a 100-year bucket
were measured directly; `N=12` was the smallest tried that still included every named example
city while landing centrally in the target range — `N=10` also included every example city, at
145 total, and would be an equally defensible choice). Re-run the measurement with
`python -c "from pathlib import Path; from pipeline.curated import read_shape; from
pipeline.notability import notable_features; fs = read_shape(Path('data/curated/cities.parquet'));
print(len(notable_features(fs, bucket_years=100.0, top_n=12).features))"` after any upstream
data change.

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
