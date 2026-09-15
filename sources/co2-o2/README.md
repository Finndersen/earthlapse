# Source: co2-o2

Atmospheric CO2 from 570 Ma to AD 2025, spliced from three upstream files into one `co2`
`TimeSeries`:

| Segment | File | What it is | Rows kept |
|---|---|---|---|
| Instrumental | `co2_annmean_mlo.txt` (NOAA GML) | Mauna Loa annual means, AD 1959–2025 | 67 of 67 |
| Ice core | `antarctica2015co2composite.txt` (NOAA NCEI) | Bereiter et al. 2015 Antarctic composite, ~806 ka to AD 2001 | 1,853 of 1,901 |
| Model | `phanerozoic_co2.txt` (NOAA NCEI) | GEOCARB III (Berner & Kothavala 2001), 570 Ma to 0 Ma every 10 Myr | 57 of 58 |

Per-file url, sha256, licence and citation are in `manifest.toml` `[[artefacts]]`.

## Time: one output convention, three input conventions

`t` is **years before the fixed AD 2025 present**, the convention `data/events.yaml` and
ADR-024 already use.

| File | Input column | Conversion |
|---|---|---|
| Mauna Loa | `year`, CE | `t = 2025 − year` |
| Ice core | `age_gas_calBP`, years before **AD 1950** | `t = age + 75` |
| GEOCARB III | `Time(Ma)`, negative Myr | `t = abs(Ma) × 1e6` |

The **75-year offset** matters. Without it the ice-core record shifts 75 years young, and near
the present that is most of the industrial rise. GEOCARB is not re-based: 75 years is far
below its 10 Myr spacing.

If Mauna Loa ever lists a year after 2025, `normalise.py` **raises** instead of producing
negative `t`. Moving the present is a project-wide change (events, eras, this source), not a
re-pin.

## Splice policy

Segments are taken newest first. Each keeps only the samples **strictly older** than every
sample of the segments before it. The result is disjoint in `t` by construction, and the
normaliser also rejects duplicate `t` within a segment. `TimeSeries` itself does not reject
duplicates.

- **Mauna Loa vs ice core, boundary t = 66 (AD 1959).** Measurements beat firn/ice. The 48
  composite rows from AD 1959–2001 (age ≤ −9 BP) are dropped. The seam is smooth: the youngest
  kept ice-core row is 316.3 ppm at t = 66.44, next to Mauna Loa's 315.98 at t = 66.
- **Ice core vs GEOCARB, boundary t = 805,743.87.** Measurements beat the model. GEOCARB's 0 Ma
  value (276.6 ppm) is dropped: it is a pre-industrial baseline with no fossil-fuel forcing,
  and it used to make the whole last 10 Myr read ~277 ppm.
- **No crossfade.** Neither boundary needs one. The first is a 0.4 ppm step inside overlapping
  error bars. At the second there is nothing to blend: the next older sample is 10 Myr away.
- Law Dome is **not** a separate input. The composite already uses it for its youngest
  segments (Rubino et al. 2013 for −51 to 1,800 BP, MacFarling Meure et al. 2006 for 1.8–2 kyr
  BP), so adding `law2006.txt` would count the same core twice.

Interpolation is **log-linear** throughout (linear in log-CO2). Across the record the value
varies by more than an order of magnitude.

Resulting values, from the committed fixtures:

| t | 0 | 7 | 15 | 56 | 67 | 200 | 275 | 21 ka | 125 ka | 800 ka | 3 Ma | 10 Ma |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ppm | 427.4 | 408.7 | 390.1 | 324.6 | 315.4 | 281.9 | 277.2 | 191.4 | 275.8 | 199.6 | 222.2 | 277.2 |

## Schemas

**`co2_annmean_mlo.txt`**: ASCII, `#` comment header, then whitespace-separated
`year mean unc` rows (the column header itself is a `#` comment). `mean` and `unc` are ppm.

**`antarctica2015co2composite.txt`**: UTF-8 **with a BOM**, **CRLF** line endings, a `#`
NOAA template header, then the tab-separated header line `age_gas_calBP co2_ppm co2_1s_ppm`,
then data. Sorted by age with no duplicate ages. `co2_1s_ppm` is 1σ; where no individual
sigma was measured, the file uses the record's average.

**`phanerozoic_co2.txt`**: a ~74-line prose header, then a `DATA:` marker, a
`Time(Ma)  RCO2` header and 58 rows. **`RCO2` is a ratio to 280 ppm, not ppm**:
`co2_ppm = RCO2 × 280`. Skipping the multiply leaves the series around 1.0. It is still a small
positive float, so the mistake is easy to miss in a spot check.

## Uncertainty

`Sample.lower`/`upper` = `value ∓ sigma`, using each file's own column: Mauna Loa `unc`
(±0.12 ppm) and ice-core `co2_1s_ppm`. GEOCARB III has no per-point error column, so its rows
keep `None`. Its sensitivity ranges are published in the paper, not in this file, and an
invented band would misrepresent the source.

## Known gaps and caveats

- **~806 ka to 10 Ma has no data.** A log-linear bridge across it would run from 207 ppm (oldest
  ice) to 277 ppm (GEOCARB 10 Ma) — not a gentle under-read: it would put 3 Ma at ~222 ppm, a
  glacial low, where Pliocene proxies give ~350–400 ppm. `normalise.py` declares this span a
  `TimeSeries.Gap` (ADR-027, accepted 2026-09-15 on the user's decision to leave it unfilled
  rather than source a Cenozoic proxy) between the ice-core segment's oldest kept row and
  GEOCARB's oldest-surviving row, located from `_splice`'s real per-segment kept-row counts, not
  a hard-coded age — a re-pinned ice core or a narrower/wider splice moves the gap with it:
  - `TimeSeries.sample`/`sampleSeries` return `None`/`null` strictly inside it, same as outside
    `domain`;
  - `pipeline/prompts.py` `_render_atmosphere` renders "no CO2 record covers this interval"
    there, reading `WorldState.atmosphere.co2_domain` (the `co2` series' own domain) rather than
    a hand-kept span — `tests/sources/test_co2.py` pins the gap's indices to this source's splice
    boundaries;
  - the HUD readout says "no record", and the sparkline and chart break their line across it
    instead of plotting the bridge.
- **No usable Cenozoic proxy file was found** (checked 2026-09-14):
  - CenCO2PIP 2023 (Science 382, eadi5177): no pinnable file found. paleo-co2.org is a script-driven
    site with no direct data links, and NCEI's `trace_gases/Paleo-pCO2/` holds only two boron
    product files and two stomatal calibrations, not the compiled curve.
  - Rae et al. 2021 (NCEI `trace_gases/rae2021/rae2021alkenone-co2anchored.txt`, public domain):
    alkenone-only, from three sites. The sites disagree 2–4× at the same age (around 3 Ma, site
    999 reads 116–342 ppm and site 806 reads 403–526), and the paper's boron-isotope curve is not
    in the NCEI files. Merging these into one series would mean inventing a smoothing the
    source does not publish, so it is not used.
- **Coverage stops at 570 Ma.** `TimeSeries.sample` returns `None` beyond it, with no
  extrapolation.
- **The Mauna Loa file is regenerated upstream every month** (its header "File Creation"
  timestamp changes, and NOAA revises recent years). The pinned sha256 therefore goes stale,
  and `make data` on a fresh raw directory fails loudly with `FetchIntegrityError`. That is
  intended. To re-pin: download, check that no year after 2025 appeared, update `sha256` in
  `manifest.toml`, and replace the fixture file.
- No O2 column: GEOCARB III is CO2-only. See the deviations below.

## Measured volume

- Raw: 3,696 + 50,236 + 5,378 = 59,310 bytes.
- Curated `data/curated/co2.parquet`: one `TimeSeries`, 1,977 rows, tens of KB.

## Storage tier chosen

**git.** The curated output is far under the 5 MB git threshold. The fixtures are the three
whole real files, byte-identical to what `fetch.py` verifies (a test checks their sha256
against the manifest). They are small (59 KB in total), and cutting them would move the splice
boundaries away from the production ones.

## Deviations from docs/DATA_SOURCES.md

- `docs/DATA_SOURCES.md` originally listed "`TimeSeries` × 2 (CO2 ppm, O2 %)". None of the
  three files has O2, so this source emits only `co2`. An O2 layer would need a different
  source (e.g. GEOCARBSULF or Berner 2006).
- The splice lives inside this one source, not in sibling sources. Curated files are keyed by
  shape id, and `WorldModel.at` reads a single `co2` series, so a second source writing `co2`
  would silently overwrite this one.
