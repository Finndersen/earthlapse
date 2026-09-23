"""Where `earthlapse` reads and writes, relative to one project root."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ProjectPaths:
    root: Path

    @property
    def scenes(self) -> Path:
        return self.root / "data" / "scenes.yaml"

    @property
    def curated(self) -> Path:
        return self.root / "data" / "curated"

    @property
    def candidates(self) -> Path:
        return self.root / "data" / "candidates"

    @property
    def review(self) -> Path:
        return self.candidates / "_review"

    @property
    def portraits(self) -> Path:
        return self.root / "data" / "portraits.yaml"

    @property
    def portrait_candidates(self) -> Path:
        return self.candidates / "portraits"

    @property
    def portrait_morphs(self) -> Path:
        # Slugs cannot start with "_", so this never collides with a lineage node's directory.
        return self.portrait_candidates / "_morph"

    @property
    def portrait_review(self) -> Path:
        return self.review / "portraits"

    @property
    def media(self) -> Path:
        return self.root / "data" / "media"

    @property
    def sources(self) -> Path:
        return self.root / "sources"

    @property
    def ledger(self) -> Path:
        return self.root / "spend.json"

    @property
    def env_file(self) -> Path:
        return self.root / ".env"
