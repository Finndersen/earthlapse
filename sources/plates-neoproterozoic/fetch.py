"""Download raw data into data/raw/plates-neoproterozoic/. Record sha256 in manifest.toml.

The upstream file is a 13.9 MB zip containing one subdirectory (`SM2_X/`) with 37 members --
plate topologies, palaeomagnetic poles, a GPlates project file, an animation, and the three
files this source actually uses. fetch() keeps the verified zip in raw_dir under its own
upstream filename (via `pipeline.fetching.ensure_verified_artefact`, which downloads it only
if it is missing or doesn't verify against manifest.toml -- the network is never touched on a
later run whose zip is already on disk and still verifies), then extracts only the continent
shapes, craton shapes and 1000-0 Ma rotation file, flattening them out of `SM2_X/` directly
into raw_dir -- normalise.py and write_outputs() read those three names only. Extraction runs
every time fetch() does (idempotent and cheap next to the download), so files deleted or
edited out from under a verified zip are still refreshed.
"""

from __future__ import annotations

import tomllib
import zipfile
from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from pipeline.fetching import ensure_verified_artefact

_MANIFEST = Path(__file__).resolve().parent / "manifest.toml"

_ZIP_FILENAME = "SM2_4485738_V2.zip"
"""The upstream filename Zenodo's API URL resolves to (the URL itself ends `/content`, not
the filename -- see manifest.toml's `url` comment), kept verbatim as the name `fetch()`
stores the zip under in raw_dir."""

# The zip's single top-level directory. Members are read from here and flattened into
# raw_dir -- see sources/paleodem/fetch.py for the same pattern.
_ARCHIVE_SUBDIR = "SM2_X"

_WANTED_MEMBERS = (
    "shapes_continents_Merdith_et_al.gpml",
    "shapes_cratons_Merdith_et_al.gpml",
    "1000_0_rotfile_Merdith_et_al.rot",
)
"""Everything else in the zip (plate topologies for the motion-compensated shader this ticket
explicitly excludes -- docs/GLOBE.md G7 -- palaeomagnetic poles, the GPlates project file, an
animation, a coastlines file) is unused here and never extracted."""


def _load_manifest() -> dict[str, object]:
    with _MANIFEST.open("rb") as f:
        return tomllib.load(f)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=2, min=2, max=30))
def _download(url: str) -> bytes:
    # 13.9 MB plus zenodo.org's own latency (observed flapping with 504s elsewhere in this
    # project -- see sources/paleodem/README.md) needs a generous timeout.
    response = httpx.get(url, timeout=180.0, follow_redirects=True)
    response.raise_for_status()
    return response.content


def _extract_members(zip_path: Path, raw_dir: Path) -> None:
    with zipfile.ZipFile(zip_path) as archive:
        for name in _WANTED_MEMBERS:
            data = archive.read(f"{_ARCHIVE_SUBDIR}/{name}")
            (raw_dir / name).write_bytes(data)


def fetch(raw_dir: Path) -> None:
    """Ensure the Zenodo Merdith et al. 2021 zip is present in raw_dir and verified against
    manifest.toml (downloading it only if needed), then (re-)extract the three members
    normalise.py and write_outputs() use."""
    manifest = _load_manifest()
    url = str(manifest["url"])
    expected_sha256 = str(manifest["sha256"])
    zip_path = ensure_verified_artefact(
        raw_dir, _ZIP_FILENAME, expected_sha256, lambda: _download(url)
    )
    _extract_members(zip_path, raw_dir)


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "plates-neoproterozoic")
