# Source: global-temp

Absolute global mean surface temperature (°C) from 482 Ma to AD 2025, spliced from three upstream
files into one `mean_temp` `TimeSeries` — the series `WorldState.climate.mean_temp_c` reads and
the HUD's temperature readout plots.

| Segment | File | What it is | Rows kept |
|---|---|---|---|
| Instrumental | `HadCRUT.5.2.0.0.analysis.summary_series.global.annual.csv` (Met Office) | HadCRUT5 global annual mean anomaly, AD 1850–2025 | 176 of 177 |
| Reanalysis | `LGMR_GMST_climo.nc` (NOAA NCEI) | Osman et al. 2021 Last Glacial Maximum Reanalysis, ensemble mean GMST, 24–0 ka in 200-year bins | 119 of 120 |
| Phanerozoic | `PhanDA_GMSTandCO2_percentiles.csv` (GitHub) | Judd et al. 2024 PhanDA, one GMST per geological stage, 485 Ma to the Holocene | 84 of 85 |

Per-file url, sha256, licence and citation are in `manifest.toml` `[[artefacts]]`.

## Absolute temperatures

HadCRUT5 reports anomalies against 1961–1990. They are made absolute with that period's mean,
14.0 °C (Jones et al. 1999, Reviews of Geophysics 37:173–199, the climatology HadCRUT's
anomalies are defined against). LGMR and PhanDA report absolute GMST already.

The seams agree within their own uncertainty. HadCRUT5's AD 1850 is 13.57 °C beside LGMR's
13.49 °C for the 0–200 BP bin. PhanDA's Holocene stage mean, 13.99 °C (5th–95th percentile
12.97–14.54), sits 0.5–0.9 °C above LGMR's mid-to-late Holocene (13.1–13.5 °C); that stage is
dropped in the splice anyway (below).

## Time

`t` is years before the fixed AD 2025 present.

| File | Input column | Conversion |
|---|---|---|
| HadCRUT5 | `Time`, CE year | `t = 2025 − year` |
| LGMR | `age`, years before AD 1950 | `t = age + 75` |
| PhanDA | `AverageAge`, stage midpoint in Ma | `t = Ma × 1e6` |

HadCRUT5's newest row is the running mean of the current, incomplete year. A row after AD 2025
lies past `t = 0` and is dropped rather than raising, since every monthly regeneration of the file
carries one.

## Splice policy

Segments are taken newest first; each keeps only the samples strictly older than every sample of
the segments before it (the same rule as `co2-o2`).

- **HadCRUT5 vs LGMR, boundary t = 175 (AD 1850).** LGMR's 100 BP bin falls exactly on
  HadCRUT5's AD 1850 and is dropped; its 300 BP bin (t = 375) is the newest it keeps.
- **LGMR vs PhanDA, boundary t = 23,975.** PhanDA's Holocene stage (midpoint 5,850 years) lies
  inside the reanalysis and is dropped. Its Upper Pleistocene stage, a mean over 11.7–129 ka with
  its midpoint at 70,350 years, is the next sample.
- **No declared gap.** The series interpolates linearly from LGMR's oldest bin (7.4 °C) to that
  Upper Pleistocene mean (11.4 °C). The ramp is a stage average meeting a single glacial, not a
  reconstruction of 24–70 ka.

## Resolution, and what it cannot show

PhanDA gives one value per geological stage, so before 24 ka the series is a sequence of stage
means: glacial cycles older than the last are averaged away (the whole Chibanian, 129–774 ka,
reads 11.8 °C). A Plio-Pleistocene GMST stack at glacial-cycle resolution (Clark et al. 2024,
Science 383:884) would fill 24 ka–4.5 Ma; its data were not found in NOAA NCEI or PANGAEA when
this source was built.

## Uncertainty

Each sample carries its file's own band, all at roughly 90–95% coverage: HadCRUT5's 2.5–97.5%
limits, LGMR's ensemble mean ± 1.96 standard deviations, PhanDA's 5th–95th percentiles.

## Licences

- **HadCRUT5:** Open Government Licence v3.
- **LGMR:** NOAA NCEI distributes it without restriction; its study JSON names no licence and
  requests citation (the same standing as LR04's NCEI copy).
- **PhanDA:** ⚠️ no licence stated. The repository has no licence file; the paper's data
  statement says the GMST values are publicly available there. Citation is given regardless.

## Reading the file

`LGMR_GMST_climo.nc` is netCDF4 (HDF5), read through the optional `data` extra
(`pip install -e '.[data]'`, xarray + netCDF4), as `paleodem` does. The source test that runs the
whole splice skips without it; the HadCRUT5 and PhanDA parsers are tested either way.

## Fixture

The three upstream files whole (41.6 KB together), byte-identical to the pins.

## Measured volume

41,586 bytes raw; 379 curated samples.

## Storage tier chosen

**git** — one small parquet file.
