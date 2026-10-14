# Source: un-wpp

The world's total population each year from 1950 to AD 2025, from the UN's World Population
Prospects 2024, as the `population_wpp` `TimeSeries`. `pipeline/curated.py` joins it ahead of
HYDE 3.2.1's `population` (`sources/hyde`), so the HUD's "Global population" reads HYDE from
10,000 BCE to 1940 and the UN from 1950 to the present (ADR-063).

## File

`WPP2024_TotalPopulationBySex.csv.gz` (16,980,593 bytes): every location and projection variant,
1950–2100, from the WPP 2024 "CSV format" downloads. Url and sha256 are in `manifest.toml`.

## Rows kept

`Location == "World"` and `Variant == "Medium"`, for `Time` up to 2025: 76 rows. In the medium
variant, 1950–2023 are estimates and 2024–2025 are the medium projection. `PopTotal` is in
thousands and is multiplied out to people.

## Time

`Time` is a CE year, the population at 1 July. `t = 2025 − year`, against the fixed AD 2025
present; years after 2025 are dropped.

## Seam with HYDE

| Year | HYDE 3.2.1 | WPP 2024 |
|---|---|---|
| 1950 | 2,529,781,000 | 2,493,092,848 |
| 1960 | 3,022,818,000 | 3,015,470,894 |
| 2015 | 7,256,965,000 | 7,470,491,872 |

The two agree to 1.5% at 1950 and drift apart to 2.9% by 2015, so the seam sits at the UN record's
own start. HYDE's post-1950 totals were themselves calibrated to an earlier WPP revision.

## Licence

CC BY 3.0 IGO (United Nations, Department of Economic and Social Affairs, Population Division).

## Fixture

The real file cut to the World medium-variant rows to 2030, plus the World low variant for 2024–25
and Africa for 1950 and 2025, so the test exercises the row filter: 86 rows, 2.6 KB gzipped.

## Storage tier chosen

**git** — one small parquet file (76 samples).
