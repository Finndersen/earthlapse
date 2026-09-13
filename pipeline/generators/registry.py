"""The one place the pipeline's image generator is chosen (CLAUDE.md: vendors stay swappable).

`earthtime` asks this module for an `ImageBackend` and never names a provider or model itself.
Swapping vendors is a change to `image_backend()` and nothing else.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path
from typing import Protocol

import httpx

from pipeline.generators.gemini import (
    MODEL_ID,
    PRICES,
    GeminiImageGenerator,
    estimate_usd,
    load_api_key,
    make_client,
)
from pipeline.generators.image import ImageGenerator, ImageRequest
from pipeline.graph import AssetNode
from pipeline.spend import Ledger


class ImageBackend(Protocol):
    """A generator's identity and price list, usable offline, plus a way to open it for paid work.

    `name` and `version` go into every image node's digest, so `earthtime plan` can decide
    staleness and cost without credentials or a network connection.
    """

    name: str
    version: str

    def estimate_usd(self, node: AssetNode) -> float: ...

    def open(
        self, ledger: Ledger, ledger_path: Path, env_file: Path
    ) -> AbstractContextManager[ImageGenerator]: ...


class GeminiImageBackend:
    name = GeminiImageGenerator.name
    version = GeminiImageGenerator.version

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    def estimate_usd(self, node: AssetNode) -> float:
        return estimate_usd(ImageRequest.from_node(node), PRICES[MODEL_ID])

    @contextmanager
    def open(self, ledger: Ledger, ledger_path: Path, env_file: Path) -> Iterator[ImageGenerator]:
        with make_client(load_api_key(env_file), transport=self._transport) as client:
            yield GeminiImageGenerator(client, ledger, ledger_path)


def image_backend() -> ImageBackend:
    return GeminiImageBackend()
