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
    compactHint: 'Short hint',
    on: true,
    onChange: vi.fn(),
    visible: true,
    ...overrides,
  }
}

describe('Legend', () => {
  it('renders nothing when every row is out of its data domain', () => {
    const { container } = render(<Legend rows={[row({ visible: false })]} />)
    expect(container.innerHTML).toBe('')
  })

  it("wires the toggle group's aria-describedby to the row's own hint paragraph", () => {
    render(<Legend rows={[row()]} />)
    const group = screen.getByRole('group')
    const describedById = group.getAttribute('aria-describedby')
    expect(describedById).toBeTruthy()
    expect(document.getElementById(describedById!)?.textContent).toBe('Full hint text with a caveat.')
  })

  it('redirects focus back to the legend container when the focused row disappears', () => {
    const { rerender } = render(<Legend rows={[row({ id: 'a' }), row({ id: 'b', label: 'Human arrivals' })]} />)
    const onButtons = screen.getAllByRole('button', { name: 'On' })
    onButtons[0]!.focus()
    expect(document.activeElement).toBe(onButtons[0]);

    // Row "a" leaves the domain — its own buttons are unmounted out from under the focused
    // element, same as `t` crossing a data-domain edge in `Globe.tsx`.
    rerender(<Legend rows={[row({ id: 'a', visible: false }), row({ id: 'b', label: 'Human arrivals' })]} />)

    const container = screen.getByRole('group', { name: 'Human arrivals' }).closest('[tabindex="-1"]')
    expect(container).not.toBeNull()
    expect(document.activeElement).toBe(container)
  })

  it('does not steal focus when a row disappears while focus was already elsewhere', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    const { rerender } = render(<Legend rows={[row({ id: 'a' })]} />)
    expect(document.activeElement).toBe(outside)

    rerender(<Legend rows={[row({ id: 'a', visible: false })]} />)
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it("renders a row's footer inside the row, in the default layout", () => {
    render(<Legend rows={[row({ footer: <div data-testid="ramp-key">key</div> })]} />)
    expect(screen.getByTestId('ramp-key')).toBeTruthy()
  })

  it("omits a row's footer in the compact layout", () => {
    render(<Legend rows={[row({ footer: <div data-testid="ramp-key">key</div> })]} compact />)
    expect(screen.queryByTestId('ramp-key')).toBeNull()
  })

  it('keeps the compact hint readable by a screen reader while showing no hint text', () => {
    render(<Legend rows={[row({ hint: 'full hint', compactHint: 'short hint' })]} compact />)
    const group = screen.getByRole('group')
    const describedBy = group.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('short hint')
  })

  it('renders nothing extra for a row with no footer', () => {
    const { container } = render(<Legend rows={[row()]} />)
    expect(container.querySelector('[data-testid="ramp-key"]')).toBeNull()
  })
})
