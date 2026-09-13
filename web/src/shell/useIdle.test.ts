import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useIdle } from './useIdle'

const TIMEOUT_MS = 3000

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderIdle(armed: boolean) {
  return renderHook(({ armed: a }) => useIdle({ armed: a, timeoutMs: TIMEOUT_MS }), { initialProps: { armed } })
}

describe('useIdle', () => {
  it('reports idle only once the full timeout has passed without activity', () => {
    const { result } = renderIdle(true)
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS - 1)
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(true)
  })

  it.each([
    ['pointermove', () => fireEvent.pointerMove(window)],
    ['keydown', () => fireEvent.keyDown(window, { key: 'a' })],
    ['touchstart', () => fireEvent.touchStart(window)],
    ['wheel', () => fireEvent.wheel(window)],
  ])('restores immediately on %s and restarts the countdown', (_name, fire) => {
    const { result } = renderIdle(true)
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS)
    })
    expect(result.current).toBe(true)

    act(() => {
      fire()
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS - 1)
    })
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(true)
  })

  it('counts activity inside an element that stops propagation', () => {
    const { result } = renderIdle(true)
    const target = document.createElement('div')
    target.addEventListener('pointermove', (e) => e.stopPropagation())
    document.body.appendChild(target)
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS)
    })

    act(() => {
      fireEvent.pointerMove(target)
    })
    expect(result.current).toBe(false)
    target.remove()
  })

  it('never reports idle while disarmed, and resets when disarmed', () => {
    const { result, rerender } = renderIdle(false)
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS * 3)
    })
    expect(result.current).toBe(false)

    rerender({ armed: true })
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS)
    })
    expect(result.current).toBe(true)

    rerender({ armed: false })
    expect(result.current).toBe(false)

    rerender({ armed: true })
    expect(result.current).toBe(false)
  })
})
