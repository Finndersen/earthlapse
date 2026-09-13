# Source: co2-o2

GEOCARB III (Berner & Kothavala 2001) modelled atmospheric CO2 over the Phanerozoic.
Fetched from NOAA's WDC Paleoclimatology mirror.

## Schema

Fixed-width text, ~74-line human-readable header (citation, abstract, methodology) then a
`DATA:` marker followed by two whitespace-separated columns, one header line
(`Time(Ma)  RCO2`), then 58 data rows at exactly 10 Myr spacing from -570 to 0:

```
Time(Ma)  RCO2

-570    11.70362
-560    16.26684
...
0       0.9879701
```

- **Column 1, `Time(Ma)`** — millions of years, **negative** into the past.
  `t` (years BP, the project's time convention) = `abs(Ma) * 1e6`.
- **Column 2, `RCO2`** — atmospheric CO2 as a **dimensionless ratio to the pre-industrial
  baseline** (defined as 280 ppm by GEOCARB), *not* ppm.
  `co2_ppm = RCO2 * 280`.

No uncertainty/error-bound column ships with this file, and no O2 column either — GEOCARB
III is a CO2-only model. The MVP curated shape is CO2-only, matching what the source
actually contains.

## Gotchas

- **RCO2 is a ratio, not ppm.** `co2_ppm = RCO2 * 280`. Skipping the multiply leaves the
  series hovering around 1.0 instead of ~280 — wrong by 280x and, because it's still a
  small positive float, easy to miss in a spot check. Verified: RCO2 at 0 Ma is
  `0.9879701` → `276.6` ppm (present-day pre-industrial-referenced CO2, roughly right for
  a model with no fossil-fuel-era forcing built in — not 0.988 ppm).
- **`Time(Ma)` is negative.** `t = abs(Ma) * 1e6`, not `Ma * 1e6` (which would yield
  negative `t` and violate `GeoTime`'s "positive into the past" convention) and not `-Ma *
  1e6` misapplied at the wrong sign.
- **Coverage stops at 570 Ma** (`t = 5.7e8`). That is ~12.4% of Earth's 4.567 Ga history.
  `TimeSeries.sample(t)` already returns `None` outside `domain` — there is no
  extrapolation and none should be added.
- **No uncertainty column.** `Sample.lower`/`Sample.upper` are left `None`. Do not invent
  an error band; GEOCARB III publishes sensitivity ranges in the paper, not per-point
  bounds in this file, and fabricating one would misrepresent the source.
- Range checkpoints (verified against the fetched file, matching `ONESHOT_SCOPE.md`):
  RCO2 min `0.9879701` @ 0 Ma (→ 276.6 ppm), RCO2 max `26.18222` @ 520 Ma (→ 7331.0 ppm).
- Interpolation is **log-linear** (linear in log-CO2) — correct for a quantity that varies
  over more than an order of magnitude across the record; a linear blend between, e.g.,
  340 Ma and 350 Ma underestimates the drop by ~27 ppm relative to log-linear.

## Measured volume

- Raw file: 5,378 bytes (measured via `sha256sum`/`wc -c` on the fetched file, well under
  the documented "< 100 KB").
- 58 data rows.
- Curated `data/curated/co2.parquet`: single `TimeSeries` shape, 58 rows — a few KB.

## Storage tier chosen

**git.** Curated output is a few KB, far under the 5 MB git tier threshold in
`docs/DATA_SOURCES.md` § Storage policy. The fixture is the entire real raw file (it's
already tiny), so `sources/co2-o2/fixture/phanerozoic_co2.txt` is byte-identical to what
`fetch.py` downloads.

## Deviations from docs/DATA_SOURCES.md

- `docs/DATA_SOURCES.md` lists the shape as "`TimeSeries` × 2 (CO2 ppm, O2 %)". The
  fetched GEOCARB III file has no O2 column — it is a CO2-only model — so this source
  emits a single `TimeSeries` (`id="co2"`). An O2 layer would need a different source
  (e.g. a GEOCARBSULF or Berner 2006 compilation) and is out of scope for this package.
