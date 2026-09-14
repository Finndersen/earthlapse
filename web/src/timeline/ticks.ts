/**
 * Adaptive axis ticks for the main scrub track (README §2: "nice round values for the current
 * span and scale (Ga, Ma, ka, years, and 'present'), with no overlapping labels"). Pure —
 * takes the window, the scale actually being drawn (so ticks track a symlog<->linear toggle
 * mid-animation the same way the track itself does) and the pixel width, returns the ticks to
 * render.
 */

import type { GeoTime, TimeScale } from '@/types/layer'

import { formatGeoTime } from './format'
import type { TimeWindow } from './scale'
import { clampUnit } from './util'

export interface AxisTick {
  t: GeoTime
  label: string
  /** 0..1 across the track, from `scale.toUnit(t)`. */
  u: number
}

/** Minimum gap, in px, this module will leave between two tick labels' estimated bounding
 *  boxes — tuned for the axis's small monospace-ish numerals, not a general-purpose text
 *  metric. */
const MIN_LABEL_GAP_PX = 12

/** `label.length` -> px, without a canvas measurement context (this runs during layout, and a
 *  rough estimate is enough to decide whether two *specific* candidate ticks collide — being
 *  a little conservative just thins the axis slightly more than the theoretical minimum). */
function estimateLabelWidthPx(label: string): number {
  return label.length * 6.5 + 4
}

/** "Nice" mantissas for both the linear step search and the log-decade candidate ticks —
 *  the conventional 1-2-5 sequence, so ticks fall on values a person reads as round (10, 20,
 *  50, 100, ...) rather than an arbitrary fraction of the span. */
const NICE_MANTISSAS = [1, 2, 5] as const

function niceLinearStep(roughStep: number): number {
  if (roughStep <= 0 || !Number.isFinite(roughStep)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  for (const mantissa of NICE_MANTISSAS) {
    if (mantissa * magnitude >= roughStep) return mantissa * magnitude
  }
  return 10 * magnitude
}

/** Ticks at evenly-spaced multiples of a nice step — appropriate for `linear`, where equal
 *  raw-year spacing is also equal screen spacing. `targetCount` is a starting point only: the
 *  step is doubled (walking 1 -> 2 -> 5 -> 10x) until the resulting ticks fit `trackWidthPx`
 *  without overlapping, so this never returns a colliding set. */
function linearStepTicks(window: TimeWindow, scale: TimeScale, trackWidthPx: number): AxisTick[] {
  const [newest, oldest] = window
  const span = oldest - newest
  if (span <= 0) return [{ t: newest, label: formatGeoTime(newest), u: clampUnit(scale.toUnit(newest)) }]

  let targetCount = Math.max(2, Math.min(10, Math.floor(trackWidthPx / 80)))
  for (let attempt = 0; attempt < 8; attempt++) {
    const step = niceLinearStep(span / targetCount)
    const start = Math.ceil(newest / step) * step
    const values: GeoTime[] = []
    for (let v = start; v <= oldest + step * 1e-9; v += step) {
      values.push(Math.max(0, v))
    }
    const ticks = values.map((t) => ({ t, label: formatGeoTime(t), u: clampUnit(scale.toUnit(t)) }))
    if (!hasOverlap(ticks, trackWidthPx)) return ticks
    targetCount = Math.max(1, Math.floor(targetCount / 2))
    if (targetCount <= 1) {
      const mid = (newest + oldest) / 2
      return [{ t: mid, label: formatGeoTime(mid), u: clampUnit(scale.toUnit(mid)) }]
    }
  }
  return []
}

/**
 * `[left, right]` px bounds of a tick's rendered label, accounting for `tickLabelAlign` — an
 * edge-anchored label (e.g. "present" at `u = 1`, right-aligned so it never overhangs the track)
 * occupies a different span than a centred one would, so a collision test that assumed every
 * label was centred could both miss a real overlap and report one that alignment already
 * resolved (the present-edge defect this function exists to fix).
 */
function labelBoundsPx(u: number, label: string, trackWidthPx: number): [number, number] {
  const px = u * trackWidthPx
  const width = estimateLabelWidthPx(label)
  switch (tickLabelAlign(u, label, trackWidthPx)) {
    case 'start':
      return [px, px + width]
    case 'end':
      return [px - width, px]
    case 'center':
      return [px - width / 2, px + width / 2]
  }
}

function hasOverlap(ticks: readonly AxisTick[], trackWidthPx: number): boolean {
  const sorted = [...ticks].sort((a, b) => a.u - b.u)
  for (let i = 1; i < sorted.length; i++) {
    const [, prevRight] = labelBoundsPx(sorted[i - 1]!.u, sorted[i - 1]!.label, trackWidthPx)
    const [curLeft] = labelBoundsPx(sorted[i]!.u, sorted[i]!.label, trackWidthPx)
    if (curLeft < prevRight + MIN_LABEL_GAP_PX) return true
  }
  return false
}

/** Log-decade candidates (1/2/5 x 10^d) intersecting `[newest, oldest]`, plus 0 when it is
 *  inside the window — the "present" tick. Ranked so majors (the 1x mantissa, and present)
 *  are preferred over 5x and then 2x when thinning for overlap, matching how a person reads a
 *  log axis: the decade boundaries anchor it, the in-between ticks are a bonus when there's
 *  room. */
function symlogCandidates(window: TimeWindow): { t: GeoTime; rank: number }[] {
  const [newest, oldest] = window
  const candidates: { t: GeoTime; rank: number }[] = []

  if (newest <= 0 && oldest >= 0) candidates.push({ t: 0, rank: -1 })

  const lowT = Math.max(newest, 1)
  if (lowT > oldest) return candidates

  const minDecade = Math.floor(Math.log10(lowT))
  const maxDecade = Math.ceil(Math.log10(oldest))
  for (let d = minDecade; d <= maxDecade; d++) {
    NICE_MANTISSAS.forEach((mantissa, mantissaIndex) => {
      const t = mantissa * 10 ** d
      if (t >= newest && t <= oldest) {
        // rank 0 for the decade boundary (1x), 1 for 5x, 2 for 2x — see doc comment.
        const rank = mantissaIndex === 0 ? 0 : mantissa === 5 ? 1 : 2
        candidates.push({ t, rank })
      }
    })
  }
  return candidates
}

function symlogTicks(window: TimeWindow, scale: TimeScale, trackWidthPx: number): AxisTick[] {
  const candidates = symlogCandidates(window)
    .map((c) => ({ ...c, label: formatGeoTime(c.t), u: clampUnit(scale.toUnit(c.t)) }))
    .sort((a, b) => a.rank - b.rank || a.u - b.u)

  const accepted: AxisTick[] = []
  for (const candidate of candidates) {
    const [candidateLeft, candidateRight] = labelBoundsPx(candidate.u, candidate.label, trackWidthPx)
    const collides = accepted.some((t) => {
      const [tLeft, tRight] = labelBoundsPx(t.u, t.label, trackWidthPx)
      return candidateLeft < tRight + MIN_LABEL_GAP_PX && tLeft < candidateRight + MIN_LABEL_GAP_PX
    })
    if (!collides) accepted.push({ t: candidate.t, label: candidate.label, u: candidate.u })
  }
  return accepted.sort((a, b) => a.u - b.u)
}

/**
 * Ticks for `window` as drawn by `scale` (which may be a `blendScales` result mid-toggle —
 * `scale.kind` picks the algorithm, matching how `blendScales` itself resolves `kind`),
 * guaranteed not to overlap within `trackWidthPx`. `'linear'` gets evenly-spaced nice-step
 * ticks; `'symlog'` (and, as a reasonable default, anything else) gets log-decade candidates
 * thinned by priority.
 */
export function generateTicks(window: TimeWindow, scale: TimeScale, trackWidthPx: number): AxisTick[] {
  if (!(trackWidthPx > 0)) return []
  if (scale.kind === 'linear') return linearStepTicks(window, scale, trackWidthPx)
  return symlogTicks(window, scale, trackWidthPx)
}

export type TickLabelAlign = 'start' | 'center' | 'end'

/**
 * Which edge (if either) a tick label at `u` must hug so it never renders outside the track —
 * `'start'` left-aligns the label to its own tick position, `'end'` right-aligns it, `'center'`
 * is the normal centred case. Only the ticks nearest either edge can ever need this: a label's
 * own half-width has to reach past the track boundary for a real clip to occur (e.g. the
 * "present" tick at `u = 1`, whose centred half-width overhangs the track's right edge).
 */
export function tickLabelAlign(u: number, label: string, trackWidthPx: number): TickLabelAlign {
  if (!(trackWidthPx > 0)) return 'center'
  const px = u * trackWidthPx
  const halfWidth = estimateLabelWidthPx(label) / 2
  if (px - halfWidth < 0) return 'start'
  if (px + halfWidth > trackWidthPx) return 'end'
  return 'center'
}
