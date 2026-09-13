# Source: astronomy

Four `TimeSeries` describing the Earth-Sun-Moon system over deep time: `day_length`,
`moon_distance`, `solar_luminosity`, `obliquity`. Per `docs/DATA_SOURCES.md` Tier 3,
this source is **computed, not sourced** — there is no upstream file, no `data/raw/`,
and `fetch.py` is a documented no-op. Every value traces to either a closed-form
formula or a specific cited published measurement; nothing is estimated by this
package itself.

## Schema

Standard `TimeSeries` parquet (see `pipeline/curated.py`), one file per id:

| id | unit | domain (years BP) | interpolation |
|---|---|---|---|
| `day_length` | `h` | `[0, 2.46e9]` | linear |
| `moon_distance` | `km` | `[0, 2.46e9]` | linear |
| `solar_luminosity` | `relative` | `[0, 4.567e9]` | linear |
| `obliquity` | `deg` | `[0, 2.5e8]` | linear |

Each series is built from either:
- a **closed-form formula** (`solar_luminosity` only — Gough 1981), sampled on a
  dense log-spaced grid (200 points, finer near the present), or
- a small set of **cited checkpoints**, piecewise-linearly interpolated and then
  *also* sampled onto the same dense grid (see "Why dense-sample a piecewise-linear
  curve?" below).

`Sample.lower`/`Sample.upper` carry the checkpoint's own published uncertainty band
where the literature gives one; `solar_luminosity` has none (it is an exact formula
evaluation, not a measurement) so those stay `None` throughout, per the "never
invent an error bar" rule already established in `sources/co2-o2`.

## Citations (one per checkpoint, in `normalise.py`)

- **Gough, D.O. (1981)**, "Solar interior structure and luminosity variations",
  *Solar Physics* 74, 21-34 — the `solar_luminosity` formula, given verbatim in the
  work package: `L/L0 = 1 / (1 + 0.4*(1 - age/t_sun))`, `t_sun = 4.57e9`,
  `age = t_sun - t`.
- **Williams, G.E. (2000)**, "Geological constraints on the Precambrian history of
  Earth's rotation and the Moon's orbit", *Reviews of Geophysics* 38(1), 37-59 —
  Elatina-Reynella tidal rhythmites (South Australia), ~620 Ma: day length
  21.9 ± 0.4 h, lunar semimajor axis 58.16 ± 0.30 Earth radii
  ((3.709 ± 0.019)e8 m = 370,900 ± 1,900 km).
- **Mitchell, R.N. & Kirscher, U. (2023)**, "Mid-Proterozoic day length stalled by
  tidal resonance", *Nature Geoscience* 16, 567-569 — day length held near 19 h for
  roughly 1 Gyr (~2.0 to ~1.0 Ga), lunar oceanic tidal torque and solar atmospheric
  thermal tidal torque nearly cancelling.
- **Lantink, M.L., Davies, J.H.F.L., Ovtcharova, M. & Hilgen, F.J. (2022)**,
  "Milankovitch cycles in banded iron formations constrain the Earth-Moon system
  2.46 billion years ago", *PNAS* 119(40), e2117146119 — Joffre Member BIF
  cyclostratigraphy, U-Pb dated: day length 16.9 ± 0.2 h, Earth-Moon distance
  321,800 ± 6,500 km, both at 2.46 Ga. The oldest reliable geological constraint on
  Earth-Moon dynamics — why `day_length`/`moon_distance` stop there rather than
  extrapolating into the Hadean/early Archean.
- **Laskar, J., Robutel, P., Joutel, F., Gastineau, M., Correia, A.C.M. & Levrard,
  B. (2004)**, "A long-term numerical solution for the insolation quantities of the
  Earth", *Astronomy & Astrophysics* 428, 261-285 — the La2004 solution, numerically
  reliable over roughly the last 250 Myr (chaotic divergence dominates beyond that).
  Used only for the domain bound and the ~22.1-24.5° oscillation amplitude; see
  "Obliquity: mean, not orbital-cycle noise" below.

Full citation text is duplicated at each `Checkpoint` in `normalise.py` (not just
listed once here) so a reader inspecting the code sees the source for every number
next to the number itself, matching `manifest.toml`'s combined `citation` field.

## Gotchas

- **The lunar "time problem" — do not extrapolate the present recession rate.** The
  Moon currently recedes at ~3.8 cm/yr (lunar laser ranging). Naively running that
  rate backward puts the Moon at Earth's surface only ~1.5 Gyr ago, contradicting
  its ~4.5 Gyr age. The resolution (Walker & Zahnle 1986 and others) is that tidal
  dissipation is dominated by shallow-sea resonances that depend on continental
  configuration, so today's rate is anomalously high, not representative of the
  long-term average. `moon_distance_km()` reflects this by construction — it
  interpolates between the three *cited paleo-distance* checkpoints above, and never
  touches the present-day rate at all. Sanity check (also asserted in the test):
  the implied average rate between 0 and 620 Ma is ~2.2 cm/yr, well below 3.8 cm/yr.
- **Day length is *not* monotonically approaching 24 h at a steady pace.** The
  Williams (620 Ma, 21.9 h) and Mitchell & Kirscher (~2.0-1.0 Ga, ~19 h) checkpoints
  are from different methods measuring different things, and read at face value they
  say day length was *longer* at 620 Ma than through most of the preceding billion
  years — i.e. the "Proterozoic stall" broke and despinning resumed rapidly in the
  few hundred Myr before 620 Ma. That is the literature's own narrative (both papers
  agree the stall ended as continental configuration changed, mid-to-late
  Proterozoic), not an artefact of this package averaging two disagreeing sources.
  The checkpoint ordering (`0 → 24.0`, `6.2e8 → 21.9`, `1.0e9 → 19.0`, `2.0e9 →
  19.0`, `2.46e9 → 16.9`) is monotonic non-increasing in `t`, consistent with this.
- **Review fix — checkpoint bounds were silently dropped at t=620 Ma.**
  `interpolate_checkpoints()` originally always blended bounds via
  `_blend_optional(a.lower, b.lower, f)` across the bracketing pair, even when `t`
  landed exactly on a checkpoint. For `day_length`/`moon_distance` at 620 Ma, the
  chosen bracketing pair was `(t=0, t=6.2e8)`; since the present-day anchor (`t=0`)
  carries no bounds, `_blend_optional` returned `None` for both `lower` and `upper`
  even though `f=1.0` and Williams (2000)'s own 21.5-22.3 h / 369,000-372,800 km
  bounds at 620 Ma were right there on the checkpoint being blended *to*. The value
  itself was unaffected (it comes out exactly right at `f=1.0` regardless), so no
  existing test caught it — `test_uncertainty_bounds_carried_where_cited` only
  checks that *some* sample in the series carries bounds, and other checkpoints
  (1.0/2.0/2.46 Ga) happened to blend fine because both their neighbours had bounds.
  Fixed by returning a checkpoint's own value/bounds directly whenever `t` matches
  it exactly, before falling through to the pairwise blend. Regenerated the curated
  parquet; `data/curated/day_length.parquet` and `moon_distance.parquet` grew by a
  few bytes (the 620 Ma sample now stores real bounds instead of two `None`s) —
  sizes and `volume_bytes` above are the corrected ones.
- **Why dense-sample a piecewise-linear curve?** `day_length`, `moon_distance` and
  `obliquity` are, strictly, fully described by their handful of checkpoints — the
  curve between them *is* linear, so extra grid points between two checkpoints are
  exact restatements of the same line, not new information. They are emitted anyway
  (200 points per series, `_SAMPLES_PER_SERIES` in `normalise.py`) so all 4 series
  share one sampling code path (`_dense_samples`), and so a future change to any
  checkpoint curve's interpolation (e.g. if a later source adds a checkpoint that
  makes a segment non-linear) needs no change to the sampling logic. The storage
  cost of this redundancy is negligible — see "Measured volume" below. Checkpoint
  `t` values are always merged into the grid explicitly, so a stall boundary or
  other kink always lands on an exact stored sample rather than being rounded off
  by whichever grid point happens to be nearest.
- **Obliquity: mean, not orbital-cycle noise.** Earth's obliquity genuinely
  oscillates ~22.1°-24.5° on a ~41,000-year Milankovitch cycle, and the true
  trajectory is chaotic beyond roughly the first several tens of Myr of the La2004
  solution (~250 Myr is the solution's broad numerical-integration window, per the
  work package's own framing; a claimed cycle *phase* hundreds of Myr back is not
  something any solution actually supports). Given this project's sample spacing
  (nothing close to 41 kyr resolution) and its domain restriction, the honest
  representation is a **flat long-term mean (23.3°) with the oscillation amplitude
  carried as `lower`/`upper` bounds (22.1°/24.5°)**, not an attempt to reconstruct
  the cycle's instantaneous phase. Both checkpoints (`t=0`, `t=2.5e8`) therefore
  hold identical values by design — see `_LASKAR_2004_CITATION` in `normalise.py`.
  The present *instantaneous* obliquity (23.44°) sits inside the stated bounds but
  is not itself the checkpoint value, for the same reason.
- **`SOLAR_AGE_YEARS` (4.57e9, Gough's `t_sun`) is deliberately distinct from
  `pipeline.shapes.EARTH_FORMATION` (4.567e9).** They are independently measured
  (the Sun's main-sequence age vs. Earth's accretion age) and differ by ~3 Myr; the
  formula uses `t_sun` exactly as specified, while `solar_luminosity`'s domain upper
  bound uses `EARTH_FORMATION` exactly as specified ("Domain 0 to 4.567e9" in the
  work package). At `t = EARTH_FORMATION`, `L/L0 ≈ 0.7144` — essentially identical
  to the ZAMS value `L/L0 = 1/1.4 ≈ 0.7143` at `t = t_sun`, since the two moments
  are only 3 Myr apart.
- **`normalise(raw_dir)` ignores `raw_dir` entirely.** The parameter is kept only so
  `astronomy` has the same call signature as every other source under a generic
  `make data` / fetch-then-normalise dispatch; there is no file to read.

## Measured volume

Ran `fetch.py` (no-op) then `normalise.py` for real and measured the actual output:

| file | bytes |
|---|---|
| `data/curated/day_length.parquet` | 5,389 |
| `data/curated/moon_distance.parquet` | 5,612 |
| `data/curated/solar_luminosity.parquet` | 5,060 |
| `data/curated/obliquity.parquet` | 3,462 |
| **total** | **19,523** (~19 KB) |

(200 samples/series × 4 series, well under the "< 5 MB → git" storage-policy
threshold by more than two orders of magnitude.)

## Storage tier chosen

**git.** ~19 KB, trivially under the 5 MB threshold in `docs/DATA_SOURCES.md` §
Storage policy. `data/raw/astronomy/` never exists (nothing is fetched), consistent
with the "raw not committed" policy line having nothing to apply to here.

## Deviations from docs/DATA_SOURCES.md

- `DATA_SOURCES.md` Tier 3 also lists "galactic position — ~20 laps of the galactic
  centre" alongside day length, Moon distance and solar luminosity under the
  `astronomy` row. The **D7 work package this source was built against scopes
  exactly 4 series** (`day_length`, `moon_distance`, `solar_luminosity`,
  `obliquity`) and does not mention galactic position. Galactic position is not
  implemented here; if it's wanted, it is a 5th `TimeSeries` (galactocentric
  longitude vs. `t`, from the Sun's ~220-230 km/s orbital velocity and ~2.4e8-year
  period) and fits this same pattern — flagging rather than silently adding scope.
- **`WorldModel.at()` (`pipeline/models.py`) does not read `obliquity`.**
  `SkyState.obliquity_deg` exists as a field, but `WorldModel.at()` only samples
  `day_length`, `moon_distance` and `solar_luminosity` into `SkyState` — verified by
  loading this package's real curated output through `load_world` end-to-end:
  `WorldState.at(t).sky.obliquity_deg` is `None` at every `t`, even though
  `data/curated/obliquity.parquet` is present and loads (`WorldModel.series` does
  contain `"obliquity"`). `pipeline/models.py` is outside this package's owned
  paths (see task instructions), so this is reported rather than fixed here: wiring
  `self._s("obliquity", t)` into `SkyState(...)` in `WorldModel.at()` is a one-line
  change for whoever owns `pipeline/models.py`.
