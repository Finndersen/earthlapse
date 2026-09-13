"""Image generator: request shape, backoff, ledger, response parsing. httpx.MockTransport only."""

from __future__ import annotations

import base64
import json
import struct
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest

from pipeline.generators.gemini import (
    API_KEY_ENV,
    MAX_BACKOFF_ATTEMPTS,
    MODEL_ID,
    PRICES,
    GeminiImageGenerator,
    load_api_key,
    make_client,
)
from pipeline.generators.image import (
    GenerationFailed,
    GeneratorUnavailable,
    ImageInfo,
    ImageRequest,
    MissingCredentials,
    PartKind,
    PartOrder,
    TokenUsage,
    sniff_image,
)
from pipeline.graph import AssetKind, AssetNode, Candidate
from pipeline.spend import BudgetExceeded, Entry, Ledger

Handler = Callable[[httpx.Request], httpx.Response]

USAGE_METADATA = {
    "promptTokenCount": 1200,
    "candidatesTokenCount": 1120,
    "candidatesTokensDetails": [{"modality": "IMAGE", "tokenCount": 1120}],
    "thoughtsTokenCount": 300,
    "totalTokenCount": 2620,
}
USAGE = TokenUsage(
    prompt_tokens=1200, text_output_tokens=0, image_output_tokens=1120, thought_tokens=300
)
USAGE_COST = (1200 * 2.0 + 300 * 12.0 + 1120 * 120.0) / 1e6


def _png(width: int, height: int, tag: bytes = b"") -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + tag
    )


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _image_body(image: bytes, parts_before: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    parts = [*(parts_before or []), {"inlineData": {"mimeType": "image/png", "data": _b64(image)}}]
    return {
        "candidates": [{"content": {"role": "model", "parts": parts}, "finishReason": "STOP"}],
        "usageMetadata": USAGE_METADATA,
    }


def _generator(
    handler: Handler, ledger_path: Path, sleeps: list[float] | None = None
) -> GeminiImageGenerator:
    client = make_client("test-key", transport=httpx.MockTransport(handler))
    recorded = sleeps if sleeps is not None else []
    return GeminiImageGenerator(
        client, Ledger(ceiling_usd=18.0), ledger_path, sleep=recorded.append
    )


def _node(
    node_id: str = "scene",
    reference: Path | None = None,
    part_order: PartOrder = PartOrder.TEXT_FIRST,
) -> AssetNode:
    inputs: dict[str, object] = {"prompt": "a shore"}
    if reference is not None:
        inputs["reference"] = {"path": str(reference), "part_order": part_order.value}
    return AssetNode(
        id=node_id,
        kind=AssetKind.IMAGE,
        generator=GeminiImageGenerator.name,
        generator_version=GeminiImageGenerator.version,
        inputs=inputs,
        config={"aspect_ratio": "16:9", "image_size": "2K"},
    )


# -- request shape ---------------------------------------------------------------------------


def test_conditioned_request_names_pinned_model_and_carries_anchor_inline(tmp_path: Path) -> None:
    anchor = _png(2752, 1536, b"anchor")
    (tmp_path / "anchor.png").write_bytes(anchor)
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_image_body(_png(2752, 1536)))

    _generator(handler, tmp_path / "spend.json").render(
        _node(reference=tmp_path / "anchor.png", part_order=PartOrder.TEXT_FIRST)
    )

    (request,) = seen
    assert MODEL_ID == "gemini-3-pro-image-preview"
    assert str(request.url) == (
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent"
    )
    assert request.headers["x-goog-api-key"] == "test-key"
    assert "key=" not in str(request.url)
    assert json.loads(request.content) == {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": "a shore"},
                    {"inlineData": {"mimeType": "image/png", "data": _b64(anchor)}},
                ],
            }
        ],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {"aspectRatio": "16:9", "imageSize": "2K"},
        },
    }


def test_reference_first_request_puts_the_image_before_the_text(tmp_path: Path) -> None:
    reference = _png(2752, 1536, b"style")
    (tmp_path / "style.png").write_bytes(reference)
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json=_image_body(_png(2752, 1536)))

    node = _node(reference=tmp_path / "style.png", part_order=PartOrder.REFERENCE_FIRST)
    _generator(handler, tmp_path / "spend.json").render(node)

    assert ImageRequest.from_node(node).part_kinds == (PartKind.REFERENCE_IMAGE, PartKind.TEXT)
    assert seen[0]["contents"] == [
        {
            "role": "user",
            "parts": [
                {"inlineData": {"mimeType": "image/png", "data": _b64(reference)}},
                {"text": "a shore"},
            ],
        }
    ]


def test_reference_without_part_order_is_rejected(tmp_path: Path) -> None:
    node = _node().model_copy(update={"inputs": {"prompt": "a shore", "reference": "x.png"}})
    with pytest.raises(ValueError, match="reference"):
        ImageRequest.from_node(node)


def test_unconditioned_request_has_no_image_part(tmp_path: Path) -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json=_image_body(_png(2752, 1536)))

    _generator(handler, tmp_path / "spend.json").render(_node())

    assert seen[0]["contents"] == [{"role": "user", "parts": [{"text": "a shore"}]}]


# -- rate limits -----------------------------------------------------------------------------


def test_rate_limit_and_overload_back_off_honouring_server_delay_then_succeed(
    tmp_path: Path,
) -> None:
    retry_info = {
        "error": {
            "code": 503,
            "details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "3s"}],
        }
    }
    responses = iter(
        [
            httpx.Response(429, headers={"Retry-After": "7"}, json={"error": {"code": 429}}),
            httpx.Response(503, json=retry_info),
            httpx.Response(200, json=_image_body(_png(2752, 1536))),
        ]
    )
    sleeps: list[float] = []
    generator = _generator(lambda _: next(responses), tmp_path / "spend.json", sleeps)

    image = generator.render(_node())

    assert sleeps == [7.0, 3.0]
    assert image.info == ImageInfo("image/png", 2752, 1536)
    assert Ledger.load(tmp_path / "spend.json", ceiling_usd=18.0).entries == [
        Entry(
            node_id="scene",
            generator=generator.name,
            n=1,
            estimated_usd=generator.estimate_usd(_node()),
            actual_usd=USAGE_COST,
        )
    ]


def test_non_retryable_http_error_is_not_retried_and_settles_at_zero(tmp_path: Path) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(400, json={"error": {"code": 400}})

    generator = _generator(handler, tmp_path / "spend.json")
    with pytest.raises(GenerationFailed, match="HTTP 400"):
        generator.render(_node())

    assert len(calls) == 1
    assert Ledger.load(tmp_path / "spend.json").entries == [
        Entry(
            node_id="scene",
            generator=generator.name,
            n=1,
            estimated_usd=generator.estimate_usd(_node()),
            actual_usd=0.0,
        )
    ]


def test_rate_limit_outlasting_backoff_raises_unavailable_and_settles_at_zero(
    tmp_path: Path,
) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(429, headers={"Retry-After": "1"}, json={"error": {"code": 429}})

    generator = _generator(handler, tmp_path / "spend.json")
    with pytest.raises(GeneratorUnavailable, match="HTTP 429"):
        generator.render(_node())

    assert len(calls) == MAX_BACKOFF_ATTEMPTS
    (entry,) = Ledger.load(tmp_path / "spend.json").entries
    assert entry.actual_usd == 0.0


def test_transport_error_leaves_the_reservation_unsettled(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    generator = _generator(handler, tmp_path / "spend.json")
    with pytest.raises(GenerationFailed, match="ReadTimeout"):
        generator.render(_node())

    assert Ledger.load(tmp_path / "spend.json").entries == [
        Entry(
            node_id="scene",
            generator=generator.name,
            n=1,
            estimated_usd=generator.estimate_usd(_node()),
        )
    ]


def test_missing_api_key_raises_missing_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(API_KEY_ENV, raising=False)
    with pytest.raises(MissingCredentials, match=API_KEY_ENV):
        load_api_key(tmp_path / ".env")


# -- ledger ----------------------------------------------------------------------------------


def test_ledger_is_reserved_and_saved_before_the_call_and_settled_after(tmp_path: Path) -> None:
    ledger_path = tmp_path / "spend.json"
    during_call: list[list[Entry]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        during_call.append(Ledger.load(ledger_path).entries)
        return httpx.Response(200, json=_image_body(_png(2752, 1536)))

    generator = _generator(handler, ledger_path)
    estimate = generator.estimate_usd(_node())
    image = generator.render(_node())

    assert during_call == [
        [Entry(node_id="scene", generator=generator.name, n=1, estimated_usd=estimate)]
    ]
    assert Ledger.load(ledger_path).entries == [
        Entry(
            node_id="scene",
            generator=generator.name,
            n=1,
            estimated_usd=estimate,
            actual_usd=USAGE_COST,
        )
    ]
    assert (image.usage, image.cost_usd) == (USAGE, USAGE_COST)


def test_estimate_prices_a_2k_image_plus_input_and_thinking(tmp_path: Path) -> None:
    image_only = 1120 * PRICES[MODEL_ID].image_output_per_m / 1e6
    assert image_only == pytest.approx(0.1344)
    assert image_only < _generator_stub(tmp_path).estimate_usd(_node()) < 0.2


def _generator_stub(tmp_path: Path) -> GeminiImageGenerator:
    """For tests that must not reach the transport at all."""
    return _generator(_generator_stub_handler, tmp_path / "spend.json")


def test_budget_exceeded_stops_before_any_request(tmp_path: Path) -> None:
    client = make_client("test-key", transport=httpx.MockTransport(_generator_stub_handler))
    generator = GeminiImageGenerator(client, Ledger(ceiling_usd=0.01), tmp_path / "spend.json")

    with pytest.raises(BudgetExceeded):
        generator.render(_node())

    assert not (tmp_path / "spend.json").exists()


def _generator_stub_handler(request: httpx.Request) -> httpx.Response:
    raise AssertionError(f"unexpected request to {request.url}")


# -- response parsing ------------------------------------------------------------------------


def test_interim_thought_images_are_skipped(tmp_path: Path) -> None:
    thought = {
        "inlineData": {"mimeType": "image/png", "data": _b64(_png(1024, 1024))},
        "thought": True,
    }
    body = _image_body(
        _png(2752, 1536), parts_before=[{"text": "planning", "thought": True}, thought]
    )
    image = _generator(lambda _: httpx.Response(200, json=body), tmp_path / "spend.json").render(
        _node()
    )

    assert image.info == ImageInfo("image/png", 2752, 1536)


def test_blocked_prompt_raises_and_is_still_settled(tmp_path: Path) -> None:
    body = {"promptFeedback": {"blockReason": "SAFETY"}, "usageMetadata": {"promptTokenCount": 100}}
    generator = _generator(lambda _: httpx.Response(200, json=body), tmp_path / "spend.json")

    with pytest.raises(GenerationFailed, match="SAFETY"):
        generator.render(_node())

    (entry,) = Ledger.load(tmp_path / "spend.json").entries
    assert entry.actual_usd == pytest.approx(100 * 2.0 / 1e6)


def test_text_only_response_raises(tmp_path: Path) -> None:
    body = {
        "candidates": [
            {"content": {"parts": [{"text": "I cannot"}]}, "finishReason": "IMAGE_SAFETY"}
        ]
    }
    generator = _generator(lambda _: httpx.Response(200, json=body), tmp_path / "spend.json")

    with pytest.raises(GenerationFailed, match="IMAGE_SAFETY"):
        generator.render(_node())


def test_generate_writes_content_addressed_candidates(tmp_path: Path) -> None:
    data = _png(2752, 1536)
    generator = _generator(
        lambda _: httpx.Response(200, json=_image_body(data)), tmp_path / "spend.json"
    )

    (candidate,) = generator.generate(_node(), 1, tmp_path / "out")

    digest = generator.render(_node()).digest
    path = tmp_path / "out" / f"scene-{digest}.png"
    assert candidate == Candidate(
        node_id="scene", asset_digest=digest, path=str(path), cost_usd=USAGE_COST
    )
    assert path.read_bytes() == data


def test_jpeg_dimensions_are_read_from_start_of_frame() -> None:
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00" + bytes(9)
    sof0 = b"\xff\xc0" + struct.pack(">HBHH", 17, 8, 768, 1376) + bytes(10)
    assert sniff_image(b"\xff\xd8" + app0 + sof0) == ImageInfo("image/jpeg", 1376, 768)
