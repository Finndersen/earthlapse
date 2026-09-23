import { describe, expect, it } from 'vitest'

import { easeInOutCubic, SPHERE_UNFOLD, stepUnfold, unfoldSettled, UNFOLD_DURATION_SECONDS, type UnfoldState } from './unfoldAnimation'

function target(t: number): UnfoldState {
  return { value: t, target: t, elapsedSeconds: 0 }
}

describe('easeInOutCubic', () => {
  it('anchors 0 and 1', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
  })

})

describe('stepUnfold', () => {
  it('does nothing for a non-positive or non-finite dt', () => {
    expect(stepUnfold(SPHERE_UNFOLD, SPHERE_UNFOLD, 0, UNFOLD_DURATION_SECONDS)).toEqual(SPHERE_UNFOLD)
    expect(stepUnfold(SPHERE_UNFOLD, SPHERE_UNFOLD, -1, UNFOLD_DURATION_SECONDS)).toEqual(SPHERE_UNFOLD)
  })

  it('eases from 0 toward 1 over the given duration, landing exactly on it', () => {
    let state = SPHERE_UNFOLD
    const steps = 40
    const dt = UNFOLD_DURATION_SECONDS / steps
    for (let i = 0; i < steps; i++) {
      state = stepUnfold(state, target(1), dt, UNFOLD_DURATION_SECONDS)
    }
    expect(state.value).toBeCloseTo(1, 6)
    expect(unfoldSettled(state, target(1))).toBe(true)
  })

  it('restarts the ease from the current value, not from 0/1, when the destination reverses mid-unfold', () => {
    const halfway = stepUnfold(SPHERE_UNFOLD, target(1), UNFOLD_DURATION_SECONDS / 2, UNFOLD_DURATION_SECONDS)
    expect(halfway.value).toBeGreaterThan(0)
    expect(halfway.value).toBeLessThan(1)

    const reversing = stepUnfold(halfway, target(0), 0, UNFOLD_DURATION_SECONDS)
    expect(reversing.value).toBe(halfway.value)
    expect(reversing.target).toBe(0)
    expect(reversing.elapsedSeconds).toBe(0)

    const afterFullDuration = stepUnfold(reversing, target(0), UNFOLD_DURATION_SECONDS, UNFOLD_DURATION_SECONDS)
    expect(afterFullDuration.value).toBe(0)
  })

  it('snaps immediately when durationSeconds <= 0 (reduced motion)', () => {
    const state = stepUnfold(SPHERE_UNFOLD, target(1), 0.016, 0)
    expect(state).toEqual({ value: 1, target: 1, elapsedSeconds: 0 })
  })
})

describe('unfoldSettled', () => {
  it('is false mid-tween and true once the value reaches the target', () => {
    expect(unfoldSettled(SPHERE_UNFOLD, target(1))).toBe(false)
    expect(unfoldSettled(target(1), target(1))).toBe(true)
  })
})
