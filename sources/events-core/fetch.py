"""Fetch the ICS International Chronostratigraphic Chart into data/raw/events-core/.

events-core is hand-curated: data/events.yaml (committed to git, the source of truth)
already carries a specific citation per event, cross-checked by hand against ICS boundary
ages, PBDB and primary literature -- see sources/events-core/README.md for the method.
Wikidata SPARQL is optional and not used here.

This fetch downloads auxiliary reference material only. normalise() never reads data/raw/,
so a skipped or failed fetch does not block the build -- it only means the chart is not
available locally as a citation-verification aid.

Reuses `pipeline.fetching.ensure_verified_artefact` (see that module) so a second run whose
downloaded chart is already on disk and still verifies never touches the network.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

import httpx

from pipeline.fetching import ensure_verified_artefact

_MANIFEST = Path(__file__).resolve().parent / "manifest.toml"
_CHART_FILENAME = "ChronostratChart2024-12.pdf"


def _load_manifest() -> dict[str, object]:
    with _MANIFEST.open("rb") as f:
        return tomllib.load(f)


def _download(url: str) -> bytes:
    response = httpx.get(url, timeout=30.0, follow_redirects=True)
    response.raise_for_status()
    return response.content


def fetch(raw_dir: Path) -> None:
    """Ensure the ICS chart PDF is present in raw_dir and verified against the sha256
    recorded in manifest.toml, downloading it only if it is missing or doesn't verify."""
    manifest = _load_manifest()
    url = str(manifest["url"])
    expected_sha256 = str(manifest["sha256"])
    ensure_verified_artefact(raw_dir, _CHART_FILENAME, expected_sha256, lambda: _download(url))


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    fetch(repo_root / "data" / "raw" / "events-core")


if __name__ == "__main__":
    main()
