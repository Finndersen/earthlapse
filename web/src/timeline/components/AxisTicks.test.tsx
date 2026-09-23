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
  it('renders a positioned label for every tick', () => {
    const scale = createSymlogScale(WINDOW)
    const { container } = render(<AxisTicks window={WINDOW} scale={scale} />)
    const labels = Array.from(container.querySelectorAll('span'))
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      expect(label.textContent).toBeTruthy()
      expect(label.style.left).toMatch(/%$/)
    }
  })

})
