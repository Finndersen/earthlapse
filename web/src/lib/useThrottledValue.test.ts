import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useThrottledValue } from './useThrottledValue'

const INTERVAL_MS = 80

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useThrottledValue', () => {
  it('shows the initial value immediately on mount', () => {
    const { result } = renderHook(() => useThrottledValue(1, INTERVAL_MS))
    expect(result.current).toBe(1)
  })

  it('settles on the final value once updates stop, even mid-window', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, INTERVAL_MS), {
      initialProps: { value: 0 },
    })

    // A burst of values arriving well inside a single throttle window.
    rerender({ value: 1 })
    act(() => {
      vi.advanceTimersByTime(10)
    })
    rerender({ value: 2 })
    act(() => {
      vi.advanceTimersByTime(10)
    })
    rerender({ value: 3 })

    // None of the intermediate values have committed yet — still well inside the window opened
    // by the first change.
    expect(result.current).toBe(0)

    // Run out the trailing timeout scheduled by that first change.
    act(() => {
      vi.advanceTimersByTime(INTERVAL_MS)
    })
    expect(result.current).toBe(3)
  })

  it('passes a discontinuous change through immediately after a quiet period', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, INTERVAL_MS), {
      initialProps: { value: 0 },
    })

    // Idle for far longer than the throttle window — nothing has changed, so the next change is
    // the "first change after quiet" and must not wait.
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    rerender({ value: 42 })

    expect(result.current).toBe(42)
  })

  it('emits fewer commits than inputs during a rapid sequence, without losing any value', () => {
    const seen: number[] = []
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, INTERVAL_MS), {
      initialProps: { value: 0 },
    })
    seen.push(result.current)

    // 60 updates over one second, as playback driving `t` every animation frame would produce.
    const inputCount = 60
    for (let i = 1; i <= inputCount; i++) {
      act(() => {
        vi.advanceTimersByTime(1000 / 60)
      })
      rerender({ value: i })
      seen.push(result.current)
    }
    // Flush any trailing commit still pending for the final value.
    act(() => {
      vi.advanceTimersByTime(INTERVAL_MS)
    })
    seen.push(result.current)

    const distinctCommits = new Set(seen).size
    expect(distinctCommits).toBeLessThan(inputCount)
    expect(result.current).toBe(inputCount)
  })

  it('never regresses to an older value than the one already committed', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, INTERVAL_MS), {
      initialProps: { value: 0 },
    })

    const observed: number[] = [result.current]
    for (let i = 1; i <= 20; i++) {
      act(() => {
        vi.advanceTimersByTime(5)
      })
      rerender({ value: i })
      observed.push(result.current)
    }
    act(() => {
      vi.advanceTimersByTime(INTERVAL_MS)
    })
    observed.push(result.current)

    for (let i = 1; i < observed.length; i++) {
      expect(observed[i]).toBeGreaterThanOrEqual(observed[i - 1]!)
    }
  })
})
