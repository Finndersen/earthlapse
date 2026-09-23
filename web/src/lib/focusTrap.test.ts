// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { useFocusTrap } from './focusTrap'

afterEach(cleanup)

/** A minimal host mirroring what `Panel`/`ClusterPopover` each build on this hook: a root div
 *  with two buttons inside, `onKeyDown` wired to the returned handler. */
function TestOverlay({ focusableSelector }: { focusableSelector?: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const handleTab = useFocusTrap(rootRef, { focusableSelector })
  return createElement(
    'div',
    { ref: rootRef, tabIndex: -1, onKeyDown: handleTab, 'data-testid': 'overlay' },
    createElement('button', { type: 'button' }, 'First'),
    createElement('button', { type: 'button' }, 'Last'),
  )
}

describe('useFocusTrap', () => {
  it('moves focus into the root on mount and restores the previously focused element on unmount', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Open'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { unmount } = render(createElement(TestOverlay))
    expect(document.activeElement).toBe(screen.getByTestId('overlay'))

    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('Tab from the last focusable element cycles to the first', () => {
    render(createElement(TestOverlay))
    const last = screen.getByText('Last')
    last.focus()
    fireEvent.keyDown(screen.getByTestId('overlay'), { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByText('First'))
  })

  it('Shift+Tab from the first focusable element (or the root itself) cycles to the last', () => {
    render(createElement(TestOverlay))
    const overlay = screen.getByTestId('overlay')
    const first = screen.getByText('First')
    first.focus()
    fireEvent.keyDown(overlay, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByText('Last'))

    overlay.focus()
    fireEvent.keyDown(overlay, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByText('Last'))
  })

  it('ignores every key other than Tab', () => {
    render(createElement(TestOverlay))
    const overlay = screen.getByTestId('overlay')
    const first = screen.getByText('First')
    first.focus()
    fireEvent.keyDown(overlay, { key: 'Escape' })
    expect(document.activeElement).toBe(first)
  })

  it('honours a narrower focusableSelector (ClusterPopover-style: buttons only)', () => {
    render(createElement(TestOverlay, { focusableSelector: 'button' }))
    expect(document.activeElement).toBe(screen.getByTestId('overlay'))
  })
})
