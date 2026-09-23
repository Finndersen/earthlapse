import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type TimeScale } from '@/types/layer'

import {
  FISHEYE_COUPLING_RADIUS_PX,
  FISHEYE_GAIN,
  FISHEYE_HALF_WIDTH_PX,
  GAP_TAPER_HALF_WIDTH_PX,
  MIN_MARKER_SEPARATION_PX,
  RESTING_FISHEYE,
  fisheyeScale,
  isFisheyeSettled,
  moveFisheyeLens,
  stepFisheyeStrength,
  yearsPerDisplayedPixelAt,
  type FisheyeMotion,
  type FisheyeScale,
} from './fisheye'
import { createLinearScale, createSymlogScale, type TimeWindow } from './scale'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]
const TRACK_WIDTH_PX = 1440

// Three scenes ~100 years apart at ~66 Ma: ~1e-6 px apart on the undistorted symlog track.
const KPG_ARRIVAL = 66_043_000
const KPG_DARKNESS = 66_042_999.99
const KPG_AFTERMATH = 66_042_900
const KPG_TRIO = [KPG_ARRIVAL, KPG_DARKNESS, KPG_AFTERMATH] as const

const MINUTE_YEARS = 1 / (365.25 * 24 * 60)

/** Every distinct checkpoint and event endpoint within 300 years of the present in the curated
 *  data: the timeline's densest stretch, and what `FISHEYE_GAIN` is tuned against. */
const REALISTIC_MODERN_DENSITY_YEARS = [
  0, 2, 2.13, 3, 4, 5, 7, 10, 11, 15, 18, 21, 22, 30, 31, 34, 35, 36, 37, 38, 39, 40, 42, 45, 48, 50, 52, 54, 55, 56,
  60, 64, 65, 67, 68, 69, 72, 77, 78, 79.33, 80, 81, 85.33, 91, 92, 95, 96, 97, 101, 105, 106.14, 107, 108.12, 108.5,
  109, 110, 110.43, 112, 116, 122, 137, 142, 146, 166, 167, 185, 195, 210, 225, 237, 238, 265,
] as const

/** Bisects `centreU` so the point under the pointer lands on base-space `targetS`. */
function centreUForFocus(base: TimeScale, trackWidthPx: number, markers: readonly number[], targetS: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    const scale = fisheyeScale(base, { centreU: mid, strength: 1 }, trackWidthPx, markers)
    if (base.toUnit(scale.fromUnit(mid)) < targetS) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function displayedWidthPx(scale: FisheyeScale, base: TimeScale, startS: number, endS: number, trackWidthPx: number): number {
  const toDisplayed = (s: number): number => scale.toUnit(base.fromUnit(s))
  return (toDisplayed(endS) - toDisplayed(startS)) * trackWidthPx
}

/** The lens's fixed extra-mass budget `B = gain · halfWidth`, independent of focus and markers. */
function extraMassBudget(strength: number, trackWidthPx: number): number {
  return FISHEYE_GAIN * strength * (FISHEYE_HALF_WIDTH_PX / trackWidthPx)
}

const IDENTITY_SCALE: TimeScale = { kind: 'linear', domain: [0, 1], toUnit: (t) => t, fromUnit: (u) => u }

function expectStrictlyIncreasing(f: (s: number) => number, from: number, to: number, samples = 300): void {
  let previous = f(from)
  for (let i = 1; i <= samples; i++) {
    const u = f(from + ((to - from) * i) / samples)
    expect(u).toBeGreaterThan(previous)
    previous = u
  }
}

describe('fisheyeScale', () => {
  it('returns the base mapping exactly at strength 0 or zero track width', () => {
    const base = createSymlogScale(FULL_DOMAIN)
    const markers = KPG_TRIO.map((t) => base.toUnit(t))
    for (const scale of [
      fisheyeScale(base, { centreU: 0.5, strength: 0 }, TRACK_WIDTH_PX, markers),
      fisheyeScale(base, { centreU: 0.5, strength: 1 }, 0),
    ]) {
      for (const t of [0, 1e6, KPG_DARKNESS, EARTH_FORMATION]) expect(scale.toUnit(t)).toBe(base.toUnit(t))
      expect(scale.fromUnit(0.3)).toBe(base.fromUnit(0.3))
      expect(scale.magnificationAt(1e6)).toBe(1)
    }
  })

  it.each([0, 0.02, 0.5, 1])('is strictly increasing with fixed endpoints for a lens at %s', (centreU) => {
    const scale = fisheyeScale(IDENTITY_SCALE, { centreU, strength: 1 }, TRACK_WIDTH_PX)
    expectStrictlyIncreasing(scale.toUnit, 0, 1)
    expect(scale.toUnit(0)).toBeCloseTo(0, 9)
    expect(scale.toUnit(1)).toBeCloseTo(1, 9)
  })

  it.each([
    ['symlog', createSymlogScale],
    ['linear', createLinearScale],
  ] as const)('round-trips fromUnit(toUnit(t)) on a %s base', (_name, make) => {
    const scale = fisheyeScale(make(FULL_DOMAIN), { centreU: 0.3, strength: 0.8 }, TRACK_WIDTH_PX)
    for (const t of [0, 1, 1e3, 1e6, 1e8, 1e9, EARTH_FORMATION]) {
      expect(Math.abs(scale.fromUnit(scale.toUnit(t)) - t)).toBeLessThanOrEqual(Math.max(1e-6, EARTH_FORMATION * 1e-9))
    }
  })

  it.each([
    ['no markers', []],
    ['a sub-pixel marker gap', [0.5, 0.5 + 1e-6, 0.5 + 3e-6]],
  ])('keeps the lens focus under the pointer with %s', (_label, markers) => {
    for (const centreU of [0.02, 0.5, 0.500001, 0.98]) {
      const scale = fisheyeScale(IDENTITY_SCALE, { centreU, strength: 1 }, TRACK_WIDTH_PX, markers)
      expect(scale.toUnit(scale.fromUnit(centreU))).toBeCloseTo(centreU, 9)
    }
  })

  it('magnifies at the focus, compresses uniformly outside, and conserves total mass', () => {
    const scale = fisheyeScale(IDENTITY_SCALE, { centreU: 0.5, strength: 1 }, TRACK_WIDTH_PX)
    expect(scale.magnificationAt(scale.fromUnit(0.5))).toBeGreaterThan(3)
    const outside = [0, 0.05, 0.95, 1].map((s) => scale.magnificationAt(s))
    for (const mag of outside) {
      expect(mag).toBeLessThan(1)
      expect(mag).toBeCloseTo(outside[0]!, 9)
    }
    let integral = 0
    for (let i = 0; i < 2000; i++) integral += scale.magnificationAt((i + 0.5) / 2000) / 2000
    expect(integral).toBeCloseTo(1, 3)
  })

  it('leaves points outside the lens in place when the lens moves', () => {
    const before = fisheyeScale(IDENTITY_SCALE, { centreU: 0.4, strength: 1 }, TRACK_WIDTH_PX)
    const after = fisheyeScale(IDENTITY_SCALE, { centreU: 0.6, strength: 1 }, TRACK_WIDTH_PX)
    for (const s of [0.05, 0.95]) expect(after.toUnit(s)).toBeCloseTo(before.toUnit(s), 9)
  })
})

describe('moveFisheyeLens', () => {
  it('reappears under the pointer once faded, without touching strength', () => {
    expect(moveFisheyeLens(RESTING_FISHEYE, null, 0.7, TRACK_WIDTH_PX).lens).toEqual({
      centreU: 0.7,
      strength: RESTING_FISHEYE.lens.strength,
    })
    expect(moveFisheyeLens({ lens: { centreU: 0.2, strength: 0.002 } }, null, 0.8, TRACK_WIDTH_PX).lens.centreU).toBe(0.8)
  })

  it('moves a still-visible lens continuously on re-entry, as if the pointer had been at its centre', () => {
    const visible: FisheyeMotion = { lens: { centreU: 0.2, strength: 1 } }
    const next = moveFisheyeLens(visible, null, 0.8, TRACK_WIDTH_PX)
    expect(next.lens.centreU).not.toBe(0.8)
    expect(Math.abs(0.8 - next.lens.centreU) * TRACK_WIDTH_PX).toBeLessThanOrEqual(FISHEYE_COUPLING_RADIUS_PX + 1e-6)
    expect(next.lens.centreU).toBe(moveFisheyeLens(visible, 0.2, 0.8, TRACK_WIDTH_PX).lens.centreU)
  })

  it('never moves for a stationary pointer', () => {
    let motion: FisheyeMotion = { lens: { centreU: 0.5, strength: 1 } }
    for (let i = 0; i < 50; i++) motion = moveFisheyeLens(motion, 0.5, 0.5, TRACK_WIDTH_PX)
    expect(motion.lens.centreU).toBe(0.5)
  })

  it('couples loosely near the centre and 1:1 at the coupling radius', () => {
    const start: FisheyeMotion = { lens: { centreU: 0.5, strength: 1 } }
    const stepU = 4 / TRACK_WIDTH_PX
    const nearPx = (moveFisheyeLens(start, 0.5, 0.5 + stepU, TRACK_WIDTH_PX).lens.centreU - 0.5) * TRACK_WIDTH_PX
    const radiusU = 0.5 + FISHEYE_COUPLING_RADIUS_PX / TRACK_WIDTH_PX
    const farPx = (moveFisheyeLens(start, radiusU, radiusU + stepU, TRACK_WIDTH_PX).lens.centreU - 0.5) * TRACK_WIDTH_PX
    expect(nearPx).toBeGreaterThan(0)
    expect(nearPx).toBeLessThan(farPx)
    expect(farPx).toBeCloseTo(4, 6)
  })

  it('is independent of how a sweep is split into calls', () => {
    const start: FisheyeMotion = { lens: { centreU: 0.1, strength: 1 } }
    const oneCall = moveFisheyeLens(start, 0.1, 0.9, TRACK_WIDTH_PX)
    let many = start
    for (let i = 1; i <= 400; i++) many = moveFisheyeLens(many, 0.1 + (0.8 * (i - 1)) / 400, 0.1 + (0.8 * i) / 400, TRACK_WIDTH_PX)
    expect(many.lens.centreU).toBeCloseTo(oneCall.lens.centreU, 3)
  })

  it('moves the time under the pointer monotonically and boundedly per pixel', () => {
    let motion: FisheyeMotion = { lens: { centreU: 0.1, strength: 1 } }
    let pointerU = 0.1
    let previous = fisheyeScale(IDENTITY_SCALE, motion.lens, TRACK_WIDTH_PX).fromUnit(pointerU)
    for (let i = 0; i < 800; i++) {
      const next = pointerU + 1 / TRACK_WIDTH_PX
      motion = moveFisheyeLens(motion, pointerU, next, TRACK_WIDTH_PX)
      pointerU = next
      const t = fisheyeScale(IDENTITY_SCALE, motion.lens, TRACK_WIDTH_PX).fromUnit(pointerU)
      expect(t).toBeGreaterThan(previous)
      expect((t - previous) * TRACK_WIDTH_PX).toBeLessThan(6)
      previous = t
    }
  })
})

describe('stepFisheyeStrength / isFisheyeSettled', () => {
  it('fades in and out without moving the centre, reaching exactly 0', () => {
    const fadingIn = stepFisheyeStrength(RESTING_FISHEYE, true, 0.016)
    expect(fadingIn.lens.centreU).toBe(RESTING_FISHEYE.lens.centreU)
    expect(fadingIn.lens.strength).toBeGreaterThan(0)
    expect(fadingIn.lens.strength).toBeLessThan(1)

    let motion: FisheyeMotion = { lens: { centreU: 0.7, strength: 1 } }
    for (let i = 0; i < 200 && motion.lens.strength > 0; i++) motion = stepFisheyeStrength(motion, false, 0.016)
    expect(motion.lens).toEqual({ centreU: 0.7, strength: 0 })
  })

  it('jumps straight to the target with an infinite step', () => {
    expect(stepFisheyeStrength(RESTING_FISHEYE, true, Infinity).lens.strength).toBe(1)
    expect(stepFisheyeStrength({ lens: { centreU: 0.7, strength: 1 } }, false, Infinity).lens.strength).toBe(0)
  })

  it('is settled only at the target strength for the pointer state', () => {
    expect(isFisheyeSettled(RESTING_FISHEYE, false)).toBe(true)
    expect(isFisheyeSettled(RESTING_FISHEYE, true)).toBe(false)
    expect(isFisheyeSettled({ lens: { centreU: 0.5, strength: 1 } }, true)).toBe(true)
    expect(isFisheyeSettled({ lens: { centreU: 0.5, strength: 0.5 } }, true)).toBe(false)
  })
})

describe('density-adaptive gap insertion', () => {
  const base = createSymlogScale(FULL_DOMAIN)
  const kpgS = [...KPG_TRIO].map((t) => base.toUnit(t)).sort((a, b) => a - b)

  it('reduces to the plain bump with no, one, or only far-away markers', () => {
    const lens = { centreU: 0.95, strength: 1 }
    const plain = fisheyeScale(base, lens, TRACK_WIDTH_PX)
    for (const markers of [[], [base.toUnit(1e6)], [base.toUnit(4.5e9), base.toUnit(4.5e9 - 1e-6)]]) {
      const scale = fisheyeScale(base, lens, TRACK_WIDTH_PX, markers)
      for (const t of [0, 1e3, 1e6, 1e9, 4.5e9, EARTH_FORMATION]) expect(scale.toUnit(t)).toBeCloseTo(plain.toUnit(t), 9)
    }
  })

  describe('the K-Pg trio', () => {
    const centreU = centreUForFocus(base, TRACK_WIDTH_PX, kpgS, (kpgS[0]! + kpgS[2]!) / 2)

    it.each([0, 1])('opens pair %i to MIN_MARKER_SEPARATION_PX when centred on it', (i) => {
      const [start, end] = [kpgS[i]!, kpgS[i + 1]!]
      const c = centreUForFocus(base, TRACK_WIDTH_PX, kpgS, (start + end) / 2)
      const scale = fisheyeScale(base, { centreU: c, strength: 1 }, TRACK_WIDTH_PX, kpgS)
      expect(displayedWidthPx(scale, base, start, end, TRACK_WIDTH_PX)).toBeGreaterThanOrEqual(MIN_MARKER_SEPARATION_PX * 0.9)
      const mag = scale.magnificationAt(KPG_ARRIVAL)
      if (i === 0) {
        expect(Number.isFinite(mag)).toBe(true)
        expect(mag).toBeGreaterThan(1000)
      }
    })

    it('round-trips each time to within a minute and stays strictly increasing through the gap', () => {
      const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, kpgS)
      for (const t of KPG_TRIO) expect(Math.abs(scale.fromUnit(scale.toUnit(t)) - t)).toBeLessThan(MINUTE_YEARS)
      const markers = [0.5, 0.5 + 1e-6, 0.5 + 3e-6]
      const c = centreUForFocus(IDENTITY_SCALE, TRACK_WIDTH_PX, markers, 0.5 + 1.5e-6)
      const id = fisheyeScale(IDENTITY_SCALE, { centreU: c, strength: 1 }, TRACK_WIDTH_PX, markers)
      expectStrictlyIncreasing(id.toUnit, 0, 1)
      expectStrictlyIncreasing(id.toUnit, 0.4999, 0.5001)
    })

    it('reports a finer years-per-pixel inside the resolved gap than the base scale', () => {
      const lensed = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, kpgS)
      const lensedYears = yearsPerDisplayedPixelAt(lensed, centreU, TRACK_WIDTH_PX)
      expect(lensedYears).toBeGreaterThan(0)
      expect(lensedYears).toBeLessThan(yearsPerDisplayedPixelAt(base, base.toUnit(KPG_DARKNESS), TRACK_WIDTH_PX))
    })

    it('reaches each scene under a monotonic 1px pointer sweep', () => {
      const START_U = Math.max(0, centreU - 0.05)
      const END_U = Math.min(1, centreU + 0.05)
      let motion: FisheyeMotion = { lens: { centreU: START_U, strength: 1 } }
      let pointerU = START_U
      const nearest = new Set<number>()
      let previous = Infinity
      while (pointerU < END_U) {
        const scale = fisheyeScale(base, motion.lens, TRACK_WIDTH_PX, kpgS)
        const t = scale.fromUnit(pointerU)
        expect(t).toBeLessThan(previous)
        previous = t
        const d = KPG_TRIO.map((tt) => Math.abs(scale.toUnit(tt) - pointerU))
        nearest.add(d.indexOf(Math.min(...d)))
        const next = pointerU + 1 / TRACK_WIDTH_PX
        motion = moveFisheyeLens(motion, pointerU, next, TRACK_WIDTH_PX)
        pointerU = next
      }
      expect(nearest).toEqual(new Set([0, 1, 2]))
    })

    it('moves a fixed point smoothly as the focus sweeps across the trio', () => {
      const lo = Math.max(0, centreU - 0.1)
      const hi = Math.min(1, centreU + 0.1)
      const us = Array.from({ length: 2001 }, (_, i) =>
        fisheyeScale(base, { centreU: lo + ((hi - lo) * i) / 2000, strength: 1 }, TRACK_WIDTH_PX, kpgS).toUnit(KPG_DARKNESS),
      )
      const average = (Math.max(...us) - Math.min(...us)) / 2000
      for (let i = 1; i < us.length; i++) {
        expect(Math.abs(us[i]! - us[i - 1]!)).toBeLessThan(50 * Math.max(average, Number.EPSILON))
      }
    })
  })

  it('resolves every gap of a 20-event modern cluster to MIN_MARKER_SEPARATION_PX', () => {
    const markerS = Array.from({ length: 20 }, (_, i) => base.toUnit((150 * i) / 19)).sort((a, b) => a - b)
    const mid = 10
    const centreU = centreUForFocus(base, TRACK_WIDTH_PX, markerS, (markerS[mid - 1]! + markerS[mid]!) / 2)
    const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, markerS)
    for (let i = 0; i < markerS.length - 1; i++) {
      expect(displayedWidthPx(scale, base, markerS[i]!, markerS[i + 1]!, TRACK_WIDTH_PX)).toBeGreaterThanOrEqual(
        MIN_MARKER_SEPARATION_PX * 0.9,
      )
    }
  })

  it('keeps the real modern density monotonic with every gap above a 4.5px floor', () => {
    const markerS = [...new Set(REALISTIC_MODERN_DENSITY_YEARS.map((t) => base.toUnit(t)))].sort((a, b) => a - b)
    expect(markerS.length).toBeGreaterThanOrEqual(70)
    expect((markerS[markerS.length - 1]! - markerS[0]!) * TRACK_WIDTH_PX).toBeLessThan(GAP_TAPER_HALF_WIDTH_PX)
    const centreU = centreUForFocus(base, TRACK_WIDTH_PX, markerS, (markerS[0]! + markerS[markerS.length - 1]!) / 2)
    const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, markerS)
    expectStrictlyIncreasing((i) => scale.toUnit(EARTH_FORMATION * (1 - i)), 0, 1, 2000)
    let min = Infinity
    for (let i = 0; i < markerS.length - 1; i++) {
      min = Math.min(min, displayedWidthPx(scale, base, markerS[i]!, markerS[i + 1]!, TRACK_WIDTH_PX))
    }
    expect(min).toBeGreaterThan(4.5)
  })

  it("caps a saturated cluster's insertion at the lens's extra-mass budget", () => {
    const markerS = Array.from({ length: 300 }, (_, i) => base.toUnit(i / 299)).sort((a, b) => a - b)
    const centreU = centreUForFocus(base, TRACK_WIDTH_PX, markerS, (markerS[0]! + markerS[299]!) / 2)
    const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, markerS)
    const budget = extraMassBudget(1, TRACK_WIDTH_PX)
    const budgetPx = (budget / (1 + budget)) * TRACK_WIDTH_PX
    expect(300 * MIN_MARKER_SEPARATION_PX).toBeGreaterThan(budgetPx * 2)
    expect(displayedWidthPx(scale, base, markerS[0]!, markerS[299]!, TRACK_WIDTH_PX)).toBeLessThanOrEqual(budgetPx + 2)
  })

  describe('mass conservation: a point outside every support never moves', () => {
    const farT = 4.5e9
    const expectedFar = (trackWidthPx: number): number => base.toUnit(farT) / (1 + extraMassBudget(1, trackWidthPx))
    const cluster = (n: number) => Array.from({ length: n }, (_, i) => base.toUnit(1e8 + i / Math.max(1, n - 1))).sort((a, b) => a - b)

    it.each([2, 300, 2000])('is identical with %i markers competing near the focus', (n) => {
      const markerS = cluster(n)
      const centreU = centreUForFocus(base, TRACK_WIDTH_PX, markerS, (markerS[0]! + markerS[n - 1]!) / 2)
      for (const m of [undefined, markerS]) {
        const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, m)
        expect(Math.abs(scale.toUnit(farT) - expectedFar(TRACK_WIDTH_PX))).toBeLessThanOrEqual(1e-12)
      }
    })

    it('is identical across focus positions, including domain-edge clipping', () => {
      const markerS = cluster(300)
      const nearEdge = Array.from({ length: 30 }, (_, i) => base.toUnit(20 + i))
      const mag = 1 / (1 + extraMassBudget(1, TRACK_WIDTH_PX))
      for (const centreU of [0.3, 0.5, 0.7, 0.98, 0.999, 1]) {
        for (const m of [undefined, markerS, nearEdge]) {
          const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, m)
          expect(Math.abs(scale.toUnit(farT) - expectedFar(TRACK_WIDTH_PX))).toBeLessThanOrEqual(1e-12)
          expect(scale.magnificationAt(farT)).toBeCloseTo(mag, 12)
        }
      }
    })

    it('is identical across track widths for a fixed strength', () => {
      const markerS = cluster(20)
      for (const w of [720, 2880]) {
        const centreU = centreUForFocus(base, w, markerS, (markerS[0]! + markerS[19]!) / 2)
        const scale = fisheyeScale(base, { centreU, strength: 1 }, w, markerS)
        expect(Math.abs(scale.toUnit(farT) - expectedFar(w))).toBeLessThanOrEqual(1e-12)
      }
    })
  })
})

describe('yearsPerDisplayedPixelAt', () => {
  it('is finer near the present than deep in the past, and NaN on a zero-width track', () => {
    const scale = createSymlogScale(FULL_DOMAIN)
    const nearPresent = yearsPerDisplayedPixelAt(scale, 0.999, TRACK_WIDTH_PX)
    expect(nearPresent).toBeGreaterThan(0)
    expect(yearsPerDisplayedPixelAt(scale, 0.1, TRACK_WIDTH_PX)).toBeGreaterThan(nearPresent)
    expect(yearsPerDisplayedPixelAt(scale, 0.5, 0)).toBeNaN()
  })
})
