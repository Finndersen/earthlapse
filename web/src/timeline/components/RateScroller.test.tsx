import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DRAG_PX_PER_DETENT, RateScroller, WHEEL_PX_PER_DETENT, type RateDetent } from './RateScroller'

afterEach(cleanup)

const DETENTS: RateDetent[] = [1, 2, 5, 10, 20, 50, 100].map((value) => ({ value, label: String(value), valueText: `${value} years per second` }))

describe('RateScroller', () => {
  it('steps by key, wheel and drag, keeping the keys it handles from the surrounding shortcuts', () => {
    const outer = vi.fn()
    const onChange = vi.fn()
    render(
      <div onKeyDown={outer}>
        <RateScroller detents={DETENTS} index={3} onChange={onChange} label="Playback rate" caption="yr/s" />
      </div>,
    )
    const picker = screen.getByRole('spinbutton', { name: 'Playback rate' })
    expect(picker.getAttribute('aria-valuetext')).toBe('10 years per second')

    fireEvent.keyDown(picker, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith(4)
    fireEvent.keyDown(picker, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith(0)
    expect(outer).not.toHaveBeenCalled()
    fireEvent.keyDown(picker, { key: ']' })
    expect(outer).toHaveBeenCalledTimes(1)

    onChange.mockClear()
    for (let i = 0; i < 3; i++) fireEvent.wheel(picker, { deltaY: WHEEL_PX_PER_DETENT / 4 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.wheel(picker, { deltaY: WHEEL_PX_PER_DETENT / 4 })
    expect(onChange).toHaveBeenLastCalledWith(4)

    onChange.mockClear()
    fireEvent.pointerDown(picker, { pointerId: 1, button: 0, clientY: 120 })
    fireEvent.pointerMove(picker, { pointerId: 1, clientY: 120 - DRAG_PX_PER_DETENT * 2.2 })
    fireEvent.pointerUp(picker, { pointerId: 1, clientY: 120 - DRAG_PX_PER_DETENT * 2.2 })
    expect(onChange).toHaveBeenLastCalledWith(5)
  })
})
