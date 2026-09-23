"""Image generator: request shape, backoff, ledger, response parsing. httpx.MockTransport only."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from pipeline.generators.gemini import (
    API_KEY_ENV,
    MODEL_ID,
    GeminiImageGenerator,
    load_api_key,
    make_client,
)
from pipeline.generators.image import (
    GenerationFailed,
    ImageInfo,
    MissingCredentials,
    PartOrder,
    TokenUsage,
)
from pipeline.graph import AssetKind, AssetNode, Candidate
from pipeline.spend import BudgetExceeded, Entry, Ledger
from tests.support import b64, image_body, mock_generator, png_header

USAGE = TokenUsage(
    prompt_tokens=1200, text_output_tokens=0, image_output_tokens=1120, thought_tokens=300
)
USAGE_COST = (1200 * 2.0 + 300 * 12.0 + 1120 * 120.0) / 1e6


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
    anchor = png_header(2752, 1536, b"anchor")
    (tmp_path / "anchor.png").write_bytes(anchor)
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=image_body(png_header(2752, 1536)))

    mock_generator(handler, tmp_path / "spend.json").render(
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
                    {"inlineData": {"mimeType": "image/png", "data": b64(anchor)}},
                ],
            }
        ],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {"aspectRatio": "16:9", "imageSize": "2K"},
        },
    }


def test_unconditioned_request_has_no_image_part(tmp_path: Path) -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json=image_body(png_header(2752, 1536)))

    mock_generator(handler, tmp_path / "spend.json").render(_node())

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
            httpx.Response(200, json=image_body(png_header(2752, 1536))),
        ]
    )
    sleeps: list[float] = []
    generator = mock_generator(lambda _: next(responses), tmp_path / "spend.json", sleeps)

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

    generator = mock_generator(handler, tmp_path / "spend.json")
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


def test_transport_error_leaves_the_reservation_unsettled(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    generator = mock_generator(handler, tmp_path / "spend.json")
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
        return httpx.Response(200, json=image_body(png_header(2752, 1536)))

    generator = mock_generator(handler, ledger_path)
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
        "inlineData": {"mimeType": "image/png", "data": b64(png_header(1024, 1024))},
        "thought": True,
    }
    body = image_body(
        png_header(2752, 1536), parts_before=[{"text": "planning", "thought": True}, thought]
    )
    image = mock_generator(
        lambda _: httpx.Response(200, json=body), tmp_path / "spend.json"
    ).render(_node())

    assert image.info == ImageInfo("image/png", 2752, 1536)


def test_blocked_prompt_raises_and_is_still_settled(tmp_path: Path) -> None:
    body = {"promptFeedback": {"blockReason": "SAFETY"}, "usageMetadata": {"promptTokenCount": 100}}
    generator = mock_generator(lambda _: httpx.Response(200, json=body), tmp_path / "spend.json")

    with pytest.raises(GenerationFailed, match="SAFETY"):
        generator.render(_node())

    (entry,) = Ledger.load(tmp_path / "spend.json").entries
    assert entry.actual_usd == pytest.approx(100 * 2.0 / 1e6)


def test_generate_writes_content_addressed_candidates(tmp_path: Path) -> None:
    data = png_header(2752, 1536)
    generator = mock_generator(
        lambda _: httpx.Response(200, json=image_body(data)), tmp_path / "spend.json"
    )

    (candidate,) = generator.generate(_node(), 1, tmp_path / "out")

    digest = generator.render(_node()).digest
    path = tmp_path / "out" / f"scene-{digest}.png"
    assert candidate == Candidate(
        node_id="scene", asset_digest=digest, path=str(path), cost_usd=USAGE_COST
    )
    assert path.read_bytes() == data
