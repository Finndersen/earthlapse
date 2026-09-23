"""Publish-time WebP transcode for scene stills and ancestor portraits, plus each scene's
checkpoint-pip thumbnail.

Scenes and portraits ship from the generator as JPEG at roughly 3x what photographic content
needs: scenes measured at ~0.98 bytes/pixel against 0.3-0.4 for a high-quality photographic
JPEG. WebP is already this project's format for the globe/basemap textures (1,146 files);
scenes and portraits were the outliers. `to_webp` only re-encodes -- it never resizes or
otherwise changes what a pixel shows. `to_thumbnail_webp` is the one exception that does resize:
a scene's full still is never a reasonable source for a 44px hover preview
(`ScrubTrack.module.css`'s `.pipThumb`) -- see its own docstring.

Both are publish-side transforms of the pinned original, the same category as
`pipeline.exposure`'s exposure normalisation: the pin, the candidate file on disk and its asset
digest are all untouched (ADR-005 is about never regenerating those, not about how `earthlapse
publish` encodes the bytes it writes). `pipeline.publish` is the only caller, and it must always
pass bytes decoded from a pinned original or an in-memory derivative of one, computed fresh for
that publish -- never bytes read back from a previously published file. Reading a previous
WebP back in would make every publish re-encode an already-lossy WebP, silently degrading the
image a little further on every run; feeding this module the pin's own bytes each time keeps
every publish exactly one lossy generation from the original, however many times it runs. See
`tests/test_pipeline.py`'s `test_publish_always_transcodes_scenes_from_the_pin_not_from_its_own_output`
and, for thumbnails, `test_publish_always_transcodes_thumbnails_from_the_pin_not_from_its_own_output`
for the guard.
"""

from __future__ import annotations

import io

from PIL import Image, UnidentifiedImageError

WEBP_METHOD = 6  # slowest/best compression effort; publish runs offline and infrequently.

SCENE_WEBP_QUALITY = 75
"""Chosen from measurement across scene types, not taste: a dark post-impact scene
(`kpg-darkness`), a bright desert explosion (`trinity-test`), dense foliage (`eocene-jungle`,
`carboniferous-swamp`) and a graffiti-and-crowd scene (`berlin-wall-fall`). The crowd scene is
the measured worst case at every quality tried (32.3-40.5 dB PSNR across q60-q90); at q75 it
measures 646 KB (from a 4.0 MB JPEG), PSNR 33.7 dB, and a 1:1 pixel crop of its most detailed
region (the graffiti wall) is visually indistinguishable from the original. The bright/
high-dynamic-range scene shows no visible banding in its fireball/cloud gradient at the same
setting."""

PORTRAIT_WEBP_QUALITY = 85
"""Portraits are a near-black backdrop plus one small subject, so they compress far better than
scenes at any given quality (37-45 dB PSNR across the same q60-q90 sweep). Held higher anyway
because the subject's fine anatomical detail (fur, scale texture) is exactly what
`VISUAL_SPEC.md` §10's review criteria judge: a 1:1 crop of the worst-measured plate
(`haplorhini`, dense fur) at q85 is visually indistinguishable from the original JPEG."""

THUMBNAIL_SIZE = 128
"""Width and height, in pixels, of a scene's checkpoint-pip hover preview
(`ScrubTrack.module.css`'s `.pipThumb`, a 44px CSS circle rendered at up to 3x device pixel
ratio -- 44 * 3 = 132, so 128px covers every real display without upscaling). Chosen alongside
`THUMBNAIL_WEBP_QUALITY` by measuring the full published catalogue (72 scenes) at publish time:
mean 3.25 KB, max 5.04 KB (`berlin-wall-fall`, the same graffiti-and-crowd scene that is
`SCENE_WEBP_QUALITY`'s own measured worst case), ~234 KB total -- against the 30.3 MB the
un-thumbnailed `<img>` was fetching per cold load before this existed."""

THUMBNAIL_WEBP_QUALITY = 80
"""Held a little above `SCENE_WEBP_QUALITY` (75): at `THUMBNAIL_SIZE`'s tiny pixel count, one
step of quality costs almost nothing in bytes (~1 KB across the same worst-case scene) but the
image is a circular 1:1 crop shown close to full size in the UI, where a blocky low-quality
downscale is more visible than it would be in a large photographic still."""


class TranscodeError(ValueError):
    """`data` could not be decoded as an image. Nothing is published."""


def to_webp(data: bytes, quality: int) -> bytes:
    """`data` (a JPEG or PNG, as published elsewhere in this pipeline) re-encoded as WebP at
    `quality`. Dimensions and content are unchanged; only the encoding is.

    Callers must pass bytes already decoded from a pinned original or an in-memory derivative of
    one, computed fresh for the publish under way -- see the module docstring for why.
    """
    try:
        with Image.open(io.BytesIO(data)) as image:
            buffer = io.BytesIO()
            image.convert("RGB").save(buffer, "WEBP", quality=quality, method=WEBP_METHOD)
            return buffer.getvalue()
    except UnidentifiedImageError as err:
        raise TranscodeError(f"cannot decode image for WebP transcode: {err}") from err


def to_thumbnail_webp(data: bytes, size: int, quality: int) -> bytes:
    """`data` (a JPEG or PNG, decoded from a pinned original or an in-memory derivative of one,
    same rule as `to_webp`) as a `size`x`size` WebP thumbnail.

    Centre-crops to a square *before* downscaling, rather than shrinking the source's native
    (wider) aspect ratio and letting `object-fit: cover` crop it client-side: the pip preview
    this feeds is always shown in a circular box, so the pixels outside that centred square are
    never seen, and cropping them away here is strictly fewer bytes for the same rendered result.
    """
    try:
        with Image.open(io.BytesIO(data)) as image:
            rgb = image.convert("RGB")
            side = min(rgb.width, rgb.height)
            left = (rgb.width - side) // 2
            top = (rgb.height - side) // 2
            square = rgb.crop((left, top, left + side, top + side))
            thumbnail = square.resize((size, size), Image.LANCZOS)
            buffer = io.BytesIO()
            thumbnail.save(buffer, "WEBP", quality=quality, method=WEBP_METHOD)
            return buffer.getvalue()
    except UnidentifiedImageError as err:
        raise TranscodeError(f"cannot decode image for WebP thumbnail: {err}") from err
