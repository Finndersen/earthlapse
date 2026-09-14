import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type TimeScale } from '@/types/layer'

import {
  FISHEYE_DEADZONE_PX,
  RESTING_FISHEYE,
  fisheyeScale,
  isFisheyeSettled,
  stepFisheye,
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

describe('stepFisheye', () => {
  it('fades in from rest with the centre directly under the pointer, not sweeping in from the old centre', () => {
    const next = stepFisheye(RESTING_FISHEYE, 0.7, TRACK_WIDTH_PX, 0.016)
    expect(next.lens.centreU).toBe(0.7)
    expect(next.lens.strength).toBeGreaterThan(0)
    expect(next.lens.strength).toBeLessThan(1)
    expect(next.following).toBe(false)
  })

  it('leaves centreU unchanged for a pointer move inside the dead zone', () => {
    const settled: FisheyeMotion = { lens: { centreU: 0.5, strength: 1 }, following: false }
    const offsetU = (FISHEYE_DEADZONE_PX - 8) / TRACK_WIDTH_PX
    const next = stepFisheye(settled, 0.5 + offsetU, TRACK_WIDTH_PX, 0.016)
    expect(next.lens.centreU).toBe(0.5)
    expect(next.following).toBe(false)
  })

  it('follows and eases toward the pointer once it clears the dead zone, catching up exactly after enough steps', () => {
    const settled: FisheyeMotion = { lens: { centreU: 0.5, strength: 1 }, following: false }
    const target = 0.5 + (FISHEYE_DEADZONE_PX + 12) / TRACK_WIDTH_PX

    const afterOneStep = stepFisheye(settled, target, TRACK_WIDTH_PX, 0.016)
    expect(afterOneStep.following).toBe(true)
    expect(afterOneStep.lens.centreU).toBeGreaterThan(0.5)
    expect(afterOneStep.lens.centreU).toBeLessThan(target)

    let motion = afterOneStep
    for (let i = 0; i < 200 && motion.following; i++) {
      motion = stepFisheye(motion, target, TRACK_WIDTH_PX, 0.016)
    }
    expect(motion.following).toBe(false)
    expect(motion.lens.centreU).toBe(target)
  })

  it('fades strength to 0 and keeps centreU when the pointer leaves', () => {
    const settled: FisheyeMotion = { lens: { centreU: 0.7, strength: 1 }, following: true }
    const next = stepFisheye(settled, null, TRACK_WIDTH_PX, 0.016)
    expect(next.lens.centreU).toBe(0.7)
    expect(next.lens.strength).toBeLessThan(1)
    expect(next.lens.strength).toBeGreaterThan(0)
    expect(next.following).toBe(false)

    let motion = next
    for (let i = 0; i < 200 && motion.lens.strength > 0; i++) {
      motion = stepFisheye(motion, null, TRACK_WIDTH_PX, 0.016)
    }
    expect(motion.lens.strength).toBe(0)
    expect(motion.lens.centreU).toBe(0.7)
  })

  it('jumps straight to the target with dtSeconds = Infinity: fade-in', () => {
    const next = stepFisheye(RESTING_FISHEYE, 0.7, TRACK_WIDTH_PX, Infinity)
    expect(next).toEqual({ lens: { centreU: 0.7, strength: 1 }, following: false })
  })

  it('jumps straight to the target with dtSeconds = Infinity: catch-up beyond the dead zone', () => {
    const settled: FisheyeMotion = { lens: { centreU: 0.5, strength: 1 }, following: false }
    const target = 0.5 + (FISHEYE_DEADZONE_PX + 12) / TRACK_WIDTH_PX
    const next = stepFisheye(settled, target, TRACK_WIDTH_PX, Infinity)
    expect(next).toEqual({ lens: { centreU: target, strength: 1 }, following: false })
  })

  it('jumps straight to the target with dtSeconds = Infinity: fade-out', () => {
    const settled: FisheyeMotion = { lens: { centreU: 0.7, strength: 1 }, following: false }
    const next = stepFisheye(settled, null, TRACK_WIDTH_PX, Infinity)
    expect(next).toEqual({ lens: { centreU: 0.7, strength: 0 }, following: false })
  })
})

describe('isFisheyeSettled', () => {
  it('is true at rest with no pointer', () => {
    expect(isFisheyeSettled(RESTING_FISHEYE, null)).toBe(true)
  })

  it('is false at rest with a pointer present (strength has not faded in yet)', () => {
    expect(isFisheyeSettled(RESTING_FISHEYE, 0.5)).toBe(false)
  })

  it('is true once fully faded in and not following', () => {
    const motion: FisheyeMotion = { lens: { centreU: 0.5, strength: 1 }, following: false }
    expect(isFisheyeSettled(motion, 0.5)).toBe(true)
  })

  it('is false while following, even at full strength', () => {
    const motion: FisheyeMotion = { lens: { centreU: 0.5, strength: 1 }, following: true }
    expect(isFisheyeSettled(motion, 0.6)).toBe(false)
  })

  it('is false at partial strength', () => {
    const motion: FisheyeMotion = { lens: { centreU: 0.5, strength: 0.5 }, following: false }
    expect(isFisheyeSettled(motion, 0.5)).toBe(false)
  })
})
