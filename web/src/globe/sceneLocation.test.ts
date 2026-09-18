import { describe, expect, it } from 'vitest'

import type { SceneCoordinates } from '@/types/manifest'

import {
  focusRotationY,
  type GlobeRotationState,
  REST_ROTATION,
  sceneMarkerCoordinates,
  shortestAngleDelta,
  startFocusEase,
  stepGlobeRotation,
  wrapAngle,
} from './sceneLocation'

describe('wrapAngle', () => {
  it('leaves an angle already in [-pi, pi) unchanged', () => {
    expect(wrapAngle(0)).toBeCloseTo(0)
    expect(wrapAngle(1)).toBeCloseTo(1)
    expect(wrapAngle(-1)).toBeCloseTo(-1)
  })

  it('wraps an angle past pi back into range', () => {
    expect(wrapAngle(Math.PI + 0.5)).toBeCloseTo(-Math.PI + 0.5)
  })

  it('wraps an angle past -pi back into range', () => {
    expect(wrapAngle(-Math.PI - 0.5)).toBeCloseTo(Math.PI - 0.5)
  })

  it('keeps a long-session accumulation (many full turns) within range and equivalent mod 2*PI', () => {
    const manyTurns = 15 // ~10 minutes of real-time auto-rotate at AUTO_ROTATE_RADIANS_PER_SECOND
    const wrapped = wrapAngle(manyTurns)
    expect(wrapped).toBeGreaterThanOrEqual(-Math.PI)
    expect(wrapped).toBeLessThan(Math.PI)
    // sin/cos are 2*PI-periodic, so this is a robust way to check "same angle" without manually
    // re-deriving the wrap formula in the test itself.
    expect(Math.sin(wrapped)).toBeCloseTo(Math.sin(manyTurns), 5)
    expect(Math.cos(wrapped)).toBeCloseTo(Math.cos(manyTurns), 5)
  })

  it('a wrapped angle interpolated linearly to 0 never travels more than half a turn (the "shortest path" guarantee)', () => {
    for (const raw of [15, -27, 100, -0.001, Math.PI - 0.001, -Math.PI + 0.001]) {
      const wrapped = wrapAngle(raw)
      expect(Math.abs(wrapped)).toBeLessThanOrEqual(Math.PI)
    }
  })
})

describe('focusRotationY', () => {
  const DEG2RAD = Math.PI / 180

  it('needs rotation -L (radians) to bring a point at longitude L to face the camera', () => {
    expect(focusRotationY(30)).toBeCloseTo(-30 * DEG2RAD)
    expect(focusRotationY(-45)).toBeCloseTo(45 * DEG2RAD)
    expect(focusRotationY(0)).toBeCloseTo(0)
  })

  it('wraps the result into [-pi, pi)', () => {
    const rotation = focusRotationY(-179)
    expect(rotation).toBeGreaterThanOrEqual(-Math.PI)
    expect(rotation).toBeLessThan(Math.PI)
    expect(Math.cos(rotation)).toBeCloseTo(Math.cos(179 * DEG2RAD), 5)
    expect(Math.sin(rotation)).toBeCloseTo(Math.sin(179 * DEG2RAD), 5)
  })
})

describe('shortestAngleDelta', () => {
  it('never travels more than half a turn', () => {
    for (const [from, to] of [
      [0, 3],
      [3, 0],
      [-3, 3],
      [0.1, -0.1],
    ] as const) {
      expect(Math.abs(shortestAngleDelta(from, to))).toBeLessThanOrEqual(Math.PI)
    }
  })

  it('picks the short way forward across the +-pi seam, not the long way back', () => {
    const delta = shortestAngleDelta(Math.PI - 0.1, -Math.PI + 0.1)
    expect(delta).toBeCloseTo(0.2, 5)
  })

  it('is 0 for two angles equivalent modulo a full turn', () => {
    expect(shortestAngleDelta(0.5, 0.5 + 2 * Math.PI)).toBeCloseTo(0, 5)
  })
})

describe('startFocusEase', () => {
  it('snaps immediately when durationSeconds is 0 or negative', () => {
    const snapped = startFocusEase(REST_ROTATION, 1.5, 0)
    expect(snapped).toEqual({ rotationY: 1.5, easeFrom: 1.5, easeTo: 1.5, easeElapsed: 0, easeDuration: 0 })
    expect(startFocusEase(REST_ROTATION, 1.5, -1)).toEqual(snapped)
  })

  it('sets an unwrapped easeTo, reached by the shorter way round, and leaves rotationY untouched until stepped', () => {
    const state = startFocusEase(REST_ROTATION, Math.PI - 0.1, 1)
    expect(state.rotationY).toBe(REST_ROTATION.rotationY)
    expect(state.easeFrom).toBe(REST_ROTATION.rotationY)
    expect(state.easeDuration).toBe(1)
    expect(state.easeTo).toBeCloseTo(Math.PI - 0.1)
  })

  it('carries the target past +-pi rather than wrapping it, when that is the shorter way round', () => {
    const start: GlobeRotationState = { ...REST_ROTATION, rotationY: Math.PI - 0.1 }
    const state = startFocusEase(start, -Math.PI + 0.1, 1)
    // The shortest path from just under +pi to just over -pi continues forward past +pi rather
    // than reversing direction.
    expect(state.easeTo).toBeGreaterThan(Math.PI)
  })
})

describe('stepGlobeRotation', () => {
  it('accumulates drift over time and keeps the result wrapped', () => {
    const state = stepGlobeRotation(REST_ROTATION, 1, 10)
    expect(state.rotationY).toBeCloseTo(wrapAngle(10))
  })

  it('suppresses drift while an ease is in progress', () => {
    const easing = startFocusEase(REST_ROTATION, 1, 2)
    const stepped = stepGlobeRotation(easing, 0.5, 1000)
    expect(stepped.easeDuration).toBeGreaterThan(0)
    // A drift rate of 1000 rad/s over 0.5s would be nowhere near this small if drift were not
    // suppressed by the running ease.
    expect(Math.abs(stepped.rotationY)).toBeLessThan(2)
  })

  it('reaches exactly the ease target, then resumes drift from there with no snap', () => {
    const easing = startFocusEase(REST_ROTATION, 1, 1)
    const finished = stepGlobeRotation(easing, 1, 0)
    expect(finished.easeDuration).toBe(0)
    expect(finished.rotationY).toBeCloseTo(wrapAngle(1))

    const drifted = stepGlobeRotation(finished, 1, 0.2)
    expect(drifted.rotationY).toBeCloseTo(wrapAngle(1 + 0.2))
  })

  it('treats a non-finite, zero or negative dt as a no-op', () => {
    const state: GlobeRotationState = { ...REST_ROTATION, rotationY: 0.5 }
    expect(stepGlobeRotation(state, 0, 10)).toEqual(state)
    expect(stepGlobeRotation(state, Number.NaN, 10)).toEqual(state)
    expect(stepGlobeRotation(state, -1, 10)).toEqual(state)
    expect(stepGlobeRotation(state, Number.POSITIVE_INFINITY, 10)).toEqual(state)
  })
})

describe('sceneMarkerCoordinates', () => {
  const MARKER: SceneCoordinates = { lat: 10, lon: 20 }
  const PRESENT_DAY: SceneCoordinates = { lat: 11, lon: 21 }

  it('is null for an undefined location', () => {
    expect(sceneMarkerCoordinates(undefined)).toBeNull()
  })

  it('is null for a location with no marker', () => {
    expect(sceneMarkerCoordinates({ marker: null })).toBeNull()
  })

  it('returns the marker when present', () => {
    expect(sceneMarkerCoordinates({ marker: MARKER })).toEqual(MARKER)
  })

  it('never falls back to presentDay, even when the caller\'s object carries one', () => {
    const location = { marker: null, presentDay: PRESENT_DAY } as {
      marker: SceneCoordinates | null
      presentDay: SceneCoordinates
    }
    expect(sceneMarkerCoordinates(location)).toBeNull()
  })
})
