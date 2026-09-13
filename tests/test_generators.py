"""Image generator, prompt templates and the anchor gate. Offline: httpx.MockTransport only."""

from __future__ import annotations

import base64
import io
import json
import struct
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
from PIL import Image

from pipeline.generators import gate, gate_v2
from pipeline.generators.gemini import (
    MODEL_ID,
    PRICES,
    GeminiImageGenerator,
    GenerationFailed,
    TokenUsage,
    make_client,
)
from pipeline.generators.image import ImageInfo, ImageRequest, PartKind, PartOrder, sniff_image
from pipeline.generators.prompts import (
    ANCHOR_CONDITIONING,
    COMPOSITION_CONSTRAINTS,
    INVARIANT_STYLE,
    SHOT_TYPE,
    SKY_BY_ARIDITY,
    STYLE_REFERENCE_CONDITIONING,
    STYLE_REFERENCE_SUBJECT,
    WATER_EDGE_SERIES_COMPOSITION,
    Aridity,
    ChapterId,
    MissingCondition,
    SceneContent,
    ScenePrompt,
    Shot,
    UnsourcedConditions,
    render_conditioned_prompt,
    render_conditions,
    render_prompt,
    render_style_reference_prompt,
    render_style_referenced_prompt,
    render_subject,
)
from pipeline.graph import AssetKind, AssetNode, Candidate
from pipeline.models import AtmosphereState, SkyState, WorldModel, WorldState
from pipeline.shapes import Interpolation, Sample, TimeSeries
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
    with pytest.raises(httpx.HTTPStatusError):
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


# -- prompts ---------------------------------------------------------------------------------


def test_prompts_follow_template_order_and_conditioning_is_prepended() -> None:
    scene = ScenePrompt(
        shot=Shot.WATER_EDGE, chapter=ChapterId.MESOZOIC, conditions="hazy", subject="a sauropod"
    )
    expected = "\n\n".join(
        [
            INVARIANT_STYLE,
            SHOT_TYPE[Shot.WATER_EDGE],
            COMPOSITION_CONSTRAINTS[ChapterId.MESOZOIC],
            "Conditions: hazy",
            "Subject: a sauropod",
        ]
    )
    assert render_prompt(scene) == expected
    assert render_conditioned_prompt(scene) == f"{ANCHOR_CONDITIONING}\n\n{expected}"


# -- gate ------------------------------------------------------------------------------------


def test_gate_scenes_share_shot_and_chapter_and_condition_on_anchor_only(tmp_path: Path) -> None:
    generator = _generator_stub(tmp_path)
    anchor = gate.anchor_node(generator)
    anchor_path = tmp_path / "00-anchor.png"
    nodes = [gate.scene_node(generator, shot, anchor, anchor_path) for shot in gate.SCENES]

    assert "reference" not in anchor.inputs
    assert {(s.scene.shot, s.scene.chapter) for s in (gate.ANCHOR, *gate.SCENES)} == {
        (Shot.WATER_EDGE, ChapterId.MESOZOIC)
    }
    assert [(n.inputs["reference"], n.depends_on) for n in nodes] == [
        ({"path": str(anchor_path), "part_order": "text_first"}, [anchor.id])
    ] * 3


def test_gate_writes_four_images_and_a_report(tmp_path: Path) -> None:
    requests: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=_image_body(_png(2752, 1536, bytes([len(requests)]))))

    out_dir = tmp_path / "gate"
    report = gate.run_gate(_generator(handler, tmp_path / "spend.json"), out_dir)

    assert sorted(p.name for p in out_dir.iterdir()) == [
        "00-anchor.png",
        "01-late-triassic.png",
        "02-late-jurassic.png",
        "03-late-cretaceous.png",
        "gate.json",
    ]
    assert gate.GateReport.model_validate_json((out_dir / "gate.json").read_text()) == report
    assert [(r.conditioned_on_anchor, r.reference, r.width, r.model_id) for r in report.images] == [
        (False, None, 2752, MODEL_ID),
        (True, "00-anchor.png", 2752, MODEL_ID),
        (True, "00-anchor.png", 2752, MODEL_ID),
        (True, "00-anchor.png", 2752, MODEL_ID),
    ]
    anchor_b64 = _b64((out_dir / "00-anchor.png").read_bytes())
    assert [len(r["contents"][0]["parts"]) for r in requests] == [1, 2, 2, 2]
    assert {r["contents"][0]["parts"][1]["inlineData"]["data"] for r in requests[1:]} == {
        anchor_b64
    }


def test_gate_retries_a_failed_image_once_then_stops(tmp_path: Path) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}})

    out_dir = tmp_path / "gate"
    with pytest.raises(gate.GateStopped, match="failed 2 times"):
        gate.run_gate(_generator(handler, tmp_path / "spend.json"), out_dir)

    assert len(calls) == 2
    assert list(out_dir.iterdir()) == []


def test_gate_refuses_a_non_empty_output_directory(tmp_path: Path) -> None:
    (tmp_path / "00-anchor.png").write_bytes(b"approved")
    with pytest.raises(gate.GateStopped, match="not empty"):
        gate.run_gate(_generator_stub(tmp_path / "ledger"), tmp_path)


# -- conditions and subject templates --------------------------------------------------------


def test_render_conditions_projects_world_state_and_unsourced_values() -> None:
    state = WorldState(
        t=3.1e8,
        atmosphere=AtmosphereState(co2_ppm=351.14),
        sky=SkyState(day_length_hours=22.96, solar_luminosity_rel=0.9736),
    )
    unsourced = UnsourcedConditions(o2_percent=32, mean_temp_c=16, aridity=Aridity.HUMID)

    assert render_conditions(state, unsourced) == (
        "About 310 million years ago. "
        "Atmosphere: CO2 351 ppm, close to today's level; oxygen 32%, far richer than today's 21%. "
        "Global mean temperature about 16 °C, an icehouse world with ice at the poles, though the "
        "tropics stay hot. "
        "The Sun is 2.6% fainter than today; a day lasts 23.0 hours. "
        f"{SKY_BY_ARIDITY[Aridity.HUMID]}"
    )


def test_render_conditions_refuses_to_invent_an_absent_world_value() -> None:
    state = WorldState(t=3.1e8, sky=SkyState(day_length_hours=22.95, solar_luminosity_rel=0.97))
    unsourced = UnsourcedConditions(o2_percent=32, mean_temp_c=16, aridity=Aridity.HUMID)

    with pytest.raises(MissingCondition, match="atmosphere.co2_ppm"):
        render_conditions(state, unsourced)


def test_render_subject_fills_one_template_from_data() -> None:
    content = SceneContent(
        setting="An estuary",
        vegetation_mass="early trees",
        shore="bare mud",
        water="brackish water",
        main_subject="a lobe-finned fish",
        far_bank="a barren upland",
        absent=("flowers", "grass"),
    )

    assert render_subject(content) == (
        "An estuary. The vegetation mass on the left: early trees. Along the near shore: bare mud. "
        "The water: brackish water. The main subject, at the waterline just right of centre: a "
        "lobe-finned fish. On the far bank at the horizon: a barren upland. None of these may "
        "appear anywhere in the frame: flowers, grass."
    )


def test_style_reference_prompt_is_the_camera_only_and_scenes_prepend_the_role() -> None:
    scene = ScenePrompt(
        shot=Shot.WATER_EDGE, chapter=ChapterId.PERMIAN_INTERIOR, conditions="dust", subject="red"
    )

    assert render_style_reference_prompt(Shot.WATER_EDGE) == "\n\n".join(
        [INVARIANT_STYLE, SHOT_TYPE[Shot.WATER_EDGE], STYLE_REFERENCE_SUBJECT]
    )
    assert render_style_referenced_prompt(scene) == (
        f"{STYLE_REFERENCE_CONDITIONING}\n\n{render_prompt(scene)}"
    )


# -- gate v2 ---------------------------------------------------------------------------------


def _jpeg(width: int, height: int, shade: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (shade, shade, shade)).save(buffer, "JPEG")
    return buffer.getvalue()


def _jpeg_body(image: bytes) -> dict[str, Any]:
    return {
        "candidates": [
            {
                "content": {
                    "parts": [{"inlineData": {"mimeType": "image/jpeg", "data": _b64(image)}}]
                },
                "finishReason": "STOP",
            }
        ],
        "usageMetadata": USAGE_METADATA,
    }


def _world() -> WorldModel:
    def series(series_id: str, unit: str, value: float) -> TimeSeries:
        return TimeSeries(
            id=series_id,
            unit=unit,
            interpolation=Interpolation.LINEAR,
            samples=[Sample(t=0, value=value), Sample(t=5e8, value=value)],
        )

    return WorldModel(
        series={
            "co2": series("co2", "ppm", 1000),
            "day_length": series("day_length", "h", 23),
            "solar_luminosity": series("solar_luminosity", "relative", 0.97),
        }
    )


def test_gate_v2_chapters_are_distinct_worlds_behind_one_camera() -> None:
    prompts = [gate_v2.scene_prompt(shot, _world()) for shot in gate_v2.CHAPTERS]

    assert [shot.chapter for shot in gate_v2.CHAPTERS] == [
        ChapterId.DEVONIAN_ESTUARY,
        ChapterId.CARBONIFEROUS_SWAMP,
        ChapterId.PERMIAN_INTERIOR,
    ]
    assert {(p.shot, COMPOSITION_CONSTRAINTS[p.chapter]) for p in prompts} == {
        (Shot.WATER_EDGE, WATER_EDGE_SERIES_COMPOSITION)
    }
    assert len({shot.unsourced.aridity for shot in gate_v2.CHAPTERS}) == 3


def test_gate_v2_writes_both_variants_a_report_and_a_contact_sheet(tmp_path: Path) -> None:
    requests: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=_jpeg_body(_jpeg(160, 90, 10 * len(requests))))

    out_dir = tmp_path / "gate-v2"
    report = gate_v2.run_gate_v2(_generator(handler, tmp_path / "spend.json"), _world(), out_dir)

    assert sorted(p.name for p in out_dir.iterdir()) == [
        "A-00-style-reference.jpg",
        "A-01-devonian.jpg",
        "A-02-carboniferous.jpg",
        "A-03-permian.jpg",
        "B-01-devonian.jpg",
        "B-02-carboniferous.jpg",
        "B-03-permian.jpg",
        "contact-sheet.jpg",
        "gate.json",
    ]
    assert gate_v2.GateV2Report.model_validate_json((out_dir / "gate.json").read_text()) == report
    text, image = PartKind.TEXT, PartKind.REFERENCE_IMAGE
    reference = "A-00-style-reference.jpg"
    assert [
        (r.variant, r.chapter, r.part_order, r.conditioned_on_reference, r.reference)
        for r in report.images
    ] == [
        ("A", "style-reference", [text], False, None),
        ("A", "devonian", [image, text], True, reference),
        ("A", "carboniferous", [image, text], True, reference),
        ("A", "permian", [image, text], True, reference),
        ("B", "devonian", [text], False, None),
        ("B", "carboniferous", [text], False, None),
        ("B", "permian", [text], False, None),
    ]

    reference_b64 = _b64((out_dir / reference).read_bytes())
    parts = [r["contents"][0]["parts"] for r in requests]
    assert parts[0] == [{"text": render_style_reference_prompt(Shot.WATER_EDGE)}]
    for a_parts, b_parts in zip(parts[1:4], parts[4:7], strict=True):
        assert a_parts == [
            {"inlineData": {"mimeType": "image/jpeg", "data": reference_b64}},
            {"text": f"{STYLE_REFERENCE_CONDITIONING}\n\n{b_parts[0]['text']}"},
        ]
        assert len(b_parts) == 1

    with Image.open(out_dir / "contact-sheet.jpg") as sheet:
        assert sheet.size == (4 * gate_v2.TILE_WIDTH, 2 * (360 + gate_v2.LABEL_HEIGHT))


def test_gate_v2_stops_at_the_paid_call_cap(tmp_path: Path) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) in {1, 3, 5}:
            return httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}})
        return httpx.Response(200, json=_jpeg_body(_jpeg(160, 90, len(calls))))

    with pytest.raises(gate.GateStopped, match="paid-call cap of 9"):
        gate_v2.run_gate_v2(_generator(handler, tmp_path / "spend.json"), _world(), tmp_path / "o")

    assert len(calls) == 9


def test_gate_v2_stops_on_a_second_failure_of_the_same_image(tmp_path: Path) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}})

    with pytest.raises(gate.GateStopped, match="failed 2 times"):
        gate_v2.run_gate_v2(_generator(handler, tmp_path / "spend.json"), _world(), tmp_path / "o")

    assert len(calls) == 2
