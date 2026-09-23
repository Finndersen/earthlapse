// @vitest-environment jsdom
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
  it('settles on the final value once updates stop, even mid-window', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, INTERVAL_MS), {
      initialProps: { value: 0 },
    })

    rerender({ value: 1 })
    act(() => {
      vi.advanceTimersByTime(10)
    })
    rerender({ value: 2 })
    act(() => {
      vi.advanceTimersByTime(10)
    })
    rerender({ value: 3 })

    expect(result.current).toBe(0)

    act(() => {
      vi.advanceTimersByTime(INTERVAL_MS)
    })
    expect(result.current).toBe(3)
  })

  it('passes a discontinuous change through immediately after a quiet period', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, INTERVAL_MS), {
      initialProps: { value: 0 },
    })

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    rerender({ value: 42 })

    expect(result.current).toBe(42)
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

  it('passes every value straight through at an interval of 0', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, 0), {
      initialProps: { value: 0 },
    })

    for (let i = 1; i <= 5; i++) {
      rerender({ value: i })
      expect(result.current).toBe(i)
    }
  })

})
