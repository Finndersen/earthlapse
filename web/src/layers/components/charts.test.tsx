import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SeriesData } from '@/data/curated'
import { createLinearScale } from '@/timeline'
import { EARTH_FORMATION } from '@/types/layer'

import { createScalarLayer } from '../factories'
import { CO2_DATA, CO2_MANIFEST } from '../fixtures'
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

  it('plots a series spanning decades on a log axis, so the 277 -> 427 ppm rise stays visible', () => {
    const data: SeriesData = {
      id: 'co2',
      unit: 'ppm',
      interpolation: 'log-linear',
      samples: [
        { t: 0, value: 427, lower: null, upper: null },
        { t: 275, value: 277, lower: null, upper: null },
        { t: 5e8, value: 7000, lower: null, upper: null },
      ],
    }
    const layer = createScalarLayer(CO2_MANIFEST, data)
    const dotY = (t: number): number => {
      const { container } = render(<Sparkline layer={layer} t={t} scale={FULL_SCALE} />)
      const cy = Number(container.querySelector('circle')?.getAttribute('cy'))
      cleanup()
      return cy
    }
    // The drawable height is 30 viewBox units. A linear axis up to 7,000 ppm separates these
    // two dots by under 1 unit; the log axis separates them by several.
    expect(dotY(275) - dotY(0)).toBeGreaterThan(2)
  })

  it('breaks the line across a declared gap rather than bridging it (ADR-027)', () => {
    const data: SeriesData = {
      id: 'co2',
      unit: 'ppm',
      interpolation: 'log-linear',
      samples: [
        { t: 0, value: 420, lower: null, upper: null },
        { t: 1e9, value: 400, lower: null, upper: null },
        { t: 2e9, value: 300, lower: null, upper: null },
        { t: EARTH_FORMATION, value: 4000, lower: null, upper: null },
      ],
      gaps: [{ fromIndex: 1, toIndex: 2 }],
    }
    const layer = createScalarLayer(CO2_MANIFEST, data)
    const { container } = render(<Sparkline layer={layer} t={0} scale={FULL_SCALE} />)
    // Fully covered domain, no gap: one continuous <polyline>. The 1e9-2e9 gap splits it in two.
    expect(container.querySelectorAll('polyline').length).toBe(2)
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
    // Beyond CO2_MANIFEST.timeDomain's own upper bound (EARTH_FORMATION), not merely CO2_DATA's
    // narrower sample range — the "no record" case below covers that one instead.
    const { container } = render(
      <LayerChart layer={layer} t={EARTH_FORMATION + 1} scale={FULL_SCALE} onClose={() => {}} />,
    )
    expect(container.textContent).toMatch(/no data/)
  })

  it('shows "no record" — not "no data" — in the header inside a declared gap (ADR-027)', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const { container } = render(<LayerChart layer={layer} t={3.2e6} scale={FULL_SCALE} onClose={() => {}} />)
    expect(container.textContent).toMatch(/no record/)
    expect(container.textContent).not.toMatch(/no data/)
  })
})
