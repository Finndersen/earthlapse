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

function xs(polyline: Element | null): number[] {
  const raw = polyline?.getAttribute('points')?.trim() ?? ''
  return raw === '' ? [] : raw.split(' ').map((p) => Number(p.split(',')[0]))
}

function lines(container: HTMLElement): { solid: Element[]; ghost: Element[] } {
  const all = Array.from(container.querySelectorAll('polyline'))
  const isGhost = (el: Element) => el.getAttribute('class')?.includes('Ghost') ?? false
  return { solid: all.filter((el) => !isGhost(el)), ghost: all.filter(isGhost) }
}

describe('<Sparkline>', () => {
  const population = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)

  it('breaks the trace across a declared gap rather than bridging it', () => {
    const data: SeriesData = {
      id: 'co2',
      unit: 'ppm',
      interpolation: 'log-linear',
      samples: [0, 1e9, 2e9, EARTH_FORMATION].map((t, i) => ({ t, value: [420, 400, 300, 4000][i]!, lower: null, upper: null })),
      gaps: [{ fromIndex: 1, toIndex: 2 }],
    }
    const { container } = render(<Sparkline layer={createScalarLayer(CO2_MANIFEST, data)} t={0} scale={FULL_SCALE} />)
    expect(container.querySelectorAll('polyline')).toHaveLength(2)
  })

  it("samples across the layer's own domain, not the much wider scale", () => {
    const { container } = render(<Sparkline layer={population} t={10} scale={FULL_SCALE} />)
    const x = xs(container.querySelector('polyline'))
    expect(x.length).toBeGreaterThan(80)
    expect(x[0]).toBeLessThan(10)
    expect(x.at(-1)).toBeGreaterThan(190)
  })

  it('draws only the portion t has reached, never past the playhead, and nothing before the domain', () => {
    const widthAt = (t: number): number => {
      const { container } = render(<Sparkline layer={population} t={t} scale={FULL_SCALE} />)
      const x = xs(container.querySelector('polyline'))
      if (t === 5_000) expect(x.at(-1)).toBeLessThanOrEqual(Number(container.querySelector('line')?.getAttribute('x1')) + 0.01)
      cleanup()
      return x.length === 0 ? 0 : x.at(-1)! - x[0]!
    }
    const [early, mid, late] = [11_000, 5_000, 10].map(widthAt)
    expect(early).toBeGreaterThan(0)
    expect(mid).toBeGreaterThan(early!)
    expect(late).toBeGreaterThan(mid!)

    const { container } = render(<Sparkline layer={population} t={20_000} scale={FULL_SCALE} />)
    expect(container.querySelector('polyline')).toBeNull()
    expect(container.querySelector('circle')).toBeNull()
    expect(container.querySelector('line')).not.toBeNull()
  })
})

describe('<LayerChart>', () => {
  const co2 = createScalarLayer(CO2_MANIFEST, CO2_DATA)

  it('closes from its named close button and on Escape, and stops listening once unmounted', () => {
    const onClose = vi.fn()
    const { getByRole, unmount } = render(<LayerChart layer={co2} t={1e8} scale={FULL_SCALE} onClose={onClose} />)
    fireEvent.click(getByRole('button', { name: `Close ${CO2_MANIFEST.name} chart` }))
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    unmount()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('draws the reached portion solid with its band, and the future as a ghost', () => {
    const present = render(<LayerChart layer={co2} t={0} scale={FULL_SCALE} onClose={() => {}} />)
    expect(present.container.querySelectorAll('polygon').length).toBeGreaterThan(present.container.querySelectorAll('polyline').length)
    cleanup()
    const mid = lines(render(<LayerChart layer={co2} t={1e8} scale={FULL_SCALE} onClose={() => {}} />).container)
    expect(mid.solid.length).toBeGreaterThan(0)
    expect(mid.ghost.length).toBeGreaterThan(0)
    cleanup()
    const { container } = render(<LayerChart layer={co2} t={5.7e8 + 1} scale={FULL_SCALE} onClose={() => {}} />)
    expect(lines(container).solid).toHaveLength(0)
    expect(container.querySelectorAll('polygon')).toHaveLength(0)
  })

  it('distinguishes "no record" inside a gap from "no data" outside the domain, never bridging the gap', () => {
    const inGap = render(<LayerChart layer={co2} t={3.2e6} scale={FULL_SCALE} onClose={() => {}} />).container
    expect(inGap.textContent).toMatch(/no record/)
    expect(inGap.textContent).not.toMatch(/no data/)
    const { ghost } = lines(inGap)
    expect(ghost).toHaveLength(1)
    expect(xs(ghost[0]!)[0]).toBeGreaterThan(0)
    cleanup()
    expect(render(<LayerChart layer={co2} t={EARTH_FORMATION + 1} scale={FULL_SCALE} onClose={() => {}} />).container.textContent).toMatch(/no data/)
  })

  it('does not re-sample the layer when only t changes', () => {
    const sample = vi.fn(co2.sample)
    const layer = { ...co2, sample }
    const { rerender } = render(<LayerChart layer={layer} t={1e8} scale={FULL_SCALE} onClose={() => {}} />)
    expect(sample.mock.calls.length).toBeGreaterThan(1)
    sample.mockClear()
    rerender(<LayerChart layer={layer} t={2e8} scale={FULL_SCALE} onClose={() => {}} />)
    expect(sample.mock.calls).toEqual([[2e8]])
  })
})
