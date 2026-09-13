import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AxisTicks } from './AxisTicks'
import { createSymlogScale, type TimeWindow } from '../scale'

const TRACK_WIDTH = 800

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: TRACK_WIDTH,
    bottom: 16,
    width: TRACK_WIDTH,
    height: 16,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const WINDOW: TimeWindow = [1e6, 1e8]

function renderTicks(window: TimeWindow, onWindowChange = vi.fn()) {
  const scale = createSymlogScale(window)
  const { container } = render(<AxisTicks window={window} scale={scale} scaleKind="symlog" onWindowChange={onWindowChange} />)
  const ruler = container.firstElementChild as Element
  return { ruler, onWindowChange }
}

describe('<AxisTicks> drag-to-pan', () => {
  it('pans the window when the ruler is dragged, calling onWindowChange', () => {
    const { ruler, onWindowChange } = renderTicks(WINDOW)

    fireEvent.pointerDown(ruler, { clientX: 400, pointerId: 1 })
    fireEvent.pointerMove(ruler, { clientX: 460, pointerId: 1 })

    expect(onWindowChange).toHaveBeenCalled()
    const [newest, oldest] = onWindowChange.mock.calls.at(-1)![0] as TimeWindow
    // A drag must actually move the window, not leave it as a no-op.
    expect(newest === WINDOW[0] && oldest === WINDOW[1]).toBe(false)
  })

  it('drags in opposite directions produce opposite-signed pans', () => {
    const rightDrag = renderTicks(WINDOW)
    fireEvent.pointerDown(rightDrag.ruler, { clientX: 400, pointerId: 1 })
    fireEvent.pointerMove(rightDrag.ruler, { clientX: 460, pointerId: 1 })
    const rightResult = rightDrag.onWindowChange.mock.calls.at(-1)![0] as TimeWindow

    const leftDrag = renderTicks(WINDOW)
    fireEvent.pointerDown(leftDrag.ruler, { clientX: 400, pointerId: 1 })
    fireEvent.pointerMove(leftDrag.ruler, { clientX: 340, pointerId: 1 })
    const leftResult = leftDrag.onWindowChange.mock.calls.at(-1)![0] as TimeWindow

    const rightDelta = rightResult[0] - WINDOW[0]
    const leftDelta = leftResult[0] - WINDOW[0]
    expect(Math.sign(rightDelta)).not.toBe(Math.sign(leftDelta))
  })

  it('keeps the span constant across a drag pan', () => {
    const { ruler, onWindowChange } = renderTicks(WINDOW)
    const span = WINDOW[1] - WINDOW[0]

    fireEvent.pointerDown(ruler, { clientX: 400, pointerId: 1 })
    fireEvent.pointerMove(ruler, { clientX: 460, pointerId: 1 })

    const [newest, oldest] = onWindowChange.mock.calls.at(-1)![0] as TimeWindow
    expect(oldest - newest).toBeCloseTo(span, 3)
  })

  it('ignores pointer move events from a pointer that never pressed down', () => {
    const { ruler, onWindowChange } = renderTicks(WINDOW)
    fireEvent.pointerMove(ruler, { clientX: 460, pointerId: 1 })
    expect(onWindowChange).not.toHaveBeenCalled()
  })

  it('stops panning after pointer up', () => {
    const { ruler, onWindowChange } = renderTicks(WINDOW)
    fireEvent.pointerDown(ruler, { clientX: 400, pointerId: 1 })
    fireEvent.pointerMove(ruler, { clientX: 460, pointerId: 1 })
    fireEvent.pointerUp(ruler, { clientX: 460, pointerId: 1 })
    onWindowChange.mockClear()
    fireEvent.pointerMove(ruler, { clientX: 520, pointerId: 1 })
    expect(onWindowChange).not.toHaveBeenCalled()
  })
})
