import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { EVENT_TAG_PALETTE } from '../tagPalette'
import { EventTagLegend } from './EventTagLegend'

afterEach(() => {
  cleanup()
})

/** jsdom normalises an inline hex colour to `rgb(...)` on readback. */
function asRgb(hex: string): string {
  const [r, g, b] = hex
    .replace('#', '')
    .match(/.{2}/g)!
    .map((h) => parseInt(h, 16))
  return `rgb(${r}, ${g}, ${b})`
}

describe('EventTagLegend', () => {
  it('lists every tag in EVENT_TAG_PALETTE, in order, with its own colour', () => {
    const { getAllByRole } = render(<EventTagLegend />)
    const items = getAllByRole('listitem')
    const entries = Object.entries(EVENT_TAG_PALETTE)
    expect(items).toHaveLength(entries.length)
    entries.forEach(([, style], i) => {
      expect(items[i]!.textContent).toBe(style.label)
      const dot = items[i]!.querySelector<HTMLElement>('span')
      expect(dot?.style.background).toBe(asRgb(style.color))
    })
  })
})
