import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createScalarLayer } from '../factories'
import { CO2_DATA, CO2_MANIFEST } from '../fixtures'
import { ScalarReadout } from './ScalarReadout'

afterEach(cleanup)

describe('<ScalarReadout>', () => {
  it('shows ~277 ppm at t=0 from the CO2 fixture', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const { container } = render(<ScalarReadout layer={layer} t={0} />)
    const text = container.textContent ?? ''
    expect(text).toMatch(/277/)
    expect(text).toMatch(/ppm/)
  })

  it('renders "no data" — never "0" — when the layer is null at t', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const { container } = render(<ScalarReadout layer={layer} t={6e8} />)
    const text = container.textContent ?? ''
    expect(text).toMatch(/no data/)
    expect(text).not.toMatch(/\b0\b/) // never a bare "0" standing in for the missing value
  })

  it('renders bounds when the fixture sample carries them', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    // t=1e8 is an exact sample in the fixture: value=1200, lower=900, upper=1600.
    const { container } = render(<ScalarReadout layer={layer} t={1e8} />)
    const text = container.textContent ?? ''
    expect(text).toMatch(/1200/)
    expect(text).toMatch(/900/)
    expect(text).toMatch(/1600/)
  })
})
