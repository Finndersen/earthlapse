import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DRAG_PX_PER_DETENT, RateScroller, WHEEL_PX_PER_DETENT, type RateDetent } from './RateScroller'

afterEach(cleanup)

const DETENTS: RateDetent[] = [1, 2, 5, 10, 20, 50, 100].map((value) => ({
  value,
  label: String(value),
  valueText: `${value} years per second`,
}))

function renderScroller(index = 3) {
  const onChange = vi.fn()
  const { rerender } = render(
    <RateScroller detents={DETENTS} index={index} onChange={onChange} label="Playback rate" caption="yr/s" />,
  )
  return { onChange, rerender, picker: screen.getByRole('spinbutton', { name: 'Playback rate' }) }
}

/** jsdom has no layout: give the picker a 43px-tall box at y = 100. */
function stubRect(el: HTMLElement): void {
  el.getBoundingClientRect = () => ({ top: 100, bottom: 143, left: 0, right: 46, width: 46, height: 43, x: 0, y: 100, toJSON: () => ({}) })
}

describe('RateScroller: accessibility', () => {
  it('is a focusable spinbutton exposing the selected value, its text and the range', () => {
    const { picker } = renderScroller(3)
    expect(picker.tabIndex).toBe(0)
    expect(picker.getAttribute('aria-valuenow')).toBe('10')
    expect(picker.getAttribute('aria-valuetext')).toBe('10 years per second')
    expect(picker.getAttribute('aria-valuemin')).toBe('1')
    expect(picker.getAttribute('aria-valuemax')).toBe('100')
  })

  it('shows the caption and marks only the selected row', () => {
    renderScroller(3)
    expect(screen.getByText('yr/s')).toBeTruthy()
    expect(screen.getByText('10').getAttribute('data-selected')).toBe('true')
    expect(screen.getByText('20').getAttribute('data-selected')).toBe('false')
  })
})

describe('RateScroller: keyboard', () => {
  it.each([
    ['ArrowUp', 4],
    ['ArrowDown', 2],
    ['PageUp', 6],
    ['PageDown', 0],
    ['End', 6],
    ['Home', 0],
  ])('%s moves to detent %i', (key, expected) => {
    const { picker, onChange } = renderScroller(3)
    fireEvent.keyDown(picker, { key })
    expect(onChange).toHaveBeenCalledWith(expected)
  })

  it('does not report a change at either end', () => {
    const top = renderScroller(6)
    fireEvent.keyDown(top.picker, { key: 'ArrowUp' })
    expect(top.onChange).not.toHaveBeenCalled()
    cleanup()
    const bottom = renderScroller(0)
    fireEvent.keyDown(bottom.picker, { key: 'ArrowDown' })
    expect(bottom.onChange).not.toHaveBeenCalled()
  })

  it('stops the keys it handles from reaching the surrounding shortcuts, and lets others through', () => {
    const outer = vi.fn()
    const onChange = vi.fn()
    render(
      <div onKeyDown={outer}>
        <RateScroller detents={DETENTS} index={3} onChange={onChange} label="Playback rate" caption="yr/s" />
      </div>,
    )
    const picker = screen.getByRole('spinbutton')
    fireEvent.keyDown(picker, { key: 'PageUp' })
    fireEvent.keyDown(picker, { key: 'Home' })
    expect(outer).not.toHaveBeenCalled()
    fireEvent.keyDown(picker, { key: ']' })
    expect(outer).toHaveBeenCalledTimes(1)
  })
})

describe('RateScroller: wheel', () => {
  it('steps one detent per mouse notch, scrolling down toward faster', () => {
    const { picker, onChange } = renderScroller(3)
    fireEvent.wheel(picker, { deltaY: 100 })
    expect(onChange).toHaveBeenLastCalledWith(4)
    fireEvent.wheel(picker, { deltaY: -100 })
    expect(onChange).toHaveBeenLastCalledWith(2)
  })

  it('accumulates small trackpad deltas until one detent of travel', () => {
    const { picker, onChange } = renderScroller(3)
    const small = WHEEL_PX_PER_DETENT / 4
    for (let i = 0; i < 3; i++) fireEvent.wheel(picker, { deltaY: small })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.wheel(picker, { deltaY: small })
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('discards accumulated travel when the direction reverses', () => {
    const { picker, onChange } = renderScroller(3)
    fireEvent.wheel(picker, { deltaY: WHEEL_PX_PER_DETENT * 0.75 })
    fireEvent.wheel(picker, { deltaY: -WHEEL_PX_PER_DETENT * 0.5 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('prevents the page from scrolling under it', () => {
    const { picker } = renderScroller(3)
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })
    picker.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('RateScroller: pointer', () => {
  it('commits each detent crossed while dragging up, snapping to whole detents', () => {
    const { picker, onChange } = renderScroller(3)
    fireEvent.pointerDown(picker, { pointerId: 1, button: 0, clientY: 120 })
    fireEvent.pointerMove(picker, { pointerId: 1, clientY: 120 - DRAG_PX_PER_DETENT * 0.4 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerMove(picker, { pointerId: 1, clientY: 120 - DRAG_PX_PER_DETENT * 0.6 })
    expect(onChange).toHaveBeenLastCalledWith(4)
    fireEvent.pointerMove(picker, { pointerId: 1, clientY: 120 - DRAG_PX_PER_DETENT * 2.2 })
    expect(onChange).toHaveBeenLastCalledWith(5)
    fireEvent.pointerUp(picker, { pointerId: 1, clientY: 120 - DRAG_PX_PER_DETENT * 2.2 })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('moves toward slower detents dragging down, clamped at the slowest', () => {
    const { picker, onChange } = renderScroller(1)
    fireEvent.pointerDown(picker, { pointerId: 1, button: 0, clientY: 120 })
    fireEvent.pointerMove(picker, { pointerId: 1, clientY: 120 + DRAG_PX_PER_DETENT * 10 })
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('shows the drum between detents while dragging and settles on release', () => {
    const { picker } = renderScroller(3)
    fireEvent.pointerDown(picker, { pointerId: 1, button: 0, clientY: 120 })
    fireEvent.pointerMove(picker, { pointerId: 1, clientY: 120 - DRAG_PX_PER_DETENT * 0.4 })
    expect(picker.getAttribute('data-dragging')).toBe('true')
    fireEvent.pointerUp(picker, { pointerId: 1 })
    expect(picker.getAttribute('data-dragging')).toBe('false')
  })

  it('steps to the neighbour tapped above or below the centre, and ignores a tap on the centre', () => {
    const { picker, onChange } = renderScroller(3)
    stubRect(picker)
    fireEvent.pointerDown(picker, { pointerId: 1, button: 0, clientY: 105 })
    fireEvent.pointerUp(picker, { pointerId: 1, clientY: 105 })
    expect(onChange).toHaveBeenLastCalledWith(2)
    fireEvent.pointerDown(picker, { pointerId: 2, button: 0, clientY: 140 })
    fireEvent.pointerUp(picker, { pointerId: 2, clientY: 140 })
    expect(onChange).toHaveBeenLastCalledWith(4)
    onChange.mockClear()
    fireEvent.pointerDown(picker, { pointerId: 3, button: 0, clientY: 121 })
    fireEvent.pointerUp(picker, { pointerId: 3, clientY: 121 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('commits nothing more when the gesture is cancelled', () => {
    const { picker, onChange } = renderScroller(3)
    stubRect(picker)
    fireEvent.pointerDown(picker, { pointerId: 1, button: 0, clientY: 105 })
    fireEvent.pointerCancel(picker, { pointerId: 1, clientY: 105 })
    expect(onChange).not.toHaveBeenCalled()
  })
})
