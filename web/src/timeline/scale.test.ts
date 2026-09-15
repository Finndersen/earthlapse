import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { blendScales, createLinearScale, createSymlogScale, interpolateWindow, symlogKnee, SYMLOG_C, type TimeWindow } from './scale'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]

// log-spaced t including the two domain edges, per the W7 spec's round-trip test list.
const LOG_SPACED_T: readonly number[] = [
  0,
  1,
  1e1,
  1e2,
  1e3,
  1e4,
  1e5,
  1e6,
  1e7,
  1e8,
  1e9,
  EARTH_FORMATION,
]

/** `t` values here span 10 orders of magnitude, so a single absolute tolerance is either too
 *  tight for 4.567e9 (below the ULP of a double at that magnitude) or too loose for 1. A
 *  small relative component plus an absolute floor covers both ends while still enforcing
 *  "round-trips to within 1e-6" at any scale a human would call "1e-6 years". */
function expectRoundTrips(t: number, back: number): void {
  const tolerance = Math.max(1e-6, Math.abs(t) * 1e-9)
  expect(Math.abs(back - t)).toBeLessThanOrEqual(tolerance)
}

describe.each([
  ['symlog', () => createSymlogScale(FULL_DOMAIN)],
  ['linear', () => createLinearScale(FULL_DOMAIN)],
  ['blend(k=0.5)', () => blendScales(createSymlogScale(FULL_DOMAIN), createLinearScale(FULL_DOMAIN), 0.5)],
] as const)('%s over the full domain', (_name, makeScale) => {
  it('round-trips t -> u -> t within 1e-6 for log-spaced t across the full domain', () => {
    const scale = makeScale()
    for (const t of LOG_SPACED_T) {
      const u = scale.toUnit(t)
      expectRoundTrips(t, scale.fromUnit(u))
    }
  })

  it('maps u = 0 to the oldest edge and u = 1 to the newest edge', () => {
    const scale = makeScale()
    expectRoundTrips(EARTH_FORMATION, scale.fromUnit(0))
    expectRoundTrips(0, scale.fromUnit(1))
  })

  it('is monotonically decreasing: toUnit(older) < toUnit(newer)', () => {
    const scale = makeScale()
    for (let i = 1; i < LOG_SPACED_T.length; i++) {
      expect(scale.toUnit(LOG_SPACED_T[i]!)).toBeLessThan(scale.toUnit(LOG_SPACED_T[i - 1]!))
    }
  })
})

describe('round-trip over a zoomed window', () => {
  const window: TimeWindow = [1e4, 5e4] // a narrow Holocene-adjacent window

  it('round-trips for symlog, linear and a blend, within the zoomed window', () => {
    const scales = [
      createSymlogScale(window),
      createLinearScale(window),
      blendScales(createSymlogScale(window), createLinearScale(window), 0.5),
    ]
    const sample = [window[0], (window[0] + window[1]) / 2, window[1], 2e4, 3.3e4]
    for (const scale of scales) {
      for (const t of sample) {
        expectRoundTrips(t, scale.fromUnit(scale.toUnit(t)))
      }
    }
  })
})

describe('createSymlogScale', () => {
  it('is near-linear well below SYMLOG_C and near-logarithmic well above it', () => {
    const scale = createSymlogScale(FULL_DOMAIN)
    // Equal small steps near the present should move u by roughly equal amounts (linear
    // region); equal *ratio* steps far into the past should move u by roughly equal amounts
    // (log region) rather than equal absolute steps doing so.
    const duNearPresent = scale.toUnit(100) - scale.toUnit(200)
    const duNearPresent2 = scale.toUnit(200) - scale.toUnit(300)
    expect(duNearPresent).toBeCloseTo(duNearPresent2, 3)

    const duPerOctaveEarly = scale.toUnit(1e8) - scale.toUnit(2e8)
    const duPerOctaveLate = scale.toUnit(2e8) - scale.toUnit(4e8)
    expect(duPerOctaveEarly).toBeCloseTo(duPerOctaveLate, 2)
  })

  it('gives recorded history (last 10 ka) a legible, non-sub-pixel share of the axis at full zoom-out', () => {
    const scale = createSymlogScale(FULL_DOMAIN)
    const fractionForRecordedHistory = scale.toUnit(0) - scale.toUnit(SYMLOG_C)
    // "Legible" here means comfortably above a single device pixel even on a very wide
    // screen (say 4000px) — 0.5% of the axis is 20px at that width.
    expect(fractionForRecordedHistory).toBeGreaterThan(0.005)
  })

  it('accepts an explicit knee override instead of deriving one from the window (re-review fix, 2026-09-15)', () => {
    const modern: TimeWindow = [0, 111]
    // With no override, the bare adaptive knee (span / 1000, floored at 1) badly compresses a
    // leaf-sized window: this is the bug `sectionSymlogKnee` exists to avoid for a leaf.
    const bareDefault = createSymlogScale(modern)
    const last10YearsBare = bareDefault.toUnit(0) - bareDefault.toUnit(10)
    expect(last10YearsBare).toBeGreaterThan(0.45) // reproduces the reported ~51% share

    // Overridden with the fixed SYMLOG_C (what a leaf section should draw with instead), the
    // same span reads close to true-proportional.
    const overridden = createSymlogScale(modern, SYMLOG_C)
    const last10YearsOverridden = overridden.toUnit(0) - overridden.toUnit(10)
    const trueProportion = 10 / 111
    expect(last10YearsOverridden).toBeCloseTo(trueProportion, 2)
  })
})

describe('symlogKnee (ADR-024 amendment, follow-up pass item 7)', () => {
  it('is exactly SYMLOG_C at and above the adaptive threshold (SYMLOG_C * 1000), unchanged from before the amendment', () => {
    expect(symlogKnee([0, 4.567e9])).toBe(SYMLOG_C) // the full domain
    expect(symlogKnee([0, SYMLOG_C * 1000])).toBe(SYMLOG_C) // exactly at the threshold
    expect(symlogKnee([0, 66e6])).toBe(SYMLOG_C) // Cenozoic
  })

  it('shrinks in proportion to the span below the threshold', () => {
    const holocene: TimeWindow = [0, 11_725]
    expect(symlogKnee(holocene)).toBeCloseTo(11_725 / 1000, 9)
    expect(symlogKnee([0, 2.58e6])).toBeCloseTo(2.58e6 / 1000, 9) // Quaternary
  })

  it('joins continuously at the threshold: span/1000 and SYMLOG_C agree there, with no jump either side', () => {
    const threshold = SYMLOG_C * 1000
    const justBelow = symlogKnee([0, threshold - 1])
    const atThreshold = symlogKnee([0, threshold])
    const justAbove = symlogKnee([0, threshold + 1])
    expect(atThreshold).toBe(SYMLOG_C)
    expect(justBelow).toBeCloseTo(SYMLOG_C, 1)
    expect(justAbove).toBe(SYMLOG_C)
  })

  it('never returns non-positive for a degenerate (zero-span) window', () => {
    expect(symlogKnee([0, 0])).toBeGreaterThan(0)
  })

  it('gives a small recent section a legible share of its own axis, unlike the fixed pre-amendment knee', () => {
    // Reproduces the follow-up pass complaint: under the fixed SYMLOG_C, "modern" (0-111 years,
    // a sub-section of the Holocene) was drawn at close to its true linear proportion within
    // the Holocene window — a sliver. The adaptive knee should give it comfortably more.
    const holocene: TimeWindow = [0, 11_725]
    const scale = createSymlogScale(holocene)
    const modernFraction = scale.toUnit(0) - scale.toUnit(111)
    const trueLinearFraction = 111 / 11_725
    expect(modernFraction).toBeGreaterThan(trueLinearFraction * 5)
  })
})

describe('createLinearScale', () => {
  it('collapses recorded history (last 10 ka) to a sub-pixel fraction at full zoom-out', () => {
    const scale = createLinearScale(FULL_DOMAIN)
    const fractionForRecordedHistory = scale.toUnit(0) - scale.toUnit(1e4)
    // Sub-pixel even on an 8000px display.
    expect(fractionForRecordedHistory).toBeLessThan(1 / 8000)
  })
})

describe('blendScales', () => {
  it('equals a at k=0 and b at k=1', () => {
    const symlog = createSymlogScale(FULL_DOMAIN)
    const linear = createLinearScale(FULL_DOMAIN)
    const t = 5e7
    expect(blendScales(symlog, linear, 0).toUnit(t)).toBe(symlog.toUnit(t))
    expect(blendScales(symlog, linear, 1).toUnit(t)).toBe(linear.toUnit(t))
  })

  it('interpolates toUnit linearly in k between the two endpoints', () => {
    const symlog = createSymlogScale(FULL_DOMAIN)
    const linear = createLinearScale(FULL_DOMAIN)
    const t = 5e7
    const blended = blendScales(symlog, linear, 0.5)
    expect(blended.toUnit(t)).toBeCloseTo((symlog.toUnit(t) + linear.toUnit(t)) / 2, 9)
  })

  it('throws when the two scales do not share a domain', () => {
    const a = createSymlogScale(FULL_DOMAIN)
    const b = createLinearScale([1e4, 1e5])
    expect(() => blendScales(a, b, 0.5)).toThrow(/domain/)
  })

  it('clamps k outside [0, 1]', () => {
    const symlog = createSymlogScale(FULL_DOMAIN)
    const linear = createLinearScale(FULL_DOMAIN)
    const t = 5e7
    expect(blendScales(symlog, linear, -5).toUnit(t)).toBe(symlog.toUnit(t))
    expect(blendScales(symlog, linear, 5).toUnit(t)).toBe(linear.toUnit(t))
  })
})

describe('interpolateWindow (ADR-024 section transitions)', () => {
  const warp = (t: number): number => Math.log1p(t / SYMLOG_C)
  const holocene: TimeWindow = [0, 11_725]
  const pleistocene: TimeWindow = [11_725, 2.58e6]

  it('returns the endpoints themselves at k = 0 and k = 1', () => {
    expect(interpolateWindow(FULL_DOMAIN, holocene, 0)).toBe(FULL_DOMAIN)
    expect(interpolateWindow(FULL_DOMAIN, holocene, 1)).toBe(holocene)
  })

  it('moves each edge linearly in symlog-warped space', () => {
    const [newest, oldest] = interpolateWindow(holocene, pleistocene, 0.5)
    expect(warp(newest)).toBeCloseTo((warp(0) + warp(11_725)) / 2, 10)
    expect(warp(oldest)).toBeCloseTo((warp(11_725) + warp(2.58e6)) / 2, 10)
  })

  it('stays ordered and narrows monotonically when zooming in', () => {
    let previousOldest = Infinity
    for (let k = 0; k <= 1.0001; k += 0.1) {
      const [newest, oldest] = interpolateWindow(FULL_DOMAIN, holocene, k)
      expect(newest).toBeLessThanOrEqual(oldest)
      expect(oldest).toBeLessThanOrEqual(previousOldest)
      previousOldest = oldest
    }
  })

  it('clamps k and rejects an invalid window', () => {
    expect(interpolateWindow(FULL_DOMAIN, holocene, 2)).toBe(holocene)
    expect(() => interpolateWindow([5, 1], holocene, 0.5)).toThrow()
  })
})
