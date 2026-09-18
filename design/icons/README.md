# App icon

The shipping icon is [`icon-u-straight.svg`](icon-u-straight.svg), installed at
`web/src/app/icon.svg` (Next.js App Router picks that path up automatically — it appears as
`/icon.svg` in the build output). [`icon-v-dial.svg`](icon-v-dial.svg) is the approved backup:
identical globe and hands, plus a four-tick dial ring.

**Keep the two in sync.** They share everything except the ring, so a change to the globe or the
hands should be made to both or the backup quietly stops being a drop-in.

## What the design is

A shaded Earth whose dial is the planet itself: ocean gradient lit from the upper left, simplified
landmasses, a night crescent, and two amber hands at 10:10.

The night shadow is drawn as a **pole-to-pole ellipse arc**, not a radial line from the centre.
On a sphere seen side-on the terminator is curved and the shadow is a crescent hugging the limb; a
radial line produces a pie wedge, which is what an earlier draft did and why it read as a pie chart
rather than a lit planet.

## What was learned tuning it

These cost several rounds, so they are written down rather than rediscovered:

- **Judge at 32px, not 16.** A favicon is 16 *CSS* px, which is 32 device px on any retina display,
  and this ships as SVG so the browser rasterises at whatever size it needs. An early round
  rejected good candidates against a 16px rendering most people never see.
- **Taper is a large-format flourish.** Tapered hands look better above ~64px and worse below it,
  because the taper removes exactly the pixels carrying the signal at the tip. Constant-width
  hands of *unequal length* give the same "real dial" reading and survive downsampling; length,
  not width, is what distinguishes the hands.
- **Rings blur before ticks do.** A twelve-tick dial turns into a brown halo by 16px. Four ticks
  survive. This is why the backup has four.
- **A partial arc around a circle reads as a loading spinner.** The first draft was exactly that
  and had to be abandoned — worth remembering before reaching for an arc again.
- **Detail loses to contrast.** Generated candidates with real coastlines and graticules beat this
  one at 256px and lost badly at 32px. The bold high-contrast hand shape is what carries it.

## Generated exploration

Twelve AI-generated concepts were produced while exploring this (two rounds, $1.52 of the project's
image budget). None beat a hand-drawn SVG at icon sizes, for the contrast reason above, but they
were useful for finding the globe-plus-clock direction in the first place.
