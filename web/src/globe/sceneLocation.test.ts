import { describe, expect, it } from 'vitest'

import type { SceneCoordinates } from '@/types/manifest'

import {
  DRIFT_EASE_IN_SECONDS,
  DRIFT_RESUME_IDLE_SECONDS,
  DRIFT_RUNNING,
  focusRotationY,
  type GlobeRotationState,
  REST_ROTATION,
  sceneMarkerCoordinates,
  shortestAngleDelta,
  startFocusEase,
  stepDriftGate,
  stepGlobeRotation,
  wrapAngle,
} from './sceneLocation'

const DEG = Math.PI / 180

describe('angle helpers', () => {
  it('wraps into [-π, π) preserving the angle, including many accumulated turns', () => {
    expect(wrapAngle(1)).toBeCloseTo(1)
    expect(wrapAngle(Math.PI + 0.5)).toBeCloseTo(-Math.PI + 0.5)
    expect(wrapAngle(-Math.PI - 0.5)).toBeCloseTo(Math.PI - 0.5)
    const wrapped = wrapAngle(15)
    expect(wrapped).toBeGreaterThanOrEqual(-Math.PI)
    expect(wrapped).toBeLessThan(Math.PI)
    expect(Math.sin(wrapped)).toBeCloseTo(Math.sin(15), 5)
    expect(Math.cos(wrapped)).toBeCloseTo(Math.cos(15), 5)
  })

  it('takes the short way across the ±π seam', () => {
    expect(shortestAngleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 5)
    expect(shortestAngleDelta(0.5, 0.5 + 2 * Math.PI)).toBeCloseTo(0, 5)
    expect(Math.abs(shortestAngleDelta(-3, 3))).toBeLessThanOrEqual(Math.PI)
  })

  it('rotates a longitude to face the camera, accounting for its azimuth, wrapped', () => {
    expect(focusRotationY(30, 0)).toBeCloseTo(-30 * DEG)
    expect(focusRotationY(30, 40 * DEG)).toBeCloseTo(10 * DEG)
    const rotation = focusRotationY(-179, 0)
    expect(rotation).toBeGreaterThanOrEqual(-Math.PI)
    expect(Math.cos(rotation)).toBeCloseTo(Math.cos(179 * DEG), 5)
  })
})

describe('globe rotation easing', () => {
  it('snaps for a non-positive duration', () => {
    const snapped = startFocusEase(REST_ROTATION, 1.5, 0)
    expect(snapped).toEqual({ rotationY: 1.5, easeFrom: 1.5, easeTo: 1.5, easeElapsed: 0, easeDuration: 0 })
  })

  it('eases the short way round, past ±π rather than reversing', () => {
    const state = startFocusEase({ ...REST_ROTATION, rotationY: Math.PI - 0.1 }, -Math.PI + 0.1, 1)
    expect(state.rotationY).toBe(Math.PI - 0.1)
    expect(state.easeTo).toBeGreaterThan(Math.PI)
  })

  it('suppresses drift during an ease, lands exactly, then drifts on without a snap', () => {
    expect(stepGlobeRotation(REST_ROTATION, 1, 10).rotationY).toBeCloseTo(wrapAngle(10))
    const easing = startFocusEase(REST_ROTATION, 1, 1)
    expect(Math.abs(stepGlobeRotation(easing, 0.5, 1000).rotationY)).toBeLessThan(2)
    const finished = stepGlobeRotation(easing, 1, 0)
    expect(finished.easeDuration).toBe(0)
    expect(finished.rotationY).toBeCloseTo(1)
    expect(stepGlobeRotation(finished, 1, 0.2).rotationY).toBeCloseTo(1.2)
  })

  it.each([0, -1, Number.NaN, Infinity])('ignores dt = %p', (dt) => {
    const state: GlobeRotationState = { ...REST_ROTATION, rotationY: 0.5 }
    expect(stepGlobeRotation(state, dt, 10)).toEqual(state)
  })
})

describe('drift gate', () => {
  const idle = { expanded: true, interacted: false, held: false }

  function run(gate: typeof DRIFT_RUNNING, seconds: number, inputs = idle, dt = 0.1) {
    const speeds: number[] = []
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) {
      gate = stepDriftGate(gate, dt, inputs)
      speeds.push(gate.speed)
    }
    return { gate, speeds }
  }

  it('stops on interaction, stays stopped while held, and eases back in only after the idle spell', () => {
    const stopped = stepDriftGate(DRIFT_RUNNING, 0.016, { ...idle, interacted: true })
    expect(stopped.speed).toBe(0)
    const held = run(stopped, DRIFT_RESUME_IDLE_SECONDS * 2, { ...idle, held: true })
    expect(Math.max(...held.speeds)).toBe(0)

    const waiting = run(held.gate, DRIFT_RESUME_IDLE_SECONDS - 1)
    expect(Math.max(...waiting.speeds)).toBe(0)
    const resuming = run(waiting.gate, 1 + DRIFT_EASE_IN_SECONDS)
    expect(resuming.gate.speed).toBe(1)
    for (let i = 1; i < resuming.speeds.length; i += 1) {
      expect(resuming.speeds[i]! - resuming.speeds[i - 1]!).toBeGreaterThanOrEqual(0)
      expect(resuming.speeds[i]! - resuming.speeds[i - 1]!).toBeLessThanOrEqual(0.1 / DRIFT_EASE_IN_SECONDS + 1e-9)
    }
  })

  it('always runs collapsed, easing in from a stop', () => {
    const collapsed = { expanded: false, interacted: true, held: true }
    const { gate, speeds } = run({ speed: 0, idleSeconds: 0 }, DRIFT_EASE_IN_SECONDS, collapsed)
    expect(speeds[0]).toBeGreaterThan(0)
    expect(speeds[0]).toBeLessThan(0.1)
    expect(gate.speed).toBeCloseTo(1)
  })
})

describe('sceneMarkerCoordinates', () => {
  it('returns the marker only, never falling back to presentDay', () => {
    const marker: SceneCoordinates = { lat: 10, lon: 20 }
    expect(sceneMarkerCoordinates(undefined)).toBeNull()
    expect(sceneMarkerCoordinates({ marker })).toEqual(marker)
    const location = { marker: null, presentDay: { lat: 11, lon: 21 } } as { marker: SceneCoordinates | null }
    expect(sceneMarkerCoordinates(location)).toBeNull()
  })
})
