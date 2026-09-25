/**
 * Adaptive axis ticks for the main scrub track (README §2: "nice round values for the current
 * span and scale (Ga, Ma, ka, years, and 'present'), with no overlapping labels"). Pure —
 * takes the window, the scale actually being drawn (so ticks track a symlog<->linear toggle
 * mid-animation the same way the track itself does) and the pixel width, returns the ticks to
 * render.
 */

import type { GeoTime, TimeScale } from '@/types/layer'

import { calendarYearAt, yearsBeforePresent } from './epoch'
import { formatAge, formatCalendar, notationForWindow } from './format'
import { symlogKnee, type TimeWindow } from './scale'
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

/** The numbering an axis rounds its ticks in: ages count years back from the present; calendar
 *  years count forward, so a tick lands on 1500 or 500 BCE rather than on "525 years ago". */
interface AxisNumbering {
  label: (t: GeoTime) => string
  toT: (value: number) => GeoTime
  fromT: (t: GeoTime) => number
  /** Smallest step between ticks — a calendar axis never splits a year. */
  minStep: number
}

const AGE_NUMBERING: AxisNumbering = { label: formatAge, toT: (v) => v, fromT: (t) => t, minStep: 0 }

/** There is no year zero, so the calendar numbering never offers one as a tick. */
const CALENDAR_NUMBERING: AxisNumbering = { label: formatCalendar, toT: yearsBeforePresent, fromT: calendarYearAt, minStep: 1 }

function numberingFor(window: TimeWindow): AxisNumbering {
  return notationForWindow(window) === 'calendar' ? CALENDAR_NUMBERING : AGE_NUMBERING
}

/** Multiples of `step` within `[low, high]` in `numbering`'s own values, as `t`, skipping year
 *  zero. */
function multiplesOf(step: number, window: TimeWindow, numbering: AxisNumbering): GeoTime[] {
  const [a, b] = window.map(numbering.fromT) as [number, number]
  const [low, high] = a < b ? [a, b] : [b, a]
  const values: GeoTime[] = []
  for (let v = Math.ceil(low / step) * step; v <= high + step * 1e-9; v += step) {
    if (numbering === CALENDAR_NUMBERING && v === 0) continue
    values.push(Math.max(0, numbering.toT(v)))
  }
  return values
}

/** Ticks at evenly-spaced multiples of a nice step — appropriate for `linear`, where equal
 *  raw-year spacing is also equal screen spacing. `targetCount` is a starting point only: the
 *  step is doubled (walking 1 -> 2 -> 5 -> 10x) until the resulting ticks fit `trackWidthPx`
 *  without overlapping, so this never returns a colliding set. A window touching the present
 *  always keeps its "present" tick, dropping any step tick it would collide with. */
function linearStepTicks(window: TimeWindow, scale: TimeScale, trackWidthPx: number): AxisTick[] {
  const [newest, oldest] = window
  const span = oldest - newest
  const numbering = numberingFor(window)
  const tick = (t: GeoTime): AxisTick => ({ t, label: numbering.label(t), u: clampUnit(scale.toUnit(t)) })
  if (span <= 0) return [tick(newest)]

  const present = newest === 0 ? tick(0) : null
  let targetCount = Math.max(2, Math.min(10, Math.floor(trackWidthPx / 80)))
  for (let attempt = 0; attempt < 8; attempt++) {
    const step = Math.max(numbering.minStep, niceLinearStep(span / targetCount))
    const ticks = multiplesOf(step, window, numbering)
      .filter((t) => t !== 0)
      .map(tick)
    if (!hasOverlap(ticks, trackWidthPx)) {
      if (present === null) return ticks
      return [...ticks.filter((t) => !hasOverlap([t, present], trackWidthPx)), present].sort((a, b) => a.u - b.u)
    }
    targetCount = Math.max(1, Math.floor(targetCount / 2))
    if (targetCount <= 1) return [tick((newest + oldest) / 2)]
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

interface RankedCandidate {
  t: GeoTime
  rank: number
}

/** Log-decade candidates (1/2/5 x 10^d) intersecting `[newest, oldest]`, plus 0 when it is
 *  inside the window — the "present" tick. Ranked so majors (the 1x mantissa, and present)
 *  are preferred over 5x and then 2x when thinning for overlap, matching how a person reads a
 *  log axis: the decade boundaries anchor it, the in-between ticks are a bonus when there's
 *  room. */
function ageCandidates(window: TimeWindow): RankedCandidate[] {
  const [newest, oldest] = window
  const candidates: RankedCandidate[] = []

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

function fitsAmong(candidate: AxisTick, accepted: readonly AxisTick[], trackWidthPx: number): boolean {
  const [candidateLeft, candidateRight] = labelBoundsPx(candidate.u, candidate.label, trackWidthPx)
  return !accepted.some((t) => {
    const [tLeft, tRight] = labelBoundsPx(t.u, t.label, trackWidthPx)
    return candidateLeft < tRight + MIN_LABEL_GAP_PX && tLeft < candidateRight + MIN_LABEL_GAP_PX
  })
}

/** Accepts `candidates` best rank first (then left to right), skipping any whose label would
 *  collide with one already accepted. */
function thinByRank(candidates: readonly RankedCandidate[], scale: TimeScale, trackWidthPx: number): AxisTick[] {
  const ranked = candidates
    .map((c) => ({ ...c, label: formatAge(c.t), u: clampUnit(scale.toUnit(c.t)) }))
    .sort((a, b) => a.rank - b.rank || a.u - b.u)

  const accepted: AxisTick[] = []
  for (const { t, label, u } of ranked) {
    if (fitsAmong({ t, label, u }, accepted, trackWidthPx)) accepted.push({ t, label, u })
  }
  return accepted.sort((a, b) => a.u - b.u)
}

/** Most candidates one calendar granularity may offer; past this many there is no room left
 *  on the track to draw them. */
const MAX_CALENDAR_CANDIDATES_PER_STEP = 400

/** Calendar granularities step by 5x and 2x only (1000, 500, 100, 50, ...), so every level
 *  evenly subdivides the one above it. */
const CALENDAR_MANTISSAS = [5, 1] as const

/** Finest calendar step a log axis offers: single years crowd the stretched present. */
const MIN_CALENDAR_LOG_STEP = 5

function calendarLogSteps(span: number): number[] {
  const steps: number[] = []
  for (let d = Math.floor(Math.log10(Math.max(1, span))); d >= 0; d--) {
    for (const mantissa of CALENDAR_MANTISSAS) {
      if (mantissa * 10 ** d >= MIN_CALENDAR_LOG_STEP) steps.push(mantissa * 10 ** d)
    }
  }
  return steps
}

/**
 * Round calendar years on a log axis, coarsest granularity first, so the axis keeps its
 * millennia where it is compressed and fills in centuries and decades where it stretches. A
 * finer year is only offered inside an interval whose coarser endpoints are both drawn, so a
 * lone "400 BCE" never stands in for a "500 BCE" that did not fit.
 */
function calendarLogTicks(window: TimeWindow, scale: TimeScale, trackWidthPx: number): AxisTick[] {
  const [newest, oldest] = window
  const [lowYear, highYear] = [calendarYearAt(oldest), calendarYearAt(newest)]
  const tick = (t: GeoTime): AxisTick => ({ t, label: formatCalendar(t), u: clampUnit(scale.toUnit(t)) })
  const accepted: AxisTick[] = newest <= 0 ? [tick(0)] : []
  const drawn = new Set<number>(newest <= 0 ? [highYear] : [])
  const isDrawn = (year: number) => year === 0 || year < lowYear || year > highYear || drawn.has(year)

  let parentStep: number | null = null
  for (const step of calendarLogSteps(oldest - newest)) {
    const ts = multiplesOf(step, window, CALENDAR_NUMBERING)
    if (ts.length > MAX_CALENDAR_CANDIDATES_PER_STEP) break
    const candidates = ts.map(tick).sort((a, b) => a.u - b.u)
    for (const candidate of candidates) {
      const year = calendarYearAt(candidate.t)
      if (drawn.has(year)) continue
      if (parentStep !== null && !(isDrawn(Math.floor(year / parentStep) * parentStep) && isDrawn(Math.ceil(year / parentStep) * parentStep))) continue
      if (fitsAmong(candidate, accepted, trackWidthPx)) {
        accepted.push(candidate)
        drawn.add(year)
      }
    }
    parentStep = step
  }
  return accepted.sort((a, b) => a.u - b.u)
}

function symlogTicks(window: TimeWindow, scale: TimeScale, trackWidthPx: number): AxisTick[] {
  return notationForWindow(window) === 'calendar'
    ? calendarLogTicks(window, scale, trackWidthPx)
    : thinByRank(ageCandidates(window), scale, trackWidthPx)
}

/** Symlog windows below this ratio between the warp's slope at the newest and oldest edges
 *  (`(1 + oldest / knee) / (1 + newest / knee)`) draw close to linearly. Originally tuned
 *  against the fixed `SYMLOG_C`; now measured against `symlogKnee(window)` — the same knee
 *  `createSymlogScale` actually builds that window's scale with (`scale.ts`'s ADR-024
 *  amendment) — so this stays correct now that the knee itself shrinks for a narrow-enough
 *  window instead of staying fixed. Below the amendment's own threshold nothing changes here
 *  either: `symlogKnee` still returns `SYMLOG_C` there, byte-identical to before. Below it, a
 *  window's own children read as genuinely logarithmic against its now-smaller knee (that is
 *  the amendment's point — the sub-Holocene sections stop being flat proportional slivers), so
 *  this now correctly falls through to `symlogTicks`'s log-decade candidates there instead of
 *  the evenly-spaced ones a merely-near-linear window gets. */
const NEAR_LINEAR_SLOPE_RATIO = 4

function isNearLinearSymlogWindow(window: TimeWindow, knee: GeoTime): boolean {
  const [newest, oldest] = window
  return (1 + oldest / knee) / (1 + newest / knee) < NEAR_LINEAR_SLOPE_RATIO
}

/**
 * Ticks for `window` as drawn by `scale` (which may be a `blendScales` result mid-toggle —
 * `scale.kind` picks the algorithm, matching how `blendScales` itself resolves `kind`),
 * guaranteed not to overlap within `trackWidthPx`. `'linear'`, and a symlog window narrow enough
 * to draw almost linearly (`isNearLinearSymlogWindow`), get evenly spaced nice-step ticks, placed
 * by `scale` itself. Any other symlog window gets log-decade candidates thinned by priority.
 * A window inside the Holocene (`notationForWindow`) is labelled and rounded in calendar years.
 *
 * `knee` defaults to `symlogKnee(window)`, but the caller should pass the *actual* knee `scale`
 * was built with when it differs (re-review fix, 2026-09-15: `sections.ts`'s
 * `sectionSymlogKnee` overrides the bare default for a leaf section) — otherwise this module's
 * own near-linear judgement would disagree with the scale it's classifying, exactly the
 * mismatch this module's own doc comment already warned an unsynchronised second copy would
 * cause.
 */
export function generateTicks(window: TimeWindow, scale: TimeScale, trackWidthPx: number, knee: GeoTime = symlogKnee(window)): AxisTick[] {
  if (!(trackWidthPx > 0)) return []
  if (scale.kind === 'linear' || isNearLinearSymlogWindow(window, knee)) return linearStepTicks(window, scale, trackWidthPx)
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
