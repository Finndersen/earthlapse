import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type TimeScale } from '@/types/layer'

import {
  FISHEYE_COUPLING_RADIUS_PX,
  RESTING_FISHEYE,
  fisheyeScale,
  isFisheyeSettled,
  moveFisheyeLens,
  stepFisheyeStrength,
  type FisheyeMotion,
} from './fisheye'
import { createLinearScale, createSymlogScale, type TimeWindow } from './scale'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]
const TRACK_WIDTH_PX = 1440

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
