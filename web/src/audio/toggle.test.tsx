import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SoundToggle } from './toggle'

afterEach(cleanup)

function renderToggle(enabled: boolean, setEnabled = vi.fn(), setMasterVolume = vi.fn()) {
  const utils = render(<SoundToggle enabled={enabled} masterVolume={0.5} setEnabled={setEnabled} setMasterVolume={setMasterVolume} />)
  return { ...utils, setEnabled, setMasterVolume }
}

describe('SoundToggle', () => {
  it('renders the volume slider even while muted, hidden rather than unmounted (re-review fix, 2026-09-15)', () => {
    renderToggle(false)
    const volume = screen.getByLabelText('Master volume')
    expect(volume).toBeTruthy()
    expect(volume.getAttribute('data-visible')).toBe('false')
    expect(volume.getAttribute('aria-hidden')).toBe('true')
    expect(volume.getAttribute('tabindex')).toBe('-1')
  })

  it('keeps the same slider element mounted (not remounted) when sound is toggled on', () => {
    const setEnabled = vi.fn()
    const { rerender } = render(<SoundToggle enabled={false} masterVolume={0.5} setEnabled={setEnabled} setMasterVolume={vi.fn()} />)
    const before = screen.getByLabelText('Master volume')
    rerender(<SoundToggle enabled masterVolume={0.5} setEnabled={setEnabled} setMasterVolume={vi.fn()} />)
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
})
