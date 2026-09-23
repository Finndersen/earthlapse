import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { createScalarLayer } from '../factories'
import { CO2_DATA, CO2_MANIFEST, POPULATION_DATA, POPULATION_MANIFEST } from '../fixtures'
import { ScalarReadout } from './ScalarReadout'

afterEach(cleanup)

describe('<ScalarReadout>', () => {
  const co2 = createScalarLayer(CO2_MANIFEST, CO2_DATA)
  const population = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
  const text = (layer: typeof co2, t: number) => render(<ScalarReadout layer={layer} t={t} />).container.textContent ?? ''

  it('prints the value alone, never its bounds, in human-scale words for people', () => {
    expect(text(co2, 1e8)).toBe('Atmospheric CO2 1200 ppm')
    cleanup()
    expect(text(population, 2025)).toBe('Global population 232 million people')
  })

  it('distinguishes "no record" in a gap from "no data" outside the domain, never showing 0', () => {
    const inGap = text(co2, 3.2e6)
    expect(inGap).toMatch(/no record/)
    expect(inGap).not.toMatch(/no data/)
    cleanup()
    const outside = text(co2, EARTH_FORMATION + 1)
    expect(outside).toMatch(/no data/)
    expect(outside).not.toMatch(/\b0\b/)
  })

  it('holds the newest sample "as of" only on the near-present side of a domain', () => {
    const held = text(population, 0)
    expect(held).toMatch(/7\.3 billion/)
    expect(held).toMatch(/as of/i)
    cleanup()
    expect(text(population, 10)).not.toMatch(/as of/i)
    cleanup()
    expect(text(co2, 0)).not.toMatch(/as of/i)
    cleanup()
    expect(text(population, EARTH_FORMATION)).toMatch(/no data/)
  })
})
