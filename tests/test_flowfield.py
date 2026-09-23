"""Portrait morph alignment maths and the PNG data-texture codec the viewer decodes. numpy only."""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from pipeline.flowfield import (
    FLOW_ZERO_BYTE,
    RANGE_QUANTUM,
    Framing,
    SubjectBox,
    compose_flow,
    decode_flow,
    encode_flow,
    texel_centres,
)


def test_composing_zero_flow_between_identical_framings_is_the_identity() -> None:
    framing = Framing.centring(SubjectBox(left=0.1, top=0.2, right=0.7, bottom=0.8), fill=0.7)

    field = compose_flow(np.zeros((16, 16, 2), dtype=np.float32), framing, framing, size=8)

    assert field.shape == (8, 8, 2)
    assert np.allclose(field, 0.0, atol=1e-6)


def test_composition_bakes_both_framings_and_the_normalised_flow_into_plate_uv() -> None:
    source = Framing.centring(SubjectBox(left=0.2, top=0.4, right=0.4, bottom=0.6), fill=0.7)
    target = Framing.centring(SubjectBox(left=0.5, top=0.3, right=0.9, bottom=0.7), fill=0.7)
    shift = np.array([0.05, -0.02], dtype=np.float32)
    normalised = np.broadcast_to(shift, (32, 32, 2)).astype(np.float32)

    field = compose_flow(normalised, source, target, size=12)

    u, v = texel_centres(12)
    nu, nv = source.to_normalised(u, v)
    expected_u, expected_v = target.from_normalised(nu + shift[0], nv + shift[1])
    assert np.allclose(field[..., 0], expected_u - u, atol=1e-5)
    assert np.allclose(field[..., 1], expected_v - v, atol=1e-5)
    # The source subject's centre lands on the target subject's centre, then moves by the
    # normalised shift rescaled to the target's framing.
    centre_u, centre_v = target.from_normalised(np.array(0.5 + shift[0]), np.array(0.5 + shift[1]))
    assert (float(centre_u), float(centre_v)) == pytest.approx(
        (0.7 + 0.05 / 1.75, 0.5 - 0.02 / 1.75)
    )


def test_encoding_uses_the_byte_convention_the_viewer_decodes() -> None:
    field = np.zeros((2, 2, 2), dtype=np.float32)
    field[0, 0] = [-0.25, 0.25]
    field[1, 1] = [0.25, 0.0]

    encoded = encode_flow(field)

    assert encoded.range == pytest.approx(0.25)
    assert encoded.size == 2
    with Image.open(io.BytesIO(encoded.png)) as image:
        assert image.mode == "RGB"  # no alpha: browsers may premultiply it into the colour
        pixels = np.asarray(image)
    assert pixels.tolist() == [
        [[1, 255, FLOW_ZERO_BYTE], [128, 128, FLOW_ZERO_BYTE]],
        [[128, 128, FLOW_ZERO_BYTE], [255, 128, FLOW_ZERO_BYTE]],
    ]


def test_a_flow_texture_round_trips_within_one_quantisation_step() -> None:
    rng = np.random.default_rng(7)
    field = rng.uniform(-0.3, 0.3, size=(16, 16, 2)).astype(np.float32)

    encoded = encode_flow(field)
    decoded = decode_flow(encoded.png, encoded.range)

    assert encoded.range >= float(np.abs(field).max())
    assert encoded.range == pytest.approx(round(encoded.range / RANGE_QUANTUM) * RANGE_QUANTUM)
    assert np.abs(decoded - field).max() <= encoded.range / 254 + 1e-6
