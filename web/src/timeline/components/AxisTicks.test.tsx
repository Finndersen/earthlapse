import { cleanup, render } from '@testing-library/react'
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
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const WINDOW: TimeWindow = [1e6, 1e8]

describe('<AxisTicks>', () => {
  it('renders a labelled span for every tick ticks.ts generates for the window', () => {
    const scale = createSymlogScale(WINDOW)
    const { container } = render(<AxisTicks window={WINDOW} scale={scale} />)
    const labels = Array.from(container.querySelectorAll('span'))
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      expect(label.textContent).toBeTruthy()
      expect(label.style.left).toMatch(/%$/)
    }
  })

  it('re-renders with new ticks when the window changes', () => {
    const scaleA = createSymlogScale(WINDOW)
    const { container, rerender } = render(<AxisTicks window={WINDOW} scale={scaleA} />)
    const before = Array.from(container.querySelectorAll('span')).map((el) => el.textContent)

    const narrower: TimeWindow = [1e6, 2e6]
    rerender(<AxisTicks window={narrower} scale={createSymlogScale(narrower)} />)
    const after = Array.from(container.querySelectorAll('span')).map((el) => el.textContent)
    expect(after).not.toEqual(before)
  })
})
