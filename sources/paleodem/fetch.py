"""Download raw data into data/raw/paleodem/. Record sha256 in manifest.toml.

The upstream file is a zip of 109 per-epoch netCDF grids (see README.md "Coverage" for why
109, not the 117 the record's own description advertises). fetch() keeps the verified zip in
raw_dir under its own upstream filename (via `pipeline.fetching.ensure_verified_artefact`,
which downloads it only if it is missing or doesn't verify against manifest.toml -- the
network is never touched on a later run whose zip is already on disk and still verifies),
then extracts only the `*.nc` grid members directly into raw_dir, flattening the archive's
single versioned subdirectory away and dropping the non-data members (`*.gplates.cache`
viewer caches, `*.gpml`, `License.txt`) -- normalise() only ever globs `raw_dir/*.nc`.
Extraction runs every time fetch() does (idempotent and cheap next to the download), so
grids deleted or edited out from under a verified zip are still refreshed.
"""

from __future__ import annotations

import tomllib
import zipfile
from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from pipeline.fetching import ensure_verified_artefact

_MANIFEST = Path(__file__).resolve().parent / "manifest.toml"

_ZIP_FILENAME = "Scotese_Wright_2018_Maps_1-88_1degX1deg_PaleoDEMS_nc.zip"
"""The upstream filename Zenodo's API URL resolves to (the URL itself ends `/content`, not
the filename -- see manifest.toml's `url` comment), kept verbatim as the name `fetch()`
stores the zip under in raw_dir."""


def _load_manifest() -> dict[str, object]:
    with _MANIFEST.open("rb") as f:
        return tomllib.load(f)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=2, min=2, max=30))
def _download(url: str) -> bytes:
    # The 9.3 MB file plus zenodo.org's own latency (it has been observed flapping with
    # 504s) needs a generous timeout -- co2-o2's 30s default is sized for a 5 KB file.
    response = httpx.get(url, timeout=120.0, follow_redirects=True)
    response.raise_for_status()
    return response.content


def _extract_grids(zip_path: Path, raw_dir: Path) -> None:
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            name = Path(member.filename).name
            if not name.endswith(".nc"):
                continue  # skip License.txt, All_Maps.gpml, *.gplates.cache viewer caches
            (raw_dir / name).write_bytes(archive.read(member))


def fetch(raw_dir: Path) -> None:
    """Ensure the Zenodo 1-degree PaleoDEM zip is present in raw_dir and verified against
    manifest.toml (downloading it only if needed), then (re-)extract its 109 per-epoch
    `*.nc` grids into raw_dir."""
    manifest = _load_manifest()
    url = str(manifest["url"])
    expected_sha256 = str(manifest["sha256"])
    zip_path = ensure_verified_artefact(
        raw_dir, _ZIP_FILENAME, expected_sha256, lambda: _download(url)
    )
    _extract_grids(zip_path, raw_dir)


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "paleodem")
