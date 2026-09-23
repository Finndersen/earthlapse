import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LoadingScreen } from './LoadingScreen'

afterEach(() => {
  cleanup()
})

describe('LoadingScreen', () => {
  it('shows a labelled progress bar, clamped to 100', () => {
    const { rerender } = render(<LoadingScreen progress={0.42} />)
    expect(screen.getByRole('progressbar', { name: 'Loading' }).getAttribute('aria-valuenow')).toBe('42')
    rerender(<LoadingScreen progress={1.7} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  })
})
