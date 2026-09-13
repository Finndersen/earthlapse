"""Local content-addressed candidate store: data/candidates/<scene_id>/<image node digest>/.

Each candidate is an image named by its own content digest plus a JSON sidecar recording the
prompt, digests, usage and cost. A node digest counts as built once a sidecar exists under it,
so an interrupted write (image without sidecar) is rebuilt rather than trusted.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from pipeline.generators.image import GeneratedImage, ImageRequest, TokenUsage
from pipeline.graph import AssetNode


class CandidateRecord(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    scene_id: str
    node_id: str
    node_digest: str
    asset_digest: str
    file: str
    prompt: str
    generator: str
    generator_version: str
    mime_type: str
    width: int
    height: int
    usage: TokenUsage | None
    cost_usd: float
    attempts: int
    created_at: datetime


@dataclass(frozen=True)
class StoredCandidate:
    record: CandidateRecord
    image_path: Path


class CandidateStore:
    """`Store` (pipeline/graph.py) for image candidates."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def has(self, digest: str) -> bool:
        return any(self.root.glob(f"*/{digest}/*.json"))

    def path_for(self, digest: str) -> Path:
        matches = [path for path in self.root.glob(f"*/{digest}") if path.is_dir()]
        if not matches:
            raise KeyError(f"no candidates stored under node digest {digest}")
        if len(matches) > 1:
            raise ValueError(f"node digest {digest} is stored under several scenes: {matches}")
        return matches[0]

    def count(self, scene_id: str, digest: str) -> int:
        return len(list((self.root / scene_id / digest).glob("*.json")))

    def candidates(self, scene_id: str) -> list[StoredCandidate]:
        """Every candidate for a scene, from any prompt digest, oldest first."""
        stored = []
        for sidecar in (self.root / scene_id).glob("*/*.json"):
            record = CandidateRecord.model_validate_json(sidecar.read_text())
            stored.append(StoredCandidate(record=record, image_path=sidecar.with_name(record.file)))
        return sorted(stored, key=lambda c: (c.record.created_at, c.image_path.name))

    def save(
        self, scene_id: str, node: AssetNode, node_digest: str, image: GeneratedImage, attempts: int
    ) -> StoredCandidate:
        directory = self.root / scene_id / node_digest
        directory.mkdir(parents=True, exist_ok=True)
        stem = f"{len(list(directory.glob('*.json'))) + 1:02d}-{image.digest}"
        image_path = directory / f"{stem}{image.info.extension}"
        image_path.write_bytes(image.data)
        record = CandidateRecord(
            scene_id=scene_id,
            node_id=node.id,
            node_digest=node_digest,
            asset_digest=image.digest,
            file=image_path.name,
            prompt=ImageRequest.from_node(node).prompt,
            generator=node.generator,
            generator_version=node.generator_version,
            mime_type=image.info.mime_type,
            width=image.info.width,
            height=image.info.height,
            usage=image.usage,
            cost_usd=image.cost_usd,
            attempts=attempts,
            created_at=datetime.now(UTC),
        )
        (directory / f"{stem}.json").write_text(record.model_dump_json(indent=2))
        return StoredCandidate(record=record, image_path=image_path)
