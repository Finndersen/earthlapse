import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SoundToggle } from './toggle'

afterEach(cleanup)

function renderToggle(enabled: boolean, active = enabled, setEnabled = vi.fn(), setMasterVolume = vi.fn()) {
  const utils = render(<SoundToggle enabled={enabled} active={active} masterVolume={0.5} setEnabled={setEnabled} setMasterVolume={setMasterVolume} />)
  return { ...utils, setEnabled, setMasterVolume }
}

describe('SoundToggle', () => {
  it('toggles the preference from the speaker button', () => {
    const { setEnabled } = renderToggle(false)
    fireEvent.click(screen.getByRole('button', { name: 'Play ambience and score (M)' }))
    expect(setEnabled).toHaveBeenCalledWith(true)
  })

  it('keeps one volume slider mounted, hidden and untabbable while muted', () => {
    const { rerender, setMasterVolume } = renderToggle(false)
    const before = screen.getByLabelText('Master volume')
    expect(before.getAttribute('aria-hidden')).toBe('true')
    expect(before.getAttribute('tabindex')).toBe('-1')
    rerender(<SoundToggle enabled active masterVolume={0.5} setEnabled={vi.fn()} setMasterVolume={setMasterVolume} />)
    expect(screen.getByLabelText('Master volume')).toBe(before)
    expect(before.getAttribute('tabindex')).toBe('0')
    fireEvent.change(before, { target: { value: '0.8' } })
    expect(setMasterVolume).toHaveBeenCalledWith(0.8)
  })

  it('labels a pending start differently from audible sound, while still allowing mute', () => {
    const { setEnabled } = renderToggle(true, false)
    expect(screen.queryByRole('button', { name: 'Mute ambience and score (M)' })).toBeNull()
    const pending = screen.getByRole('button', { name: 'Sound on — starts on your next click or key press (M)' })
    expect(pending.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(pending)
    expect(setEnabled).toHaveBeenCalledWith(false)
    cleanup()
    renderToggle(true, true)
    expect(screen.getByRole('button', { name: 'Mute ambience and score (M)' })).toBeTruthy()
  })
})
