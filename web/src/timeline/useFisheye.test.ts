/**
 * `useFisheye` wires the pure `fisheye.ts` math to real pointer events and a `requestAnimationFrame`
 * loop (see its own doc comment). These tests exercise that wiring rather than the math itself
 * (covered directly in `fisheye.test.ts`), in particular the reviewer-verified bug where
 * `release()` clearing the last pointer position let a quick leave/re-enter snap a still-visible
 * lens straight to the new pointer position instead of moving it continuously.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FISHEYE_COUPLING_RADIUS_PX } from './fisheye'
import { useFisheye } from './useFisheye'

const TRACK_WIDTH_PX = 1440

// Long enough to run the strength approach (time constant 0.12s) to completion in either
// direction; fake timers make this instant wall-clock time, so there is no cost to being
// generous. Same mocked-rAF approach the rest of this package's tests use (Timeline.test.tsx,
// ScrubTrack.test.tsx, presentedMix.test.ts), but via `vi.useFakeTimers()` — which also mocks
// `requestAnimationFrame`/`performance.now()` — instead of a manual `stubGlobal`, so fades can be
// driven deterministically with `advanceTimersByTime` rather than waiting on the real clock.
const SETTLE_MS = 5000

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useFisheye', () => {
  it('does not snap a still-visible lens on release followed by immediate re-entry', () => {
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
    // Leaves and comes straight back — far too soon for strength (0.12s time constant) to have
    // faded — the quick leave/re-enter the bug report describes.
    act(() => {
      result.current.pointTo(0.9, TRACK_WIDTH_PX)
    })

    // The lens is still fully visible (nothing had time to fade), so a jump here would be a real,
    // visible snap. It must instead land within the ordinary coupling-radius clamp of the new
    // pointer position, exactly as a normal in-track move would.
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
    // This time the lens is given long enough to fully fade before the pointer comes back.
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })
    expect(result.current.lens.strength).toBe(0)

    act(() => {
      result.current.pointTo(0.9, TRACK_WIDTH_PX)
    })

    // Nothing was visible to jump, so reappearing directly under the pointer is the correct,
    // unobservable behaviour — not a bug.
    expect(result.current.lens.centreU).toBe(0.9)
  })

  it('never moves the lens for repeated pointTo calls at the same u', () => {
    const { result } = renderHook(() => useFisheye())

    act(() => {
      result.current.pointTo(0.5, TRACK_WIDTH_PX)
    })
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })
    const settledCentreU = result.current.lens.centreU

    for (let i = 0; i < 20; i++) {
      act(() => {
        result.current.pointTo(0.5, TRACK_WIDTH_PX)
      })
    }

    expect(result.current.lens.centreU).toBe(settledCentreU)
  })

  it('stops scheduling animation frames once strength has settled', () => {
    const { result } = renderHook(() => useFisheye())

    act(() => {
      result.current.pointTo(0.3, TRACK_WIDTH_PX)
    })
    // The fade-in itself needs at least one more frame.
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })
    expect(result.current.lens.strength).toBe(1)
    // Settled at full strength with the pointer still present: no reason for the loop to keep
    // scheduling frames.
    expect(vi.getTimerCount()).toBe(0)

    act(() => {
      result.current.release()
    })
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })
    expect(result.current.lens.strength).toBe(0)
    // Settled at rest with the pointer gone: likewise nothing left to animate.
    expect(vi.getTimerCount()).toBe(0)
  })
})
