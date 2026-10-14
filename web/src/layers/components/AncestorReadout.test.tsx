import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createNodeLayer } from '../factories'
import { ANCESTOR_DATA, ANCESTOR_MANIFEST } from '../fixtures'
import { AncestorReadout } from './AncestorReadout'

afterEach(cleanup)

describe('<AncestorReadout>', () => {
  it('names the ancestor and since when it has been the ancestor, or "no data" before the root', () => {
    const layer = createNodeLayer(ANCESTOR_MANIFEST, ANCESTOR_DATA)
    const text = render(<AncestorReadout layer={layer} t={5e7} />).container.textContent ?? ''
    expect(text).toContain('First primate')
    expect(text).toMatch(/^Ancestor since \S/)
    cleanup()
    expect(render(<AncestorReadout layer={layer} t={4.3e9} />).container.textContent).toBe('Ancestorno data')
  })
})
