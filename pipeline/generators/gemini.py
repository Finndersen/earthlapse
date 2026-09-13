"""Google AI Studio image generation over the REST `generateContent` endpoint.

The only module that knows this vendor's model id, prices and wire format. Plain httpx, no
vendor SDK. Every paid call is reserved in the ledger before it is made and settled after, and
the ledger is saved at both points so a crash mid-call still leaves a record (pipeline/spend.py).
"""

from __future__ import annotations

import base64
import json
import math
import os
import time
from collections.abc import Callable
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict
from tenacity import (
    RetryCallState,
    Retrying,
    retry_if_exception,
    stop_after_attempt,
    stop_before_delay,
    wait_exponential,
)

from pipeline.generators.image import (
    GeneratedImage,
    GenerationFailed,
    GeneratorUnavailable,
    ImageRequest,
    ImageSize,
    MissingCredentials,
    PartKind,
    TokenUsage,
    sniff_image,
)
from pipeline.graph import AssetNode, Candidate
from pipeline.spend import Entry, Ledger

# Pinned in exactly one place. A `preview` id can change behaviour or be withdrawn
# (VISUAL_SPEC §8): bump it deliberately, never substitute another model as a fallback.
MODEL_ID = "gemini-3-pro-image-preview"
API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
API_KEY_ENV = "GOOGLE_API_KEY"
REQUEST_TIMEOUT = httpx.Timeout(300.0, connect=20.0)

# Rate limits and overload are backoff, never failure and never a model switch (VISUAL_SPEC §8).
RETRYABLE_STATUS = frozenset({429, 503})
MAX_BACKOFF_ATTEMPTS = 10
MAX_BACKOFF_SECONDS = 900.0


class ModelPrice(BaseModel):
    model_config = ConfigDict(frozen=True)

    input_per_m: float
    text_output_per_m: float  # thinking is billed at this rate too
    image_output_per_m: float
    input_image_tokens: int
    output_image_tokens: dict[ImageSize, int]


# Standard paid tier, confirmed against https://ai.google.dev/gemini-api/docs/pricing on
# 2026-09-13: $2.00/M input (text and image, ~$0.0011 per input image), $12.00/M text and
# thinking output, $120.00/M image output (~$0.134 per 1K/2K image, ~$0.24 per 4K). The page
# now lists these under the GA id; actual cost is recomputed per call from usageMetadata.
PRICES: dict[str, ModelPrice] = {
    MODEL_ID: ModelPrice(
        input_per_m=2.00,
        text_output_per_m=12.00,
        image_output_per_m=120.00,
        input_image_tokens=560,
        output_image_tokens={ImageSize.K1: 1120, ImageSize.K2: 1120, ImageSize.K4: 2000},
    )
}
# Thinking cannot be disabled on this model. An allowance keeps the reservation pessimistic.
ESTIMATED_THOUGHT_TOKENS = 1500
CHARS_PER_TOKEN_LOWER_BOUND = 3


def usage_cost_usd(usage: TokenUsage, price: ModelPrice) -> float:
    return (
        usage.prompt_tokens * price.input_per_m
        + (usage.text_output_tokens + usage.thought_tokens) * price.text_output_per_m
        + usage.image_output_tokens * price.image_output_per_m
    ) / 1e6


def load_api_key(env_file: Path) -> str:
    """The process environment wins; otherwise read the gitignored .env. Never log the result."""
    if value := os.environ.get(API_KEY_ENV):
        return value
    if env_file.is_file():
        for line in env_file.read_text().splitlines():
            name, sep, value = line.partition("=")
            if sep and name.strip() == API_KEY_ENV and value.strip():
                return value.strip().strip("\"'")
    raise MissingCredentials(f"{API_KEY_ENV} is not set in the environment or in {env_file}")


def make_client(api_key: str, transport: httpx.BaseTransport | None = None) -> httpx.Client:
    # The key travels in a header, never the URL, so it cannot leak through logged request lines.
    return httpx.Client(
        base_url=API_BASE_URL,
        headers={"x-goog-api-key": api_key},
        timeout=REQUEST_TIMEOUT,
        transport=transport,
    )


class GeminiImageGenerator:
    """`Generator` (pipeline/graph.py) and `ImageGenerator` (image.py) for the pinned model."""

    name = "google-ai-studio-image"
    version = MODEL_ID

    def __init__(
        self,
        client: httpx.Client,
        ledger: Ledger,
        ledger_path: Path,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._client = client
        self._ledger = ledger
        self._ledger_path = ledger_path
        self._sleep = sleep

    def estimate_usd(self, node: AssetNode) -> float:
        return estimate_usd(ImageRequest.from_node(node), PRICES[MODEL_ID])

    def generate(self, node: AssetNode, n: int, out_dir: Path) -> list[Candidate]:
        out_dir.mkdir(parents=True, exist_ok=True)
        candidates = []
        for _ in range(n):
            image = self.render(node)
            path = out_dir / f"{node.id}-{image.digest}{image.info.extension}"
            path.write_bytes(image.data)
            candidates.append(
                Candidate(
                    node_id=node.id,
                    asset_digest=image.digest,
                    path=str(path),
                    cost_usd=image.cost_usd,
                )
            )
        return candidates

    def render(self, node: AssetNode) -> GeneratedImage:
        """Exactly one paid call. Raises `BudgetExceeded` before spending past the ceiling."""
        request = ImageRequest.from_node(node)
        price = PRICES[MODEL_ID]
        estimate = estimate_usd(request, price)
        entry = self._ledger.reserve(node.id, self.name, 1, estimate)
        self._ledger.save(self._ledger_path)
        try:
            body = self._post_with_backoff(build_request_body(request))
        except httpx.HTTPStatusError as err:
            self._settle(entry, 0.0)  # a rejected request is not billed
            status = err.response.status_code
            if status in RETRYABLE_STATUS:
                raise GeneratorUnavailable(f"{node.id}: HTTP {status} outlasted backoff") from err
            raise GenerationFailed(f"{node.id}: HTTP {status}") from err
        except httpx.TransportError as err:
            # The request may have reached the provider and been billed, so the pessimistic
            # reservation stands unsettled rather than being zeroed.
            raise GenerationFailed(f"{node.id}: {type(err).__name__}: {err}") from err
        usage = parse_usage(body)
        cost = usage_cost_usd(usage, price) if usage is not None else estimate
        self._settle(entry, cost)
        data = extract_final_image(body)
        return GeneratedImage(data=data, info=sniff_image(data), usage=usage, cost_usd=cost)

    def _settle(self, entry: Entry, actual_usd: float) -> None:
        self._ledger.settle(entry, actual_usd)
        self._ledger.save(self._ledger_path)

    def _post_with_backoff(self, body: dict[str, Any]) -> dict[str, Any]:
        retrying = Retrying(
            retry=retry_if_exception(_is_retryable),
            wait=_wait_for_retry,
            stop=stop_after_attempt(MAX_BACKOFF_ATTEMPTS) | stop_before_delay(MAX_BACKOFF_SECONDS),
            sleep=self._sleep,
            reraise=True,
        )
        return retrying(self._post_once, body)

    def _post_once(self, body: dict[str, Any]) -> dict[str, Any]:
        response = self._client.post(f"/models/{MODEL_ID}:generateContent", json=body)
        response.raise_for_status()
        payload: dict[str, Any] = response.json()
        return payload


def estimate_usd(request: ImageRequest, price: ModelPrice) -> float:
    prompt_tokens = math.ceil(len(request.prompt) / CHARS_PER_TOKEN_LOWER_BOUND)
    if request.reference is not None:
        prompt_tokens += price.input_image_tokens
    usage = TokenUsage(
        prompt_tokens=prompt_tokens,
        text_output_tokens=0,
        image_output_tokens=price.output_image_tokens[request.image_size],
        thought_tokens=ESTIMATED_THOUGHT_TOKENS,
    )
    return usage_cost_usd(usage, price)


def build_request_body(request: ImageRequest) -> dict[str, Any]:
    return {
        "contents": [
            {"role": "user", "parts": [_request_part(request, kind) for kind in request.part_kinds]}
        ],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {
                "aspectRatio": request.aspect_ratio,
                "imageSize": request.image_size.value,
            },
        },
    }


def _request_part(request: ImageRequest, kind: PartKind) -> dict[str, Any]:
    match kind:
        case PartKind.TEXT:
            return {"text": request.prompt}
        case PartKind.REFERENCE_IMAGE:
            assert request.reference is not None, "part_kinds lists an image only with a reference"
            reference = request.reference.path.read_bytes()
            return {
                "inlineData": {
                    "mimeType": sniff_image(reference).mime_type,
                    "data": base64.b64encode(reference).decode("ascii"),
                }
            }


def parse_usage(body: dict[str, Any]) -> TokenUsage | None:
    meta = body.get("usageMetadata")
    if meta is None:
        return None
    by_modality = {d["modality"]: d["tokenCount"] for d in meta.get("candidatesTokensDetails", [])}
    if by_modality:
        image_tokens = by_modality.get("IMAGE", 0)
        text_tokens = sum(count for modality, count in by_modality.items() if modality != "IMAGE")
    else:
        # Unattributed output is priced at the image rate, the dearer of the two.
        image_tokens, text_tokens = meta.get("candidatesTokenCount", 0), 0
    return TokenUsage(
        prompt_tokens=meta.get("promptTokenCount", 0),
        text_output_tokens=text_tokens,
        image_output_tokens=image_tokens,
        thought_tokens=meta.get("thoughtsTokenCount", 0),
    )


def extract_final_image(body: dict[str, Any]) -> bytes:
    """The final rendered image. Interim thought images (`thought: true`) are skipped."""
    block_reason = body.get("promptFeedback", {}).get("blockReason")
    if block_reason is not None:
        raise GenerationFailed(f"prompt blocked: {block_reason}")
    candidates = body.get("candidates") or []
    if not candidates:
        raise GenerationFailed("response carried no candidates")
    candidate = candidates[0]
    parts = candidate.get("content", {}).get("parts", [])
    final_parts = [p for p in parts if not p.get("thought", False)]
    images = [p["inlineData"] for p in final_parts if "inlineData" in p]
    if not images:
        text = " ".join(p["text"] for p in final_parts if "text" in p)
        raise GenerationFailed(
            f"no image in response (finishReason={candidate.get('finishReason')}): {text[:300]}"
        )
    return base64.b64decode(images[-1]["data"])


def retry_after_seconds(response: httpx.Response) -> float | None:
    """Server-requested delay: the Retry-After header, else a google.rpc.RetryInfo in the body."""
    header = response.headers.get("retry-after")
    if header is not None:
        if header.strip().isdigit():
            return float(header)
        return max(0.0, (parsedate_to_datetime(header) - datetime.now(UTC)).total_seconds())
    try:
        payload = response.json()
    except json.JSONDecodeError:
        return None  # a non-JSON error page carries no RetryInfo
    details = payload.get("error", {}).get("details", []) if isinstance(payload, dict) else []
    for detail in details:
        if detail.get("@type", "").endswith("google.rpc.RetryInfo"):
            return float(detail["retryDelay"].removesuffix("s"))
    return None


def _is_retryable(error: BaseException) -> bool:
    return (
        isinstance(error, httpx.HTTPStatusError) and error.response.status_code in RETRYABLE_STATUS
    )


_exponential_backoff = wait_exponential(multiplier=2, min=2, max=60)


def _wait_for_retry(state: RetryCallState) -> float:
    assert state.outcome is not None, "tenacity waits only after an attempt has an outcome"
    error = state.outcome.exception()
    if isinstance(error, httpx.HTTPStatusError):
        requested = retry_after_seconds(error.response)
        if requested is not None:
            return requested
    return _exponential_backoff(state)
