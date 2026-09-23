import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { SeriesData } from '@/data/curated'
import { EARTH_FORMATION } from '@/types/layer'

import { createScalarLayer } from '../factories'
import { CO2_MANIFEST, POPULATION_DATA, POPULATION_MANIFEST } from '../fixtures'
import { Sparkline } from './Sparkline'

afterEach(cleanup)

function points(polyline: Element | null): Array<[number, number]> {
  const raw = polyline?.getAttribute('points')?.trim() ?? ''
  return raw === '' ? [] : raw.split(' ').map((p) => p.split(',').map(Number) as [number, number])
}

function dot(container: HTMLElement): [number, number] | null {
  const circle = container.querySelector('circle')
  return circle === null ? null : [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))]
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
    const { container } = render(<Sparkline layer={createScalarLayer(CO2_MANIFEST, data)} t={0} />)
    expect(container.querySelectorAll('polyline')).toHaveLength(2)
  })

  it.each([
    ['mid-domain', 5_000],
    ['past the newest sample, holding it', 0],
  ])('spans the whole width from the domain start to t, peaking at the playhead (%s)', (_, t) => {
    const { container } = render(<Sparkline layer={population} t={t} />)
    const trace = points(container.querySelector('polyline'))
    const [dotX, dotY] = dot(container)!
    expect(trace.length).toBeGreaterThan(150)
    expect(trace[0]![0]).toBeLessThan(4)
    expect(dotX).toBeGreaterThan(196)
    expect(trace.at(-1)![0]).toBeCloseTo(dotX)
    // Linear from zero: the first sample (4.4M) sits low, the running peak at the top.
    expect(trace[0]![1]).toBeGreaterThan(18)
    expect(dotY).toBeLessThan(4)
    expect(Math.min(...trace.map(([, y]) => y))).toBeCloseTo(dotY)
  })

  it('holds a minimum span at the start, so the trace stops short of the right edge', () => {
    const { container } = render(<Sparkline layer={population} t={12_000} />)
    const [dotX] = dot(container)!
    expect(dotX).toBeGreaterThan(3)
    expect(dotX).toBeLessThan(100)
  })

  it('draws nothing before the domain starts', () => {
    const { container } = render(<Sparkline layer={population} t={20_000} />)
    expect(container.querySelector('polyline')).toBeNull()
    expect(container.querySelector('circle')).toBeNull()
  })
})
