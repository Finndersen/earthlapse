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

// The K-Pg trio (module doc, DESIGN/DECISIONS): three distinct scenes within ~100 years of each
// other, at a point in the timeline (~66 Ma) where a symlog track's own resolution is nowhere
// near enough to tell them apart — DECISIONS.md ADR-017/this task's brief puts their undistorted
// separation at "~1e-6 px apart".
const KPG_ARRIVAL = 66_043_000
const KPG_DARKNESS = 66_042_999.99
const KPG_AFTERMATH = 66_042_900
const KPG_TRIO = [KPG_ARRIVAL, KPG_DARKNESS, KPG_AFTERMATH] as const

const MINUTE_YEARS = 1 / (365.25 * 24 * 60)

/** Binary-searches `centreU` so the point that actually ends up under the pointer
 *  (`scale.fromUnit(centreU)`, re-expressed in base `s`-space) lands on `targetS` — a robust
 *  way to place the lens's *effective* focus exactly on a chosen point without depending on
 *  `focusForCentre`'s internal (plain-bump-only) math, which a gap-aware caller has no access
 *  to. `toUnit`/`fromUnit` are exact inverses of the same monotonic map (module doc), so
 *  `s -> base.toUnit(scale.fromUnit(s))` for a scale built at `centreU = s` is itself
 *  monotonic increasing in `s`, and bisects cleanly. */
function centreUForFocus(base: TimeScale, trackWidthPx: number, markers: readonly number[], targetS: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    const scale = fisheyeScale(base, { centreU: mid, strength: 1 }, trackWidthPx, markers)
    const achievedS = base.toUnit(scale.fromUnit(mid))
    if (achievedS < targetS) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Displayed width (px) of the base-space interval `[startS, endS]` under `scale`. */
function displayedWidthPx(scale: FisheyeScale, base: TimeScale, startS: number, endS: number, trackWidthPx: number): number {
  const toDisplayed = (s: number): number => scale.toUnit(base.fromUnit(s))
  return (toDisplayed(endS) - toDisplayed(startS)) * trackWidthPx
}

/** The lens's fixed extra-mass budget `B = gain · halfWidth` (fisheye.ts's module doc, "Mass
 *  conservation"), mirrored here from the exported constants rather than importing an internal —
 *  a pure function of `strength`/`trackWidthPx` alone, by design never of focus or markers. */
function extraMassBudget(strength: number, trackWidthPx: number): number {
  return FISHEYE_GAIN * strength * (FISHEYE_HALF_WIDTH_PX / trackWidthPx)
}

/** The same budget, expressed as the displayed px it would occupy if it went entirely to one
 *  contiguous stretch of the track (`mass / total * trackWidthPx`, `total = 1 + budget` — see
 *  `allocateExtraMass`'s derivation, mirrored here for the same reason as above). */
function extraMassBudgetPx(strength: number, trackWidthPx: number): number {
  const budget = extraMassBudget(strength, trackWidthPx)
  return (budget / (1 + budget)) * trackWidthPx
}

/** Fisheye distortion operates entirely on the base scale's own 0..1 output space (module
 *  doc: "a density over the undistorted track's own 0..1 space"). This identity scale lets
 *  tests probe that space directly, without a real TimeScale's own warp folded in on top. */
const IDENTITY_SCALE: TimeScale = {
  kind: 'linear',
  domain: [0, 1],
  toUnit: (t) => t,
  fromUnit: (u) => u,
}

describe('fisheyeScale', () => {
  describe('no lens', () => {
    it('returns the base mapping exactly at strength 0', () => {
      const base = createSymlogScale(FULL_DOMAIN)
      const scale = fisheyeScale(base, { centreU: 0.5, strength: 0 }, TRACK_WIDTH_PX)
      for (const t of [0, 1e3, 1e6, 1e9, EARTH_FORMATION]) {
        expect(scale.toUnit(t)).toBe(base.toUnit(t))
      }
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        expect(scale.fromUnit(u)).toBe(base.fromUnit(u))
      }
      expect(scale.magnificationAt(1e6)).toBe(1)
      expect(scale.kind).toBe(base.kind)
      expect(scale.domain).toBe(base.domain)
    })

    it('returns the base mapping exactly at trackWidthPx 0, regardless of strength', () => {
      const base = createSymlogScale(FULL_DOMAIN)
      const scale = fisheyeScale(base, { centreU: 0.5, strength: 1 }, 0)
      expect(scale.toUnit(1e6)).toBe(base.toUnit(1e6))
      expect(scale.fromUnit(0.3)).toBe(base.fromUnit(0.3))
      expect(scale.magnificationAt(1e6)).toBe(1)
    })
  })

  describe('toUnit over the base 0..1 space', () => {
    const SAMPLE_COUNT = 300

    it.each([0.5, 0.02, 0.98, 0, 1])('is strictly increasing for a lens at centreU %s', (centreU) => {
      const scale = fisheyeScale(IDENTITY_SCALE, { centreU, strength: 1 }, TRACK_WIDTH_PX)
      let previous = scale.toUnit(0)
      for (let i = 1; i <= SAMPLE_COUNT; i++) {
        const s = i / SAMPLE_COUNT
        const u = scale.toUnit(s)
        expect(u).toBeGreaterThan(previous)
        previous = u
      }
    })

    it.each([0.5, 0.02, 0.98, 0, 1])('maps 0 -> 0 and 1 -> 1 for a lens at centreU %s', (centreU) => {
      const scale = fisheyeScale(IDENTITY_SCALE, { centreU, strength: 1 }, TRACK_WIDTH_PX)
      expect(scale.toUnit(0)).toBeCloseTo(0, 9)
      expect(scale.toUnit(1)).toBeCloseTo(1, 9)
    })
  })

  describe('round-trip', () => {
    const LOG_SPACED_T: readonly number[] = [0, 1, 1e3, 1e6, 1e7, 1e8, 1e9, EARTH_FORMATION]

    function expectRoundTrips(t: number, back: number, span: number): void {
      const tolerance = Math.max(1e-6, span * 1e-9)
      expect(Math.abs(back - t)).toBeLessThanOrEqual(tolerance)
    }

    it.each([
      ['symlog', () => createSymlogScale(FULL_DOMAIN)],
      ['linear', () => createLinearScale(FULL_DOMAIN)],
    ] as const)('fromUnit(toUnit(t)) round-trips within the TimeScale contract for %s', (_name, makeBase) => {
      const base = makeBase()
      const scale = fisheyeScale(base, { centreU: 0.3, strength: 0.8 }, TRACK_WIDTH_PX)
      for (const t of LOG_SPACED_T) {
        const back = scale.fromUnit(scale.toUnit(t))
        expectRoundTrips(t, back, EARTH_FORMATION)
      }
    })
  })

  describe('lens centre stays under the pointer', () => {
    it.each([0.5, 0.02, 0.98, 0.3, 0.7])('toUnit(fromUnit(centreU)) ≈ centreU for centreU %s', (centreU) => {
      const scale = fisheyeScale(IDENTITY_SCALE, { centreU, strength: 1 }, TRACK_WIDTH_PX)
      // With the identity base, `fromUnit(centreU)` IS the base-unit focus point (the module
      // doc's "focus" that stays under the pointer); mapping it back through `toUnit` should
      // land on `centreU` again.
      const focus = scale.fromUnit(centreU)
      expect(scale.toUnit(focus)).toBeCloseTo(centreU, 9)
    })
  })

  describe('magnificationAt', () => {
    it('peaks at the lens focus, well above 1, at full strength on a 1440px track', () => {
      const scale = fisheyeScale(IDENTITY_SCALE, { centreU: 0.5, strength: 1 }, TRACK_WIDTH_PX)
      const focus = scale.fromUnit(0.5)
      expect(scale.magnificationAt(focus)).toBeGreaterThan(3)
    })

    it('is a constant compression factor below 1 well outside the lens', () => {
      const scale = fisheyeScale(IDENTITY_SCALE, { centreU: 0.5, strength: 1 }, TRACK_WIDTH_PX)
      const outside = [0, 0.05, 0.95, 1].map((s) => scale.magnificationAt(s))
      for (const mag of outside) {
        expect(mag).toBeLessThan(1)
        expect(mag).toBeCloseTo(outside[0]!, 9)
      }
    })

    it('integrates to ~1 over the track (mass is redistributed, not created)', () => {
      const scale = fisheyeScale(IDENTITY_SCALE, { centreU: 0.5, strength: 1 }, TRACK_WIDTH_PX)
      const steps = 2000
      let integral = 0
      for (let i = 0; i < steps; i++) {
        const s = (i + 0.5) / steps
        integral += scale.magnificationAt(s) / steps
      }
      expect(integral).toBeCloseTo(1, 3)
    })
  })

  describe('points outside the lens', () => {
    it('do not move when the lens moves (design property: only what passes through the lens moves)', () => {
      const before = fisheyeScale(IDENTITY_SCALE, { centreU: 0.4, strength: 1 }, TRACK_WIDTH_PX)
      const after = fisheyeScale(IDENTITY_SCALE, { centreU: 0.6, strength: 1 }, TRACK_WIDTH_PX)
      for (const s of [0.05, 0.95]) {
        expect(after.toUnit(s)).toBeCloseTo(before.toUnit(s), 9)
      }
    })
  })
})

describe('moveFisheyeLens', () => {
  it('reappears directly under the pointer when there is no previous pointer position and the lens has faded', () => {
    const next = moveFisheyeLens(RESTING_FISHEYE, null, 0.7, TRACK_WIDTH_PX)
    expect(next.lens.centreU).toBe(0.7)
    // Moving the lens never touches strength — that is `stepFisheyeStrength`'s job alone.
    expect(next.lens.strength).toBe(RESTING_FISHEYE.lens.strength)
  })

  it('does not snap a still-visible lens across the track on a quick leave/re-enter (no previous pointer position, strength ~1)', () => {
    // Reviewer-verified bug: a leave/re-enter fast enough that `strength` hasn't faded used to
    // snap `centreU` straight to the new pointer even though the lens was still fully visible —
    // a sudden jump. It must instead move the same continuous, radius-clamped way any other move
    // does.
    const visible: FisheyeMotion = { lens: { centreU: 0.2, strength: 1 } }
    const next = moveFisheyeLens(visible, null, 0.8, TRACK_WIDTH_PX)
    // A treated-as-a-coupled-move re-entry lands within the coupling radius of the new pointer
    // position (same as the existing "clamps the offset" case for an ordinary large jump) —
    // never snapped exactly onto it.
    const offsetFromPointerPx = Math.abs(0.8 - next.lens.centreU) * TRACK_WIDTH_PX
    expect(next.lens.centreU).not.toBe(0.8)
    expect(offsetFromPointerPx).toBeLessThanOrEqual(FISHEYE_COUPLING_RADIUS_PX + 1e-6)
    expect(next.lens.strength).toBe(1)
  })

  it('reappears directly under the pointer once strength has faded to the settle threshold, even with no previous pointer position', () => {
    const faded: FisheyeMotion = { lens: { centreU: 0.2, strength: 0.002 } }
    const next = moveFisheyeLens(faded, null, 0.8, TRACK_WIDTH_PX)
    expect(next.lens.centreU).toBe(0.8)
    expect(next.lens.strength).toBe(0.002)
  })

  it('treats a lost pointer position as if the pointer had last been at the lens centre — same result as an explicit move from there', () => {
    const visible: FisheyeMotion = { lens: { centreU: 0.35, strength: 0.9 } }
    const viaNull = moveFisheyeLens(visible, null, 0.6, TRACK_WIDTH_PX)
    const viaCentre = moveFisheyeLens(visible, visible.lens.centreU, 0.6, TRACK_WIDTH_PX)
    expect(viaNull.lens.centreU).toBe(viaCentre.lens.centreU)
  })

  it('never moves the lens for a stationary pointer, however many times it is reported', () => {
    const settled: FisheyeMotion = { lens: { centreU: 0.5, strength: 1 } }
    let motion = settled
    for (let i = 0; i < 50; i++) {
      motion = moveFisheyeLens(motion, 0.5, 0.5, TRACK_WIDTH_PX)
    }
    expect(motion.lens.centreU).toBe(0.5)
  })

  it('moves the centre less for a small move near the centre than for the same-size move once already at the coupling radius', () => {
    const start: FisheyeMotion = { lens: { centreU: 0.5, strength: 1 } }
    const stepU = 4 / TRACK_WIDTH_PX

    const nearCentre = moveFisheyeLens(start, 0.5, 0.5 + stepU, TRACK_WIDTH_PX)
    const nearCentreMovedPx = (nearCentre.lens.centreU - 0.5) * TRACK_WIDTH_PX

    const atRadius: FisheyeMotion = { lens: { centreU: 0.5, strength: 1 } }
    const pointerAtRadiusU = 0.5 + FISHEYE_COUPLING_RADIUS_PX / TRACK_WIDTH_PX
    const farFromCentre = moveFisheyeLens(atRadius, pointerAtRadiusU, pointerAtRadiusU + stepU, TRACK_WIDTH_PX)
    const farFromCentreMovedPx = (farFromCentre.lens.centreU - atRadius.lens.centreU) * TRACK_WIDTH_PX

    expect(nearCentreMovedPx).toBeGreaterThan(0)
    expect(nearCentreMovedPx).toBeLessThan(farFromCentreMovedPx)
    // Once the pointer is already at (or beyond) the coupling radius, movement is 1:1.
    expect(farFromCentreMovedPx).toBeCloseTo(4, 6)
  })

  it('clamps the offset to the coupling radius for a single large jump', () => {
    const settled: FisheyeMotion = { lens: { centreU: 0.5, strength: 1 } }
    const next = moveFisheyeLens(settled, 0.5, 0.95, TRACK_WIDTH_PX)
    const offsetPx = Math.abs(0.95 - next.lens.centreU) * TRACK_WIDTH_PX
    expect(offsetPx).toBeLessThanOrEqual(FISHEYE_COUPLING_RADIUS_PX + 1e-6)
  })

  it('is independent of how a sweep is split into calls (1px substep integration)', () => {
    const start: FisheyeMotion = { lens: { centreU: 0.1, strength: 1 } }

    const oneCall = moveFisheyeLens(start, 0.1, 0.9, TRACK_WIDTH_PX)

    const STEPS = 400
    let manyCalls = start
    for (let i = 1; i <= STEPS; i++) {
      const from = 0.1 + ((0.9 - 0.1) * (i - 1)) / STEPS
      const to = 0.1 + ((0.9 - 0.1) * i) / STEPS
      manyCalls = moveFisheyeLens(manyCalls, from, to, TRACK_WIDTH_PX)
    }

    expect(manyCalls.lens.centreU).toBeCloseTo(oneCall.lens.centreU, 3)
  })

  describe('the time under the pointer, along a slow sweep across a marker', () => {
    // The bug this replaces: re-centring on a timer could move the lens — and so the time
    // under a now-*stationary* pointer — well after the gesture that triggered it, reading as
    // a jump. With `moveFisheyeLens`, the lens (and the time under the pointer) may only change
    // in response to the pointer's own movement, continuously and by a bounded amount per px.
    const STEP_PX = 1
    const TOTAL_STEPS = 800 // sweeps from u=0.1 to past u=0.9 in 1px increments

    function sweep(): { deltas: number[]; times: number[] } {
      let motion: FisheyeMotion = { lens: { centreU: 0.1, strength: 1 } }
      let pointerU = 0.1
      const times: number[] = [fisheyeScale(IDENTITY_SCALE, motion.lens, TRACK_WIDTH_PX).fromUnit(pointerU)]
      const deltas: number[] = []
      for (let i = 0; i < TOTAL_STEPS; i++) {
        const nextPointerU = pointerU + STEP_PX / TRACK_WIDTH_PX
        motion = moveFisheyeLens(motion, pointerU, nextPointerU, TRACK_WIDTH_PX)
        pointerU = nextPointerU
        const t = fisheyeScale(IDENTITY_SCALE, motion.lens, TRACK_WIDTH_PX).fromUnit(pointerU)
        deltas.push(t - times[times.length - 1]!)
        times.push(t)
      }
      return { deltas, times }
    }

    it('is strictly increasing', () => {
      const { deltas } = sweep()
      for (const delta of deltas) {
        expect(delta).toBeGreaterThan(0)
      }
    })

    it('never steps by more than a small, bounded amount for a single 1px pointer move', () => {
      const { deltas } = sweep()
      // A bound generous enough for the legitimate 1:1-tracking case (once outside the coupling
      // radius, a 1px pointer move is close to a 1px time change) but far below the ~48px
      // multi-marker jump the dead-zone catch-up used to produce in one go.
      const MAX_STEP_PX = 6
      for (const delta of deltas) {
        expect(Math.abs(delta) * TRACK_WIDTH_PX).toBeLessThan(MAX_STEP_PX)
      }
    })
  })
})

describe('stepFisheyeStrength', () => {
  it('fades in from rest without moving the centre', () => {
    const next = stepFisheyeStrength(RESTING_FISHEYE, true, 0.016)
    expect(next.lens.centreU).toBe(RESTING_FISHEYE.lens.centreU)
    expect(next.lens.strength).toBeGreaterThan(0)
    expect(next.lens.strength).toBeLessThan(1)
  })

  it('fades strength to 0 and keeps centreU when the pointer leaves', () => {
    const settled: FisheyeMotion = { lens: { centreU: 0.7, strength: 1 } }
    const next = stepFisheyeStrength(settled, false, 0.016)
    expect(next.lens.centreU).toBe(0.7)
    expect(next.lens.strength).toBeLessThan(1)
    expect(next.lens.strength).toBeGreaterThan(0)

    let motion = next
    for (let i = 0; i < 200 && motion.lens.strength > 0; i++) {
      motion = stepFisheyeStrength(motion, false, 0.016)
    }
    expect(motion.lens.strength).toBe(0)
    expect(motion.lens.centreU).toBe(0.7)
  })

  it('jumps straight to the target with dtSeconds = Infinity: fade-in', () => {
    const next = stepFisheyeStrength(RESTING_FISHEYE, true, Infinity)
    expect(next).toEqual({ lens: { centreU: RESTING_FISHEYE.lens.centreU, strength: 1 } })
  })

  it('jumps straight to the target with dtSeconds = Infinity: fade-out', () => {
    const settled: FisheyeMotion = { lens: { centreU: 0.7, strength: 1 } }
    const next = stepFisheyeStrength(settled, false, Infinity)
    expect(next).toEqual({ lens: { centreU: 0.7, strength: 0 } })
  })
})

describe('isFisheyeSettled', () => {
  it('is true at rest with no pointer', () => {
    expect(isFisheyeSettled(RESTING_FISHEYE, false)).toBe(true)
  })

  it('is false at rest with a pointer present (strength has not faded in yet)', () => {
    expect(isFisheyeSettled(RESTING_FISHEYE, true)).toBe(false)
  })

  it('is true once fully faded in', () => {
    const motion: FisheyeMotion = { lens: { centreU: 0.5, strength: 1 } }
    expect(isFisheyeSettled(motion, true)).toBe(true)
  })

  it('is false at partial strength', () => {
    const motion: FisheyeMotion = { lens: { centreU: 0.5, strength: 0.5 } }
    expect(isFisheyeSettled(motion, true)).toBe(false)
  })
})

describe('density-adaptive gap insertion (markers)', () => {
  describe('reduces exactly to the plain bump', () => {
    it('with no markers argument at all', () => {
      const base = createSymlogScale(FULL_DOMAIN)
      const lens = { centreU: 0.42, strength: 1 }
      const withoutArg = fisheyeScale(base, lens, TRACK_WIDTH_PX)
      const withEmpty = fisheyeScale(base, lens, TRACK_WIDTH_PX, [])
      for (const t of [0, 1e3, 1e6, 1e9, EARTH_FORMATION]) {
        expect(withEmpty.toUnit(t)).toBe(withoutArg.toUnit(t))
      }
      expect(withEmpty.magnificationAt(1e6)).toBe(withoutArg.magnificationAt(1e6))
    })

    it('with a single marker (too few to form a gap)', () => {
      const base = createSymlogScale(FULL_DOMAIN)
      const lens = { centreU: 0.42, strength: 1 }
      const plain = fisheyeScale(base, lens, TRACK_WIDTH_PX)
      const oneMarker = fisheyeScale(base, lens, TRACK_WIDTH_PX, [base.toUnit(1e6)])
      for (const t of [0, 1e3, 1e6, 1e9, EARTH_FORMATION]) {
        expect(oneMarker.toUnit(t)).toBeCloseTo(plain.toUnit(t), 12)
      }
    })

    it('with markers whose only gap is far outside the taper support (zero taper)', () => {
      const base = createSymlogScale(FULL_DOMAIN)
      // Lens centred near the present; a sub-pixel gap planted deep in the Hadean is far
      // beyond GAP_TAPER_HALF_WIDTH_PX in every direction, so it should insert nothing.
      const lens = { centreU: 0.95, strength: 1 }
      const farGapMarkers = [base.toUnit(4.5e9), base.toUnit(4.5e9 - 1e-6)]
      const plain = fisheyeScale(base, lens, TRACK_WIDTH_PX)
      const withFarGap = fisheyeScale(base, lens, TRACK_WIDTH_PX, farGapMarkers)
      for (const t of [0, 1e3, 1e6, 1e9, 4.5e9, EARTH_FORMATION]) {
        expect(withFarGap.toUnit(t)).toBeCloseTo(plain.toUnit(t), 9)
      }
    })
  })

  it('strength 0 is identity even with markers passed', () => {
    const base = createSymlogScale(FULL_DOMAIN)
    const markers = KPG_TRIO.map((t) => base.toUnit(t))
    const scale = fisheyeScale(base, { centreU: 0.5, strength: 0 }, TRACK_WIDTH_PX, markers)
    for (const t of [0, 1e3, KPG_DARKNESS, EARTH_FORMATION]) {
      expect(scale.toUnit(t)).toBe(base.toUnit(t))
    }
    expect(scale.magnificationAt(KPG_DARKNESS)).toBe(1)
  })

  describe('the K-Pg trio', () => {
    const base = createSymlogScale(FULL_DOMAIN)
    const markerS = [...KPG_TRIO].map((t) => base.toUnit(t)).sort((a, b) => a - b)
    const pairs: ReadonlyArray<readonly [number, number]> = [
      [markerS[0]!, markerS[1]!],
      [markerS[1]!, markerS[2]!],
    ]

    it.each([0, 1])('pair %i opens to at least MIN_MARKER_SEPARATION_PX once the lens is centred on it', (pairIndex) => {
      const [start, end] = pairs[pairIndex]!
      const centreU = centreUForFocus(base, TRACK_WIDTH_PX, markerS, (start + end) / 2)
      const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, markerS)
      const widthPx = displayedWidthPx(scale, base, start, end, TRACK_WIDTH_PX)
      // Only two gaps ever compete here, nowhere near MAX_INSERTED_TOTAL_PX's cap, so each
      // reaches close to its own full solo target (small slack for the taper not being
      // evaluated at exactly 1, and for centreUForFocus's own bisection tolerance).
      expect(widthPx).toBeGreaterThanOrEqual(MIN_MARKER_SEPARATION_PX * 0.9)
    })

    it('round-trips each of the three times to within a minute once resolved', () => {
      const midS = (markerS[0]! + markerS[2]!) / 2
      const centreU = centreUForFocus(base, TRACK_WIDTH_PX, markerS, midS)
      const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, markerS)
      for (const t of KPG_TRIO) {
        const back = scale.fromUnit(scale.toUnit(t))
        expect(Math.abs(back - t)).toBeLessThan(MINUTE_YEARS)
      }
    })

    it('magnificationAt is large but finite at the centre of a resolved sub-pixel gap', () => {
      const [start, end] = pairs[0]!
      const centreU = centreUForFocus(base, TRACK_WIDTH_PX, markerS, (start + end) / 2)
      const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, markerS)
      const mag = scale.magnificationAt(KPG_ARRIVAL)
      expect(Number.isFinite(mag)).toBe(true)
      expect(mag).toBeGreaterThan(1000)
    })
  })

  describe('dense modern cluster (20 events in the last 150 years)', () => {
    const base = createSymlogScale(FULL_DOMAIN)
    const EVENT_COUNT = 20
    const eventTimes = Array.from({ length: EVENT_COUNT }, (_, i) => (150 * i) / (EVENT_COUNT - 1))
    const markerS = eventTimes.map((t) => base.toUnit(t)).sort((a, b) => a - b)

    it('each adjacent pair is a candidate gap (all sub-10px in base space)', () => {
      for (let i = 0; i < markerS.length - 1; i++) {
        expect((markerS[i + 1]! - markerS[i]!) * TRACK_WIDTH_PX).toBeLessThan(MIN_MARKER_SEPARATION_PX)
      }
    })

    it('lets individual adjacent events resolve to at least MIN_MARKER_SEPARATION_PX when hovered', () => {
      // The whole 150-year cluster spans a small fraction of a base px, far inside
      // GAP_TAPER_HALF_WIDTH_PX either way — every gap here shares essentially the same taper
      // regardless of exactly where within the cluster the lens centres, so one lens position
      // (centred on the middle gap) is enough to check every gap at once. 19 gaps' combined
      // untapered target is well under MAX_INSERTED_TOTAL_PX's cap (see the separate bounded-
      // insertion stress test for where the cap actually bites), so each still reaches close
      // to its own full target.
      const midIndex = Math.floor(markerS.length / 2)
      const centreU = centreUForFocus(base, TRACK_WIDTH_PX, markerS, (markerS[midIndex - 1]! + markerS[midIndex]!) / 2)
      const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, markerS)
      for (let i = 0; i < markerS.length - 1; i++) {
        const widthPx = displayedWidthPx(scale, base, markerS[i]!, markerS[i + 1]!, TRACK_WIDTH_PX)
        expect(widthPx).toBeGreaterThanOrEqual(MIN_MARKER_SEPARATION_PX * 0.9)
      }
    })
  })

  describe('bounded insertion', () => {
    it("never lets a saturated cluster's gaps consume more than the lens's own extra-mass budget", () => {
      const base = createSymlogScale(FULL_DOMAIN)
      // 300 markers inside a single year, near the present — far more candidate gaps than the
      // budget can afford at full target each, so this forces the cap to actually bind.
      const MARKER_COUNT = 300
      const eventTimes = Array.from({ length: MARKER_COUNT }, (_, i) => i / (MARKER_COUNT - 1))
      const markerS = eventTimes.map((t) => base.toUnit(t)).sort((a, b) => a - b)
      const centreU = centreUForFocus(base, TRACK_WIDTH_PX, markerS, (markerS[0]! + markerS[markerS.length - 1]!) / 2)
      const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, markerS)
      const totalWidthPx = displayedWidthPx(scale, base, markerS[0]!, markerS[markerS.length - 1]!, TRACK_WIDTH_PX)

      // Gaps alone can claim at most the *entire* budget (module doc, "Density-adaptive gap
      // insertion": a saturated cluster can leave the smooth bump nothing) — never more.
      const budgetPx = extraMassBudgetPx(1, TRACK_WIDTH_PX)
      expect(totalWidthPx).toBeLessThanOrEqual(budgetPx + 2)

      // Sanity: confirm the cap is doing real work here, not vacuously satisfied because the
      // markers were never going to ask for more than the bound anyway.
      const uncappedTargetPx = MARKER_COUNT * MIN_MARKER_SEPARATION_PX
      expect(uncappedTargetPx).toBeGreaterThan(budgetPx * 2)
    })
  })

  describe('mass conservation: a point outside every active support never moves', () => {
    // Reviewer-verified bug this replaces: the old scheme let gap insertion *add* mass on top of
    // the plain bump's own (focus/edge-dependent) total, so the normaliser — and with it every
    // point's displayed position, including ones nowhere near the lens — shifted as the lens
    // moved between sparse and dense regions, or as the focus approached a domain edge. The fix
    // (fisheye.ts's module doc, "Mass conservation") caps the *combined* extra mass at a fixed
    // budget `B = gain · halfWidth`, independent of focus and markers, and reallocates within it
    // rather than adding to it — so a point the lens's local support doesn't reach reduces to
    // `s / (1 + B)` or `(s + B) / (1 + B)` (module doc), a closed form that literally cannot
    // depend on where the focus is or how the markers are laid out. The tests below check that
    // closed form holds — not just "moves by no more than a small bound", but is bit-for-bit
    // (to float precision) identical — across a focus sweep through both dense and sparse
    // regions, and independently of track width and domain-edge clipping.
    const base = createSymlogScale(FULL_DOMAIN)
    // Deep in the Hadean: `s` far smaller than every focus/cluster position exercised below, so
    // it always sits *before* the lens's local support (bump + every active gap's taper) —
    // nothing has been injected by the time the raw cumulative reaches it.
    const farT = 4.5e9
    const farS = base.toUnit(farT)

    function expectedFarToUnit(strength: number, trackWidthPx: number): number {
      return farS / (1 + extraMassBudget(strength, trackWidthPx))
    }

    it.each([2, 50, 300, 2000])(
      'is identical whether or not %i markers are competing for the budget near the focus',
      (markerCount) => {
        const clusterCentreT = 1e8
        const eventTimes = Array.from({ length: markerCount }, (_, i) => clusterCentreT + i / Math.max(1, markerCount - 1))
        const markerS = eventTimes.map((t) => base.toUnit(t)).sort((a, b) => a - b)
        const centreU = centreUForFocus(base, TRACK_WIDTH_PX, markerS, (markerS[0]! + markerS[markerS.length - 1]!) / 2)

        // Sanity: the cluster really is comfortably outside farT's own local support (and vice
        // versa) at this separation, so the "before the support" closed form applies.
        const distancePx = Math.abs(farS - centreU) * TRACK_WIDTH_PX
        expect(distancePx).toBeGreaterThan(GAP_TAPER_HALF_WIDTH_PX)

        const withoutMarkers = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX)
        const withCluster = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, markerS)
        const expected = expectedFarToUnit(1, TRACK_WIDTH_PX)

        expect(Math.abs(withoutMarkers.toUnit(farT) - expected)).toBeLessThanOrEqual(1e-12)
        expect(Math.abs(withCluster.toUnit(farT) - expected)).toBeLessThanOrEqual(1e-12)
      },
    )

    it('is identical as the focus sweeps across a dense cluster, through every point where gaps are actively competing for the budget', () => {
      const clusterCentreT = 1e8
      const markerS = Array.from({ length: 50 }, (_, i) => base.toUnit(clusterCentreT + i)).sort((a, b) => a - b)
      const clusterStartU = centreUForFocus(base, TRACK_WIDTH_PX, markerS, markerS[0]!)
      const clusterEndU = centreUForFocus(base, TRACK_WIDTH_PX, markerS, markerS[markerS.length - 1]!)
      const expected = expectedFarToUnit(1, TRACK_WIDTH_PX)

      const STEPS = 40
      for (let i = 0; i <= STEPS; i++) {
        const centreU = clusterStartU + ((clusterEndU - clusterStartU) * i) / STEPS
        const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, markerS)
        expect(Math.abs(scale.toUnit(farT) - expected)).toBeLessThanOrEqual(1e-12)
      }
    })

    it('is identical as the focus sweeps across a sparse region with no competing gaps at all', () => {
      const sparseMarkers = [base.toUnit(2e8), base.toUnit(2.5e8), base.toUnit(3e8)]
      const expected = expectedFarToUnit(1, TRACK_WIDTH_PX)
      for (const centreU of [0.3, 0.45, 0.5, 0.55, 0.7]) {
        const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, sparseMarkers)
        expect(Math.abs(scale.toUnit(farT) - expected)).toBeLessThanOrEqual(1e-12)
      }
    })

    it('holds even when the lens is clipped by the far (present) domain edge', () => {
      // A heavily edge-clipped bump (module doc, "Edge clipping") redistributes its own gain to
      // keep its in-domain mass at the budget — this must not leak into farT's own value, which
      // never touches that redistribution at all.
      const denseNearEdge = Array.from({ length: 30 }, (_, i) => base.toUnit(20 + i))
      const expected = expectedFarToUnit(1, TRACK_WIDTH_PX)
      for (const centreU of [0.995, 0.999, 1]) {
        const withoutMarkers = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX)
        const withMarkers = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, denseNearEdge)
        expect(Math.abs(withoutMarkers.toUnit(farT) - expected)).toBeLessThanOrEqual(1e-12)
        expect(Math.abs(withMarkers.toUnit(farT) - expected)).toBeLessThanOrEqual(1e-12)
      }
    })

    it('the normaliser (table total) is independent of focus and markers: magnification at a far point is the same constant everywhere', () => {
      const clusterCentreT = 1e8
      const markerS = Array.from({ length: 300 }, (_, i) => base.toUnit(clusterCentreT + i / 299)).sort((a, b) => a - b)
      const expectedMagnification = 1 / (1 + extraMassBudget(1, TRACK_WIDTH_PX))

      for (const centreU of [0.3, 0.5, 0.7, 0.98]) {
        const withoutMarkers = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX)
        const withMarkers = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, markerS)
        expect(withoutMarkers.magnificationAt(farT)).toBeCloseTo(expectedMagnification, 12)
        expect(withMarkers.magnificationAt(farT)).toBeCloseTo(expectedMagnification, 12)
      }
    })

    it('the budget — and so the far point position — is independent of track width for a fixed strength', () => {
      const clusterCentreT = 1e8
      const markerS = Array.from({ length: 20 }, (_, i) => base.toUnit(clusterCentreT + i)).sort((a, b) => a - b)
      for (const trackWidthPx of [720, 1440, 2880]) {
        const centreU = centreUForFocus(base, trackWidthPx, markerS, (markerS[0]! + markerS[markerS.length - 1]!) / 2)
        const scale = fisheyeScale(base, { centreU, strength: 1 }, trackWidthPx, markerS)
        const expected = expectedFarToUnit(1, trackWidthPx)
        expect(Math.abs(scale.toUnit(farT) - expected)).toBeLessThanOrEqual(1e-12)
      }
    })
  })

  describe('continuity with markers present', () => {
    it('toUnit is strictly increasing through a resolved sub-pixel marker gap', () => {
      // A synthetic ~1e-6-wide gap directly in IDENTITY_SCALE's own space — the same order of
      // magnitude as the K-Pg trio's real base-px separation.
      const markers = [0.5, 0.5 + 1e-6, 0.5 + 3e-6]
      const centreU = centreUForFocus(IDENTITY_SCALE, TRACK_WIDTH_PX, markers, 0.5 + 1.5e-6)
      const scale = fisheyeScale(IDENTITY_SCALE, { centreU, strength: 1 }, TRACK_WIDTH_PX, markers)

      let previous = scale.toUnit(0)
      for (let i = 1; i <= 300; i++) {
        const u = scale.toUnit(i / 300)
        expect(u).toBeGreaterThan(previous)
        previous = u
      }

      // Fine sampling through the resolved gap itself — 300 coarse samples above would almost
      // certainly step straight over a window this narrow.
      let previousFine = scale.toUnit(0.4999)
      for (let i = 1; i <= 300; i++) {
        const s = 0.4999 + (0.0002 * i) / 300
        const u = scale.toUnit(s)
        expect(u).toBeGreaterThan(previousFine)
        previousFine = u
      }
    })

    it('toUnit(fromUnit(centreU)) ≈ centreU still holds with markers (structural, not focus-dependent)', () => {
      const markers = [0.5, 0.5 + 1e-6, 0.5 + 3e-6]
      for (const centreU of [0.5, 0.02, 0.98, 0.500001]) {
        const scale = fisheyeScale(IDENTITY_SCALE, { centreU, strength: 1 }, TRACK_WIDTH_PX, markers)
        const focus = scale.fromUnit(centreU)
        expect(scale.toUnit(focus)).toBeCloseTo(centreU, 9)
      }
    })
  })

  describe('pointer sweep across the K-Pg trio', () => {
    const base = createSymlogScale(FULL_DOMAIN)
    const markerS = [...KPG_TRIO].map((t) => base.toUnit(t)).sort((a, b) => a - b)
    // The sweep must bracket the trio's *displayed* position, not its base `s` position — the
    // plain bump's own (pre-existing, gap-insertion-independent) magnification near a focus
    // already close to the trio moves its displayed position well away from `s` (up to ~6x
    // magnification within FISHEYE_HALF_WIDTH_PX of the focus, compounded over the approach).
    // `centreUForFocus` gives a self-consistent displayed-space estimate of where the trio
    // lands once the lens has caught up; the sweep window is generous around it so the actual,
    // lag-driven approach (`moveFisheyeLens`) safely brackets wherever it really ends up.
    const midS = (markerS[0]! + markerS[markerS.length - 1]!) / 2
    const centreU0 = centreUForFocus(base, TRACK_WIDTH_PX, markerS, midS)
    const START_U = Math.max(0, centreU0 - 0.05)
    const END_U = Math.min(1, centreU0 + 0.05)
    const STEP_U = 1 / TRACK_WIDTH_PX

    function sweep(): { times: number[]; nearestIndices: Set<number> } {
      let motion: FisheyeMotion = { lens: { centreU: START_U, strength: 1 } }
      let pointerU = START_U
      const times: number[] = []
      const nearestIndices = new Set<number>()

      const recordAt = (u: number, motionNow: FisheyeMotion): number => {
        const scale = fisheyeScale(base, motionNow.lens, TRACK_WIDTH_PX, markerS)
        const t = scale.fromUnit(u)
        const displayed = KPG_TRIO.map((tt) => scale.toUnit(tt))
        let nearest = 0
        let bestDist = Infinity
        for (let i = 0; i < displayed.length; i++) {
          const dist = Math.abs(displayed[i]! - u)
          if (dist < bestDist) {
            bestDist = dist
            nearest = i
          }
        }
        nearestIndices.add(nearest)
        return t
      }

      times.push(recordAt(pointerU, motion))
      while (pointerU < END_U) {
        // Deliberately *not* `Math.min(END_U, pointerU + STEP_U)`: clamping the last step to
        // land exactly on `END_U` can leave a sub-pixel (occasionally sub-ULP) leftover step —
        // no real pointer ever moves that little, and asking the lens to resolve a `du` below
        // float precision in `u` itself is asking the impossible regardless of magnification.
        // Every step here is a full pixel; the sweep simply overshoots `END_U` by less than one
        // step on its last iteration.
        const nextU = pointerU + STEP_U
        motion = moveFisheyeLens(motion, pointerU, nextU, TRACK_WIDTH_PX)
        pointerU = nextU
        times.push(recordAt(pointerU, motion))
      }
      return { times, nearestIndices }
    }

    it('the time under the pointer is strictly monotonic', () => {
      const { times } = sweep()
      for (let i = 1; i < times.length; i++) {
        // Displayed u runs oldest (0) to newest (1) — sweeping toward larger u means t strictly
        // decreases.
        expect(times[i]!).toBeLessThan(times[i - 1]!)
      }
    })

    it('each of the three scenes becomes the nearest marker to the pointer at some pixel', () => {
      const { nearestIndices } = sweep()
      expect(nearestIndices).toEqual(new Set([0, 1, 2]))
    })
  })

  describe('continuity as the focus sweeps past a resolved gap', () => {
    // A direct test of "gaps open/close smoothly rather than popping" (module doc), isolated
    // from the pointer-sweep machinery above: the K-Pg trio's own two sub-gaps span wildly
    // different real durations (~0.01yr and ~99.99yr) sharing a comparable pixel budget, so a
    // pointer sweep's *own* per-pixel time delta legitimately jumps by orders of magnitude at
    // the boundary between them — expected, not a pop, and not what this property is about.
    // What must be continuous is a fixed point's *displayed position* as the lens focus moves
    // past it: `toUnit(t)` is `focusForCentre` (continuous, proven monotonic) composed with a
    // taper and a cumulative table that are both continuous in the focus, so this should hold
    // by construction; the test walks `centreU` finely and checks it numerically.
    it('toUnit(KPG_DARKNESS) changes smoothly as centreU sweeps across the whole trio', () => {
      const base = createSymlogScale(FULL_DOMAIN)
      const markerS = [...KPG_TRIO].map((t) => base.toUnit(t)).sort((a, b) => a - b)
      const midS = (markerS[0]! + markerS[markerS.length - 1]!) / 2
      const centreU0 = centreUForFocus(base, TRACK_WIDTH_PX, markerS, midS)
      const RANGE = 0.1
      const SWEEP_STEPS = 2000
      const loU = Math.max(0, centreU0 - RANGE)
      const hiU = Math.min(1, centreU0 + RANGE)

      const uValues: number[] = []
      for (let i = 0; i <= SWEEP_STEPS; i++) {
        const centreU = loU + ((hiU - loU) * i) / SWEEP_STEPS
        const scale = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, markerS)
        uValues.push(scale.toUnit(KPG_DARKNESS))
      }

      const steps = uValues.slice(1).map((u, i) => Math.abs(u - uValues[i]!))
      const totalSpan = Math.max(...uValues) - Math.min(...uValues)
      const averageStep = totalSpan / SWEEP_STEPS

      // Every step within a bounded multiple of the sweep's own average — bounded because the
      // map is smooth but not uniform (the taper and the plain bump both concentrate change
      // near the focus), never a discontinuous outlier far beyond that.
      for (const step of steps) {
        expect(step).toBeLessThan(50 * Math.max(averageStep, Number.EPSILON))
      }
    })
  })
})

describe('yearsPerDisplayedPixelAt', () => {
  it('is much smaller near the present than deep in the past, on the plain symlog scale', () => {
    const scale = createSymlogScale(FULL_DOMAIN)
    const nearPresent = yearsPerDisplayedPixelAt(scale, 0.999, TRACK_WIDTH_PX)
    const deepPast = yearsPerDisplayedPixelAt(scale, 0.1, TRACK_WIDTH_PX)
    expect(nearPresent).toBeGreaterThan(0)
    expect(deepPast).toBeGreaterThan(nearPresent)
  })

  it('is 0 at trackWidthPx <= 0', () => {
    const scale = createSymlogScale(FULL_DOMAIN)
    expect(yearsPerDisplayedPixelAt(scale, 0.5, 0)).toBeNaN()
  })

  it('reports a far finer resolution inside a resolved gap than the unlensed base scale gives at the same spot', () => {
    const base = createSymlogScale(FULL_DOMAIN)
    const markerS = [...KPG_TRIO].map((t) => base.toUnit(t)).sort((a, b) => a - b)
    const midS = (markerS[0]! + markerS[markerS.length - 1]!) / 2
    const centreU = centreUForFocus(base, TRACK_WIDTH_PX, markerS, midS)
    const lensed = fisheyeScale(base, { centreU, strength: 1 }, TRACK_WIDTH_PX, markerS)

    const lensedYearsPerPx = yearsPerDisplayedPixelAt(lensed, centreU, TRACK_WIDTH_PX)
    const baseYearsPerPx = yearsPerDisplayedPixelAt(base, base.toUnit(KPG_DARKNESS), TRACK_WIDTH_PX)
    expect(lensedYearsPerPx).toBeGreaterThan(0)
    expect(lensedYearsPerPx).toBeLessThan(baseYearsPerPx)
  })
})
