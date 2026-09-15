import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Panel } from './Panel'

afterEach(() => {
  cleanup()
})

function renderPanel(onClose = vi.fn()) {
  const trigger = document.createElement('button')
  trigger.textContent = 'open'
  document.body.appendChild(trigger)
  trigger.focus()

  const utils = render(
    <Panel label="About & credits" onClose={onClose}>
      <button type="button">first</button>
      <button type="button">second</button>
    </Panel>,
  )
  return { ...utils, trigger, onClose }
}

describe('Panel', () => {
  it('moves focus into itself on mount', () => {
    renderPanel()
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('restores focus to the previously-focused element on unmount', () => {
    const { trigger, unmount } = renderPanel()
    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('calls onClose on Escape', () => {
    const { onClose } = renderPanel()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on a click outside the panel surface', () => {
    const { onClose } = renderPanel()
    // The backdrop itself — React's event delegation attaches to the render container, not
    // `document`, so an event fired on an ancestor of that container (e.g. `document.body`)
    // never reaches it; the backdrop is the realistic "outside click" target in production too.
    const backdrop = screen.getByRole('dialog').parentElement!
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose on a click inside the panel surface', () => {
    const { onClose } = renderPanel()
    fireEvent.click(screen.getByText('first'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close (or fall through to whatever is underneath) on a touch tap outside, unlike a pointerdown-driven close (re-review fix)', () => {
    // Regression test for the reported "ghost tap": closing on `pointerdown` let the browser's
    // synthetic `click` that follows a touch tap land on whatever was now underneath the
    // (already-unmounted) backdrop. Closing on `click` itself means there is no separate
    // `pointerdown` for that synthetic click to outrun — the close and the "was this outside"
    // check happen in the same event.
    const { onClose } = renderPanel()
    const backdrop = screen.getByRole('dialog').parentElement!
    fireEvent.pointerDown(backdrop)
    fireEvent.pointerUp(backdrop)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose via the × button', () => {
    const { onClose } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps Tab within its own focusable elements, wrapping last to first', () => {
    renderPanel()
    const close = screen.getByRole('button', { name: 'Close' })
    const second = screen.getByText('second')
    second.focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
    expect(document.activeElement).toBe(close)
  })

  it('traps Shift+Tab within its own focusable elements, wrapping first to last', () => {
    renderPanel()
    const close = screen.getByRole('button', { name: 'Close' })
    const second = screen.getByText('second')
    close.focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(second)
  })

  it('announces exactly one polite "<label> opened" message, held empty at mount so it reads as a genuine change (re-review fix)', async () => {
    renderPanel()
    const live = document.querySelectorAll('[aria-live="polite"]')
    expect(live.length).toBe(1)
    // Empty at mount, not already holding its final text — a live region most screen readers
    // only announce on an actual post-mount change.
    expect(live[0]!.textContent).toBe('')
    await waitFor(() => expect(live[0]!.textContent).toBe('About & credits opened'))
  })

  it('labels the dialog from its title', () => {
    renderPanel()
    const dialog = screen.getByRole('dialog')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).not.toBeNull()
    expect(document.getElementById(labelledBy!)?.textContent).toBe('About & credits')
  })
})
