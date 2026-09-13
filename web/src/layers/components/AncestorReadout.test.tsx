import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createNodeLayer } from '../factories'
import { ANCESTOR_DATA, ANCESTOR_MANIFEST } from '../fixtures'
import { AncestorReadout } from './AncestorReadout'

afterEach(cleanup)

describe('<AncestorReadout>', () => {
  it('renders the label, representative organism and "since <t>" via formatGeoTime', () => {
    const layer = createNodeLayer(ANCESTOR_MANIFEST, ANCESTOR_DATA)
    // t=5e7 lands on the "First primate" node (tDivergence 6.6e7, representative Purgatorius)
    // — the youngest node whose divergence is at or after t.
    const { container } = render(<AncestorReadout layer={layer} t={5e7} />)
    const text = container.textContent ?? ''
    expect(text).toContain('First primate')
    expect(text).toContain('Purgatorius')
    expect(text).toContain('since')
    expect(text).toContain('66 Ma')
  })

  it('renders "no data" before the root has diverged', () => {
    const layer = createNodeLayer(ANCESTOR_MANIFEST, ANCESTOR_DATA)
    const { container } = render(<AncestorReadout layer={layer} t={4.3e9} />)
    expect(container.textContent).toBe('no data')
  })
})
