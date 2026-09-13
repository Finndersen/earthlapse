"""Content-addressed asset graph. NORMATIVE (ADR-005, ADR-006).

An asset's identity is `hash(inputs + generator + generator_version + config)`. A rebuild
recomputes digests and regenerates only what changed. Nix/Bazel semantics, ~200 lines,
no orchestration framework (ADR-006).

The part that matters is **pinning**. Generation is nondeterministic, so a rebuild must never
silently replace an image a human approved. The flow is:

    stale node -> generate N candidates -> human picks -> pin records the choice

A pinned node is satisfied by its pin regardless of digest drift, until the pin is explicitly
cleared. Without this the project is unusable after week two.
"""

from __future__ import annotations

import hashlib
import json
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel, Field


def digest_of(payload: Any) -> str:
    """Stable digest of any JSON-serialisable payload.

    `sort_keys` makes it order-independent, so reordering a config dict does not invalidate
    every downstream asset.
    """
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


class AssetKind(StrEnum):
    PROMPT = "prompt"
    IMAGE = "image"
    DEPTH = "depth"  # deferred out of v1 by ADR-009; the node kind stays reserved
    VIDEO = "video"
    TEXTURE = "texture"
    AUDIO = "audio"
    CAPTION = "caption"


class AssetNode(BaseModel):
    """One derived artefact. Immutable; a change means a new digest, not a mutation."""

    id: str
    kind: AssetKind
    generator: str  # e.g. "flux2", "nanobanana-pro" — see the Generator protocol
    generator_version: str
    inputs: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    depends_on: list[str] = Field(default_factory=list)  # ids of upstream nodes

    def digest(self, upstream: dict[str, str] | None = None) -> str:
        """Identity of this node's expected output.

        `upstream` maps dependency id -> that dependency's digest, so a change anywhere
        upstream propagates. Callers resolve the graph in topological order and thread
        digests through.
        """
        return digest_of(
            {
                "kind": self.kind,
                "generator": self.generator,
                "generator_version": self.generator_version,
                "inputs": self.inputs,
                "config": self.config,
                "upstream": {k: (upstream or {}).get(k) for k in sorted(self.depends_on)},
            }
        )


class Pin(BaseModel):
    """A human-approved output, immune to digest drift until explicitly cleared."""

    node_id: str
    asset_digest: str  # digest of the stored artefact itself, not of the node
    path: str
    approved_by: str = "human"
    note: str | None = None


class Candidate(BaseModel):
    node_id: str
    asset_digest: str
    path: str
    cost_usd: float = 0.0


class Status(StrEnum):
    PINNED = "pinned"  # approved output exists; do nothing
    FRESH = "fresh"  # cached output matches current digest
    STALE = "stale"  # needs regeneration
    AWAITING_REVIEW = "awaiting-review"  # candidates exist, no pin yet


class Generator(Protocol):
    """One per provider. NOTHING outside pipeline/generators/ may name a provider —
    swapping vendors must be a one-line config change (see CLAUDE.md)."""

    name: str
    version: str

    def estimate_usd(self, node: AssetNode) -> float: ...

    def generate(self, node: AssetNode, n: int, out_dir: Path) -> list[Candidate]: ...


class Store(Protocol):
    """Where built artefacts live. Local dir in dev, R2 in publish."""

    def has(self, digest: str) -> bool: ...
    def path_for(self, digest: str) -> Path: ...


class Resolver:
    """Walks the graph and reports what needs doing. Decides nothing about cost or
    approval — `earthtime plan` renders this, `earthtime build` acts on it."""

    def __init__(self, nodes: list[AssetNode], pins: dict[str, Pin], store: Store) -> None:
        self.nodes = {n.id: n for n in nodes}
        self.pins = pins
        self.store = store
        self._digests: dict[str, str] = {}

    def digest(self, node_id: str) -> str:
        if node_id not in self._digests:
            node = self.nodes[node_id]
            upstream = {dep: self.digest(dep) for dep in node.depends_on}
            self._digests[node_id] = node.digest(upstream)
        return self._digests[node_id]

    def status(self, node_id: str) -> Status:
        if node_id in self.pins:
            return Status.PINNED
        return Status.FRESH if self.store.has(self.digest(node_id)) else Status.STALE

    def stale(self) -> list[AssetNode]:
        """Topologically ordered, so a build can run straight down the list."""
        out, seen = [], set()

        def visit(nid: str) -> None:
            if nid in seen:
                return
            seen.add(nid)
            for dep in self.nodes[nid].depends_on:
                visit(dep)
            if self.status(nid) is Status.STALE:
                out.append(self.nodes[nid])

        for nid in self.nodes:
            visit(nid)
        return out
