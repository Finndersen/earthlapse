import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GLOBE_OVERLAY_KINDS, GLOBE_OVERLAYS, type GlobeOverlayKind } from './overlay'
import { OverlaySelect } from './OverlaySelect'

afterEach(() => {
  cleanup()
})

describe('OverlaySelect', () => {
  it('is a named select offering None plus every available overlay', () => {
    render(<OverlaySelect value={null} onChange={vi.fn()} available={GLOBE_OVERLAY_KINDS} />)
    expect(screen.getByRole('combobox', { name: 'Map overlay' })).toBeTruthy()
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['None', ...GLOBE_OVERLAY_KINDS.map((kind) => GLOBE_OVERLAYS[kind].label)])
    expect(screen.queryByTestId('overlay-ramp-key')).toBeNull()
  })

  it('reports the chosen kind, or null for None', () => {
    const onChange = vi.fn()
    render(<OverlaySelect value="cleared_land" onChange={onChange} available={GLOBE_OVERLAY_KINDS} />)
    fireEvent.change(screen.getByTestId('overlay-select'), { target: { value: 'population_density' } })
    expect(onChange).toHaveBeenLastCalledWith('population_density')
    fireEvent.change(screen.getByTestId('overlay-select'), { target: { value: (screen.getByRole('option', { name: 'None' }) as HTMLOptionElement).value } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('shows the ramp key for a selected overlay unless compact', () => {
    render(<OverlaySelect value="population_density" onChange={vi.fn()} available={GLOBE_OVERLAY_KINDS} />)
    expect(screen.getByTestId('overlay-ramp-key')).toBeTruthy()
    cleanup()
    render(<OverlaySelect value="population_density" onChange={vi.fn()} available={GLOBE_OVERLAY_KINDS} compact />)
    expect(screen.queryByTestId('overlay-ramp-key')).toBeNull()
  })

  it('disables when nothing is available but keeps showing an unavailable current value', () => {
    render(<OverlaySelect value={null} onChange={vi.fn()} available={[]} />)
    expect((screen.getByTestId('overlay-select') as HTMLSelectElement).disabled).toBe(true)
    cleanup()
    const missing: GlobeOverlayKind = 'cleared_land'
    render(<OverlaySelect value={missing} onChange={vi.fn()} available={['population_density']} />)
    expect((screen.getByTestId('overlay-select') as HTMLSelectElement).value).toBe('cleared_land')
  })
})
