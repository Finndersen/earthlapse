"""Download raw data into data/raw/co2-o2/, one verified file per `[[artefacts]]` entry in
manifest.toml.

This source splices three upstream files (README.md), so `fetch()` loops
`pipeline.fetching.ensure_verified_artefact` once per artefact -- the same shape as
`sources/audio-stems/fetch.py`. A file already on disk that still verifies never touches the
network.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

import httpx
from pydantic import BaseModel, ConfigDict, Field
from tenacity import retry, stop_after_attempt, wait_exponential

from pipeline.fetching import ensure_verified_artefact

_MANIFEST = Path(__file__).resolve().parent / "manifest.toml"


class Artefact(BaseModel):
    """One upstream file with its own provenance."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    filename: str
    url: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    licence: str
    citation: str


class _ArtefactManifest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")

    artefacts: tuple[Artefact, ...] = Field(min_length=1)


def load_artefacts(manifest_path: Path) -> tuple[Artefact, ...]:
    with manifest_path.open("rb") as f:
        return _ArtefactManifest.model_validate(tomllib.load(f)).artefacts


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
def _download(url: str) -> bytes:
    response = httpx.get(url, timeout=30.0, follow_redirects=True)
    response.raise_for_status()
    return response.content


def fetch(raw_dir: Path) -> None:
    """Ensure every artefact in manifest.toml is present in raw_dir and verified against its
    own sha256, downloading only the ones missing or that don't verify."""
    for artefact in load_artefacts(_MANIFEST):
        ensure_verified_artefact(
            raw_dir, artefact.filename, artefact.sha256, lambda url=artefact.url: _download(url)
        )


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "co2-o2")
