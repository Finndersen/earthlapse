import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SoundToggle } from './toggle'

afterEach(cleanup)

function renderToggle(enabled: boolean, active = enabled, setEnabled = vi.fn(), setMasterVolume = vi.fn()) {
  const utils = render(<SoundToggle enabled={enabled} active={active} masterVolume={0.5} setEnabled={setEnabled} setMasterVolume={setMasterVolume} />)
  return { ...utils, setEnabled, setMasterVolume }
}

describe('SoundToggle', () => {
  it('renders the volume slider even while muted, hidden rather than unmounted', () => {
    renderToggle(false)
    const volume = screen.getByLabelText('Master volume')
    expect(volume).toBeTruthy()
    expect(volume.getAttribute('data-visible')).toBe('false')
    expect(volume.getAttribute('aria-hidden')).toBe('true')
    expect(volume.getAttribute('tabindex')).toBe('-1')
  })

  it('keeps the same slider element mounted (not remounted) when sound is toggled on', () => {
    const setEnabled = vi.fn()
    const { rerender } = render(<SoundToggle enabled={false} active={false} masterVolume={0.5} setEnabled={setEnabled} setMasterVolume={vi.fn()} />)
    const before = screen.getByLabelText('Master volume')
    rerender(<SoundToggle enabled active masterVolume={0.5} setEnabled={setEnabled} setMasterVolume={vi.fn()} />)
    const after = screen.getByLabelText('Master volume')
    expect(after).toBe(before)
    expect(after.getAttribute('data-visible')).toBe('true')
    expect(after.getAttribute('aria-hidden')).toBe('false')
    expect(after.getAttribute('tabindex')).toBe('0')
  })

  it('toggles enabled via the speaker button', () => {
    const { setEnabled } = renderToggle(false)
    fireEvent.click(screen.getByRole('button', { name: 'Play ambience and score (M)' }))
    expect(setEnabled).toHaveBeenCalledWith(true)
  })

  it('changes master volume via the slider while enabled', () => {
    const { setMasterVolume } = renderToggle(true)
    fireEvent.change(screen.getByLabelText('Master volume'), { target: { value: '0.8' } })
    expect(setMasterVolume).toHaveBeenCalledWith(0.8)
  })

  describe('enabled but not yet active (waiting on the browser autoplay gesture)', () => {
    it('never renders the same label/state as genuinely-playing sound', () => {
      renderToggle(true, false)
      expect(screen.queryByRole('button', { name: 'Mute ambience and score (M)' })).toBeNull()
      const button = screen.getByRole('button', { name: 'Sound on — starts on your next click or key press (M)' })
      expect(button.getAttribute('title')).toBe('Sound on — starting…')
      expect(button.getAttribute('data-pending')).toBe('true')
      // `aria-pressed` still tracks the stored preference (the button controls that), not
      // whether sound happens to be audible this instant.
      expect(button.getAttribute('aria-pressed')).toBe('true')
    })

    it('still lets a click mute the preference', () => {
      const { setEnabled } = renderToggle(true, false)
      fireEvent.click(screen.getByRole('button', { name: 'Sound on — starts on your next click or key press (M)' }))
      expect(setEnabled).toHaveBeenCalledWith(false)
    })
  })

  it('renders the genuinely-active label once the context has actually started', () => {
    renderToggle(true, true)
    const button = screen.getByRole('button', { name: 'Mute ambience and score (M)' })
    expect(button.getAttribute('data-pending')).toBe('false')
  })
})
