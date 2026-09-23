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
  it('is a dialog labelled by its title that takes focus and restores it on unmount', () => {
    const { trigger, unmount } = renderPanel()
    const dialog = screen.getByRole('dialog')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('About & credits')
    expect(dialog.contains(document.activeElement)).toBe(true)
    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('closes on Escape and the Close button', () => {
    const { onClose } = renderPanel()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes on an outside click, never on the pointerdown before it or a click inside', () => {
    const { onClose } = renderPanel()
    const backdrop = screen.getByRole('dialog').parentElement!
    fireEvent.click(screen.getByText('first'))
    fireEvent.pointerDown(backdrop)
    fireEvent.pointerUp(backdrop)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps Tab within itself', () => {
    renderPanel()
    screen.getByText('second').focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it('announces "<label> opened" once, as a change after mount', async () => {
    renderPanel()
    const live = document.querySelectorAll('[aria-live="polite"]')
    expect(live).toHaveLength(1)
    expect(live[0]!.textContent).toBe('')
    await waitFor(() => expect(live[0]!.textContent).toBe('About & credits opened'))
  })
})
