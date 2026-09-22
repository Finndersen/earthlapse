# Source: lr04

The LR04 global benthic δ¹⁸O stack (Lisiecki & Raymo 2005): 57 deep-sea records aligned into
one curve, 0–5.32 Ma, sampled every 1 kyr to 600 ka, then every 2–5 kyr. It drives the globe's
rough Cenozoic ice age (docs/GLOBE.md §5.1): ice-sheet extent and the glacial sea-level lowstand.

Three curated `TimeSeries`, all linear:

| Id | Unit | What |
|---|---|---|
| `benthic_d18o` | ‰ | the stack, with its own one-standard-error band |
| `sea_level` | m | approximate global mean sea level relative to present (`WorldState.climate.sea_level_m`) |
| `ice_volume` | LGM = 1 | normalised ice volume: 0 today, 1 at the Last Glacial Maximum |

`sea_level` and `ice_volume` are published as `globe`-surface scalar layers
(`pipeline/publish.py`'s `SCALAR_LAYERS`); `benthic_d18o` is curated only.

## Access and licence

- **File:** `https://www.ncei.noaa.gov/pub/data/paleo/contributions_by_author/lisiecki2005/lisiecki2005-d18o-stack-noaa.txt`
  — NOAA NCEI's "Template File" for study 5847 (dataset DOI 10.25921/k88j-0106), 40,651 bytes,
  sha256 in `manifest.toml`. Static archive path, `File_Last_Modified_Date 2024-05-01`, plain
  HTTPS, no auth. The older free-text `lisiecki2005.txt` beside it carries the same numbers with
  a harder-to-parse header.
- **Licence:** NCEI's copy states no licence, only "please cite" (its study JSON's
  `dataLicenseDescription` is null). The identical table is published on PANGAEA as
  doi:10.1594/PANGAEA.701576 under **CC-BY-3.0**, which grants redistribution with attribution;
  the two were compared row by row (2,115 rows, identical). That is the licence relied on here;
  the citation is in `manifest.toml`.

## Time

LR04 ages are thousands of years before **AD 1950**; `t` is years before the fixed AD 2025
present, so `t = age_ka × 1000 + 75`, as for the co2-o2 ice core. The newest sample is therefore
`t = 75`; the globe holds it through to `t = 0` (`web/src/globe/ice/iceAge.ts`).

## Calibration

δ¹⁸O is mapped linearly to ice volume on two anchors taken from the stack itself:

- **Present:** the 0 ka value, 3.23‰ → 0.
- **Last Glacial Maximum:** the mean over EPILOG's LGM chronozone, 19–23 ka (Mix, Bard &
  Schneider 2001, QSR 20:627–657), 4.92‰ → 1, i.e. −134 m of global mean sea level (Lambeck et
  al. 2014, PNAS 111:15296–15303, doi:10.1073/pnas.1411762111).

That is about −79 m per ‰. It gives −133 m at 21 ka, +7 m in the Eemian (125 ka; the literature
has +6–9 m), −147 m at the deepest glacial (MIS 12/16) and up to +46 m in the warmest Pliocene
peaks.

**This is rough, and says so.** Benthic δ¹⁸O is ice volume *plus* deep-water temperature; roughly
a third to a half of the glacial signal is temperature. A single linear scaling therefore
overstates warm-period highstands (the mid-Pliocene is usually put at +10–25 m) and is not a
sea-level reconstruction. Spratt & Lisiecki 2016 (NCEI study 19982) is a proper sea-level stack
for 0–800 ka, should a future layer need one. The derived series carry no uncertainty band: the
calibration error dominates the stack's standard error, and propagating only the latter would
understate it. The globe draws only the lowstand; highstands are not drawn.

Derived values are rounded to 0.1 m and 1e-4 of LGM ice: the stack reports δ¹⁸O to 0.01‰, about
0.8 m of sea level.

## Fixture

`fixture/lisiecki2005-d18o-stack-noaa.txt` is the real file with its header intact and its data
table cut to three slices: 0–130 ka (both calibration anchors), 2.69–2.71 Ma and 5.30–5.32 Ma
(the record's end). 145 rows, 9 KB.

## Measured volume

40,651 bytes raw; 2,115 rows per curated series.

## Storage tier chosen

**git** — three parquet files, ~62 KB together.
