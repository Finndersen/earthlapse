"""Download raw data into data/raw/events-core/. Record sha256 in manifest.toml.

No-op for this source. events-core is hand-curated: data/events.yaml (committed to git) is the
dataset and normalise() reads only that. Its dating reference, the ICS International
Chronostratigraphic Chart v2024/12 (stratigraphy.org/ICSchart/ChronostratChart2024-12.pdf), is
cited in manifest.toml and README.md "Verification method" rather than downloaded: nothing in the
build reads it. The function is kept so events-core behaves like every other source under
`make data`.
"""

from __future__ import annotations

from pathlib import Path


def fetch(raw_dir: Path) -> None:
    """No-op: see module docstring. `raw_dir` is accepted, unused, and never created."""


if __name__ == "__main__":
    REPO_ROOT = Path(__file__).resolve().parents[2]
    fetch(REPO_ROOT / "data" / "raw" / "events-core")
