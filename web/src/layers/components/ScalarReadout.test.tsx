import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { createScalarLayer } from '../factories'
import { CO2_DATA, CO2_MANIFEST, POPULATION_DATA, POPULATION_MANIFEST } from '../fixtures'
import { ScalarReadout } from './ScalarReadout'

afterEach(cleanup)

describe('<ScalarReadout>', () => {
  it('shows ~427 ppm at t=0 from the CO2 fixture', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const { container } = render(<ScalarReadout layer={layer} t={0} />)
    const text = container.textContent ?? ''
    expect(text).toMatch(/427/)
    expect(text).toMatch(/ppm/)
  })

  it('renders "no data" — never "0" — when t sits outside the layer\'s whole domain', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    // Beyond CO2_MANIFEST.timeDomain's own upper bound (EARTH_FORMATION), not merely CO2_DATA's
    // narrower sample range — the "no record" case below covers that one instead.
    const { container } = render(<ScalarReadout layer={layer} t={EARTH_FORMATION + 1} />)
    const text = container.textContent ?? ''
    expect(text).toMatch(/no data/)
    expect(text).not.toMatch(/\b0\b/) // never a bare "0" standing in for the missing value
  })

  it('renders "no record" — not "no data" — inside a declared gap (ADR-027)', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    // CO2_DATA declares a gap between t=805,743.87 and t=1e7; the fixture's Pliocene checkpoint.
    const { container } = render(<ScalarReadout layer={layer} t={3.2e6} />)
    const text = container.textContent ?? ''
    expect(text).toMatch(/no record/)
    expect(text).not.toMatch(/no data/)
  })

  it('prints only the value, never a range, even where the sample carries bounds', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    // t=1e8 is an exact sample in the fixture: value=1200, lower=900, upper=1600.
    const { container } = render(<ScalarReadout layer={layer} t={1e8} />)
    expect(container.textContent).toBe('Atmospheric CO2 1200 ppm')
  })

  it('formats a "people"-unit layer in human-scale words, not the raw number', () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    const { container } = render(<ScalarReadout layer={layer} t={2025} />)
    expect(container.textContent).toBe('Global population 232 million people')
  })

  it('holds the newest real sample for t nearer than the domain (ADR-031 amendment), annotated "as of"', () => {
    // POPULATION_MANIFEST's domain ends at t=10 (2015 CE) — the near-present gap this held-value
    // convention exists for.
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    const { container } = render(<ScalarReadout layer={layer} t={0} />)
    const text = container.textContent ?? ''
    expect(text).toMatch(/7\.3 billion/)
    expect(text).toMatch(/as of/i)
    expect(text).not.toMatch(/no data/)
  })

  it('does not hold or annotate once t is genuinely inside the domain', () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    const { container } = render(<ScalarReadout layer={layer} t={10} />)
    expect(container.textContent).not.toMatch(/as of/i)
  })

  it('never holds a layer whose domain already reaches the present (CO2, unaffected)', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const { container } = render(<ScalarReadout layer={layer} t={0} />)
    expect(container.textContent).not.toMatch(/as of/i)
  })

  it('still reads "no data" past the oldest domain edge — the old side is never held', () => {
    const layer = createScalarLayer(POPULATION_MANIFEST, POPULATION_DATA)
    const { container } = render(<ScalarReadout layer={layer} t={EARTH_FORMATION} />)
    const text = container.textContent ?? ''
    expect(text).toMatch(/no data/)
    expect(text).not.toMatch(/as of/i)
  })
})
