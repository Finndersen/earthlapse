"""Fetch the ICS International Chronostratigraphic Chart into data/raw/events-core/.

events-core is hand-curated: data/events.yaml (committed to git, the source of truth)
already carries a specific citation per event, cross-checked by hand against ICS boundary
ages, PBDB and primary literature — see sources/events-core/README.md for the method.
Wikidata SPARQL is optional and not used here.

This fetch downloads auxiliary reference material only. normalise() never reads data/raw/,
so a skipped or failed fetch does not block the build — it only means the chart is not
available locally as a citation-verification aid.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import httpx

ICS_CHART_URL = "https://stratigraphy.org/ICSchart/ChronostratChart2024-12.pdf"
ICS_CHART_SHA256 = "7ce1edf87ca913933c704cae3be2f68f932d14aaa111db36c3d9c0e79e57c237"


def fetch(raw_dir: Path) -> None:
    """Download the ICS chart PDF into raw_dir, verifying it against the recorded sha256."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    target = raw_dir / "ChronostratChart2024-12.pdf"
    response = httpx.get(ICS_CHART_URL, timeout=30.0, follow_redirects=True)
    response.raise_for_status()
    digest = hashlib.sha256(response.content).hexdigest()
    if digest != ICS_CHART_SHA256:
        raise ValueError(
            f"{ICS_CHART_URL}: downloaded sha256 {digest} does not match manifest "
            f"{ICS_CHART_SHA256} — the chart has changed upstream or the download is corrupt"
        )
    target.write_bytes(response.content)


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    fetch(repo_root / "data" / "raw" / "events-core")


if __name__ == "__main__":
    main()
