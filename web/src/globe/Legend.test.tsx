import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Legend, type LegendRow } from './Legend'

afterEach(() => {
  cleanup()
})

function row(overrides: Partial<LegendRow> = {}): LegendRow {
  return {
    id: 'cleared-land',
    label: 'Cleared land',
    hint: 'Full hint text with a caveat.',
    on: true,
    onChange: vi.fn(),
    visible: true,
    ...overrides,
  }
}

describe('Legend', () => {
  it('renders nothing when every row is out of its data domain', () => {
    expect(render(<Legend rows={[row({ visible: false })]} />).container.innerHTML).toBe('')
  })

  it('describes each toggle group by its hint and renders its footer', () => {
    render(<Legend rows={[row({ footer: <div data-testid="ramp-key">key</div> })]} />)
    const describedBy = screen.getByRole('group', { name: 'Cleared land' }).getAttribute('aria-describedby')
    expect(document.getElementById(describedBy!)?.textContent).toBe('Full hint text with a caveat.')
    expect(screen.getByTestId('ramp-key')).toBeTruthy()
  })

  it('moves focus to the legend when the focused row disappears, never stealing it otherwise', () => {
    const rows = (aVisible: boolean) => [row({ id: 'a', visible: aVisible }), row({ id: 'b', label: 'Human arrivals' })]
    const { rerender } = render(<Legend rows={rows(true)} />)
    screen.getAllByRole('button', { name: 'On' })[0]!.focus()
    rerender(<Legend rows={rows(false)} />)
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Human arrivals' }).closest('[tabindex="-1"]'))
    cleanup()

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const second = render(<Legend rows={rows(true)} />)
    second.rerender(<Legend rows={rows(false)} />)
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})
