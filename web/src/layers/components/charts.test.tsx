import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createLinearScale } from '@/timeline'
import { EARTH_FORMATION } from '@/types/layer'

import { createScalarLayer } from '../factories'
import { CO2_DATA, CO2_MANIFEST, DAY_LENGTH_DATA, DAY_LENGTH_MANIFEST } from '../fixtures'
import { DayLengthClock } from './DayLengthClock'
import { LayerChart } from './LayerChart'
import { Sparkline } from './Sparkline'

afterEach(cleanup)

const FULL_SCALE = createLinearScale([0, EARTH_FORMATION])

describe('<Sparkline>', () => {
  it('renders without throwing across a domain narrower than the scale, and marks the playhead', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const { container } = render(<Sparkline layer={layer} t={1e8} scale={FULL_SCALE} />)
    expect(container.querySelector('svg')).not.toBeNull()
    // A playhead line is always drawn, even where the layer itself has no data at every
    // sampled point in view (the absent region is simply not traced by a <polyline>).
    expect(container.querySelector('line')).not.toBeNull()
  })
})

describe('<LayerChart>', () => {
  it('renders the plot with its uncertainty band straight away — no second toggle', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const { container } = render(<LayerChart layer={layer} t={1e8} scale={FULL_SCALE} onClose={() => {}} />)
    expect(container.querySelector('svg')).not.toBeNull()
    // One area wash per traced segment; any polygon beyond those is the uncertainty band.
    expect(container.querySelectorAll('polygon').length).toBeGreaterThan(container.querySelectorAll('polyline').length)
  })

  it('closes through its own close button', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const onClose = vi.fn()
    const { getByRole } = render(<LayerChart layer={layer} t={1e8} scale={FULL_SCALE} onClose={onClose} />)
    fireEvent.click(getByRole('button', { name: `Close ${CO2_MANIFEST.name} chart` }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape while mounted', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const onClose = vi.fn()
    render(<LayerChart layer={layer} t={1e8} scale={FULL_SCALE} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops listening for Escape once unmounted', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const onClose = vi.fn()
    const { unmount } = render(<LayerChart layer={layer} t={1e8} scale={FULL_SCALE} onClose={onClose} />)
    unmount()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores keys other than Escape', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const onClose = vi.fn()
    render(<LayerChart layer={layer} t={1e8} scale={FULL_SCALE} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows "no data" in the header when the playhead sits outside the layer domain', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const { container } = render(<LayerChart layer={layer} t={6e8} scale={FULL_SCALE} onClose={() => {}} />)
    expect(container.textContent).toMatch(/no data/)
  })
})

describe('<DayLengthClock>', () => {
  it('renders the clock face and the numeric reading', () => {
    const layer = createScalarLayer(DAY_LENGTH_MANIFEST, DAY_LENGTH_DATA)
    const { container } = render(<DayLengthClock layer={layer} t={1.4e9} />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toMatch(/21\.9/)
    expect(container.textContent).toMatch(/h/)
  })

  it('renders "no data" outside the layer domain', () => {
    const layer = createScalarLayer(DAY_LENGTH_MANIFEST, DAY_LENGTH_DATA)
    const { container } = render(<DayLengthClock layer={layer} t={6e9} />)
    expect(container.textContent).toBe(`${DAY_LENGTH_MANIFEST.name} no data`)
  })
})
