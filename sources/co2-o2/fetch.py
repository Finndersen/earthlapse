"""Download raw data into data/raw/co2-o2/. Record sha256 in manifest.toml.

Reuses `pipeline.fetching.ensure_verified_artefact` (see that module) so a second run whose
downloaded file is already on disk and still verifies never touches the network.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from pipeline.fetching import ensure_verified_artefact

_MANIFEST = Path(__file__).resolve().parent / "manifest.toml"
_RAW_FILENAME = "phanerozoic_co2.txt"


def _load_manifest() -> dict[str, object]:
    with _MANIFEST.open("rb") as f:
        return tomllib.load(f)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
def _download(url: str) -> bytes:
    response = httpx.get(url, timeout=30.0, follow_redirects=True)
    response.raise_for_status()
    return response.content


def fetch(raw_dir: Path) -> None:
    """Ensure the NOAA GEOCARB III phanerozoic CO2 file is present in raw_dir and verified
    against the sha256 recorded in manifest.toml, downloading it only if it is missing or
    doesn't verify."""
    manifest = _load_manifest()
    url = str(manifest["url"])
    expected_sha256 = str(manifest["sha256"])
    ensure_verified_artefact(raw_dir, _RAW_FILENAME, expected_sha256, lambda: _download(url))


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "co2-o2")
