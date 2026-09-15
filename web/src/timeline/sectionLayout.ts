/**
 * Horizontal layout for the section band strip (ADR-024, amended by follow-up pass item 7, and
 * again by the re-review fix below). Each band is at least as wide as the taller of a fixed
 * hit-target floor and its own `abbreviation`'s estimated width, so a label is never hidden —
 * only its *form* changes. `SectionBands` draws `section.label` when the band's final rendered
 * width also fits that, and `section.abbreviation` otherwise (always with the full name in the
 * button's `title`/`aria-label`). Sections still narrower than their natural share on the drawn
 * scale get that width made up from wider siblings, in proportion to their own natural width —
 * exactly as before the amendment, just with a per-band floor instead of one shared constant.
 *
 * **Re-review fix (2026-09-15).** The amendment's own "when even the sum of every floor does not
 * fit, each band gets a share proportional to its own floor" branch still *shrank every band
 * below its own floor* by whatever fraction the total overflowed by — the exact case it was
 * meant to soften, not the invariant-preserving compromise its own doc comment described. At
 * 390px this wasn't only the Holocene-children case the original ADR amendment checked (a "few
 * px" under floor, still readable): the Earth level's own six eons overflow their floor by
 * ~15% there too, undershooting badly enough that abbreviations that should have fit —
 * `"Modern"`, `"Hadean"` — still clipped to an ellipsis. A band's floor is now never shrunk
 * below what it actually needs: when the sum of every floor exceeds `stripWidthPx`,
 * `layoutSectionBands` reports a `contentWidthPx` wider than the strip instead, and every band
 * gets exactly its own required pixel floor within it. `SectionBands` makes the strip
 * horizontally scrollable in that case (a common, well-understood pattern for a tab/segment
 * strip) rather than rendering illegible text — every band's label stays genuinely intact,
 * satisfying "a label is never hidden" for real instead of only approximately.
 */

import type { TimeScale } from '@/types/layer'

import type { TimelineSection } from './sections'
import { clampUnit } from './util'

export type SectionLabelForm = 'full' | 'abbr'

export interface SectionBandLayout {
  section: TimelineSection
  /** Left edge and width as fractions of `contentWidthPx` (the sibling value
   *  `layoutSectionBands` returns alongside every band), not necessarily the visible strip's own
   *  measured width — see this module's doc comment. */
  left: number
  width: number
  /** Which of `section.label`/`section.abbreviation` fits the band's final rendered width —
   *  decided purely from that width, so it always matches what is actually drawn. `'abbr'`
   *  whenever the full label doesn't fit, including on an unmeasured strip's fallback layout
   *  (`stripWidthPx <= 0`), where nothing has a rendered width yet to test — that resolves to
   *  `'full'` instead, matching the pre-measurement state every other width-dependent bit of
   *  this package (e.g. `AxisTicks`) already renders as its default. */
  labelForm: SectionLabelForm
}

export interface SectionBandStripLayout {
  bands: readonly SectionBandLayout[]
  /** The strip's own total content width, in px: `left`/`width` on every band are fractions of
   *  *this*, not of `stripWidthPx`. Equal to `stripWidthPx` whenever every band's floor fits —
   *  the common case, where nothing about `SectionBands`' rendering needs to change — and wider
   *  than it only when the sum of every floor doesn't, so the caller knows to let the strip
   *  scroll horizontally rather than squeeze every band under its own required width. */
  contentWidthPx: number
}

/** Narrowest a band ever gets, in px, regardless of how short its abbreviation is — a mouse
 *  needs something to aim at even for a one-word label; the height rule in `SectionBands`'s CSS
 *  module covers touch. */
const MIN_HIT_WIDTH_PX = 28

/** Rough px width of a band label in `SectionBands`'s own font (9.5px mono, uppercase, 0.12em
 *  tracking) plus its button's horizontal padding (6px each side) — a heuristic in the same
 *  spirit as `ticks.ts`'s `estimateLabelWidthPx`: good enough to decide whether a *specific*
 *  label fits a *specific* band without an actual canvas measurement during layout.
 *
 *  The per-character coefficient (7px) and constant (14px: 12px padding + a 2px safety margin)
 *  come from measuring this exact font stack in-browser (`getBoundingClientRect` on an offscreen
 *  span with the same font-family/size/letter-spacing/text-transform), then rounding both up —
 *  the fitted line was `6.86 * length + 0.02`. Rounding up matters more here than for
 *  `ticks.ts`'s own estimate: an *under*-estimate there only thins the axis a little more than
 *  necessary, but an under-estimate here lets `layoutSectionBands` size a band narrower than its
 *  own label actually needs, so the label silently clips under the CSS `text-overflow: ellipsis`
 *  this measurement exists to prevent. */
function estimateBandLabelPx(label: string): number {
  return label.length * 7 + 14
}

/** Each section's displayed share of the track on `scale`, clipped to `[0, 1]`. */
function naturalWidths(sections: readonly TimelineSection[], scale: TimeScale): number[] {
  return sections.map((s) => Math.abs(clampUnit(scale.toUnit(s.window[0])) - clampUnit(scale.toUnit(s.window[1]))))
}

/**
 * Widths as fractions of `contentWidthPx` (returned alongside them), each at least its own
 * `minPx[i]` — never shrunk below it, unlike before the re-review fix (see this module's own doc
 * comment). Bands already under their floor are fixed at it, and the rest of the strip is shared
 * among the others in proportion to their natural widths; that can push a further band under its
 * own floor, so it repeats until nothing changes (at most once per band). When even the sum of
 * every floor exceeds `stripWidthPx`, every band gets exactly its own floor and `contentWidthPx`
 * grows to fit them all instead of shrinking anyone below it.
 */
function flooredWidths(
  natural: readonly number[],
  stripWidthPx: number,
  minPx: readonly number[],
): { widths: number[]; contentWidthPx: number } {
  const count = natural.length
  if (count === 0) return { widths: [], contentWidthPx: Math.max(stripWidthPx, 0) }

  const total = natural.reduce((a, b) => a + b, 0)
  if (!(stripWidthPx > 0) || total <= 0) {
    const widths = total > 0 ? natural.map((w) => w / total) : natural.map(() => 1 / count)
    return { widths, contentWidthPx: Math.max(stripWidthPx, 0) }
  }

  const minPxTotal = minPx.reduce((a, b) => a + b, 0)
  if (minPxTotal >= stripWidthPx) {
    // Every floor fits inside itself by construction — divide each by the total to get shares
    // of a content width equal to that total, rather than of the (too-narrow) visible strip.
    return { widths: minPx.map((px) => px / minPxTotal), contentWidthPx: minPxTotal }
  }

  const minShares = minPx.map((px) => px / stripWidthPx)
  const floored = new Array<boolean>(count).fill(false)
  for (;;) {
    const flooredShare = floored.reduce((sum, isFloored, i) => (isFloored ? sum + minShares[i]! : sum), 0)
    const flooredCount = floored.filter(Boolean).length
    const freeShare = 1 - flooredShare
    const freeNatural = natural.reduce((sum, w, i) => (floored[i] ? sum : sum + w), 0)
    const widths = natural.map((w, i) =>
      floored[i] ? minShares[i]! : freeNatural > 0 ? (w / freeNatural) * freeShare : freeShare / (count - flooredCount),
    )
    const newlyUnder = widths.findIndex((w, i) => !floored[i] && w < minShares[i]!)
    if (newlyUnder === -1) return { widths, contentWidthPx: stripWidthPx }
    widths.forEach((w, i) => {
      if (!floored[i] && w < minShares[i]!) floored[i] = true
    })
  }
}

/**
 * Lays `sections` (oldest first, as `childSections` returns them) out left to right against
 * `scale`. An unmeasured strip (`stripWidthPx <= 0`) falls back to plain proportional shares.
 * `left`/`width` on every returned band are fractions of the returned `contentWidthPx`, which
 * equals `stripWidthPx` unless the sum of every band's own floor exceeds it — see the module doc
 * comment and `flooredWidths` for when and why.
 */
export function layoutSectionBands(sections: readonly TimelineSection[], scale: TimeScale, stripWidthPx: number): SectionBandStripLayout {
  const natural = naturalWidths(sections, scale)
  const minPx = sections.map((s) => Math.max(MIN_HIT_WIDTH_PX, estimateBandLabelPx(s.abbreviation)))
  const { widths, contentWidthPx } = flooredWidths(natural, stripWidthPx, minPx)

  let left = 0
  const bands = sections.map((section, i) => {
    const width = widths[i]!
    const renderedPx = contentWidthPx > 0 ? width * contentWidthPx : Infinity
    const labelForm: SectionLabelForm = renderedPx >= estimateBandLabelPx(section.label) ? 'full' : 'abbr'
    const band: SectionBandLayout = { section, left, width, labelForm }
    left += width
    return band
  })
  return { bands, contentWidthPx }
}
