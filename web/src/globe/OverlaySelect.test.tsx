import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GLOBE_OVERLAY_KINDS, GLOBE_OVERLAYS, type GlobeOverlayKind } from './overlay'
import { OverlaySelect } from './OverlaySelect'

afterEach(() => {
  cleanup()
})

describe('OverlaySelect', () => {
  it('renders one option per available kind plus None, in registry order, with the spec labels', () => {
    render(<OverlaySelect value={null} onChange={vi.fn()} available={GLOBE_OVERLAY_KINDS} />)
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((o) => o.textContent)).toEqual([
      'None',
      ...GLOBE_OVERLAY_KINDS.map((kind) => GLOBE_OVERLAYS[kind].label),
    ])
  })

  it('calls onChange with the selected overlay kind', () => {
    const onChange = vi.fn()
    render(<OverlaySelect value={null} onChange={onChange} available={GLOBE_OVERLAY_KINDS} />)
    fireEvent.change(screen.getByTestId('overlay-select'), { target: { value: 'cleared_land' } })
    expect(onChange).toHaveBeenCalledWith('cleared_land')
  })

  it('calls onChange with null when None is selected', () => {
    const onChange = vi.fn()
    render(<OverlaySelect value="cleared_land" onChange={onChange} available={GLOBE_OVERLAY_KINDS} />)
    const noneValue = (screen.getByRole('option', { name: 'None' }) as HTMLOptionElement).value
    fireEvent.change(screen.getByTestId('overlay-select'), { target: { value: noneValue } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('is reachable by its accessible name "Map overlay"', () => {
    render(<OverlaySelect value={null} onChange={vi.fn()} available={GLOBE_OVERLAY_KINDS} />)
    expect(screen.getByRole('combobox', { name: 'Map overlay' })).toBeTruthy()
  })

  it('renders no ramp key and no swatch when value is null', () => {
    const { container } = render(<OverlaySelect value={null} onChange={vi.fn()} available={GLOBE_OVERLAY_KINDS} />)
    expect(screen.queryByTestId('overlay-ramp-key')).toBeNull()
    expect(container.querySelector('[class*="swatch"]')).toBeNull()
  })

  it('renders the ramp key and a swatch when value is set', () => {
    const { container } = render(
      <OverlaySelect value="population_density" onChange={vi.fn()} available={GLOBE_OVERLAY_KINDS} />,
    )
    expect(screen.getByTestId('overlay-ramp-key')).toBeTruthy()
    expect(container.querySelector('[class*="swatch"]')).toBeTruthy()
  })

  it('omits the ramp key when compact, even with a value set', () => {
    render(<OverlaySelect value="population_density" onChange={vi.fn()} available={GLOBE_OVERLAY_KINDS} compact />)
    expect(screen.queryByTestId('overlay-ramp-key')).toBeNull()
  })

  it('disables the select when available is empty', () => {
    render(<OverlaySelect value={null} onChange={vi.fn()} available={[]} />)
    expect((screen.getByTestId('overlay-select') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['None'])
  })

  it('still shows a value that is not present in available as the selected option', () => {
    const missingKind: GlobeOverlayKind = 'cleared_land'
    render(<OverlaySelect value={missingKind} onChange={vi.fn()} available={['population_density']} />)
    const select = screen.getByTestId('overlay-select') as HTMLSelectElement
    expect(select.value).toBe('cleared_land')
    expect(screen.getByRole('option', { name: GLOBE_OVERLAYS.cleared_land.label })).toBeTruthy()
  })
})
