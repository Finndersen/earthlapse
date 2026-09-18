# Source: hyde

HYDE 3.2.1 cleared land (cropland + pasture fraction, plus rangeland as a separate, fainter
channel), 10,000 BCE → 2015 CE. `RasterSequence` id `hyde_cleared_land`, one frame per real
HYDE timestep (73).

**2026-09-17 rendering-review revision.** The original encoding used `grazing` (HYDE's "total
land used for grazing") for the second channel. Rendered on the globe, this painted nearly all
of Africa's Sahel/savanna, Madagascar and much of Europe mustard — the same colour as cleared
cropland — because `grazing` includes natural, essentially-unmanaged rangeland, not just
intensively-managed pasture. See "Which HYDE variable is 'pasture'" below for the confirmed
arithmetic and the fix: `pasture` and `rangeland` are now fetched and published as two
separate channels instead of one combined `grazing` channel.

## Licence — confirmed at fetch time, and the docs/DATA_SOURCES.md correction

**HYDE 3.2 only, never 3.3** (user-approved 2026-09-17; ADR-031). Confirmed live:

- DANS citation page for doi:10.17026/DANS-25G-GEZ3 (`archaeology.datastations.nl`): licence
  **CC0-1.0**.
- The dataset's own bundled `readme_release_HYDE3.2.1.txt` (downloaded and read in full)
  states a *different* licence for the data itself: **"Disclaimer: The Creative Commons
  License (CC BY 3.0) applies to all of the HYDE data."** Both are permissive;
  `manifest.toml`'s `licence` field records both rather than picking one, and the citation is
  given regardless (CONTRIBUTING.md: "citation is the price of use").
- HYDE 3.3 (doi:10.24416/UU01-AEZZIT) is **CC BY-NC-SA 4.0** (DataCite rights field, checked
  directly) — confirmed **rejected**, not used anywhere in this source.

`docs/DATA_SOURCES.md`'s `hyde` entry named 3.3 with a "⚠️ VERIFY — believed CC BY" licence
line; correcting it to 3.2/CC0 (plus the CC BY 3.0 note above) is part of what this source's
build task did.

## What was and wasn't downloaded

The DANS deposit ships 5 files (sizes and SHA-1s read from its own API,
`archaeology.datastations.nl/api/datasets/:persistentId/`):

| File | Size | Used here? |
|---|---|---|
| `readme_release_HYDE3.2.1.txt` | 8.6 KB | read in full (schema, licence) |
| `easy-migration.zip` | 1.3 MB | no (a QGIS/GIS-tool helper bundle, not data) |
| `HYDE3_2_1-general_supplementary.zip` | 22.5 MB | **no — see "Why no General files" below** |
| `HYDE3_2_1-anthromes.zip` | 135.2 MB | no (a derived biome classification, not cropland/grazing) |
| `HYDE3_2_1-baseline.zip` | **5,339,653,974 bytes (5.3 GB)** | **selectively — see "Fetch strategy"** |

Only `cropland<year>.asc`, `pasture<year>.asc`, `rangeland<year>.asc` and
`conv_rangeland<year>.asc`, per timestep, are ever fetched from `HYDE3_2_1-baseline.zip` —
not `grazing<year>.asc` itself (their combined total; fetching the four narrower variables
directly instead of `grazing` as one channel is the whole point of this revision — see "Which
HYDE variable is 'pasture'" below), not `popc`/`popd`/`rurc`/`uopp`/`urbc` (population), not
`ir_norice`/`ir_rice`/`rf_norice`/`rf_rice`/`tot_irri`/`tot_rainfed`/`tot_rice` (irrigation
splits): this source's own scope is cleared land only, not population or the finer
irrigation splits.

## Fetch strategy

`HYDE3_2_1-baseline.zip` is far too large to download whole for what this project needs (5.3
GB for the actually-wanted content — every HYDE variable, at 5 arcmin, for every scenario; see
"Measured volume" below for the exact figure with all four variables). Instead, `_rangezip.py`
opens the *remote* zip's central directory via HTTP Range requests (confirmed live: the DANS
access endpoint forwards a `Range` header through its own redirect to the underlying
SURF/S3-compatible object store, returning real `206 Partial Content` responses) and extracts
only the four members each timestep needs, without ever downloading the other ~119
variables/scenarios in the archive.

**Complication: Deflate64.** `HYDE3_2_1-baseline.zip`'s members use zip compression method 9
(Deflate64/Enhanced Deflate), which Python's stdlib `zipfile` cannot decompress
(`NotImplementedError: That compression method is not supported` — confirmed directly). No
maintained fix exists as a Python dependency for this platform:
- PyPI's `deflate64` package is an empty placeholder (version `0.0`, no code) — confirmed by
  installing it and inspecting `site-packages`.
- `zipfile-deflate64` is real but ships no wheel for cp311+ or macOS arm64, and building it
  from source on this machine fails (`zlib/zutil.c`, clang/C23 strictness) — confirmed by
  attempting the build.
- `p7zip` (which does support Deflate64) would need a global Homebrew install, outside this
  project's declared Python dependencies and not reproducible from `pyproject.toml`.

**What works:** macOS's built-in `/usr/bin/unzip` (Apple's own Info-ZIP fork) decompresses
Deflate64 correctly — confirmed end to end (extracted bytes match the archive's own recorded
CRC-32 and uncompressed size). `_rangezip.extract_members` therefore builds a small,
standalone, valid zip in a temp file — containing only the member(s) currently needed, their
raw bytes copied verbatim from a Range GET, plus a freshly synthesized central directory and
EOCD record — and shells out to the system `unzip` to do the actual decompression. This is a
genuine platform dependency, not a hidden one: `_rangezip.py`'s module docstring and
`Deflate64ToolMissingError`'s message both say so, and this README calls it out as a Gotcha
below. `fetch()` preflights this once, at the very start, via `check_deflate64_support()` —
parsing `unzip -v`'s own "special compilation options" banner for `DEFLATE64` — so a machine
without a Deflate64-capable `unzip` fails loudly before any download, not partway through the
73rd timestep. **Not independently verified on Linux in this build**, but Info-ZIP UnZip
>= 5.5 (2005) supports Deflate64 by default, which covers most Linux distributions' stock
`unzip` for close to two decades now — the earlier claim in this README that Linux
"historically lacks" support was wrong and has been corrected. If a specific target
environment's `unzip -v` doesn't report `DEFLATE64`, `check_deflate64_support()` will say so
immediately rather than failing obscurely mid-run.

The four fetched members form two physically-adjacent pairs, confirmed directly from the
archive's own byte offsets: `conv_rangeland<tag>.asc`'s data ends exactly where
`cropland<tag>.asc`'s local header begins, and `pasture<tag>.asc`'s data ends exactly where
`rangeland<tag>.asc`'s begins. `_merge_ranges` turns each pair into one HTTP Range GET, so
fetching all four costs **two HTTP requests per timestep**, the same as when only `cropland`
and `pasture`/`rangeland` were fetched — adding `conv_rangeland` didn't add a third request,
because it happens to sit right next to `cropland` in the archive's own layout.

**No whole-archive sha256.** Every other source's `manifest.toml` records a single `sha256`
of what `fetch.py` downloads and verifies whole. This source never downloads
`HYDE3_2_1-baseline.zip` whole, so there is no such hash to record — `manifest.toml`'s
`sha256` field is deliberately empty, with a comment pointing here. What *is* verified, for
every extracted file, every run: its byte length and CRC-32 against the *remote* zip's own
central directory record (`RemoteZipMemberError` on any mismatch) — arguably stronger than a
single whole-archive hash, since it's checked per file rather than once for the lot.
Re-running `fetch()` skips the network for any timestep already on disk with a matching CRC
(`_already_cached`), the same "don't re-fetch what's already verified" behaviour
`ensure_verified_artefact` gives every other source.

## Why no "General files"

HYDE ships a per-cell area grid (`garea_cr.asc`, in `HYDE3_2_1-general_supplementary.zip`)
for converting km² values to fractions precisely. This source does not fetch it: HYDE's grid
is a plain regular lat/lon grid (5 arcmin, confirmed from every `.asc` header:
`cellsize 0.0833333`, same convention as `sources/paleodem`'s own 1° grid), so a cell's true
surface area is a closed-form function of its latitude band alone — computed analytically in
`normalise.py`'s `_row_cell_area_km2` (exact spherical cap-strip formula, not a small-angle
approximation) rather than fetched. This trades a small, documented accuracy loss (a sphere of
constant mean radius vs. HYDE's own WGS84-ellipsoid-based grid — differs by well under 0.3% at
any latitude) for skipping a whole extra fetch dependency entirely. Reasonable for a coarse
globe-overlay tint; not appropriate if this data were ever read for an exact-value chart.

## Which HYDE variable is "pasture"

**This section documents two real mistakes this source made, and how each was corrected by
going back to the primary source rather than guessing — not just a naming choice.**

### Mistake 1: `grazing` lumps everything together

The original revision used **`grazing`** ("total land used for grazing") for the second
channel, reasoning that "grazing = pasture + rangeland exactly". That arithmetic claim was
wrong: HYDE 3.2 ships **four** grazing-related variables per timestep, not two —
`grazing<yr>.asc`, `pasture<yr>.asc`, `rangeland<yr>.asc`, and `conv_rangeland<yr>.asc`
("converted rangeland") — and directly checking real 0 CE data (summing all four grids
pixel-wise) confirms:

```
grazing == pasture + rangeland + conv_rangeland   (exact, max abs diff 0.0 across the whole 0 CE grid)
grazing != pasture + rangeland                     (max abs diff 57.5 km^2 per cell; conv_rangeland is real, not a rounding artefact)
```

`conv_rangeland` is not negligible: 338,720 km² globally in 0 CE, comparable to `pasture`'s own
174,521 km². Painting the whole `grazing` sum the same colour as cleared cropland is what made
the Sahel, Madagascar and much of Europe's semi-natural grassland read as "cleared" on the
globe.

### Mistake 2 (caught on review): guessing where `conv_rangeland` belongs, instead of checking

An earlier revision of this README fetched `pasture` and `rangeland` as two channels and left
`conv_rangeland` out entirely, reasoning from its *name* alone that it was "of ambiguous
intensity" and declining to guess. That was the right instinct (don't silently decide) but the
wrong stopping point — the primary source actually defines it precisely. From **Klein Goldewijk
et al. (2017), "Anthropogenic land use estimates for the Holocene", Earth System Science Data
9:927–953, doi:10.5194/essd-9-927-2017** (quoted verbatim, extracted from the paper's own PDF —
not the bundled `readme_release_HYDE3.2.1.txt`, which names the three-way split but does not
define it):

> "For grazing lands, a distinction is made between more intensively managed pasture and
> extensively managed rangelands. The main difference between these two types of grassland is
> that rangelands comprise natural grasslands, shrublands, woodlands, wetlands, and deserts and
> grow primarily native vegetation, rather than plants established by humans, and typically
> have low livestock densities. [...] When the aridity index (defined as annual precipitation
> divided by annual evapotranspiration) of a grid cell defined as grazing land is less than
> 0.5, or when the aridity index is higher than 0.5 but the population density is less than 5
> inhabitants km⁻², then it is defined as rangeland."

> "Whether or not natural vegetation has been converted to establish grazing land is a very
> relevant question for studying the impacts of land use change. While most rangelands occur
> on land with mostly natural vegetation, low-intensity livestock grazing is also located in
> former forest or woodland areas, e.g. in Brazil. Therefore, after consultation with the Land
> Use Model Intercomparison Project (LUMIP), we recommend that our maps of pasture and
> rangeland be used for modelling purposes in the following way: for pastures, all natural
> vegetation is cleared and replaced by grass species. For rangeland, the natural vegetation
> remains intact if it is non-forest, but is cleared if it is forest. HYDE includes this
> distinction by providing two types of rangeland: (1) rangeland-natural is located in
> non-forest biomes (terrestrial ecoregions; Olson et al., 2001) and is therefore assumed not
> to have undergone conversion of natural vegetation. (2) Rangeland-converted is located in
> forest biomes (terrestrial ecoregions; Olson et al., 2001) and is assumed to have undergone
> conversion of natural vegetation."

In HYDE's own file naming, "rangeland-natural" is `rangeland<yr>.asc` and "rangeland-converted"
is `conv_rangeland<yr>.asc`. This settles the question precisely: **`conv_rangeland` is grazing
land in forest biomes, which the dataset's own authors say should be treated as cleared** — the
same logic that already applies to cropland and pasture (both explicitly "cleared and replaced")
. `rangeland` (non-forest biomes) is the one HYDE itself says is "assumed not to have undergone
conversion" — genuinely natural, not cleared.

(The aridity/population-density passage above also resolves a separate, smaller discrepancy:
the bundled `readme_release_HYDE3.2.1.txt` states both `pasture` and `rangeland` as "aridity
index > 0.5", word for word — almost certainly a copy-paste error in that file, since the two
categories can't share the same one-sided threshold. The paper's own text makes the actual rule
clear: aridity < 0.5, *or* aridity > 0.5 with population density < 5/km², is rangeland;
otherwise pasture.)

### The fix

**G = `pasture` + `conv_rangeland`** (both cleared, per the quotes above; summed then clipped
to `[0, 1]`, since two independently-clipped fractions can exceed 1 together at a coastal/
rounding-edge cell), **B = `rangeland`** (natural, non-forest, not cleared — README.md
"Encoding"). All four variables are fetched; none are silently left out.

**Layer name.** `pipeline/publish.py`'s `LayerSpec` name stays **"Cleared land (cropland +
pasture)"** — using "pasture" as it already is used for the whole layer, as a short umbrella
term rather than an exhaustive list of HYDE's own category names (the layer is already called
"cleared land", not "cleared land, managed pasture and forest-converted rangeland"). The
precise composition of the G channel (pasture *and* converted rangeland) is documented here,
in `manifest.toml`, and in `docs/DATA_SOURCES.md` — anyone reading past the short UI-facing
name gets the exact, correct answer; a longer name in the layer list itself was judged not to
add enough clarity there to be worth the added length.

## Schema

Arcmap ASCII grid ("`.asc`"), confirmed from HYDE's own readme and every downloaded file's
header:

```
ncols 4320
nrows 2160
xllcorner -180
yllcorner -90
cellsize 0.0833333
NODATA_value -9999
```

then `nrows` rows of `ncols` whitespace-separated floats, values in **km² per grid cell**
(not a fraction — this source converts to fraction itself, see "Cell area" below). **Row 0 is
the grid's northernmost row** (confirmed: `yllcorner` names the grid's *south* edge per the
ArcInfo ASCII-grid convention, and real HYDE values are only geographically sensible — see
"Georeferencing check" below — under north-first row order, e.g. cropland concentrated in the
temperate/subtropical bands rather than mirrored to the Southern Hemisphere).

**`NODATA_value` (-9999) marks ocean/undefined cells only — not "no cropland".** Confirmed
directly: a mid-Pacific cell (0°N, 160°W) in the real 0 CE cropland grid reads exactly
`-9999`, while very many genuine land cells (deserts, ice, pre-agricultural regions) read
exactly `0` — a materially different value the grid clearly distinguishes. Both are folded to
0 fraction in `normalise.py` (ADR-031: "pre-bake ocean/no-data as 0"), so nothing downstream
needs to special-case either.

## Cell area

`_row_cell_area_km2` (`normalise.py`) computes each row's true cell area analytically:
`area = R² · Δlon_rad · (sin(lat_top) − sin(lat_bottom))` — the exact area of a
latitude/longitude cell on a sphere of radius `R` (`EARTH_MEAN_RADIUS_KM = 6371.0`, the same
order of spherical approximation `sources/paleodem`'s own land-fraction weighting makes), not
a small-angle/`cos(latitude)` approximation — exact at every latitude, including near the
poles. A km² value divides by its row's own cell area to become a fraction, clipped to `[0,
1]` (coastal cells can read slightly over 100% of a cell's nominal area in HYDE's own model
rounding).

## Encoding

One RGB WebP per timestep, **lossless** (a data layer — CONTRIBUTING.md holds these to a
higher accuracy bar than decorative imagery, unlike `sources/paleodem`'s/`sources/basemap`'s
lossy textures):

- **R = cropland fraction**
- **G = (pasture + conv_rangeland) fraction**, summed then clipped to `[0, 1]` — "managed,
  cleared grazing land": HYDE's own intensively-managed pasture plus its forest-biome
  "converted rangeland", which HYDE's authors define as assumed-cleared (see "Which HYDE
  variable is 'pasture'" above for the primary-source quotes)
- **B = rangeland fraction** — HYDE's non-forest-biome "rangeland-natural", assumed *not*
  cleared; deliberately the channel to de-emphasise on the globe (render much fainter than
  R/G, or not at all) rather than equating it with cleared land, the way the old combined-
  `grazing` G channel did

Each channel's fraction is `fraction * 255` clipped to `[0, 255]`. 1024×512 (matching
`sources/paleodem`'s own globe texture size), resampled bilinear from the native 4320×2160
grid (`_resize_fraction` — direction-agnostic, so the same code upsamples the small fixture
grids too). All four raw HYDE variables (`cropland`, `pasture`, `rangeland`,
`conv_rangeland`) are fetched; none are silently left out of every channel.

## Georeferencing check

Pixel-sampled the real texture at known locations. 1700 CE, general check (R = cropland,
G = pasture + conv_rangeland, B = rangeland):

| Location | (lat, lon) | R (cropland) | G (pasture + conv_rangeland) | B (rangeland) |
|---|---|---|---|---|
| Nile Delta | 30°N, 31°E | 37/255 (14.5%) | 0 | 0 |
| Sahara | 23°N, 10°E | 0 | 0 | 0 |
| Mid-Pacific | 0°N, 160°W | 0 | 0 | 0 |
| North China Plain | 31°N, 112°E | 40/255 (15.7%) | 3/255 (1.2%) | 0 |
| Ganges plain, India | 28°N, 77°E | 58/255 (22.7%) | 1/255 (0.4%) | 0 |
| European Russia | 52°N, 37°E | 17/255 (6.7%) | 15/255 (5.9%) | 0 |
| US Midwest, 1700 CE | 41°N, 95°W | 0 | 0 | 0 |
| **Sahel (Niger/Chad)** | **15°N, 10°E** | **1/255 (0.4%)** | **0** | **69/255 (27.1%)** |
| Amazon edge (Pará, Brazil), 1700 CE | 8°S, 55°W | 0 | 0 | 0 |

All as expected: real cropland over the historically-farmed river valleys, zero over open
ocean and desert, near-zero over the pre-colonial US Midwest and the pre-deforestation Amazon
in 1700, and — the row that matters for the first revision — **the Sahel reads almost pure B
(natural rangeland), not R or G.** Under the original `grazing`-as-G encoding, this same cell
would have read a substantial non-zero G value (grazing = pasture + rangeland + conv_rangeland
is dominated by rangeland here), the same visual weight as cleared cropland; now it correctly
separates into the distinct, de-emphasisable B channel.

**2015 CE, confirming the second revision (`conv_rangeland` folded into G):**

| Location | (lat, lon) | R (cropland) | G (pasture + conv_rangeland) | B (rangeland) |
|---|---|---|---|---|
| Sahel (Niger/Chad) | 15°N, 10°E | 1/255 (0.4%) | 0 | 253/255 (99.2%) |
| Germany | 52°N, 10°E | 120/255 (47.1%) | 24/255 (9.4%) | 0 |
| **Amazon edge (Pará, Brazil)** | **8°S, 55°W** | 10/255 (3.9%) | **12/255 (4.7%)** | 0 |
| US Midwest | 41°N, 95°W | 160/255 (62.7%) | 15/255 (5.9%) | 43/255 (16.9%) |

The Amazon-edge row is the clearest confirmation available: `pasture` there is exactly 0.0 at
this cell (checked directly, not inferred from the rendered byte) — the entire G=12 reading
comes from `conv_rangeland` alone (fraction 0.0496). This is precisely the scenario the primary
paper names by name as its own motivating example: "low-intensity livestock grazing is also
located in former forest or woodland areas, e.g. in Brazil" (Klein Goldewijk et al. 2017).
Before this second revision, that Amazon deforestation-for-grazing signal would have been
completely invisible (G=0) — a real undercount of cleared land, not merely a stylistic choice.
The Amazon edge reading 0/0/0 in 1700 CE (above) and non-zero only by 2015 CE also matches the
real, well-documented history of that clearing being a recent (mid-to-late 20th century
onward) phenomenon, not a static artefact of the encoding. No flips, no offsets.

## Population density (ADR-031 amendment, 2026-09-17)

A second `RasterSequence`, id `hyde_population_density` — people per km², from the same HYDE
3.2 deposit, same 73 timesteps, same licence. Fetched via `popc_<tag>.asc` ("population count"
per cell, inhabitants — **not** `popd`, HYDE's own pre-computed density grid, which this source
does not fetch: recomputing density from `popc` and this source's own analytically-derived true
cell area (below) keeps both published rasters' area-weighting consistent with each other,
rather than trusting HYDE's own `popd` to use the same area convention this source already
committed to for cleared land).

**Member path — confirmed directly from the archive, not assumed.** Population members live
under a *differently-shaped* in-archive path than the land-use variables this source already
fetched: `baseline/asc/<tag>_pop/popc_<tag>.asc`, not `baseline/asc/<tag>_lu/<variable><tag>.asc`
— a different sibling directory (`_pop`, not `_lu`) **and** an underscore before the tag in the
filename itself (`popc_0AD.asc`, not `popc0AD.asc`), confirmed by listing the real archive's own
central directory before writing any fetch code. `fetch.py`'s `_member_path`/`_local_filename`
branch on `POPULATION_VARIABLE` to handle both differences; `_regenerate_expected_members.py`
picked up the new member automatically once `VARIABLES` grew a fifth entry (no code change
needed there — it already builds every pinned entry generically from `fetch_mod.VARIABLES`).
Confirmed the population and land-use directories cover exactly the same 73 in-range tags (plus
2016AD/2017AD on the population side too, excluded by the same `MAX_YEAR_CE` filter) before
relying on that — a live listing showed 75 `popc_*` members, land-use tags minus population tags
is empty, population tags minus land-use tags is exactly `{2016AD, 2017AD}`.

**Schema.** Same Arcmap ASCII grid format as the land-use variables (`ncols 4320`, `nrows 2160`,
`cellsize 0.0833333`, `NODATA_value -9999`), same row order (row 0 = north), and the same trap:
`-9999` marks ocean/undefined cells, not "uninhabited" — real uninhabited land cells (Sahara,
Antarctica, pre-agricultural interiors) legitimately read `0`. Both fold to 0 people here,
exactly like the land-use fractions.

**Population density: why area-weighted, not a mean of densities.** Computing a per-cell
density (`popc / cell_area`) at full 4320x2160 resolution and then resizing *that* — the way
`_resize_fraction` resamples the land-use fractions — would compute, for each output pixel, an
unweighted mean of ~4.2x4.2 already-independent density values. That silently treats a
sparsely-populated desert cell and a dense city-core cell **as equally important to the
average**, when what a density map should show is the *combined* density of the whole
footprint: total people actually living there, divided by the total area they live in. Worked
example: a 2x2 output block covering one 10,000-person, 1 km² city-centre cell and three empty,
100 km² desert cells the wrong way (mean of densities) computes `(10000 + 0 + 0 + 0) / 4 = 2500`
people/km² — an average of *rates*, dominated by the one non-zero rate purely because there are
few cells to average over. The correct way (sum people / sum area) computes
`10000 / (1 + 100 + 100 + 100) = 33.2` people/km² — the actual combined density of that
301 km² footprint, which is what "density" means and what area-correct resampling must
preserve. `_population_density_grid` implements this via `_resize_mean` (Pillow's `BOX` filter,
an exact geometrically-weighted average — confirmed directly: a 2x2 block `[[100,1],[1,1]]`
downsamples to exactly its arithmetic mean, 25.75) applied *separately* to the raw people-count
grid and the true-area grid, then divided: because both arrays are resampled with the exact same
per-pixel geometric weights, the constant "divide by total weight" a mean applies cancels out of
the ratio, leaving exactly sum(people)/sum(area) over each output pixel's real footprint.

**Encoding.** One RGB WebP per timestep, lossless (a data layer, same accuracy bar as cleared
land): **R = `encode_log_density(people_per_km², D_MAX)`** (`pipeline/density_encoding.py`,
shared with `pipeline/publish.py` so the pixel format and the published decode metadata can
never disagree), **G = B = 0**. Formula:

```
pixel = round(255 * clamp(log10(1 + d) / log10(1 + D_MAX), 0, 1))
d     = 10 ** (pixel / 255 * log10(1 + D_MAX)) - 1        # inverse
```

A log scale because real population density spans orders of magnitude in one frame (open
ocean/desert near 0 next to a city core in the tens of thousands per km²) — a linear 8-bit
encoding would waste nearly its whole range on values indistinguishable from zero.

**`D_MAX` = 15,000 people/km², chosen from the real, *published* quantity.** Measured directly
across all 73 real frames (not estimated): the raw 4320x2160 `popc` grid's single-cell maximum
reaches ~48,600/km² in 2015 (a Hong Kong/Manila/Dhaka-sized cell), but that never survives the
~4.2x4.2 area-weighted downsample to 1024x512 — the actual published texture. The real global
maximum *after* downsampling, across every one of the 73 frames, is **13,779.5 people/km², at
2015AD**. `D_MAX = 15,000` rounds that up with a small (~9%) margin — enough that the frame
which set the maximum doesn't itself clip — while keeping the 8-bit range's precision
concentrated in the densities the published texture actually contains, rather than the much
higher (and never-published) full-resolution ceiling. Values above `D_MAX` (none observed)
clamp to 255. The exact figures and how they were produced: `pipeline/density_encoding.py`'s
own `POPULATION_DENSITY_D_MAX` docstring, and reproducible directly —
`sources/hyde/normalise.py`'s `_population_density_grid(raw_dir, tag).max()` over every tag from
`_discover_population_tags(raw_dir)`.

**Published metadata.** `RasterData.encoding` (`pipeline/manifest.py`'s `RasterEncoding`, ADR-031
amendment) publishes `{channel: "r", unit: "people_per_km2", dMax: 15000}` alongside this layer's
frames, so a consumer can recover an *exact* density from a sampled pixel, not just a relative
shade — mirrored in `web/src/types/layer.ts`/`web/src/data/curated.ts`.

**World total sanity check** (full-resolution `popc` sums, before downsampling or encoding —
computed directly, not estimated):

| Timestep | World total population | Expectation (task brief) |
|---|---|---|
| 10,000 BCE | 4,432,265 | ~4M order of magnitude |
| 0 CE (1 CE) | 232,124,272 | 190M–300M |
| 1000 CE | 323,407,925 | — |
| 1700 CE | 591,722,989 | — |
| 1900 CE | 1,642,028,156 | — |
| 2000 CE | 6,110,442,981 | — |
| 2015 CE | 7,256,964,920 | ~7.3B |

All three checkpoints named in the task brief land within (10,000 BCE, 2015 CE) or essentially
at (1 CE) their expected order of magnitude — plausible, monotonically increasing, no unit or
scale error. Eyeballed frames (2015 CE and 1700 CE, encoded textures, both clearly show real
population geography — dense bands over the Ganges plain, eastern China, Nile delta, Java, and
Western Europe, near-zero over open ocean, the Sahara and Antarctica) are saved during the build
task to the scratchpad as `popd-2015AD.png` and `popd-1700AD.png`; this is not a shipped
artefact of the repository.

At the time this table was first produced, this was *not yet* the global population `TimeSeries`
DATA_SOURCES.md then listed as unbuilt — a `TimeSeries` needs its own per-frame world-total
aggregation step and a HUD sparkline entry, and the figures above were ad hoc, reproducible sums
for verification only. "Global population total" below is that follow-up pass; it reuses this
exact sanity check as its own test oracle rather than recomputing it independently.

## Global population total (ADR-031 amendment, 2026-09-18)

A third curated output, id **`population`** (a `TimeSeries`, not a `RasterSequence` like the two
above) — deliberately *not* `hyde_population_total`: it is the plain semantic id
`WorldModel.at()` already looks up (`pipeline/models.py`'s `self._s("population", t)`) and
`HumanState.population`, the same "a source's derived scalar series takes the plain semantic
name, not a source-prefixed one" convention `sources/paleodem`'s own `land_fraction` already set.

**Computation.** `_world_population_total(raw_dir, tag)` (`normalise.py`) sums the
full-resolution `popc_<tag>.asc` grid directly, one call per of the same 73 real timesteps
`hyde_population_density` already iterates. No area weighting: `popc` is people *per cell*
already (not a density), so a plain sum over every valid cell *is* the world total — unlike the
density raster, which must divide by area to combine cells correctly. NODATA (-9999,
ocean/undefined) folds to 0 people and the handful of cells carrying small negative rounding
noise are clipped to 0, exactly `_population_density_grid`'s own two conventions, so the two
population outputs can never silently disagree about what counts as "no people here".

**Shape.** `unit = "people"`, `interpolation = "log-linear"` (population growth is
multiplicative, matching `Interpolation.LOG_LINEAR`'s own docstring, which names "populations"
as a worked example alongside CO2), one `Sample` per real timestep, no declared `Gap` (HYDE's own
native spacing covers the whole domain with no missing steps).

**Verified against the sanity-check table above**, at full precision rather than only order of
magnitude — the derived series' real values, straight from `data/curated/population.parquet`
after a full (non-fixture) rebuild:

| Timestep | `t` (years BP) | World total population |
|---|---|---|
| 10,000 BCE | 12,025 | 4,432,265 |
| 1 CE | 2,025 | 232,124,272 |
| 1800 CE | 225 | 943,431,063 |
| 1900 CE | 125 | 1,642,028,156 |
| 2000 CE | 25 | 6,110,442,981 |
| 2015 CE | 10 | 7,256,964,920 |

Matches the earlier ad hoc sanity check exactly at every shared timestep (10,000 BCE, 1 CE, 1900
CE, 2000 CE, 2015 CE) — this pass reuses the same `_world_population_total` logic the sanity
check already validated, not a second, independent computation. Monotonically increasing,
consistent with published HYDE/UN order-of-magnitude figures (~1B around 1800 CE, ~6.1B in 2000,
~7.3B in 2015) at every checkpoint.

**Published.** An ordinary `SCALAR_LAYERS` entry (`pipeline/publish.py`), `chartable=True` like
`co2` (unlike `day_length`, which is chartable=false) — the readout column's own number, not just
an audio-score input.

**Out-of-domain treatment.** The series' own domain is `[10, 12,025]` years BP — identical to the
two rasters', since all three come from the same 73 HYDE timesteps. Older than 10,000 BCE the
readout reads absent ("no data"), exactly like every other scalar layer's ordinary out-of-domain
behaviour — the readout never fabricates an older figure. Nearer than 2015 CE (`t < 10`, i.e.
"today"), the naive result would also be "no data" — technically honest but a poor HUD experience
for the one stretch of `t` a viewer is most likely to be looking at (the present). Mirroring the
population-density globe overlay's own precedent (`web/src/globe/density.ts`'s `densityBlendAt`,
"held from 2015 CE to the present -- the data simply ends"), the web-side `<ScalarReadout>`
(`web/src/layers/components/ScalarReadout.tsx`) holds the 2015 CE total for any `t` nearer than
it, rather than reading absent — but, unlike the raster overlay (a colour tint with no room for a
caveat), annotates it "as of <year>" so a held reading is never mistaken for a live one. This
hold is driven by the layer's own declared domain (`timeDomain[0] > 0`), not a special case keyed
to this one layer's id, so any future scalar layer whose data similarly ends before the present
gets the same treatment for free. `TimeSeries.sample()` itself is untouched — the hold clamps
*which* `t` is sampled at the call site, exactly the pattern `densityBlendAt` already uses for the
raster, so `Layer.sample()` stays pure and every other scalar layer (CO2, whose domain already
reaches `t=0`) is unaffected.

**Formatting.** `web/src/layers/format.ts`'s `formatPopulation` (dispatched by
`formatScalarValue` whenever a scalar layer's unit is `"people"`) renders a human-scale,
unambiguous string — one decimal while the scaled value is under 10 ("2.4 million", "1.0
billion"), a whole number once it reaches double digits ("232 million") — rather than
`formatValue`'s plain `Math.round` (which would print an unreadable "7256964920" for this layer).
Unit-tested directly against the sanity-check figures above (`web/src/layers/format.test.ts`).

## Calendar year → t

`t` is years before a fixed **AD 2025 present**, the same convention `sources/co2-o2` already
uses ("years before the AD 2025 present"). For a CE-tagged timestep (`"0AD"`, `"1700AD"`, ...):
`t = 2025 − year`. For a BCE-tagged timestep (`"10000BC"`, ...): `t = 2025 + year` — i.e.
treating "10000 BCE" as exactly 10,000 years before 1 CE, not the astronomical-year-numbering
convention (which would put 1 BCE at astronomical year 0, shifting every BCE date by one
year). Given this domain spans thousands of years, a 1-year offset is immaterial to the
product; noted here rather than silently applied.

## Coverage

**73 real timesteps**, 10000 BCE → 2015 CE, at HYDE's own native spacing (ADR-031: "at HYDE's
native steps, or a sensible subset if payload demands — justify" — no subset was needed, every
native step in range is used, verified against the actual pinned tag list in
`_expected_members.json`): millennial 10000–1000 BCE (10 steps), centennial 0–1700 CE
(18 steps: 0, 100, ..., 1700), decadal 1710–2000 CE (30 steps: 1710, 1720, ..., 2000 —
continuing on from the centennial segment's own 1700), annual 2001–2015 CE (15 steps). The
real deposit ships two further timesteps, 2016 CE and 2017 CE, beyond this source's own
stated "2015 CE" endpoint — these are deliberately excluded (`fetch.py`'s
`MAX_YEAR_CE = 2015`), not unusable.

## Measured volume

**Cleared land (cropland/pasture/rangeland/conv_rangeland):**

- **Downloaded (compressed, over the network): 980,119,062 bytes (980.1 MB)** — the sum of
  every fetched member's own `compress_size` across all 73 timesteps × 4 variables
  (cropland, pasture, rangeland, conv_rangeland), measured directly from the archive's central
  directory. Avoided: the other ~4.3 GB of `HYDE3_2_1-baseline.zip` (every other variable and
  scenario, `grazing` itself included, since only its four narrower parts are ever fetched).
- **Raw on disk, uncompressed (`data/raw/hyde/`, gitignored): 16,470,989,453 bytes (16.47 GB /
  15.34 GiB)** — plain-text `.asc` grids, individually 50–65 MB each (292 files: 73 timesteps
  × 4 variables).
- Curated `data/curated/hyde_cleared_land.parquet`: 73 frames (`t`, `ref`), far under the
  git-tier threshold.
- **Generated textures (`data/media/textures/hyde_cleared_land/*.webp`): 6,507,390 bytes
  (6.51 MB) total, 73 files** — one lossless WebP per timestep, ~30–110 KB each. Up from the
  two-channel encoding's 5.29 MB (B was always 0 before, which WebP's lossless mode compressed
  away almost for free; a real, non-constant B channel, and now a non-trivial G in more cells
  too, cost a little more) — still comfortably small. Still generated by `make data` (ADR-031
  amendment); no longer published (not registered in `pipeline/publish.py`'s `RASTER_LAYERS`).

**Population density (`popc`, ADR-031 amendment):**

- **Downloaded (compressed): 689,359,459 bytes (689.4 MB)** across the same 73 timesteps, one
  variable — measured directly from the archive's central directory, the same way as above.
  Combined with cleared land's own download: **1,669,478,521 bytes (1.67 GB) total** for this
  source (`manifest.toml`'s `volume_bytes`).
- **Raw on disk, uncompressed: 5,757,232,231 bytes (5.76 GB)** — `popc_<tag>.asc`, 73 files,
  ~65–90 MB each.
- Curated `data/curated/hyde_population_density.parquet`: 73 frames, far under the git-tier
  threshold.
- **Generated textures (`data/media/textures/hyde_population_density/*.webp`): 4,464,588 bytes
  (4.46 MB) total, 73 files** — one lossless WebP per timestep (R channel populated, G/B
  zero), ~10–90 KB each depending on how much of the frame has non-zero population. Published
  (registered in `RASTER_LAYERS`, with `RasterData.encoding` decode metadata).

## Storage tier chosen

**git** for the curated parquet file (tiny). Textures are generated media, written to
`data/media/textures/hyde_cleared_land/` and committed via git-lfs — `.gitattributes` already
covers `data/media/**/*.webp`, and `data/media/` itself is not gitignored (only `data/raw/`
and `data/candidates/` are) — matching `docs/DATA_SOURCES.md`'s storage policy ("generated
media | git-lfs: pinned images + data/media/") and `sources/paleodem`'s own convention.

## Fixture

`sources/hyde/fixture/{cropland,pasture,rangeland,conv_rangeland}{0AD,1700AD}.asc` are real
downloaded grids, decimated 40:1 in both axes down to 108×54 by **block-summing** each 40×40
block of original cells into one new cell (NODATA-cells treated as 0 when summing, so a block
that is *entirely* NODATA still comes out as NODATA, not a spurious 0) — not naive strided
subsampling (every 40th row/column), which was tried first and produced fixture values so
small relative to the 40x-larger nominal cell area that every fraction rounded to ~0 and every
fixture texture came out solid black. Block-summing keeps a decimated cell's value equal to
the real *total* km² its now-larger footprint actually covers, so fractions stay meaningful.
`cellsize` is scaled up to match (`3.333332`, i.e. 40 × the real `0.0833333`) and
`xllcorner`/`yllcorner` are kept at the real full-globe extent (`-180`/`-90`) — a real, small,
still-full-globe slice, the same "smaller but genuinely real" approach `sources/paleodem`'s own
int16-re-encoded fixture takes, adapted here because HYDE's native grids (≈50–65 MB
uncompressed each) are far too large to commit even one set of four of, let alone the two
timesteps a fixture needs. Total fixture size: ~268 KB, well under the 1 MB ceiling.
`normalise.py` never hardcodes the real 4320×2160 dimensions anywhere (`ncols`/`nrows` are
always read from each file's own header), so the smaller fixture exercises the exact same code
path production data does.

## Gotchas

- **Deflate64 / system `unzip` dependency** — see "Fetch strategy" above. Not a Python
  dependency; a real, documented platform one. `Deflate64ToolMissingError`'s message names it
  if `unzip` is missing.
- **Not independently verified on Linux in this build.** This was built and run on macOS;
  macOS's Info-ZIP fork is confirmed to support Deflate64, and Info-ZIP UnZip >= 5.5 (2005)
  supports it by default on most Linux distributions too (see "Fetch strategy" above) — but
  that hasn't been checked against a real Linux `unzip -v` directly. `check_deflate64_support()`
  fails loudly and immediately if a target environment's `unzip` doesn't report it.
- **`readme_release_HYDE3.2.1.txt` states the data's own licence differently from the DANS
  deposit's CC0-1.0** (CC BY 3.0) — both recorded, see "Licence" above.
- **The deposit ships 2016/2017 CE timesteps beyond this source's own stated 2015 CE
  endpoint** — see "Coverage" above.
- **`readme_release_HYDE3.2.1.txt` states both `pasture` and `rangeland` as "aridity index >
  0.5"** — almost certainly a copy-paste error in that file (the two categories can't share a
  one-sided threshold); the actual rule, from the primary paper, is quoted in full in "Which
  HYDE variable is 'pasture'" above.

## No new dependencies

`httpx`, `tenacity`, `numpy`, `pillow` are already declared (`pyproject.toml`). The one new
dependency this source introduces is the **system `unzip` binary** (not a Python package —
see "Fetch strategy"), documented above rather than silently assumed.
