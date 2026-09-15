import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TimelineHint } from './TimelineHint'

/** A minimal `MediaQueryList` stand-in — enough for the component's `matchMedia` usage
 *  (`.matches`, `addEventListener('change', ...)`, `removeEventListener`) without pulling in a
 *  full media-query implementation. */
function mockMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('<TimelineHint>', () => {
  it('shows the mouse-oriented wording on a fine pointer (pointer: coarse not matched)', () => {
    mockMatchMedia(false)
    const { getByText } = render(<TimelineHint onDismiss={vi.fn()} />)
    expect(getByText(/hover to spread out close events/)).toBeTruthy()
  })

  it('mentions the era-navigation shortcuts in the mouse wording (follow-up pass item 6)', () => {
    mockMatchMedia(false)
    const { getByText } = render(<TimelineHint onDismiss={vi.fn()} />)
    expect(getByText(/Escape or Backspace up a section/)).toBeTruthy()
    expect(getByText(/Home or 0 for Earth/)).toBeTruthy()
  })

  it('shows touch-appropriate wording once mounted on a coarse pointer', () => {
    mockMatchMedia(true)
    const { getByText } = render(<TimelineHint onDismiss={vi.fn()} />)
    expect(getByText(/press and drag to scrub and magnify/)).toBeTruthy()
  })

  it('renders the mouse wording when matchMedia is unavailable, rather than throwing', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { getByText } = render(<TimelineHint onDismiss={vi.fn()} />)
    expect(getByText(/hover to spread out close events/)).toBeTruthy()
  })

  it('calls onDismiss when the dismiss button is clicked', () => {
    mockMatchMedia(false)
    const onDismiss = vi.fn()
    const { getByRole } = render(<TimelineHint onDismiss={onDismiss} />)
    fireEvent.click(getByRole('button', { name: 'Dismiss hint' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
