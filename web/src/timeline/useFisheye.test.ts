// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FISHEYE_COUPLING_RADIUS_PX } from './fisheye'
import { useFisheye } from './useFisheye'

const TRACK_WIDTH_PX = 1440

// Long enough for the strength fade to settle either way; fake timers drive rAF.
const SETTLE_MS = 5000

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useFisheye', () => {
  it('moves a still-visible lens continuously on a quick leave and re-entry', () => {
    const { result } = renderHook(() => useFisheye())

    act(() => {
      result.current.pointTo(0.2, TRACK_WIDTH_PX)
    })
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })
    expect(result.current.lens.strength).toBe(1)

    act(() => {
      result.current.release()
    })
    act(() => {
      result.current.pointTo(0.9, TRACK_WIDTH_PX)
    })

    expect(result.current.lens.centreU).not.toBe(0.9)
    const offsetFromPointerPx = Math.abs(0.9 - result.current.lens.centreU) * TRACK_WIDTH_PX
    expect(offsetFromPointerPx).toBeLessThanOrEqual(FISHEYE_COUPLING_RADIUS_PX + 1e-6)
  })

  it('snaps directly under the pointer on re-entry once the lens has actually faded', () => {
    const { result } = renderHook(() => useFisheye())

    act(() => {
      result.current.pointTo(0.2, TRACK_WIDTH_PX)
    })
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })
    expect(result.current.lens.strength).toBe(1)

    act(() => {
      result.current.release()
    })
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })
    expect(result.current.lens.strength).toBe(0)

    act(() => {
      result.current.pointTo(0.9, TRACK_WIDTH_PX)
    })

    expect(result.current.lens.centreU).toBe(0.9)
  })

  it('stops scheduling animation frames once strength has settled', () => {
    const { result } = renderHook(() => useFisheye())

    act(() => {
      result.current.pointTo(0.3, TRACK_WIDTH_PX)
    })
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })
    expect(result.current.lens.strength).toBe(1)
    expect(vi.getTimerCount()).toBe(0)

    act(() => {
      result.current.release()
    })
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })
    expect(result.current.lens.strength).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
