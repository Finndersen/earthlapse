"""Download raw data into data/raw/paleodem/. Record sha256 in manifest.toml.

The upstream file is a zip of 109 per-epoch netCDF grids (see README.md "Coverage" for why
109, not the 117 the record's own description advertises). fetch() downloads the zip,
verifies its sha256 against manifest.toml, then extracts only the `*.nc` grid members
directly into raw_dir, flattening the archive's single versioned subdirectory away and
dropping the non-data members (`*.gplates.cache` viewer caches, `*.gpml`, `License.txt`) --
normalise() only ever globs `raw_dir/*.nc`.
"""

from __future__ import annotations

import hashlib
import io
import tomllib
import zipfile
from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

_MANIFEST = Path(__file__).resolve().parent / "manifest.toml"


class FetchIntegrityError(RuntimeError):
    """Downloaded bytes did not match the sha256 recorded in manifest.toml."""


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


def _extract_grids(zip_bytes: bytes, raw_dir: Path) -> None:
    raw_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        for member in archive.infolist():
            name = Path(member.filename).name
            if not name.endswith(".nc"):
                continue  # skip License.txt, All_Maps.gpml, *.gplates.cache viewer caches
            (raw_dir / name).write_bytes(archive.read(member))


def fetch(raw_dir: Path) -> None:
    """Download the Zenodo 1-degree PaleoDEM zip, verify its sha256 against
    manifest.toml, and extract its 109 per-epoch `*.nc` grids into raw_dir."""
    manifest = _load_manifest()
    url = str(manifest["url"])
    expected_sha256 = str(manifest["sha256"])
    content = _download(url)
    digest = hashlib.sha256(content).hexdigest()
    if digest != expected_sha256:
        raise FetchIntegrityError(
            f"{url}: sha256 mismatch — expected {expected_sha256}, got {digest}"
        )
    _extract_grids(content, raw_dir)


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "paleodem")
