"""Download raw data into data/raw/hyde/: `cropland<tag>.asc`, `pasture<tag>.asc`,
`rangeland<tag>.asc`, `conv_rangeland<tag>.asc` and `popc_<tag>.asc` per HYDE timestep,
flattened directly into raw_dir (no per-timestep subdirectory) -- normalise() globs
`raw_dir/<variable>*.asc` for the land-use variables and `raw_dir/popc_*.asc` for population.

Unlike every other source in this project, this does **not** download one upstream file and
sha256-verify it whole: `HYDE3_2_1-baseline.zip` is 5.3 GB and ships every HYDE variable, of
which this project needs exactly five per timestep. `_rangezip.py` selectively extracts just
those members via HTTP Range requests (see its module docstring for the full mechanism and
why a system `unzip` is required). Each extracted file is verified against its own CRC-32,
pinned ahead of time in `_expected_members.json` (README.md "Fetch strategy" for why -- in
short, so `fetch()` can tell "everything's already here" without a network call, the same
"skip the network when what's on disk already verifies" behaviour `ensure_verified_artefact`
gives every other source's single-file case).

`LAND_USE_VARIABLES` history (README.md "Which HYDE variable is 'pasture'" has the full
account):
1. Originally `("cropland", "grazing")`.
2. Changed to `("cropland", "pasture", "rangeland")` after a rendering review found `grazing`
   (= `pasture` + `rangeland` + `conv_rangeland`, confirmed by direct arithmetic on real 0 CE
   data) paints natural rangeland (Sahel/savanna, Madagascar, much of Europe's semi-natural
   grassland) as if it were cleared land.
3. Changed again to `("cropland", "pasture", "rangeland", "conv_rangeland")` after checking the
   primary source (Klein Goldewijk et al. 2017, ESSD 9:927-953) for what `conv_rangeland`
   actually means: it is grazing land in *forest* biomes, which HYDE's own authors state should
   be treated as cleared ("for rangeland, the natural vegetation remains intact if it is
   non-forest, but is cleared if it is forest ... Rangeland-converted is located in forest
   biomes ... and is assumed to have undergone conversion of natural vegetation"). It therefore
   belongs with the *cleared* channel (with `pasture`), not the *natural* one (`rangeland`
   alone, i.e. "rangeland-natural" in the paper's terms) -- see `normalise.py`'s `_render_frame`
   for the resulting R/G/B encoding.

`POPULATION_VARIABLE` (ADR-031 amendment, "population density"): `popc` -- population *count*
per cell (inhabitants, not a density) -- was added for `hyde_population_density`.
`normalise.py` divides it by the same analytically-computed true cell area used for the
land-use fractions to get people/km². Population members live in a differently-named sibling
directory inside the archive (`<tag>_pop/`, not `<tag>_lu/`) and use an underscore before the
tag in their own filename (`popc_<tag>.asc`, not `popc<tag>.asc`) -- both confirmed directly
from the archive's own central directory listing, not assumed from the land-use members'
naming convention -- see `_member_path` and `_local_filename` below."""

from __future__ import annotations

import json
import re
import shutil
import tomllib
import zlib
from pathlib import Path

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from pipeline.databuild import load_source_module

_rangezip = load_source_module(Path(__file__).resolve().parent, "_rangezip")
list_member_infos = _rangezip.list_member_infos
extract_members = _rangezip.extract_members
check_deflate64_support = _rangezip.check_deflate64_support

_SOURCE_DIR = Path(__file__).resolve().parent
_MANIFEST = _SOURCE_DIR / "manifest.toml"
_EXPECTED_MEMBERS = _SOURCE_DIR / "_expected_members.json"

LAND_USE_VARIABLES: tuple[str, ...] = ("cropland", "pasture", "rangeland", "conv_rangeland")
"""The four land-use HYDE members fetched per timestep -- README.md "Encoding" for the R/G/B
mapping (`normalise.py`'s `_render_frame` combines `pasture` + `conv_rangeland` into G; this
tuple's own order is not the channel order)."""

POPULATION_VARIABLE = "popc"
"""Population count (inhabitants per cell) -- ADR-031 amendment "population density". Fetched
separately from `LAND_USE_VARIABLES` because it lives in a differently-shaped in-archive path
(`_member_path` below) and has its own local filename convention (`_local_filename`)."""

VARIABLES: tuple[str, ...] = (*LAND_USE_VARIABLES, POPULATION_VARIABLE)
"""Every HYDE member this source fetches per timestep. Shared with
`_regenerate_expected_members.py`, so the pinned tag/CRC file and `fetch()` can never disagree
about which variables are expected."""

_TAG_RE = re.compile(r"^(\d+)(BC|AD)$")
MAX_YEAR_CE = 2015
"""This source's own stated range is "10000 BCE -> 2015 CE" (README.md "Coverage"). The real
deposit's baseline archive ships two further timesteps (2016AD, 2017AD) beyond that --
excluded here to match that range exactly, not because they're unusable."""


def _load_manifest() -> dict[str, object]:
    with _MANIFEST.open("rb") as f:
        return tomllib.load(f)


def baseline_url() -> str:
    """`manifest.toml`'s `url` field -- read from there, not duplicated as a second constant
    (the same source of truth `sources/basemap/fetch.py` reads its own `url` from)."""
    return str(_load_manifest()["url"])


def _load_expected_members() -> dict[str, dict[str, int]]:
    """Every timestep tag this source fetches, and each variable's expected CRC-32 -- pinned
    ahead of time (README.md "Fetch strategy"), not discovered from a live central-directory
    read. This is what lets `fetch()` recognise "nothing to do" without touching the network."""
    payload = json.loads(_EXPECTED_MEMBERS.read_text())
    return payload["members"]


def _member_path(tag: str, variable: str) -> str:
    """The in-archive path for one timestep's variable -- confirmed directly from the real
    archive's own central directory (not assumed): population members live under a `_pop`
    sibling directory, not `_lu`, and their own filename puts an underscore before the tag
    (`popc_<tag>.asc`), unlike the land-use members' `<variable><tag>.asc`."""
    if variable == POPULATION_VARIABLE:
        return f"baseline/asc/{tag}_pop/{variable}_{tag}.asc"
    return f"baseline/asc/{tag}_lu/{variable}{tag}.asc"


def _local_filename(tag: str, variable: str) -> str:
    """The basename `extract_members` writes to `raw_dir` -- it flattens straight from the
    archive path's own basename (`Path(name).name`), so this must exactly match `_member_path`'s
    own filename half, not silently assume every variable shares the land-use convention."""
    if variable == POPULATION_VARIABLE:
        return f"{variable}_{tag}.asc"
    return f"{variable}{tag}.asc"


def _already_cached(raw_dir: Path, tag: str, expected_crc: dict[str, int]) -> bool:
    for variable in VARIABLES:
        path = raw_dir / _local_filename(tag, variable)
        if not path.is_file():
            return False
        if zlib.crc32(path.read_bytes()) != expected_crc[variable]:
            return False
    return True


def _is_transient_network_error(exc: BaseException) -> bool:
    """Only an httpx transport failure (connection reset, timeout, DNS, ...) or a 5xx response
    is worth retrying -- a 4xx, a `Deflate64ToolMissingError` (no point retrying a missing
    binary) or a `RemoteZipMemberError` (a genuinely corrupted extraction, not a network hiccup
    of the kind a retry fixes) should surface immediately instead of silently eating three
    attempts' worth of wall-clock time first."""
    if isinstance(exc, httpx.TransportError):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500
    return False


@retry(
    retry=retry_if_exception(_is_transient_network_error),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=30),
)
def _extract_timestep(
    client: httpx.Client, url: str, member_paths: dict[str, str], raw_dir: Path, tmp_dir: Path
) -> None:
    """Retries only a transient network error (`_is_transient_network_error`) -- a corrupted
    Range-fetched chunk surfaces as `extract_members` raising `RemoteZipMemberError`
    (post-CRC-check) or `unzip` itself failing, neither of which a retry is likely to fix, so
    both propagate immediately instead of being retried. `tmp_dir` is cleared first: a
    previous failed attempt can leave a half-extracted `_extract/` behind."""
    shutil.rmtree(tmp_dir, ignore_errors=True)
    extract_members(url, client, list(member_paths.values()), raw_dir, tmp_dir)


def fetch(raw_dir: Path) -> None:
    raw_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = raw_dir / "_tmp"
    expected_members = _load_expected_members()

    pending = {
        tag: per_variable
        for tag, per_variable in expected_members.items()
        if not _already_cached(raw_dir, tag, per_variable)
    }
    if not pending:
        return  # every expected file already on disk and CRC-verified -- no network touched

    check_deflate64_support()  # preflight once, before any download (README.md "Gotchas")
    url = baseline_url()
    with httpx.Client(follow_redirects=True) as client:
        for tag in sorted(pending, key=_sort_key):
            member_paths = {variable: _member_path(tag, variable) for variable in VARIABLES}
            _extract_timestep(client, url, member_paths, raw_dir, tmp_dir)
    if tmp_dir.is_dir():
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _sort_key(tag: str) -> float:
    """Years-before-present-ish ordering for a readable/deterministic fetch order -- purely
    cosmetic (progress order), not load-bearing."""
    match = _TAG_RE.match(tag)
    assert match is not None, tag
    year, era = match.groups()
    return -int(year) if era == "AD" else int(year)


def _timestep_tag(dirname: str) -> str | None:
    """`"10000BC_lu"` -> `"10000BC"`, `"0AD_lu"` -> `"0AD"`; None for anything else (the `png`,
    `txt`, `anthromes` siblings this source never touches). Matched against the `_lu` directory
    specifically, not `_pop` -- the two share exactly the same tag set within this source's
    range (confirmed directly against the archive), so discovering tags from one is enough; no
    separate `_pop`-based discovery is needed. Used by `discover_tags` (network-based
    re-discovery, for `_regenerate_expected_members.py` only -- not on the normal `fetch()`
    path any more, see this module's docstring)."""
    if not dirname.endswith("_lu"):
        return None
    tag = dirname[: -len("_lu")]
    match = _TAG_RE.match(tag)
    if match is None:
        return None
    year, era = match.groups()
    if era == "AD" and int(year) > MAX_YEAR_CE:
        return None
    return tag


def discover_tags(client: httpx.Client) -> list[str]:
    """Every timestep tag (e.g. `"10000BC"`, `"0AD"`, `"2015AD"`) the remote archive ships
    within our target range, read from its central directory (no body download). Only used by
    `_regenerate_expected_members.py` -- the normal `fetch()` path reads the pinned
    `_expected_members.json` tag list instead, so it never needs this over the network."""
    infos = list_member_infos(baseline_url(), client)
    tags: set[str] = set()
    for info in infos:
        parts = info.filename.split("/")
        if len(parts) < 3 or parts[0] != "baseline" or parts[1] != "asc":
            continue
        tag = _timestep_tag(parts[2])
        if tag is not None:
            tags.add(tag)
    return sorted(tags, key=_sort_key)


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "hyde")
