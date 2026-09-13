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
    sample_bilinear,
    texel_centres,
)


def test_a_subject_box_must_lie_inside_the_unit_square() -> None:
    with pytest.raises(ValueError, match="not a box inside the unit square"):
        SubjectBox(left=0.5, top=0.1, right=0.4, bottom=0.9)


def test_centring_puts_the_box_centre_mid_frame_and_its_longer_side_at_the_fill() -> None:
    framing = Framing.centring(SubjectBox(left=0.2, top=0.3, right=0.6, bottom=0.5), fill=0.7)

    u, v = framing.to_normalised(np.array([0.2, 0.6, 0.4]), np.array([0.4, 0.4, 0.3]))

    assert np.allclose(u, [0.15, 0.85, 0.5])
    assert np.allclose(v, [0.5, 0.5, 0.325])
    back_u, back_v = framing.from_normalised(u, v)
    assert np.allclose(back_u, [0.2, 0.6, 0.4])
    assert np.allclose(back_v, [0.4, 0.4, 0.3])


def test_texel_centres_index_rows_by_v_and_columns_by_u() -> None:
    u, v = texel_centres(4)

    assert np.allclose(u[0], [0.125, 0.375, 0.625, 0.875])
    assert np.allclose(v[:, 0], [0.125, 0.375, 0.625, 0.875])


def test_bilinear_sampling_reproduces_a_linear_field_and_clamps_at_the_edge() -> None:
    u, v = texel_centres(8)
    field = np.stack([u, 2 * v], axis=-1).astype(np.float32)

    inside = sample_bilinear(field, np.array([0.3, 0.55]), np.array([0.4, 0.6]))
    outside = sample_bilinear(field, np.array([-1.0]), np.array([2.0]))

    assert np.allclose(inside, [[0.3, 0.8], [0.55, 1.2]], atol=1e-6)
    assert np.allclose(outside, [[0.0625, 1.875]], atol=1e-6)


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


def test_a_still_field_encodes_at_the_smallest_range_and_decodes_to_exact_zero() -> None:
    encoded = encode_flow(np.zeros((4, 4, 2), dtype=np.float32))

    assert encoded.range == RANGE_QUANTUM
    assert np.array_equal(decode_flow(encoded.png, encoded.range), np.zeros((4, 4, 2)))


def test_only_square_two_channel_fields_encode() -> None:
    with pytest.raises(ValueError, match="square"):
        encode_flow(np.zeros((4, 3, 2), dtype=np.float32))
