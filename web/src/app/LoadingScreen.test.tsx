import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LoadingScreen } from './LoadingScreen'

afterEach(() => {
  cleanup()
})

describe('LoadingScreen', () => {
  it('shows the title and a determinate progress bar', () => {
    render(<LoadingScreen progress={0.42} />)

    expect(screen.getByText('Earthlapse')).toBeTruthy()
    const bar = screen.getByRole('progressbar', { name: 'Loading' })
    expect(bar.getAttribute('aria-valuenow')).toBe('42')
    expect(screen.getByTestId('loading-progress').style.transform).toBe('scaleX(0.42)')
  })

  it('clamps progress to the bar', () => {
    render(<LoadingScreen progress={1.7} />)

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
    expect(screen.getByTestId('loading-progress').style.transform).toBe('scaleX(1)')
  })
})
