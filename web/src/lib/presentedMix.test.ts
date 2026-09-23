// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  dominantItem,
  type Mix,
  type MixKeying,
  mixesEqual,
  moveToward,
  stepMix,
  stepNumericRecord,
  usePresentedMix,
  usePresentedNumericRecord,
} from './presentedMix'

interface Item {
  id: string
  t: number
}

const KEYING: MixKeying<Item> = {
  same: (a, b) => a.id === b.id,
  distance: (a, b) => Math.abs(Math.log1p(a.t) - Math.log1p(b.t)),
}
const MIN_SECONDS = 1.2

const a: Item = { id: 'a', t: 100 }
const b: Item = { id: 'b', t: 1000 }
const c: Item = { id: 'c', t: 10000 }
const d: Item = { id: 'd', t: 100000 }

function alone(item: Item): Mix<Item> {
  return { from: item, to: item, mix: 0 }
}

describe('moveToward', () => {
  it('moves by at most maxDelta and snaps onto a target within reach', () => {
    expect(moveToward(0, 1, 0.25)).toBe(0.25)
    expect(moveToward(0.9, 0.2, 0.25)).toBeCloseTo(0.65)
    expect(moveToward(0.9, 1, 0.25)).toBe(1)
  })
})

describe('stepMix', () => {
  it.each([0, NaN])('returns the state itself for dt = %p', (dt) => {
    const state: Mix<Item> = { from: a, to: b, mix: 0.3 }
    expect(stepMix(state, { from: a, to: b, mix: 1 }, dt, MIN_SECONDS, KEYING)).toBe(state)
  })

  it('moves the same pair by dt / minSeconds', () => {
    const next = stepMix({ from: a, to: b, mix: 0 }, { from: a, to: b, mix: 1 }, 0.3, MIN_SECONDS, KEYING)
    expect(next).toEqual({ from: a, to: b, mix: 0.3 / MIN_SECONDS })
  })

  it('relabels a reversed pair before moving', () => {
    const next = stepMix({ from: b, to: a, mix: 0.2 }, { from: a, to: b, mix: 1 }, 0.12, MIN_SECONDS, KEYING)
    expect(next.from).toBe(a)
    expect(next.to).toBe(b)
    expect(next.mix).toBeCloseTo(0.8 + 0.1)
  })

  it('rebases a settled item onto the target pair it belongs to at no time cost', () => {
    expect(stepMix({ from: a, to: b, mix: 1 }, { from: b, to: c, mix: 0.4 }, 100, MIN_SECONDS, KEYING)).toEqual({
      from: b,
      to: c,
      mix: 0.4,
    })
  })

  it('crosses several items directly from the one on screen to the target, never through the ones between', () => {
    let state = alone(a)
    const target = alone(d)
    let elapsed = 0
    while (!mixesEqual(state, target, KEYING)) {
      state = stepMix(state, target, 1 / 60, MIN_SECONDS, KEYING)
      elapsed += 1 / 60
      expect(['a', 'd']).toContain(state.from.id)
      expect(['a', 'd']).toContain(state.to.id)
    }
    expect(elapsed).toBeGreaterThanOrEqual(MIN_SECONDS)
  })

  it('turns a transition around when the target dominant item is nearer its start', () => {
    const next = stepMix({ from: b, to: d, mix: 0.4 }, { from: a, to: b, mix: 0.9 }, 0.12, MIN_SECONDS, KEYING)
    expect(next.from).toBe(b)
    expect(next.to).toBe(d)
    expect(next.mix).toBeLessThan(0.4)
  })

  it('follows a target moving slower than the floor exactly', () => {
    let state: Mix<Item> = { from: a, to: b, mix: 0 }
    for (let i = 1; i <= 50; i++) {
      const target = { from: a, to: b, mix: i * 0.02 }
      state = stepMix(state, target, 0.1, MIN_SECONDS, KEYING)
      expect(state.mix).toBeCloseTo(target.mix)
    }
  })
})

describe('dominantItem', () => {
  it('is `from` below the midpoint and `to` from it on', () => {
    expect(dominantItem({ from: a, to: b, mix: 0.49 })).toBe(a)
    expect(dominantItem({ from: a, to: b, mix: 0.5 })).toBe(b)
  })
})

/** Drives rAF, timers and the clock from `vi.advanceTimersByTime` instead of real wall time. */
function withFakeFrames(): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('usePresentedMix', () => {
  withFakeFrames()

  it('mounts at the target and takes at least minSeconds of frames to catch a jump', () => {
    const { result, rerender } = renderHook(({ target }) => usePresentedMix(target, MIN_SECONDS, KEYING), {
      initialProps: { target: alone(a) },
    })
    expect(result.current).toEqual(alone(a))

    act(() => rerender({ target: alone(d) }))
    advance(200)
    expect(result.current.from).toBe(a)
    expect(result.current.to).toBe(d)
    expect(result.current.mix).toBeGreaterThan(0)
    expect(result.current.mix).toBeLessThan(1)

    advance(MIN_SECONDS * 1000 - 250)
    expect(result.current).not.toEqual(alone(d))
    advance(200)
    expect(result.current).toEqual(alone(d))
  })
})

const MIN_NUMERIC_SECONDS = 1.5

describe('stepNumericRecord', () => {
  it.each([0, NaN])('returns the state itself for dt = %p', (dt) => {
    const state = { a: 0.2, b: 0.8 }
    expect(stepNumericRecord(state, { a: 1, b: 0 }, dt, MIN_NUMERIC_SECONDS)).toBe(state)
  })

  it('moves every field independently by at most dt / minSeconds', () => {
    const next = stepNumericRecord({ a: 0, b: 1 }, { a: 1, b: 0 }, 0.3, MIN_NUMERIC_SECONDS)
    expect(next.a).toBeCloseTo(0.3 / MIN_NUMERIC_SECONDS)
    expect(next.b).toBeCloseTo(1 - 0.3 / MIN_NUMERIC_SECONDS)
  })

  it('snaps a field onto its target once within reach, without waiting for the others', () => {
    const next = stepNumericRecord({ a: 0.99, b: 0 }, { a: 1, b: 1 }, 0.3, MIN_NUMERIC_SECONDS)
    expect(next.a).toBe(1)
    expect(next.b).toBeLessThan(1)
  })

  it('follows a target moving slower than the floor exactly', () => {
    let state = { a: 0 }
    for (let i = 1; i <= 50; i++) {
      const target = { a: i * 0.02 }
      state = stepNumericRecord(state, target, 0.1, MIN_NUMERIC_SECONDS)
      expect(state.a).toBeCloseTo(target.a)
    }
  })
})

describe('usePresentedNumericRecord', () => {
  withFakeFrames()

  it('mounts at the target and takes at least minSeconds of frames to catch a jump', () => {
    const { result, rerender } = renderHook(({ target }) => usePresentedNumericRecord(target, MIN_NUMERIC_SECONDS), {
      initialProps: { target: { a: 0, b: 0 } },
    })
    expect(result.current).toEqual({ a: 0, b: 0 })

    act(() => rerender({ target: { a: 1, b: 1 } }))
    advance(200)
    expect(result.current.a).toBeGreaterThan(0)
    expect(result.current.a).toBeLessThan(1)

    advance(MIN_NUMERIC_SECONDS * 1000 - 250)
    expect(result.current.a).toBeLessThan(1)
    advance(200)
    expect(result.current).toEqual({ a: 1, b: 1 })
  })
})
