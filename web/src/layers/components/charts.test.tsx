import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SeriesData } from '@/data/curated'
import { createLinearScale } from '@/timeline'
import { EARTH_FORMATION } from '@/types/layer'

import { createScalarLayer } from '../factories'
import { CO2_DATA, CO2_MANIFEST, POPULATION_DATA, POPULATION_MANIFEST } from '../fixtures'
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

  // 2026-09-18 re-review: the population sparkline was reading as barely more than a dot.
  // Root cause — sampling directly against the *passed* `scale`'s own domain (here, `FULL_SCALE`,
  // spanning all 4.6 Gyr) starves a narrow-domain layer: population's real 12,015-year domain is
  // under 6% of that span, so a uniform 97-point sample grid across the full span only ever put
  // ~5 points inside it. The fix windows sampling to `layer.timeDomain` instead (see
  // `Sparkline.tsx`'s own doc comment) — these tests assert the drawn trace actually reflects
  // that, not just that `scale.domain` is technically wider than the layer's.
  function points(container: HTMLElement): string {
    return container.querySelector('polyline')?.getAttribute('points') ?? ''
  }
  function pointCount(container: HTMLElement): number {
    const raw = points(container).trim()
    return raw === '' ? 0 : raw.split(' ').length
  }
  function firstX(container: HTMLElement): number {
    return Number(points(container).split(' ')[0]?.split(',')[0])
  }
  function lastX(container: HTMLElement): number {
    const parts = points(container).trim().split(' ')
    return Number(parts[parts.length - 1]?.split(',')[0])
  }

  it("windows sampling to the layer's own domain, not the much wider scale passed in", () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    // FULL_SCALE spans the whole 4.6 Gyr domain — population's own domain is a sliver of it.
    const { container } = render(<Sparkline layer={layer} t={2025} scale={FULL_SCALE} />)
    // Before the fix this was ~5 of 97 samples, all bunched in the last few view-box units.
    expect(pointCount(container)).toBeGreaterThan(80)
    // The trace should span close to the sparkline's own full width (PAD=3, VIEW_WIDTH=200),
    // not a sliver pinned to one edge.
    expect(firstX(container)).toBeLessThan(10)
    expect(lastX(container)).toBeGreaterThan(190)
  })

  it("still shows CO2's trace across its own real published domain (570 Myr), not the full 4.6 Gyr one", () => {
    // Unlike the fixture manifest (which defaults to the full domain), the real published CO2
    // layer's own timeDomain is [0, 5.7e8] — 84% of FULL_SCALE's own warped width, not all of it.
    const realCo2Manifest = { ...CO2_MANIFEST, timeDomain: [0, 5.7e8] as [number, number] }
    const layer = createScalarLayer(realCo2Manifest, CO2_DATA)
    const { container } = render(<Sparkline layer={layer} t={1e8} scale={FULL_SCALE} />)
    expect(firstX(container)).toBeLessThan(10)
    expect(lastX(container)).toBeGreaterThan(190)
  })

  it('clamps the playhead to the domain edge when `t` sits outside it, rather than off-screen', () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    // Deep in the Precambrian — nowhere near population's [10, 12025] domain.
    const { container } = render(<Sparkline layer={layer} t={1e9} scale={FULL_SCALE} />)
    const playhead = container.querySelector('line')
    // PAD=3: the near edge of the plot, not clamped to some arbitrary interior position.
    expect(Number(playhead?.getAttribute('x1'))).toBeCloseTo(3, 0)
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

  it('plots a wide-range series (population, ~1,600x) on a log axis, labelled so the shape is never misread', () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    const populationScale = createLinearScale(POPULATION_MANIFEST.timeDomain)
    const { container, getByRole } = render(
      <LayerChart layer={layer} t={2025} scale={populationScale} onClose={() => {}} />,
    )
    expect(container.textContent).toMatch(/log scale/)
    expect(getByRole('img', { name: /log scale/ })).not.toBeNull()
  })

  it('plots a narrow-range series (a flat, near-constant temperature) on a linear axis, unlabelled', () => {
    const flatData: SeriesData = {
      id: 'temperature',
      unit: '°C',
      interpolation: 'linear',
      samples: [
        { t: 0, value: 14.9, lower: null, upper: null },
        { t: 1e6, value: 15.1, lower: null, upper: null },
      ],
    }
    const layer = createScalarLayer({ ...CO2_MANIFEST, id: 'temperature', unit: '°C' }, flatData)
    const { container } = render(<LayerChart layer={layer} t={0} scale={FULL_SCALE} onClose={() => {}} />)
    expect(container.textContent).not.toMatch(/log scale/)
  })

  it("keeps the printed axis min/max in raw units even on a log axis — never log(value)", () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    const populationScale = createLinearScale(POPULATION_MANIFEST.timeDomain)
    const { container } = render(<LayerChart layer={layer} t={10} scale={populationScale} onClose={() => {}} />)
    // POPULATION_DATA's real max, formatted the same way ScalarReadout formats it.
    expect(container.textContent).toMatch(/7\.3 billion/)
  })
})
